/// Lo que la app sabe del backend al que está conectada.
///
/// Es deliberadamente poco: una URL, un manifiesto y su ETag. La app no guarda
/// ningún modelo de dominio propio porque no tiene ninguno —no sabe qué es un
/// pedido ni una cita— y esa ignorancia es justo lo que le permite servir a
/// todos los proyectos generados sin recompilar.
library;

import 'package:flutter/foundation.dart';

import 'cliente_rest.dart';
import 'manifiesto.dart';

/// Backend por defecto, inyectable al compilar con
/// `--dart-define=BACKEND_URL=...`.
///
/// `localhost` es la ruta de la defensa: con `adb reverse tcp:8080 tcp:8080` el
/// teléfono pide su propio localhost y el túnel por cable lo lleva al portátil
/// donde corre el Spring Boot generado.
const String backendPorDefecto = String.fromEnvironment(
  'BACKEND_URL',
  defaultValue: 'http://localhost:8080',
);

class Sesion extends ChangeNotifier {
  Sesion();

  ClienteRest? _cliente;
  Manifiesto? _manifiesto;
  String? _etag;
  String? _error;
  bool _cargando = false;

  Manifiesto? get manifiesto => _manifiesto;
  ClienteRest? get cliente => _cliente;
  String? get error => _error;
  bool get cargando => _cargando;
  bool get conectada => _manifiesto != null && _cliente != null;

  /// Se conecta y descarga el manifiesto. Devuelve `true` si quedó lista.
  ///
  /// Un fallo aquí no deja la sesión a medias: o hay manifiesto válido o no hay
  /// nada. Una app conectada a un backend cuyo manifiesto no se entendió es una
  /// app que va a fallar más tarde y en peor sitio.
  Future<bool> conectar(String url) async {
    _cargando = true;
    _error = null;
    notifyListeners();

    try {
      final base = _normalizar(url);
      final cliente = ClienteRest(base);
      final respuesta = await cliente.descargarManifiesto();
      _cliente?.cerrar();
      _cliente = cliente;
      _manifiesto = respuesta.manifiesto;
      _etag = respuesta.etag;
      return true;
    } on ManifiestoInvalido catch (e) {
      _error = e.mensaje;
    } on ErrorHttp catch (e) {
      _error = e.noExiste
          ? 'Ahí hay un servidor, pero no publica $rutaManifiesto. '
              '¿Es un backend generado por esta herramienta?'
          : e.mensaje;
    } on ErrorDeRed catch (e) {
      _error = e.mensaje;
    } on FormatException {
      _error = 'La respuesta no era JSON. Comprueba la dirección.';
    } finally {
      _cargando = false;
      notifyListeners();
    }
    return false;
  }

  /// Vuelve a preguntar por el manifiesto mandando el ETag que ya se tenía.
  ///
  /// Devuelve `true` si el documento cambió. Es lo que hay que llamar al volver
  /// a primer plano: el diagrama se edita en el portátil mientras la app está
  /// abierta, y sin esto las pantallas se quedan describiendo un modelo viejo.
  Future<bool> refrescar() async {
    final cliente = _cliente;
    if (cliente == null) return false;
    try {
      final respuesta = await cliente.descargarManifiesto(etagPrevio: _etag);
      if (respuesta.sinCambios) return false;
      _manifiesto = respuesta.manifiesto;
      _etag = respuesta.etag;
      notifyListeners();
      return true;
    } on Exception {
      // Que falle un refresco no debe tirar la sesión que ya funcionaba: se
      // sigue con el manifiesto anterior, que es viejo pero utilizable.
      return false;
    }
  }

  void desconectar() {
    _cliente?.cerrar();
    _cliente = null;
    _manifiesto = null;
    _etag = null;
    _error = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _cliente?.cerrar();
    super.dispose();
  }
}

/// Acepta lo que la gente teclea de verdad y lo convierte en un origen.
///
/// «localhost:8080» sin esquema, una barra final de más, una ruta pegada por
/// error. Todo eso se arregla aquí en vez de exigir una URL perfecta, porque el
/// campo se rellena con el pulgar y a veces con prisa.
Uri _normalizar(String texto) {
  var limpio = texto.trim();
  if (limpio.isEmpty) throw const ErrorDeRed('Falta la dirección del servidor.');
  if (!limpio.contains('://')) limpio = 'http://$limpio';

  final uri = Uri.tryParse(limpio);
  if (uri == null || uri.host.isEmpty) {
    throw ErrorDeRed('«$texto» no es una dirección válida.');
  }
  if (uri.scheme != 'http' && uri.scheme != 'https') {
    throw ErrorDeRed('Solo http o https, no «${uri.scheme}».');
  }
  // Se descarta cualquier ruta: las rutas las pone el manifiesto con su
  // `baseUrl`, y dejar aquí un `/api` pegado produciría `/api/api/clientes`.
  return Uri(scheme: uri.scheme, host: uri.host, port: uri.hasPort ? uri.port : null);
}
