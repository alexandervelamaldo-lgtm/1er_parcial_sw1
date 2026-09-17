import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// El puente que saca ficheros de la página: el ZIP generado y el XMI.
///
/// Existe porque **un WebView de Android no descarga nada por su cuenta**, y hay
/// tres capas de motivo, cada una suficiente por sí sola:
///
/// 1. Sin `DownloadListener` registrado, pinchar un `<a download>` es un clic
///    que no dispara nada. Ni error, ni aviso: nada.
/// 2. Con él, lo que llega es una **URL** para el `DownloadManager`. Una `blob:`
///    vive dentro del proceso del navegador y el `DownloadManager` no sabe
///    resolverla.
/// 3. Y el ZIP sale de un **POST** con cuerpo y cabecera de autorización. El
///    `DownloadManager` hace GET anónimos: no hay forma de pedirlo por URL.
///
/// Así que los bytes los manda la página, ya hechos, y aquí se escriben. Como
/// la página también arma el XMI sin pasar por el servidor, esto sigue
/// funcionando sin conexión.
///
/// La otra mitad está en `frontend/src/services/descarga.ts`. Los dos nombres de
/// abajo son el contrato entre las mitades: si se cambia uno hay que cambiar el
/// otro, y no hay compilador que lo compruebe.

/// Canal que la página usa para mandar los bytes (web → Flutter).
const String nombreCanalDescarga = 'DescargaNativa';

/// Función global que se llama para contestar (Flutter → web).
const String nombreReceptorDescarga = '__descargaNativa';

/// Tope de lo que se acepta recibir, en bytes. El mismo que el lado web.
///
/// Se comprueba aquí otra vez y no se da por bueno el de allí. No es
/// desconfianza del frontend: es que el guardián que importa es el que está en
/// el lado que se queda sin memoria, y si algún día la página cambia de tope,
/// el que evita que la app muera es este.
const int limiteBytes = 64 * 1024 * 1024;

/// El JavaScript que entrega una respuesta a la página.
///
/// El contenido viaja **dentro de una cadena JSON codificada dos veces**, igual
/// que en `voz_nativa.dart` y por el mismo motivo: aquí dentro va una ruta del
/// sistema de ficheros o el texto de una excepción, y cualquiera de los dos
/// puede traer una comilla o una contrabarra que rompería el literal si se
/// interpolara en crudo. Codificarlo entero lo deja como dato y no como código.
///
/// La comprobación de `typeof` no sobra: el guion se ejecuta contra la página
/// que haya cargada, que puede ser una versión vieja del frontend o la pantalla
/// de error, donde el receptor no existe.
String guionRespuestaDescarga(Map<String, Object?> mensaje) {
  final carga = jsonEncode(jsonEncode(mensaje));
  return 'if (typeof window.$nombreReceptorDescarga === "function") '
      'window.$nombreReceptorDescarga($carga);';
}

/// Por qué no se pudo guardar, dicho sin que haya que saber Android.
///
/// Función pura y aparte para poder probarla sin tocar el disco. Lo que llega
/// es una excepción de `dart:io`, y su `toString()` incluye la ruta completa y
/// el `errno`: enseñar eso en una pantalla no le dice a nadie qué hacer.
///
/// Lo desconocido no se traga: se enseña con su texto. Un mensaje genérico
/// convierte un fallo diagnosticable en un misterio, y el que lee es quien está
/// intentando sacar su propio proyecto del teléfono.
String motivoDeFalloAlGuardar(Object error) {
  if (error is FileSystemException) {
    final codigo = error.osError?.errorCode;
    // 28 es ENOSPC en Linux, y Android lo es por debajo.
    if (codigo == 28) return 'No queda espacio en el teléfono.';
    // 13 es EACCES.
    if (codigo == 13) return 'La app no tiene permiso para escribir el fichero.';
    return 'No se pudo escribir el fichero: ${error.osError?.message ?? error.message}';
  }
  return 'No se pudo guardar el fichero ($error).';
}

/// Si un nombre que viene de la página se puede usar como nombre de fichero.
///
/// Aquí se **rechaza** y no se limpia, al revés que en el lado web. La
/// diferencia no es de criterio sino de consecuencia: allí el nombre es una
/// etiqueta que verá una persona y limpiarla es lo amable; aquí el nombre se
/// concatena a un directorio y se abre, así que una barra dentro escribe en
/// otro sitio. Limpiar en silencio en este lado significaría que un nombre
/// hostil produce un fichero con un nombre distinto del que la web cree haber
/// pedido, y entonces las dos mitades dejan de hablar de lo mismo.
///
/// Que el lado web ya limpie no hace esto redundante: el canal está expuesto a
/// cualquier JavaScript que corra en la página, incluida una versión antigua
/// del frontend servida desde una caché.
bool nombreAceptable(String nombre) {
  if (nombre.isEmpty || nombre.length > 160) return false;
  if (nombre == '.' || nombre == '..') return false;
  if (nombre.startsWith('.')) return false;
  for (final unidad in nombre.codeUnits) {
    // Controles, y el DEL.
    if (unidad < 0x20 || unidad == 0x7f) return false;
  }
  return !nombre.contains(RegExp(r'[/\\:*?"<>|]'));
}

