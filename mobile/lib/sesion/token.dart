/// La sesión del usuario, sin nada que necesite un teléfono para probarse.
///
/// ## Por qué el acceso se hace aquí y no dentro de la página
///
/// La web ya sabe entrar: tiene su pantalla de acceso y guarda el token en
/// `localStorage`. Dentro de un WebView eso es un fichero de texto en el
/// directorio de datos de la aplicación —`app_webview/Default/Local Storage`—,
/// y ahí un token de sesión con dos meses de vigencia está al alcance de
/// cualquier copia de seguridad del sistema y de cualquier aparato con root. No
/// es un problema del código de la web: es que el navegador no tiene ningún
/// sitio mejor donde ponerlo. El teléfono sí: el Keystore.
///
/// Así que el acceso sube a la carcasa nativa, el token se guarda cifrado, y la
/// página lo recibe por el puente **solo en memoria** cada vez que arranca. Lo
/// que queda escrito en el disco del WebView es nada.
///
/// ## Qué hay en este fichero y qué no
///
/// Solo las decisiones: qué credenciales tienen sentido mandar, qué significa
/// cada respuesta del servidor y cuándo un token guardado ya no vale. Ni la
/// petición HTTP, ni el almacén cifrado, ni la pantalla. Eso está al lado y
/// necesita un aparato; esto se prueba con `flutter test` y sin red.
library;

import 'dart:convert';

/// Lo que se recuerda de una sesión iniciada.
///
/// Se guarda el perfil junto al token, y no solo el token, por una razón que se
/// nota al abrir la app sin cobertura: sin el nombre y el correo, la pantalla
/// de bienvenida tendría que preguntárselos al servidor para poder decir a
/// nombre de quién se va a entrar, y sin red no podría. Son datos que el propio
/// servidor acaba de dar; recordarlos no revela nada que el token no revele ya.
class SesionGuardada {
  const SesionGuardada({
    required this.token,
    required this.usuarioId,
    required this.email,
    required this.nombre,
    required this.expira,
  });

  final String token;
  final String usuarioId;
  final String email;

  /// El nombre para mostrar. Puede venir vacío: el registro lo permite.
  final String nombre;

  /// Cuándo deja de valer el token, en milisegundos desde la época.
  ///
  /// Lo dice el servidor en la respuesta del acceso. Aquí no se comprueba la
  /// firma ni se intenta leer el token por dentro —eso es trabajo del backend y
  /// duplicarlo en Dart sería tener dos opiniones sobre lo mismo—; solo se usa
  /// para no arrancar el WebView con una sesión que ya se sabe muerta.
  final int expira;

  /// Cómo se muestra a quien va a entrar.
  ///
  /// El nombre si lo hay y el correo si no, porque una cuenta registrada sin
  /// nombre existe y una bienvenida vacía parecería un fallo.
  String get comoLlamarle => nombre.trim().isEmpty ? email : nombre.trim();

  Map<String, Object?> aJson() => {
    'token': token,
    'usuarioId': usuarioId,
    'email': email,
    'nombre': nombre,
    'expira': expira,
  };

  /// Lo contrario, tolerante con lo que no reconoce.
  ///
  /// Devuelve `null` en vez de lanzar porque lo que se está leyendo salió del
  /// almacén cifrado de una versión anterior del APK, y un campo que cambió de
  /// nombre entre versiones no puede tumbar el arranque de la aplicación: tiene
  /// que significar «no hay sesión», que manda a la pantalla de acceso y se
  /// arregla solo entrando otra vez.
  static SesionGuardada? deJson(String crudo) {
    Object? leido;
    try {
      leido = jsonDecode(crudo);
    } on FormatException {
      return null;
    }
    if (leido is! Map<String, Object?>) return null;

    final token = leido['token'];
    final usuarioId = leido['usuarioId'];
    final expira = leido['expira'];
    if (token is! String || token.isEmpty) return null;
    if (usuarioId is! String) return null;
    if (expira is! int) return null;

    return SesionGuardada(
      token: token,
      usuarioId: usuarioId,
      email: leido['email'] is String ? leido['email']! as String : '',
      nombre: leido['nombre'] is String ? leido['nombre']! as String : '',
      expira: expira,
    );
  }
}

