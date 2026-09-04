import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/cliente_rest.dart';
import 'package:uml_movil/asistente/manifiesto.dart';

import 'fixture_tienda.dart';

/// Servidor de mentira, pero HTTP de verdad.
///
/// Levantar un `HttpServer` en el propio proceso de prueba cuesta poco y da
/// mucho más que un cliente simulado: se ejercitan las cabeceras reales, los
/// códigos reales y la decodificación real del cuerpo. Un doble en memoria
/// habría dado por buenas cosas que sobre un socket no lo son.
class _ServidorFalso {
  _ServidorFalso(this._servidor) {
    _servidor.listen(_atender);
  }

  final HttpServer _servidor;

  /// Lo que ha recibido, para poder afirmar sobre las cabeceras que se mandan.
  final List<_Recibida> recibidas = <_Recibida>[];

  /// Respuesta programada para la siguiente petición que no sea el manifiesto.
  int estado = 200;
  Object? cuerpo;
  String etag = '"abc123"';

  /// Lo que se sirve en `/asistente/manifiesto`. Se puede sustituir para
  /// comprobar qué hace el cliente ante un documento que no debería aceptar.
  String documento = manifiestoTienda;

  Uri get base => Uri.parse('http://localhost:${_servidor.port}');

  static Future<_ServidorFalso> levantar() async =>
      _ServidorFalso(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  Future<void> cerrar() => _servidor.close(force: true);

  Future<void> _atender(HttpRequest peticion) async {
    final cuerpoPeticion = await utf8.decoder.bind(peticion).join();
    recibidas.add(_Recibida(
      metodo: peticion.method,
      ruta: '${peticion.uri}',
      cabeceras: {
        for (final nombre in const ['idempotency-key', 'if-none-match', 'accept'])
          if (peticion.headers.value(nombre) != null)
            nombre: peticion.headers.value(nombre)!,
      },
      cuerpo: cuerpoPeticion,
    ));

    final respuesta = peticion.response;

    if (peticion.uri.path == rutaManifiesto) {
      respuesta.headers.set('etag', etag);
      if (peticion.headers.value('if-none-match') == etag) {
        respuesta.statusCode = HttpStatus.notModified;
        await respuesta.close();
        return;
      }
      respuesta.headers.contentType = ContentType.json;
      respuesta.write(documento);
      await respuesta.close();
      return;
    }

    respuesta.statusCode = estado;
    if (cuerpo != null) {
      respuesta.headers.contentType = ContentType.json;
      respuesta.write(jsonEncode(cuerpo));
    }
    await respuesta.close();
  }
}

class _Recibida {
  const _Recibida({
    required this.metodo,
    required this.ruta,
    required this.cabeceras,
    required this.cuerpo,
  });

