import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'voz_nativa.dart';

/// Cliente móvil de la herramienta colaborativa de diagramas UML.
///
/// Es una carcasa nativa alrededor de la PWA que ya existe en `frontend/`, y la
/// decisión de que lo sea no es pereza: la colaboración va por el protocolo
/// binario de `y-websocket` (`shared/src/crdt/wire.ts`, `lib0` + `y-protocols`)
/// y el trabajo sin conexión por `y-indexeddb`. Reimplementar Yjs en Dart es
/// apostar lo más delicado del proyecto a un port incompleto, y el modo de fallo
/// no sería una excepción sino un documento que deja de sincronizar en silencio.
/// Aquí, en cambio, el editor, el CRDT y el offline son exactamente el código
/// que ya tiene 539 pruebas detrás.
///
/// Lo nativo aporta lo que la página no puede hacer sola dentro de un WebView:
/// el selector de ficheros de la cámara, los permisos del sistema y la voz. Esa
/// última no es un extra: el WebView de Android **no implementa la Web Speech
/// API**, así que sin el puente de `voz_nativa.dart` el micrófono del asistente
/// y la lectura de la guía sencillamente no existen dentro de la app.
void main() {
  runApp(const AppUml());
}

/// De dónde se carga la aplicación.
///
/// Se inyecta al compilar con `--dart-define=APP_URL=...` porque una app nativa
/// **no tiene origen**: la web pide `/api/...` en relativo y deduce el WebSocket
/// de `location.host`, y aquí no hay ni una cosa ni la otra. Es la misma pieza
/// que hará falta el día que esto apunte a AWS, así que no es trabajo tirado.
///
/// El valor por defecto es la ruta de la defensa: el backend sirve el frontend
/// ya construido en su mismo puerto —un solo origen, sin Vite de por medio— y
/// `adb reverse tcp:3001 tcp:3001` hace que el `localhost` del teléfono salga
/// por el cable hasta el portátil.
///
/// Que sea `localhost` no es un detalle: los navegadores lo tratan como origen
/// seguro, así que dentro del WebView siguen permitidos la cámara y el
/// micrófono. Sobre `http://192.168.x.x` estarían bloqueados por no ser HTTPS.
const String urlAplicacion = String.fromEnvironment(
  'APP_URL',
  defaultValue: 'http://localhost:3001',
);

/// Traduce un fallo de red en algo que se pueda leer en mitad de una defensa.
///
/// Está fuera del widget y recibe la descripción en crudo —y no el
/// `WebResourceError`— porque así es una función pura y se puede probar sin
/// levantar un WebView, que en un test no existe. La bifurcación que importa es
/// una sola: contra `localhost` el culpable casi siempre es el túnel USB, y el
/// mensaje debe decir el comando en vez de dejarlo a la memoria.
String explicarFallo(String descripcion, {String url = urlAplicacion}) {
  final host = Uri.parse(url).host;
  final esLocal = host == 'localhost' || host == '127.0.0.1';
  return [
    'No se pudo abrir $url',
    '',
    descripcion,
    '',
    if (esLocal)
      'Con `localhost` el teléfono se busca a sí mismo. Hace falta el túnel\n'
          'por cable, y hay que repetirlo cada vez que se desconecta:\n\n'
          '    adb reverse tcp:3001 tcp:3001\n\n'
          'Y que el backend esté levantado en el portátil.'
    else
      'Comprueba que el servidor responde desde el teléfono y que el host\n'
          'tiene permitido el HTTP sin cifrar en network_security_config.xml.',
  ].join('\n');
}

class AppUml extends StatelessWidget {
  const AppUml({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Diagramas UML',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        // Los mismos colores que `frontend/src/estilos.css`, para que la franja
        // del sistema y la pantalla de error no desentonen con la página.
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0F1115),
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF5B9CFF),
          brightness: Brightness.dark,
        ),
      ),
      home: const PantallaWeb(),
    );
  }
}

class PantallaWeb extends StatefulWidget {
  const PantallaWeb({super.key});

  @override
  State<PantallaWeb> createState() => _PantallaWebState();
}

