import 'package:permission_handler/permission_handler.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Quién concede la cámara y el micrófono a la página que va dentro del WebView.
///
/// ## Por qué esto no se resuelve con una línea
///
/// Cuando la página llama a `getUserMedia`, el permiso hay que darlo **dos
/// veces** y a dos interlocutores distintos:
///
///   1. **Al WebView**, que pregunta «¿dejo que esta página use el micrófono?».
///      Se contesta desde `setOnPlatformPermissionRequest`.
///   2. **A Android**, que pregunta «¿dejo que esta *app* use el micrófono?».
///      Eso es el diálogo del sistema, y el WebView **no lo abre solo**.
///
/// Conceder solo la primera es el fallo que motiva este fichero: el WebView dice
/// que sí, la página cree que tiene permiso, y al abrir el micrófono Android lo
/// niega. Lo que llega al navegador es un `NotAllowedError` o un
/// `NotReadableError` indistinguibles de que la persona haya dicho que no, así
/// que el tablón enseña «hay que abrir el candado de la barra de direcciones»
/// —consejo inútil en una app sin barra de direcciones— y nadie sabe por qué no
/// graba.
///
/// La app declara `RECORD_AUDIO` y `CAMERA` en el manifiesto desde hace tiempo,
/// pero eso solo da derecho a preguntar. Hasta ahora nadie preguntaba por esta
/// vía: la cámara la abre `image_picker` y el dictado lo hace `speech_to_text`,
/// y cada uno pide lo suyo desde su propio código nativo. Las notas de voz del
/// tablón son la primera función que captura audio desde la página.
///
/// ## Por qué se deniega lo que no se reconoce
///
/// La versión anterior concedía cualquier petición sin mirarla. Funcionaba
/// porque la única página que se carga es la nuestra, pero es una garantía que
/// depende de que eso siga siendo verdad: basta un enlace externo que se abra
/// dentro para que una página cualquiera tenga cámara y micrófono sin que nadie
/// se entere. Además, «cualquier petición» incluye cosas que esta aplicación no
/// usa —MIDI SysEx, identificadores de medios protegidos— y conceder un recurso
/// que nadie ha pedido nunca no tiene ningún lado bueno.
///
/// El criterio es: se conoce el recurso y Android lo concede, o no se da.

/// El permiso de Android que corresponde a cada recurso que puede pedir la
/// página, o `null` si es un recurso que esta aplicación no usa.
Permission? permisoDeAndroid(WebViewPermissionResourceType tipo) {
  if (tipo == WebViewPermissionResourceType.camera) return Permission.camera;
  if (tipo == WebViewPermissionResourceType.microphone) {
    return Permission.microphone;
  }
  return null;
}

/// Decide si se concede la petición entera.
///
/// `pedir` es la parte que habla con el sistema y se inyecta para poder probar
/// la decisión sin teléfono: lo que hay que comprobar aquí son las reglas —qué
/// se reconoce, qué pasa si falta uno de dos, qué se hace con una petición
/// vacía— y ninguna de ellas necesita un diálogo de Android abriéndose.
///
/// Se concede **todo o nada** porque la petición del WebView es todo o nada: no
/// hay forma de contestar «la cámara sí y el micrófono no». Ante una petición
/// mixta en la que solo se conceda una mitad, decir que sí sería prometer un
/// recurso que después fallará al abrirse.
Future<bool> sePuedeConceder(
  Set<WebViewPermissionResourceType> tipos,
  Future<bool> Function(Permission permiso) pedir,
) async {
  // Una petición sin recursos no es una petición inocua: es una que no se ha
  // sabido leer. Conceder a ciegas lo que no se ha entendido es justo lo que
  // esta función existe para no hacer.
  if (tipos.isEmpty) return false;

  for (final tipo in tipos) {
    final permiso = permisoDeAndroid(tipo);
    if (permiso == null) return false;
    if (!await pedir(permiso)) return false;
  }
  return true;
}

/// Pide un permiso al sistema y dice si quedó concedido.
///
/// El diálogo solo aparece la primera vez; después Android contesta al instante
/// con lo que se respondió entonces. Un «no» definitivo —el de «no volver a
/// preguntar»— tampoco vuelve a abrir nada, así que esto no puede convertirse
/// en un teléfono preguntando lo mismo a cada toque del botón.
Future<bool> pedirAlSistema(Permission permiso) async {
  final estado = await permiso.request();
  return estado.isGranted;
}

/// Atiende la petición de permisos que llega desde la página.
///
/// Es la función que se le pasa a `setOnPlatformPermissionRequest`. Devuelve un
/// `Future` que nadie espera —la firma del plugin no lo permite— y eso es
/// correcto: el WebView deja la petición en pie hasta que se le contesta, que es
/// exactamente lo que hace falta mientras el diálogo de Android está abierto.
Future<void> atenderPeticionWeb(
  PlatformWebViewPermissionRequest peticion, {
  Future<bool> Function(Permission permiso) pedir = pedirAlSistema,
}) async {
  if (await sePuedeConceder(peticion.types, pedir)) {
    await peticion.grant();
  } else {
    await peticion.deny();
  }
}
