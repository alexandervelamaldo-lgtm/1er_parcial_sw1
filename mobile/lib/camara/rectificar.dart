/// Enderezar la foto de verdad: la parte que toca píxeles.
///
/// La geometría está en `geometria.dart` y no sabe nada de imágenes. Aquí se
/// aplica: se decodifica el JPEG, se recorre la imagen de salida píxel a píxel
/// preguntando de dónde sale cada uno, y se vuelve a codificar.
///
/// De `package:image` se usa solo lo de entrar y salir —decodificar, rotar por
/// EXIF, codificar—. El mapa es nuestro por lo que se explica en
/// `geometria.dart`: el que trae el paquete es bilineal y no corrige el
/// escorzo.
///
/// ## Esto no puede correr en el hilo de la interfaz
///
/// Son del orden de dos millones de píxeles y por cada uno hay una división,
/// cuatro lecturas y una escritura, en Dart y sin nada vectorizado. En un
/// teléfono modesto eso es más de un segundo, y un segundo en el hilo de la
/// interfaz es la animación congelada y, si hay mala suerte, el diálogo de
/// «la aplicación no responde».
///
/// Por eso [rectificar] es una función de nivel superior que recibe un único
/// argumento: es exactamente la forma que pide `compute()` para mandarla a otro
/// isolate. Quien la llame desde un widget tiene que hacerlo por ahí. Este
/// fichero no importa Flutter para que esa decisión no se pueda saltar por
/// descuido.
library;

import 'dart:typed_data';

import 'package:image/image.dart' as img;

import 'geometria.dart';

/// El lado mayor de la imagen enderezada. Es el fusible de memoria y de tiempo.
const int ladoMaximoSalida = 1600;

/// El lado mayor de la foto que se enseña en la pantalla de recorte.
///
/// Más grande que la salida a propósito: sobre esta imagen se colocan las
/// esquinas, y encogerla de más haría que cada píxel de error al arrastrar un
/// asa costase dos o tres en el resultado. Más pequeña que la foto original
/// también a propósito: una de 12 Mpx son 48 MB de mapa de bits, y la pantalla
/// de recorte la tiene viva todo el rato que dure el ajuste.
const int ladoMaximoVista = 2200;

/// Calidad del JPEG de salida.
///
/// Ochenta y cinco porque lo que sale de aquí lo lee un modelo de visión, no
/// un humano: lo que importa es que los trazos finos y el texto pequeño no se
/// deshagan en artefactos. Por debajo de 80 las letras de un diagrama empiezan
/// a emborronarse; por encima de 90 el fichero crece sin que el modelo lea
/// mejor, y este fichero viaja por la red y por un canal de JavaScript partido
/// en trozos.
const int calidadJpeg = 85;

/// Decodifica sin lanzar nunca.
///
/// `decodeImage` promete devolver `null` cuando no reconoce el formato, y con
/// unos bytes cualesquiera lo cumple. Con un fichero **vacío** no: revienta con
/// un `RangeError` desde dentro del detector de PNG, que lee la cabecera sin
/// mirar antes cuánto hay. Un JPEG cortado a la mitad —una foto que se guardó
/// mientras se llenaba el almacenamiento, o una transferencia interrumpida—
/// puede caer igual en cualquiera de los decodificadores.
///
/// Por aquí entra lo que devuelva la cámara del sistema, así que esto es una
/// frontera de confianza y no un sitio donde asumir que el proveedor cumple su
/// contrato. Se capturan todas porque lo que hay que decidir es lo mismo en
/// todos los casos —«esta foto no vale, haz otra»— y dejar escapar una
/// excepción desde dentro de un isolate de `compute` la convierte en un fallo
/// del `Future` a bastantes marcos de distancia de aquí, donde ya no se sabe
/// que hablaba de una imagen ilegible.
img.Image? _decodificar(Uint8List bytes) {
  if (bytes.isEmpty) return null;
  try {
    return img.decodeImage(bytes);
  } catch (_) {
    return null;
  }
}

/// Una foto ya decodificada, girada según su EXIF y de un tamaño manejable.
class FotoDerecha {
  const FotoDerecha({
    required this.bytes,
    required this.ancho,
    required this.alto,
  });

  /// El JPEG ya normalizado. **Es el que tiene que enseñar la pantalla de
  /// recorte**, y el motivo está en [enderezarOrientacion].
  final Uint8List bytes;

