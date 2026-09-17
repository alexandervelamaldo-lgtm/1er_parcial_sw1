import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/descarga_nativa.dart';

/// El puente de descargas, comprobado sin teléfono y sin tocar el disco.
///
/// Lo que se vigila aquí no es que el fichero aparezca en «Descargas»: eso lo
/// decide Android y no hay forma de comprobarlo en un test de Dart. Lo que se
/// vigila es el tramo donde se puede romper en silencio:
///
/// 1. **El reensamblado.** Los bytes llegan partidos porque enteros no caben en
///    una transacción Binder. Un trozo repetido, uno fuera de sitio o uno que
///    falta dan todos el mismo síntoma —un ZIP que no abre— y ninguno lanza.
/// 2. **El nombre.** Se concatena a un directorio y se abre. Una barra dentro
///    escribe en otro sitio.
/// 3. **Las formas malas del mensaje.** El canal está expuesto a cualquier
///    JavaScript de la página; una excepción dentro del callback del canal deja
///    las descargas muertas sin que aparezca nada por ningún lado.
void main() {
  /// Recoge lo que el puente contesta a la página, y con qué lo llamaron.
  ///
  /// Devuelve el propio puente ya desviado: en las pruebas no hay
  /// `WebViewController` al que hablarle, y montar uno de mentira obligaría a
  /// un canal de plataforma que aquí no existe.
  ({
    PuenteDescarga puente,
    List<Map<String, Object?>> respuestas,
    List<({String nombre, String mime, List<int> bytes})> guardados,
  })
  montar({Future<String> Function(String, String, List<int>)? guardar}) {
    final respuestas = <Map<String, Object?>>[];
    final guardados = <({String nombre, String mime, List<int> bytes})>[];

    final puente = PuenteDescarga(
      guardar:
          guardar ??
          (nombre, mime, bytes) async {
            guardados.add((nombre: nombre, mime: mime, bytes: bytes));
            return '/documentos/$nombre';
          },
    )..responderA(respuestas.add);

    return (puente: puente, respuestas: respuestas, guardados: guardados);
  }

  /// Manda un fichero por el canal, tal y como lo hace `descarga.ts`.
  Future<void> enviar(
    PuenteDescarga puente,
    String id,
    String nombre,
    String mime,
    List<int> bytes, {
    int porTrozo = 4,
  }) async {
    final base64 = base64Encode(bytes);
    final trozos = <String>[];
    for (var i = 0; i < base64.length; i += porTrozo) {
      trozos.add(
        base64.substring(i, i + porTrozo > base64.length ? base64.length : i + porTrozo),
      );
    }
    if (trozos.isEmpty) trozos.add('');

    await puente.recibir(
      jsonEncode({
        'tipo': 'inicio',
        'id': id,
        'nombre': nombre,
        'mime': mime,
        'trozos': trozos.length,
      }),
    );
    for (var i = 0; i < trozos.length; i++) {
      await puente.recibir(
        jsonEncode({'tipo': 'trozo', 'id': id, 'indice': i, 'datos': trozos[i]}),
      );
    }
  }

  group('nombreAceptable', () {
    test('acepta lo que manda la web, tildes incluidas', () {
      expect(nombreAceptable('Tienda de Álex.xmi'), isTrue);
      expect(nombreAceptable('Punto-de_venta.zip'), isTrue);
    });

    test('rechaza lo que se saldría del directorio', () {
      // Este es el motivo de que aquí se rechace en vez de limpiar: el nombre
      // se concatena a una ruta y se abre.
      expect(nombreAceptable('../otro.zip'), isFalse);
      expect(nombreAceptable('sub/dir.zip'), isFalse);
      expect(nombreAceptable(r'sub\dir.zip'), isFalse);
      expect(nombreAceptable('..'), isFalse);
    });

    test('rechaza el nombre oculto, el vacío y el interminable', () {
      expect(nombreAceptable('.oculto'), isFalse);
      expect(nombreAceptable(''), isFalse);
      expect(nombreAceptable('x' * 200), isFalse);
    });

    test('rechaza los caracteres de control', () {
      expect(nombreAceptable('con\nsalto.zip'), isFalse);
      expect(nombreAceptable('con\u{0000}nulo.zip'), isFalse);
    });
  });

  group('DescargaEnCurso', () {
    test('no está completa hasta tener todos los trozos', () {
      final d = DescargaEnCurso(nombre: 'a.zip', mime: 'application/zip', total: 3);
      expect(d.colocar(0, 'AA'), isTrue);
      expect(d.completa, isFalse);
      expect(d.colocar(2, 'CC'), isTrue);
      expect(d.completa, isFalse);
      expect(d.colocar(1, 'BB'), isTrue);
      expect(d.completa, isTrue);
    });

    test('coloca por índice, así que el orden de llegada da igual', () {
      final bytes = List<int>.generate(90, (i) => i * 3 % 256);
      final base64 = base64Encode(bytes);
      final mitad = base64.length ~/ 2;

      final d = DescargaEnCurso(nombre: 'a.zip', mime: 'application/zip', total: 2);
      // Al revés a propósito: el canal entrega en orden hoy, pero eso es una
      // propiedad de la implementación y no del contrato. Dos trozos
      // intercambiados no darían ningún error, solo un fichero corrupto.
      d.colocar(1, base64.substring(mitad));
      d.colocar(0, base64.substring(0, mitad));
      expect(d.bytes(), equals(bytes));
    });

    test('rechaza el repetido y el que no cabe', () {
      final d = DescargaEnCurso(nombre: 'a.zip', mime: 'application/zip', total: 2);
      expect(d.colocar(0, 'AA'), isTrue);
      expect(d.colocar(0, 'AA'), isFalse);
      expect(d.colocar(5, 'AA'), isFalse);
      expect(d.colocar(-1, 'AA'), isFalse);
    });

    test('pedir los bytes a medias es un error de programación, no un fichero corto', () {
      final d = DescargaEnCurso(nombre: 'a.zip', mime: 'application/zip', total: 2);
      d.colocar(0, 'AA');
      expect(d.bytes, throwsStateError);
    });
  });

  group('el puente entero', () {
    test('los bytes llegan enteros y se contesta dónde quedaron', () async {
      final m = montar();
      final bytes = List<int>.generate(1000, (i) => (i * 7) % 256);
      await enviar(m.puente, 'd1', 'proyecto.zip', 'application/zip', bytes, porTrozo: 16);

      expect(m.guardados, hasLength(1));
      expect(m.guardados.single.bytes, equals(bytes));
      expect(m.guardados.single.nombre, 'proyecto.zip');
      expect(m.guardados.single.mime, 'application/zip');
      expect(m.respuestas, [
        {'tipo': 'listo', 'id': 'd1', 'donde': '/documentos/proyecto.zip'},
      ]);
    });

    test('un fichero vacío también se guarda', () async {
      // El caso de un diagrama sin nada. Si el trozo vacío no se contase, la
      // página se quedaría esperando una respuesta que no llega nunca.
      final m = montar();
      await enviar(m.puente, 'd1', 'vacio.xmi', 'application/xml', const []);
      expect(m.guardados.single.bytes, isEmpty);
      expect(m.respuestas.single['tipo'], 'listo');
    });

    test('dos descargas a la vez no se mezclan', () async {
      final m = montar();
      final unoBytes = utf8.encode('uno');
      final dosBytes = utf8.encode('dos');
      final uno = base64Encode(unoBytes);
      final dos = base64Encode(dosBytes);

      for (final id in ['a', 'b']) {
        await m.puente.recibir(
          jsonEncode({
            'tipo': 'inicio',
            'id': id,
            'nombre': '$id.xmi',
            'mime': 'application/xml',
            'trozos': 1,
          }),
        );
      }
      // Entrelazadas, que es lo que pasa si alguien exporta el XMI mientras el
      // ZIP todavía viaja.
      await m.puente.recibir(
        jsonEncode({'tipo': 'trozo', 'id': 'b', 'indice': 0, 'datos': dos}),
      );
      await m.puente.recibir(
        jsonEncode({'tipo': 'trozo', 'id': 'a', 'indice': 0, 'datos': uno}),
      );

      expect(m.guardados.map((g) => g.nombre), ['b.xmi', 'a.xmi']);
      expect(m.guardados[0].bytes, equals(dosBytes));
      expect(m.guardados[1].bytes, equals(unoBytes));
    });

    test('un nombre que se saldría del directorio se rechaza y no se escribe nada', () async {
      final m = montar();
      await enviar(m.puente, 'd1', '../fuera.zip', 'application/zip', [1, 2, 3]);
      expect(m.guardados, isEmpty);
      expect(m.respuestas.single['tipo'], 'error');
      expect(m.respuestas.single['motivo'], contains('nombre'));
    });

    test('un trozo repetido se denuncia en vez de producir un fichero corrupto', () async {
      final m = montar();
      await m.puente.recibir(
        jsonEncode({
          'tipo': 'inicio',
          'id': 'd1',
          'nombre': 'a.zip',
          'mime': 'application/zip',
          'trozos': 2,
        }),
      );
      await m.puente.recibir(
        jsonEncode({'tipo': 'trozo', 'id': 'd1', 'indice': 0, 'datos': 'AAAA'}),
      );
      await m.puente.recibir(
        jsonEncode({'tipo': 'trozo', 'id': 'd1', 'indice': 0, 'datos': 'BBBB'}),
      );

      expect(m.guardados, isEmpty);
      expect(m.respuestas.single['tipo'], 'error');
    });

    test('base64 corrupto se distingue del fallo de disco', () async {
      // Las dos salidas son distintas: una es reintentar y la otra hacer sitio
      // en el teléfono. Un mensaje único mandaría a la mitad de la gente a
      // borrar fotos por nada.
      final m = montar();
      await m.puente.recibir(
        jsonEncode({
          'tipo': 'inicio',
          'id': 'd1',
          'nombre': 'a.zip',
          'mime': 'application/zip',
          'trozos': 1,
        }),
      );
      await m.puente.recibir(
        jsonEncode({'tipo': 'trozo', 'id': 'd1', 'indice': 0, 'datos': 'no es base64!!'}),
      );

      expect(m.guardados, isEmpty);
      expect(m.respuestas.single['motivo'], contains('corruptos'));
    });

    test('el fallo al escribir llega traducido', () async {
      final m = montar(
        guardar: (_, _, _) async => throw const FileSystemException(
          'no space left',
          '/documentos/a.zip',
          OSError('No space left on device', 28),
        ),
      );
      await enviar(m.puente, 'd1', 'a.zip', 'application/zip', [1, 2, 3]);
      expect(m.respuestas.single['tipo'], 'error');
      expect(m.respuestas.single['motivo'], 'No queda espacio en el teléfono.');
    });

    test('un mensaje ilegible no tumba el canal', () async {
      final m = montar();
      // Ninguno de estos debe lanzar: una excepción aquí dentro deja el canal
      // muerto y la página no se entera.
      await m.puente.recibir('{esto no es json');
      await m.puente.recibir('null');
      await m.puente.recibir('[]');
      await m.puente.recibir(jsonEncode({'tipo': 'inicio'}));
      await m.puente.recibir(jsonEncode({'tipo': 'trozo', 'id': 'huerfano', 'indice': 0}));
      expect(m.respuestas, isEmpty);

      // Y después de todo eso sigue funcionando.
      await enviar(m.puente, 'd1', 'a.xmi', 'application/xml', utf8.encode('<xmi/>'));
      expect(m.respuestas.single['tipo'], 'listo');
    });

    test('un inicio con cuentas imposibles se rechaza', () async {
      final m = montar();
      await m.puente.recibir(
        jsonEncode({
          'tipo': 'inicio',
          'id': 'd1',
          'nombre': 'a.zip',
          'mime': 'application/zip',
          'trozos': 0,
        }),
      );
      expect(m.respuestas.single['tipo'], 'error');
    });
  });

  group('motivoDeFalloAlGuardar', () {
    test('traduce los errno que tienen salida distinta', () {
      expect(
        motivoDeFalloAlGuardar(
          const FileSystemException('x', '/a', OSError('full', 28)),
        ),
        contains('espacio'),
      );
      expect(
        motivoDeFalloAlGuardar(
          const FileSystemException('x', '/a', OSError('denied', 13)),
        ),
        contains('permiso'),
      );
    });

    test('lo desconocido se enseña en vez de tragarse', () {
      // Un mensaje genérico convierte un fallo diagnosticable en un misterio, y
      // el que lee es quien está intentando sacar su proyecto del teléfono.
      final mensaje = motivoDeFalloAlGuardar(StateError('algo muy raro'));
      expect(mensaje, contains('algo muy raro'));
    });
  });

  group('guionRespuestaDescarga', () {
    test('la ruta viaja como dato, no como código', () {
      // Una ruta con una comilla dentro rompería el literal si se interpolara
      // en crudo, y lo que se colaría sería JavaScript en la página.
      final guion = guionRespuestaDescarga({
        'tipo': 'listo',
        'id': 'd1',
        'donde': '/a/"; alert(1); //',
      });
      // La ruta aparece en el guion, claro: lo que no aparece es **sin
      // escapar**. Interpolada en crudo, esa comilla cerraría el literal y lo
      // que sigue sería JavaScript de la página. Codificada, la comilla lleva
      // su contrabarra delante y todo el trozo es texto.
      expect(guion, isNot(contains('/a/"; alert(1); //')));
      expect(guion, contains(r'/a/\\\"; alert(1); //'));
      expect(guion, contains('typeof window.__descargaNativa === "function"'));
    });
  });
}
