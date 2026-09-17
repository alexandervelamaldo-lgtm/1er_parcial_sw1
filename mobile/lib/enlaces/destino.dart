/// A dónde lleva un enlace `umluml://`, y qué enlaces no llevan a ninguna parte.
///
/// ## Para qué sirven
///
/// Un proyecto se comparte pegando una dirección en un chat. En el navegador
/// eso ya funciona —`/proyecto/<id>` abre el editor—, pero en el teléfono el
/// enlace `http://` lo abre Chrome, no la app, y quien lo recibe acaba
/// escribiendo la contraseña otra vez en un navegador que no tiene ni el token
/// en el Keystore ni el diagrama guardado en local. El esquema propio
/// `umluml://proyecto/<id>` es lo que hace que el enlace abra la aplicación.
///
/// ## Por qué esto es código de seguridad y no de navegación
///
/// Un enlace profundo es **entrada de fuera, y de la peor clase**: cualquier
/// página web y cualquier app instalada puede lanzar un `umluml://` sin pedirle
/// permiso a nadie, y el sistema nos lo entrega sin más comprobación que el
/// esquema. Lo que llegue aquí acaba pegado a la URL que carga el WebView, y ese
/// WebView tiene enchufado el puente de sesión: la página que esté cargada puede
/// pedir el token por `window.SesionNativa` y recibirlo.
///
/// Encadenando las dos cosas, un identificador sin validar es una fuga de la
/// llave. Basta con que el «identificador» sea algo que empuje la URL fuera del
/// origen de la herramienta para que la página que aparezca al otro lado pueda
/// pedir el token y quedárselo, y desde el teléfono no se vería nada raro: la
/// app se abre, como se esperaba.
///
/// Por eso el identificador se comprueba contra la forma exacta que el servidor
/// genera —un UUID, `randomUUID()` en `backend-tool/src/storage/store.ts`, que
/// la API valida con `z.string().uuid()`— y se **rechaza, no se limpia**, que es
/// la misma regla del RNF-SEG-06 y por el mismo motivo: limpiar es adivinar qué
/// quería decir quien escribió algo que no debía.
///
/// La segunda mitad de la defensa está en `mismoOrigen`, que impide que el
/// WebView acabe en otro sitio por cualquier otra vía.
///
/// Todo el fichero es puro y se prueba sin teléfono. El cableado con el sistema
/// está en `main.dart`.
library;

/// El esquema que Android nos entrega. Está también en `AndroidManifest.xml`.
const String esquemaEnlace = 'umluml';

/// La primera parte del enlace: de momento solo se navega a proyectos.
const String anfitrionProyecto = 'proyecto';

/// La forma exacta de un identificador de proyecto.
///
/// Es el `randomUUID()` del servidor, ni más ni menos. No se admiten
/// identificadores «parecidos»: si algún día el backend cambiara de formato,
/// esta línea tiene que cambiar a la vez y es mejor que el enlace deje de
/// funcionar a que deje de comprobarse.
final RegExp _formaDeUuid = RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
);

/// Si esto puede ser un proyecto nuestro.
bool esIdentificadorDeProyecto(String id) => _formaDeUuid.hasMatch(id);