class _PantallaWebState extends State<PantallaWeb> {
  late final WebViewController _controlador;
  final PuenteVoz _voz = PuenteVoz();
  bool _cargando = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controlador = _crearControlador();
  }

  WebViewController _crearControlador() {
    final controlador = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0F1115))
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageStarted: (_) {
            setState(() {
              _cargando = true;
              _error = null;
            });
          },
          onPageFinished: (_) => setState(() => _cargando = false),
          // Sin esto, no llegar al servidor deja una pantalla en blanco y muda,
          // que en mitad de una defensa no dice si el fallo es el cable, el
          // backend o la app. `onWebResourceError` salta también por recursos
          // sueltos, así que solo se convierte en pantalla de error el fallo de
          // la navegación principal.
          onWebResourceError: (error) {
            // `isForMainFrame` es opcional: hay plataformas que no lo informan.
            // Se compara contra `false` y no contra `null` a propósito —cuando no
            // se sabe de qué recurso viene el fallo, es mejor enseñar el
            // diagnóstico que dejar la pantalla en blanco, que es exactamente lo
            // que se está intentando evitar.
            if (error.isForMainFrame == false) return;
            setState(() {
              _cargando = false;
              _error = explicarFallo(error.description);
            });
          },
        ),
      );

    final plataforma = controlador.platform;
    if (plataforma is AndroidWebViewController) {
      _configurarAndroid(plataforma);
    }

    // Antes de `loadRequest`, y no después: así `window.VozNativa` ya existe en
    // el primer render y la página no necesita esperar a que aparezca para
    // decidir si dibuja el botón del micrófono. El orden de estas dos líneas es
    // la diferencia entre «hay voz» y «a veces hay voz».
    _voz.registrar(controlador);

    controlador.loadRequest(Uri.parse(urlAplicacion));
    return controlador;
  }

  void _configurarAndroid(AndroidWebViewController android) {
    // La página pide cámara y micrófono; Android obliga a concederlo también
    // aquí, no basta con declararlo en el manifiesto. Si falta este trozo, el
    // botón de la foto y el del micrófono no hacen nada y no se ve ningún error.
    android.setOnPlatformPermissionRequest((peticion) => peticion.grant());

    // `<input type="file">` no abre nada en un WebView de Android si no se le
    // dice cómo. Es lo que usa «🖼 Desde imagen», o sea la función estrella del
    // proyecto: sin esto el botón está muerto en el móvil.
    android.setOnShowFileSelector(_elegirImagen);
  }

  Future<List<String>> _elegirImagen(FileSelectorParams parametros) async {
    try {
      // La web marca el campo con `capture="environment"`, así que cuando llega
      // esa señal se abre la cámara trasera directamente —que es lo que se
      // quiere al fotografiar una pizarra— y no la galería.
      final imagen = await ImagePicker().pickImage(
        source: parametros.isCaptureEnabled
            ? ImageSource.camera
            : ImageSource.gallery,
        preferredCameraDevice: CameraDevice.rear,
      );
      if (imagen == null) return const <String>[];
      return <String>[Uri.file(imagen.path).toString()];
    } on Exception {
      // Cancelar, o no tener permiso, no es un error que deba tumbar la página:
      // la lista vacía es lo que el WebView entiende como «no se eligió nada».
      return const <String>[];
    }
  }

  @override
  Widget build(BuildContext context) {
    // El botón «atrás» de Android tiene que navegar dentro de la página y no
    // cerrar la aplicación: si no, salir de un modal te echa fuera de la app.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (yaSalio, _) async {
        if (yaSalio) return;
        if (await _controlador.canGoBack()) {
          await _controlador.goBack();
        } else {
          // Solo se sale si de verdad no hay a dónde volver.
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: _error != null
              ? _PantallaError(
                  mensaje: _error!,
                  alReintentar: () {
                    setState(() => _error = null);
                    _controlador.loadRequest(Uri.parse(urlAplicacion));
                  },
                )
              : Stack(
                  children: [
                    WebViewWidget(controller: _controlador),
                    if (_cargando) const LinearProgressIndicator(minHeight: 2),
                  ],
                ),
        ),
      ),
    );
  }
}

class _PantallaError extends StatelessWidget {
  const _PantallaError({required this.mensaje, required this.alReintentar});

  final String mensaje;
  final VoidCallback alReintentar;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Sin conexión con el servidor',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 14),
            SelectableText(
              mensaje,
              style: const TextStyle(
                color: Color(0xFF8A93A6),
                height: 1.5,
                fontFamily: 'monospace',
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 22),
            FilledButton(
              onPressed: alReintentar,
              child: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