  final int ancho;
  final int alto;
}

/// Deja la foto derecha y de un tamaño razonable antes de enseñarla.
///
/// ## Por qué la rotación EXIF no se puede dejar para luego
///
/// Casi ningún teléfono gira la foto al guardarla: la escribe como la leyó el
/// sensor y anota aparte «esto va girado 90°». Flutter respeta esa etiqueta al
/// pintar, y `decodeImage` **no** la aplica al decodificar. Si la pantalla de
/// recorte enseñara los bytes originales y el enderezado trabajara sobre la
/// imagen decodificada sin más, las dos estarían mirando imágenes distintas:
/// las esquinas se colocarían sobre una foto vertical y se aplicarían sobre una
/// horizontal. El resultado es un recorte que no tiene nada que ver con lo que
/// se marcó, y es un fallo que no aparece nunca en un emulador de escritorio
/// —donde las imágenes de prueba no llevan EXIF— y aparece siempre en un
/// teléfono sujeto en vertical, que es como se sujetan.
///
/// Se arregla de una vez y en un sitio: se hornea la orientación aquí, se
/// reencodifica, y a partir de ese momento **solo circulan estos bytes**. La
/// etiqueta desaparece porque ya no hace falta, así que nadie puede aplicarla
/// dos veces.
///
/// Devuelve `null` si los bytes no son una imagen que se sepa leer. No lanza:
/// esto se alimenta de lo que devuelva la cámara o el selector de ficheros del
/// sistema, y un fichero roto o un formato raro es un caso normal, no un error
/// de programación.
FotoDerecha? enderezarOrientacion(
  Uint8List bytes, {
  int ladoMaximo = ladoMaximoVista,
  int calidad = 90,
}) {
  final decodificada = _decodificar(bytes);
  if (decodificada == null) return null;

  var derecha = img.bakeOrientation(decodificada);

  final mayor = derecha.width > derecha.height ? derecha.width : derecha.height;
  if (mayor > ladoMaximo) {
    // `copyResize` con un solo lado mantiene la proporción. Se pide el lado que
    // manda para no depender de si la foto es vertical u horizontal.
    derecha = derecha.width >= derecha.height
        ? img.copyResize(derecha, width: ladoMaximo, interpolation: img.Interpolation.average)
        : img.copyResize(derecha, height: ladoMaximo, interpolation: img.Interpolation.average);
  }

  return FotoDerecha(
    bytes: img.encodeJpg(derecha, quality: calidad),
    ancho: derecha.width,
    alto: derecha.height,
  );
}

/// Lo que hace falta para enderezar, en un solo objeto.
///
/// Existe porque `compute()` solo pasa un argumento al isolate, y porque así
/// todo lo que cruza esa frontera está enumerado en un sitio y se ve de un
/// vistazo que no hay nada que no se pueda serializar.
class PeticionDeRectificado {
  const PeticionDeRectificado(
    this.foto, {
    required this.encuadre,
    this.ladoMaximo = ladoMaximoSalida,
    this.calidad = calidadJpeg,
  });

  /// Los bytes que devolvió [enderezarOrientacion], no los de la cámara.
  final Uint8List foto;

  /// Las cuatro esquinas, en coordenadas de píxel de esa misma imagen.
  final Encuadre encuadre;

  final int ladoMaximo;
  final int calidad;
}

/// Endereza la foto y devuelve un JPEG. `null` si no se puede.
///
/// Pensada para `compute(rectificar, peticion)`. Devuelve `null` en vez de
/// lanzar en los tres casos en que puede no salir —bytes ilegibles, encuadre
/// doblado o aplastado, homografía degenerada— porque los tres son cosas que
/// hace quien usa la aplicación, no averías: se le enseña «ajusta las
/// esquinas», no una traza.
Uint8List? rectificar(PeticionDeRectificado peticion) {
  final origen = _decodificar(peticion.foto);
  if (origen == null) return null;

  final enderezada = deformar(
    origen,
    peticion.encuadre,
    ladoMaximo: peticion.ladoMaximo,
  );
  if (enderezada == null) return null;

  return img.encodeJpg(enderezada, quality: peticion.calidad);
}

