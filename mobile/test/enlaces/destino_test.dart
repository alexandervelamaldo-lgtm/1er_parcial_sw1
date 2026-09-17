import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/enlaces/destino.dart';

/// Pruebas de a dónde lleva un enlace, y sobre todo de a dónde no.
///
/// La mitad de este fichero son enlaces malos, y conviene decir por qué antes
/// de leerla. Un `umluml://` lo puede lanzar cualquier página web y cualquier
/// app instalada, sin permiso y sin que se vea nada: el sistema nos lo entrega
/// con la única comprobación de que el esquema es el nuestro. Lo que llegue en
/// él acaba en la URL que carga el WebView, y en ese WebView está enchufado el
/// canal `SesionNativa`, que le entrega el token a la página que haya cargada.
///
/// O sea que un identificador sin validar no es un enlace roto: es la llave de
/// la cuenta en manos de quien escribió el enlace. Por eso los casos de abajo
/// son intentos de salirse del origen, y por eso todos tienen que dar `null`.
void main() {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  group('el enlace que sí lleva a un proyecto', () {
    test('la forma normal', () {
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/$uuid')), uuid);
    });

    test('sin las dos barras, que es como se escribe a mano', () {
      expect(proyectoDeEnlace(Uri.parse('umluml:proyecto/$uuid')), uuid);
    });

    test('con la barra final que añaden algunos clientes de correo', () {
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/$uuid/')), uuid);
    });

    test('el esquema en mayúsculas vale igual', () {
      // Android normaliza, pero hay lanzadores que no. Un enlace que funciona o
      // no según quién lo mande es de los fallos que nadie consigue reproducir.
      expect(proyectoDeEnlace(Uri.parse('UMLUML://proyecto/$uuid')), uuid);
    });

    test('un UUID en mayúsculas se devuelve tal cual, no se toca', () {
      // El identificador va en la ruta, que `Uri` no normaliza, y el servidor
      // lo compara como cadena. Cambiarlo aquí sería inventarnos un proyecto.
      final mayus = uuid.toUpperCase();
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/$mayus')), mayus);
    });
  });

  group('los enlaces que no son para nosotros', () {
    test('otro esquema no se mira siquiera', () {
      expect(proyectoDeEnlace(Uri.parse('https://proyecto/$uuid')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml2://proyecto/$uuid')), isNull);
    });

    test('otra cosa que no sea un proyecto', () {
      // Aquí solo se navega a proyectos. El día que haya otro destino, esta
      // prueba dejará de pasar y habrá que decidirlo a propósito.
      expect(proyectoDeEnlace(Uri.parse('umluml://usuario/$uuid')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml://ajustes')), isNull);
    });

    test('un proyecto sin decir cuál', () {
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/')), isNull);
    });

    test('el enlace vacío', () {
      expect(proyectoDeEnlace(Uri.parse('')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml://')), isNull);
    });
  });

  group('los enlaces que intentan salirse del sitio', () {
    test('un identificador que no es un UUID se rechaza, no se limpia', () {
      /*
        La regla del RNF-SEG-06 aplicada aquí, y por el mismo motivo: limpiar
        es adivinar qué quería decir quien escribió algo que no debía. Con un
        UUID no hay nada que adivinar —o lo es o no lo es—.
      */
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/mi-proyecto')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/1')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/$uuid-extra')), isNull);
      expect(
        proyectoDeEnlace(Uri.parse('umluml://proyecto/3f2504e0-4f89-11d3-9a0c-0305e82c330')),
        isNull,
      );
    });

    test('subir por la ruta no lleva a ninguna parte', () {
      /*
        El intento clásico. Sin la comprobación de que sobran segmentos, esto
        acabaría pegado a `http://localhost:3001/movil/proyecto/` y el `..`
        sacaría al WebView de la ruta táctil hacia arriba. `Uri` resuelve
        algunos por su cuenta, así que se prueban las dos escrituras.
      */
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/../../otra')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/..%2F..%2Fotra')), isNull);
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/$uuid/../otra')), isNull);
    });

    test('una dirección entera metida donde va el identificador', () {
      // Lo que buscaría quien quiere que el WebView cargue su página con el
      // puente de sesión enchufado y le pida el token por él.
      expect(
        proyectoDeEnlace(Uri.parse('umluml://proyecto/https://malo.example')),
        isNull,
      );
      expect(
        proyectoDeEnlace(Uri.parse('umluml://proyecto/%2F%2Fmalo.example')),
        isNull,
      );
    });

    test('un javascript: donde va el identificador', () {
      expect(
        proyectoDeEnlace(Uri.parse('umluml://proyecto/javascript:alert(1)')),
        isNull,
      );
    });

    test('sobra todo lo que venga detrás del identificador', () {
      expect(proyectoDeEnlace(Uri.parse('umluml://proyecto/$uuid/editar')), isNull);
    });
  });

  group('la dirección que se acaba cargando', () {
    test('se respeta la ruta táctil que trae APP_URL', () {
      /*
        Entrar por `/proyecto/<id>` en vez de por `/movil/proyecto/<id>` abre
        el editor de escritorio, que en un teléfono son tres columnas de las
        que dos no caben. El enlace no puede perder ese prefijo por el camino.
      */
      expect(
        urlDelProyecto('http://localhost:3001/movil', uuid),
        'http://localhost:3001/movil/proyecto/$uuid',
      );
    });

    test('funciona igual con un dominio y sin prefijo', () {
      expect(
        urlDelProyecto('https://uml.example.com', uuid),
        'https://uml.example.com/proyecto/$uuid',
      );
    });

    test('una barra de más en la base no duplica la del medio', () {
      expect(
        urlDelProyecto('http://localhost:3001/movil/', uuid),
        'http://localhost:3001/movil/proyecto/$uuid',
      );
    });
  });

  group('el cerrojo del WebView', () {
    const base = 'http://localhost:3001/movil';

    test('dentro del sitio se navega con libertad', () {
      // Es una aplicación de una sola página: la ruta cambia constantemente y
      // bloquear por ruta la dejaría clavada en la primera pantalla.
      expect(mismoOrigen(base, 'http://localhost:3001/movil'), isTrue);
      expect(mismoOrigen(base, 'http://localhost:3001/movil/proyecto/$uuid'), isTrue);
      expect(mismoOrigen(base, 'http://localhost:3001/api/auth/yo'), isTrue);
    });

    test('otro sitio no, aunque se le parezca', () {
      /*
        Lo que se está protegiendo es el token: mientras el canal `SesionNativa`
        esté registrado en esa ventana, la página que se cargue dentro puede
        pedirlo y recibirlo. El puente no sabe qué hay cargado, solo sabe
        contestar, así que el cerrojo tiene que estar aquí.
      */
      expect(mismoOrigen(base, 'http://malo.example/'), isFalse);
      expect(mismoOrigen(base, 'https://localhost:3001/movil'), isFalse);
      expect(mismoOrigen(base, 'http://localhost:3002/movil'), isFalse);
      expect(mismoOrigen(base, 'http://localhost.malo.example:3001/'), isFalse);
    });

    test('ni por un esquema que no es una página', () {
      expect(mismoOrigen(base, 'javascript:alert(1)'), isFalse);
      expect(mismoOrigen(base, 'file:///etc/hosts'), isFalse);
      expect(mismoOrigen(base, 'intent://malo.example#Intent;end'), isFalse);
    });

    test('la página en blanco pasa: la carga el propio WebView', () {
      // No es un destino que nadie elija, y bloquearla deja la ventana en un
      // estado que no se puede repintar.
      expect(mismoOrigen(base, 'about:blank'), isTrue);
    });

    test('el puerto implícito y el escrito son el mismo sitio', () {
      expect(mismoOrigen('https://uml.example.com', 'https://uml.example.com:443/x'), isTrue);
      expect(mismoOrigen('https://uml.example.com:443', 'https://uml.example.com/x'), isTrue);
    });
  });
}