/// Un fichero que está llegando a trozos.
///
/// Se guarda la lista y no una cadena que se va concatenando porque en Dart
/// concatenar dentro de un bucle crea una cadena nueva cada vez: con doscientos
/// trozos de 256 KiB eso son doscientas copias de un fichero que crece, o sea
/// varios gigabytes movidos para nada. Un `join` al final hace una sola pasada.
class DescargaEnCurso {
  DescargaEnCurso({
    required this.nombre,
    required this.mime,
    required this.total,
  }) : _trozos = List<String?>.filled(total, null);

  final String nombre;
  final String mime;
  final int total;
  final List<String?> _trozos;

  int _recibidos = 0;
  int _caracteres = 0;

  /// Cuánto base64 se lleva acumulado. Sirve para el fusible del tamaño.
  int get caracteres => _caracteres;

  /// Si ya están todos los trozos.
  bool get completa => _recibidos == total;

  /// Coloca un trozo. Devuelve `false` si el índice no vale o venía repetido.
  ///
  /// Se coloca por índice en vez de añadir al final a propósito. El canal de
  /// `webview_flutter` entrega en orden hoy, pero eso es una propiedad de la
  /// implementación y no del contrato; si algún día deja de cumplirse, un ZIP
  /// con dos trozos intercambiados no da ningún error, simplemente está
  /// corrupto. Colocar por índice hace que el orden deje de importar.
  bool colocar(int indice, String datos) {
    if (indice < 0 || indice >= total) return false;
    if (_trozos[indice] != null) return false;
    _trozos[indice] = datos;
    _recibidos += 1;
    _caracteres += datos.length;
    return true;
  }

  /// Los bytes, una vez están todos.
  List<int> bytes() {
    if (!completa) throw StateError('Faltan trozos por recibir');
    return base64Decode(_trozos.cast<String>().join());
  }
}

/// Dónde dejar el fichero y cómo ofrecerlo. Se inyecta para poder probar.
///
/// Devuelve la ruta donde quedó la copia, que es lo que se le enseña a quien
/// descargó: compartir por WhatsApp no deja rastro en el teléfono, y sin la
/// ruta el fichero es imposible de encontrar después.
typedef Guardar =
    Future<String> Function(String nombre, String mime, List<int> bytes);

/// Escribe el fichero y abre el diálogo de compartir del sistema.
///
/// Va al directorio de documentos de la app y no a la caché: el sistema vacía
/// la caché cuando le hace falta espacio, y aquí hay un proyecto que alguien
/// acaba de generar. Es el mismo sitio donde vive la bandeja de salida del
/// asistente y por la misma razón.
///
/// Y va por el diálogo de compartir en vez de escribir en «Descargas» porque
/// desde Android 10 una app no puede escribir ahí sin pasar por el
/// `MediaStore` o por el selector del sistema. El diálogo es ese selector, no
/// pide ningún permiso, y además cubre lo que en realidad se quiere hacer con
/// un ZIP recién generado en un móvil: mandárselo al portátil.
Future<String> guardarYCompartir(
  String nombre,
  String mime,
  List<int> bytes,
) async {
  final directorio = await getApplicationDocumentsDirectory();
  final ruta = '${directorio.path}${Platform.pathSeparator}$nombre';
  await File(ruta).writeAsBytes(bytes, flush: true);
  await SharePlus.instance.share(
    ShareParams(files: [XFile(ruta, mimeType: mime)], fileNameOverrides: [nombre]),
  );
  return ruta;
}

/// Conecta la descarga de la página con el sistema de ficheros del teléfono.
///
/// Se instala una sola vez, al crear el controlador y **antes** de cargar la
/// página, para que `window.$nombreCanalDescarga` ya exista en el primer
/// render. Esa decisión le ahorra al frontend un saludo asíncrono —«¿hay
/// puente?», «sí»— y todos los estados intermedios que trae: si el objeto está,
/// hay puente.
class PuenteDescarga {
  PuenteDescarga({Guardar? guardar}) : _guardar = guardar ?? guardarYCompartir;

  final Guardar _guardar;

  /// Las descargas que están llegando, por identificador. Puede haber más de
  /// una: nada impide exportar el XMI mientras el ZIP todavía viaja.
  final Map<String, DescargaEnCurso> _enCurso = {};

  WebViewController? _web;

