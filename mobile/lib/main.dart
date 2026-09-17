import 'dart:async';
import 'dart:io';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'asistente/bandeja.dart';
import 'asistente/pantalla_conexion.dart';
import 'asistente/sesion.dart';
import 'camara/pantalla_recorte.dart';
import 'camara/rectificar.dart';
import 'ciclo_de_vida.dart';
import 'enlaces/destino.dart';
import 'permisos_nativos.dart';
import 'respaldo_nativo.dart';
import 'descarga_nativa.dart';
import 'sesion/acceso_rest.dart';
import 'sesion/almacen_sesion.dart';
import 'sesion/huella.dart';
import 'sesion/pantalla_acceso.dart';
import 'sesion/token.dart';
import 'sesion_nativa.dart';
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
/// Lo nativo aporta lo que la página no puede hacer sola dentro de un WebView,
/// y ninguna de las tres cosas es un extra:
///
///   - **La cámara, con recorte y corrección de perspectiva.** `<input
///     type="file">` no abre nada en un WebView si no se le dice cómo, y ahí
///     está «Desde imagen». Pero el problema de fondo no es abrirla: es que el
///     navegador entrega la foto tal y como salió del sensor —torcida, con la
///     mesa alrededor y el borde lejano comprimido— y desde JavaScript no hay
///     forma razonable de arreglar eso. Como lo que se hace con la imagen es
///     leerla con un modelo de visión, y un diagrama fotografiado de lado se
///     lee mal, aquí se marcan las cuatro esquinas y se endereza con una
///     homografía antes de dársela a la página.
///   - **La voz.** El WebView de Android **no implementa la Web Speech API**,
///     así que sin `voz_nativa.dart` el micrófono del asistente y la lectura de
///     la guía sencillamente no existen dentro de la app.
///   - **Las descargas.** Un WebView tampoco descarga por su cuenta, y aunque
///     se le registre un `DownloadListener`, lo que la página produce son
///     `blob:` que el `DownloadManager` no sabe resolver. Sin
///     `descarga_nativa.dart`, el ZIP del backend generado y el XMI exportado
///     no salen del teléfono: el botón se pulsa y no pasa nada.
///   - **La sesión.** La web guarda su token en `localStorage`, que dentro de
///     un WebView es un fichero de texto en el directorio de datos de la app.
///     Aquí el acceso se pide en Flutter, el token se guarda cifrado por el
///     Keystore y la página lo recibe por el puente solo en memoria. Está en
///     `sesion_nativa.dart` y en `sesion/`.
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
///
/// ## Por qué el `/movil` va en la URL y no se decide dentro
///
/// La ruta `/movil` es la interfaz táctil: lienzo a pantalla completa, hojas que
/// suben desde abajo, cajón lateral. Sin ella se entra por el layout de
/// escritorio, que en un teléfono son tres columnas de las que dos no caben.
///
/// Se elige **aquí**, en la URL que se carga, y no con una comprobación de ancho
/// dentro de la web, por un motivo que solo se nota en la app nativa: el WebView
/// pinta lo primero que recibe. Si la decisión fuera del lado del navegador
/// habría un instante en el que se monta el editor de escritorio —con su árbol,
/// su paleta y sus tres paneles suscritos al documento— para sustituirlo acto
/// seguido, y ese parpadeo es lo primero que se ve al abrir la aplicación.
///
/// Que siga siendo un `--dart-define` y no una constante pegada importa el día
/// que esto apunte a AWS: la ruta viaja con el dominio, no aparte de él.
const String urlAplicacion = String.fromEnvironment(
  'APP_URL',
  defaultValue: 'http://localhost:3001/movil',
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
      home: const PantallaInicio(),
    );
  }
}

/// Las dos mitades del proyecto, en un solo APK.
///
/// Podrían haber sido dos aplicaciones, y no lo son por dos razones. La
/// práctica: comparten el `network_security_config` que permite el HTTP en
/// claro solo contra localhost, la concesión de permisos de micrófono y el
/// puente de voz de `voz_nativa.dart`; duplicarlo sería duplicar justo lo que
/// más cuesta dejar bien. La otra: dos iconos con el mismo `applicationId` no
/// pueden convivir en el teléfono, y en la defensa hacen falta los dos seguidos
/// —se edita el diagrama, se genera el backend, se le habla desde el mismo
/// aparato—, que es precisamente el recorrido que hay que enseñar.
class PantallaInicio extends StatefulWidget {
  const PantallaInicio({super.key});

