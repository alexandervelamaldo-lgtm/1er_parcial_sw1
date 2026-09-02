import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/voz_nativa.dart';

/// Del puente se prueba lo que se puede probar sin micrófono ni WebView, que
/// resulta ser lo que más importa: cómo se traduce un fallo y cómo se mete
/// texto dictado dentro de un guion de JavaScript.
///
/// Lo otro —que `listen` llame a `onResult`— sería probar el plugin, no este
/// fichero.
void main() {
  group('guionRespuesta', () {
    test('el mensaje llega entero al otro lado', () {
      final guion = guionRespuesta({'tipo': 'final', 'texto': 'crea Pedido'});

      // Se reconstruye lo que recibiría la página: el guion lleva un literal de
      // cadena, y dentro de esa cadena va el JSON. Comprobar el ida y vuelta
      // completo, y no que el guion «contenga» el texto, es lo que distingue
      // transportarlo de simplemente pegarlo.
      expect(jsonDecode(_argumento(guion)), {
        'tipo': 'final',
        'texto': 'crea Pedido',
      });
    });

    test('no invoca al receptor si la página no lo tiene', () {
      // El guion corre contra lo que haya cargado, que puede ser una versión
      // vieja del frontend o la pantalla de error. Sin la guarda, cada respuesta
      // del sistema dejaría una excepción en la consola del WebView.
      expect(guionRespuesta({'tipo': 'fin'}), contains('typeof'));
    });

    test('unas comillas dictadas no rompen el guion', () {
      // «dijo "hola"» es una frase que alguien puede decir en voz alta. Si el
      // texto se interpolara en crudo, la comilla cerraría el literal y el resto
      // de la frase se ejecutaría como código.
      final guion = guionRespuesta({'tipo': 'final', 'texto': 'dijo "hola"'});

      expect(jsonDecode(_argumento(guion)), {
        'tipo': 'final',
        'texto': 'dijo "hola"',
      });
    });

    test('un texto que intenta cerrar la llamada viaja como dato', () {
      // RNF-SEG-06: lo que llega del reconocedor es entrada no confiable. Aquí
      // no se filtra ni se recorta —eso rompería frases legítimas—, se codifica,
      // que es lo que hace que el ataque deje de ser código y pase a ser una
      // cadena rara.
      const hostil = '");alert(1);//';
      final guion = guionRespuesta({'tipo': 'final', 'texto': hostil});

      // El ida y vuelta es la comprobación entera, y no hace falta añadirle
      // nada. Si la comilla hubiera cerrado el literal antes de tiempo, el
      // trozo entre paréntesis dejaría de ser una cadena JSON válida —tendría
      // basura detrás— y `_argumento` reventaría aquí mismo. Buscar `\"` a mano
      // sería peor: el texto escapado también contiene la secuencia, así que
      // una prueba escrita así falla sobre código correcto.
      final decodificado = jsonDecode(_argumento(guion)) as Map<String, Object?>;
      expect(decodificado['texto'], hostil);
      expect(decodificado.keys, hasLength(2));
    });

    test('los saltos de línea no parten la sentencia', () {
      // Una respuesta de la guía leída en voz alta tiene párrafos. Un salto de
      // línea sin escapar es un literal sin cerrar, o sea un `SyntaxError` y
      // ninguna lectura.
      final guion = guionRespuesta({'tipo': 'hablar', 'texto': 'uno\ndos'});

      expect(guion, isNot(contains('\n')));
      expect(
        (jsonDecode(_argumento(guion)) as Map<String, Object?>)['texto'],
        'uno\ndos',
      );
    });
  });

  group('mensajeDeError', () {
    test('traduce los códigos de Android a castellano', () {
      expect(
        mensajeDeError('error_permission'),
        'No has dado permiso para usar el micrófono.',
      );
      expect(mensajeDeError('error_speech_timeout'), 'No se ha oído nada.');
    });

    test('ningún mensaje deja el código de Android a la vista', () {
      // `error_no_match` en pantalla no le dice a nadie que hable más claro.
      for (final codigo in const [
        'error_permission',
        'error_speech_timeout',
        'error_no_match',
        'error_busy',
        'error_network',
        'error_language_not_supported',
      ]) {
        expect(mensajeDeError(codigo), isNot(contains('error_')));
      }
    });

    test('un código desconocido se enseña en vez de tragarse', () {
      // Un genérico convertiría un fallo diagnosticable en un misterio, y quien
      // lo lee es quien está intentando hacer funcionar su propia app.
      expect(mensajeDeError('error_raro_nuevo'), contains('error_raro_nuevo'));
    });
  });

  group('sinIdiomaEnElAparato', () {
    test('reconoce las dos formas en que Android dice que falta el idioma', () {
      expect(sinIdiomaEnElAparato('error_language_unavailable'), isTrue);
      expect(sinIdiomaEnElAparato('error_language_not_supported'), isTrue);
    });

    test('no confunde quedarse sin red con no tener el idioma', () {
      // Los dos aparecen al dictar sin conexión y llevan a sitios opuestos:
      // sin idioma se puede seguir saliendo a internet, sin red no. Tratarlos
      // igual apagaría el reconocimiento local de un teléfono que sí lo tiene.
      expect(sinIdiomaEnElAparato('error_network'), isFalse);
      expect(sinIdiomaEnElAparato('error_network_timeout'), isFalse);
      expect(sinIdiomaEnElAparato('error_no_match'), isFalse);
    });
  });

  group('los textos que se leen cuando el dictado no es local', () {
    test('el de idioma que falta dice cómo seguir y cómo arreglarlo', () {
      // Las tres cosas: qué pasó, qué hacer ahora para no quedarse atascado, y
      // qué hacer una vez para que no se repita. Un «idioma no disponible» a
      // secas solo cumple la primera.
      expect(avisoSinIdiomaLocal, contains('sin conexión'));
      expect(avisoSinIdiomaLocal, contains('Vuelve a pulsar'));
      expect(avisoSinIdiomaLocal, contains('Ajustes'));
    });

    test('el de la red no promete que el audio se quede en el teléfono', () {
      // Es literalmente lo contrario de lo que pide el enunciado, así que la
      // frase tiene que decirlo sin rodeos en vez de esconderlo.
      expect(avisoDictadoPorInternet, contains('internet'));
    });
  });
}

/// El literal de cadena que el guion le pasa al receptor, ya sin escapar.
///
/// Se saca decodificándolo como JSON —que es como se escribió— en vez de
/// buscando comillas a mano: recortar por índices aquí sería reimplementar el
/// escapado en la prueba, y entonces la prueba pasaría siempre que el código y
/// ella se equivocasen igual.
String _argumento(String guion) {
  const marca = '$nombreReceptor(';
  final abre = guion.lastIndexOf(marca) + marca.length;
  final cierra = guion.lastIndexOf(')');
  return jsonDecode(guion.substring(abre, cierra)) as String;
}
