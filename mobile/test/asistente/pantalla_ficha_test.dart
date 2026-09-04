import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/cliente_rest.dart';
import 'package:uml_movil/asistente/pantalla_ficha.dart';
import 'package:uml_movil/asistente/sesion.dart';

import 'fixture_tienda.dart';

/// Estas pruebas son las que sostienen la afirmación del proyecto: que hay
/// **una sola app** para todos los backends generados. Si el formulario
/// estuviera escrito a mano para «tienda», pasarían igual; lo que las hace
/// valer es que ninguna menciona un widget colocado por nosotros, sino el que
/// corresponde al `tipo` que declara el manifiesto. Cambiar el diagrama y
/// regenerar tiene que cambiar la pantalla sin tocar Dart.

class _Servidor {
  _Servidor(this._servidor) {
    _servidor.listen((peticion) async {
      final cuerpo = await utf8.decoder.bind(peticion).join();
      final respuesta = peticion.response;

      // Cada respuesta cierra su conexión. No es un capricho: `HttpClient`
      // guarda las conexiones vivas en una reserva con un temporizador de
      // inactividad, y ese temporizador nace dentro del reloj falso de
      // `testWidgets`. Al terminar la prueba sigue pendiente y el marco la da
      // por fallida con «A Timer is still pending», que no tiene nada que ver
      // con lo que se estaba comprobando. Cerrar la conexión —HTTP perfectamente
      // legítimo— evita la reserva y con ella el temporizador.
      respuesta.persistentConnection = false;

      if (peticion.uri.path == rutaManifiesto) {
        respuesta.headers
          ..set('etag', '"v1"')
          ..contentType = ContentType.json;
        respuesta.write(manifiestoTienda);
        await respuesta.close();
        return;
      }

      if (peticion.method == 'POST') {
        creados.add(cuerpo);
        clavesRecibidas.add(peticion.headers.value('idempotency-key'));
        respuesta.statusCode = estadoAlCrear;
        respuesta.headers.contentType = ContentType.json;
        respuesta.write(jsonEncode(respuestaAlCrear));
        await respuesta.close();
        return;
      }

      // Listados: el selector de referencia los usa para ofrecer opciones.
      respuesta.headers.contentType = ContentType.json;
      respuesta.write(jsonEncode({
        'content': [
          {'id': 1, 'nombre': 'Ana Pérez'},
          {'id': 2, 'nombre': 'Beto Ruiz'},
        ],
        'totalElements': 2,
        'number': 0,
        'size': 100,
      }));
      await respuesta.close();
    });
  }

  final HttpServer _servidor;
  final List<String> creados = <String>[];
  final List<String?> clavesRecibidas = <String?>[];
  int estadoAlCrear = 201;
  Map<String, dynamic> respuestaAlCrear = {'id': 99};

  String get url => 'http://localhost:${_servidor.port}';

  static Future<_Servidor> levantar() async =>
      _Servidor(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  Future<void> cerrar() => _servidor.close(force: true);
}

void main() {
  late _Servidor servidor;
  late Sesion sesion;

  setUp(() async {
    // `testWidgets` sustituye `HttpClient` por un simulacro que responde 400 a
    // todo, para que una prueba no salga a internet sin querer. Aquí el
    // servidor es de esta misma máquina y de este mismo proceso, y es
    // justamente lo que se quiere ejercitar: el formulario contra HTTP de
    // verdad. Sin esta línea todas las pruebas fallan al conectar y el motivo
    // no aparece por ningún lado.
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

  Future<void> abrir(
    WidgetTester probador,
    String entidad, {
    Map<String, dynamic>? registro,
  }) async {
    await probador.pumpWidget(MaterialApp(
      home: PantallaFicha(
        sesion: sesion,
        entidad: sesion.manifiesto!.entidadPorNombre(entidad)!,
        registro: registro,
      ),
    ));
    await probador.pumpAndSettle();
  }

  /// Deja que una petición de verdad salga, llegue y vuelva.
  ///
  /// `testWidgets` corre sobre un reloj falso. `pump` adelanta ese reloj y
  /// vacía la cola de callbacks que quedaron dentro de él; `runAsync` es lo
  /// único que devuelve el control al bucle de eventos de verdad, que es donde
  /// vive el socket. Una petición HTTP no es un paso sino varios —conectar,
  /// mandar cabeceras, mandar el cuerpo, leer la respuesta— y cada uno necesita
  /// una vuelta de cada lado. Por eso hay que alternarlos: un solo `runAsync`
  /// largo no basta, y comprobarlo costó una tanda entera de fallos que decían
  /// «no se envió nada» cuando lo cierto era «se envió a medias».
  Future<void> dejarPasarLaRed(WidgetTester probador) async {
    for (var vuelta = 0; vuelta < 25; vuelta++) {
      await probador.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 20)),
      );
      await probador.pump();
    }
    await probador.pumpAndSettle();
  }