/// Margen con el que se da por caducada una sesión antes de tiempo.
///
/// Un token que vence dentro de diez segundos técnicamente vale, y usarlo es
/// pedir que la sesión se caiga a mitad de la primera pantalla. Es peor que
/// mandar a la pantalla de acceso desde el principio: el usuario ya ha visto la
/// lista de proyectos y la pierde mientras la mira.
const Duration margenDeCaducidad = Duration(minutes: 2);

/// Si un token guardado sirve todavía para arrancar.
bool sesionUtilizable(SesionGuardada sesion, DateTime ahora) {
  final vence = DateTime.fromMillisecondsSinceEpoch(sesion.expira);
  return vence.isAfter(ahora.add(margenDeCaducidad));
}

/// Por dónde empieza la aplicación cuando se abre el editor.
enum PasoDeArranque {
  /// No hay sesión utilizable: la pantalla de acceso, con su formulario.
  pedirCredenciales,

  /// Hay sesión y esta persona pidió que se le exija la huella para usarla.
  pedirHuella,

  /// Hay sesión y nada que preguntar: directo al WebView.
  entrar,
}

/// Qué hacer con lo que hay guardado, antes de abrir nada.
///
/// La regla que merece explicación es la última, y es la que decide si esto es
/// una protección o un adorno: **si la huella se pidió y el aparato ya no puede
/// ofrecerla, se pide la contraseña**, no se entra.
///
/// El caso llega de verdad. Se configura el desbloqueo por huella, y semanas
/// después se cambia el patrón de pantalla, o se borran las huellas
/// registradas, o se estropea el sensor. En ese momento Android deja de poder
/// autenticar localmente. La salida cómoda —entrar igual, porque «total, la
/// sesión sigue guardada»— convierte la huella en algo que se quita sin querer
/// y sin avisar: justo el modo de fallo que hace que una medida de seguridad
/// sea peor que no tenerla, porque quien la activó cree que sigue puesta.
///
/// Pedir la contraseña tampoco deja a nadie fuera: es la misma que sirvió para
/// entrar la primera vez, y el servidor la sigue aceptando.
PasoDeArranque pasoDeArranque({
  required SesionGuardada? guardada,
  required DateTime ahora,
  required bool exigeHuella,
  required bool aparatoPuedeHuella,
}) {
  if (guardada == null) return PasoDeArranque.pedirCredenciales;
  if (!sesionUtilizable(guardada, ahora)) return PasoDeArranque.pedirCredenciales;
  if (!exigeHuella) return PasoDeArranque.entrar;
  return aparatoPuedeHuella
      ? PasoDeArranque.pedirHuella
      : PasoDeArranque.pedirCredenciales;
}

/// Qué está mal en lo que se ha escrito, o `null` si nada.
///
/// Se comprueba **antes** de llamar al servidor, y no para ahorrar tráfico sino
/// por el mensaje: un formulario vacío enviado al backend vuelve con
/// «Credenciales incorrectas», que es la respuesta correcta del servidor —no
/// distingue correo inexistente de contraseña mala, a propósito, para que nadie
/// enumere cuentas— pero aquí es engañosa. Nadie se ha equivocado de
/// contraseña: es que no ha puesto ninguna.
///
/// No se valida nada más. Concretamente, no hay comprobación de que el correo
/// «parezca» un correo: las expresiones regulares de correo rechazan
/// direcciones válidas, y la única autoridad sobre si esa cuenta existe está en
/// el servidor.
String? problemaDeCredenciales(String email, String password) {
  if (email.trim().isEmpty) return 'Falta el correo.';
  if (password.isEmpty) return 'Falta la contraseña.';
  return null;
}

