import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/asistente/bandeja.dart';
import 'package:uml_movil/asistente/cliente_rest.dart';
import 'package:uml_movil/asistente/manifiesto.dart';

import 'fixture_tienda.dart';

/// Un backend de verdad, en el mismo proceso.
///
/// La bandeja existe para que un reintento lleve la misma clave de idempotencia
/// que el primer intento, y eso es una cabecera HTTP: comprobarlo con un doble
/// del cliente no comprobaría nada: solo que la bandeja llama al método que
/// llama. Aquí se mira lo que llegó al servidor por el cable.
class _Servidor {
  late HttpServer _http;

  final List<_Peticion> peticiones = <_Peticion>[];

  /// Qué código devolver. Se llama con la petición ya apuntada, así que puede
  /// decidir según el método, la ruta o cuántas van.
  int Function(_Peticion peticion)? responde;

  Uri get base => Uri.parse('http://${_http.address.host}:${_http.port}');

  Future<void> arrancar() async {
    _http = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _http.listen((peticion) async {
      final texto = await utf8.decoder.bind(peticion).join();
      final apuntada = _Peticion(
        peticion.method,
        peticion.uri.path,
        peticion.headers.value('Idempotency-Key'),
        texto.isEmpty ? null : jsonDecode(texto) as Map<String, dynamic>,
      );
      peticiones.add(apuntada);

      final estado = responde?.call(apuntada) ?? 200;
      final respuesta = peticion.response
        ..statusCode = estado
        // Sin esto el `HttpClient` deja abierta la conexión con su temporizador
        // de reposo y la prueba termina con un `Timer` pendiente.
        ..persistentConnection = false
        ..headers.contentType = ContentType.json;
      respuesta.write(jsonEncode(estado >= 400
          ? <String, dynamic>{'message': 'Rechazado con $estado'}
          : <String, dynamic>{'id': 1, 'nombre': 'Ana'}));
      await respuesta.close();
    });
  }

  Future<void> parar() => _http.close(force: true);

  List<String> get rutas =>
      peticiones.map((p) => '${p.metodo} ${p.ruta}').toList(growable: false);
}

class _Peticion {
  _Peticion(this.metodo, this.ruta, this.clave, this.cuerpo);

  final String metodo;
  final String ruta;
  final String? clave;
  final Map<String, dynamic>? cuerpo;
}

OrdenPendiente _alta(String entidad, String clave, {String? nombre}) =>
    OrdenPendiente(
      metodo: 'POST',
      entidad: entidad,
      clave: clave,
      resumen: 'Doy de alta $entidad',
      cuerpo: <String, dynamic>{'nombre': nombre ?? 'Ana'},
    );

