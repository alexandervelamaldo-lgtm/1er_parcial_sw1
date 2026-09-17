import 'dart:convert';

import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_to_text.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'idioma_dictado.dart';

/// Las decisiones sobre idioma y tiempos se reexportan desde aquí.
///
/// Viven en su propio fichero porque son puras y se prueban solas, pero quien
/// usa el puente no tiene por qué saber que están repartidas en dos sitios: este
/// fichero sigue siendo la puerta única de la voz nativa.
export 'idioma_dictado.dart';

/// El puente de voz entre la página y el sistema Android.
///
/// Existe porque **el WebView de Android no implementa la Web Speech API**: ni
/// `SpeechRecognition` ni `speechSynthesis`. No es un Chrome viejo, es otro
/// componente, y aunque comparte motor de render deja fuera esta API a
/// propósito. Dentro de la app, sin este fichero, el micrófono del asistente
/// está muerto y el botón «🔊 Escuchar» de la guía ni siquiera se dibuja: la
/// función desaparecía sin decir nada, que desde fuera es indistinguible de
/// algo que nadie había programado.
///
/// La otra mitad de esta conversación está en `frontend/src/services/voz.ts`,
/// que prefiere el puente cuando existe y cae en la API del navegador cuando
/// no. Los dos nombres de abajo son el contrato entre las dos mitades: si se
/// cambia uno hay que cambiar el otro, y no hay compilador que lo compruebe.

/// Canal que la página usa para pedir cosas (web → Flutter).
const String nombreCanal = 'VozNativa';

/// Función global que se llama para contestar (Flutter → web).
const String nombreReceptor = '__vozNativa';

/// Traduce el fallo del reconocedor a algo que se pueda leer sin saber Android.
///
/// Es una función aparte y pura para poder probarla sin micrófono. Los códigos
/// vienen de `android.speech.SpeechRecognizer` a través del plugin, y el motivo
/// de no dejarlos pasar tal cual es que `error_no_match` en pantalla no le dice
/// a nadie que vuelva a hablar más claro.
///
/// El código desconocido no se traga: se enseña. Un mensaje genérico convierte
/// un fallo diagnosticable en un misterio, y aquí el que lee es quien está
/// intentando hacer funcionar su propia app.
String mensajeDeError(String codigo) {
  switch (codigo) {
    case 'error_permission':
      return 'No has dado permiso para usar el micrófono.';
    case 'error_speech_timeout':
      return 'No se ha oído nada.';
    case 'error_no_match':
      return 'No se ha entendido lo que has dicho.';
    case 'error_busy':
      return 'El micrófono lo está usando otra aplicación.';
    case 'error_network':
    case 'error_network_timeout':
      return 'El reconocimiento de voz necesita conexión.';
    case 'error_language_not_supported':
    case 'error_language_unavailable':
      return 'El teléfono no tiene instalado el español para dictar.';
    default:
      return 'No se pudo usar el micrófono ($codigo).';
  }
}

/// Qué contar cuando el español no está descargado para dictar sin conexión.
///
/// Dice las tres cosas que hacen falta para no quedarse atascado: qué ha
/// pasado, qué hacer ahora mismo para seguir trabajando, y qué hacer una vez
/// para que no vuelva a pasar. Un «idioma no disponible» a secas cumple solo la
/// primera, y deja a quien lo lee sin saber siquiera que hay algo que instalar.
const String avisoSinIdiomaLocal =
    'El teléfono no tiene el español descargado para dictar sin conexión.\n'
    'Vuelve a pulsar el micrófono y la orden se entenderá igual, pero el audio '
    'saldrá a internet.\n'
    'Para dictar sin conexión: Ajustes › Sistema › Idiomas › Reconocimiento de '
    'voz sin conexión › Español.';

/// Que a partir de ahora el audio viaja. Se dice una vez por sesión de la app.
///
/// Repetirlo en cada orden lo convertiría en ruido que se aprende a ignorar, y
/// entonces dejaría de avisar de nada. Pero callarlo sería peor: «funciona sin
/// internet» es media verdad —la lectura en voz alta sí, el dictado no— y quien
/// dicta tiene derecho a saber de qué mitad está en cada momento.
const String avisoDictadoPorInternet =
    'Esta orden y las siguientes se dictan por internet: el reconocimiento sin '
    'conexión no está disponible en este teléfono.';

/// Qué contar cuando el reconocimiento local ha oído algo y no lo ha entendido.
///
/// Es el caso de «no se me entiende». El modelo que cabe dentro del teléfono es
/// bastante peor que el de la red, y sin esta frase la salida del usuario es
/// repetir la misma orden más alto y más despacio contra el mismo modelo que ya
/// falló. Se dice qué ha pasado, qué hacer ahora —volver a pulsar— y qué cambia
/// a partir de entonces, que es lo que no se puede callar: el audio empieza a
/// salir del teléfono.
const String avisoNoSeEntendioEnElAparato =
    'No se ha entendido lo dicho con el reconocimiento sin conexión, que entiende '
    'menos que el de internet.\n'
    'Al volver a pulsar el micrófono se intentará otra vez, esta vez enviando el '
    'audio a internet.';

