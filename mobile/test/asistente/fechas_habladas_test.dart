import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/fechas_habladas.dart';
import 'package:uml_movil/asistente/manifiesto.dart';

/// Un viernes, para que «el próximo viernes» y «el viernes» se distingan.
final DateTime ahora = DateTime(2026, 9, 4, 10, 0);

MomentoHablado leer(String dicho) => leerMomento(plegar(dicho), ahora);

void main() {
  group('horas', () {
    test('«a las tres» se entiende como la tarde', () {
      // Nadie pide cita en la barbería a las tres de la madrugada. Es una
      // suposición, y está probada aquí para que se vea que lo es.
      expect(leer('a las tres').hora, '15:00');
    });

    test('«a las nueve» se queda por la mañana', () {
      expect(leer('a las nueve').hora, '09:00');
    });

    test('la mitad del día dicha manda sobre la suposición', () {
      expect(leer('a las tres de la mañana').hora, '03:00');
      expect(leer('a las ocho de la noche').hora, '20:00');
      expect(leer('a las nueve de la mañana').hora, '09:00');
    });

    test('las doce de la noche son las cero, no las doce', () {
      expect(leer('a las doce de la noche').hora, '00:00');
      expect(leer('a las doce del mediodía').hora, '12:00');
    });

    test('media, cuarto y menos cuarto', () {
      expect(leer('a las tres y media').hora, '15:30');
      expect(leer('a las diez y cuarto').hora, '10:15');
      // «menos cuarto» contiene «cuarto»: comprobar la corta primero daría las
      // tres y cuarto donde se dijo las tres menos cuarto.
      expect(leer('a las tres menos cuarto').hora, '14:45');
      expect(leer('a las nueve y veinte').hora, '09:20');
    });

    test('la hora escrita con dos puntos se respeta tal cual', () {
      expect(leer('a las 15:30').hora, '15:30');
      // Quien escribe «06:00» está diciendo las seis de la mañana; ahí la
      // suposición de la tarde no se aplica.
      expect(leer('a las 06:00').hora, '06:00');
      expect(leer('a la una').hora, '13:00');
    });

    test('mediodía y medianoche', () {
      expect(leer('al mediodía').hora, '12:00');
      expect(leer('a medianoche').hora, '00:00');
    });

    test('un número suelto no es una hora', () {
      // Si lo fuera, «precio 19» pediría cita para las siete de la tarde.
      expect(leer('precio 19').vacio, isTrue);
      expect(leer('cantidad 3').hora, isNull);
    });
  });

  group('fechas', () {
    test('las relativas se cuentan desde el reloj que se inyecta', () {
      expect(leer('hoy').fecha, '2026-09-04');
      expect(leer('mañana').fecha, '2026-09-05');
      // «pasado mañana» contiene «mañana»: sin el orden por longitud la cita
      // caería un día antes.
      expect(leer('pasado mañana').fecha, '2026-09-06');
      expect(leer('ayer').fecha, '2026-09-03');
    });

    test('el día del mes, con cifra o con letra', () {
      expect(leer('el 23 de septiembre').fecha, '2026-09-23');
      expect(leer('el veintitrés de septiembre').fecha, '2026-09-23');
      expect(leer('el 23 de setiembre').fecha, '2026-09-23');
    });

    test('sin año se entiende la próxima vez que llegue esa fecha', () {
      // Dicho en septiembre, «el tres de enero» es el de dentro de cuatro
      // meses y no el de hace ocho.
      expect(leer('el 3 de enero').fecha, '2027-01-03');
      expect(leer('el 30 de septiembre').fecha, '2026-09-30');
    });

    test('escrita con barras o en el formato del backend', () {
      expect(leer('23/09/2026').fecha, '2026-09-23');
      expect(leer('23/09').fecha, '2026-09-23');
      expect(leer('2026-09-23').fecha, '2026-09-23');
    });

    test('una fecha que no existe no se redondea a la siguiente', () {
      // `DateTime(2026, 2, 30)` devuelve el 2 de marzo sin quejarse. Aceptarlo
      // sería mandar al backend un día que nadie dictó.
      expect(leer('el 30 de febrero').fecha, isNull);
      expect(leer('2026-13-01').fecha, isNull);
    });

    test('los días de la semana', () {
      expect(leer('el lunes').fecha, '2026-09-07');
      expect(leer('el miércoles').fecha, '2026-09-09');
      // Hoy es viernes: «el viernes» es hoy, «el próximo viernes» es el de
      // dentro de una semana. La palabra marca la diferencia y se respeta.
      expect(leer('el viernes').fecha, '2026-09-04');
      expect(leer('el próximo viernes').fecha, '2026-09-11');
      expect(leer('el viernes que viene').fecha, '2026-09-11');
    });
  });

  group('las dos juntas', () {
    test('«mañana» es el día siguiente aunque también sea media jornada', () {
      // Este es el caso que obliga a leer la hora antes que la fecha. Si se
      // buscara la fecha primero, «a las nueve de la mañana» se entendería
      // como «mañana el día siguiente», justo lo contrario de lo dicho.
      final solo = leer('a las nueve de la mañana');
      expect(solo.hora, '09:00');
      expect(solo.fecha, isNull);

      final ambas = leer('mañana a las nueve de la mañana');
      expect(ambas.fecha, '2026-09-05');
      expect(ambas.hora, '09:00');
    });

    test('la frase del barbero', () {
      final momento = leer('esta cita para mañana a las tres');
      expect(momento.fechaHora, '2026-09-05 15:00');
    });

    test('lo consumido se sustituye por espacios sin mover lo demás', () {
      // Quien llama sigue cortando el texto original por estos índices para
      // quedarse con los nombres propios, así que la longitud no puede cambiar.
      const dicho = 'cita de Juan mañana a las tres';
      final momento = leerMomento(plegar(dicho), ahora);
      expect(momento.resto.length, plegar(dicho).length);
      expect(momento.resto.trim(), 'cita de juan');
    });
  });
}
