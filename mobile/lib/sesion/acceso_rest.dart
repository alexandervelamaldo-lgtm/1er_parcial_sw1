import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'token.dart';

/// La llamada a `POST /api/auth/acceso`, y nada más.
///
/// Usa `dart:io` en vez de un paquete de pub por lo mismo que
/// `asistente/cliente_rest.dart`: `HttpClient` viene en el SDK, así que no hay
/// una dependencia más que resolver el día de la defensa, y las pruebas pueden
/// levantar un `HttpServer` de verdad en el mismo proceso y ejercitar los
/// códigos y los tiempos de espera sin backend.
///
/// Todo lo que se puede decidir sin red está en `token.dart`. Aquí solo queda
/// el viaje.

/// De dónde cuelga la API, deducido de la URL que carga el WebView.
///
/// Se deriva en vez de configurarse aparte porque son forzosamente el mismo
/// servidor: la página que se va a abrir con este token pide `/api/...` en
/// relativo contra su propio origen. Dos ajustes independientes serían dos
/// cosas que pueden discrepar, y la discrepancia daría una sesión válida contra
/// un servidor y rechazada por el otro, con un 401 nada más entrar.
Uri apiDesdeLaApp(String urlAplicacion, String ruta) {
  final base = Uri.parse(urlAplicacion);
  return base.replace(path: ruta, query: null, fragment: null);
}

/// Cuánto se espera al servidor antes de darlo por inalcanzable.
///
/// Corto a propósito. Esto se pulsa delante de gente y el caso frecuente no es
/// un servidor lento sino el túnel USB caído, que no contesta nunca: sin tope,
/// el botón se queda girando hasta que Android decide algo por su cuenta.
const Duration esperaDeAcceso = Duration(seconds: 12);

/// Quién sabe pedir una sesión. Se sustituye en las pruebas de la pantalla.
abstract class ServicioAcceso {
  Future<ResultadoAcceso> entrar(String email, String password);
}

class AccesoPorHttp implements ServicioAcceso {
  AccesoPorHttp({required this.urlAplicacion, HttpClient? cliente})
    : _cliente = cliente ?? HttpClient();

  final String urlAplicacion;
  final HttpClient _cliente;

  @override
  Future<ResultadoAcceso> entrar(String email, String password) async {
    final problema = problemaDeCredenciales(email, password);
    if (problema != null) return AccesoRechazado(problema);

    final destino = apiDesdeLaApp(urlAplicacion, '/api/auth/acceso');
    try {
      final peticion = await _cliente
          .postUrl(destino)
          .timeout(esperaDeAcceso);
      peticion.headers.contentType = ContentType.json;
      peticion.headers.set(HttpHeaders.acceptHeader, 'application/json');
      /*
        La contraseña viaja en el cuerpo y no en la URL, que es lo obvio pero
        merece decirse: una URL acaba en los registros del servidor, en el
        historial del WebView y en las cabeceras `Referer` de todo lo que la
        página cargue después. El cuerpo de un POST no va a ninguno de esos
        sitios.
      */
      peticion.write(jsonEncode({'email': email.trim(), 'password': password}));

      final respuesta = await peticion.close().timeout(esperaDeAcceso);
      final cuerpo = await respuesta
          .transform(utf8.decoder)
          .join()
          .timeout(esperaDeAcceso);
      return interpretarAcceso(respuesta.statusCode, cuerpo);
    } on TimeoutException {
      return AccesoRechazado(_sinRespuesta(destino));
    } on SocketException {
      return AccesoRechazado(_sinRespuesta(destino));
    } on HttpException {
      return AccesoRechazado(_sinRespuesta(destino));
    }
  }

  /// El mismo diagnóstico que la pantalla de error del WebView.
  ///
  /// No llegar al servidor desde el acceso y no llegar desde el WebView son el
  /// mismo problema con dos caras, y contra `localhost` la causa es casi
  /// siempre el túnel por cable. Repetir aquí el comando ahorra tener que
  /// acordarse de él justo cuando no funciona nada.
  String _sinRespuesta(Uri destino) {
    final esLocal = destino.host == 'localhost' || destino.host == '127.0.0.1';
    return esLocal
        ? 'No se llegó a $destino.\n\nCon «localhost» hace falta el túnel por '
              'cable, y hay que repetirlo cada vez que se desconecta:\n\n'
              '    adb reverse tcp:3001 tcp:3001'
        : 'No se llegó a $destino. Compruebe la conexión del teléfono y que el '
              'servidor está levantado.';
  }
}
