import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/idioma_dictado.dart';

/// La elección de idioma y los tiempos, sin micrófono.
///
/// Estas pruebas existen por una queja concreta: «no se me entiende». No era el
/// micrófono ni la pronunciación de quien hablaba, era que el reconocedor tenía
/// escrito `es-ES` a mano y se le estaba pidiendo el modelo de otro país.
void main() {
  group('elegirIdiomaDeDictado', () {
    test('escucha en la variante del sistema cuando el teléfono la tiene', () {
      expect(
        elegirIdiomaDeDictado(
          disponibles: ['en_US', 'es_ES', 'es_BO'],
          delSistema: 'es_BO',
        ),
        'es_BO',
      );
    });

    test('el guion y el guion bajo son el mismo idioma', () {
      // Android dice `es_BO` y la web dice `es-BO`. Comparar en crudo haría que
      // el idioma del sistema pareciera no estar instalado.
      expect(
        elegirIdiomaDeDictado(disponibles: ['es_BO'], delSistema: 'es-BO'),
        'es_BO',
      );
    });

    /*
      El teléfono en inglés no significa que quien lo usa hable inglés: significa
      que puso el teléfono en inglés. La región sí dice dónde está, y eso es
      mejor pista que nada.
    */
    test('sin castellano en el sistema, se usa la región del sistema', () {
      expect(
        elegirIdiomaDeDictado(
          disponibles: ['es_ES', 'es_MX', 'es_AR'],
          delSistema: 'en_MX',
        ),
        'es_MX',
      );
    });

    test('sin ninguna pista, cualquier castellano antes que el de España', () {
      expect(
        elegirIdiomaDeDictado(
          disponibles: ['es_ES', 'es_CO'],
          delSistema: 'de_DE',
        ),
        'es_CO',
      );
    });

    test('el de España se usa si es el único que hay', () {
      // Mal modelo es mejor que ninguno: lo que se evitaba era elegirlo por
      // omisión teniendo otros, no usarlo cuando es lo que hay.
      expect(
        elegirIdiomaDeDictado(disponibles: ['es_ES'], delSistema: 'en_US'),
        'es_ES',
      );
    });

    test('sin castellano no se inventa ninguno', () {
      // Pedir una variante que el teléfono no tiene acaba en un fallo de idioma
      // o en un modelo por omisión que nadie eligió. Sin candidatos, decide el
      // sistema.
      expect(
        elegirIdiomaDeDictado(disponibles: ['en_US'], delSistema: 'en_US'),
        isNull,
      );
      expect(elegirIdiomaDeDictado(disponibles: []), isNull);
    });

    test('devuelve la etiqueta tal como la escribió el teléfono', () {
      // La que entiende el plugin es la que él mismo dio. Normalizarla al
      // devolverla sería inventarse una que quizá no acepta.
      expect(
        elegirIdiomaDeDictado(disponibles: ['ES_bo'], delSistema: 'es_BO'),
        'ES_bo',
      );
    });
  });

  group('los tiempos del dictado', () {
    test('la pausa que termina la frase es más larga que pensar', () {
      // El valor de Android ronda los dos segundos y «crea la clase Pedido… con
      // el atributo total… de tipo Double» tiene pausas más largas que eso: la
      // orden se enviaba partida.
      expect(pausaQueTerminaElDictado.inSeconds, greaterThanOrEqualTo(6));
    });

    test('el tope es más largo que la pausa, o no habría pausa', () {
      // Si el máximo de la sesión fuese menor, cortaría antes de que la pausa
      // llegara a contar nunca.
      expect(duracionMaximaDelDictado, greaterThan(pausaQueTerminaElDictado));
    });
  });

  group('dejarDeReconocerEnElAparato', () {
    test('sin el idioma descargado no hay reconocimiento local que intentar', () {
      expect(dejarDeReconocerEnElAparato('error_language_unavailable'), isTrue);
      expect(dejarDeReconocerEnElAparato('error_language_not_supported'), isTrue);
    });

    /*
      El caso de «no se me entiende». El modelo que cabe en un teléfono entiende
      peor que el de la red, y repetir la frase contra el mismo modelo que acaba
      de fallar no la arregla.
    */
    test('si el modelo local no entiende, se pasa al de internet', () {
      expect(dejarDeReconocerEnElAparato('error_no_match'), isTrue);
    });

    test('quedarse sin red no se arregla saliendo a la red', () {
      expect(dejarDeReconocerEnElAparato('error_network'), isFalse);
      expect(dejarDeReconocerEnElAparato('error_network_timeout'), isFalse);
      expect(dejarDeReconocerEnElAparato('error_permission'), isFalse);
      expect(dejarDeReconocerEnElAparato('error_busy'), isFalse);
    });

    test('sigue distinguiéndose por qué se deja de reconocer aquí dentro', () {
      // Los dos motivos acaban en el mismo sitio pero se cuentan distinto: decir
      // el que no es manda a Ajustes a descargar un idioma que ya estaba.
      expect(sinIdiomaEnElAparato('error_no_match'), isFalse);
      expect(sinIdiomaEnElAparato('error_language_unavailable'), isTrue);
    });
  });
}