/// El recorrido píxel a píxel. Separado para poder probarlo sin JPEG de por
/// medio: la codificación tiene pérdidas y taparía cualquier error de un par de
/// niveles de gris.
img.Image? deformar(
  img.Image origen,
  Encuadre encuadre, {
  int ladoMaximo = ladoMaximoSalida,
}) {
  // Cuatro píxeles cuadrados. Por debajo de eso no hay nada que leer y sí una
  // división por un número minúsculo. Que el recorte sea *legible* —y no solo
  // geométricamente posible— lo decide la pantalla, que es quien puede pedir
  // que se agrande.
  if (!encuadreValido(encuadre, areaMinima: 4)) return null;

  final medida = medidaDeSalida(encuadre, ladoMaximo: ladoMaximo);
  final h = homografiaHacia(
    medida.ancho.toDouble(),
    medida.alto.toDouble(),
    encuadre,
  );
  if (h == null) return null;

  // Sin canal alfa: la salida es opaca por construcción y un cuarto canal sería
  // un 33 % más de memoria que el JPEG va a tirar de todas formas.
  final destino = img.Image(
    width: medida.ancho,
    height: medida.alto,
    numChannels: 3,
  );

  // Cuatro «Pixel» reutilizados. `getPixel` con un buffer lo recoloca en vez de
  // construir uno nuevo, y aquí se entra dos millones de veces: dejarlo asignar
  // serían ocho millones de objetos para la basura.
  final p00 = origen.getPixel(0, 0);
  final p10 = origen.getPixel(0, 0);
  final p01 = origen.getPixel(0, 0);
  final p11 = origen.getPixel(0, 0);

  final ultimaX = origen.width - 1;
  final ultimaY = origen.height - 1;

  for (var v = 0; v < medida.alto; v++) {
    // El centro del píxel, no su esquina. Muestrear en la esquina desplaza la
    // imagen entera medio píxel hacia arriba y hacia la izquierda, que es poco
    // pero es un sesgo, y encima hace que enderezar una foto ya recta no sea la
    // identidad.
    final vd = v + 0.5;

    for (var u = 0; u < medida.ancho; u++) {
      final ud = u + 0.5;

      final w = h[6] * ud + h[7] * vd + 1;
      if (w == 0) continue;
      final sx = (h[0] * ud + h[1] * vd + h[2]) / w;
      final sy = (h[3] * ud + h[4] * vd + h[5]) / w;

      // De coordenadas continuas a índices: el centro del píxel (0,0) está en
      // (0,5, 0,5), así que restar medio deja el índice entero por debajo.
      final fx = sx - 0.5;
      final fy = sy - 0.5;
      final x0base = fx.floor();
      final y0base = fy.floor();
      final dx = fx - x0base;
      final dy = fy - y0base;

      // Se sujeta a los bordes en vez de pintar de blanco. El encuadre vive
      // dentro de la foto, así que esto solo actúa en la franja de un píxel del
      // borde; un relleno de color dejaría ahí una línea que el modelo de
      // visión podría tomar por el marco de una clase.
      final x0 = x0base < 0 ? 0 : (x0base > ultimaX ? ultimaX : x0base);
      final y0 = y0base < 0 ? 0 : (y0base > ultimaY ? ultimaY : y0base);
      final x1 = x0base + 1 < 0 ? 0 : (x0base + 1 > ultimaX ? ultimaX : x0base + 1);
      final y1 = y0base + 1 < 0 ? 0 : (y0base + 1 > ultimaY ? ultimaY : y0base + 1);

      origen.getPixel(x0, y0, p00);
      origen.getPixel(x1, y0, p10);
      origen.getPixel(x0, y1, p01);
      origen.getPixel(x1, y1, p11);

      final pesoIzquierdaArriba = (1 - dx) * (1 - dy);
      final pesoDerechaArriba = dx * (1 - dy);
      final pesoIzquierdaAbajo = (1 - dx) * dy;
      final pesoDerechaAbajo = dx * dy;

      destino.setPixelRgb(
        u,
        v,
        p00.r * pesoIzquierdaArriba +
            p10.r * pesoDerechaArriba +
            p01.r * pesoIzquierdaAbajo +
            p11.r * pesoDerechaAbajo,
        p00.g * pesoIzquierdaArriba +
            p10.g * pesoDerechaArriba +
            p01.g * pesoIzquierdaAbajo +
            p11.g * pesoDerechaAbajo,
        p00.b * pesoIzquierdaArriba +
            p10.b * pesoDerechaArriba +
            p01.b * pesoIzquierdaAbajo +
            p11.b * pesoDerechaAbajo,
      );
    }
  }

  return destino;
}
