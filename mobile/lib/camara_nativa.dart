/// Un puente para que la página pida una foto. **Hoy no está conectado.**
///
/// ## Qué se usa en su lugar
///
/// Nadie llama a esto: no hay ni un `PuenteCamara` construido en toda la
/// aplicación. La cámara con recorte y enderezado sí funciona, pero por otro
/// camino —`_elegirImagen` en `main.dart`—, que intercepta el
/// `<input type="file" capture="environment">` que la página ya tenía, abre la
/// cámara, empuja `camara/pantalla_recorte.dart` y devuelve **la ruta de un
/// fichero temporal** con el JPEG ya rectificado.
///
/// Ese camino ganó por dos razones que solo se ven al montarlo. La primera es
/// que el frontend no cambia ni una línea: sigue habiendo un `input`, sigue
/// llegando un JPEG, y la mitad web de este puente —que habría vivido en
/// `frontend/src/services/camara.ts`, un fichero que precisamente por esto no
/// existe— no hace falta, así que tampoco hay un protocolo repartido entre dos
/// lenguajes sin nadie que compruebe que siguen de acuerdo. La segunda es que
/// por un fichero no viajan bytes: todo el troceado de aquí abajo existe solo
/// porque bajar datos a la página va por `runJavaScript` y choca con el tope
/// del Binder, y ese problema desaparece cuando lo único que cruza es una ruta.
///
/// Se conserva, y no se borra, porque está entero y probado
/// —`test/camara_nativa_test.dart`— y porque es justo lo que haría falta el día
/// que la página quiera pedir una foto por su cuenta: con un botón propio en
/// vez de un `input`, o necesitando distinguir «se canceló» de «falló», que un
/// selector de ficheros no sabe decir. Si ese día no llega, este fichero y su
/// prueba se pueden borrar sin tocar nada más.
///
/// Lo que sigue describe cómo funcionaría el puente si se conectara.
///
/// ## Iría al revés que las descargas, y eso cambia dónde está el problema
///
/// En `descarga_nativa.dart` los bytes suben de la página a Flutter por el
/// canal de JavaScript. Aquí **bajarían**, y bajar es por `runJavaScript`, que
/// mete la carga en la propia cadena del guion. Es la misma transacción Binder
/// y el mismo tope de aproximadamente un megabyte, con el mismo final: pasarse
/// no lanza, el mensaje simplemente no llega. De ahí que esto vaya partido en
/// trozos, aunque la dirección sea la contraria.
///
/// Los dos nombres de abajo serían el contrato entre las mitades: si se
/// cambiara uno habría que cambiar el otro, y no hay compilador que lo
/// compruebe.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:webview_flutter/webview_flutter.dart';

/// Canal que la página usa para pedir una foto (web → Flutter).
const String nombreCanalCamara = 'CamaraNativa';

/// Función global por la que llega la respuesta (Flutter → web).
const String nombreReceptorCamara = '__camaraNativa';

/// Cuánto base64 va en cada trozo.
///
/// 256 KiB, el mismo que en las descargas y por el mismo motivo: el Binder de
/// Android corta alrededor de un megabyte por transacción y al cortar pierde el
/// mensaje en silencio. Un cuarto de ese tope deja sitio de sobra para el resto
/// del guion y para lo que el propio `webview_flutter` añada por encima.
const int trozoCamaraCaracteres = 256 * 1024;

/// Tope de lo que se acepta mandar, en bytes.
///
/// Dieciséis megas es enorme para lo que sale de aquí: un JPEG de 1600 px al
/// 85 % anda por debajo del medio mega. No está para el caso normal sino para
/// el que no debería pasar —un enderezado que devuelve algo absurdo, o alguien
/// que en el futuro enchufe a este puente una imagen sin comprimir— porque el
/// síntoma de pasarse sería la página esperando para siempre una respuesta que
/// se perdió por el camino.
const int limiteFotoBytes = 16 * 1024 * 1024;

