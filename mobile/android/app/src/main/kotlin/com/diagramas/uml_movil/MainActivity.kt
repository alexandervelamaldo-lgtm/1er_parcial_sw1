package com.diagramas.uml_movil

import io.flutter.embedding.android.FlutterFragmentActivity

/**
 * La actividad única de la app.
 *
 * Hereda de `FlutterFragmentActivity` y no de `FlutterActivity`, que es lo que
 * genera `flutter create`, por una exigencia concreta de `local_auth`: el
 * diálogo de huella de Android es un `BiometricPrompt`, y un `BiometricPrompt`
 * solo se puede mostrar sobre una `FragmentActivity`. Con la clase por omisión,
 * `authenticate()` lanza `no_fragment_activity` y el fallo llega disfrazado:
 * no hay error en pantalla, sencillamente el diálogo de huella no aparece
 * nunca y el desbloqueo parece no estar implementado.
 *
 * El cambio no cuesta nada al resto: `FlutterFragmentActivity` es la misma
 * actividad de Flutter con el soporte de fragmentos de AndroidX encima, y el
 * WebView, los canales y el ciclo de vida se comportan igual.
 */
class MainActivity : FlutterFragmentActivity()