  @override
  State<PantallaInicio> createState() => _PantallaInicioState();
}

class _PantallaInicioState extends State<PantallaInicio> {
  /// Vive aquí y no dentro de la pantalla de conexión para que volver atrás no
  /// tire el manifiesto ya descargado —ni, ahora, la bandeja de salida.
  ///
  /// La bandeja va al directorio de documentos de la app y no a la caché: el
  /// sistema vacía la caché cuando le hace falta espacio, y ahí dentro hay
  /// órdenes que el usuario dio y que todavía no han llegado a ningún sitio.
  /// Perderlas en silencio sería peor que no tener bandeja.
  final Sesion _sesion =
      Sesion(almacen: AlmacenEnFichero(getApplicationDocumentsDirectory()));

  /// La sesión del editor, que es otra cosa distinta de la de arriba.
  ///
  /// La de arriba es la conexión del asistente con un backend generado; esta es
  /// la cuenta de la herramienta colaborativa. Comparten palabra y nada más, y
  /// se distinguen por dónde viven: aquella guarda una URL y un manifiesto en
  /// un fichero corriente, y esta un token en el almacén cifrado del sistema.
  final AlmacenSesion _cuenta = AlmacenSeguro();
  final Desbloqueo _desbloqueo = DesbloqueoDelSistema();

  /// Los enlaces `umluml://proyecto/<id>` que llegan de fuera.
  StreamSubscription<Uri>? _escuchaEnlaces;

  /// Por dónde se le pide al editor **ya abierto** que cambie de proyecto.
  ///
  /// Es un `broadcast` de un solo oyente a propósito, porque lo que interesa de
  /// él no es difundir sino `hasListener`: con el editor en pantalla hay
  /// oyente, y sin él no lo hay. Esa es exactamente la pregunta que hay que
  /// contestar al recibir un enlace —¿lo abro o se lo digo al que ya está?— y
  /// tenerla en un booleano aparte sería tener dos verdades que se desincronizan
  /// el día que se añada otra forma de salir del editor.
  final StreamController<String> _proyectosPedidos =
      StreamController<String>.broadcast();

  /// El proyecto que pidió un enlace y que todavía no se ha abierto.
  ///
  /// Existe por la ventana en la que el editor está «abriéndose» pero aún no en
  /// pantalla: la de la contraseña o la huella. Un enlace que llegue ahí no
  /// tiene a quién decírselo, y sin esta variable se perdería justo en el caso
  /// más normal de todos —tocar el enlace con la app cerrada—.
  String? _proyectoPendiente;

  /// Si ya se está entrando al editor, para no apilar dos.
  bool _entrandoAlEditor = false;

  @override
  void initState() {
    super.initState();
    // Sin esto, lo apuntado en la sesión anterior seguiría en el fichero pero no
    // en memoria, y el primer `enviar` lo pisaría con una lista vacía.
    _sesion.bandeja.cargar();

    // Una sola suscripción para las dos formas de recibir un enlace. El plugin
    // guarda el de arranque y lo emite por aquí en cuanto hay quien escuche
    // —una vez, con un pestillo propio—, así que pedir además `getInitialLink()`
    // no añadiría nada y abriría el proyecto dos veces.
    _escuchaEnlaces = AppLinks().uriLinkStream.listen(_atenderEnlace);
  }

  @override
  void dispose() {
    _escuchaEnlaces?.cancel();
    _proyectosPedidos.close();
    _sesion.dispose();
    super.dispose();
  }

