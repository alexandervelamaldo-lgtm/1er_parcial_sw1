import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/camara_nativa.dart';

/// El puente de la cámara, comprobado sin teléfono y sin cámara.
///
/// Lo que la cámara y la pantalla de recorte hacen está detrás de un
/// `TomarFoto` inyectado, así que aquí no se prueba ni el sensor ni el
/// arrastre de las asas —eso hay que mirarlo en un aparato—. Se prueba el
/// tramo que se rompe callado:
///
/// 1. **El troceado.** La foto baja partida porque entera no cabe en una
///    transacción Binder. Un trozo de menos da una imagen a la que le falta la
///    franja de abajo, que es medio creíble.
/// 2. **La petición repetida.** Dos toques seguidos apilarían dos cámaras.
/// 3. **Las tres salidas.** Cancelar no es fallar, y confundirlas significa un
///    error rojo por darle a «atrás».
/// 4. **Las formas malas del mensaje.** El canal está expuesto a cualquier
///    JavaScript de la página, y una excepción ahí deja el puente mudo.
void main() {
  /// Monta el puente con una cámara de mentira y recoge lo que contesta.
  ({PuenteCamara puente, List<Map<String, Object?>> mensajes}) montar(
    TomarFoto tomar,
  ) {
    final mensajes = <Map<String, Object?>>[];
    final puente = PuenteCamara(tomar: tomar)
      ..responderA((mensaje) async => mensajes.add(mensaje));
    return (puente: puente, mensajes: mensajes);
  }

  String peticion(String id) => jsonEncode({'tipo': 'foto', 'id': id});

  /// Rehace los bytes a partir de los mensajes, como hará `camara.ts`.
  ///
  /// Coloca por índice y no concatena en orden de llegada, que es la misma
  /// decisión que en las descargas: el orden del canal es una propiedad de la
  /// implementación, no del contrato.
  Uint8List reensamblar(List<Map<String, Object?>> mensajes, String id) {
    final inicio = mensajes.firstWhere(
      (m) => m['tipo'] == 'inicio' && m['id'] == id,
    );
    final total = inicio['trozos']! as int;
    final piezas = List<String?>.filled(total, null);
    for (final mensaje in mensajes) {
      if (mensaje['tipo'] != 'trozo' || mensaje['id'] != id) continue;
      piezas[mensaje['indice']! as int] = mensaje['datos']! as String;
    }
    expect(piezas.contains(null), isFalse, reason: 'faltó algún trozo');
    return base64Decode(piezas.cast<String>().join());
  }

  group('la foto baja entera aunque vaya partida', () {
    test('una foto pequeña llega en un solo trozo', () async {
      final bytes = Uint8List.fromList(List.generate(300, (i) => i % 256));
      final m = montar(() async => FotoLista(bytes));

      await m.puente.recibir(peticion('a'));

      expect(m.mensajes.first['tipo'], 'inicio');
      expect(m.mensajes.first['mime'], 'image/jpeg');
      expect(m.mensajes.first['trozos'], 1);
      expect(reensamblar(m.mensajes, 'a'), bytes);
    });

    test('una foto que no cabe en una transacción llega igual', () async {
      // Setecientos mil bytes son novecientos treinta y tantos mil caracteres
      // de base64: cuatro trozos. Es del orden de lo que pesa de verdad un
      // JPEG de 1600 px con un diagrama, y muy por encima del megabyte del
      // Binder si fuera de una pieza.
      final bytes = Uint8List.fromList(
        List.generate(700000, (i) => (i * 31 + 7) % 256),
      );
      final m = montar(() async => FotoLista(bytes));

      await m.puente.recibir(peticion('grande'));

      final inicio = m.mensajes.first;
      expect(inicio['trozos'], greaterThan(1));
      expect(reensamblar(m.mensajes, 'grande'), bytes);

      // Y ningún trozo pasa del tope, que es lo que de verdad se está
      // comprando con todo esto.
      for (final mensaje in m.mensajes.where((x) => x['tipo'] == 'trozo')) {
        expect(
          (mensaje['datos']! as String).length,
          lessThanOrEqualTo(trozoCamaraCaracteres),
        );
      }
    });

    test('los trozos se anuncian antes de mandarse', () async {
      // Si un trozo llegara antes que su «inicio», el lado web no sabría
      // cuántos reservar y lo tiraría.
      final bytes = Uint8List.fromList(List.generate(600000, (i) => i % 256));
      final m = montar(() async => FotoLista(bytes));

      await m.puente.recibir(peticion('orden'));

      expect(m.mensajes.first['tipo'], 'inicio');
      final indices = m.mensajes
          .where((x) => x['tipo'] == 'trozo')
          .map((x) => x['indice'])
          .toList();
      expect(indices, List.generate(indices.length, (i) => i));
    });

    test('el troceado no se deja el último cacho', () {
      // El error de una unidad clásico: con un tamaño que no es múltiplo
      // exacto, el último trozo es el corto y es el que se pierde.
      expect(partirEnTrozos('abcdefg', porTrozo: 3), ['abc', 'def', 'g']);
      expect(partirEnTrozos('abcdef', porTrozo: 3), ['abc', 'def']);
      expect(partirEnTrozos('ab', porTrozo: 3), ['ab']);
    });

    test('una cadena vacía da un trozo vacío, no cero trozos', () {
      // Con cero trozos el «inicio» anunciaría cero y la página esperaría para
      // siempre un final que no llega.
      expect(partirEnTrozos(''), ['']);
    });
  });

  group('las tres salidas se distinguen', () {
    test('cancelar no es un error', () async {
      final m = montar(() async => const FotoCancelada());

      await m.puente.recibir(peticion('b'));

      expect(m.mensajes, hasLength(1));
      expect(m.mensajes.single['tipo'], 'cancelada');
      expect(m.mensajes.single['id'], 'b');
      expect(m.mensajes.single.containsKey('motivo'), isFalse);
    });

    test('un fallo lleva el motivo que se le puede enseñar a alguien', () async {
      final m = montar(
        () async => const FotoFallida('Ajusta las esquinas: el recorte está doblado.'),
      );

      await m.puente.recibir(peticion('c'));

      expect(m.mensajes.single['tipo'], 'error');
      expect(m.mensajes.single['motivo'], contains('esquinas'));
    });

    test('una excepción de la cámara se contesta, no se traga', () async {
      // El caso de los permisos denegados o el aparato sin cámara. Si esto no
      // se contestara, el botón de la página se quedaría girando para siempre,
      // que es peor que un error porque no sugiere nada que hacer.
      final m = montar(() async => throw StateError('sin permiso'));

      await m.puente.recibir(peticion('d'));

      expect(m.mensajes.single['tipo'], 'error');
      expect(m.mensajes.single['motivo'], contains('cámara'));
    });

    test('una foto vacía se rechaza en vez de mandarse', () async {
      final m = montar(() async => FotoLista(Uint8List(0)));

      await m.puente.recibir(peticion('e'));

      expect(m.mensajes.single['tipo'], 'error');
      expect(m.mensajes.where((x) => x['tipo'] == 'trozo'), isEmpty);
    });

    test('una foto por encima del tope se rechaza antes de trocear', () async {
      final m = montar(
        () async => FotoLista(Uint8List(limiteFotoBytes + 1)),
      );

      await m.puente.recibir(peticion('f'));

      expect(m.mensajes.single['tipo'], 'error');
      expect(m.mensajes.single['motivo'], contains('grande'));
    });
  });

  group('no se apilan dos cámaras', () {
    test('la segunda petición mientras la primera vive se rechaza', () async {
      // Un doble toque en el botón. Sin esto se abrirían dos cámaras, y al
      // cerrar la de arriba aparecería la de abajo, que ya nadie espera.
      var abiertas = 0;
      final mensajes = <Map<String, Object?>>[];
      final puente = PuenteCamara(
        tomar: () {
          abiertas += 1;
          return Future<ResultadoDeFoto>(() async {
            await Future<void>.delayed(const Duration(milliseconds: 10));
            return FotoLista(Uint8List.fromList([1, 2, 3]));
          });
        },
      )..responderA((mensaje) async => mensajes.add(mensaje));

      final primera = puente.recibir(peticion('uno'));
      await puente.recibir(peticion('dos'));

      expect(abiertas, 1);
      expect(mensajes.single['tipo'], 'error');
      expect(mensajes.single['id'], 'dos');
      expect(mensajes.single['motivo'], contains('en marcha'));

      await primera;
      expect(abiertas, 1);
      expect(mensajes.any((x) => x['tipo'] == 'inicio' && x['id'] == 'uno'), isTrue);
    });

    test('después de una foto se puede pedir otra', () async {
      var veces = 0;
      final m = montar(() async {
        veces += 1;
        return FotoLista(Uint8List.fromList([veces]));
      });

      await m.puente.recibir(peticion('uno'));
      await m.puente.recibir(peticion('dos'));

      expect(veces, 2);
      expect(reensamblar(m.mensajes, 'dos'), Uint8List.fromList([2]));
    });

    test('después de un fallo también', () async {
      // El caso que el `finally` protege: si la marca se quedara puesta al
      // fallar, el botón quedaría inutilizado hasta cerrar la aplicación.
      var veces = 0;
      final m = montar(() async {
        veces += 1;
        if (veces == 1) throw StateError('la primera revienta');
        return FotoLista(Uint8List.fromList([9]));
      });

      await m.puente.recibir(peticion('uno'));
      await m.puente.recibir(peticion('dos'));

      expect(veces, 2);
      expect(reensamblar(m.mensajes, 'dos'), Uint8List.fromList([9]));
    });
  });

  group('los mensajes mal formados no tumban el puente', () {
    test('lo que no es JSON se ignora', () async {
      var abierta = false;
      final m = montar(() async {
        abierta = true;
        return const FotoCancelada();
      });

      await m.puente.recibir('esto no es json');
      await m.puente.recibir('');
      await m.puente.recibir('[1, 2, 3]');

      expect(abierta, isFalse);
      expect(m.mensajes, isEmpty);
    });

    test('sin identificador no se contesta', () async {
      // Contestar sin id sería un mensaje que la página no sabe a qué petición
      // atribuir, y el reensamblado lo colocaría en cualquier sitio.
      final m = montar(() async => const FotoCancelada());

      await m.puente.recibir(jsonEncode({'tipo': 'foto'}));
      await m.puente.recibir(jsonEncode({'tipo': 'foto', 'id': ''}));
      await m.puente.recibir(jsonEncode({'tipo': 'foto', 'id': 7}));

      expect(m.mensajes, isEmpty);
    });

    test('un tipo desconocido se ignora', () async {
      final m = montar(() async => const FotoCancelada());

      await m.puente.recibir(jsonEncode({'tipo': 'vídeo', 'id': 'x'}));

      expect(m.mensajes, isEmpty);
    });

    test('el puente sigue vivo después de todo lo anterior', () async {
      final m = montar(() async => FotoLista(Uint8List.fromList([4, 5])));

      await m.puente.recibir('{{{');
      await m.puente.recibir(jsonEncode({'tipo': 'foto'}));
      await m.puente.recibir(peticion('bueno'));

      expect(reensamblar(m.mensajes, 'bueno'), Uint8List.fromList([4, 5]));
    });
  });

  group('el guion que se ejecuta en la página', () {
    test('mete la carga como dato, no como código', () {
      final guion = guionMensajeCamara({
        'tipo': 'error',
        'id': 'x',
        'motivo': 'Comillas " y contrabarras \\ y </script>',
      });

      // El motivo no aparece en crudo: si apareciera, la comilla de dentro
      // cerraría el literal de JavaScript y lo que viene detrás pasaría a ser
      // código. Lo que sale es la comilla escapada.
      expect(guion, isNot(contains('Comillas " y')));
      expect(guion, contains(r'Comillas \\\" y'));
      expect(guion, contains(nombreReceptorCamara));

      // El `</script>` sí viaja tal cual, y está bien que viaje: `jsonEncode`
      // no escapa la barra y aquí no hace falta. Esa secuencia solo es
      // peligrosa cuando el JavaScript se incrusta dentro del HTML, porque el
      // analizador de HTML cierra la etiqueta sin mirar si está dentro de una
      // cadena. `runJavaScript` no incrusta nada: entrega el texto al motor de
      // JavaScript ya como programa. Se deja anotado porque la costumbre de
      // buscar esa secuencia es buena y conviene saber por qué aquí no aplica.
      expect(guion, contains('</script>'));
    });

    test('comprueba que el receptor existe antes de llamarlo', () {
      // El guion corre contra la página que haya cargada, que puede ser una
      // versión vieja o la pantalla de error del WebView.
      final guion = guionMensajeCamara({'tipo': 'cancelada', 'id': 'x'});
      expect(guion, startsWith('if (typeof window.$nombreReceptorCamara'));
    });

    test('el mensaje sobrevive al viaje de ida y vuelta', () {
      const original = <String, Object?>{
        'tipo': 'trozo',
        'id': 'a',
        'indice': 3,
        'datos': 'AAAB/w==',
      };
      final guion = guionMensajeCamara(original);

      final abre = guion.indexOf('(', guion.indexOf('window.$nombreReceptorCamara('));
      final cadena = guion.substring(abre + 1, guion.lastIndexOf(')'));
      expect(jsonDecode(jsonDecode(cadena) as String), original);
    });
  });
}