  /// Por dónde salen las respuestas. Se desvía en las pruebas, donde no hay
  /// WebView al que hablarle.
  void Function(Map<String, Object?>)? _responderPrueba;

  /// Registra el canal en el controlador. Llamar antes de `loadRequest`.
  void registrar(WebViewController web) {
    _web = web;
    web.addJavaScriptChannel(
      nombreCanalDescarga,
      onMessageReceived: (mensaje) => recibir(mensaje.message),
    );
  }

  /// Desvía las respuestas a una función, para poder probar sin WebView.
  void responderA(void Function(Map<String, Object?>) destino) {
    _responderPrueba = destino;
  }

  void _responder(Map<String, Object?> mensaje) {
    final destino = _responderPrueba;
    if (destino != null) {
      destino(mensaje);
      return;
    }
    _web?.runJavaScript(guionRespuestaDescarga(mensaje));
  }

  void _fallar(String id, String motivo) {
    _enCurso.remove(id);
    _responder({'tipo': 'error', 'id': id, 'motivo': motivo});
  }

  /// Procesa un mensaje del canal.
  ///
  /// Es público para que las pruebas puedan alimentarlo directamente: lo que
  /// hay que comprobar es el reensamblado y las formas malas del mensaje, y
  /// nada de eso necesita un teléfono.
  Future<void> recibir(String crudo) async {
    // Viene de nuestra propia página, pero se valida igual. Un `jsonDecode` sin
    // comprobar la forma es una excepción dentro de un callback del canal, y el
    // síntoma sería que las descargas dejan de funcionar sin ningún error
    // visible —exactamente el fallo del que salió todo esto—.
    Object? decodificado;
    try {
      decodificado = jsonDecode(crudo);
    } on FormatException {
      return;
    }
    if (decodificado is! Map<String, Object?>) return;

    final id = decodificado['id'];
    if (id is! String) return;

    switch (decodificado['tipo']) {
      case 'inicio':
        _iniciar(id, decodificado);
      case 'trozo':
        await _trozo(id, decodificado);
    }
  }

  void _iniciar(String id, Map<String, Object?> mensaje) {
    final nombre = mensaje['nombre'];
    final mime = mensaje['mime'];
    final total = mensaje['trozos'];
    if (nombre is! String || mime is! String || total is! int || total < 1) {
      _fallar(id, 'La app recibió una descarga mal formada.');
      return;
    }
    if (!nombreAceptable(nombre)) {
      // Se rechaza en vez de arreglarlo. Ver `nombreAceptable`.
      _fallar(id, 'El nombre del fichero no se puede usar en el teléfono.');
      return;
    }
    // Un `inicio` repetido con el mismo id tirará lo que hubiera a medias. Es
    // lo correcto: significa que la página reintentó, y quedarse con la mezcla
    // de dos envíos daría un fichero corrupto en vez de un error.
    _enCurso[id] = DescargaEnCurso(nombre: nombre, mime: mime, total: total);
  }

  Future<void> _trozo(String id, Map<String, Object?> mensaje) async {
    final descarga = _enCurso[id];
    final indice = mensaje['indice'];
    final datos = mensaje['datos'];
    if (descarga == null) {
      // Un trozo sin su `inicio` no se puede colocar en ningún sitio. No se
      // contesta con error: o bien la descarga ya falló y su error se mandó, o
      // bien esto es ruido de una página vieja, y en los dos casos inventar una
      // respuesta confundiría a quien sí esté esperando.
      return;
    }
    if (indice is! int || datos is! String) {
      _fallar(id, 'La app recibió un trozo mal formado.');
      return;
    }
    if (!descarga.colocar(indice, datos)) {
      _fallar(id, 'La app recibió un trozo repetido o fuera de sitio.');
      return;
    }

    // El fusible se mira mientras llega y no al final: esperar a tenerlo todo
    // para decir que era demasiado grande significa haberlo aguantado ya entero
    // en memoria, que es justo lo que se quería evitar. El base64 ocupa cuatro
    // tercios de lo que ocupan los bytes, de ahí la proporción.
    if (descarga.caracteres > limiteBytes ~/ 3 * 4) {
      _fallar(id, 'El fichero es demasiado grande para pasarlo a la app.');
      return;
    }
    if (!descarga.completa) return;

    _enCurso.remove(id);
    try {
      final donde = await _guardar(descarga.nombre, descarga.mime, descarga.bytes());
      _responder({'tipo': 'listo', 'id': id, 'donde': donde});
    } on FormatException {
      // base64 que no decodifica: un trozo llegó cortado. Se distingue del
      // fallo de disco porque la salida es otra —reintentar la descarga, no
      // hacer sitio en el teléfono—.
      _fallar(id, 'Los datos llegaron corruptos. Vuelve a intentarlo.');
    } catch (error) {
      _fallar(id, motivoDeFalloAlGuardar(error));
    }
  }
}