/// Resultado de intentar entrar.
sealed class ResultadoAcceso {
  const ResultadoAcceso();
}

class AccesoLogrado extends ResultadoAcceso {
  const AccesoLogrado(this.sesion);
  final SesionGuardada sesion;
}

class AccesoRechazado extends ResultadoAcceso {
  const AccesoRechazado(this.motivo);

  /// Qué enseñar debajo del formulario. Ya está redactado para leerse.
  final String motivo;
}

/// Traduce la respuesta de `POST /api/auth/acceso` a una de las dos cosas.
///
/// Es pura y recibe el código y el cuerpo en crudo para poder probar aquí todas
/// las formas de fallo, incluidas las que cuesta provocar contra un servidor de
/// verdad: el 502 de un intermediario que devuelve HTML, el 200 con un cuerpo
/// sin token, el JSON que no es un objeto.
///
/// El caso que más importa es el último. Un `200` con algo que no es la
/// respuesta esperada llega cuando el teléfono está detrás de un portal
/// cautivo —el wifi del campus que contesta su propia página de acceso a todo—,
/// y tratarlo como éxito guardaría como token un trozo de HTML. El síntoma
/// sería una sesión que existe, se guarda cifrada, sobrevive al reinicio y
/// falla en cada petición sin que nada diga por qué.
ResultadoAcceso interpretarAcceso(int codigo, String cuerpo) {
  if (codigo == 401) {
    // El mismo texto para correo desconocido y contraseña mala, porque es lo
    // único que el servidor dice y añadir detalle aquí sería inventarlo.
    return const AccesoRechazado('El correo o la contraseña no son correctos.');
  }
  if (codigo == 429) {
    return const AccesoRechazado(
      'Demasiados intentos seguidos. Espere un momento antes de volver a probar.',
    );
  }
  if (codigo >= 500) {
    return const AccesoRechazado(
      'El servidor ha fallado al comprobar el acceso. Inténtelo de nuevo dentro de un momento.',
    );
  }
  if (codigo != 200 && codigo != 201) {
    return AccesoRechazado('El servidor contestó $codigo al intentar entrar.');
  }

  Object? leido;
  try {
    leido = jsonDecode(cuerpo);
  } on FormatException {
    return const AccesoRechazado(
      'La respuesta del servidor no se entiende. Compruebe que la dirección apunta a la '
      'herramienta y no a otra página.',
    );
  }
  if (leido is! Map<String, Object?>) {
    return const AccesoRechazado('La respuesta del servidor no tiene la forma esperada.');
  }

  final token = leido['token'];
  final usuario = leido['usuario'];
  if (token is! String || token.isEmpty || usuario is! Map<String, Object?>) {
    return const AccesoRechazado('El servidor no devolvió ninguna sesión.');
  }
  final id = usuario['id'];
  if (id is! String || id.isEmpty) {
    return const AccesoRechazado('El servidor no devolvió ninguna sesión.');
  }

  // `expira` se admite ausente o roto sin rechazar el acceso: la autoridad sobre
  // la caducidad es el servidor, que contestará 401 cuando toque. Lo que no se
  // puede hacer es inventarse una fecha lejana, porque entonces el arranque sin
  // cobertura daría por buena una sesión muerta y llevaría a una lista de
  // proyectos que nunca carga. Sin fecha creíble, se guarda una ya pasada: el
  // arranque siguiente pedirá la contraseña, que es el fallo inofensivo.
  final expira = leido['expira'];

  return AccesoLogrado(
    SesionGuardada(
      token: token,
      usuarioId: id,
      email: usuario['email'] is String ? usuario['email']! as String : '',
      nombre: usuario['displayName'] is String ? usuario['displayName']! as String : '',
      expira: expira is int ? expira : 0,
    ),
  );
}
