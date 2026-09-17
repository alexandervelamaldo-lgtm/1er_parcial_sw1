import 'package:flutter_test/flutter_test.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:uml_movil/permisos_nativos.dart';
import 'package:webview_flutter/webview_flutter.dart';

/// Pruebas de a quién se le abre el micrófono dentro del WebView.
///
/// Todo lo que se comprueba aquí es una decisión, no una llamada al sistema: el
/// diálogo de Android se sustituye por una función que dice que sí o que no. Es
/// la única forma de probar el caso que importa —el de una petición mixta en la
/// que Android concede una mitad— sin un teléfono delante y sin un dedo que
/// pulse el botón.

/// Un recurso que la página podría pedir y que esta aplicación no usa.
///
/// Se declara aquí y no se importa de `webview_flutter_android` a propósito: lo
/// que se quiere probar es qué pasa con **cualquier** recurso desconocido,
/// incluido uno que aparezca en una versión futura del plugin, y no solo con los
/// dos que hoy tienen nombre.
class _RecursoDesconocido extends WebViewPermissionResourceType {
  const _RecursoDesconocido() : super('inventado');
}

/// Concede lo que esté en la lista y niega el resto.
Future<bool> Function(Permission) concediendo(List<Permission> concedidos) {
  return (permiso) async => concedidos.contains(permiso);
}

void main() {
  group('a qué permiso de Android corresponde cada recurso', () {
    test('la cámara y el micrófono tienen el suyo', () {
      expect(
        permisoDeAndroid(WebViewPermissionResourceType.camera),
        Permission.camera,
      );
      expect(
        permisoDeAndroid(WebViewPermissionResourceType.microphone),
        Permission.microphone,
      );
    });

    test('lo que no se reconoce no tiene permiso que pedir', () {
      expect(permisoDeAndroid(const _RecursoDesconocido()), isNull);
    });
  });

  group('sePuedeConceder', () {
    test('el micrófono concedido por Android se concede a la página', () async {
      final concedido = await sePuedeConceder(
        {WebViewPermissionResourceType.microphone},
        concediendo([Permission.microphone]),
      );
      expect(concedido, isTrue);
    });

    /// Este es el fallo que motivó todo el fichero: decir que sí sin
    /// comprobarlo. La página recibía el permiso, abría el micrófono y Android
    /// lo negaba por su cuenta, con un error que se lee como si lo hubiera
    /// rechazado la persona.
    test('el micrófono negado por Android se niega a la página', () async {
      final concedido = await sePuedeConceder(
        {WebViewPermissionResourceType.microphone},
        concediendo([]),
      );
      expect(concedido, isFalse);
    });

    test('un recurso que no usamos no se concede aunque venga solo', () async {
      final concedido = await sePuedeConceder(
        {const _RecursoDesconocido()},
        // Aunque el sistema dijera que sí a todo.
        (permiso) async => true,
      );
      expect(concedido, isFalse);
    });

    /// La petición del WebView es todo o nada: no hay forma de contestar «la
    /// cámara sí y el micrófono no». Conceder a medias sería prometer un
    /// recurso que va a fallar al abrirse.
    test('una petición mixta con una mitad negada se niega entera', () async {
      final concedido = await sePuedeConceder(
        {
          WebViewPermissionResourceType.camera,
          WebViewPermissionResourceType.microphone,
        },
        concediendo([Permission.camera]),
      );
      expect(concedido, isFalse);
    });

    test('una petición mixta con las dos concedidas se concede', () async {
      final concedido = await sePuedeConceder(
        {
          WebViewPermissionResourceType.camera,
          WebViewPermissionResourceType.microphone,
        },
        concediendo([Permission.camera, Permission.microphone]),
      );
      expect(concedido, isTrue);
    });

    /// Una petición vacía no es una petición inocua: es una que el plugin no ha
    /// sabido traducir. Conceder lo que no se ha entendido es exactamente lo que
    /// esta función existe para no hacer.
    test('una petición sin recursos no se concede', () async {
      expect(await sePuedeConceder({}, (permiso) async => true), isFalse);
    });

    /// Si el primero ya decide el resultado, no hay por qué abrir un segundo
    /// diálogo del sistema: sería preguntar por la cámara para después negarla
    /// igualmente por el micrófono.
    test('no sigue preguntando después de un no', () async {
      final pedidos = <Permission>[];
      await sePuedeConceder(
        {
          WebViewPermissionResourceType.camera,
          WebViewPermissionResourceType.microphone,
        },
        (permiso) async {
          pedidos.add(permiso);
          return false;
        },
      );
      expect(pedidos, hasLength(1));
    });
  });

  group('atenderPeticionWeb', () {
    test('contesta que sí cuando el sistema concede', () async {
      final peticion = _PeticionFalsa({
        WebViewPermissionResourceType.microphone,
      });
      await atenderPeticionWeb(
        peticion,
        pedir: concediendo([Permission.microphone]),
      );
      expect(peticion.respuesta, 'concedida');
    });

    /// Hay que contestar **siempre**. Una petición sin respuesta deja a la
    /// página esperando para siempre: el botón de grabar se queda pulsado y no
    /// pasa nada, que es peor que un «no» claro.
    test('contesta que no cuando el sistema niega', () async {
      final peticion = _PeticionFalsa({
        WebViewPermissionResourceType.microphone,
      });
      await atenderPeticionWeb(peticion, pedir: concediendo([]));
      expect(peticion.respuesta, 'denegada');
    });
  });
}

/// Una petición del WebView que apunta lo que se le contesta.
///
/// Lo apuntado va en una lista `final` y no en un campo que se reasigne porque
/// la clase de la que hereda está marcada `@immutable`. De paso se gana algo que
/// un campo suelto no daría: si alguna vez se contestara dos veces a la misma
/// petición —que es un error, el WebView solo admite una respuesta— aquí se
/// vería, en vez de quedar tapado por la última.
class _PeticionFalsa extends PlatformWebViewPermissionRequest {
  _PeticionFalsa(Set<WebViewPermissionResourceType> tipos) : super(types: tipos);

  final List<String> respuestas = <String>[];

  /// La única respuesta dada, o `null` si no se contestó nada.
  String? get respuesta =>
      respuestas.length == 1 ? respuestas.single : null;

  @override
  Future<void> grant() async => respuestas.add('concedida');

  @override
  Future<void> deny() async => respuestas.add('denegada');
}