/// El guion que entrega un mensaje a la página.
///
/// Doble `jsonEncode` igual que en `voz_nativa.dart` y `descarga_nativa.dart`:
/// aquí dentro va base64 —que es inocuo— pero también el texto de un motivo de
/// fallo, que puede traer comillas. Codificarlo entero lo deja como dato y no
/// como código, y evita tener que acordarse de cuál de los dos campos era
/// seguro.
///
/// La comprobación de `typeof` no sobra: el guion se ejecuta contra la página
/// que haya cargada, que puede ser una versión vieja del frontend o la pantalla
/// de error, donde el receptor no existe.
String guionMensajeCamara(Map<String, Object?> mensaje) {
  final carga = jsonEncode(jsonEncode(mensaje));
  return 'if (typeof window.$nombreReceptorCamara === "function") '
      'window.$nombreReceptorCamara($carga);';
}

/// Cómo acabó el intento de conseguir una foto.
///
/// Son tres cosas distintas y la página tiene que poder distinguirlas: si
/// alguien le da a «atrás» en la cámara no hay que enseñarle un error rojo, y
/// si el enderezado no salió sí hay que decírselo y con qué hacer.
sealed class ResultadoDeFoto {
  const ResultadoDeFoto();
}

/// Hay foto, ya recortada y enderezada.
class FotoLista extends ResultadoDeFoto {
  const FotoLista(this.jpeg);

  final Uint8List jpeg;
}

/// Quien la iba a hacer se echó atrás. No es un fallo.
class FotoCancelada extends ResultadoDeFoto {
  const FotoCancelada();
}

/// No se pudo, y este es el motivo que se le puede enseñar a una persona.
class FotoFallida extends ResultadoDeFoto {
  const FotoFallida(this.motivo);

  final String motivo;
}

/// Abre la cámara, deja ajustar las esquinas y devuelve el JPEG enderezado.
///
/// Se inyecta porque es todo lo que este puente **no** puede probar sin un
/// teléfono: la cámara del sistema y una pantalla de Flutter. Lo que queda a
/// este lado —el troceado, el orden, los mensajes mal formados, la petición
/// repetida— se prueba entero sin dispositivo.
typedef TomarFoto = Future<ResultadoDeFoto> Function();

/// Conecta el botón de la página con la cámara del teléfono.
///
/// Se instala una sola vez, al crear el controlador y **antes** de cargar la
/// página, para que `window.$nombreCanalCamara` ya exista en el primer render.
/// Igual que con las descargas, eso le ahorra al frontend un saludo asíncrono:
/// si el objeto está, hay cámara nativa.
class PuenteCamara {
  PuenteCamara({required TomarFoto tomar}) : _tomar = tomar;

  final TomarFoto _tomar;

  WebViewController? _web;

  /// Por dónde salen los mensajes. Se desvía en las pruebas.
  Future<void> Function(Map<String, Object?>)? _responderPrueba;

  /// El identificador de la petición que está en marcha, si la hay.
  ///
  /// Solo cabe una. No es una simplificación: la cámara y la pantalla de
  /// recorte son modales y ocupan el teléfono entero, así que una segunda
  /// petición mientras la primera está abierta significa que la página mandó
  /// dos —un doble toque, o un botón que no se deshabilitó— y atenderla
  /// apilaría dos cámaras, de las que la de abajo quedaría huérfana.
  String? _enMarcha;

  /// Registra el canal en el controlador. Llamar antes de `loadRequest`.
  void registrar(WebViewController web) {
    _web = web;
    web.addJavaScriptChannel(
      nombreCanalCamara,
      onMessageReceived: (mensaje) => recibir(mensaje.message),
    );
  }

  /// Desvía los mensajes a una función, para poder probar sin WebView.
  void responderA(Future<void> Function(Map<String, Object?>) destino) {
    _responderPrueba = destino;
  }

  Future<void> _enviar(Map<String, Object?> mensaje) async {
    final destino = _responderPrueba;
    if (destino != null) {
      await destino(mensaje);
      return;
    }
    await _web?.runJavaScript(guionMensajeCamara(mensaje));
  }

