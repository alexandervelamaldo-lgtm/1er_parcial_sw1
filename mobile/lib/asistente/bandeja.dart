import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import 'cliente_rest.dart';
import 'manifiesto.dart';

/// La bandeja de salida: lo que se pidió sin cobertura y aún no ha llegado.
///
/// Es la pieza que convierte «hay que tener internet» en «hay que tener
/// internet en algún momento». El barbero dicta la cita en un sótano sin señal,
/// la app le dice que queda apuntada, y cuando el teléfono vuelve a ver la red
/// la manda sola. Sin esto, la promesa de funcionar sin conexión se reduce a
/// que la pantalla no se rompe, que no es lo mismo.
///
/// Todo lo delicado de este fichero sale de una única pregunta: **¿qué pasa si
/// la primera petición sí llegó al servidor y lo que se perdió fue la
/// respuesta?** Desde el teléfono los dos casos son idénticos —un socket que se
/// corta—, así que reintentar a ciegas duplicaría el registro la mitad de las
/// veces. Lo que lo impide es que cada orden guarda **la clave de idempotencia
/// con la que se emitió**: el backend generado ya sabe que una clave repetida
/// con el mismo cuerpo no es una orden nueva, sino la misma otra vez, y
/// devuelve la respuesta que guardó. La clave viaja aparcada en disco junto a
/// la orden precisamente para que el reintento pueda ser el mismo.

/// Dónde se guarda lo pendiente entre arranques.
///
/// Es una interfaz y no un `File` directo para que las pruebas no toquen el
/// disco: una prueba que escribe ficheros es una prueba que falla distinto
/// según qué se ejecutó antes.
abstract class AlmacenBandeja {
  Future<List<Map<String, dynamic>>> leer();
  Future<void> escribir(List<Map<String, dynamic>> ordenes);
}

/// Un fichero JSON en el directorio privado de la app.
///
/// La carpeta se admite como `Future` porque en Android sale de
/// `getApplicationDocumentsDirectory()`, que es asíncrona, y la sesión se
/// construye en el `initState` de una pantalla, que no lo es. Guardar la promesa
/// evita tener que retrasar el arranque de la app hasta que el sistema conteste.
class AlmacenEnFichero implements AlmacenBandeja {
  AlmacenEnFichero(this.carpeta);

  final FutureOr<Directory> carpeta;

  Future<File> get _fichero async =>
      File('${(await carpeta).path}/bandeja.json');
  Future<File> get _temporal async =>
      File('${(await carpeta).path}/bandeja.json.tmp');

  @override
  Future<List<Map<String, dynamic>>> leer() async {
    final fichero = await _fichero;
    if (!await fichero.exists()) return <Map<String, dynamic>>[];
    try {
      final crudo = jsonDecode(await fichero.readAsString());
      if (crudo is! List) return <Map<String, dynamic>>[];
      return crudo.whereType<Map<String, dynamic>>().toList();
    } on FormatException {
      // Un fichero ilegible no puede impedir que la app arranque. Se pierde lo
      // pendiente —que es malo— pero se pierde una vez y con la app viva, en
      // vez de dejarla sin abrir para siempre.
      return <Map<String, dynamic>>[];
    }
  }

  @override
  Future<void> escribir(List<Map<String, dynamic>> ordenes) async {
    await (await carpeta).create(recursive: true);
    final temporal = await _temporal;
    // Se escribe al lado y se renombra encima. El renombrado es atómico para el
    // sistema de ficheros: si Android mata la app a mitad, o queda la bandeja
    // vieja entera o la nueva entera, nunca media. Escribir directamente sobre
    // el fichero bueno cambia «pierdo la última orden» por «pierdo todas».
    await temporal.writeAsString(jsonEncode(ordenes), flush: true);
    await temporal.rename((await _fichero).path);
  }
}

/// Para las pruebas y para arrancar si el disco falla.
class AlmacenEnMemoria implements AlmacenBandeja {
  List<Map<String, dynamic>> _ordenes = <Map<String, dynamic>>[];

  @override
  Future<List<Map<String, dynamic>>> leer() async => _ordenes;

  @override
  Future<void> escribir(List<Map<String, dynamic>> ordenes) async =>
      _ordenes = ordenes;
}

/// Una escritura que se quedó por mandar.
class OrdenPendiente {
  OrdenPendiente({
    required this.metodo,
    required this.entidad,
    required this.clave,
    required this.resumen,
    this.registroId,
    this.cuerpo,
    DateTime? creada,
    this.intentos = 0,
    this.ultimoError,
    this.rechazada = false,
  }) : creada = creada ?? DateTime.now();

  /// `POST`, `PUT` o `DELETE`. Los `GET` no se encolan: leer sin conexión no
  /// se resuelve reintentando más tarde, se resuelve enseñando lo que hay.
  final String metodo;

