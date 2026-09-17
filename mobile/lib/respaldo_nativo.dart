import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Guardar el documento del diagrama fuera del WebView.
///
/// ## Qué se averiguó antes de escribir esto
///
/// La pregunta era si Android borra el IndexedDB del WebView. **Por su cuenta
/// no**: vive en el directorio de datos de la aplicación, no en la caché, y
/// sobrevive al bloqueo de pantalla, al segundo plano, a que el sistema mate el
/// proceso, al reinicio y a actualizar el APK. Por eso esto no se dispara en
/// cada pausa.
///
/// Pero se pierde igual, por tres caminos:
///
/// 1. **Es almacenamiento desechable y aquí no se puede dejar de serlo.**
///    Chromium desaloja orígenes cuando falta sitio en el aparato. La salida
///    normal es `navigator.storage.persist()`, pero ese permiso no se pregunta:
///    se concede solo al detectar uso asentado —favoritos, notificaciones,
///    instalada como PWA— y ninguna de esas señales existe dentro de un
///    WebView. La promesa se resuelve a `false` siempre.
/// 2. **El origen puede cambiar sin que nadie borre nada.** El almacén está
///    indexado por origen y el WebView carga lo que diga `APP_URL`. Hoy es
///    `http://localhost:3001`; el día que apunte al despliegue, el almacén es
///    otro y está vacío. Lo editado sin conexión no está borrado: está donde ya
///    no se entra.
/// 3. **Borrar los datos de la app.** Del ajuste del sistema, o reinstalando el
///    APK, que en un teléfono de pruebas pasa varias veces al día.
///
/// Lo único que se juega es **lo editado sin llegar a sincronizar**, porque
/// todo lo demás tiene copia en el servidor. Por eso el lado web solo manda
/// cuando el servidor no lo tiene, y manda un `olvidar` en cuanto lo tiene. Las
/// reglas están en `frontend/src/hooks/respaldo.ts`; aquí solo se escribe.
///
/// La otra mitad es `frontend/src/hooks/useRespaldo.ts`. Los dos nombres de
/// abajo son el contrato entre las mitades, y no hay compilador que lo
/// compruebe.

/// Canal por el que sube el documento (web → Flutter).
const String nombreCanalRespaldo = 'RespaldoNativo';

/// Función global que se llama para contestar (Flutter → web).
const String nombreReceptorRespaldo = '__respaldoNativo';

/// Tope de base64 que se acepta. El mismo que el lado web.
///
/// Se comprueba aquí otra vez y no se da por bueno el de allí, por lo mismo que
/// en `descarga_nativa.dart`: el guardián que importa es el del lado que se
/// queda sin memoria, y el canal está expuesto a cualquier JavaScript que corra
/// en la página, incluida una versión vieja del frontend servida de una caché.
const int limiteRespaldoB64 = 256 * 1024;

/// El JavaScript que entrega una respuesta a la página.
///
/// Doblemente codificado, igual que en los otros puentes y por lo mismo: dentro
/// viaja base64 y texto de excepciones, y cualquiera de los dos puede traer una
/// comilla que rompería el literal si se interpolara en crudo.
String guionRespuestaRespaldo(Map<String, Object?> mensaje) {
  final carga = jsonEncode(jsonEncode(mensaje));
  return 'if (typeof window.$nombreReceptorRespaldo === "function") '
      'window.$nombreReceptorRespaldo($carga);';
}

/// Si un identificador de proyecto se puede usar como nombre de fichero.
///
/// Se **rechaza**, no se limpia, por la misma regla que rige en el resto del
/// proyecto y con un motivo muy concreto aquí: este identificador se concatena
/// a un directorio y se abre. Un `..` dentro escribe fuera; una barra escribe
/// en otro sitio. Y limpiar en silencio sería peor que rechazar, porque dos
/// identificadores distintos podrían limpiarse al mismo nombre y un proyecto
/// acabaría restaurando el respaldo de otro.
///
/// La lista blanca cubre de sobra lo que el backend emite —identificadores tipo
/// UUID— sin dejar pasar ningún separador de rutas de ningún sistema.
bool proyectoAceptable(String id) {
  if (id.isEmpty || id.length > 64) return false;
  return RegExp(r'^[A-Za-z0-9_-]+$').hasMatch(id);
}