  Future<void> guardar(WidgetTester probador) async {
    await probador.tap(find.text('Guardar'));
    await dejarPasarLaRed(probador);
  }

  group('el formulario lo dibuja el manifiesto', () {
    testWidgets('un booleano sale como interruptor, no como caja de texto',
        (probador) async {
      await abrir(probador, 'Producto');
      // Producto: nombre, sku, precio (texto) + activo (booleano).
      expect(find.byType(SwitchListTile), findsOneWidget);
      expect(find.text('activo'), findsOneWidget);
      expect(find.byType(TextFormField), findsNWidgets(3));
    });

    testWidgets('un enumerado sale como desplegable con su lista cerrada',
        (probador) async {
      await abrir(probador, 'Pedido');
      final desplegable = find.byType(DropdownButtonFormField<String>);
      expect(desplegable, findsOneWidget);

      await probador.tap(desplegable);
      await probador.pumpAndSettle();
      for (final valor in ['BORRADOR', 'CONFIRMADO', 'ENVIADO', 'ENTREGADO', 'CANCELADO']) {
        expect(find.text(valor), findsWidgets, reason: valor);
      }
    });

    testWidgets('los obligatorios se marcan y los opcionales no',
        (probador) async {
      await abrir(probador, 'Cliente');
      expect(find.text('nombre *'), findsOneWidget);
      expect(find.text('email *'), findsOneWidget);
      // `fechaAlta` es la única nullable del diagrama.
      expect(find.text('fecha alta'), findsOneWidget);
      expect(find.text('fecha alta *'), findsNothing);
    });

    testWidgets('la etiqueta es la del manifiesto, no el nombre del campo Java',
        (probador) async {
      await abrir(probador, 'LineaPedido');
      expect(find.text('precio unitario *'), findsOneWidget);
      expect(find.text('precioUnitario *'), findsNothing);
    });

    testWidgets('el título dice el singular con el que se habla de la entidad',
        (probador) async {
      await abrir(probador, 'LineaPedido');
      expect(find.text('Nuevo linea pedido'), findsOneWidget);
    });

    testWidgets('editar precarga los valores que vinieron del servidor',
        (probador) async {
      await abrir(probador, 'Cliente', registro: {
        'id': 3,
        'nombre': 'Ana Pérez',
        'email': 'ana@example.com',
        'fechaAlta': '2026-01-15',
      });
      expect(find.text('Editar cliente'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, 'Ana Pérez'), findsOneWidget);
      expect(find.widgetWithText(TextFormField, '2026-01-15'), findsOneWidget);
    });
  });