  /// El **nombre** de la entidad, no la entidad. Lo que se aparca tiene que
  /// sobrevivir a cerrar la app, y un `EntidadManifiesto` no cabe en un JSON;
  /// además el manifiesto puede haber cambiado al volver, y entonces hay que
  /// enterarse en vez de mandar la orden a una ruta que ya no existe.
  final String entidad;

  final Object? registroId;
  final Map<String, dynamic>? cuerpo;

  /// La misma con la que se intentó la primera vez. Es toda la razón de ser de
  /// este fichero: cambiarla convertiría el reintento en un alta nueva.
  final String clave;

  /// Qué contarle a quien mira la bandeja: «Doy de alta cliente: Ana Pérez».
  /// Se guarda ya redactado porque al reenviar puede que el manifiesto que
  /// sabía decirlo ya no esté.
  final String resumen;

  final DateTime creada;

  int intentos;
  String? ultimoError;

  /// El servidor la rechazó por algo que no se arregla reintentando.
  ///
  /// Se queda a la vista en vez de desaparecer: una orden que el usuario dio y
  /// que nunca se cumplió tiene que dejar rastro, o la próxima vez que mire la
  /// agenda faltará una cita y no habrá forma de saber por qué.
  bool rechazada;

  Map<String, dynamic> aJson() => <String, dynamic>{
        'metodo': metodo,
        'entidad': entidad,
        'registroId': registroId,
        'cuerpo': cuerpo,
        'clave': clave,
        'resumen': resumen,
        'creada': creada.toIso8601String(),
        'intentos': intentos,
        'ultimoError': ultimoError,
        'rechazada': rechazada,
      };

  static OrdenPendiente? desdeJson(Map<String, dynamic> json) {
    final metodo = json['metodo'];
    final entidad = json['entidad'];
    final clave = json['clave'];
    // Una entrada mal formada se descarta en vez de tumbar la carga entera:
    // el resto de la bandeja sigue siendo bueno y no tiene culpa.
    if (metodo is! String || entidad is! String || clave is! String) return null;
    final cuerpo = json['cuerpo'];
    return OrdenPendiente(
      metodo: metodo,
      entidad: entidad,
      clave: clave,
      resumen: json['resumen'] as String? ?? '$metodo $entidad',
      registroId: json['registroId'],
      cuerpo: cuerpo is Map<String, dynamic> ? cuerpo : null,
      creada: DateTime.tryParse(json['creada'] as String? ?? ''),
      intentos: json['intentos'] as int? ?? 0,
      ultimoError: json['ultimoError'] as String?,
      rechazada: json['rechazada'] as bool? ?? false,
    );
  }
}

/// Cómo fue el vaciado de la bandeja.
class ResultadoEnvio {
  const ResultadoEnvio({
    required this.enviadas,
    required this.rechazadas,
    required this.quedan,
    this.corteDeRed,
  });

  final int enviadas;
  final int rechazadas;
  final int quedan;

  /// El motivo por el que se paró, si se paró por no llegar al servidor.
  final String? corteDeRed;

  bool get huboAlgo => enviadas > 0 || rechazadas > 0;
}

class Bandeja extends ChangeNotifier {
  Bandeja(this._almacen);

  final AlmacenBandeja _almacen;
  final List<OrdenPendiente> _ordenes = <OrdenPendiente>[];

  bool _enviando = false;

  List<OrdenPendiente> get ordenes => List.unmodifiable(_ordenes);

  /// Las que todavía pueden salir. Las rechazadas no cuentan: ya no van a ir.
  List<OrdenPendiente> get esperando =>
      _ordenes.where((o) => !o.rechazada).toList(growable: false);

  List<OrdenPendiente> get rechazadas =>
      _ordenes.where((o) => o.rechazada).toList(growable: false);

  bool get vacia => _ordenes.isEmpty;
  bool get enviando => _enviando;

  /// Lo que no se pudo leer del disco, si pasó algo.
  String? get errorAlCargar => _errorAlCargar;
  String? _errorAlCargar;

  Future<void> cargar() async {
    List<Map<String, dynamic>> crudas;
    try {
      crudas = await _almacen.leer();
      _errorAlCargar = null;
    } on Exception catch (e) {
      // Un disco que no responde no puede dejar la app sin abrir. Se arranca sin
      // bandeja y se deja dicho, en vez de morir en el `initState`.
      _errorAlCargar = 'No se pudo leer lo que quedó pendiente: $e';
      crudas = <Map<String, dynamic>>[];
    }
    _ordenes
      ..clear()
      ..addAll(crudas.map(OrdenPendiente.desdeJson).whereType<OrdenPendiente>());
    notifyListeners();
  }