/// Dónde se dejan los respaldos. Se inyecta para poder probar sin disco.
abstract class AlmacenRespaldo {
  Future<void> guardar(String proyecto, List<int> bytes);
  Future<List<int>?> leer(String proyecto);
  Future<void> olvidar(String proyecto);
}

/// Los respaldos en el disco de la aplicación.
///
/// Van al directorio de documentos y no a la caché: el sistema vacía la caché
/// cuando le hace falta sitio, y guardar ahí lo que existe precisamente para
/// sobrevivir a que falte sitio sería un chiste. Es el mismo sitio donde viven
/// las descargas y la bandeja de salida del asistente.
class AlmacenEnDisco implements AlmacenRespaldo {
  Future<Directory> _carpeta() async {
    final base = await getApplicationDocumentsDirectory();
    final carpeta = Directory('${base.path}${Platform.pathSeparator}respaldos');
    if (!await carpeta.exists()) await carpeta.create(recursive: true);
    return carpeta;
  }

  Future<String> _ruta(String proyecto) async {
    final carpeta = await _carpeta();
    return '${carpeta.path}${Platform.pathSeparator}$proyecto.ydoc';
  }

  @override
  Future<void> guardar(String proyecto, List<int> bytes) async {
    final ruta = await _ruta(proyecto);
    /*
      Se escribe a un lado y se renombra encima, en vez de escribir directamente
      sobre el bueno. El renombrado dentro del mismo sistema de ficheros es
      atómico; escribir encima no lo es, y si el sistema mata la aplicación a
      mitad —que es exactamente la clase de momento en que esto se está
      usando— lo que queda no es el respaldo viejo ni el nuevo, sino el nuevo
      truncado. Un respaldo a medias es peor que ninguno: parece que hay copia.
    */
    final temporal = File('$ruta.parcial');
    await temporal.writeAsBytes(bytes, flush: true);
    await temporal.rename(ruta);
  }

  @override
  Future<List<int>?> leer(String proyecto) async {
    final fichero = File(await _ruta(proyecto));
    if (!await fichero.exists()) return null;
    return fichero.readAsBytes();
  }

  @override
  Future<void> olvidar(String proyecto) async {
    final fichero = File(await _ruta(proyecto));
    if (await fichero.exists()) await fichero.delete();
    // El parcial también, si quedó uno de una escritura interrumpida. Nadie lo
    // va a leer nunca, pero ocupa sitio en el aparato al que le faltaba sitio.
    final parcial = File('${await _ruta(proyecto)}.parcial');
    if (await parcial.exists()) await parcial.delete();
  }
}

/// Conecta el respaldo de la página con el disco del teléfono.
///
/// Se registra junto a los demás puentes al crear el controlador. A diferencia
/// del de voz y el de descargas, este **sí** tiene que estar antes de
/// `loadRequest`: el lado web comprueba si el canal existe para decidir si se
/// instala, y un canal que aparece después de que la página haya cargado es un
/// canal que esa página ya decidió que no estaba.
class PuenteRespaldo {
  PuenteRespaldo({AlmacenRespaldo? almacen})
    : _almacen = almacen ?? AlmacenEnDisco();

  final AlmacenRespaldo _almacen;

  WebViewController? _web;

  /// Por dónde salen las respuestas. Se desvía en las pruebas.
  void Function(Map<String, Object?>)? _responderPrueba;

  void registrar(WebViewController web) {
    _web = web;
    web.addJavaScriptChannel(
      nombreCanalRespaldo,
      onMessageReceived: (mensaje) => recibir(mensaje.message),
    );
  }

  void responderA(void Function(Map<String, Object?>) destino) {
    _responderPrueba = destino;
  }

