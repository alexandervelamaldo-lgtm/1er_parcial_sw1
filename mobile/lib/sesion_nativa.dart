/// Cómo llega el token a la página sin quedarse escrito en el WebView.
///
/// ## El problema, dicho con precisión
///
/// La web guarda su token en `localStorage` y tiene un motivo bueno para no
/// usar una cookie `HttpOnly`: el mismo token hay que meterlo en la URL del
/// WebSocket de colaboración, y una cookie `HttpOnly` no es legible desde el
/// código que construye esa URL. Está explicado en
/// `frontend/src/services/sesion.tsx` y no se toca.
///
/// Lo que cambia dentro de la app es dónde acaba ese `localStorage`: en un
/// fichero del directorio de datos, `app_webview/Default/Local Storage`. Un
/// token con semanas de vigencia guardado ahí sale del teléfono en cualquier
/// copia de seguridad del sistema y se lee entero con root. En un navegador de
/// escritorio no hay alternativa; en un teléfono sí, y no aprovecharla sería
/// dejar el punto más débil justo donde es más fácil de arreglar.
///
/// ## Cómo se resuelve
///
/// El token lo custodia la carcasa nativa, cifrado por el Keystore, y la página
/// lo recibe por este puente **cada vez que arranca, en memoria**. La web lo
/// pone en la cabecera y en la URL del socket igual que siempre; lo único que
/// no hace es escribirlo. Cuando el WebView se cierra, en su disco no queda
/// nada que robar.
///
/// El sentido contrario también importa y es la mitad que se olvida: la página
/// es la única que se entera de que el servidor ha dejado de aceptar la sesión
/// —le contesta 401 a una petición que sí llevaba token—, y si no lo dijera, el
/// almacén seguro conservaría para siempre una llave que ya no abre nada.
///
/// La otra mitad está en `frontend/src/services/sesion-nativa.ts`. Los dos
/// nombres de abajo son el contrato entre las mitades, y no hay compilador que
/// lo compruebe.
library;

import 'dart:convert';

import 'package:webview_flutter/webview_flutter.dart';

import 'sesion/token.dart';

/// Canal por el que la página pregunta y avisa (web → Flutter).
const String nombreCanalSesion = 'SesionNativa';

/// Función global que se llama para contestar (Flutter → web).
const String nombreReceptorSesion = '__sesionNativa';

/// El JavaScript que entrega una respuesta a la página.
///
/// Doblemente codificado, igual que los demás puentes: dentro viaja un token,
/// que es texto arbitrario firmado por el servidor, y un nombre de usuario, que
/// lo escribió una persona. Cualquiera de los dos puede traer una comilla, y sin
/// esto lo que se ejecutaría en la página sería un error de sintaxis —o, con un
/// nombre elegido a mala idea, algo peor.
String guionRespuestaSesion(Map<String, Object?> mensaje) {
  final carga = jsonEncode(jsonEncode(mensaje));
  return 'if (typeof window.$nombreReceptorSesion === "function") '
      'window.$nombreReceptorSesion($carga);';
}

/// El mensaje que se le manda a la página con la sesión que haya.
///
/// Está separado del puente para poder comprobar en una prueba qué se le cuenta
/// exactamente a la web, que es donde está el riesgo: mandar de más aquí es
/// devolver al `localStorage` lo que se acaba de sacar de él.
Map<String, Object?> mensajeDeSesion(SesionGuardada? sesion) {
  if (sesion == null) {
    // Sin sesión se contesta igual, con el token a `null`. Callar dejaría a la
    // página esperando para siempre, y una pantalla que no termina de cargar es
    // peor diagnóstico que una que dice que hay que entrar.
    return {'tipo': 'sesion', 'token': null};
  }
  return {
    'tipo': 'sesion',
    'token': sesion.token,
    'usuario': {
      'id': sesion.usuarioId,
      'email': sesion.email,
      'nombre': sesion.nombre,
    },
  };
}

/// Por qué se ha quedado la app sin sesión.
enum MotivoDeSalida {
  /// El servidor contestó 401: el token existe pero ya no lo acepta.
  caducada,

  /// Alguien pulsó «salir» dentro de la página.
  aPeticion,
}

/// Conecta la sesión de la página con la sesión guardada del teléfono.
///
/// Se registra junto a los demás puentes al crear el controlador, y **tiene que
/// estar antes de `loadRequest`**: la página pregunta por el token durante su
/// arranque, y un canal que aparezca después de que la página haya cargado es
/// un canal que la página ya dio por ausente. El síntoma sería la pantalla de
/// acceso de la web dentro de una app que acaba de pedir la contraseña.
class PuenteSesion {
  PuenteSesion({required this.alPerderLaSesion});

  /// Qué hace la carcasa cuando la sesión deja de valer.
  ///
  /// Lo decide `main.dart` y no este fichero: aquí no se sabe si hay una
  /// pantalla de acceso a la que volver, y un puente que navegue por su cuenta
  /// es un puente que no se puede probar.
  final void Function(MotivoDeSalida motivo) alPerderLaSesion;

  WebViewController? _web;
  SesionGuardada? _sesion;

  /// Por dónde salen las respuestas. Se desvía en las pruebas.
  void Function(Map<String, Object?>)? _responderPrueba;

  /// La sesión que se le entregará a la página cuando la pida.
  ///
  /// Se pone antes de registrar el puente. Puede volver a ponerse: al renovar
  /// la sesión sin recargar el WebView, la siguiente pregunta debe recibir la
  /// nueva y no la de antes.
  // ignore: use_setters_to_change_properties
  void usar(SesionGuardada? sesion) {
    _sesion = sesion;
  }

  void registrar(WebViewController web) {
    _web = web;
    web.addJavaScriptChannel(
      nombreCanalSesion,
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
    _web?.runJavaScript(guionRespuestaSesion(mensaje));
  }

  /// Procesa un mensaje del canal.
  ///
  /// Público para que las pruebas lo alimenten directamente: lo que hay que
  /// comprobar son las formas malas del mensaje y qué se contesta a cada una, y
  /// nada de eso necesita un teléfono.
  void recibir(String crudo) {
    // Viene de nuestra propia página y se valida igual. Una excepción dentro
    // del callback del canal no la recoge nadie, y el síntoma sería una app que
    // pide la contraseña y luego enseña otra pantalla de acceso, sin ningún
    // error por medio.
    Object? decodificado;
    try {
      decodificado = jsonDecode(crudo);
    } on FormatException {
      return;
    }
    if (decodificado is! Map<String, Object?>) return;

    switch (decodificado['tipo']) {
      case 'pedir':
        _responder(mensajeDeSesion(_sesion));
      case 'caducada':
        _sesion = null;
        alPerderLaSesion(MotivoDeSalida.caducada);
      case 'salir':
        _sesion = null;
        alPerderLaSesion(MotivoDeSalida.aPeticion);
      // Cualquier otra cosa se ignora en silencio: es lo que llegaría de un
      // frontend más nuevo que el APK, y contestar con un error convertiría una
      // incompatibilidad benigna en ruido en la consola.
    }
  }
}
