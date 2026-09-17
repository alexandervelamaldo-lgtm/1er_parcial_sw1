import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Avisar a la página de que la aplicación volvió del segundo plano.
///
/// ## Qué se rompe sin esto
///
/// El diagrama se sincroniza por un WebSocket, y un WebSocket que muere
/// congelado **no avisa**. Cuando Android detiene el proceso al bloquear la
/// pantalla, la conexión TCP se corta por debajo sin que llegue ningún evento
/// de cierre: no hay nadie despierto a quien mandárselo. Al desbloquear, el
/// WebView reanuda la ejecución con un socket que dice estar abierto y no lo
/// está. Todo lo que se dibuje a partir de ahí se guarda en el teléfono y no lo
/// ve ningún colaborador, mientras el indicador de la esquina afirma que está
/// al día.
///
/// La página tiene su propia defensa —escucha `visibilitychange` y mide cuánto
/// estuvo oculta— y en un navegador normal basta. Aquí dentro no: **hay
/// versiones de Android en las que el WebView de una aplicación en primer plano
/// nunca se marca como oculto al apagar la pantalla**, y entonces ese evento no
/// llega nunca. Flutter sí recibe `paused` y `resumed` en todos los casos, y
/// además sabe cuánto duró la pausa con exactitud, que es justo el dato con el
/// que la web decide si vale la pena tirar la conexión.
///
/// La otra mitad de esta conversación está en
/// `frontend/src/hooks/useReconexion.ts`. El nombre de abajo es el contrato
/// entre las dos, y no hay compilador que lo compruebe: cambiarlo aquí sin
/// cambiarlo allí no rompe nada visible, y el síntoma sería que reconectar tras
/// el bloqueo de pantalla vuelve a fallar.

/// Función global que se llama para avisar (Flutter → web).
const String nombreReceptorCiclo = '__cicloDeVida';

/// El JavaScript que entrega el aviso.
///
/// Solo viaja un número, así que no hay aquí el problema de escapado que sí
/// tiene el puente de voz. La comprobación de `typeof` sí hace falta por lo
/// mismo que allí: el guion corre contra la página que haya cargada, y puede
/// ser la pantalla de error o una versión vieja del frontend donde el receptor
/// no existe. Sin ella, cada desbloqueo de pantalla dejaría una excepción en la
/// consola del WebView.
String guionDespertar(int pausaMs) {
  return 'if (typeof window.$nombreReceptorCiclo === "function") '
      'window.$nombreReceptorCiclo($pausaMs);';
}

/// Cuánto duró la pausa, o `null` si no procede avisar.
///
/// Es una función aparte y pura para poder probarla sin un teléfono, y lo que
/// decide es más sutil de lo que parece:
///
/// - Solo se avisa al **volver** (`resumed`). El resto de estados son idas, no
///   vueltas.
/// - Solo si antes hubo una ida de verdad. Al arrancar, Flutter emite
///   `resumed` sin haber pausado nada, y avisar ahí provocaría una reconexión
///   contra un socket que se acaba de abrir.
/// - `inactive` **no** cuenta como ida. Es el estado transitorio de bajar la
///   persiana de notificaciones o de recibir una llamada, y vuelve solo en un
///   segundo sin que el sistema congele nada. Tratarlo como pausa sería
///   reconectar cada vez que alguien roza el borde de la pantalla.
int? pausaAlVolver({
  required AppLifecycleState estado,
  required DateTime? pausadaDesde,
  required DateTime ahora,
}) {
  if (estado != AppLifecycleState.resumed) return null;
  if (pausadaDesde == null) return null;
  final ms = ahora.difference(pausadaDesde).inMilliseconds;
  // Negativo solo si alguien mueve el reloj del sistema hacia atrás mientras la
  // app duerme. No es hipotético —pasa al cambiar de zona horaria en un vuelo—
  // y un número negativo llegaría a la web como «no estuvo fuera», que es lo
  // contrario de lo cierto.
  return ms < 0 ? 0 : ms;
}

/// Observa el ciclo de vida de la aplicación y se lo cuenta al WebView.
///
/// Se registra en `initState` de la pantalla del WebView y se retira en
/// `dispose`. No se instala antes de `loadRequest` como los otros puentes,
/// porque este no es un canal que la página consulte: es un aviso que sale de
/// aquí, y si la página aún no ha cargado, el `typeof` de arriba lo descarta
/// sin ruido.
class PuenteCicloDeVida with WidgetsBindingObserver {
  /// El WebView al que avisar. Se asigna al registrar.
  WebViewController? _web;

  /// Cuándo se fue a segundo plano. `null` mientras está a la vista.
  DateTime? _pausadaDesde;

  /// Para poder probar el reloj sin esperar media hora.
  final DateTime Function() _ahora;

  PuenteCicloDeVida({DateTime Function()? ahora})
    : _ahora = ahora ?? DateTime.now;

  void registrar(WebViewController web) {
    _web = web;
    WidgetsBinding.instance.addObserver(this);
  }

  void soltar() {
    WidgetsBinding.instance.removeObserver(this);
    _web = null;
  }

  // El parámetro se llama `state` y no `estado` como el resto del fichero
  // porque así se llama en `WidgetsBindingObserver`, y el analizador avisa de
  // la discrepancia. Se le hace caso: el nombre de un parámetro sobrescrito es
  // parte de la firma —se puede pasar por nombre— y cambiarlo es cambiar la
  // API sin querer.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final pausa = pausaAlVolver(
      estado: state,
      pausadaDesde: _pausadaDesde,
      ahora: _ahora(),
    );

    if (pausa != null) {
      _pausadaDesde = null;
      _web?.runJavaScript(guionDespertar(pausa));
      return;
    }

    // `paused` y `detached` son las idas de verdad. `hidden` también, y se
    // incluye porque en Android 14 es el que llega al apagar la pantalla,
    // justo el caso que este fichero existe para cubrir.
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      // Solo la primera: si llegan `hidden` y luego `paused`, la ida es la
      // primera, y sobrescribir la marca acortaría la pausa medida.
      _pausadaDesde ??= _ahora();
    }
  }
}
