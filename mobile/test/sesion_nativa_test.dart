import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/sesion/token.dart';
import 'package:uml_movil/sesion_nativa.dart';

/// Pruebas del puente que presta el token a la página sin dejarlo escrito.
///
/// Lo que se vigila aquí es lo que **sale** hacia la web y lo que se hace con
/// lo que entra. Las dos direcciones tienen su avería silenciosa: mandar de más
/// hacia fuera devuelve al WebView lo que se acaba de sacar de él, y no
/// entender un mensaje que llega deja la aplicación esperando una respuesta que
/// ya se dio.
void main() {
  const SesionGuardada laSesion = SesionGuardada(
    token: 't0ken',
    usuarioId: 'u1',
    email: 'ana@ejemplo.test',
    nombre: 'Ana',
    expira: 1893456000000,
  );

  group('lo que se le cuenta a la página', () {
    test('con sesión van el token y el perfil, y nada más', () {
      /*
        La lista de claves se comprueba entera a propósito. Añadir aquí la
        contraseña, la fecha de caducidad o cualquier otra cosa «por si la
        página la necesita» es meterla en el WebView, que es justo de donde se
        está sacando el token. Si algún día hace falta un campo nuevo, que esta
        prueba obligue a decidirlo en voz alta.
      */
      final mensaje = mensajeDeSesion(laSesion);
      expect(mensaje.keys, containsAll(<String>['tipo', 'token', 'usuario']));
      expect(mensaje.keys.length, 3);
      expect(mensaje['tipo'], 'sesion');
      expect(mensaje['token'], 't0ken');
      expect(mensaje['usuario'], {
        'id': 'u1',
        'email': 'ana@ejemplo.test',
        'nombre': 'Ana',
      });
    });

    test('sin sesión se contesta igual, con el token a nulo', () {
      // Callar dejaría a la página esperando hasta agotar su plazo. Una
      // pantalla que dice «entre» es mejor diagnóstico que una que no termina
      // de cargar.
      expect(mensajeDeSesion(null), {'tipo': 'sesion', 'token': null});
    });

    test('sin sesión no se menciona a ningún usuario', () {
      expect(mensajeDeSesion(null).containsKey('usuario'), isFalse);
    });
  });

  group('el guion que se ejecuta en la página', () {
    /// Deshace el doble encaje, que es lo que hará el navegador.
    Map<String, Object?> loQueRecibeLaWeb(String guion) {
      const marca = 'window.$nombreReceptorSesion(';
      final abre = guion.indexOf(marca) + marca.length;
      final cierra = guion.lastIndexOf(')');
      final literal = guion.substring(abre, cierra);
      // Primer `jsonDecode`: el literal de JavaScript se convierte en la cadena
      // que recibe la función. Segundo: esa cadena es el JSON del mensaje.
      return jsonDecode(jsonDecode(literal) as String) as Map<String, Object?>;
    }

    test('comprueba que hay alguien escuchando antes de llamar', () {
      // Sin el `typeof`, un mensaje que llegue antes de que la página monte su
      // receptor —o después de navegar fuera— revienta con un TypeError dentro
      // de `runJavaScript`, donde nadie lo recoge.
      final guion = guionRespuestaSesion(mensajeDeSesion(laSesion));
      expect(guion, startsWith('if (typeof window.$nombreReceptorSesion === "function")'));
    });

    test('una comilla en el nombre no rompe el guion', () {
      /*
        Es la razón entera del doble `jsonEncode`. El nombre lo escribió una
        persona y el token es texto arbitrario firmado por el servidor;
        cualquiera de los dos puede traer una comilla. Sin escapar, lo que se
        ejecuta en la página es un error de sintaxis, y con un nombre elegido a
        mala idea, algo peor.
      */
      const conComillas = SesionGuardada(
        token: 't0ken',
        usuarioId: 'u1',
        email: 'a@b.c',
        nombre: 'Ana "la \'mala\'" (jefa)\n\\fin',
        expira: 1,
      );
      final mensaje = mensajeDeSesion(conComillas);
      final vuelta = loQueRecibeLaWeb(guionRespuestaSesion(mensaje));
      expect(vuelta, mensaje);
    });

    test('el mensaje llega entero y con la misma forma', () {
      final mensaje = mensajeDeSesion(laSesion);
      expect(loQueRecibeLaWeb(guionRespuestaSesion(mensaje)), mensaje);
      expect(
        loQueRecibeLaWeb(guionRespuestaSesion(mensajeDeSesion(null))),
        {'tipo': 'sesion', 'token': null},
      );
    });
  });

  group('lo que llega desde la página', () {
    late PuenteSesion puente;
    late List<Map<String, Object?>> respuestas;
    late List<MotivoDeSalida> perdidas;

    setUp(() {
      perdidas = [];
      respuestas = [];
      puente = PuenteSesion(alPerderLaSesion: perdidas.add);
      puente.responderA(respuestas.add);
      puente.usar(laSesion);
    });

    test('«pedir» devuelve la sesión que custodia la carcasa', () {
      puente.recibir(jsonEncode({'tipo': 'pedir'}));
      expect(respuestas, [mensajeDeSesion(laSesion)]);
      expect(perdidas, isEmpty);
    });

    test('«pedir» sin sesión contesta que no la hay', () {
      puente.usar(null);
      puente.recibir(jsonEncode({'tipo': 'pedir'}));
      expect(respuestas, [
        {'tipo': 'sesion', 'token': null},
      ]);
    });

    test('«caducada» avisa arriba y suelta el token', () {
      /*
        La página es la única que ve el 401, y este aviso es el único que puede
        dar. Sin él, el almacén seguro seguiría custodiando con todo cuidado una
        llave que ya no abre nada, y el arranque siguiente entraría «directo»
        —sin pedir contraseña, porque la sesión parece estar— a una pantalla que
        falla en la primera petición.
      */
      puente.recibir(jsonEncode({'tipo': 'caducada'}));
      expect(perdidas, [MotivoDeSalida.caducada]);

      // Y si volviera a preguntar antes de que la pantalla cambie, no se le
      // vuelve a entregar el token que acaba de dejar de valer.
      puente.recibir(jsonEncode({'tipo': 'pedir'}));
      expect(respuestas, [
        {'tipo': 'sesion', 'token': null},
      ]);
    });

    test('«salir» se distingue de «caducada»', () {
      // Son dos pantallas distintas: una lleva un aviso que explica por qué se
      // ha vuelto al formulario y la otra no, porque se pidió a propósito.
      puente.recibir(jsonEncode({'tipo': 'salir'}));
      expect(perdidas, [MotivoDeSalida.aPeticion]);
    });

    test('un tipo desconocido se ignora sin ruido', () {
      // Es lo que llega de un frontend más nuevo que el APK instalado.
      // Contestar con un error convertiría una incompatibilidad benigna en una
      // avería visible.
      puente.recibir(jsonEncode({'tipo': 'renovar'}));
      puente.recibir(jsonEncode({'sin': 'tipo'}));
      expect(respuestas, isEmpty);
      expect(perdidas, isEmpty);
    });

    test('un mensaje roto no tira la aplicación', () {
      /*
        Una excepción aquí no la recoge nadie: esto corre dentro del callback
        del canal de JavaScript. El síntoma de dejarla escapar sería una app que
        pide la contraseña y después enseña otra pantalla de acceso, sin ningún
        error por medio.
      */
      puente.recibir('{esto no es json');
      puente.recibir('');
      puente.recibir('[]');
      puente.recibir('"pedir"');
      puente.recibir('42');
      expect(respuestas, isEmpty);
      expect(perdidas, isEmpty);
    });

    test('la sesión se puede cambiar sin recargar el WebView', () {
      const otra = SesionGuardada(
        token: 'nuevo',
        usuarioId: 'u2',
        email: 'b@c.d',
        nombre: 'Beto',
        expira: 2,
      );
      puente.usar(otra);
      puente.recibir(jsonEncode({'tipo': 'pedir'}));
      expect((respuestas.single)['token'], 'nuevo');
    });
  });

  group('el contrato con el lado de la web', () {
    test('los nombres son los que usa el frontend', () {
      /*
        Las mismas dos cadenas están afirmadas en
        `frontend/src/services/sesion-nativa.test.ts`. No hay compilador que una
        las dos mitades: cambiar una sin la otra deja la app pidiendo la
        contraseña dos veces, en Flutter y otra vez dentro del WebView, sin
        ningún error por medio. Estas dos líneas son todo lo que hay para que el
        cambio no pase desapercibido.
      */
      expect(nombreCanalSesion, 'SesionNativa');
      expect(nombreReceptorSesion, '__sesionNativa');
    });
  });
}
