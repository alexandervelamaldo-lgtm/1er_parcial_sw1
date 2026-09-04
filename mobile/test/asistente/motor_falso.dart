import 'package:uml_movil/asistente/voz.dart';

/// Un micrófono y un altavoz de mentira, para probar la voz sin teléfono.
///
/// `speech_to_text` y `flutter_tts` hablan por canales de plataforma, y en un
/// `flutter test` no hay nadie al otro lado: usarlos de verdad aquí lanzaría un
/// `MissingPluginException` en la primera línea. Este doble es lo que hace que
/// «el asistente lee en voz alta lo que va a hacer» sea una afirmación
/// comprobable y no una que hay que ir a verificar a mano con un móvil en la
/// mano cada vez que se toca el fichero.
class MotorFalso implements MotorDeVoz {
  /// `false` para simular un teléfono sin reconocimiento o sin permiso.
  bool puede = true;

  /// Lo que se ha ido leyendo en voz alta, en orden.
  final List<String> dicho = <String>[];

  /// Cuántas veces se ha abierto el micrófono. Importa porque hay exactamente
  /// una escucha automática en toda la app —la de contestar a una pregunta— y
  /// una de más significaría que el micrófono se enciende solo.
  int escuchas = 0;
  int paradas = 0;
  int silencios = 0;

  /// Con qué valor de `onDevice` se pidió la última escucha. Que sea `true`
  /// es la mitad de la promesa de funcionar sin conexión.
  bool? ultimoEnElAparato;

  void Function(String texto, bool definitivo)? _alOir;
  void Function(String codigo)? _alFallar;
  void Function(bool escuchando)? _alCambiarEstado;

  bool get preparado => _alFallar != null;

  @override
  Future<bool> preparar({
    required void Function(String codigo) alFallar,
    required void Function(bool escuchando) alCambiarEstado,
  }) async {
    if (!puede) return false;
    _alFallar = alFallar;
    _alCambiarEstado = alCambiarEstado;
    return true;
  }

  @override
  Future<void> escuchar({
    required bool enElAparato,
    required void Function(String texto, bool definitivo) alOir,
  }) async {
    escuchas++;
    ultimoEnElAparato = enElAparato;
    _alOir = alOir;
  }

  @override
  Future<void> parar() async {
    paradas++;
    _alOir = null;
  }

  @override
  Future<void> decir(String texto) async => dicho.add(texto);

  @override
  Future<void> callar() async => silencios++;

  // --- Lo que empuja la prueba, como si fuera el teléfono -------------------

  /// Se oye algo a medias: el usuario sigue hablando.
  void oyeAMedias(String texto) => _alOir?.call(texto, false);

  /// Se termina de oír una frase.
  void oye(String texto) => _alOir?.call(texto, true);

  /// El reconocedor se queja. Los códigos son los de `SpeechRecognizer`.
  void falla(String codigo) => _alFallar?.call(codigo);

  /// El reconocedor se apaga solo, sin haber oído nada.
  void seApaga() => _alCambiarEstado?.call(false);
}