void main() {
  late _Servidor servidor;
  late ClienteRest cliente;
  late Manifiesto manifiesto;
  late AlmacenEnMemoria almacen;
  late Bandeja bandeja;

  setUp(() async {
    // `flutter_test` desvía todo el HTTP a un cliente de mentira que contesta
    // 400 a cualquier cosa. Aquí hay un servidor de verdad al otro lado.
    HttpOverrides.global = null;
    manifiesto =
        Manifiesto.desdeJson(jsonDecode(manifiestoTienda) as Map<String, dynamic>);
    servidor = _Servidor();
    await servidor.arrancar();
    cliente = ClienteRest(servidor.base);
    almacen = AlmacenEnMemoria();
    bandeja = Bandeja(almacen);
  });

  tearDown(() async {
    cliente.cerrar();
    await servidor.parar();
  });

  group('lo que se apuntó sobrevive a cerrar la app', () {
    test('la clave de idempotencia llega al servidor tal y como se guardó',
        () async {
      // La prueba que sostiene el fichero entero. El barbero dicta la cita sin
      // cobertura, cierra la app, y al día siguiente la orden sale con la
      // *misma* clave con la que se intentó: si el primer intento hubiera
      // llegado, el backend reconocería la clave y no crearía una segunda cita.
      await bandeja.encolar(_alta('Cliente', 'alta-cliente-abc123'));

      // Otra app, otro arranque, el mismo disco.
      final resucitada = Bandeja(almacen);
      await resucitada.cargar();
      expect(resucitada.ordenes.single.clave, 'alta-cliente-abc123');

      await resucitada.enviar(cliente, manifiesto);

      expect(servidor.peticiones.single.clave, 'alta-cliente-abc123');
      expect(servidor.peticiones.single.cuerpo, {'nombre': 'Ana'});
      expect(resucitada.vacia, isTrue,
          reason: 'lo que se envió no puede seguir pendiente');
    });

    test('una entrada ilegible se descarta sin llevarse las demás', () async {
      // Una bandeja con una línea rota no puede ser una bandeja perdida: lo que
      // esté bien escrito sigue siendo una orden que alguien dio.
      await almacen.escribir(<Map<String, dynamic>>[
        <String, dynamic>{'metodo': 'POST'}, // sin entidad ni clave
        _alta('Cliente', 'buena').aJson(),
        <String, dynamic>{'entidad': 'Cliente', 'clave': 7}, // clave no textual
      ]);

      await bandeja.cargar();

      expect(bandeja.ordenes, hasLength(1));
      expect(bandeja.ordenes.single.clave, 'buena');
    });

    test('el vaciado se guarda: reabrir no reenvía lo ya enviado', () async {
      await bandeja.encolar(_alta('Cliente', 'k1'));
      await bandeja.enviar(cliente, manifiesto);

      final resucitada = Bandeja(almacen);
      await resucitada.cargar();
      await resucitada.enviar(cliente, manifiesto);

      expect(servidor.peticiones, hasLength(1),
          reason: 'la segunda vida de la app no debe repetir la orden');
    });

    test('encolar avisa a quien esté mirando el contador', () async {
      var avisos = 0;
      bandeja.addListener(() => avisos++);
      await bandeja.encolar(_alta('Cliente', 'k1'));
      expect(avisos, greaterThan(0));
      expect(bandeja.esperando, hasLength(1));
    });
  });

  group('el orden en que se dictó es el orden en que se manda', () {
    test('primero el alta y después el cambio, nunca al revés', () async {
      // Si el cambio saliera primero sería un 404 contra un registro que aún no
      // existe, y la orden buena acabaría marcada en rojo por culpa del orden.
      await bandeja.encolar(_alta('Cliente', 'k1'));
      await bandeja.encolar(OrdenPendiente(
        metodo: 'PUT',
        entidad: 'Cliente',
        registroId: 1,
        clave: 'k2',
        resumen: 'Cambio el email',
        cuerpo: <String, dynamic>{'email': 'ana@ejemplo.com'},
      ));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(servidor.rutas, ['POST /api/clientes', 'PUT /api/clientes/1']);
      expect(resultado.enviadas, 2);
      expect(resultado.quedan, 0);
    });

    test('si no hay red no se manda nada y no se pierde nada', () async {
      // Puerto donde no escucha nadie: es el sótano sin cobertura.
      final aOscuras = ClienteRest(Uri.parse('http://127.0.0.1:1'));
      addTearDown(aOscuras.cerrar);

      await bandeja.encolar(_alta('Cliente', 'k1'));
      await bandeja.encolar(_alta('Producto', 'k2'));

      final resultado = await bandeja.enviar(aOscuras, manifiesto);

      expect(resultado.enviadas, 0);
      expect(resultado.quedan, 2);
      expect(resultado.corteDeRed, isNotNull);
      expect(bandeja.rechazadas, isEmpty,
          reason: 'no llegar no es que te rechacen');
      expect(bandeja.ordenes.first.intentos, 1);
      expect(bandeja.ordenes.last.intentos, 0,
          reason: 'la segunda ni se intentó: se cortó en la primera');
    });

    test('un 500 conserva la orden y detiene la cola', () async {
      // El servidor está, pero no puede ahora. Insistir con las siguientes solo
      // gastaría batería, y encima se saltaría el orden.
      servidor.responde = (p) => p.ruta == '/api/clientes' ? 500 : 200;
      await bandeja.encolar(_alta('Cliente', 'k1'));
      await bandeja.encolar(_alta('Producto', 'k2'));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(servidor.rutas, ['POST /api/clientes']);
      expect(resultado.quedan, 2);
      expect(resultado.corteDeRed, isNotNull);
      expect(bandeja.rechazadas, isEmpty);
    });

    test('un 429 se trata como un «vuelve luego», no como un rechazo', () async {
      servidor.responde = (p) => 429;
      await bandeja.encolar(_alta('Cliente', 'k1'));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(resultado.rechazadas, 0);
      expect(resultado.quedan, 1);
      expect(bandeja.ordenes.single.rechazada, isFalse);
    });

    test('dos vaciados a la vez no mandan la orden dos veces', () async {
      await bandeja.encolar(_alta('Cliente', 'k1'));

      final primero = bandeja.enviar(cliente, manifiesto);
      final segundo = await bandeja.enviar(cliente, manifiesto);
      await primero;

      expect(segundo.enviadas, 0);
      expect(servidor.peticiones, hasLength(1));
    });
  });

  group('lo que el servidor rechaza se aparta, no atasca la cola', () {
    test('un 400 marca esa orden y deja pasar la siguiente', () async {
      // Reintentar un 400 daría mil veces lo mismo y taponaría todo lo que
      // viniera detrás. Se aparta a la vista y la cola sigue corriendo.
      servidor.responde = (p) => p.ruta == '/api/clientes' ? 400 : 200;
      await bandeja.encolar(_alta('Cliente', 'k1'));
      await bandeja.encolar(_alta('Producto', 'k2'));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(resultado.rechazadas, 1);
      expect(resultado.enviadas, 1);
      expect(resultado.quedan, 0);
      expect(servidor.rutas, ['POST /api/clientes', 'POST /api/productos']);
      expect(bandeja.rechazadas.single.ultimoError, contains('400'));
    });

    test('lo rechazado se queda a la vista hasta que alguien lo descarta',
        () async {
      // Una orden que se dio y nunca se cumplió tiene que dejar rastro: si
      // desapareciera sola, mañana faltaría una cita y no habría forma de saber
      // por qué.
      servidor.responde = (p) => 400;
      await bandeja.encolar(_alta('Cliente', 'k1'));
      await bandeja.enviar(cliente, manifiesto);

      expect(bandeja.vacia, isFalse);
      expect(bandeja.esperando, isEmpty);
      expect(bandeja.rechazadas, hasLength(1));

      // Y sigue ahí tras cerrar la app.
      final resucitada = Bandeja(almacen);
      await resucitada.cargar();
      expect(resucitada.rechazadas, hasLength(1));

      await resucitada.descartar(resucitada.ordenes.single);
      expect(resucitada.vacia, isTrue);
    });

    test('una orden rechazada no se reintenta en el siguiente vaciado',
        () async {
      servidor.responde = (p) => p.ruta == '/api/clientes' ? 400 : 200;
      await bandeja.encolar(_alta('Cliente', 'k1'));
      await bandeja.enviar(cliente, manifiesto);

      servidor.responde = (p) => 200;
      await bandeja.enviar(cliente, manifiesto);

      expect(servidor.peticiones, hasLength(1));
    });

    test('si la entidad ya no está en el modelo, se dice en vez de adivinar',
        () async {
      // El diagrama cambió mientras la orden esperaba. No hay ruta a la que
      // mandarla y tampoco se puede inventar una.
      await bandeja.encolar(_alta('Sucursal', 'k1'));
      await bandeja.encolar(_alta('Producto', 'k2'));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(resultado.rechazadas, 1);
      expect(resultado.enviadas, 1);
      expect(bandeja.rechazadas.single.ultimoError, contains('Sucursal'));
      expect(servidor.rutas, ['POST /api/productos'],
          reason: 'no se pide una ruta que no existe en el manifiesto');
    });
  });

  group('reenviar un borrado', () {
    test('un 404 al repetirlo es el resultado que se pedía, no un fallo',
        () async {
      // Es el caso central: la primera petición llegó, la respuesta se perdió.
      // Desde el teléfono eso es idéntico a que no llegara. Si el registro ya
      // no está, el borrado se cumplió.
      servidor.responde = (p) => 404;
      await bandeja.encolar(OrdenPendiente(
        metodo: 'DELETE',
        entidad: 'Pedido',
        registroId: 7,
        clave: 'borrar-7-xyz',
        resumen: 'Borro el pedido 7',
      ));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(servidor.rutas, ['DELETE /api/pedidos/7']);
      expect(resultado.enviadas, 1);
      expect(bandeja.vacia, isTrue);
      expect(bandeja.rechazadas, isEmpty);
    });

    test('un 404 al cambiar un registro sí es un fallo', () async {
      // La misma respuesta con otro significado: nadie pidió que el registro
      // dejara de existir, así que aquí el 404 es una orden que no se cumplió.
      servidor.responde = (p) => 404;
      await bandeja.encolar(OrdenPendiente(
        metodo: 'PUT',
        entidad: 'Cliente',
        registroId: 4,
        clave: 'k1',
        resumen: 'Cambio el email',
        cuerpo: <String, dynamic>{'email': 'ana@ejemplo.com'},
      ));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(resultado.rechazadas, 1);
      expect(bandeja.rechazadas, hasLength(1));
    });

    test('un 500 al borrar se conserva para intentarlo luego', () async {
      servidor.responde = (p) => 500;
      await bandeja.encolar(OrdenPendiente(
        metodo: 'DELETE',
        entidad: 'Pedido',
        registroId: 7,
        clave: 'k1',
        resumen: 'Borro el pedido 7',
      ));

      final resultado = await bandeja.enviar(cliente, manifiesto);

      expect(resultado.quedan, 1);
      expect(bandeja.rechazadas, isEmpty);
    });
  });

  group('el fichero de la bandeja', () {
    late Directory carpeta;

    setUp(() async {
      carpeta = await Directory.systemTemp.createTemp('bandeja_prueba');
    });

    tearDown(() async {
      if (await carpeta.exists()) await carpeta.delete(recursive: true);
    });

    test('ida y vuelta por disco sin dejar restos', () async {
      final almacenReal = AlmacenEnFichero(carpeta);
      final guardada = Bandeja(almacenReal);
      await guardada.encolar(_alta('Cliente', 'k1', nombre: 'Ana Pérez'));

      final leida = Bandeja(almacenReal);
      await leida.cargar();

      expect(leida.ordenes.single.cuerpo, {'nombre': 'Ana Pérez'});
      expect(leida.ordenes.single.clave, 'k1');
      // El temporal del renombrado atómico no puede quedarse por medio.
      expect(await File('${carpeta.path}/bandeja.json.tmp').exists(), isFalse);
    });

    test('sin fichero todavía, la bandeja está vacía y no falla', () async {
      final bandejaNueva = Bandeja(AlmacenEnFichero(carpeta));
      await bandejaNueva.cargar();
      expect(bandejaNueva.vacia, isTrue);
    });

    test('un fichero corrupto no impide arrancar', () async {
      // Se pierde lo pendiente, que es malo, pero se pierde una vez y con la
      // app viva. La alternativa es una app que ya no abre nunca más.
      await File('${carpeta.path}/bandeja.json').writeAsString('{ esto no es');

      final bandejaNueva = Bandeja(AlmacenEnFichero(carpeta));
      await bandejaNueva.cargar();

      expect(bandejaNueva.vacia, isTrue);
    });

    test('un JSON válido que no es una lista tampoco tumba la carga', () async {
      await File('${carpeta.path}/bandeja.json').writeAsString('{"a":1}');

      final bandejaNueva = Bandeja(AlmacenEnFichero(carpeta));
      await bandejaNueva.cargar();

      expect(bandejaNueva.vacia, isTrue);
    });
  });
}
