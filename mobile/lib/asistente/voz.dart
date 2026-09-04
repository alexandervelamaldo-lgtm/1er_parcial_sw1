import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_recognition_error.dart';
import 'package:speech_to_text/speech_to_text.dart';

import '../voz_nativa.dart'
    show avisoDictadoPorInternet, avisoSinIdiomaLocal, mensajeDeError,
        sinIdiomaEnElAparato;

/// Micrófono y altavoz para el asistente nativo.
///
/// El puente de `voz_nativa.dart` hace esto mismo para la página del editor
/// dentro del WebView. Aquí no hay WebView que valga: la pantalla del asistente
/// es Flutter puro, así que habla con los plugins directamente. Lo que sí se
/// reaprovecha son las decisiones que costaron trabajo —qué contar cuando falta
/// el idioma descargado, cuándo avisar de que el audio sale a internet, cómo
/// traducir un `error_no_match`—, importadas de allí en vez de reescritas: son
/// las mismas para los dos caminos y duplicarlas garantizaría que un día
/// dejaran de coincidir.
///
/// El reconocimiento se pide **en el aparato** desde el principio, porque es lo
/// que el proyecto promete. Si el teléfono contesta que no tiene el español
/// descargado se cae a la red, se dice una vez, y no se vuelve a intentar en
/// toda la ejecución: nadie descarga un paquete de idioma a mitad de una
/// defensa, y reintentarlo costaría un fallo entero antes de cada dictado.

/// Lo que la pantalla necesita de un micrófono, sin nombrar ningún plugin.
///
/// Existe por una razón muy concreta: `SpeechToText` y `FlutterTts` hablan por
/// canales de plataforma, y en un `flutter test` no hay plataforma al otro
/// lado. Sin esta interfaz, probar que «el asistente lee en voz alta lo que va
/// a hacer» exigiría un teléfono conectado, y una prueba que necesita un
/// teléfono conectado es una prueba que no se ejecuta.
abstract class MotorDeVoz {
  /// Pide permiso y arranca el reconocedor. `false` si este aparato no puede.
  Future<bool> preparar({
    required void Function(String codigo) alFallar,
    required void Function(bool escuchando) alCambiarEstado,
  });

  Future<void> escuchar({
    required bool enElAparato,
    required void Function(String texto, bool definitivo) alOir,
  });

  Future<void> parar();

  Future<void> decir(String texto);

  Future<void> callar();
}

/// El motor de verdad: `speech_to_text` y `flutter_tts`.
class MotorNativo implements MotorDeVoz {
  MotorNativo({SpeechToText? reconocedor, FlutterTts? sintetizador})
      : _reconocedor = reconocedor ?? SpeechToText(),
        _sintetizador = sintetizador ?? FlutterTts();

  final SpeechToText _reconocedor;
  final FlutterTts _sintetizador;

  @override
  Future<bool> preparar({
    required void Function(String codigo) alFallar,
    required void Function(bool escuchando) alCambiarEstado,
  }) {
    return _reconocedor.initialize(
      onError: (SpeechRecognitionError error) => alFallar(error.errorMsg),
      onStatus: (estado) => alCambiarEstado(
        estado != SpeechToText.doneStatus &&
            estado != SpeechToText.notListeningStatus,
      ),
    );
  }

  @override
  Future<void> escuchar({
    required bool enElAparato,
    required void Function(String texto, bool definitivo) alOir,
  }) {
    return _reconocedor.listen(
      onResult: (r) => alOir(r.recognizedWords, r.finalResult),
      listenOptions: SpeechListenOptions(
        localeId: 'es-ES',
        onDevice: enElAparato,
        // Los parciales son la única señal de que el micrófono está captando
        // algo. Sin ellos se repite la frase entera creyendo que falló.
        partialResults: true,
        // Una orden suelta, no un dictado largo: `dictation` no corta en la
        // primera pausa, que es lo que hace falta en «apúntame una cita para
        // Juan… mañana a las cuatro».
        listenMode: ListenMode.dictation,
        cancelOnError: true,
      ),
    );
  }

  @override
  Future<void> parar() => _reconocedor.stop();

  @override
  Future<void> decir(String texto) async {
    await _sintetizador.setLanguage('es-ES');
    // Que `speak` no vuelva hasta haber terminado de sonar. Sin esto el
    // `await` de quien llama no espera a nada, y la pantalla vuelve a abrir el
    // micrófono mientras el altavoz sigue hablando: el teléfono se oye a sí
    // mismo y toma su propia frase por la respuesta del usuario.
    await _sintetizador.awaitSpeakCompletion(true);
    // Cortar lo anterior antes de empezar: si no, dos respuestas seguidas se
    // encolan y hay que esperar la primera entera para oír la segunda.
    await _sintetizador.stop();
    await _sintetizador.speak(texto);
  }

