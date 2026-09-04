import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/gramatica.dart';
import 'package:uml_movil/asistente/voz.dart';
import 'package:uml_movil/voz_nativa.dart';

import 'motor_falso.dart';

void main() {
  group('el estado del micrófono', () {
    test('se pide el reconocimiento dentro del aparato', () async {
      // Es media promesa del proyecto. Si esto se pusiera en `false`, el audio
      // saldría a internet en cada orden y «funciona sin conexión» dejaría de
      // ser cierto sin que ninguna prueba se enterase.
      final motor = MotorFalso();
      final voz = Voz(motor: motor);
      await voz.escuchar();

      expect(motor.ultimoEnElAparato, isTrue);
      expect(voz.sinConexion, isTrue);
      expect(voz.escuchando, isTrue);
    });

    test('se calla antes de escuchar, para no oírse a sí mismo', () async {
      final motor = MotorFalso();
      await Voz(motor: motor).escuchar();
      expect(motor.silencios, greaterThan(0));
    });

    test('lo que se lleva oído se ve mientras se habla', () async {
      final motor = MotorFalso();
      final voz = Voz(motor: motor);
      var avisos = 0;
      voz.addListener(() => avisos++);

      await voz.escuchar();
      motor.oyeAMedias('borra el');
      expect(voz.parcial, 'borra el');
      motor.oyeAMedias('borra el pedido');
      expect(voz.parcial, 'borra el pedido');
      // Sin estos avisos la pantalla no se redibujaría y el usuario repetiría
      // la frase entera creyendo que el micrófono no le oye.
      expect(avisos, greaterThanOrEqualTo(3));
    });

    test('la frase terminada se entrega y el micrófono se apaga', () async {
      final motor = MotorFalso();
      final voz = Voz(motor: motor);
      final dictadas = <String>[];
      voz.alDictar = dictadas.add;

      await voz.escuchar();
      motor.oyeAMedias('borra el pedi');
      motor.oye('borra el pedido 7');

      expect(dictadas, ['borra el pedido 7']);
      expect(voz.escuchando, isFalse);
      expect(voz.parcial, isEmpty);
    });

    test('un silencio no se entrega como orden', () async {
      // Si se entregara, el intérprete contestaría «no he entendido nada» a
      // alguien que no ha dicho nada, que es ruido y no ayuda.
      final motor = MotorFalso();
      final voz = Voz(motor: motor);
      final dictadas = <String>[];
      voz.alDictar = dictadas.add;

      await voz.escuchar();
      motor.oye('   ');

      expect(dictadas, isEmpty);
      expect(voz.escuchando, isFalse);
    });

    test('pulsar dos veces enciende y apaga', () async {
      final motor = MotorFalso();
      final voz = Voz(motor: motor);

      await voz.alternar();
      expect(voz.escuchando, isTrue);
      await voz.alternar();
      expect(voz.escuchando, isFalse);
      expect(motor.paradas, 1);
      // Y no se abre una escucha por cada toque: la segunda era para apagar.
      expect(motor.escuchas, 1);
    });

    test('el permiso se pide una sola vez, no en cada orden', () async {
      final motor = MotorFalso();
      final voz = Voz(motor: motor);
      await voz.escuchar();
      motor.oye('muéstrame los clientes');
      await voz.escuchar();

      expect(motor.escuchas, 2);
      expect(motor.preparado, isTrue);
    });
  });

  group('cuando el teléfono no puede', () {
    test('sin reconocedor ni permiso se dice, y no se queda escuchando',
        () async {
      final motor = MotorFalso()..puede = false;
      final voz = Voz(motor: motor);
      await voz.escuchar();

      expect(voz.escuchando, isFalse);
      expect(motor.escuchas, 0);
      expect(voz.incidencia, contains('permiso'));
    });

    test('sin el español descargado se cae a la red, se avisa y no se reintenta',
        () async {
      // La única familia de errores que no significa «el dictado no funciona»
      // sino «no funciona sin salir a la red». Distinguirla es lo que permite
      // seguir trabajando en vez de quedarse mirando un error.
      final motor = MotorFalso();
      final voz = Voz(motor: motor);

      await voz.escuchar();
      motor.falla('error_language_unavailable');

      expect(voz.sinConexion, isFalse);
      expect(voz.escuchando, isFalse);
      expect(voz.incidencia, avisoSinIdiomaLocal);

      // El segundo intento ya sale por la red, y se dice una vez.
      voz.olvidarIncidencia();
      await voz.escuchar();
      expect(motor.ultimoEnElAparato, isFalse);
      expect(voz.incidencia, avisoDictadoPorInternet);

      // Y solo una vez: repetirlo en cada orden lo convertiría en ruido que se
      // aprende a ignorar, y entonces dejaría de avisar de nada.
      voz.olvidarIncidencia();
      motor.oye('muéstrame los clientes');
      await voz.escuchar();
      expect(voz.incidencia, isNull);
    });

    test('un fallo cualquiera se traduce y deja el motivo a la vista', () async {
      final motor = MotorFalso();
      final voz = Voz(motor: motor);
      await voz.escuchar();
      motor.falla('error_no_match');

      expect(voz.incidencia, 'No se ha entendido lo que has dicho.');
      expect(voz.escuchando, isFalse);
    });

    test('si el reconocedor se apaga solo, el punto rojo también', () async {
      final motor = MotorFalso();
      final voz = Voz(motor: motor);
      await voz.escuchar();
      motor.seApaga();

      expect(voz.escuchando, isFalse);
    });
  });

  group('contestar a una propuesta', () {
    test('un sí suelto confirma; un sí con orden detrás, no', () {
      expect(confirmaHablando('sí'), isTrue);
      expect(confirmaHablando('Sí.'), isTrue);
      expect(confirmaHablando('sí, adelante'), isTrue);
      expect(confirmaHablando('vale'), isTrue);
      expect(confirmaHablando('dale'), isTrue);

      // Esto no es una respuesta: es una orden nueva que se dice empezando por
      // «sí». Tomarla por un asentimiento ejecutaría la propuesta anterior y
      // tiraría la frase que de verdad se dijo.
      expect(confirmaHablando('sí, borra el cliente 4'), isFalse);
      expect(confirmaHablando('muéstrame los clientes'), isFalse);
      expect(confirmaHablando(''), isFalse);
    });

    test('un no suelto cancela', () {
      expect(cancelaHablando('no'), isTrue);
      expect(cancelaHablando('No.'), isTrue);
      expect(cancelaHablando('déjalo'), isTrue);
      expect(cancelaHablando('mejor no'), isTrue);
      expect(cancelaHablando('no, borra el otro'), isFalse);
    });

    test('las dos cosas no pueden ser verdad a la vez', () {
      for (final frase in ['sí', 'no', 'vale', 'cancela', 'adelante']) {
        expect(confirmaHablando(frase) && cancelaHablando(frase), isFalse,
            reason: frase);
      }
    });

    test('las palabras de confirmar no rellenan un campo booleano', () {
      // «adelante» confirma una acción, pero dictar «producto adelante» no
      // puede encender el interruptor «activo». Son dos repertorios y por eso
      // son dos constantes.
      expect(confirmaHablando('adelante'), isTrue);
      expect(confirmaHablando('activo'), isFalse);
    });
  });
}