  group('lo que se envía', () {
    testWidgets('un obligatorio vacío no llega a salir de la app',
        (probador) async {
      await abrir(probador, 'Categoria');
      await guardar(probador);

      expect(servidor.creados, isEmpty);
      expect(find.text('Hace falta nombre'), findsOneWidget);
    });

    testWidgets('el cuerpo lleva los tipos convertidos, no el texto tecleado',
        (probador) async {
      await abrir(probador, 'Producto');
      await probador.enterText(find.widgetWithText(TextFormField, 'nombre *'), 'Taburete');
      await probador.enterText(find.widgetWithText(TextFormField, 'sku *'), 'TAB-1');
      await probador.enterText(find.widgetWithText(TextFormField, 'precio *'), '19,99');
      await probador.tap(find.byType(SwitchListTile));
      await probador.pumpAndSettle();

      await guardar(probador);

      expect(servidor.creados, hasLength(1));
      // La coma se enseña porque es como se escribe en español; al servidor
      // llega el número, que es lo que acepta un BigDecimal en JSON.
      expect(jsonDecode(servidor.creados.single), {
        'nombre': 'Taburete',
        'sku': 'TAB-1',
        'precio': 19.99,
        'activo': true,
      });
    });

    testWidgets('cada alta viaja con su clave de idempotencia', (probador) async {
      await abrir(probador, 'Categoria');
      await probador.enterText(find.byType(TextFormField).first, 'Herramientas');
      await guardar(probador);

      final clave = servidor.clavesRecibidas.single;
      expect(clave, isNotNull);
      expect(RegExp(r'^[A-Za-z0-9_.:-]{8,120}$').hasMatch(clave!), isTrue);
      expect(clave, startsWith('alta-'));
    });

    testWidgets('reintentar lo mismo conserva la clave; cambiarlo la renueva',
        (probador) async {
      // Es la regla entera de la idempotencia en dos líneas: una clave
      // identifica una orden concreta. Reintentar la misma orden tiene que
      // reusarla —si no, el reenvío duplicaría—; corregir el texto y volver a
      // guardar es otra orden y necesita otra.
      servidor.estadoAlCrear = 503;
      servidor.respuestaAlCrear = {'status': 503, 'message': 'No disponible'};

      await abrir(probador, 'Categoria');
      await probador.enterText(find.byType(TextFormField).first, 'Herramientas');
      await guardar(probador);
      await guardar(probador);

      expect(servidor.clavesRecibidas, hasLength(2));
      expect(servidor.clavesRecibidas[0], servidor.clavesRecibidas[1]);

      await probador.enterText(find.byType(TextFormField).first, 'Herrajes');
      await guardar(probador);

      expect(servidor.clavesRecibidas, hasLength(3));
      expect(servidor.clavesRecibidas[2], isNot(servidor.clavesRecibidas[0]));
    });

    testWidgets('un 400 del servidor se pinta debajo del campo culpable',
        (probador) async {
      servidor.estadoAlCrear = 400;
      servidor.respuestaAlCrear = {
        'status': 400,
        'message': 'Validación fallida',
        'fieldErrors': {'email': 'ya existe un cliente con ese email'},
      };

      await abrir(probador, 'Cliente');
      await probador.enterText(find.widgetWithText(TextFormField, 'nombre *'), 'Ana');
      await probador.enterText(
          find.widgetWithText(TextFormField, 'email *'), 'ana@example.com');
      await guardar(probador);

      expect(find.text('ya existe un cliente con ese email'), findsOneWidget);
    });
  });

  group('las asociaciones se eligen, no se teclean', () {
    testWidgets('la referencia ofrece los registros de la entidad apuntada',
        (probador) async {
      await abrir(probador, 'Pedido');
      // El campo se llama `clienteId` en el DTO, pero en pantalla dice
      // «cliente»: pedirle a alguien que escriba «17» sería trasladarle un
      // detalle de la base de datos.
      expect(find.text('cliente *'), findsOneWidget);
      expect(find.text('Sin elegir'), findsOneWidget);

      await probador.tap(find.text('Sin elegir'));
      // La hoja se abre enseguida, pero su lista sale de un GET: hay que
      // dejarla volver antes de buscar los nombres.
      await dejarPasarLaRed(probador);

      expect(find.text('Elegir cliente'), findsOneWidget);
      expect(find.text('Ana Pérez'), findsOneWidget);

      await probador.tap(find.text('Beto Ruiz'));
      await probador.pumpAndSettle();

      // Se enseña el nombre y se guarda el número.
      expect(find.text('Beto Ruiz  (#2)'), findsOneWidget);
    });
  });
}
