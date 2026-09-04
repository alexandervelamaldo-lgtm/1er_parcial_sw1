/// Cliente HTTP contra un backend generado.
///
/// Usa `dart:io` y no un paquete de pub a propósito. La app tiene que compilar
/// y arrancar el día de la defensa aunque no haya red para resolver
/// dependencias, y `HttpClient` viene en el SDK. De regalo, las pruebas pueden
/// levantar un `HttpServer` de verdad en el mismo proceso y ejercitar cabeceras,
/// códigos y reintentos sin necesitar ni PostgreSQL ni Spring.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'manifiesto.dart';

/// Ruta fija donde todo backend generado publica su manifiesto.
const String rutaManifiesto = '/asistente/manifiesto';

/// El servidor respondió, pero con un código que no es de éxito.
class ErrorHttp implements Exception {
  const ErrorHttp({
    required this.estado,
    required this.mensaje,
    this.erroresDeCampo = const <String, String>{},
  });

  final int estado;
  final String mensaje;

  /// `fieldErrors` de `ErrorResponse`: qué campo concreto rechazó la validación.
  /// Es lo que permite pintar el error debajo del campo y no en un aviso suelto.
  final Map<String, String> erroresDeCampo;

  bool get esValidacion => estado == 400 || estado == 422;
  bool get esConflicto => estado == 409;
  bool get noExiste => estado == 404;

  @override
  String toString() => mensaje;
}

/// No se llegó al servidor: cable, wifi, servidor caído o URL equivocada.
class ErrorDeRed implements Exception {
  const ErrorDeRed(this.mensaje);

  final String mensaje;

  @override
  String toString() => mensaje;
}

/// Una página de resultados, tal y como la serializa `Page<T>` de Spring Data.
class Pagina {
  const Pagina({
    required this.contenido,
    required this.total,
    required this.numero,
    required this.tamano,
  });

  final List<Map<String, dynamic>> contenido;
  final int total;
  final int numero;
  final int tamano;

  bool get hayMas => (numero + 1) * tamano < total;

  factory Pagina.desdeJson(Map<String, dynamic> json) {
    final contenido = json['content'];
    return Pagina(
      contenido: contenido is List
          ? contenido.whereType<Map<String, dynamic>>().toList(growable: false)
          : const <Map<String, dynamic>>[],
      total: json['totalElements'] as int? ?? 0,
      numero: json['number'] as int? ?? 0,
      tamano: json['size'] as int? ?? 20,
    );
  }
}

/// Resultado de pedir el manifiesto cuando ya se tenía uno guardado.
class RespuestaManifiesto {
  const RespuestaManifiesto({required this.manifiesto, required this.etag, required this.sinCambios});

  final Manifiesto? manifiesto;
  final String? etag;

  /// El servidor contestó 304: lo que ya había sigue valiendo.
  final bool sinCambios;
}

class ClienteRest {
  ClienteRest(this.base, {HttpClient? http})
      : _http = http ?? (HttpClient()..connectionTimeout = const Duration(seconds: 8));

  /// Origen del backend, sin barra final: `http://localhost:8080`.
  final Uri base;

  final HttpClient _http;

  void cerrar() => _http.close(force: true);

  /// Descarga el manifiesto. Si se pasa [etagPrevio], manda `If-None-Match` y
  /// puede volver con `sinCambios` en vez de con el documento entero: la app
  /// pregunta en cada arranque y la mayoría de los arranques no traen novedad.
  Future<RespuestaManifiesto> descargarManifiesto({String? etagPrevio}) async {
    final respuesta = await _enviar(
      'GET',
      rutaManifiesto,
      cabeceras: etagPrevio == null ? null : {'If-None-Match': etagPrevio},
      aceptar304: true,
    );

    if (respuesta.estado == HttpStatus.notModified) {
      return RespuestaManifiesto(manifiesto: null, etag: etagPrevio, sinCambios: true);
    }

    final cuerpo = jsonDecode(respuesta.cuerpo);
    if (cuerpo is! Map<String, dynamic>) {
      throw const ManifiestoInvalido('la respuesta no es un objeto JSON');
    }
    return RespuestaManifiesto(
      manifiesto: Manifiesto.desdeJson(cuerpo),
      etag: respuesta.cabecera('etag'),
      sinCambios: false,
    );
  }

  Future<Pagina> listar(
    Manifiesto manifiesto,
    EntidadManifiesto entidad, {
    int pagina = 0,
    int tamano = 20,
  }) async {
    final respuesta = await _enviar(
      'GET',
      '${manifiesto.baseUrl}${entidad.ruta}?page=$pagina&size=$tamano',
    );
    final cuerpo = jsonDecode(respuesta.cuerpo);
    if (cuerpo is! Map<String, dynamic>) {
      throw const ErrorHttp(estado: 200, mensaje: 'La lista no llegó paginada');
    }
    return Pagina.desdeJson(cuerpo);
  }

  Future<Map<String, dynamic>> obtener(
    Manifiesto manifiesto,
    EntidadManifiesto entidad,
    Object id,
  ) async {
    final respuesta = await _enviar(
      'GET',
      '${manifiesto.baseUrl}${entidad.ruta}/${Uri.encodeComponent('$id')}',
    );
    return jsonDecode(respuesta.cuerpo) as Map<String, dynamic>;
  }

