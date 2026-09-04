import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/cliente_rest.dart';
import 'package:uml_movil/asistente/pantalla_asistente.dart';
import 'package:uml_movil/asistente/pantalla_ficha.dart';
import 'package:uml_movil/asistente/pantalla_lista.dart';
import 'package:uml_movil/asistente/sesion.dart';

import 'fixture_tienda.dart';
import 'motor_falso.dart';

/// El asistente de punta a punta: frase escrita → HTTP de verdad.
///
/// `gramatica_test.dart` ya comprueba que la frase se entiende. Lo que se
/// comprueba aquí es lo otro, que es lo que puede salir caro: que entre
/// entenderla y ejecutarla haya una parada cuando toca. Un listado se abre sin
/// preguntar; un borrado enseña qué arrastra y espera; una orden a medias no se
/// manda y tampoco se tira, sino que abre la ficha con lo entendido dentro.
///
/// Ninguna de estas pruebas menciona un widget escrito para «tienda»: lo que se
/// busca en pantalla son las palabras que el manifiesto publicó.

class _Servidor {
  _Servidor(this._servidor) {
    _servidor.listen((peticion) async {
      final cuerpo = await utf8.decoder.bind(peticion).join();
      final respuesta = peticion.response;
      // Ver la nota larga en `pantalla_ficha_test.dart`: sin esto, la reserva
      // de conexiones de `HttpClient` deja un temporizador vivo dentro del
      // reloj falso y la prueba muere por un motivo que no es el suyo.
      respuesta.persistentConnection = false;

      final ruta = peticion.uri.path;
      peticiones.add('${peticion.method} $ruta');
      final clave = peticion.headers.value('idempotency-key');
      if (clave != null) claves['${peticion.method} $ruta'] = clave;

      if (ruta == rutaManifiesto) {
        respuesta.headers
          ..set('etag', '"v1"')
          ..contentType = ContentType.json;
        respuesta.write(manifiestoTienda);
        await respuesta.close();
        return;
      }

      if (peticion.method == 'DELETE') {
        borrados.add(ruta);
        respuesta.statusCode = 204;
        await respuesta.close();
        return;
      }

      if (peticion.method == 'POST') {
        creados.add(cuerpo);
        respuesta.statusCode = 201;
        respuesta.headers.contentType = ContentType.json;
        respuesta.write(jsonEncode({'id': 99, 'nombre': 'Herramientas'}));
        await respuesta.close();
        return;
      }

      // GET de un registro suelto: la ruta termina en número.
      final unico = RegExp(r'/(\d+)$').firstMatch(ruta);
      respuesta.headers.contentType = ContentType.json;
      if (unico != null) {
        if (faltaElRegistro) {
          respuesta.statusCode = 404;
          respuesta.write(jsonEncode({'status': 404, 'message': 'No existe'}));
        } else {
          respuesta.write(jsonEncode({
            'id': int.parse(unico.group(1)!),
            'nombre': 'Ana Pérez',
            'email': 'ana@example.com',
            'estado': 'BORRADOR',
          }));
        }
        await respuesta.close();
        return;
      }

      respuesta.write(jsonEncode({
        'content': listado,
        'totalElements': listado.length,
        'number': 0,
        'size': 100,
      }));
      await respuesta.close();
    });
  }

  final HttpServer _servidor;
  final List<String> peticiones = <String>[];
  final List<String> creados = <String>[];
  final List<String> borrados = <String>[];
  final Map<String, String> claves = <String, String>{};

  bool faltaElRegistro = false;
  List<Map<String, dynamic>> listado = [
    {'id': 1, 'nombre': 'Ana Pérez', 'email': 'ana@example.com'},
    {'id': 2, 'nombre': 'Beto Ruiz', 'email': 'beto@example.com'},
  ];

  String get url => 'http://localhost:${_servidor.port}';

