import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/cliente_rest.dart';
import 'package:uml_movil/asistente/sesion.dart';

import 'fixture_tienda.dart';

/// Servidor mínimo que solo sirve el manifiesto, con ETag.
class _Servidor {
  _Servidor(this._servidor) {
    _servidor.listen((peticion) async {
      final respuesta = peticion.response;
      if (peticion.uri.path != rutaManifiesto) {
        respuesta.statusCode = HttpStatus.notFound;
        respuesta.headers.contentType = ContentType.json;
        respuesta.write(jsonEncode({'status': 404, 'message': 'No existe'}));
        await respuesta.close();
        return;
      }
      respuesta.headers.set('etag', etag);
      if (peticion.headers.value('if-none-match') == etag) {
        respuesta.statusCode = HttpStatus.notModified;
        await respuesta.close();
        return;
      }
      respuesta.headers.contentType = ContentType.json;
      respuesta.write(documento);
      await respuesta.close();
    });
  }

  final HttpServer _servidor;
  String etag = '"v1"';
  String documento = manifiestoTienda;

  int get puerto => _servidor.port;
  String get url => 'http://localhost:$puerto';

  static Future<_Servidor> levantar() async =>
      _Servidor(await HttpServer.bind(InternetAddress.loopbackIPv4, 0));

  Future<void> cerrar() => _servidor.close(force: true);
}

void main() {
  late _Servidor servidor;
  late Sesion sesion;

  setUp(() async {
    servidor = await _Servidor.levantar();
    sesion = Sesion();
  });

  tearDown(() async {
    sesion.dispose();
    await servidor.cerrar();
  });

  group('lo que se teclea en el campo de la dirección', () {
    test('sin esquema se asume http', () async {
      // Nadie escribe «http://» en un móvil si puede evitarlo.
      expect(await sesion.conectar('localhost:${servidor.puerto}'), isTrue);
      expect(sesion.conectada, isTrue);
      expect(sesion.manifiesto!.proyecto, 'Tienda');
    });

    test('una ruta pegada de más se descarta', () async {
      // Si «/api» sobreviviera, la ruta compuesta acabaría siendo
      // `/api/api/clientes`: la baseUrl la pone el manifiesto, no el usuario.
      expect(await sesion.conectar('${servidor.url}/api/'), isTrue);
      expect(sesion.manifiesto!.baseUrl, '/api');
    });

    test('los espacios de alrededor no cuentan', () async {
      expect(await sesion.conectar('   ${servidor.url}  '), isTrue);
    });

    test('un esquema que no es http se rechaza con su nombre', () async {
      expect(await sesion.conectar('ftp://ejemplo.com'), isFalse);
      expect(sesion.error, contains('ftp'));
      expect(sesion.conectada, isFalse);
    });

    test('el campo vacío no lanza una excepción sin recoger', () async {
      expect(await sesion.conectar('   '), isFalse);
      expect(sesion.error, isNotNull);
    });
  });

  group('cuando algo va mal', () {
    test('un servidor que no está deja el error de red a la vista', () async {
      final puerto = servidor.puerto;
      await servidor.cerrar();
      expect(await sesion.conectar('http://localhost:$puerto'), isFalse);
      expect(sesion.conectada, isFalse);
      expect(sesion.error, isNotNull);
    });

    test('un servidor que no es de los nuestros lo dice con esas palabras', () async {
      // Un 404 en la ruta del manifiesto significa que hay algo escuchando,
      // pero no un backend generado por esta herramienta. Decirlo ahorra media
      // hora de buscar el fallo en el sitio equivocado.
      expect(await sesion.conectar('${servidor.url}/'), isTrue);
      sesion.desconectar();

      final otro = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      otro.listen((p) async {
        p.response.statusCode = HttpStatus.notFound;
        await p.response.close();
      });
      addTearDown(() => otro.close(force: true));

      expect(await sesion.conectar('http://localhost:${otro.port}'), isFalse);
      expect(sesion.error, contains(rutaManifiesto));
    });

    test('un documento inválido no deja una sesión a medio conectar', () async {
      servidor.documento = manifiestoTienda.replaceFirst('"/clientes"', '"/../admin"');
      expect(await sesion.conectar(servidor.url), isFalse);
      expect(sesion.conectada, isFalse);
      expect(sesion.manifiesto, isNull);
      expect(sesion.error, contains('no segura'));
    });
  });

  group('releer el manifiesto', () {
    test('si no ha cambiado, no se toca lo que ya funcionaba', () async {
      await sesion.conectar(servidor.url);
      final antes = sesion.manifiesto;
      expect(await sesion.refrescar(), isFalse);
      expect(identical(sesion.manifiesto, antes), isTrue);
    });

    test('si el diagrama cambió, las pantallas se enteran', () async {
      // Es el caso real: alguien edita el diagrama en el portátil y regenera
      // mientras la app está abierta. Sin esto seguiría describiendo el modelo
      // viejo hasta que alguien la reiniciara.
      await sesion.conectar(servidor.url);
      expect(sesion.manifiesto!.entidades, hasLength(5));

      servidor.etag = '"v2"';
      servidor.documento = jsonEncode(
        (jsonDecode(manifiestoTienda) as Map<String, dynamic>)
          ..['entidades'] = [
            (jsonDecode(manifiestoTienda) as Map<String, dynamic>)['entidades'][0],
          ],
      );

      expect(await sesion.refrescar(), isTrue);
      expect(sesion.manifiesto!.entidades, hasLength(1));
    });

    test('que falle un refresco no tira la sesión que ya iba bien', () async {
      await sesion.conectar(servidor.url);
      await servidor.cerrar();
      expect(await sesion.refrescar(), isFalse);
      // Viejo, pero utilizable. Perder el manifiesto por un corte de red sería
      // dejar al usuario sin app en el momento en que menos ayuda tiene.
      expect(sesion.conectada, isTrue);
      expect(sesion.manifiesto!.entidades, hasLength(5));
    });
  });

  test('desconectar deja la sesión como al principio', () async {
    await sesion.conectar(servidor.url);
    sesion.desconectar();
    expect(sesion.conectada, isFalse);
    expect(sesion.manifiesto, isNull);
    expect(sesion.error, isNull);
  });
}