  /// Llega un enlace de fuera y hay que decidir qué se hace con él.
  ///
  /// Todo lo que decide algo de verdad está en `proyectoDeEnlace`, que es puro y
  /// tiene sus pruebas; aquí solo se elige a quién dárselo. Y el `null` no abre
  /// ninguna pantalla de error a propósito: un enlace que no se entiende no es
  /// un fallo del usuario —no lo escribió él— y una app que arranca quejándose
  /// de algo que él no hizo es peor que una que sencillamente se abre.
  void _atenderEnlace(Uri enlace) {
    final proyecto = proyectoDeEnlace(enlace);
    if (proyecto == null) return;

    if (_proyectosPedidos.hasListener) {
      _proyectosPedidos.add(proyecto);
      return;
    }

    _proyectoPendiente = proyecto;
    // Con el acceso ya en pantalla no se empuja nada: `_abrirEditor` recogerá
    // el proyecto pendiente justo antes de cargar la página.
    if (!_entrandoAlEditor) _abrirEditor();
  }

  /// Abre el editor, pasando antes por donde haga falta.
  ///
  /// Es un bucle y no una secuencia porque el editor puede devolver el control
  /// aquí: cuando el servidor deja de aceptar la sesión, la página lo dice por
  /// el puente, el WebView se cierra y hay que volver a pedir la contraseña sin
  /// que el usuario acabe en el menú preguntándose qué ha pasado. Escrito en
  /// línea recta harían falta dos copias de la misma navegación.
  ///
  /// Lo único que decide algo está en `pasoDeArranque`, que es puro y tiene sus
  /// pruebas. Aquí solo se navega.
  ///
  /// El pestillo de fuera es por los enlaces: tocar dos veces un
  /// `umluml://proyecto/<id>` mientras se está escribiendo la contraseña
  /// apilaría dos accesos, y salir del de arriba dejaría al usuario mirando
  /// otro idéntico sin entender por qué no se ha ido.
  Future<void> _abrirEditor() async {
    if (_entrandoAlEditor) return;
    _entrandoAlEditor = true;
    try {
      await _recorridoDelEditor();
    } finally {
      _entrandoAlEditor = false;
    }
  }

