import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'token.dart';

/// Dónde se queda el token entre dos aperturas de la aplicación.
///
/// La interfaz existe para que todo lo de arriba —la pantalla de acceso, el
/// puente con la página, la decisión de pedir la huella— se pueda probar sin
/// Keystore, que en un `flutter test` no existe. La implementación de verdad
/// está abajo y es deliberadamente tonta: si tuviera lógica, esa lógica sería
/// justo la que no se puede probar.
abstract class AlmacenSesion {
  Future<SesionGuardada?> leer();
  Future<void> guardar(SesionGuardada sesion);
  Future<void> borrar();

  /// Si esta persona pidió que se le exija la huella al abrir.
  Future<bool> exigeHuella();
  Future<void> anotarExigeHuella(bool exigir);
}

/// El almacén cifrado del sistema.
///
/// ## Qué cambia respecto al `localStorage` del WebView
///
/// En Android esto es `EncryptedSharedPreferences`: los valores se cifran con
/// AES-GCM y la clave la genera y la guarda el Keystore del aparato, que es
/// hardware dedicado en los teléfonos modernos. La clave **no se puede
/// exportar**: el sistema cifra y descifra por cuenta de esta aplicación y
/// nunca entrega el material. Comparado con lo que había —un fichero de texto
/// dentro del directorio de datos— la diferencia práctica es que una copia de
/// seguridad del sistema o un volcado del almacenamiento con root ya no
/// contienen un token utilizable.
///
/// Lo que esto **no** arregla, y conviene no creerse lo contrario: un teléfono
/// desbloqueado en manos de otro sigue pudiendo abrir la aplicación. Contra eso
/// está la huella, que es lo de al lado y por eso es opcional.
class AlmacenSeguro implements AlmacenSesion {
  AlmacenSeguro({FlutterSecureStorage? almacen})
    : _almacen =
          almacen ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(
              // Sin esto, el respaldo automático de Android se lleva el fichero
              // cifrado a la nube y lo restaura en otro aparato, donde no hay
              // ninguna clave del Keystore que pueda descifrarlo. Lo que llega
              // no es un token robado: es un valor ilegible que hace fallar la
              // lectura en el arranque de un teléfono nuevo. Fuera del respaldo,
              // el aparato nuevo simplemente pide la contraseña, que es lo
              // correcto.
              resetOnError: true,
            ),
          );

  final FlutterSecureStorage _almacen;

  static const String _claveSesion = 'sesion.actual';
  static const String _claveHuella = 'sesion.exigir-huella';

  @override
  Future<SesionGuardada?> leer() async {
    final crudo = await _almacen.read(key: _claveSesion);
    if (crudo == null) return null;
    final sesion = SesionGuardada.deJson(crudo);
    // Lo ilegible se borra en vez de dejarlo estorbando. Llega aquí cuando el
    // formato cambió entre versiones del APK, y conservarlo solo garantiza
    // repetir el mismo fallo en cada arranque.
    if (sesion == null) await _almacen.delete(key: _claveSesion);
    return sesion;
  }

  @override
  Future<void> guardar(SesionGuardada sesion) =>
      _almacen.write(key: _claveSesion, value: jsonEncode(sesion.aJson()));

  @override
  Future<void> borrar() => _almacen.delete(key: _claveSesion);

  @override
  Future<bool> exigeHuella() async =>
      await _almacen.read(key: _claveHuella) == 'si';

  @override
  Future<void> anotarExigeHuella(bool exigir) =>
      _almacen.write(key: _claveHuella, value: exigir ? 'si' : 'no');
}
