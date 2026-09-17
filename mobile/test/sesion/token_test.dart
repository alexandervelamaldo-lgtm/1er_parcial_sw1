import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/sesion/token.dart';

/// Pruebas de las decisiones del acceso, sin teléfono, sin red y sin almacén.
///
/// Hay dos que sostienen todo lo demás y conviene decir cuáles son antes de
/// leer el fichero, porque las dos fallan **sin dar ningún error**:
///
///  * `interpretarAcceso` con un `200` que no trae sesión. Si eso pasara por
///    bueno se guardaría en el Keystore un trozo de HTML como si fuera un
///    token, y la avería aparecería días después como peticiones que fallan.
///  * `pasoDeArranque` cuando la huella se pidió y el aparato ya no puede
///    ofrecerla. Entrar igual convertiría el desbloqueo en algo que se apaga
///    solo, y quien lo activó seguiría creyendo que está puesto.
void main() {
  SesionGuardada sesion({int expira = 0, String nombre = 'Ana'}) => SesionGuardada(
    token: 't0ken',
    usuarioId: 'u1',
    email: 'ana@ejemplo.test',
    nombre: nombre,
    expira: expira,
  );

  group('lo que se recuerda de una sesión', () {
    test('ida y vuelta por JSON conserva los cinco campos', () {
      final original = sesion(expira: 1735689600000);
      final vuelta = SesionGuardada.deJson(jsonEncode(original.aJson()));
      expect(vuelta, isNotNull);
      expect(vuelta!.token, original.token);
      expect(vuelta.usuarioId, original.usuarioId);
      expect(vuelta.email, original.email);
      expect(vuelta.nombre, original.nombre);
      expect(vuelta.expira, original.expira);
    });

    test('lo que no se entiende es «no hay sesión», no una excepción', () {
      // Lo que se está leyendo salió del almacén cifrado de una versión
      // anterior del APK. Un campo que cambió de nombre entre versiones no
      // puede tumbar el arranque: tiene que mandar a la pantalla de acceso.
      expect(SesionGuardada.deJson('{esto no es json'), isNull);
      expect(SesionGuardada.deJson('"una cadena suelta"'), isNull);
      expect(SesionGuardada.deJson('[]'), isNull);
      expect(SesionGuardada.deJson('{}'), isNull);
    });

    test('sin token no hay nada que recordar', () {
      expect(
        SesionGuardada.deJson('{"token":"","usuarioId":"u1","expira":1}'),
        isNull,
      );
      expect(
        SesionGuardada.deJson('{"usuarioId":"u1","expira":1}'),
        isNull,
      );
    });

    test('una caducidad que no es un número se rechaza entera', () {
      /*
        Podría parecer más amable quedarse con el token e ignorar la fecha,
        pero `sesionUtilizable` no sabría qué contestar y el arranque entraría
        con una sesión de vigencia desconocida. Rechazarla cuesta una
        contraseña; admitirla cuesta una pantalla que no carga.
      */
      expect(
        SesionGuardada.deJson('{"token":"t","usuarioId":"u1","expira":"pronto"}'),
        isNull,
      );
    });

    test('el perfil incompleto no invalida el token', () {
      // Una cuenta registrada sin nombre existe, y el correo puede faltar en
      // un almacén viejo. Ninguna de las dos cosas impide usar el token.
      final leida = SesionGuardada.deJson('{"token":"t","usuarioId":"u1","expira":9}');
      expect(leida, isNotNull);
      expect(leida!.email, '');
      expect(leida.nombre, '');
    });

    test('a quien no puso nombre se le llama por el correo', () {
      expect(sesion(nombre: 'Ana').comoLlamarle, 'Ana');
      expect(sesion(nombre: '   ').comoLlamarle, 'ana@ejemplo.test');
      expect(sesion(nombre: '').comoLlamarle, 'ana@ejemplo.test');
    });
  });

  group('cuándo un token guardado ya no sirve', () {
    final ahora = DateTime.utc(2026, 3, 1, 12);
    int enMinutos(int m) => ahora.add(Duration(minutes: m)).millisecondsSinceEpoch;

    test('con margen de sobra, vale', () {
      expect(sesionUtilizable(sesion(expira: enMinutos(60)), ahora), isTrue);
    });

    test('caducado hace rato, no', () {
      expect(sesionUtilizable(sesion(expira: enMinutos(-1)), ahora), isFalse);
    });

    test('a punto de caducar cuenta como caducado', () {
      /*
        La prueba del margen. Un token que vence dentro de un minuto
        técnicamente vale, y usarlo es pedir que la sesión se caiga a mitad de
        la primera pantalla: peor que la pantalla de acceso, porque el usuario
        ya ha visto la lista de proyectos y la pierde mientras la mira.
      */
      expect(sesionUtilizable(sesion(expira: enMinutos(1)), ahora), isFalse);
      expect(sesionUtilizable(sesion(expira: enMinutos(3)), ahora), isTrue);
    });

    test('el margen es el que dice la constante', () {
      // Atado a propósito: subirlo a horas pediría la contraseña a diario y
      // bajarlo a cero devolvería el fallo de arriba.
      expect(margenDeCaducidad, const Duration(minutes: 2));
    });
  });

  group('por dónde empieza la aplicación', () {
    final ahora = DateTime.utc(2026, 3, 1, 12);
    final viva = sesion(expira: ahora.add(const Duration(days: 30)).millisecondsSinceEpoch);
    final muerta = sesion(expira: ahora.subtract(const Duration(days: 1)).millisecondsSinceEpoch);

    test('sin nada guardado, el formulario', () {
      expect(
        pasoDeArranque(
          guardada: null,
          ahora: ahora,
          exigeHuella: false,
          aparatoPuedeHuella: true,
        ),
        PasoDeArranque.pedirCredenciales,
      );
    });

    test('con sesión viva y sin huella pedida, directo', () {
      expect(
        pasoDeArranque(
          guardada: viva,
          ahora: ahora,
          exigeHuella: false,
          aparatoPuedeHuella: true,
        ),
        PasoDeArranque.entrar,
      );
    });

    test('con huella pedida y sensor disponible, se pide la huella', () {
      expect(
        pasoDeArranque(
          guardada: viva,
          ahora: ahora,
          exigeHuella: true,
          aparatoPuedeHuella: true,
        ),
        PasoDeArranque.pedirHuella,
      );
    });

    test('con la huella pedida y el aparato sin poder darla, la contraseña', () {
      /*
        La prueba que define si esto es una protección o un adorno.

        El caso llega de verdad: se configura el desbloqueo, y semanas después
        se cambia el patrón de pantalla, se borran las huellas registradas o se
        estropea el sensor. La salida cómoda —entrar igual, «total, la sesión
        sigue guardada»— convierte la huella en algo que se quita sin querer y
        sin avisar. Pedir la contraseña no deja a nadie fuera: es la misma que
        sirvió para entrar la primera vez.
      */
      expect(
        pasoDeArranque(
          guardada: viva,
          ahora: ahora,
          exigeHuella: true,
          aparatoPuedeHuella: false,
        ),
        PasoDeArranque.pedirCredenciales,
      );
    });

    test('una sesión caducada no se desbloquea con la huella', () {
      // La huella protege una llave; no la revive. Pedirla aquí sería hacer
      // pasar por el sensor para acabar igualmente en el formulario.
      expect(
        pasoDeArranque(
          guardada: muerta,
          ahora: ahora,
          exigeHuella: true,
          aparatoPuedeHuella: true,
        ),
        PasoDeArranque.pedirCredenciales,
      );
    });
  });

  group('lo que se comprueba antes de llamar al servidor', () {
    test('el formulario vacío se dice aquí, no con un 401', () {
      // El servidor contesta «Credenciales incorrectas» a propósito, para que
      // nadie enumere cuentas. Aquí ese texto sería engañoso: nadie se ha
      // equivocado de contraseña, es que no ha puesto ninguna.
      expect(problemaDeCredenciales('', 'x'), 'Falta el correo.');
      expect(problemaDeCredenciales('   ', 'x'), 'Falta el correo.');
      expect(problemaDeCredenciales('a@b.c', ''), 'Falta la contraseña.');
    });

    test('con las dos cosas puestas no se estorba', () {
      expect(problemaDeCredenciales('a@b.c', 'secreta'), isNull);
    });

    test('un correo raro se manda igual: la autoridad es el servidor', () {
      // Las expresiones regulares de correo rechazan direcciones válidas, y
      // aquí no hay forma de saber si esa cuenta existe.
      expect(problemaDeCredenciales('no-parece-un-correo', 'secreta'), isNull);
    });
  });

  group('cómo se lee la respuesta del acceso', () {
    String cuerpoBueno({Object? expira = 1893456000000}) => jsonEncode({
      'usuario': {'id': 'u1', 'email': 'ana@ejemplo.test', 'displayName': 'Ana'},
      'token': 't0ken',
      'expira': expira,
    });

    test('un 200 con sesión entra', () {
      final r = interpretarAcceso(200, cuerpoBueno());
      expect(r, isA<AccesoLogrado>());
      final s = (r as AccesoLogrado).sesion;
      expect(s.token, 't0ken');
      expect(s.usuarioId, 'u1');
      expect(s.email, 'ana@ejemplo.test');
      expect(s.nombre, 'Ana');
      expect(s.expira, 1893456000000);
    });

    test('el 401 no distingue correo de contraseña, y aquí tampoco', () {
      final r = interpretarAcceso(401, '{"error":"Credenciales incorrectas"}');
      expect(r, isA<AccesoRechazado>());
      expect((r as AccesoRechazado).motivo, contains('no son correctos'));
    });

    test('el 429 se explica como lo que es: esperar', () {
      final r = interpretarAcceso(429, '');
      expect((r as AccesoRechazado).motivo, contains('Espere'));
    });

    test('un 5xx no culpa a quien escribe la contraseña', () {
      // Decirle «credenciales incorrectas» a alguien que las tiene bien le hace
      // probar otras diez veces contra un servidor que está caído.
      final r = interpretarAcceso(503, '<html>Bad Gateway</html>');
      expect((r as AccesoRechazado).motivo, contains('servidor'));
      expect(r.motivo, isNot(contains('contraseña')));
    });

    test('un código inesperado se enseña con su número', () {
      // Un 404 aquí significa que la dirección no apunta a esta herramienta, y
      // el número es lo único que permite deducirlo desde el teléfono.
      final r = interpretarAcceso(404, '');
      expect((r as AccesoRechazado).motivo, contains('404'));
    });

    test('un 200 con HTML no se convierte en una sesión', () {
      /*
        El portal cautivo: el wifi que contesta su propia página de acceso a
        todo, con un 200 limpio. Darlo por bueno guardaría cifrado en el
        Keystore un trozo de HTML como si fuera un token. El síntoma sería una
        sesión que existe, sobrevive al reinicio y falla en cada petición sin
        que nada diga por qué.
      */
      final r = interpretarAcceso(200, '<!DOCTYPE html><title>Conéctese</title>');
      expect(r, isA<AccesoRechazado>());
      expect((r as AccesoRechazado).motivo, contains('no se entiende'));
    });

    test('un 200 con JSON que no es un objeto tampoco', () {
      expect(interpretarAcceso(200, '[]'), isA<AccesoRechazado>());
      expect(interpretarAcceso(200, '"vale"'), isA<AccesoRechazado>());
    });

    test('un 200 sin token no es un acceso', () {
      final sinToken = interpretarAcceso(200, jsonEncode({'usuario': {'id': 'u1'}}));
      expect((sinToken as AccesoRechazado).motivo, contains('ninguna sesión'));

      final vacio = interpretarAcceso(
        200,
        jsonEncode({'token': '', 'usuario': {'id': 'u1'}}),
      );
      expect(vacio, isA<AccesoRechazado>());
    });

    test('un 200 sin usuario con identificador no es un acceso', () {
      // Sin `id` no hay a quién atribuir lo que se edite, y el editor lo usa
      // para firmar los cambios en el documento compartido.
      expect(
        interpretarAcceso(200, jsonEncode({'token': 't', 'usuario': {'email': 'a@b.c'}})),
        isA<AccesoRechazado>(),
      );
      expect(
        interpretarAcceso(200, jsonEncode({'token': 't', 'usuario': 'u1'})),
        isA<AccesoRechazado>(),
      );
    });

    test('sin fecha de caducidad se entra, pero no se finge que dura', () {
      /*
        La autoridad sobre la caducidad es el servidor, que contestará 401
        cuando toque, así que una respuesta sin `expira` no puede impedir
        entrar. Lo que no se puede hacer es inventarse una fecha lejana: el
        arranque siguiente sin cobertura daría por buena una sesión muerta y
        llevaría a una lista de proyectos que nunca carga. Se guarda una fecha
        ya pasada, y el fallo se degrada a pedir la contraseña.
      */
      final r = interpretarAcceso(200, cuerpoBueno(expira: null));
      expect(r, isA<AccesoLogrado>());
      final s = (r as AccesoLogrado).sesion;
      expect(s.expira, 0);
      expect(sesionUtilizable(s, DateTime.now()), isFalse);
    });

    test('el 201 vale igual que el 200', () {
      expect(interpretarAcceso(201, cuerpoBueno()), isA<AccesoLogrado>());
    });

    test('un perfil sin nombre entra con el nombre en blanco', () {
      final r = interpretarAcceso(
        200,
        jsonEncode({'token': 't', 'usuario': {'id': 'u1'}}),
      );
      expect(r, isA<AccesoLogrado>());
      expect((r as AccesoLogrado).sesion.nombre, '');
      expect(r.sesion.email, '');
    });
  });
}