  Future<void> _recorridoDelEditor() async {
    final navegador = Navigator.of(context);
    String? aviso;
    var exigirContrasena = false;
    // El proyecto al que se entra, si se llegó por un enlace. Vive fuera del
    // bucle para que una sesión caducada a mitad de trabajo vuelva al mismo
    // proyecto después de escribir la contraseña, y no al índice.
    String? proyecto;

    while (true) {
      final guardada = await _cuenta.leer();
      SesionGuardada? sesion;

      if (!exigirContrasena) {
        final paso = pasoDeArranque(
          guardada: guardada,
          ahora: DateTime.now(),
          exigeHuella: await _cuenta.exigeHuella(),
          aparatoPuedeHuella: await _desbloqueo.disponible(),
        );
        switch (paso) {
          case PasoDeArranque.entrar:
            sesion = guardada;
          case PasoDeArranque.pedirHuella:
            if (await _desbloqueo.pedir('Desbloquee su sesión para editar diagramas')) {
              sesion = guardada;
            } else {
              aviso = 'No se confirmó la huella. Puede entrar con la contraseña.';
            }
          case PasoDeArranque.pedirCredenciales:
            // Solo se avisa si había algo guardado. La primera vez no ha
            // fallado nada y un aviso ahí sobra.
            if (guardada != null) {
              aviso = 'La sesión guardada ya no sirve. Escriba la contraseña otra vez.';
            }
        }
      }

      if (sesion == null) {
        if (!mounted) return;
        sesion = await navegador.push<SesionGuardada>(
          MaterialPageRoute<SesionGuardada>(
            builder: (_) => PantallaAcceso(
              servicio: AccesoPorHttp(urlAplicacion: urlAplicacion),
              almacen: _cuenta,
              desbloqueo: _desbloqueo,
              ultimoCorreo: guardada?.email ?? '',
              aviso: aviso,
            ),
          ),
        );
        // Volver atrás desde el acceso es no querer entrar, no un fallo.
        if (sesion == null) return;
      }

      // En una variable propia: una local que puede ser nula no se promociona
      // dentro de una clausura, y el `builder` de abajo es una clausura.
      final activa = sesion;
      if (!mounted) return;
      // El enlace que llegó mientras se pedía la contraseña se recoge aquí, que
      // es el último momento en que todavía sirve de algo.
      proyecto = _proyectoPendiente ?? proyecto;
      _proyectoPendiente = null;
      final motivo = await navegador.push<MotivoDeSalida>(
        MaterialPageRoute<MotivoDeSalida>(
          builder: (_) => PantallaWeb(
            sesion: activa,
            cuenta: _cuenta,
            proyectoInicial: proyecto,
            proyectosPedidos: _proyectosPedidos.stream,
          ),
        ),
      );
      // Sin motivo se salió del editor con el botón «atrás», que es lo normal.
      if (motivo == null) return;

      exigirContrasena = true;
      aviso = motivo == MotivoDeSalida.caducada
          ? 'El servidor ha dejado de aceptar la sesión. Vuelva a entrar: lo '
                'editado sin conexión sigue guardado en el teléfono y se '
                'enviará al reconectar.'
          : null;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Diagramas UML',
                style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text(
                'Del diagrama al backend, y del backend a la voz.',
                style: TextStyle(color: Color(0xFF8A93A6)),
              ),
              const SizedBox(height: 36),
              _Tarjeta(
                icono: Icons.account_tree_outlined,
                titulo: 'Editor de diagramas',
                detalle:
                    'La herramienta colaborativa: clases, relaciones, foto de '
                    'pizarra y generación del proyecto.',
                alPulsar: _abrirEditor,
              ),
              const SizedBox(height: 16),
              _Tarjeta(
                icono: Icons.mic_none,
                titulo: 'Asistente',
                detalle:
                    'Se conecta a un backend ya generado y trabaja con sus '
                    'datos. No lleva dentro ningún proyecto concreto.',
                alPulsar: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => PantallaConexion(sesion: _sesion),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Tarjeta extends StatelessWidget {
  const _Tarjeta({
    required this.icono,
    required this.titulo,
    required this.detalle,
    required this.alPulsar,
  });

  final IconData icono;
  final String titulo;
  final String detalle;
  final VoidCallback alPulsar;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFF171A21),
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: alPulsar,
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icono, size: 30, color: const Color(0xFF5B9CFF)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      titulo,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      detalle,
                      style: const TextStyle(
                        color: Color(0xFF8A93A6),
                        height: 1.4,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class PantallaWeb extends StatefulWidget {
  const PantallaWeb({
    super.key,
    required this.sesion,
    required this.cuenta,
    required this.proyectosPedidos,
    this.proyectoInicial,
  });

  /// La sesión con la que se abre. Se le entrega a la página por el puente y
  /// **no** se escribe en el almacenamiento del WebView.
  final SesionGuardada sesion;

  /// El almacén cifrado, para poder borrar la sesión cuando deje de valer.
  final AlmacenSesion cuenta;

  /// Los proyectos que pide un enlace con el editor ya abierto.
  final Stream<String> proyectosPedidos;

  /// El proyecto por el que se entra, si se llegó por un enlace.
  ///
  /// Nulo es lo normal: se abre por el índice, que es la portada de la web.
  final String? proyectoInicial;

  @override
  State<PantallaWeb> createState() => _PantallaWebState();
}

class _PantallaWebState extends State<PantallaWeb> {
  late final WebViewController _controlador;
  final PuenteVoz _voz = PuenteVoz();
  final PuenteDescarga _descarga = PuenteDescarga();
  final PuenteCicloDeVida _ciclo = PuenteCicloDeVida();
  final PuenteRespaldo _respaldo = PuenteRespaldo();
  late final PuenteSesion _puenteSesion = PuenteSesion(
    alPerderLaSesion: _perderLaSesion,
  );
  bool _cargando = true;
  String? _error;

  /// Los enlaces que llegan con esta pantalla ya abierta.
  StreamSubscription<String>? _escuchaProyectos;

  /// La dirección que se está enseñando.
  ///
  /// No es `urlAplicacion` a secas porque un enlace la cambia, y de ella
  /// depende el botón «Reintentar»: recargar la portada después de que fallara
  /// la carga de un proyecto es contestar a otra cosa de la que se preguntó.
  late String _urlActual = widget.proyectoInicial == null
      ? urlAplicacion
      : urlDelProyecto(urlAplicacion, widget.proyectoInicial!);

  @override
  void initState() {
    super.initState();
    _controlador = _crearControlador();
    _escuchaProyectos = widget.proyectosPedidos.listen(_irAlProyecto);
  }

  /// Un enlace pide otro proyecto y el editor ya está en pantalla.
  ///
  /// Se recarga la página entera en vez de pedirle a la web que navegue por su
  /// cuenta. Es más brusco —se pierde el documento que hubiera en memoria— pero
  /// no se pierde trabajo: lo editado sin conexión está en el IndexedDB del
  /// WebView y en el respaldo nativo, y ambos sobreviven a la recarga. Un canal
  /// nuevo solo para esto sería un protocolo más partido entre dos lenguajes
  /// que ningún compilador comprueba.
  void _irAlProyecto(String proyecto) {
    _urlActual = urlDelProyecto(urlAplicacion, proyecto);
    _controlador.loadRequest(Uri.parse(_urlActual));
  }

  /// La página dice que la sesión ya no vale, o que quieren salir.
  ///
  /// Se borra del almacén cifrado y se cierra el editor devolviendo el motivo.
  /// Quien abrió esta pantalla decide qué hacer con él; desde aquí no se sabe
  /// si hay algo detrás a lo que volver.
  ///
  /// El borrado importa tanto como el cierre: sin él, el Keystore seguiría
  /// custodiando con todo cuidado una llave que el servidor ya no acepta, y el
  /// arranque siguiente entraría directo a una pantalla que falla.
  void _perderLaSesion(MotivoDeSalida motivo) {
    // No se espera al borrado antes de cerrar. Cerrar es lo urgente —lo que
    // hay detrás es una página que ya no puede hacer nada— y el borrado no
    // puede fallar de una forma que importe: si el almacén no responde, la
    // comprobación de caducidad del arranque siguiente atrapa lo mismo.
    unawaited(widget.cuenta.borrar());
    if (!mounted) return;
    Navigator.of(context).pop(motivo);
  }

  @override
  void dispose() {
    // Sin esto el observador queda registrado en `WidgetsBinding` para siempre,
    // apuntando a un WebView que ya no existe: cada vuelta del segundo plano
    // intentaría ejecutar JavaScript contra un controlador desechado.
    _ciclo.soltar();
    // Y sin esto un enlace posterior intentaría navegar en un WebView
    // desechado. Cancelar aquí es además lo que le dice a quien nos abrió que
    // el editor ya no está en pantalla: comprueba `hasListener`.
    _escuchaProyectos?.cancel();
    super.dispose();
  }

  WebViewController _crearControlador() {
    final controlador = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF0F1115))
      ..setNavigationDelegate(
        NavigationDelegate(
          // El cerrojo del WebView, y la segunda mitad de la defensa de los
          // enlaces profundos. Lo que se protege no es la vista sino el token:
          // mientras esta ventana tenga registrado el canal `SesionNativa`,
          // cualquier página que se cargue dentro puede pedirlo y recibirlo,
          // porque el puente no sabe qué hay cargado, solo sabe contestar.
          //
          // Por eso la comprobación va aquí y no solo en `proyectoDeEnlace`:
          // un enlace externo dentro de la página, un `window.location`
          // inyectado y el redirect de un portal cautivo de una wifi pública
          // acaban los tres en el mismo sitio sin pasar por ningún enlace
          // `umluml://`, y ninguno de los tres da error.
          //
          // Se comprueba el origen y no la ruta porque la web es de una sola
          // página: la ruta cambia constantemente y bloquear por ella la
          // dejaría clavada en la primera pantalla. `mismoOrigen` es puro y
          // está probado en `enlaces/destino.dart`.
          onNavigationRequest: (peticion) =>
              mismoOrigen(urlAplicacion, peticion.url)
                  ? NavigationDecision.navigate
                  : NavigationDecision.prevent,
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
              _error = explicarFallo(error.description, url: _urlActual);
            });
          },
        ),
      );

    final plataforma = controlador.platform;
    if (plataforma is AndroidWebViewController) {
      _configurarAndroid(plataforma);
    }

    // Antes de `loadRequest`, y no después: así `window.VozNativa` y
    // `window.DescargaNativa` ya existen en el primer render y la página no
    // necesita esperar a que aparezcan para decidir si dibuja el botón del
    // micrófono o por dónde va a sacar el fichero. El orden de estas líneas
    // respecto a la de abajo es la diferencia entre «hay voz» y «a veces hay
    // voz».
    _voz.registrar(controlador);
    _descarga.registrar(controlador);
    // El respaldo también tiene que estar antes, y por un motivo propio: la
    // página mira si el canal existe para decidir si instala el respaldo. Uno
    // que aparezca después de cargar es un canal que la página ya dio por
    // ausente, y el diagrama se quedaría sin copia sin que nada lo dijera.
    _respaldo.registrar(controlador);
    // Y la sesión, que es el que más depende del orden de todos: la página
    // pregunta por el token durante su arranque, antes de decidir si enseña su
    // propia pantalla de acceso. Un canal que llegue tarde se traduce en pedir
    // la contraseña dos veces, una en Flutter y otra dentro del WebView.
    _puenteSesion.usar(widget.sesion);
    _puenteSesion.registrar(controlador);
    // Este último no necesita estar antes de la carga —no es un canal que la
    // página consulte, sino un aviso que sale de aquí— pero se registra junto a
    // los otros para que los cinco puentes se lean de un vistazo.
    _ciclo.registrar(controlador);

    // `_urlActual` y no `urlAplicacion`: si se llegó por un enlace, la primera
    // carga ya es la del proyecto. Pasar por la portada para navegar después
    // sería enseñar una pantalla que nadie pidió y cargar el índice entero
    // para descartarlo.
    controlador.loadRequest(Uri.parse(_urlActual));
    return controlador;
  }

