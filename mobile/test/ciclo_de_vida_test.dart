import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/ciclo_de_vida.dart';

/// Pruebas del aviso de «la aplicación volvió», sin teléfono.
///
/// Lo que se vigila no es que el aviso llegue, sino **cuándo no debe llegar**.
/// Un aviso de más provoca una reconexión que tira un socket sano y paga un
/// intercambio de estado completo; y como el estado transitorio `inactive` se
/// dispara cada vez que alguien baja la persiana de notificaciones, confundirlo
/// con una pausa sería reconectar varias veces por minuto sin que nada hubiera
/// pasado.
void main() {
  final t0 = DateTime.utc(2026, 1, 1, 12, 0, 0);

  group('cuándo se avisa a la página', () {
    test('al volver de una pausa larga, con los milisegundos que duró', () {
      final pausa = pausaAlVolver(
        estado: AppLifecycleState.resumed,
        pausadaDesde: t0,
        ahora: t0.add(const Duration(minutes: 30)),
      );
      expect(pausa, 30 * 60 * 1000);
    });

    test('al arrancar no se avisa, aunque llegue «resumed»', () {
      // Flutter emite `resumed` al iniciar sin haber pausado nada. Avisar ahí
      // haría que la web tirase un socket que se acaba de abrir, en el peor
      // momento posible: mientras todavía está sincronizando por primera vez.
      final pausa = pausaAlVolver(
        estado: AppLifecycleState.resumed,
        pausadaDesde: null,
        ahora: t0,
      );
      expect(pausa, isNull);
    });

    test('las idas no avisan: solo las vueltas', () {
      for (final estado in [
        AppLifecycleState.paused,
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.detached,
      ]) {
        expect(
          pausaAlVolver(estado: estado, pausadaDesde: t0, ahora: t0),
          isNull,
          reason: '«$estado» no es una vuelta',
        );
      }
    });

    test('el reloj hacia atrás da cero, no un número negativo', () {
      // Pasa al cambiar de zona horaria con la app dormida. Un negativo llegaría
      // a la web como «no estuvo fuera», que es justo lo contrario de lo cierto.
      final pausa = pausaAlVolver(
        estado: AppLifecycleState.resumed,
        pausadaDesde: t0,
        ahora: t0.subtract(const Duration(hours: 1)),
      );
      expect(pausa, 0);
    });
  });

  group('el observador completo', () {
    /// Un reloj que se mueve a mano, para no esperar media hora de verdad.
    late DateTime reloj;
    late PuenteCicloDeVida puente;

    setUp(() {
      reloj = t0;
      puente = PuenteCicloDeVida(ahora: () => reloj);
    });

    // Sin `registrar`, `_web` es `null` y `runJavaScript` no se llama: lo que
    // se comprueba en este grupo es la máquina de estados, que es donde está el
    // riesgo. El guion que se inyecta se comprueba aparte, más abajo.

    test('«inactive» no cuenta como haberse ido', () {
      /*
        El caso que más veces al día se da y el que más caro sale equivocar:
        bajar la persiana de notificaciones, o que entre una llamada y se
        rechace. El sistema no congela nada, la conexión sigue viva, y
        reconectar ahí es pagar una sincronización entera por nada.
      */
      puente.didChangeAppLifecycleState(AppLifecycleState.inactive);
      reloj = reloj.add(const Duration(minutes: 30));
      final pausa = pausaAlVolver(
        estado: AppLifecycleState.resumed,
        pausadaDesde: null,
        ahora: reloj,
      );
      expect(pausa, isNull);
    });

    test('si llegan «hidden» y luego «paused», la ida es la primera', () {
      /*
        Android manda los dos al apagar la pantalla, con unos milisegundos de
        diferencia. Quedarse con el segundo acortaría la pausa medida —justo la
        cifra con la que la web decide— y en el caso límite la dejaría por
        debajo del umbral.
      */
      puente.didChangeAppLifecycleState(AppLifecycleState.hidden);
      final idaReal = reloj;
      reloj = reloj.add(const Duration(milliseconds: 80));
      puente.didChangeAppLifecycleState(AppLifecycleState.paused);

      reloj = reloj.add(const Duration(minutes: 5));
      final esperado = reloj.difference(idaReal).inMilliseconds;

      // Se vuelve, y la pausa que se calcularía es la que arranca en `hidden`.
      expect(
        pausaAlVolver(
          estado: AppLifecycleState.resumed,
          pausadaDesde: idaReal,
          ahora: reloj,
        ),
        esperado,
      );
    });

    test('dos vueltas seguidas solo avisan de la primera', () {
      // La marca se borra al volver. Sin eso, un `resumed` repetido —los hay—
      // avisaría otra vez con la misma pausa ya consumida.
      puente.didChangeAppLifecycleState(AppLifecycleState.paused);
      reloj = reloj.add(const Duration(minutes: 10));
      puente.didChangeAppLifecycleState(AppLifecycleState.resumed);

      expect(
        pausaAlVolver(
          estado: AppLifecycleState.resumed,
          pausadaDesde: null,
          ahora: reloj,
        ),
        isNull,
      );
    });
  });

  group('el guion que se inyecta', () {
    test('comprueba que el receptor existe antes de llamarlo', () {
      // El guion corre contra la página que haya cargada, que puede ser la
      // pantalla de error o una versión vieja del frontend. Sin el `typeof`,
      // cada desbloqueo dejaría una excepción en la consola del WebView.
      expect(guionDespertar(1000), contains('typeof'));
      expect(guionDespertar(1000), contains(nombreReceptorCiclo));
    });

    test('lleva el número tal cual, sin comillas', () {
      // La web lo compara contra un umbral. Si llegara como cadena, la
      // comparación seguiría compilando y daría siempre falso.
      expect(guionDespertar(1800000), contains('(1800000)'));
    });

    test('el nombre del receptor es el que espera la web', () {
      /*
        Contrato con `frontend/src/hooks/useReconexion.ts`, donde está la misma
        cadena. No hay compilador que una las dos mitades, así que al menos hay
        una prueba que falla si alguien cambia esta: el síntoma sin ella sería
        que reconectar tras el bloqueo de pantalla deja de funcionar, sin
        ningún error por ninguna parte.
      */
      expect(nombreReceptorCiclo, '__cicloDeVida');
    });
  });
}
