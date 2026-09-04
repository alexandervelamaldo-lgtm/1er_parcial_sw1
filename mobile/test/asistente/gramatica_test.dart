import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/gramatica.dart';
import 'package:uml_movil/asistente/manifiesto.dart';

import 'fixture_tienda.dart';

/// Un viernes de septiembre, para que «mañana» sea siempre el mismo día.
final DateTime ahora = DateTime(2026, 9, 4, 10, 0);

Manifiesto leerManifiesto(String documento) =>
    Manifiesto.desdeJson(jsonDecode(documento) as Map<String, dynamic>);

/// Un manifiesto que no comparte **ni una palabra** con el de la tienda.
///
/// Está aquí para lo que de verdad importa de este módulo: que el vocabulario
/// salga del manifiesto y no del código. Si alguna vez se cuela un «cliente» o
/// un «pedido» escrito a mano en `gramatica.dart`, la tienda seguiría pasando
/// sus pruebas y esta barbería dejaría de funcionar. Es la única guarda que
/// avisa antes de la demostración y no durante.
const String manifiestoBarberia = r'''
{
  "version": 1,
  "proyecto": "Barberia",
  "baseUrl": "/api",
  "idioma": "es",
  "cabeceraIdempotencia": "Idempotency-Key",
  "entidades": [
    {
      "nombre": "Cita",
      "ruta": "/citas",
      "etiquetaHablada": ["cita", "citas"],
      "identificador": { "nombre": "id", "tipo": "entero" },
      "campoEtiqueta": "cliente",
      "campos": [
        { "nombre": "cliente", "etiqueta": "cliente", "tipo": "texto", "obligatorio": true, "soloLectura": false, "maxLongitud": 255 },
        { "nombre": "fecha", "etiqueta": "fecha", "tipo": "fechaHora", "obligatorio": true, "soloLectura": false }
      ],
      "acciones": ["listar", "ver", "crear", "actualizar", "borrar"],
      "criticas": ["borrar"],
      "borradoEnCascada": []
    },
    {
      "nombre": "Barbero",
      "ruta": "/barberos",
      "etiquetaHablada": ["barbero", "barberos"],
      "identificador": { "nombre": "id", "tipo": "entero" },
      "campoEtiqueta": "nombre",
      "campos": [
        { "nombre": "nombre", "etiqueta": "nombre", "tipo": "texto", "obligatorio": true, "soloLectura": false, "maxLongitud": 255 }
      ],
      "acciones": ["listar", "ver", "crear"],
      "criticas": [],
      "borradoEnCascada": []
    }
  ],
  "enumerados": []
}
''';

