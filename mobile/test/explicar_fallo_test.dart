import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/main.dart';

/// La app es una carcasa: el editor, el CRDT y el offline son la web, y ahí es
/// donde están las 539 pruebas del proyecto. Repetirlas aquí no aportaría nada.
///
/// Lo único que esta capa decide por su cuenta es qué contarle a alguien cuando
/// la página no carga, y resulta que es justo lo que más se va a usar: en una
/// defensa el fallo probable no es el código sino el cable. Eso sí se prueba.
void main() {
  group('explicarFallo', () {
    test('contra localhost nombra el comando del túnel USB', () {
      final mensaje = explicarFallo(
        'net::ERR_CONNECTION_REFUSED',
        url: 'http://localhost:3001',
      );

      // El comando literal, no una alusión: se teclea tal cual, y hay que
      // repetirlo cada vez que se desenchufa el cable.
      expect(mensaje, contains('adb reverse tcp:3001 tcp:3001'));
      // Y la causa en crudo sigue estando, que es lo que distingue «no hay
      // servidor» de «no hay ruta».
      expect(mensaje, contains('net::ERR_CONNECTION_REFUSED'));
      expect(mensaje, contains('http://localhost:3001'));
    });

    test('127.0.0.1 se trata igual que localhost', () {
      expect(
        explicarFallo('x', url: 'http://127.0.0.1:3001'),
        contains('adb reverse'),
      );
    });

    test('contra un host remoto apunta al cleartext y no al túnel', () {
      final mensaje = explicarFallo('x', url: 'http://192.168.0.62:3001');

      // Sugerir `adb reverse` aquí sería mandar a alguien a perseguir un
      // problema que no tiene: con una IP de la red el túnel no pinta nada, y
      // el sospechoso pasa a ser Android bloqueando el HTTP sin cifrar.
      expect(mensaje, isNot(contains('adb reverse')));
      expect(mensaje, contains('network_security_config.xml'));
    });

    test('un dominio con TLS tampoco menciona el túnel', () {
      expect(
        explicarFallo('x', url: 'https://uml.example.com'),
        isNot(contains('adb reverse')),
      );
    });
  });
}