/// El JavaScript que entrega un mensaje a la página.
///
/// Todo el contenido viaja **dentro de una cadena JSON codificada por
/// `jsonEncode`**, y no interpolado en el guion. La diferencia no es de estilo:
/// lo que se transporta es texto dictado por una persona, o sea entrada no
/// confiable (RNF-SEG-06), y una comilla suelta en «dijo "hola"» bastaría para
/// romper el literal. Codificar la cadena entera deja el texto como dato y no
/// como código, y de paso escapa los saltos de línea, que también lo romperían.
///
/// La comprobación de `typeof` no sobra: el guion se ejecuta contra la página
/// que haya cargada, y puede ser una versión vieja del frontend, o una pantalla
/// de error, donde el receptor no existe. Sin ella, cada respuesta del sistema
/// dejaría una excepción en la consola del WebView.
String guionRespuesta(Map<String, Object?> mensaje) {
  final carga = jsonEncode(jsonEncode(mensaje));
  return 'if (typeof window.$nombreReceptor === "function") '
      'window.$nombreReceptor($carga);';
}

/// Conecta el reconocedor y el sintetizador del sistema con el WebView.
///
/// Se instala una sola vez, al crear el controlador y **antes** de cargar la
/// página, para que `window.$nombreCanal` ya exista en el primer render. Esa
/// decisión es la que le ahorra al frontend un saludo asíncrono —«¿hay
/// puente?», «sí»— y todos los estados intermedios que trae: si el objeto está,
/// hay puente. Que el micrófono luego funcione es otra pregunta, y se contesta
/// al usarlo, con el motivo que dé el sistema.
class PuenteVoz {
  PuenteVoz({SpeechToText? reconocedor, FlutterTts? sintetizador})
    : _reconocedor = reconocedor ?? SpeechToText(),
      _sintetizador = sintetizador ?? FlutterTts();

  final SpeechToText _reconocedor;
  final FlutterTts _sintetizador;

  /// El WebView al que contestar. Se asigna al registrar el canal.
  WebViewController? _web;

  /// `initialize()` pide el permiso del micrófono y tarda; hacerlo una sola vez
  /// evita volver a preguntar en cada dictado. `false` significa que no hay
  /// reconocedor en el teléfono, y eso no cambia entre intentos.
  bool _preparado = false;

  /// Si se intenta reconocer **sin que el audio salga del aparato**.
  ///
  /// Empieza en `true` porque es lo que promete el proyecto: el asistente tiene
  /// que funcionar sin internet. Pasa a `false` en cuanto el teléfono contesta
  /// que no tiene el idioma descargado, y se queda así el resto de la ejecución:
  /// descargar un paquete de idioma no es algo que ocurra a mitad de una
  /// defensa, y reintentarlo en cada orden costaría un fallo entero antes de
  /// cada dictado.
  bool _enElAparato = true;

  /// Si ya se ha dicho que el dictado viaja por internet. Una vez, no en cada
  /// orden.
  bool _avisadoDeLaRed = false;

  /// La variante del castellano que se le pide al reconocedor.
  ///
  /// Se resuelve una vez, tras `initialize`, porque hasta entonces el teléfono no
  /// sabe decir qué idiomas tiene. `null` significa «no se ha encontrado ninguno
  /// del que fiarse»: entonces no se pide nada y decide el sistema, que acierta
  /// más que una región inventada desde aquí.
  String? _idioma;

  /// Registra el canal en el controlador. Llamar antes de `loadRequest`.
  void registrar(WebViewController web) {
    _web = web;
    web.addJavaScriptChannel(
      nombreCanal,
      onMessageReceived: (mensaje) => _recibir(mensaje.message),
    );
  }

  void _responder(Map<String, Object?> mensaje) {
    // `unawaited` de facto: nada depende del resultado y encadenar esperas
    // retrasaría los parciales, que solo sirven si llegan mientras se habla.
    _web?.runJavaScript(guionRespuesta(mensaje));
  }

  Future<void> _recibir(String crudo) async {
    // Viene de nuestra propia página, pero se valida igual. Un `jsonDecode` sin
    // comprobar la forma es una excepción dentro de un callback del canal, y el
    // síntoma sería que la voz deja de responder sin ningún error visible.
    Object? decodificado;
    try {
      decodificado = jsonDecode(crudo);
    } on FormatException {
      return;
    }
    if (decodificado is! Map<String, Object?>) return;

    final tipo = decodificado['tipo'];
    final texto = decodificado['texto'];
    switch (tipo) {
      case 'escuchar':
        await _escuchar();
      case 'parar':
        await _reconocedor.stop();
      case 'hablar':
        if (texto is String) await _hablar(texto);
      case 'callar':
        await _sintetizador.stop();
    }
  }