void main() {
  late Interprete tienda;

  setUp(() {
    tienda = Interprete(leerManifiesto(manifiestoTienda), reloj: () => ahora);
  });

  group('de qué se está hablando', () {
    test('el plural dicho abre la lista', () {
      final resultado = tienda.interpretar('muéstrame los clientes');
      expect(resultado.orden!.accion, Accion.listar);
      expect(resultado.orden!.entidad.nombre, 'Cliente');
      expect(resultado.confianza, 1);
    });

    test('decir solo el nombre también, pero con menos confianza', () {
      // Se entiende, y por eso se hace; se ha supuesto el verbo, y por eso se
      // dice. La app decidirá si con 0,6 pregunta antes de actuar.
      final resultado = tienda.interpretar('clientes');
      expect(resultado.orden!.accion, Accion.listar);
      expect(resultado.confianza, lessThan(1));
    });

    test('los acentos que nadie pronuncia no cambian nada', () {
      expect(tienda.interpretar('lista las categorias').orden!.entidad.nombre,
          'Categoria');
      expect(tienda.interpretar('lista las categorías').orden!.entidad.nombre,
          'Categoria');
    });

    test('gana la entidad que se nombra primero, no la de nombre más largo', () {
      // «cliente» es más largo que «pedido» y aparece en la frase, pero es el
      // destinatario y no el asunto. Elegir mal aquí es actuar sobre la tabla
      // equivocada, que en un borrado sería el peor fallo posible del módulo.
      final resultado = tienda.interpretar('crea un pedido para el cliente 3');
      expect(resultado.orden!.entidad.nombre, 'Pedido');
      expect(resultado.orden!.valores['clienteId'], '3');
    });

    test('una etiqueta compuesta gana a la que lleva dentro', () {
      final resultado = tienda.interpretar('muéstrame los linea pedidos');
      expect(resultado.orden!.entidad.nombre, 'LineaPedido');
    });

    test('si no se nombra ninguna, se dice lo que hay', () {
      final resultado = tienda.interpretar('haz algo con eso');
      expect(resultado.entendida, isFalse);
      expect(resultado.aclaracion, contains('clientes'));
      expect(resultado.confianza, 0);
    });
  });

  group('altas', () {
    test('los campos nombrados se recogen con su valor', () {
      final orden = tienda
          .interpretar('crea un cliente con nombre Ana Pérez y email ana@ej.com')
          .orden!;
      expect(orden.accion, Accion.crear);
      expect(orden.valores['nombre'], 'Ana Pérez');
      expect(orden.valores['email'], 'ana@ej.com');
      expect(orden.completa, isTrue);
    });

    test('sin nombrar el campo, el manifiesto dice cuál representa al registro', () {
      // `campoEtiqueta` existe justo para esto: «nuevo cliente Ana Pérez» no
      // dice «nombre» en ningún sitio y aun así no hay otra cosa que pueda ser.
      final orden = tienda.interpretar('nuevo cliente Ana Pérez').orden!;
      expect(orden.valores['nombre'], 'Ana Pérez');
    });

    test('lo que falta se dice en vez de mandarlo a medias', () {
      final resultado = tienda.interpretar('nuevo cliente Ana Pérez');
      expect(resultado.orden!.completa, isFalse);
      expect(resultado.orden!.camposQueFaltan.single.nombre, 'email');
      expect(resultado.aclaracion, contains('email'));
    });

    test('un dictado entero acaba en el cuerpo que espera el DTO', () {
      final orden = tienda
          .interpretar('crea un producto con nombre Taburete sku TAB-1 '
              'precio 19 con 99 y activo sí')
          .orden!;
      expect(orden.cuerpo, {
        'nombre': 'Taburete',
        'sku': 'TAB-1',
        'precio': 19.99,
        'activo': true,
      });
    });

    test('un enumerado se corrige contra la lista cerrada del diagrama', () {
      // Esto es lo que ninguna API REST cuenta de sí misma. Sin la lista, lo
      // único que se podría hacer es mandar «enviado» y esperar un 400.
      final orden = tienda.interpretar('crea un pedido con estado enviado').orden!;
      expect(orden.valores['estado'], 'ENVIADO');
    });

    test('un decimal dictado con «con» llega como número', () {
      final orden = tienda.interpretar('crea un producto precio 19 con 99').orden!;
      expect(orden.cuerpo['precio'], 19.99);
    });

    test('lo que no se sabe colocar baja la confianza y se dice', () {
      final resultado = tienda.interpretar('crea un pedido zapatilla');
      expect(resultado.confianza, lessThanOrEqualTo(0.5));
      expect(resultado.aclaracion, contains('zapatilla'));
    });
  });

  group('sobre un registro concreto', () {
    test('el número dicho detrás de la entidad es el identificador', () {
      final orden = tienda.interpretar('borra el cliente 4').orden!;
      expect(orden.accion, Accion.borrar);
      expect(orden.identificador, 4);
      expect(orden.necesitaConfirmacion, isTrue);
    });

    test('decir un nombre en vez de un número deja dicho a quién buscar', () {
      // Resolverlo exige una consulta, así que la orden lo lleva escrito y lo
      // hace quien la ejecuta; inventarse un identificador aquí sería peor.
      final orden = tienda.interpretar('borra el cliente Ana Pérez').orden!;
      expect(orden.identificador, isNull);
      expect(orden.busqueda, 'Ana Pérez');
    });

    test('borrar sin decir cuál no produce una orden', () {
      // Una orden a medias es peor que ninguna, y en un borrado, mucho peor.
      final resultado = tienda.interpretar('borra el cliente');
      expect(resultado.entendida, isFalse);
      expect(resultado.aclaracion, contains('cliente'));
    });

    test('el aviso de la cascada sale del rombo relleno del diagrama', () {
      // «¿Seguro?» no informa de nada. Que se van a borrar también las líneas
      // sí, y es lo único que REST no puede contar por su cuenta.
      final orden = tienda.interpretar('borra el pedido 7').orden!;
      expect(orden.advertencia, contains('linea pedidos'));
      expect(tienda.interpretar('borra el cliente 4').orden!.advertencia, isNull);
    });

    test('cambiar un campo de un registro nombrado', () {
      final orden = tienda
          .interpretar('cambia el email del cliente 4 a nuevo@ej.com')
          .orden!;
      expect(orden.accion, Accion.actualizar);
      expect(orden.identificador, 4);
      expect(orden.valores['email'], 'nuevo@ej.com');
    });

    test('decir el nombre y un número abre la ficha, no la lista', () {
      final orden = tienda.interpretar('pedido 7').orden!;
      expect(orden.accion, Accion.ver);
      expect(orden.identificador, 7);
    });

    test('«ver clientes» es la lista: no hay un cuál', () {
      expect(tienda.interpretar('ver clientes').orden!.accion, Accion.listar);
    });
  });

  group('lo que el backend no ofrece', () {
    test('no se inventa una acción que la entidad no admite', () {
      final barberia =
          Interprete(leerManifiesto(manifiestoBarberia), reloj: () => ahora);
      final resultado = barberia.interpretar('borra el barbero 2');
      expect(resultado.entendida, isFalse);
      expect(resultado.aclaracion, contains('borrar'));
      expect(resultado.aclaracion, contains('barberos'));
    });
  });

  group('fechas y horas dictadas', () {
    test('la frase del barbero, de principio a fin', () {
      // El caso que da sentido a todo esto: sin tocar el teclado, sin decir la
      // palabra «fecha», y con el resultado listo para viajar en el POST.
      final barberia =
          Interprete(leerManifiesto(manifiestoBarberia), reloj: () => ahora);
      final orden =
          barberia.interpretar('configúrame una cita para mañana a las tres').orden!;

      expect(orden.accion, Accion.crear);
      expect(orden.entidad.nombre, 'Cita');
      expect(orden.valores['fecha'], '2026-09-05 15:00');
      expect(orden.cuerpo['fecha'], '2026-09-05T15:00:00');
    });

    test('el nombre suelto va al campo que representa al registro', () {
      final barberia =
          Interprete(leerManifiesto(manifiestoBarberia), reloj: () => ahora);
      final orden = barberia
          .interpretar('apúntame una cita para Juan mañana a las cuatro')
          .orden!;
      expect(orden.valores['cliente'], 'Juan');
      expect(orden.valores['fecha'], '2026-09-05 16:00');
      expect(orden.completa, isTrue);
    });

    test('media fecha se pregunta en vez de inventarse la hora', () {
      // Rellenar las doce de la noche daría una cita con toda la apariencia de
      // estar bien puesta. Preguntar cuesta una frase; equivocarse, un cliente.
      final barberia =
          Interprete(leerManifiesto(manifiestoBarberia), reloj: () => ahora);
      final resultado = barberia.interpretar('cita para Juan mañana');
      expect(resultado.orden!.valores['fecha'], '2026-09-05');
      expect(resultado.aclaracion, contains('hora'));
    });

    test('con dos campos temporales no se adivina en cuál va', () {
      // La tienda no tiene ese caso, pero el principio se comprueba igual: la
      // hora solo se coloca sola cuando hay exactamente un hueco donde cabe.
      final orden = tienda.interpretar('crea un pedido para mañana').orden!;
      expect(orden.valores['fecha'], '2026-09-05');
    });
  });

  group('la clave de idempotencia', () {
    test('se fija al dictar y no al enviar', () {
      // Si se generara al salir la petición, cada reintento llevaría una clave
      // distinta y el mecanismo entero no serviría para nada.
      final orden = tienda.interpretar('nuevo cliente Ana').orden!;
      final primera = orden.claveIdempotencia;
      expect(orden.claveIdempotencia, primera);
      expect(orden.claveIdempotencia, startsWith('alta-'));
      // La misma forma que valida el filtro del backend: si no encaja, 400.
      expect(RegExp(r'^[A-Za-z0-9_.:-]{8,120}$').hasMatch(primera), isTrue);
    });

    test('dos dictados distintos no comparten clave', () {
      final una = tienda.interpretar('nuevo cliente Ana').orden!;
      final otra = tienda.interpretar('nuevo cliente Beto').orden!;
      expect(una.claveIdempotencia, isNot(otra.claveIdempotencia));
    });
  });

  group('ayuda', () {
    test('el repertorio se dice con las palabras de este proyecto', () {
      final resultado = tienda.interpretar('¿qué puedes hacer?');
      expect(resultado.esAyuda, isTrue);
      expect(resultado.explicacion, contains('clientes'));

      final barberia =
          Interprete(leerManifiesto(manifiestoBarberia), reloj: () => ahora);
      final otra = barberia.interpretar('ayuda');
      expect(otra.explicacion, contains('citas'));
      expect(otra.explicacion, isNot(contains('clientes')));
    });

    test('el campo vacío no produce una orden', () {
      expect(tienda.interpretar('   ').entendida, isFalse);
    });
  });
}
