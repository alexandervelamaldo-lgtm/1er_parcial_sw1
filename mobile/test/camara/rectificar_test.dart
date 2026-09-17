import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:uml_movil/camara/geometria.dart';
import 'package:uml_movil/camara/rectificar.dart';

/// El enderezado, comprobado sobre fotos sintéticas.
///
/// No hay ninguna imagen de prueba en el repositorio y es a propósito: una foto
/// real no se puede afirmar nada sobre ella: se mira y se dice «se ve bien».
/// Aquí las fotos se **fabrican** proyectando un patrón conocido a través de
/// una homografía conocida, y entonces sí hay una respuesta exacta contra la
/// que comparar.
///
/// La prueba que sostiene todo el capítulo es la de las franjas: seis bandas
/// iguales de una pizarra, fotografiadas de lado, vuelven a salir iguales. Eso
/// es la definición operativa de «corrige el escorzo», y es justo lo que la
/// interpolación bilineal de `copyRectify` no haría.
void main() {
  /// Una imagen de colores planos por cuadrantes, para ver de un vistazo si la
  /// salida sale girada o del revés.
  img.Image porCuadrantes(int ancho, int alto) {
    final imagen = img.Image(width: ancho, height: alto, numChannels: 3);
    for (var y = 0; y < alto; y++) {
      for (var x = 0; x < ancho; x++) {
        final derecha = x >= ancho / 2;
        final abajo = y >= alto / 2;
        if (!derecha && !abajo) {
          imagen.setPixelRgb(x, y, 220, 20, 20); // arriba izquierda: rojo
        } else if (derecha && !abajo) {
          imagen.setPixelRgb(x, y, 20, 200, 20); // arriba derecha: verde
        } else if (derecha && abajo) {
          imagen.setPixelRgb(x, y, 20, 20, 220); // abajo derecha: azul
        } else {
          imagen.setPixelRgb(x, y, 230, 220, 20); // abajo izquierda: amarillo
        }
      }
    }
    return imagen;
  }

  /// Fabrica la foto: proyecta un patrón de `anchoPatron`×`altoPatron` sobre el
  /// cuadrilátero `encuadre` de una imagen de `ancho`×`alto`.
  ///
  /// Se recorre el patrón con submuestreo en vez de recorrer la foto, porque
  /// para recorrer la foto haría falta la homografía inversa, que es
  /// precisamente lo que se está probando; usarla aquí haría que la prueba se
  /// comprobara contra sí misma. Con ocho submuestras por lado sobran de sobra
  /// para que no queden huecos: son sesenta y cuatro escrituras por píxel del
  /// patrón, y el cuadrilátero es más pequeño que eso.
  img.Image fotografiar({
    required int ancho,
    required int alto,
    required Encuadre encuadre,
    required int anchoPatron,
    required int altoPatron,
    required (int, int, int) Function(double u, double v) color,
    int submuestreo = 8,
  }) {
    final foto = img.Image(width: ancho, height: alto, numChannels: 3);
    // Fondo gris medio: si quedara algún hueco sin pintar se vería, y si el
    // enderezado muestreara fuera del cuadrilátero saldría gris y no negro,
    // que se confundiría con una franja oscura del patrón.
    img.fill(foto, color: img.ColorRgb8(128, 128, 128));

    final h = homografiaHacia(
      anchoPatron.toDouble(),
      altoPatron.toDouble(),
      encuadre,
    );
    expect(h, isNotNull, reason: 'el encuadre de la foto sintética no vale');

    final pasos = submuestreo;
    for (var j = 0; j < altoPatron * pasos; j++) {
      final v = (j + 0.5) / pasos;
      for (var i = 0; i < anchoPatron * pasos; i++) {
        final u = (i + 0.5) / pasos;
        final punto = proyectar(h!, u, v);
        final x = punto.x.floor();
        final y = punto.y.floor();
        if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
        final (r, g, b) = color(u, v);
        foto.setPixelRgb(x, y, r, g, b);
      }
    }
    return foto;
  }

  /// Las filas donde la columna `x` cambia de claro a oscuro o al revés.
  List<double> transiciones(img.Image imagen, int x) {
    final cortes = <double>[];
    var anterior = imagen.getPixel(x, 0).r > 127;
    for (var y = 1; y < imagen.height; y++) {
      final claro = imagen.getPixel(x, y).r > 127;
      if (claro != anterior) {
        cortes.add(y - 0.5);
        anterior = claro;
      }
    }
    return cortes;
  }

  group('el enderezado devuelve la geometría de la pizarra', () {
    // Un trapecio de verdad: la pizarra está fotografiada desde abajo, así que
    // el borde de arriba está lejos y se ve tres veces más corto que el de
    // abajo. Las seis bandas horizontales de la pizarra son iguales entre sí.
    const pizarra = Encuadre(
      arribaIzquierda: Punto(140, 40),
      arribaDerecha: Punto(260, 40),
      abajoDerecha: Punto(380, 340),
      abajoIzquierda: Punto(20, 340),
    );
    const bandas = 6;
    const ladoPatron = 300;

    test('la foto sintética está de verdad escorzada', () {
      // Sin esto, la prueba siguiente podría estar pasando porque el montaje no
      // deforma nada. Aquí se mide el escorzo del material de partida: las seis
      // bandas iguales de la pizarra ocupan en la foto alturas muy distintas.
      final h = homografiaHacia(
        ladoPatron.toDouble(),
        ladoPatron.toDouble(),
        pizarra,
      )!;

      final alturas = <double>[];
      for (var k = 0; k < bandas; k++) {
        final arriba = proyectar(h, ladoPatron / 2, ladoPatron * k / bandas);
        final abajo = proyectar(h, ladoPatron / 2, ladoPatron * (k + 1) / bandas);
        alturas.add(abajo.y - arriba.y);
      }

      expect(
        alturas.last / alturas.first,
        greaterThan(1.5),
        reason: 'la banda cercana tiene que verse bastante más alta que la lejana',
      );
    });

    test('seis bandas iguales vuelven a salir iguales', () {
      final foto = fotografiar(
        ancho: 400,
        alto: 400,
        encuadre: pizarra,
        anchoPatron: ladoPatron,
        altoPatron: ladoPatron,
        color: (u, v) {
          final banda = (v * bandas / ladoPatron).floor();
          return banda.isEven ? (25, 25, 25) : (240, 240, 240);
        },
      );

      final enderezada = deformar(foto, pizarra);
      expect(enderezada, isNotNull);

      final cortes = transiciones(enderezada!, enderezada.width ~/ 2);
      expect(
        cortes.length,
        bandas - 1,
        reason: 'se esperaban cinco fronteras entre seis bandas, salieron $cortes',
      );

      final alto = enderezada.height;
      for (var k = 0; k < cortes.length; k++) {
        final esperada = alto * (k + 1) / bandas;
        expect(
          cortes[k],
          closeTo(esperada, 3),
          reason: 'la frontera ${k + 1} salió en ${cortes[k]} y tocaba en $esperada',
        );
      }
    });

    test('las fronteras no salen donde las pondría un mapa bilineal', () {
      // La comprobación explícita de que la prueba anterior discrimina. Un mapa
      // bilineal reparte la altura del trapecio linealmente, así que dejaría
      // las fronteras donde estaban en la foto: comprimidas arriba. La
      // diferencia con el reparto correcto es de decenas de píxeles, muy por
      // encima de la tolerancia de tres.
      final h = homografiaHacia(
        ladoPatron.toDouble(),
        ladoPatron.toDouble(),
        pizarra,
      )!;
      final medida = medidaDeSalida(pizarra);

      // Dónde caería la primera frontera si el reparto fuera proporcional a la
      // altura aparente en la foto, que es lo que hace el mapa bilineal.
      final arriba = proyectar(h, ladoPatron / 2, 0);
      final abajo = proyectar(h, ladoPatron / 2, ladoPatron.toDouble());
      final primera = proyectar(h, ladoPatron / 2, ladoPatron / bandas);
      final bilineal =
          medida.alto * (primera.y - arriba.y) / (abajo.y - arriba.y);
      final correcta = medida.alto / bandas;

      expect((bilineal - correcta).abs(), greaterThan(10));
    });
  });

  group('el recorte no se gira ni se refleja', () {
    test('la foto entera se devuelve tal cual', () {
      final original = porCuadrantes(40, 30);
      final entera = encuadreDeImagen(40, 30);

      final salida = deformar(original, entera);
      expect(salida, isNotNull);
      expect(salida!.width, 40);
      expect(salida.height, 30);

      for (var y = 0; y < 30; y++) {
        for (var x = 0; x < 40; x++) {
          final esperado = original.getPixel(x, y);
          final obtenido = salida.getPixel(x, y);
          expect(obtenido.r, closeTo(esperado.r, 1), reason: 'rojo en ($x, $y)');
          expect(obtenido.g, closeTo(esperado.g, 1), reason: 'verde en ($x, $y)');
          expect(obtenido.b, closeTo(esperado.b, 1), reason: 'azul en ($x, $y)');
        }
      }
    });

    test('los cuatro cuadrantes conservan su sitio', () {
      // El fallo que esto atrapa es el de intercambiar dos esquinas del
      // encuadre. Da una imagen perfectamente nítida y del revés, y como el
      // patrón de una pizarra es más o menos simétrico, en una foto real no se
      // nota hasta que alguien intenta leer el texto.
      final salida = deformar(porCuadrantes(80, 60), encuadreDeImagen(80, 60))!;

      ({num r, num g, num b}) muestra(int x, int y) {
        final p = salida.getPixel(x, y);
        return (r: p.r, g: p.g, b: p.b);
      }

      expect(muestra(20, 15).r, greaterThan(150)); // rojo arriba izquierda
      expect(muestra(20, 15).b, lessThan(100));
      expect(muestra(60, 15).g, greaterThan(150)); // verde arriba derecha
      expect(muestra(60, 45).b, greaterThan(150)); // azul abajo derecha
      expect(muestra(20, 45).r, greaterThan(150)); // amarillo abajo izquierda
      expect(muestra(20, 45).g, greaterThan(150));
      expect(muestra(20, 45).b, lessThan(100));
    });

    test('recortar la mitad derecha devuelve la mitad derecha', () {
      final original = porCuadrantes(80, 60);
      final mitad = deformar(
        original,
        const Encuadre(
          arribaIzquierda: Punto(40, 0),
          arribaDerecha: Punto(80, 0),
          abajoDerecha: Punto(80, 60),
          abajoIzquierda: Punto(40, 60),
        ),
      );

      expect(mitad, isNotNull);
      expect(mitad!.width, 40);
      expect(mitad.height, 60);
      expect(mitad.getPixel(20, 15).g, greaterThan(150)); // verde arriba
      expect(mitad.getPixel(20, 45).b, greaterThan(150)); // azul abajo
    });
  });

  group('lo que no se puede enderezar se rechaza sin lanzar', () {
    test('un encuadre doblado', () {
      final salida = deformar(
        porCuadrantes(40, 30),
        const Encuadre(
          arribaIzquierda: Punto(0, 0),
          arribaDerecha: Punto(40, 0),
          abajoDerecha: Punto(0, 30),
          abajoIzquierda: Punto(40, 30),
        ),
      );
      expect(salida, isNull);
    });

    test('un encuadre sin área', () {
      final salida = deformar(
        porCuadrantes(40, 30),
        const Encuadre(
          arribaIzquierda: Punto(10, 10),
          arribaDerecha: Punto(11, 10),
          abajoDerecha: Punto(11, 11),
          abajoIzquierda: Punto(10, 11),
        ),
      );
      expect(salida, isNull);
    });

    test('unos bytes que no son una imagen', () {
      final basura = Uint8List.fromList(List<int>.generate(200, (i) => i % 256));
      expect(enderezarOrientacion(basura), isNull);
      expect(
        rectificar(
          PeticionDeRectificado(basura, encuadre: encuadreDeImagen(10, 10)),
        ),
        isNull,
      );
    });

    test('un fichero vacío', () {
      expect(enderezarOrientacion(Uint8List(0)), isNull);
    });
  });

  group('el fusible de tamaño', () {
    test('la salida no pasa del lado máximo aunque el encuadre sea enorme', () {
      // El encuadre se sale de la foto a propósito: lo que se mide aquí es que
      // el tamaño de salida lo manda el tope y no la aritmética de las
      // esquinas, que es de donde vendría el mapa de bits de cien megas.
      final salida = deformar(
        porCuadrantes(40, 30),
        const Encuadre(
          arribaIzquierda: Punto(0, 0),
          arribaDerecha: Punto(5000, 0),
          abajoDerecha: Punto(5000, 4000),
          abajoIzquierda: Punto(0, 4000),
        ),
        ladoMaximo: 40,
      );

      expect(salida, isNotNull);
      expect(salida!.width, 40);
      expect(salida.height, 32);
    });
  });

  group('la orientación se hornea una sola vez', () {
    test('una foto marcada como girada sale ya girada', () {
      // El caso del teléfono en vertical: el sensor guarda 40×30 y anota
      // «gírala 90°». Si esto no se aplicara aquí, la pantalla de recorte
      // enseñaría 30×40 —Flutter sí lee la etiqueta— y el enderezado
      // trabajaría sobre 40×30. Las esquinas se colocarían sobre una imagen y
      // se aplicarían sobre otra.
      final tumbada = porCuadrantes(40, 30);
      tumbada.exif.imageIfd.orientation = 6;
      final conEtiqueta = Uint8List.fromList(img.encodeJpg(tumbada));

      final derecha = enderezarOrientacion(conEtiqueta);
      expect(derecha, isNotNull);
      expect(derecha!.ancho, 30);
      expect(derecha.alto, 40);

      // Y la etiqueta ya no está, que es lo que impide que alguien la vuelva a
      // aplicar más adelante y deje la foto tumbada del otro lado.
      final reLeida = img.decodeImage(derecha.bytes)!;
      final quedaOrientacion = reLeida.exif.imageIfd.hasOrientation
          ? reLeida.exif.imageIfd.orientation
          : 1;
      expect(quedaOrientacion, anyOf(isNull, 1));
    });

    test('una foto sin etiqueta se queda como está', () {
      final plana = Uint8List.fromList(img.encodeJpg(porCuadrantes(40, 30)));
      final derecha = enderezarOrientacion(plana);

      expect(derecha, isNotNull);
      expect(derecha!.ancho, 40);
      expect(derecha.alto, 30);
    });

    test('una foto grande se encoge conservando la proporción', () {
      final grande = porCuadrantes(1200, 900);
      final bytes = Uint8List.fromList(img.encodeJpg(grande));

      final derecha = enderezarOrientacion(bytes, ladoMaximo: 600);
      expect(derecha, isNotNull);
      expect(derecha!.ancho, 600);
      expect(derecha.alto, 450);
    });

    test('una foto vertical se encoge por el lado que manda', () {
      final vertical = porCuadrantes(600, 1200);
      final bytes = Uint8List.fromList(img.encodeJpg(vertical));

      final derecha = enderezarOrientacion(bytes, ladoMaximo: 600);
      expect(derecha, isNotNull);
      expect(derecha!.ancho, 300);
      expect(derecha.alto, 600);
    });

    test('una foto pequeña no se agranda', () {
      final pequena = Uint8List.fromList(img.encodeJpg(porCuadrantes(80, 60)));
      final derecha = enderezarOrientacion(pequena, ladoMaximo: 600);

      expect(derecha!.ancho, 80);
      expect(derecha.alto, 60);
    });
  });

  group('el camino entero, de bytes a bytes', () {
    test('devuelve un JPEG que se puede volver a leer', () {
      final entrada = Uint8List.fromList(img.encodeJpg(porCuadrantes(120, 90)));

      final salida = rectificar(
        PeticionDeRectificado(
          entrada,
          encuadre: const Encuadre(
            arribaIzquierda: Punto(10, 8),
            arribaDerecha: Punto(110, 6),
            abajoDerecha: Punto(112, 84),
            abajoIzquierda: Punto(8, 82),
          ),
        ),
      );

      expect(salida, isNotNull);
      final releida = img.decodeImage(salida!);
      expect(releida, isNotNull);
      expect(releida!.width, greaterThan(90));
      expect(releida.height, greaterThan(60));

      // El cuadrante de arriba a la izquierda sigue siendo rojo después de
      // pasar por el JPEG, que es lo único que hay que comprobar del formato:
      // que no se codificó en escala de grises ni con los canales cambiados.
      final esquina = releida.getPixel(releida.width ~/ 8, releida.height ~/ 8);
      expect(esquina.r, greaterThan(150));
      expect(esquina.b, lessThan(110));
    });
  });
}

/// El encuadre que cubre una imagen entera. Solo para las pruebas: en la
/// aplicación el de partida lleva margen, y es `encuadrePorDefecto`.
Encuadre encuadreDeImagen(int ancho, int alto) => Encuadre(
  arribaIzquierda: const Punto(0, 0),
  arribaDerecha: Punto(ancho.toDouble(), 0),
  abajoDerecha: Punto(ancho.toDouble(), alto.toDouble()),
  abajoIzquierda: Punto(0, alto.toDouble()),
);
