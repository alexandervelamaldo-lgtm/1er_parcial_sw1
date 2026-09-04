import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/manifiesto.dart';

import 'fixture_tienda.dart';

Manifiesto _leer([String json = manifiestoTienda]) =>
    Manifiesto.desdeJson(jsonDecode(json) as Map<String, dynamic>);

/// Devuelve el documento de «tienda» con una modificación aplicada, para poder
/// afirmar sobre casos límite sin escribir un manifiesto entero cada vez.
Map<String, dynamic> _tiendaCon(void Function(Map<String, dynamic>) retoque) {
  final json = jsonDecode(manifiestoTienda) as Map<String, dynamic>;
  retoque(json);
  return json;
}

void main() {
  group('lo que el manifiesto describe', () {
    test('se lee entero el que emite el generador para «tienda»', () {
      final manifiesto = _leer();
      expect(manifiesto.proyecto, 'Tienda');
      expect(manifiesto.baseUrl, '/api');
      expect(manifiesto.entidades.map((e) => e.nombre), [
        'Cliente',
        'Pedido',
        'LineaPedido',
        'Producto',
        'Categoria',
      ]);
    });

    test('el plural viene de la ruta, no de pluralizar otra vez', () {
      // Es la garantía de que la app no pida `/linea-pedidos` mientras dice
      // «linea pedidoes»: las dos formas salen de la misma fuente.
      final linea = _leer().entidadPorNombre('LineaPedido')!;
      expect(linea.singular, 'linea pedido');
      expect(linea.plural, 'linea pedidos');
      expect(linea.ruta, '/linea-pedidos');
    });

    test('el enumerado llega con su lista cerrada de valores', () {
      final estado = _leer().entidadPorNombre('Pedido')!.campoPorNombre('estado')!;
      expect(estado.tipo, TipoCampo.enumerado);
      expect(estado.valores, [
        'BORRADOR',
        'CONFIRMADO',
        'ENVIADO',
        'ENTREGADO',
        'CANCELADO',
      ]);
    });

    test('el borrado en cascada solo lo sabe el diagrama', () {
      // Ninguna API REST cuenta esto de sí misma: sale del rombo relleno de la
      // composición. Sin ello el aviso de borrado sería un «¿seguro?» pelado.
      final manifiesto = _leer();
      expect(manifiesto.entidadPorNombre('Pedido')!.borradoEnCascada, ['LineaPedido']);
      expect(manifiesto.entidadPorNombre('Producto')!.borradoEnCascada, isEmpty);
    });

    test('la referencia dice a qué entidad apunta y con qué nombre de DTO', () {
      final campo = _leer().entidadPorNombre('Pedido')!.campoPorNombre('clienteId')!;
      expect(campo.tipo, TipoCampo.referencia);
      expect(campo.entidad, 'Cliente');
      expect(campo.etiqueta, 'cliente');
    });

    test('borrar está marcada como crítica en todas las entidades', () {
      for (final entidad in _leer().entidades) {
        expect(entidad.esCritica(Accion.borrar), isTrue, reason: entidad.nombre);
        expect(entidad.esCritica(Accion.listar), isFalse, reason: entidad.nombre);
      }
    });
  });

  group('lo que se dicta', () {
    test('encuentra la entidad por singular, por plural y por nombre de clase', () {
      final manifiesto = _leer();
      expect(manifiesto.buscarHablada('pedido')?.nombre, 'Pedido');
      expect(manifiesto.buscarHablada('pedidos')?.nombre, 'Pedido');
      expect(manifiesto.buscarHablada('Pedido')?.nombre, 'Pedido');
      expect(manifiesto.buscarHablada('facturas'), isNull);
    });

    test('ignora acentos, mayúsculas y espacios de más', () {
      // Quien dicta no pronuncia la tilde y el reconocedor la pone o no la pone.
      final manifiesto = _leer();
      expect(manifiesto.buscarHablada('  CATEGORÍA ')?.nombre, 'Categoria');
      expect(manifiesto.buscarHablada('linea   pedidos')?.nombre, 'LineaPedido');
    });

    test('plegar deja el texto comparable', () {
      expect(plegar('  Categoría   Nueva '), 'categoria nueva');
      expect(plegar('Ñoño'), 'nono');
    });
  });

  group('lo que se rechaza', () {
    test('una versión distinta para en seco y dice las dos', () {
      expect(
        () => Manifiesto.desdeJson(_tiendaCon((j) => j['version'] = 2)),
        throwsA(isA<ManifiestoInvalido>().having(
          (e) => e.mensaje,
          'mensaje',
          allOf(contains('versión 1'), contains('2')),
        )),
      );
    });

    test('una ruta que se sale del sitio', () {
      // La ruta acaba concatenada en una URL. `..` aquí es una petición a otro
      // servidor, no un error de formato.
      for (final mala in ['/../admin', '/Clientes', '/clientes/', 'clientes', '//x']) {
        expect(
          () => Manifiesto.desdeJson(
              _tiendaCon((j) => (j['entidades'] as List)[0]['ruta'] = mala)),
          throwsA(isA<ManifiestoInvalido>().having(
              (e) => e.mensaje, 'mensaje', contains('no segura'))),
          reason: mala,
        );
      }
    });

    test('un nombre que no es identificador', () {
      expect(
        () => Manifiesto.desdeJson(
            _tiendaCon((j) => (j['entidades'] as List)[0]['nombre'] = 'Cli ente')),
        throwsA(isA<ManifiestoInvalido>()),
      );
    });

    test('un tipo desconocido, en vez de tragarlo como texto', () {
      // Con la versión clavada en 1, un tipo nuevo solo puede ser un backend
      // incoherente. Mandarle texto donde espera un número escondería el fallo.
      expect(
        () => Manifiesto.desdeJson(_tiendaCon(
            (j) => (j['entidades'] as List)[0]['campos'][0]['tipo'] = 'moneda')),
        throwsA(isA<ManifiestoInvalido>().having(
            (e) => e.mensaje, 'mensaje', contains('desconocido'))),
      );
    });

    test('un enumerado sin valores', () {
      expect(
        () => Manifiesto.desdeJson(_tiendaCon(
            (j) => (j['entidades'] as List)[1]['campos'][2]['valores'] = <String>[])),
        throwsA(isA<ManifiestoInvalido>()),
      );
    });

    test('una referencia a una entidad que no está en el documento', () {
      expect(
        () => Manifiesto.desdeJson(_tiendaCon(
            (j) => (j['entidades'] as List)[1]['campos'][3]['entidad'] = 'Proveedor')),
        throwsA(isA<ManifiestoInvalido>().having(
            (e) => e.mensaje, 'mensaje', contains('Proveedor'))),
      );
    });

    test('un campoEtiqueta que no está entre los campos', () {
      expect(
        () => Manifiesto.desdeJson(
            _tiendaCon((j) => (j['entidades'] as List)[0]['campoEtiqueta'] = 'apodo')),
        throwsA(isA<ManifiestoInvalido>()),
      );
    });

    test('una acción crítica que la entidad no ofrece', () {
      expect(
        () => Manifiesto.desdeJson(_tiendaCon((j) =>
            (j['entidades'] as List)[0]['acciones'] = ['listar', 'ver'])),
        throwsA(isA<ManifiestoInvalido>().having(
            (e) => e.mensaje, 'mensaje', contains('crítica'))),
      );
    });

    test('dos entidades con el mismo nombre', () {
      expect(
        () => Manifiesto.desdeJson(_tiendaCon((j) =>
            (j['entidades'] as List)[1]['nombre'] = 'Cliente')),
        throwsA(isA<ManifiestoInvalido>()),
      );
    });

    test('un documento que no tiene la forma esperada', () {
      expect(() => _leer('{}'), throwsA(isA<ManifiestoInvalido>()));
      expect(() => _leer('{"version":1}'), throwsA(isA<ManifiestoInvalido>()));
    });
  });

  group('guarda contra la divergencia con el generador', () {
    // El fixture es una copia. Si en esta máquina existe el manifiesto generado
    // de verdad, se parsea también: cualquier cambio en el emisor que esta app
    // no supiera leer sale aquí, en vez de en el teléfono.
    test('el manifiesto realmente generado también se lee', () {
      final fichero = File(
        '../generator/salida/tienda/src/main/resources/asistente/manifiesto.json',
      );
      if (!fichero.existsSync()) {
        printOnFailure('No hay salida del generador en esta máquina.');
        return;
      }
      final real = _leer(fichero.readAsStringSync());
      final copia = _leer();
      expect(real.entidades.map((e) => e.nombre), copia.entidades.map((e) => e.nombre));
      for (final entidad in real.entidades) {
        final espejo = copia.entidadPorNombre(entidad.nombre)!;
        expect(entidad.ruta, espejo.ruta, reason: entidad.nombre);
        expect(
          entidad.campos.map((c) => '${c.nombre}:${c.tipo.name}'),
          espejo.campos.map((c) => '${c.nombre}:${c.tipo.name}'),
          reason: entidad.nombre,
        );
        expect(entidad.borradoEnCascada, espejo.borradoEnCascada, reason: entidad.nombre);
      }
    });
  });
}