/// El proyecto al que apunta un enlace, o `null` si no apunta a ninguno.
///
/// Devolver `null` es la respuesta a todo lo que no se entiende, y lo que hace
/// quien llama con ese `null` es **abrir la aplicación por donde la abriría sin
/// enlace**. No hay pantalla de error: un enlace de otra app que por lo que sea
/// llegó aquí no es un fallo del usuario, y una app que arranca con una queja
/// sobre algo que él no escribió es peor que una que sencillamente se abre.
///
/// Se admiten las dos escrituras, `umluml://proyecto/<id>` y
/// `umluml:proyecto/<id>`, porque la segunda es la que sale de escribir el
/// enlace a mano o de un cliente de correo que lo rehace. El esquema se compara
/// en minúsculas: `Uri` ya lo normaliza, pero depender de eso sería depender de
/// un detalle de otra biblioteca.
String? proyectoDeEnlace(Uri enlace) {
  if (enlace.scheme.toLowerCase() != esquemaEnlace) return null;

  // El anfitrión y la ruta se juntan porque, según cómo venga escrito el
  // enlace, «proyecto» cae en uno o en la otra. Lo que importa son las dos
  // partes que quedan, no en cuál de los dos campos las puso el analizador.
  final partes = <String>[
    if (enlace.host.isNotEmpty) enlace.host,
    ...enlace.pathSegments.where((parte) => parte.isNotEmpty),
  ];
  // Exactamente dos: ni una menos —`umluml://proyecto` no dice cuál— ni una
  // más. Aceptar sobrantes sería aceptar `umluml://proyecto/<id>/../../otra`,
  // que es justo por donde se sale del origen.
  if (partes.length != 2) return null;
  if (partes[0].toLowerCase() != anfitrionProyecto) return null;

  final id = partes[1];
  return esIdentificadorDeProyecto(id) ? id : null;
}

/// La dirección que hay que cargar en el WebView para ese proyecto.
///
/// Se construye sobre `APP_URL` y no sobre una constante porque la ruta de la
/// interfaz táctil viaja dentro de ella —`http://localhost:3001/movil` hoy, un
/// dominio el día del despliegue— y el enlace tiene que respetarla: entrar por
/// `/proyecto/<id>` en vez de por `/movil/proyecto/<id>` abre el editor de
/// escritorio, que en un teléfono son tres columnas de las que dos no caben.
///
/// Se usa `replace(pathSegments:)` y no una concatenación de cadenas: así el
/// identificador se codifica como un segmento de ruta pase lo que pase, y no
/// hay forma de que una barra cambie de sitio. Con un UUID validado esto no
/// hace falta; se hace igual para que siga siendo cierto si algún día el
/// formato del identificador se amplía.
String urlDelProyecto(String urlBase, String proyecto) {
  final base = Uri.parse(urlBase);
  return base.replace(
    pathSegments: <String>[
      ...base.pathSegments.where((parte) => parte.isNotEmpty),
      'proyecto',
      proyecto,
    ],
  ).toString();
}

/// Si una dirección pertenece al mismo sitio que sirve la aplicación.
///
/// Es el cerrojo del WebView, y existe por lo que hay enchufado a él: mientras
/// esa ventana tenga registrado el canal `SesionNativa`, **cualquier página que
/// se cargue dentro puede pedir el token y recibirlo**. El puente no sabe qué
/// hay cargado; solo sabe contestar.
///
/// Así que la regla no es «no enseñar páginas raras» sino «el token solo se le
/// presta al origen que lo emitió». Un enlace externo dentro de la página, un
/// `window.location` inyectado, un redirect de un portal cautivo: los tres
/// acaban en el mismo sitio, y ninguno de los tres da ningún error.
///
/// Se compara el origen —esquema, anfitrión y puerto—, no la ruta: dentro del
/// sitio se navega con libertad, que es lo que hace una aplicación de una sola
/// página. Y el puerto se resuelve con `Uri.port`, que devuelve el 80 o el 443
/// implícitos, para que `https://ejemplo` y `https://ejemplo:443` no parezcan
/// dos sitios distintos.
bool mismoOrigen(String urlBase, String destino) {
  final base = Uri.parse(urlBase);
  final ir = Uri.tryParse(destino);
  if (ir == null) return false;

  // `about:blank` es la página vacía que el propio WebView carga al crearse y
  // al descartar un documento. No es un destino que nadie elija y bloquearla
  // deja la ventana en un estado que no se puede repintar.
  if (ir.scheme == 'about') return true;

  return ir.scheme == base.scheme && ir.host == base.host && ir.port == base.port;
}