  Future<void> encolar(OrdenPendiente orden) async {
    _ordenes.add(orden);
    await _guardar();
    notifyListeners();
  }

  /// Quita una orden rechazada que el usuario ya ha visto.
  Future<void> descartar(OrdenPendiente orden) async {
    _ordenes.remove(orden);
    await _guardar();
    notifyListeners();
  }

  Future<void> _guardar() =>
      _almacen.escribir(_ordenes.map((o) => o.aJson()).toList(growable: false));

  /// Intenta mandar todo lo pendiente, en el orden en que se pidió.
  ///
  /// El orden importa y no es un detalle: si se dictó «nuevo cliente Ana» y
  /// después «cambia el email de Ana», mandar el segundo primero es un 404. Por
  /// eso se recorre en el orden en que se encolaron y **se para en cuanto una
  /// falla por red**: si no se llega al servidor para la primera, tampoco se va
  /// a llegar para la siguiente, y seguir intentándolo solo serviría para
  /// gastar batería y para saltarse el orden.
  Future<ResultadoEnvio> enviar(ClienteRest cliente, Manifiesto manifiesto) async {
    if (_enviando) {
      return ResultadoEnvio(enviadas: 0, rechazadas: 0, quedan: esperando.length);
    }
    _enviando = true;
    notifyListeners();

    var enviadas = 0;
    var rechazadas = 0;
    String? corte;

    try {
      // Sobre una copia: `enviar` quita elementos de `_ordenes` según avanza.
      for (final orden in List<OrdenPendiente>.from(_ordenes)) {
        if (orden.rechazada) continue;

        final entidad = manifiesto.entidadPorNombre(orden.entidad);
        if (entidad == null) {
          // El diagrama cambió mientras la orden esperaba. No se puede mandar y
          // tampoco se puede adivinar dónde: se marca y se enseña.
          _marcar(orden, 'La entidad «${orden.entidad}» ya no existe en el '
              'modelo. La orden no se puede enviar.');
          rechazadas++;
          continue;
        }

        try {
          await _mandar(cliente, manifiesto, entidad, orden);
          _ordenes.remove(orden);
          enviadas++;
        } on ErrorDeRed catch (e) {
          orden.intentos++;
          orden.ultimoError = e.mensaje;
          corte = e.mensaje;
          break;
        } on ErrorHttp catch (e) {
          orden.intentos++;
          if (_seArreglaEsperando(e)) {
            // 5xx o 429: el servidor está, pero no puede ahora. Se conserva y
            // se corta, igual que con un fallo de red.
            orden.ultimoError = e.mensaje;
            corte = e.mensaje;
            break;
          }
          // 4xx: reintentarlo mil veces daría mil veces lo mismo, y de paso
          // taponaría todo lo que venga detrás. Se aparta y se sigue.
          _marcar(orden, e.mensaje);
          rechazadas++;
        }
      }
    } finally {
      _enviando = false;
      await _guardar();
      notifyListeners();
    }

    return ResultadoEnvio(
      enviadas: enviadas,
      rechazadas: rechazadas,
      quedan: esperando.length,
      corteDeRed: corte,
    );
  }

  Future<void> _mandar(
    ClienteRest cliente,
    Manifiesto manifiesto,
    EntidadManifiesto entidad,
    OrdenPendiente orden,
  ) async {
    switch (orden.metodo) {
      case 'POST':
        await cliente.crear(
          manifiesto,
          entidad,
          orden.cuerpo ?? const <String, dynamic>{},
          claveIdempotencia: orden.clave,
        );
      case 'PUT':
        await cliente.actualizar(
          manifiesto,
          entidad,
          orden.registroId!,
          orden.cuerpo ?? const <String, dynamic>{},
          claveIdempotencia: orden.clave,
        );
      case 'DELETE':
        try {
          await cliente.borrar(
            manifiesto,
            entidad,
            orden.registroId!,
            claveIdempotencia: orden.clave,
          );
        } on ErrorHttp catch (e) {
          // Un 404 al reenviar un borrado no es un fallo: es el resultado que
          // se pedía. Lo más probable es que la primera petición sí llegara y
          // lo que se perdiera fuera la respuesta. Tratarlo como error dejaría
          // en la bandeja, marcada en rojo, una orden que ya se cumplió.
          if (!e.noExiste) rethrow;
        }
      default:
        throw StateError('Método no soportado en la bandeja: ${orden.metodo}');
    }
  }

  void _marcar(OrdenPendiente orden, String motivo) {
    orden.rechazada = true;
    orden.ultimoError = motivo;
  }

  /// Si el código dice «vuelve más tarde» o «esto está mal y seguirá mal».
  bool _seArreglaEsperando(ErrorHttp e) => e.estado >= 500 || e.estado == 429;
}
