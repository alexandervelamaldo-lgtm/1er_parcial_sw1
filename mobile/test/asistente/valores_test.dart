import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/manifiesto.dart';
import 'package:uml_movil/asistente/valores.dart';

import 'fixture_tienda.dart';

final Manifiesto _tienda =
    Manifiesto.desdeJson(jsonDecode(manifiestoTienda) as Map<String, dynamic>);

CampoManifiesto _campo(String entidad, String nombre) =>
    _tienda.entidadPorNombre(entidad)!.campoPorNombre(nombre)!;

void main() {
  group('cómo se enseña un registro', () {
    test('usa el campoEtiqueta cuando el manifiesto señala uno', () {
      final cliente = _tienda.entidadPorNombre('Cliente')!;
      expect(
        etiquetaDeRegistro(cliente, {'id': 7, 'nombre': 'Ana Pérez'}),
        'Ana Pérez',
      );
    });

    test('cae al identificador cuando no hay campoEtiqueta', () {
      // `Pedido` no tiene ningún texto obligatorio, así que el emisor no le
      // asigna etiqueta. Enseñar «#12» no es bonito, pero una fila vacía es peor.
      final pedido = _tienda.entidadPorNombre('Pedido')!;
      expect(etiquetaDeRegistro(pedido, {'id': 12, 'total': 30}), '#12');
    });

    test('un campoEtiqueta vacío no deja la fila en blanco', () {
      final cliente = _tienda.entidadPorNombre('Cliente')!;
      expect(etiquetaDeRegistro(cliente, {'id': 3, 'nombre': '   '}), '#3');
    });
  });

  group('validación antes de gastar un viaje de red', () {
    test('un obligatorio vacío se detiene aquí', () {
      expect(validarCampo(_campo('Cliente', 'nombre'), '   '), isNotNull);
      expect(validarCampo(_campo('Cliente', 'fechaAlta'), ''), isNull);
    });

    test('respeta el maxLongitud que salió de @Size', () {
      final nombre = _campo('Cliente', 'nombre');
      expect(validarCampo(nombre, 'x' * 255), isNull);
      expect(validarCampo(nombre, 'x' * 256), contains('255'));
    });

    test('un enumerado solo acepta los valores del diagrama', () {
      final estado = _campo('Pedido', 'estado');
      expect(validarCampo(estado, 'ENVIADO'), isNull);
      expect(validarCampo(estado, 'enviado'), isNotNull);
      expect(validarCampo(estado, 'DEVUELTO'), contains('BORRADOR'));
    });

    test('los números avisan antes de que lo haga el 400 del servidor', () {
      expect(validarCampo(_campo('LineaPedido', 'cantidad'), '3'), isNull);
      expect(validarCampo(_campo('LineaPedido', 'cantidad'), '3,5'), isNotNull);
      expect(validarCampo(_campo('LineaPedido', 'precioUnitario'), '3,50'), isNull);
    });

    test('las fechas piden la forma que entiende Jackson', () {
      expect(validarCampo(_campo('Cliente', 'fechaAlta'), '2026-09-23'), isNull);
      expect(validarCampo(_campo('Cliente', 'fechaAlta'), '23/09/2026'), isNotNull);
      expect(validarCampo(_campo('Pedido', 'fecha'), '2026-09-23 10:30'), isNull);
    });
  });

  group('qué se manda de verdad', () {
    test('la coma de la coma decimal no llega al servidor', () {
      // Se enseña «3,50» porque es como se escribe en español, y se envía 3.5
      // porque es lo que acepta un BigDecimal en JSON.
      expect(valorParaEnviar(_campo('LineaPedido', 'precioUnitario'), '3,50'), 3.5);
    });

    test('la fechaHora recupera la T y completa los segundos', () {
      // Mandar siempre la misma forma importa más de lo que parece: dos
      // reintentos del mismo dictado tienen que producir la misma huella, y la
      // huella es un SHA-256 del cuerpo tal cual.
      expect(valorParaEnviar(_campo('Pedido', 'fecha'), '2026-09-23 10:30'),
          '2026-09-23T10:30:00');
      expect(valorParaEnviar(_campo('Pedido', 'fecha'), '2026-09-23T10:30:00'),
          '2026-09-23T10:30:00');
    });

    test('un opcional vacío viaja como null explícito', () {
      expect(valorParaEnviar(_campo('Cliente', 'fechaAlta'), ''), isNull);
    });

    test('la referencia viaja como número, no como texto', () {
      expect(valorParaEnviar(_campo('Pedido', 'clienteId'), '17'), 17);
    });

    test('el cuerpo lleva exactamente los campos del DTO, ni uno más', () {
      // Se recorre el manifiesto y no el formulario: si el diagrama gana un
      // campo y la pantalla todavía no, el cuerpo sigue teniendo la forma que
      // el `record` de entrada espera.
      final pedido = _tienda.entidadPorNombre('Pedido')!;
      final cuerpo = cuerpoDesdeFormulario(pedido, {
        'fecha': '2026-09-23 10:30',
        'total': '99,90',
        'estado': 'CONFIRMADO',
        'clienteId': '4',
        'colado': 'no debería salir',
      });
      expect(cuerpo.keys, ['fecha', 'total', 'estado', 'clienteId']);
      expect(cuerpo['total'], 99.9);
      expect(cuerpo['clienteId'], 4);
    });

    test('el mismo formulario produce el mismo JSON dos veces', () {
      // Es la condición para que un reintento con la misma clave de
      // idempotencia no choque contra su propia huella.
      final producto = _tienda.entidadPorNombre('Producto')!;
      final textos = {
        'nombre': 'Taburete',
        'sku': 'TAB-1',
        'precio': '19,99',
        'activo': 'true',
      };
      expect(
        jsonEncode(cuerpoDesdeFormulario(producto, textos)),
        jsonEncode(cuerpoDesdeFormulario(producto, textos)),
      );
    });
  });

  group('ida y vuelta con el servidor', () {
    test('lo que llega se puede editar y vuelve igual', () {
      final precio = _campo('LineaPedido', 'precioUnitario');
      final texto = textoDesdeValor(precio, 12.5);
      expect(texto, '12,5');
      expect(valorParaEnviar(precio, texto), 12.5);

      final fecha = _campo('Pedido', 'fecha');
      final enPantalla = textoDesdeValor(fecha, '2026-09-23T10:30:00');
      expect(enPantalla, '2026-09-23 10:30:00');
      expect(valorParaEnviar(fecha, enPantalla), '2026-09-23T10:30:00');
    });

    test('un null del servidor deja el campo vacío, no la palabra «null»', () {
      expect(textoDesdeValor(_campo('Cliente', 'fechaAlta'), null), '');
    });
  });

  group('formatos', () {
    test('rellenan con ceros lo que Jackson exige', () {
      expect(comoFecha(DateTime(2026, 9, 4)), '2026-09-04');
      expect(comoHora(DateTime(2026, 9, 4, 7, 5)), '07:05');
      expect(comoFechaHora(DateTime(2026, 9, 4, 7, 5)), '2026-09-04 07:05');
    });
  });
}
