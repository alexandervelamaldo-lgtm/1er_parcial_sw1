/// Las cuentas de la pantalla de recorte, sin Flutter de por medio.
///
/// La foto se enseña encogida y centrada, y las esquinas se arrastran con el
/// dedo. Eso obliga a ir y venir entre dos sistemas de coordenadas todo el
/// rato: los píxeles de la imagen —que son los que valen, y los únicos que
/// entiende `rectificar.dart`— y los puntos lógicos de la pantalla, que
/// dependen del tamaño de la ventana y del aparato.
///
/// Es un sitio clásico para un fallo que no se ve en el emulador: si la
/// conversión se hace mal por un margen, el recorte sale desplazado en un
/// teléfono con una proporción distinta y correcto en el que se probó. Por eso
/// las cuentas están aquí, en Dart puro, y el widget solo dibuja.
///
/// Las esquinas se guardan siempre **en píxeles de la imagen**. Guardarlas en
/// coordenadas de pantalla sería más cómodo para pintar y estaría mal: al girar
/// el teléfono la caja cambia de tamaño y el recorte se movería solo.
library;

import 'dart:math' as math;

import 'geometria.dart';

/// El lado de la zona sensible de un asa, en puntos lógicos.
///
/// Cuarenta y cuatro, el mismo número que `LADO_TACTIL` en
/// `frontend/src/components/barra-pulgar.ts`, y por el mismo motivo: la yema de
/// un dedo cubre entre ocho y diez milímetros, y por debajo de eso se falla el
/// objetivo. Aquí importa incluso más que en la barra, porque las cuatro asas
/// están sobre la foto y no hay nada que las separe del fondo.
const double ladoDelAsa = 44;

/// Dónde y a qué escala cae la foto dentro de la caja que le toca.
///
/// Es el equivalente de `BoxFit.contain`: se encoge lo justo para que quepa
/// entera y se centra, con bandas a los lados o arriba y abajo según sobre.
class Ajuste {
  const Ajuste({
    required this.escala,
    required this.margenX,
    required this.margenY,
    required this.anchoImagen,
    required this.altoImagen,
  });

  /// Cuántos puntos de pantalla mide un píxel de la imagen.
  final double escala;

  /// La banda que sobra a la izquierda y arriba, en puntos de pantalla.
  final double margenX;
  final double margenY;

  final int anchoImagen;
  final int altoImagen;

  /// De píxel de la imagen a punto de la pantalla.
  Punto aPantalla(Punto imagen) =>
      Punto(margenX + imagen.x * escala, margenY + imagen.y * escala);

  /// De punto de la pantalla a píxel de la imagen.
  Punto aImagen(Punto pantalla) => Punto(
    (pantalla.x - margenX) / escala,
    (pantalla.y - margenY) / escala,
  );
}

/// Calcula cómo encaja una imagen dentro de una caja, sin deformarla.
///
/// Devuelve `null` si la caja o la imagen no tienen tamaño. Pasa de verdad: en
/// el primer fotograma, antes de que se mida el árbol, la caja llega con cero,
/// y dividir ahí da infinitos que se propagan hasta las coordenadas de las asas
/// y las dejan en `NaN` para siempre —porque `NaN` sobrevive a cualquier
/// operación posterior—.
Ajuste? ajustarDentro({
  required int anchoImagen,
  required int altoImagen,
  required double anchoCaja,
  required double altoCaja,
}) {
  if (anchoImagen <= 0 || altoImagen <= 0) return null;
  if (!anchoCaja.isFinite || !altoCaja.isFinite) return null;
  if (anchoCaja <= 0 || altoCaja <= 0) return null;

  final escala = math.min(anchoCaja / anchoImagen, altoCaja / altoImagen);
  return Ajuste(
    escala: escala,
    margenX: (anchoCaja - anchoImagen * escala) / 2,
    margenY: (altoCaja - altoImagen * escala) / 2,
    anchoImagen: anchoImagen,
    altoImagen: altoImagen,
  );
}

/// Qué asa se agarra al tocar en `toque` (en puntos de pantalla).
///
/// Devuelve el índice en el orden de [Encuadre.enOrden] —0 arriba izquierda,
/// 1 arriba derecha, 2 abajo derecha, 3 abajo izquierda— o `null` si el toque
/// no cae cerca de ninguna.
///
/// Se busca la **más cercana** dentro del radio y no la primera que caiga
/// dentro. Con las asas juntas —una pizarra pequeña en una foto grande— los
/// radios se solapan, y quedarse con la primera del orden significa que una de
/// las dos no se puede agarrar nunca por mucho que se afine.
int? asaMasCercana(
  Encuadre encuadre,
  Ajuste ajuste,
  Punto toque, {
  double radio = ladoDelAsa,
}) {
  int? mejor;
  var menor = double.infinity;

  final esquinas = encuadre.enOrden;
  for (var i = 0; i < esquinas.length; i++) {
    final distancia = ajuste.aPantalla(esquinas[i]).distanciaA(toque);
    if (distancia <= radio && distancia < menor) {
      menor = distancia;
      mejor = i;
    }
  }
  return mejor;
}

/// Mueve una esquina, sin dejarla salirse de la foto.
///
/// Se sujeta a los bordes en vez de ignorar el arrastre cuando se sale. Ignorar
/// haría que el asa se despegase del dedo y se quedase atrás, que se siente
/// como que la aplicación se ha colgado; sujetar la deja pegada al borde,
/// deslizándose por él, que es lo que hace cualquier otro recorte.
///
/// Nada impide dejar el cuadrilátero doblado o aplastado: eso se avisa en la
/// pantalla y se comprueba con `encuadreValido` antes de aceptar. Bloquear el
/// arrastre a mitad de camino sería peor, porque para deshacer un cruce muchas
/// veces hay que pasar por una posición inválida.
Encuadre moverEsquina(Encuadre encuadre, int indice, Punto destino, Ajuste ajuste) {
  final sujeto = Punto(
    destino.x.clamp(0, ajuste.anchoImagen.toDouble()).toDouble(),
    destino.y.clamp(0, ajuste.altoImagen.toDouble()).toDouble(),
  );

  final p = encuadre.enOrden;
  final movidas = [
    for (var i = 0; i < 4; i++) i == indice ? sujeto : p[i],
  ];

  return Encuadre(
    arribaIzquierda: movidas[0],
    arribaDerecha: movidas[1],
    abajoDerecha: movidas[2],
    abajoIzquierda: movidas[3],
  );
}

/// Qué decirle a quien está ajustando, o `null` si todo está bien.
///
/// Un solo sitio para los dos avisos, para que la pantalla no tenga que decidir
/// nada y para poder comprobar el texto sin montar la interfaz. Se dice qué
/// hacer —«separa las esquinas»— y no qué pasó, porque lo que pasó ya se ve en
/// la propia foto.
String? avisoDelEncuadre(Encuadre encuadre, {double areaMinima = 4}) {
  if (!encuadreValido(encuadre, areaMinima: areaMinima)) {
    if (areaDe(encuadre) < areaMinima) {
      return 'Separa las esquinas: no queda nada dentro del recorte.';
    }
    return 'Los lados se cruzan. Arrastra las esquinas para deshacer el cruce.';
  }
  return null;
}