  /// Crea un registro.
  ///
  /// [claveIdempotencia] la genera quien inicia la orden —al pulsar «Guardar»,
  /// al terminar de dictar—, **no** este método. Si se generase aquí, cada
  /// reintento traería una clave distinta y no habría nada que comparar: es
  /// exactamente el caso que la cabecera existe para impedir.
  Future<Map<String, dynamic>> crear(
    Manifiesto manifiesto,
    EntidadManifiesto entidad,
    Map<String, dynamic> datos, {
    String? claveIdempotencia,
  }) async {
    final respuesta = await _enviar(
      'POST',
      '${manifiesto.baseUrl}${entidad.ruta}',
      cuerpo: datos,
      cabeceras: _idempotencia(manifiesto, claveIdempotencia),
    );
    return jsonDecode(respuesta.cuerpo) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> actualizar(
    Manifiesto manifiesto,
    EntidadManifiesto entidad,
    Object id,
    Map<String, dynamic> datos, {
    String? claveIdempotencia,
  }) async {
    final respuesta = await _enviar(
      'PUT',
      '${manifiesto.baseUrl}${entidad.ruta}/${Uri.encodeComponent('$id')}',
      cuerpo: datos,
      cabeceras: _idempotencia(manifiesto, claveIdempotencia),
    );
    return jsonDecode(respuesta.cuerpo) as Map<String, dynamic>;
  }

  Future<void> borrar(
    Manifiesto manifiesto,
    EntidadManifiesto entidad,
    Object id, {
    String? claveIdempotencia,
  }) async {
    await _enviar(
      'DELETE',
      '${manifiesto.baseUrl}${entidad.ruta}/${Uri.encodeComponent('$id')}',
      cabeceras: _idempotencia(manifiesto, claveIdempotencia),
    );
  }

  /// Solo se manda la cabecera si el manifiesto dice que el backend la entiende.
  /// Mandarla a un servidor que la ignora no rompe nada, pero deja al usuario
  /// creyendo que está protegido cuando no lo está.
  Map<String, String>? _idempotencia(Manifiesto manifiesto, String? clave) {
    final nombre = manifiesto.cabeceraIdempotencia;
    if (clave == null || nombre == null) return null;
    return {nombre: clave};
  }

  Future<_Respuesta> _enviar(
    String metodo,
    String ruta, {
    Map<String, dynamic>? cuerpo,
    Map<String, String>? cabeceras,
    bool aceptar304 = false,
  }) async {
    final uri = base.resolve(ruta);
    HttpClientResponse respuesta;
    String texto;
    try {
      final peticion = await _http.openUrl(metodo, uri);
      peticion.headers.set(HttpHeaders.acceptHeader, 'application/json');
      cabeceras?.forEach(peticion.headers.set);
      if (cuerpo != null) {
        final bytes = utf8.encode(jsonEncode(cuerpo));
        peticion.headers.contentType = ContentType('application', 'json', charset: 'utf-8');
        peticion.headers.contentLength = bytes.length;
        peticion.add(bytes);
      }
      respuesta = await peticion.close().timeout(const Duration(seconds: 20));
      texto = await respuesta.transform(utf8.decoder).join();
    } on TimeoutException {
      throw ErrorDeRed('El servidor de $uri no contestó a tiempo.');
    } on SocketException catch (e) {
      throw ErrorDeRed('No se pudo conectar con ${base.host}:${base.port}. ${e.osError?.message ?? ''}'.trim());
    } on HttpException catch (e) {
      throw ErrorDeRed(e.message);
    }

    final estado = respuesta.statusCode;
    if (estado == HttpStatus.notModified && aceptar304) {
      return _Respuesta(estado, texto, respuesta.headers);
    }
    if (estado >= 200 && estado < 300) {
      return _Respuesta(estado, texto, respuesta.headers);
    }
    throw _interpretarError(estado, texto);
  }

  /// Convierte el cuerpo de error en algo que se pueda enseñar.
  ///
  /// El filtro de idempotencia responde antes que `@RestControllerAdvice`, así
  /// que hay caminos —una clave con forma inválida— en los que el JSON lo
  /// escribe el filtro a mano. Ambos usan la forma de `ErrorResponse`, pero un
  /// proxy por medio puede devolver HTML; por eso el `jsonDecode` va protegido.
  ErrorHttp _interpretarError(int estado, String cuerpo) {
    try {
      final json = jsonDecode(cuerpo);
      if (json is Map<String, dynamic>) {
        final campos = json['fieldErrors'];
        return ErrorHttp(
          estado: estado,
          mensaje: (json['message'] as String?)?.trim().isNotEmpty == true
              ? json['message'] as String
              : (json['error'] as String? ?? 'Error $estado'),
          erroresDeCampo: campos is Map
              ? campos.map((k, v) => MapEntry('$k', '$v'))
              : const <String, String>{},
        );
      }
    } on FormatException {
      // Cae al mensaje genérico de abajo.
    }
    return ErrorHttp(estado: estado, mensaje: 'El servidor respondió $estado');
  }
}

class _Respuesta {
  const _Respuesta(this.estado, this.cuerpo, this._cabeceras);

  final int estado;
  final String cuerpo;
  final HttpHeaders _cabeceras;

  String? cabecera(String nombre) => _cabeceras.value(nombre);
}

/// Genera una clave de idempotencia con la forma que acepta el filtro:
/// `^[A-Za-z0-9_.:-]{8,120}$`.
///
/// Se llama al **empezar** la orden y se guarda con ella. `Random.secure()` no
/// es por criptografía sino por unicidad: dos móviles dictando a la vez no
/// deben chocar, y el generador por defecto se siembra con el reloj.
String nuevaClaveIdempotencia([String prefijo = 'app']) {
  const alfabeto = 'abcdefghijklmnopqrstuvwxyz0123456789';
  final azar = Random.secure();
  final sufijo = List.generate(24, (_) => alfabeto[azar.nextInt(alfabeto.length)]).join();
  return '$prefijo-$sufijo';
}