  static Future<_Servidor> levantar() async =>
      _Servidor(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  Future<void> cerrar() => _servidor.close(force: true);
}

void main() {
  late _Servidor servidor;
  late Sesion sesion;

  setUp(() async {
    HttpOverrides.global = null;
    servidor = await _Servidor.levantar();
    sesion = Sesion();
    final conectada = await sesion.conectar(servidor.url);
    expect(conectada, isTrue, reason: sesion.error ?? 'no conectó');
  });

  tearDown(() async {
    sesion.dispose();
    await servidor.cerrar();
  });

  late MotorFalso microfono;

  Future<void> abrir(WidgetTester probador) async {
    microfono = MotorFalso();
    await probador.pumpWidget(MaterialApp(
      home: PantallaAsistente(sesion: sesion, motor: microfono),
    ));
    await probador.pumpAndSettle();
  }

  Future<void> dejarPasarLaRed(WidgetTester probador) async {
    for (var vuelta = 0; vuelta < 25; vuelta++) {
      await probador.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await probador.pump();
    }
    await probador.pumpAndSettle();
  }

  Future<void> decir(WidgetTester probador, String frase) async {
    await probador.enterText(find.byType(TextField), frase);
    await probador.testTextInput.receiveAction(TextInputAction.send);
    await probador.pumpAndSettle();
  }

  Future<void> adelante(WidgetTester probador) async {
    await probador.tap(find.text('Adelante'));
    await dejarPasarLaRed(probador);
  }

  group('lo primero que ve alguien que nunca lo ha usado', () {
    testWidgets('los ejemplos salen del manifiesto, no del código',
        (probador) async {
      await abrir(probador);
      // Si estas frases estuvieran escritas a mano, contra el backend de una
      // barbería seguirían diciendo «clientes».
      expect(find.text('muéstrame los clientes'), findsOneWidget);
      expect(find.text('muéstrame los pedidos'), findsOneWidget);
      expect(find.text('nuevo cliente con nombre ...'), findsOneWidget);
      expect(find.textContaining('Tienda'), findsWidgets);
    });

    testWidgets('preguntar qué puede hacer no propone ninguna acción',
        (probador) async {
      await abrir(probador);
      await probador.tap(find.text('¿qué puedes hacer?'));
      await probador.pumpAndSettle();

      expect(find.textContaining('Puedo listar, abrir, crear'), findsOneWidget);
      // Una pregunta no es una orden: no puede quedar un botón de ejecutar.
      expect(find.text('Adelante'), findsNothing);
    });

    testWidgets('una frase que no dice nada se contesta con el repertorio',
        (probador) async {
      await abrir(probador);
      await decir(probador, 'hola qué tal');

      expect(find.text('Adelante'), findsNothing);
      expect(find.textContaining('No sé de qué me hablas'), findsOneWidget);
    });
  });

  group('lo reversible se hace; lo irreversible se avisa', () {
    testWidgets('pedir una lista la abre sin más preguntas', (probador) async {
      await abrir(probador);
      await decir(probador, 'muéstrame los clientes');

      expect(find.text('Abro la lista de clientes.'), findsWidgets);
      await adelante(probador);

      expect(find.byType(PantallaLista), findsOneWidget);
      expect(servidor.peticiones, contains('GET /api/clientes'));
    });

    testWidgets('antes de borrar se dice qué se lleva por delante',
        (probador) async {
      await abrir(probador);
      // Pedido declara `borradoEnCascada: ["LineaPedido"]`. Eso sale del
      // rombo relleno de la composición y no hay forma de deducirlo del REST:
      // es justo lo que el manifiesto aporta sobre una OpenAPI.
      await decir(probador, 'borra el pedido 7');

      expect(find.text('También desaparecerán sus linea pedidos.'),
          findsOneWidget);

      await adelante(probador);
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(find.textContaining('Borro pedido número 7'), findsWidgets);
      expect(servidor.borrados, isEmpty);
    });

    testWidgets('cancelar el diálogo no borra nada', (probador) async {
      await abrir(probador);
      await decir(probador, 'borra el pedido 7');
      await adelante(probador);

      await probador.tap(find.text('Cancelar'));
      await dejarPasarLaRed(probador);

      expect(servidor.borrados, isEmpty);
      expect(find.text('Cancelado.'), findsOneWidget);
    });

    testWidgets('confirmar borra, y el DELETE viaja con su clave',
        (probador) async {
      await abrir(probador);
      await decir(probador, 'borra el pedido 7');
      await adelante(probador);

      await probador.tap(find.text('Sí, adelante'));
      await dejarPasarLaRed(probador);

      expect(servidor.borrados, ['/api/pedidos/7']);
      final clave = servidor.claves['DELETE /api/pedidos/7'];
      expect(clave, isNotNull);
      expect(clave, startsWith('borrar-'));
      expect(RegExp(r'^[A-Za-z0-9_.:-]{8,120}$').hasMatch(clave!), isTrue);
    });

    testWidgets('un número que no existe se dice con las palabras del dominio',
        (probador) async {
      servidor.faltaElRegistro = true;
      await abrir(probador);
      await decir(probador, 'borra el pedido 7');
      await adelante(probador);

      expect(find.text('No hay pedido con el número 7.'), findsOneWidget);
      expect(servidor.borrados, isEmpty);
    });

    testWidgets('con dos que encajan se pregunta cuál, no se elige el primero',
        (probador) async {
      // Quedarse con el primero sería borrar al cliente equivocado sin que
      // nadie llegase a enterarse.
      servidor.listado = [
        {'id': 1, 'nombre': 'Ana Pérez', 'email': 'ana@example.com'},
        {'id': 5, 'nombre': 'Ana Gómez', 'email': 'anag@example.com'},
      ];
      await abrir(probador);
      await decir(probador, 'borra el cliente Ana');
      await adelante(probador);

      expect(find.byType(SimpleDialog), findsOneWidget);
      expect(find.text('Ana Pérez  (#1)'), findsOneWidget);
      expect(find.text('Ana Gómez  (#5)'), findsOneWidget);
      expect(servidor.borrados, isEmpty);
    });
  });

  group('un alta a medias abre la ficha en vez de rechazarla', () {
    testWidgets('lo dictado llega puesto y el foco queda en lo que falta',
        (probador) async {
      await abrir(probador);
      // Falta el email, que es obligatorio. Obligar a repetir la frase entera
      // por un dato que no se dijo es la forma más rápida de que nadie vuelva
      // a usar el dictado.
      await decir(probador, 'nuevo cliente Ana Pérez');

      expect(find.textContaining('Falta email'), findsOneWidget);
      await adelante(probador);

      expect(find.byType(PantallaFicha), findsOneWidget);
      expect(find.text('Nuevo cliente'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Ana Pérez'), findsOneWidget);
      // Nada se ha mandado todavía: la ficha está para completarla.
      expect(servidor.creados, isEmpty);
    });

    testWidgets('una orden completa se manda sola y se confirma con su nombre',
        (probador) async {
      await abrir(probador);
      await decir(probador, 'crea una categoria Herramientas');
      await adelante(probador);

      expect(servidor.creados, hasLength(1));
      expect(jsonDecode(servidor.creados.single), {'nombre': 'Herramientas'});
      expect(find.text('Hecho: Herramientas.'), findsOneWidget);

      final clave = servidor.claves['POST /api/categorias'];
      expect(clave, startsWith('alta-'));
    });

    testWidgets('la clave del dictado es la que acaba viajando en el POST',
        (probador) async {
      // Esta es la prueba que sostiene todo el modo sin conexión. La clave se
      // fija al dictar, no al enviar: si la ficha generase una nueva, el
      // reintento de un dictado que quizá ya llegó crearía un segundo registro.
      await abrir(probador);
      await decir(probador, 'nuevo cliente Ana Pérez');
      await adelante(probador);

      await probador.enterText(
          find.widgetWithText(TextFormField, 'email *'), 'ana@example.com');
      await probador.tap(find.text('Guardar'));
      await dejarPasarLaRed(probador);

      expect(servidor.creados, hasLength(1));
      expect(jsonDecode(servidor.creados.single), containsPair('nombre', 'Ana Pérez'));

      // El cuerpo cambió al escribir el email, así que la clave se renovó: eso
      // ya es otra orden. Lo que se comprueba es que sigue habiendo una y que
      // es del alta, no que sea idéntica a la del dictado.
      final clave = servidor.claves['POST /api/clientes'];
      expect(clave, isNotNull);
      expect(clave, startsWith('alta-'));
    });
  });

  group('sin tocar la pantalla', () {
    /// Enciende el micrófono y dicta una frase entera.
    Future<void> dictar(WidgetTester probador, String frase) async {
      await probador.tap(find.byTooltip('Hablar'));
      await probador.pumpAndSettle();
      microfono.oye(frase);
      await dejarPasarLaRed(probador);
    }

    testWidgets('lo que se lleva oído se ve mientras se habla',
        (probador) async {
      await abrir(probador);
      await probador.tap(find.byTooltip('Hablar'));
      await probador.pumpAndSettle();

      microfono.oyeAMedias('muéstrame los cli');
      await probador.pumpAndSettle();

      expect(find.text('muéstrame los cli'), findsOneWidget);
      // Y el botón ya no ofrece hablar, sino parar.
      expect(find.byTooltip('Parar'), findsOneWidget);
    });

    testWidgets('lo dictado se lee en voz alta y se pregunta si hacerlo',
        (probador) async {
      await abrir(probador);
      await dictar(probador, 'muéstrame los clientes');

      expect(microfono.dicho, hasLength(1));
      expect(microfono.dicho.single, contains('Abro la lista de clientes.'));
      expect(microfono.dicho.single, contains('¿Lo hago?'));
    });

    testWidgets('tras preguntar se vuelve a abrir el micrófono solo',
        (probador) async {
      // Es la única escucha automática de toda la app, y sin ella la demo se
      // rompe justo en el momento que la justifica: hay una pregunta en el
      // aire y habría que tocar la pantalla para contestarla.
      await abrir(probador);
      await dictar(probador, 'muéstrame los clientes');

      expect(microfono.escuchas, 2);
      expect(find.byTooltip('Parar'), findsOneWidget);
    });

    testWidgets('escribir no hace hablar al teléfono', (probador) async {
      // A quien escribe no se le lee la respuesta: sería una sorpresa ruidosa,
      // y en una defensa, encima del profesor.
      await abrir(probador);
      await decir(probador, 'muéstrame los clientes');

      expect(microfono.dicho, isEmpty);
      expect(microfono.escuchas, 0);
    });

    testWidgets('un «sí» dictado ejecuta la propuesta', (probador) async {
      await abrir(probador);
      await dictar(probador, 'muéstrame los clientes');
      microfono.oye('sí');
      await dejarPasarLaRed(probador);

      expect(find.byType(PantallaLista), findsOneWidget);
      expect(servidor.peticiones, contains('GET /api/clientes'));
    });

    testWidgets('un «no» dictado la descarta', (probador) async {
      await abrir(probador);
      await dictar(probador, 'muéstrame los clientes');
      microfono.oye('déjalo');
      await dejarPasarLaRed(probador);

      expect(find.byType(PantallaLista), findsNothing);
      expect(find.text('Adelante'), findsNothing);
      expect(microfono.dicho.last, 'Vale, lo dejo.');
    });

    testWidgets('rectificar hablando sustituye la propuesta, no la ejecuta',
        (probador) async {
      // Quien se explica mal no dice «no»: vuelve a decirlo de otra manera.
      await abrir(probador);
      await dictar(probador, 'muéstrame los clientes');
      microfono.oye('muéstrame los productos');
      await dejarPasarLaRed(probador);

      expect(find.text('Abro la lista de productos.'), findsWidgets);
      expect(servidor.peticiones, isNot(contains('GET /api/clientes')));
    });

    testWidgets('un borrado entero sin tocar la pantalla', (probador) async {
      // La prueba que sostiene «como si fuera Alexa»: cuatro frases y ningún
      // toque más allá del primero para abrir el micrófono. Y aun así, el aviso
      // de qué se lleva por delante se dice antes de tocar la base de datos.
      await abrir(probador);
      await dictar(probador, 'borra el pedido 7');

      expect(microfono.dicho.last, contains('También desaparecerán sus linea pedidos.'));

      microfono.oye('sí');
      await dejarPasarLaRed(probador);

      // La segunda pregunta va contra el registro ya traído, no contra el
      // número que se dijo.
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(microfono.dicho.last, contains('¿Lo confirmas?'));
      expect(servidor.borrados, isEmpty);

      microfono.oye('adelante');
      await dejarPasarLaRed(probador);

      expect(servidor.borrados, ['/api/pedidos/7']);
      expect(microfono.dicho.last, contains('Borrado'));
    });

    testWidgets('cancelar hablando en el segundo aviso no borra nada',
        (probador) async {
      await abrir(probador);
      await dictar(probador, 'borra el pedido 7');
      microfono.oye('sí');
      await dejarPasarLaRed(probador);

      microfono.oye('mejor no');
      await dejarPasarLaRed(probador);

      expect(servidor.borrados, isEmpty);
      expect(find.byType(AlertDialog), findsNothing);
      expect(microfono.dicho.last, 'Cancelado.');
    });

    testWidgets('lo que no es ni sí ni no se vuelve a preguntar',
        (probador) async {
      await abrir(probador);
      await dictar(probador, 'borra el pedido 7');
      microfono.oye('sí');
      await dejarPasarLaRed(probador);

      microfono.oye('pues no sé');
      await dejarPasarLaRed(probador);

      // Ni se borra ni se cierra el diálogo: se insiste.
      expect(servidor.borrados, isEmpty);
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(microfono.dicho.last, 'Dime sí o no.');
    });

    testWidgets('la orden del barbero, dictada y confirmada de viva voz',
        (probador) async {
      await abrir(probador);
      await dictar(probador, 'crea una categoria Herramientas');
      microfono.oye('vale');
      await dejarPasarLaRed(probador);

      expect(jsonDecode(servidor.creados.single), {'nombre': 'Herramientas'});
      expect(microfono.dicho.last, 'Hecho: Herramientas.');
    });

    testWidgets('un fallo del micrófono se cuenta con lo que hay que hacer',
        (probador) async {
      await abrir(probador);
      await probador.tap(find.byTooltip('Hablar'));
      await probador.pumpAndSettle();

      microfono.falla('error_language_unavailable');
      await probador.pumpAndSettle();

      // Las tres cosas: qué pasó, cómo seguir ahora, y cómo arreglarlo.
      expect(find.textContaining('no tiene el español descargado'),
          findsOneWidget);
      expect(find.textContaining('saldrá a internet'), findsOneWidget);
      expect(find.textContaining('Ajustes'), findsOneWidget);
    });
  });

  group('cambiar un dato', () {
    testWidgets('un cambio dictado abre la ficha con el valor nuevo dentro',
        (probador) async {
      await abrir(probador);
      await decir(probador, 'cambia el email del cliente 4 a nuevo@ejemplo.com');
      await adelante(probador);

      expect(find.byType(PantallaFicha), findsOneWidget);
      expect(find.text('Editar cliente'), findsOneWidget);
      // El nombre viene del servidor; el email, de lo dictado.
      expect(find.widgetWithText(TextFormField, 'Ana Pérez'), findsOneWidget);
      expect(
        find.widgetWithText(TextFormField, 'nuevo@ejemplo.com'),
        findsOneWidget,
      );
      expect(servidor.peticiones, contains('GET /api/clientes/4'));
    });
  });
}
