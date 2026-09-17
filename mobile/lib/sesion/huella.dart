import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

/// El desbloqueo local del teléfono, detrás de una interfaz que se puede fingir.
///
/// ## Qué protege esto y qué no
///
/// No protege el token: eso ya lo hace el Keystore. Protege el hueco que el
/// Keystore no cubre —un teléfono desbloqueado en manos de otra persona— y solo
/// ese. Conviene tenerlo claro porque marca hasta dónde hay que esforzarse: la
/// huella aquí no descifra nada ni deriva ninguna clave; es una puerta delante
/// de una sesión que ya está descifrada. Quien tenga el aparato con root pasa
/// por el lado.
///
/// Por eso es **opcional** y por eso está apagada por omisión. Una app que
/// exige huella para ver un diagrama de clases y no la puede pedir —sensor
/// estropeado, huellas borradas— se convierte en una app que no se abre, y eso
/// es un daño real a cambio de una protección modesta.
///
/// ## Por qué hay interfaz
///
/// `local_auth` habla con el sistema por un canal de plataforma que en
/// `flutter test` no existe: cualquier llamada se queda colgada o lanza. Todo
/// lo que decide algo —`pasoDeArranque` en `token.dart`, la pantalla— trabaja
/// contra este contrato y se prueba con una implementación de mentira.
abstract class Desbloqueo {
  /// Si el aparato puede autenticar localmente ahora mismo.
  ///
  /// «Ahora mismo» es lo importante: no es si tiene sensor, sino si hay algo
  /// registrado y utilizable en este momento. Cambia con el tiempo sin que la
  /// app haga nada.
  Future<bool> disponible();

  /// Pide la huella. `true` si se confirmó.
  Future<bool> pedir(String motivo);
}

class DesbloqueoDelSistema implements Desbloqueo {
  DesbloqueoDelSistema({LocalAuthentication? autenticacion})
    : _auth = autenticacion ?? LocalAuthentication();

  final LocalAuthentication _auth;

  @override
  Future<bool> disponible() async {
    try {
      // Las dos condiciones, y no solo la primera. `isDeviceSupported` dice que
      // el aparato sabe; `canCheckBiometrics` dice que hay algo registrado. Con
      // solo la primera, un teléfono con sensor y sin ninguna huella dada de
      // alta pasaría por capaz, y la protección se activaría para no poder
      // cumplirse nunca.
      if (!await _auth.isDeviceSupported()) return false;
      return await _auth.canCheckBiometrics;
    } on PlatformException {
      // No saber si se puede es lo mismo que no poder. Esta rama se recorre en
      // aparatos donde el servicio biométrico no responde, y ahí lo correcto es
      // caer a la contraseña en vez de dejar la pantalla esperando.
      return false;
    }
  }

  @override
  Future<bool> pedir(String motivo) async {
    try {
      return await _auth.authenticate(
        localizedReason: motivo,
        options: const AuthenticationOptions(
          // Se admite también el PIN o el patrón de la pantalla. Con la huella
          // a secas, un dedo mojado deja a su dueño fuera de su propia sesión
          // sin más salida que desinstalar.
          biometricOnly: false,
          // Volver del segundo plano no debe repetir la pregunta: el diálogo lo
          // levanta el sistema por encima de la app, y con `stickyAuth` a falso
          // ese propio cambio de foco la cancelaría sola.
          stickyAuth: true,
        ),
      );
    } on PlatformException {
      // Cancelar, agotar los intentos o no tener el servicio disponible acaban
      // todos aquí. Ninguno es un fallo de la aplicación: significan «no se
      // autenticó», y la pantalla ofrece la contraseña.
      return false;
    }
  }
}