  void _responder(Map<String, Object?> mensaje) {
    final destino = _responderPrueba;
    if (destino != null) {
      destino(mensaje);
      return;
    }
    _web?.runJavaScript(guionRespuestaRespaldo(mensaje));
  }

  /// Procesa un mensaje del canal.
  ///
  /// Público para que las pruebas lo alimenten directamente: lo que hay que
  /// comprobar son las formas malas del mensaje y el rechazo de los
  /// identificadores, y nada de eso necesita un teléfono.
  Future<void> recibir(String crudo) async {
    // Viene de nuestra propia página y se valida igual. Una excepción dentro
    // del callback del canal no la recoge nadie, y el síntoma sería que el
    // respaldo deja de funcionar sin ningún error visible: justo el fallo
    // silencioso que todo esto existe para evitar.
    Object? decodificado;
    try {
      decodificado = jsonDecode(crudo);
    } on FormatException {
      return;
    }
    if (decodificado is! Map<String, Object?>) return;

    final proyecto = decodificado['proyecto'];
    if (proyecto is! String) return;
    if (!proyectoAceptable(proyecto)) {
      // Se contesta en vez de callar. Si algún día el backend emite
      // identificadores con otra forma, el respaldo dejaría de funcionar entero
      // y en silencio; así al menos queda dicho en la consola del WebView.
      _responder({
        'tipo': 'error',
        'motivo': 'El identificador del proyecto no se puede usar como nombre de fichero.',
      });
      return;
    }

    try {
      switch (decodificado['tipo']) {
        case 'guardar':
          await _guardar(proyecto, decodificado['datos']);
        case 'leer':
          await _leer(proyecto);
        case 'olvidar':
          await _almacen.olvidar(proyecto);
      }
    } catch (error) {
      _responder({'tipo': 'error', 'motivo': _motivoDeFallo(error)});
    }
  }

  Future<void> _guardar(String proyecto, Object? datos) async {
    if (datos is! String) {
      _responder({'tipo': 'error', 'motivo': 'La app recibió un respaldo mal formado.'});
      return;
    }
    if (datos.length > limiteRespaldoB64) {
      _responder({
        'tipo': 'error',
        'motivo': 'El diagrama es demasiado grande para respaldarlo por el puente.',
      });
      return;
    }
    List<int> bytes;
    try {
      bytes = base64Decode(datos);
    } on FormatException {
      _responder({'tipo': 'error', 'motivo': 'El respaldo llegó corrupto y no se ha guardado.'});
      return;
    }
    await _almacen.guardar(proyecto, bytes);
  }

  Future<void> _leer(String proyecto) async {
    final bytes = await _almacen.leer(proyecto);
    /*
      El proyecto se devuelve dentro de la respuesta y no se da por supuesto.
      El lado web lo compara con el diagrama que tiene abierto, porque nada
      impide salir de uno y entrar en otro mientras esto viaja: sin ese cotejo,
      el respaldo de un proyecto se mezclaría en el documento de otro, y como
      mezclar en Yjs nunca falla, el resultado no sería un error sino las clases
      de otro proyecto subiendo al servidor como si fueran de este.
    */
    _responder({
      'tipo': 'respaldo',
      'proyecto': proyecto,
      'datos': bytes == null ? null : base64Encode(bytes),
    });
  }

  String _motivoDeFallo(Object error) {
    if (error is FileSystemException) {
      final codigo = error.osError?.errorCode;
      // 28 es ENOSPC. Merece mensaje propio porque es el caso que más se cruza
      // con este puente: el desalojo del IndexedDB también ocurre por falta de
      // sitio, así que es probable que las dos cosas fallen a la vez.
      if (codigo == 28) return 'No queda espacio en el teléfono para el respaldo.';
      if (codigo == 13) return 'La app no tiene permiso para escribir el respaldo.';
      return 'No se pudo escribir el respaldo: ${error.osError?.message ?? error.message}';
    }
    return 'No se pudo guardar el respaldo ($error).';
  }
}