  /// Procesa un mensaje del canal.
  ///
  /// Público para que las pruebas lo alimenten directamente.
  Future<void> recibir(String crudo) async {
    // Viene de nuestra propia página, y se valida igual. Una excepción dentro
    // del callback de un canal de JavaScript no sube a ningún sitio visible:
    // deja el puente mudo y la página esperando, que es el peor de los fallos
    // posibles porque no hay nada que mirar.
    Object? decodificado;
    try {
      decodificado = jsonDecode(crudo);
    } on FormatException {
      return;
    }
    if (decodificado is! Map<String, Object?>) return;

    final id = decodificado['id'];
    if (id is! String || id.isEmpty) return;

    if (decodificado['tipo'] != 'foto') return;

    if (_enMarcha != null) {
      await _enviar({
        'tipo': 'error',
        'id': id,
        'motivo': 'Ya hay una foto en marcha.',
      });
      return;
    }

    _enMarcha = id;
    try {
      final resultado = await _tomar();
      switch (resultado) {
        case FotoLista(:final jpeg):
          await _mandarFoto(id, jpeg);
        case FotoCancelada():
          await _enviar({'tipo': 'cancelada', 'id': id});
        case FotoFallida(:final motivo):
          await _enviar({'tipo': 'error', 'id': id, 'motivo': motivo});
      }
    } catch (error) {
      // La cámara del sistema puede negarse por permisos, por no existir en el
      // aparato o por quedarse sin memoria al decodificar. Se contesta igual
      // que a lo demás: lo que no puede pasar es que la página se quede
      // esperando.
      await _enviar({
        'tipo': 'error',
        'id': id,
        'motivo': 'No se pudo usar la cámara ($error).',
      });
    } finally {
      // En el `finally` y no al final del `try`: si algo lanzara al enviar la
      // respuesta, dejar la marca puesta inutilizaría el botón para el resto
      // de la sesión, y la única forma de recuperarlo sería cerrar la app.
      _enMarcha = null;
    }
  }

  Future<void> _mandarFoto(String id, Uint8List jpeg) async {
    if (jpeg.isEmpty) {
      await _enviar({
        'tipo': 'error',
        'id': id,
        'motivo': 'La foto salió vacía. Vuelve a intentarlo.',
      });
      return;
    }
    if (jpeg.length > limiteFotoBytes) {
      await _enviar({
        'tipo': 'error',
        'id': id,
        'motivo': 'La foto es demasiado grande para pasarla a la página.',
      });
      return;
    }

    final base64 = base64Encode(jpeg);
    final trozos = partirEnTrozos(base64);

    await _enviar({
      'tipo': 'inicio',
      'id': id,
      'mime': 'image/jpeg',
      'trozos': trozos.length,
    });

    // Con `await` uno detrás de otro, y no en paralelo. `runJavaScript`
    // devuelve un futuro por cada llamada; lanzarlas todas a la vez metería
    // varios megabytes de golpe en la cola del canal, que es exactamente la
    // forma de superar el tope de la transacción que se está intentando
    // esquivar. El índice viaja en cada trozo de todas formas, así que el
    // orden no es el contrato: es solo prudencia con la cola.
    for (var i = 0; i < trozos.length; i++) {
      await _enviar({
        'tipo': 'trozo',
        'id': id,
        'indice': i,
        'datos': trozos[i],
      });
    }
  }
}

/// Parte una cadena de base64 en trozos que quepan en una transacción.
///
/// Aparte y pública para poder probarla: es donde está el error de una unidad
/// que dejaría el último trozo fuera, y ese error produce una imagen que casi
/// se ve —le falta una franja de abajo— en vez de un fallo.
///
/// Una cadena vacía da un trozo vacío y no ninguno. Si diera ninguno, el
/// «inicio» anunciaría cero trozos y la página se quedaría esperando un final
/// que nunca llega; con uno vacío el reensamblado termina y decodifica a cero
/// bytes, que es un error que sí se ve.
List<String> partirEnTrozos(
  String base64, {
  int porTrozo = trozoCamaraCaracteres,
}) {
  if (base64.isEmpty) return const [''];
  final trozos = <String>[];
  for (var i = 0; i < base64.length; i += porTrozo) {
    final fin = i + porTrozo;
    trozos.add(base64.substring(i, fin > base64.length ? base64.length : fin));
  }
  return trozos;
}