  void _configurarAndroid(AndroidWebViewController android) {
    // La página pide cámara y micrófono; Android obliga a concederlo también
    // aquí, no basta con declararlo en el manifiesto. Si falta este trozo, el
    // botón de la foto y el del micrófono no hacen nada y no se ve ningún error.
    //
    // Contestar `grant()` a secas no basta desde que el tablón graba notas de
    // voz: eso solo convence al WebView, y quien tiene que abrir el micrófono es
    // Android, que sigue sin habérselo concedido a la app. En
    // `permisos_nativos.dart` está el porqué largo y el motivo de denegar lo que
    // no se reconoce.
    android.setOnPlatformPermissionRequest(atenderPeticionWeb);

    // `<input type="file">` no abre nada en un WebView de Android si no se le
    // dice cómo. Es lo que usa «🖼 Desde imagen», o sea la función estrella del
    // proyecto: sin esto el botón está muerto en el móvil.
    android.setOnShowFileSelector(_elegirImagen);
  }

  /// Abre la cámara o la galería y, si es una foto, la recorta y la endereza.
  ///
  /// ## Por qué el enderezado se cuela aquí y no por un canal aparte
  ///
  /// Lo que la página necesita es una imagen, y ya tiene por dónde recibirla:
  /// este selector devuelve rutas de fichero y `<input type="file">` las lee
  /// como si las hubiera elegido una persona. Metiendo el recorte en medio, el
  /// frontend no cambia ni una línea —sigue habiendo un `input`, sigue
  /// llegando un JPEG— y lo que recibe es la foto ya sin escorzo.
  ///
  /// La alternativa era un canal de JavaScript que devolviera los bytes a la
  /// página. Se descartó por dos cosas que no se ven hasta que se prueba:
  /// bajar datos a la página va por `runJavaScript`, que mete la carga en la
  /// cadena del guion y choca con el tope de aproximadamente un megabyte del
  /// Binder de Android **perdiendo el mensaje en silencio**, así que haría
  /// falta trocear y reensamblar; y el protocolo de esos trozos viviría partido
  /// en dos ficheros de dos lenguajes distintos sin ningún compilador que
  /// comprobase que siguen de acuerdo. Por un fichero temporal no viaja nada:
  /// los bytes no cruzan el puente.
  ///
  /// Solo pasa por el recorte lo que viene de la cámara. Una imagen elegida de
  /// la galería puede ser una captura de pantalla o un PNG exportado de otra
  /// herramienta, que ya están de frente: pedir que se marquen cuatro esquinas
  /// ahí es trabajo de más para empeorar la imagen.
  Future<List<String>> _elegirImagen(FileSelectorParams parametros) async {
    // El navegador se resuelve antes del primer `await`: después de abrir la
    // cámara este widget puede haberse quedado sin montar, y buscar el contexto
    // entonces es mirar un árbol que ya no existe.
    final navegador = Navigator.of(context);

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
      if (!parametros.isCaptureEnabled) {
        return <String>[Uri.file(imagen.path).toString()];
      }

      // En otro hilo: decodificar una foto de doce megapíxeles y volver a
      // comprimirla pasa del segundo, y en el hilo de la interfaz eso es la
      // pantalla congelada justo después de darle al disparador.
      final derecha = await compute(
        enderezarOrientacion,
        await imagen.readAsBytes(),
      );
      // Si no se sabe leer, se entrega tal cual en vez de no entregar nada: el
      // modelo de visión del backend puede apañárselas con la foto original, y
      // quedarse sin foto es peor que quedarse sin enderezar.
      if (derecha == null) {
        return <String>[Uri.file(imagen.path).toString()];
      }

      if (!mounted) return const <String>[];
      final jpeg = await navegador.push<Uint8List>(
        MaterialPageRoute<Uint8List>(
          builder: (_) => PantallaRecorte(foto: derecha),
        ),
      );
      // Cancelar el recorte cancela la foto entera. Devolver la original sería
      // hacer lo contrario de lo que se acaba de pedir.
      if (jpeg == null) return const <String>[];

      return <String>[Uri.file(await _guardarRecorte(jpeg)).toString()];
    } on Exception {
      // Cancelar, o no tener permiso, no es un error que deba tumbar la página:
      // la lista vacía es lo que el WebView entiende como «no se eligió nada».
      return const <String>[];
    }
  }

  /// Deja el JPEG recortado en un fichero que el WebView pueda leer.
  ///
  /// En la caché y no en los documentos: es un intermedio de un solo uso, y lo
  /// que hay que conservar —el diagrama que salga de leerlo— acaba en el
  /// proyecto. Que el sistema borre esto cuando le haga falta espacio es lo
  /// correcto.
  ///
  /// El nombre lleva la hora porque un nombre fijo se reescribiría mientras la
  /// página todavía está leyendo el anterior, y porque el WebView guarda en
  /// caché por ruta: con el mismo nombre, la segunda foto de la sesión podría
  /// llegar siendo la primera. La extensión importa: de ahí saca el WebView el
  /// `image/jpeg` que la página comprueba antes de subirlo.
  Future<String> _guardarRecorte(Uint8List jpeg) async {
    final carpeta = await getTemporaryDirectory();
    final fichero = File(
      '${carpeta.path}/recorte-${DateTime.now().millisecondsSinceEpoch}.jpg',
    );
    await fichero.writeAsBytes(jpeg, flush: true);
    return fichero.path;
  }

  @override
  Widget build(BuildContext context) {
    // El botón «atrás» de Android tiene que navegar dentro de la página y no
    // cerrar la aplicación: si no, salir de un modal te echa fuera de la app.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (yaSalio, _) async {
        if (yaSalio) return;
        // Se resuelve el navegador antes del `await`: después, el contexto
        // puede haber dejado de estar montado y usarlo sería mirar un árbol de
        // widgets que ya no existe.
        final navegador = Navigator.of(context);
        if (await _controlador.canGoBack()) {
          await _controlador.goBack();
          return;
        }
        // Agotada la historia de la página, se vuelve al menú. Solo se sale de
        // la app si el editor fuese la única pantalla de la pila, que es lo que
        // pasaba antes de que existiera el asistente.
        if (!mounted) return;
        if (navegador.canPop()) {
          navegador.pop();
        } else {
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
                    _controlador.loadRequest(Uri.parse(_urlActual));
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