  @override
  Future<void> callar() => _sintetizador.stop();
}

/// El estado del micrófono, para que la pantalla lo pinte.
class Voz extends ChangeNotifier {
  Voz({MotorDeVoz? motor}) : _motor = motor ?? MotorNativo();

  final MotorDeVoz _motor;

  /// Qué hacer con una frase terminada. La pone la pantalla.
  void Function(String frase)? alDictar;

  bool _escuchando = false;
  String _parcial = '';
  String? _incidencia;

  /// `initialize()` pide el permiso del micrófono y tarda. Una sola vez.
  bool _preparado = false;

  /// Si el audio se queda dentro del teléfono. Ver la nota de arriba.
  bool _enElAparato = true;
  bool _avisadoDeLaRed = false;

  bool get escuchando => _escuchando;

  /// Lo que se lleva oído de la frase en curso. Vacío si no se está dictando.
  String get parcial => _parcial;

  /// Lo último que hay que contarle a quien dicta: un fallo, o el aviso de que
  /// el audio ha empezado a salir a internet. Se consume con [olvidarIncidencia].
  String? get incidencia => _incidencia;

  /// Si el reconocimiento se está haciendo sin salir a la red.
  bool get sinConexion => _enElAparato;

  Future<void> alternar() => _escuchando ? parar() : escuchar();

  Future<void> escuchar() async {
    if (_escuchando) return;

    if (!_preparado) {
      _preparado = await _motor.preparar(
        alFallar: _alFallar,
        alCambiarEstado: (activo) {
          if (activo || !_escuchando) return;
          _escuchando = false;
          _parcial = '';
          notifyListeners();
        },
      );
      if (!_preparado) {
        _avisar('Este teléfono no tiene reconocimiento de voz, o no le has '
            'dado permiso para el micrófono.');
        return;
      }
    }

    // Hablar mientras el teléfono lee la respuesta anterior haría que el
    // micrófono se oyera a sí mismo. Callar primero sale más barato que
    // filtrar el eco después.
    await _motor.callar();

    if (!_enElAparato && !_avisadoDeLaRed) {
      _avisadoDeLaRed = true;
      _avisar(avisoDictadoPorInternet);
    }

    _escuchando = true;
    _parcial = '';
    notifyListeners();

    await _motor.escuchar(enElAparato: _enElAparato, alOir: _alOir);
  }

  Future<void> parar() async {
    if (!_escuchando) return;
    _escuchando = false;
    _parcial = '';
    notifyListeners();
    await _motor.parar();
  }

  /// Lee un texto en voz alta.
  ///
  /// Es lo que convierte la pantalla en un asistente y no en un buscador: quien
  /// tiene las manos ocupadas —un barbero, que es el caso que se va a
  /// enseñar— necesita **oír** qué se ha entendido antes de decir que sí.
  Future<void> decir(String texto) => _motor.decir(texto);

  Future<void> callar() => _motor.callar();

  void olvidarIncidencia() {
    if (_incidencia == null) return;
    _incidencia = null;
    notifyListeners();
  }

  void _alOir(String texto, bool definitivo) {
    if (!definitivo) {
      _parcial = texto;
      notifyListeners();
      return;
    }
    _escuchando = false;
    _parcial = '';
    notifyListeners();
    // Una frase vacía no es una orden. Pasarla haría que el intérprete
    // contestara «no he entendido nada» a un silencio, que es ruido.
    if (texto.trim().isEmpty) return;
    alDictar?.call(texto);
  }

  void _alFallar(String codigo) {
    // Que falte el idioma descargado no significa que el dictado no funcione:
    // significa que no funciona sin salir a la red, que es otra cosa y tiene
    // otra salida. Se apunta para no volver a intentarlo y se explica cómo
    // seguir trabajando ahora mismo y cómo arreglarlo de una vez.
    _escuchando = false;
    _parcial = '';
    if (_enElAparato && sinIdiomaEnElAparato(codigo)) {
      _enElAparato = false;
      _avisar(avisoSinIdiomaLocal);
      return;
    }
    _avisar(mensajeDeError(codigo));
  }

  void _avisar(String texto) {
    _incidencia = texto;
    notifyListeners();
  }

  @override
  void dispose() {
    // Sin esto, salir de la pantalla mientras el teléfono está leyendo deja la
    // voz sonando encima de la pantalla siguiente.
    _motor.callar();
    _motor.parar();
    super.dispose();
  }
}