  Future<void> _escuchar() async {
    if (!_preparado) {
      _preparado = await _reconocedor.initialize(
        onError: _alFallar,
        onStatus: _alCambiarEstado,
      );
      if (!_preparado) {
        _responder({
          'tipo': 'error',
          'motivo':
              'Este teléfono no tiene reconocimiento de voz, o no le has dado '
              'permiso para el micrófono.',
        });
        _responder({'tipo': 'fin'});
        return;
      }
      await _resolverIdioma();
    }

    // Hablar mientras el teléfono lee la respuesta anterior haría que el
    // micrófono se oyese a sí mismo. Callar primero es más barato que filtrar
    // el eco después.
    await _sintetizador.stop();

    if (!_enElAparato && !_avisadoDeLaRed) {
      _avisadoDeLaRed = true;
      _responder({'tipo': 'aviso', 'motivo': avisoDictadoPorInternet});
    }

    await _reconocedor.listen(
      onResult: (resultado) {
        _responder({
          'tipo': resultado.finalResult ? 'final' : 'parcial',
          'texto': resultado.recognizedWords,
        });
      },
      listenOptions: SpeechListenOptions(
        // Cuánto se aguanta callado antes de dar la frase por terminada. Es lo
        // que faltaba: con el valor de Android, una orden dicha pensando se
        // enviaba partida en tres. Van aquí dentro y no como argumentos sueltos
        // de `listen` porque ahí están obsoletos desde speech_to_text 7.4.
        listenFor: duracionMaximaDelDictado,
        pauseFor: pausaQueTerminaElDictado,
        // La variante que tenga el teléfono, no la de España a mano. Va aquí
        // dentro y no como argumento suelto de `listen` porque el argumento está
        // obsoleto desde speech_to_text 7.
        localeId: _idioma,
        // Lo que hace que «funciona sin internet» sea cierto también para el
        // dictado. Sin esto el reconocedor de Android manda el audio fuera,
        // igual que hace Chrome, y la única parte offline de la voz sería la
        // lectura en voz alta. Deja de estar activo en cuanto se demuestra que
        // el modelo local no entiende lo que se le dice.
        onDevice: _enElAparato,
        // Los parciales son la única señal de que el micrófono está captando
        // algo. Sin ellos el usuario repite la frase entera creyendo que falló.
        partialResults: true,
        // Una orden suelta, no un dictado largo: `dictation` no corta a la
        // primera pausa, que es lo que se quiere en «crea la clase Pedido con
        // el atributo total de tipo Double».
        listenMode: ListenMode.dictation,
        cancelOnError: true,
      ),
    );
  }

  /// Pregunta al teléfono qué castellanos tiene y se queda con uno.
  ///
  /// Se hace una sola vez y después de `initialize`, que es cuando el plugin
  /// puede contestar. Si la consulta falla no se cae el dictado: se escucha sin
  /// pedir idioma, que es exactamente lo que se hacía antes de todo esto.
  Future<void> _resolverIdioma() async {
    try {
      final disponibles = await _reconocedor.locales();
      final sistema = await _reconocedor.systemLocale();
      _idioma = elegirIdiomaDeDictado(
        disponibles: disponibles.map((local) => local.localeId).toList(),
        delSistema: sistema?.localeId,
      );
    } on Exception {
      _idioma = sinIdiomaPreferido;
    }
  }

  void _alFallar(SpeechRecognitionError error) {
    // Que falte el idioma descargado no es que el dictado no funcione: es que no
    // funciona sin salir a la red. Se apunta para no volver a intentarlo y se
    // explica, incluido cómo seguir trabajando ahora mismo.
    //
    // No se reintenta solo, a propósito. El reintento tendría que tragarse el
    // «fin» del intento fallido para que la web no apagase el micrófono a mitad,
    // y ese «fin» llega por otro camino y sin orden garantizado: acertar a veces
    // dejaría el punto rojo encendido escuchando a nadie. Un toque más, una vez
    // en la vida del teléfono, es más barato que ese fallo.
    if (_enElAparato && dejarDeReconocerEnElAparato(error.errorMsg)) {
      _enElAparato = false;
      // Los dos casos acaban en el mismo sitio —el audio empieza a salir— pero
      // llegan por motivos distintos, y decir el que no es manda al usuario a
      // Ajustes a descargar un idioma que ya tenía.
      _responder({
        'tipo': 'error',
        'motivo': sinIdiomaEnElAparato(error.errorMsg)
            ? avisoSinIdiomaLocal
            : avisoNoSeEntendioEnElAparato,
      });
      return;
    }
    _responder({'tipo': 'error', 'motivo': mensajeDeError(error.errorMsg)});
  }

  void _alCambiarEstado(String estado) {
    // El único estado que le importa a la página es que se acabó, para poder
    // apagar el punto rojo. Se manda como `fin` y no como estado en crudo: la
    // web no tiene por qué conocer el vocabulario de Android.
    if (estado == SpeechToText.doneStatus ||
        estado == SpeechToText.notListeningStatus) {
      _responder({'tipo': 'fin'});
    }
  }

  Future<void> _hablar(String texto) async {
    await _sintetizador.setLanguage('es-ES');
    // Se corta lo anterior antes de empezar: sin esto, tocar «Escuchar» dos
    // veces encola la segunda lectura detrás de la primera y hay que esperar un
    // párrafo entero, que no es lo que nadie espera de un botón que ya suena.
    await _sintetizador.stop();
    await _sintetizador.speak(texto);
  }
}