  final String metodo;
  final String ruta;
  final Map<String, String> cabeceras;
  final String cuerpo;
}

void main() {
  late _ServidorFalso servidor;
  late ClienteRest cliente;
  late Manifiesto manifiesto;

  setUp(() async {
    servidor = await _ServidorFalso.levantar();
    cliente = ClienteRest(servidor.base);
    manifiesto = (await cliente.descargarManifiesto()).manifiesto!;
    servidor.recibidas.clear();
  });

  tearDown(() async {
    cliente.cerrar();
    await servidor.cerrar();
  });

  group('el manifiesto', () {
    test('se pide en la ruta fija que publica todo backend generado', () async {
      final otro = ClienteRest(servidor.base);
      await otro.descargarManifiesto();
      expect(servidor.recibidas.single.ruta, rutaManifiesto);
      otro.cerrar();
    });

    test('con ETag conocido el servidor contesta 304 y no se redescarga', () async {
      // La app pregunta en cada arranque; la mayoría de los arranques no traen
      // novedad. Sin esto se bajaría el documento entero cada vez.
      final primera = await cliente.descargarManifiesto();
      expect(primera.etag, isNotNull);

      final segunda = await cliente.descargarManifiesto(etagPrevio: primera.etag);
      expect(segunda.sinCambios, isTrue);
      expect(segunda.manifiesto, isNull);
      expect(segunda.etag, primera.etag);
      expect(servidor.recibidas.last.cabeceras['if-none-match'], primera.etag);
    });

    test('un documento de otra versión se rechaza al conectar, no más tarde', () async {
      // Es el momento adecuado para enterarse: una app conectada a un backend
      // cuyo manifiesto no se entendió es una app que va a fallar después y en
      // peor sitio.
      servidor.documento = manifiestoTienda.replaceFirst('"version": 1', '"version": 9');
      await expectLater(
        cliente.descargarManifiesto(),
        throwsA(isA<ManifiestoInvalido>().having(
            (e) => e.mensaje, 'mensaje', contains('9'))),
      );
    });

    test('una respuesta que no es JSON no se toma por un manifiesto', () async {
      // Un portal cautivo de wifi contesta 200 con HTML a cualquier cosa. Sin
      // esto, la app se quedaría con un manifiesto vacío y sin entidades.
      servidor.documento = '<html><body>Inicia sesión en la red</body></html>';
      await expectLater(
        cliente.descargarManifiesto(),
        throwsA(isA<FormatException>()),
      );
    });
  });

  group('listar', () {
    test('pide la ruta del manifiesto con la paginación de Spring', () async {
      servidor.cuerpo = {
        'content': [
          {'id': 1, 'nombre': 'Ana'},
          {'id': 2, 'nombre': 'Beto'},
        ],
        'totalElements': 2,
        'number': 0,
        'size': 20,
      };
      final entidad = manifiesto.entidadPorNombre('Cliente')!;
      final pagina = await cliente.listar(manifiesto, entidad);

      expect(servidor.recibidas.single.ruta, '/api/clientes?page=0&size=20');
      expect(pagina.contenido, hasLength(2));
      expect(pagina.total, 2);
      expect(pagina.hayMas, isFalse);
    });

    test('sabe que hay más páginas cuando las hay', () async {
      servidor.cuerpo = {
        'content': <Map<String, dynamic>>[],
        'totalElements': 45,
        'number': 0,
        'size': 20,
      };
      final entidad = manifiesto.entidadPorNombre('Cliente')!;
      expect((await cliente.listar(manifiesto, entidad)).hayMas, isTrue);
    });

    test('la ruta compuesta sale de baseUrl más la ruta de la entidad', () async {
      servidor.cuerpo = {'content': [], 'totalElements': 0, 'number': 0, 'size': 20};
      final linea = manifiesto.entidadPorNombre('LineaPedido')!;
      await cliente.listar(manifiesto, linea, pagina: 2, tamano: 5);
      expect(servidor.recibidas.single.ruta, '/api/linea-pedidos?page=2&size=5');
    });
  });

  group('idempotencia', () {
    test('la clave viaja en la cabecera que anuncia el manifiesto', () async {
      servidor.estado = 201;
      servidor.cuerpo = {'id': 9, 'nombre': 'Ana'};
      final entidad = manifiesto.entidadPorNombre('Cliente')!;

      await cliente.crear(manifiesto, entidad, {'nombre': 'Ana'},
          claveIdempotencia: 'dictado-123456789');

      final recibida = servidor.recibidas.single;
      expect(recibida.metodo, 'POST');
      expect(recibida.cabeceras['idempotency-key'], 'dictado-123456789');
      expect(jsonDecode(recibida.cuerpo), {'nombre': 'Ana'});
    });

    test('sin clave no se manda la cabecera', () async {
      servidor.estado = 201;
      servidor.cuerpo = {'id': 9};
      final entidad = manifiesto.entidadPorNombre('Cliente')!;
      await cliente.crear(manifiesto, entidad, {'nombre': 'Ana'});
      expect(servidor.recibidas.single.cabeceras.containsKey('idempotency-key'), isFalse);
    });

    test('la clave generada tiene la forma que el filtro acepta', () {
      // El filtro valida `^[A-Za-z0-9_.:-]{8,120}$` y responde 400 si no encaja.
      final patron = RegExp(r'^[A-Za-z0-9_.:-]{8,120}$');
      for (var i = 0; i < 50; i++) {
        expect(patron.hasMatch(nuevaClaveIdempotencia('alta')), isTrue);
      }
    });

    test('dos claves seguidas no se repiten', () {
      final claves = {for (var i = 0; i < 200; i++) nuevaClaveIdempotencia()};
      expect(claves, hasLength(200));
    });

    test('el DELETE también la lleva', () async {
      servidor.estado = 204;
      servidor.cuerpo = null;
      final entidad = manifiesto.entidadPorNombre('Cliente')!;
      await cliente.borrar(manifiesto, entidad, 4, claveIdempotencia: 'borrar-abcdefgh');
      final recibida = servidor.recibidas.single;
      expect(recibida.metodo, 'DELETE');
      expect(recibida.ruta, '/api/clientes/4');
      expect(recibida.cabeceras['idempotency-key'], 'borrar-abcdefgh');
    });
  });

  group('errores', () {
    test('un 400 con fieldErrors llega desglosado por campo', () async {
      // Es lo que permite pintar el mensaje debajo del campo culpable en vez de
      // soltar un aviso genérico que no dice qué corregir.
      servidor.estado = 400;
      servidor.cuerpo = {
        'status': 400,
        'error': 'Bad Request',
        'message': 'Validación fallida',
        'fieldErrors': {'email': 'no puede estar vacío'},
      };
      final entidad = manifiesto.entidadPorNombre('Cliente')!;

      await expectLater(
        cliente.crear(manifiesto, entidad, {'nombre': 'Ana'}),
        throwsA(isA<ErrorHttp>()
            .having((e) => e.estado, 'estado', 400)
            .having((e) => e.esValidacion, 'esValidacion', isTrue)
            .having((e) => e.erroresDeCampo['email'], 'email', 'no puede estar vacío')),
      );
    });

    test('un 409 se distingue: la clave se reusó con otro cuerpo', () async {
      servidor.estado = 409;
      servidor.cuerpo = {'status': 409, 'message': 'Idempotency-Key reutilizada'};
      final entidad = manifiesto.entidadPorNombre('Cliente')!;
      await expectLater(
        cliente.crear(manifiesto, entidad, {'nombre': 'Otra'},
            claveIdempotencia: 'dictado-123456789'),
        throwsA(isA<ErrorHttp>().having((e) => e.esConflicto, 'esConflicto', isTrue)),
      );
    });

    test('un 404 al pedir una ficha se reconoce', () async {
      servidor.estado = 404;
      servidor.cuerpo = {'status': 404, 'message': 'Cliente 99 no encontrado'};
      final entidad = manifiesto.entidadPorNombre('Cliente')!;
      await expectLater(
        cliente.obtener(manifiesto, entidad, 99),
        throwsA(isA<ErrorHttp>().having((e) => e.noExiste, 'noExiste', isTrue)),
      );
    });

    test('un error que no es JSON no rompe el cliente', () async {
      // Un proxy por medio devuelve HTML. El mensaje será genérico, pero la app
      // no debe caerse por una FormatException a mitad de pantalla.
      servidor.estado = 502;
      servidor.cuerpo = null;
      final entidad = manifiesto.entidadPorNombre('Cliente')!;
      await expectLater(
        cliente.listar(manifiesto, entidad),
        throwsA(isA<ErrorHttp>().having((e) => e.estado, 'estado', 502)),
      );
    });

    test('un servidor que no está da un error de red, no de HTTP', () async {
      final puerto = servidor.base.port;
      await servidor.cerrar();
      final huerfano = ClienteRest(Uri.parse('http://localhost:$puerto'));
      addTearDown(huerfano.cerrar);
      await expectLater(
        huerfano.descargarManifiesto(),
        throwsA(isA<ErrorDeRed>()),
      );
    });
  });
}
