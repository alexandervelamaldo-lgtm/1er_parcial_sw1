/// La geometría del recorte: ordenar las cuatro esquinas y enderezar la foto.
///
/// Todo lo de este fichero es Dart puro —ni Flutter, ni imágenes, ni cámara— y
/// por eso se prueba entero sin teléfono. Lo que toca píxeles está en
/// `rectificar.dart`, que usa esto y es la parte lenta.
///
/// ## Por qué no vale `copyRectify` del paquete `image`
///
/// Existe, hace casi esto, y está descartada a propósito. Su mapa es una
/// **interpolación bilineal de los cuatro vértices**:
///
/// ```
/// origen = TL·(1-u)(1-v) + TR·u(1-v) + BL·(1-u)v + BR·uv
/// ```
///
/// Eso coloca bien las cuatro esquinas y mal todo lo de en medio. Una foto de
/// una pizarra tomada de lado no está solo torcida: está **escorzada**, y el
/// escorzo no es lineal —el borde lejano se comprime más cuanto más lejos
/// está—. Con el mapa bilineal, el centro de la pizarra cae en el promedio de
/// las cuatro esquinas, que es justo donde *no* está: en una perspectiva de
/// verdad el centro se desplaza hacia el lado lejano. El resultado es una
/// imagen cuyos bordes cuadran y cuyo interior sigue deformado, con las letras
/// del fondo estiradas, que es lo que el modelo de visión tiene que leer.
///
/// Lo correcto es una **homografía**: la transformación proyectiva que lleva
/// los cuatro puntos a los cuatro puntos y que, a diferencia de la bilineal,
/// conserva las rectas y reproduce el escorzo exacto. Son ocho incógnitas y
/// ocho ecuaciones, y está aquí abajo. La prueba que separa las dos cosas es la
/// del punto medio de un trapecio: la bilineal lo pone en el centro
/// geométrico, la homografía lo pone donde de verdad cae.
library;

import 'dart:math' as math;

/// Un punto en píxeles de la imagen, con origen arriba a la izquierda.
class Punto {
  const Punto(this.x, this.y);

  final double x;
  final double y;

  double distanciaA(Punto otro) {
    final dx = x - otro.x;
    final dy = y - otro.y;
    return math.sqrt(dx * dx + dy * dy);
  }

  // `other` y no `otro`: es la firma heredada de `Object`, y el analizador
  // pide que los parámetros de un método sobrescrito se llamen igual que en el
  // original para que quien lo invoque por nombre no se lleve una sorpresa.
  @override
  bool operator ==(Object other) => other is Punto && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(x, y);

  @override
  String toString() => 'Punto(${x.toStringAsFixed(2)}, ${y.toStringAsFixed(2)})';
}

/// Las cuatro esquinas del recorte, ya ordenadas y con nombre.
///
/// Existe como tipo en vez de pasar una lista de cuatro porque el orden es el
/// contrato entero: una lista de cuatro puntos no dice cuál es cuál, y
/// equivocarse produce una imagen del revés o girada 90°, que es un fallo que
/// solo se ve mirando la foto.
class Encuadre {
  const Encuadre({
    required this.arribaIzquierda,
    required this.arribaDerecha,
    required this.abajoDerecha,
    required this.abajoIzquierda,
  });

  final Punto arribaIzquierda;
  final Punto arribaDerecha;
  final Punto abajoDerecha;
  final Punto abajoIzquierda;

  /// En orden circular, empezando arriba a la izquierda y girando con el reloj.
  List<Punto> get enOrden => [
    arribaIzquierda,
    arribaDerecha,
    abajoDerecha,
    abajoIzquierda,
  ];
}

/// Pone cuatro puntos sueltos en orden circular y les da nombre.
///
/// No se hace por mínimos y máximos —«la de menor x es la izquierda»—, que es
/// lo primero que se intenta y falla en cuanto la foto está girada: en un
/// cuadrilátero inclinado 30° hay dos puntos que compiten por ser «el
/// izquierdo» y el reparto sale cruzado, con dos esquinas intercambiadas y la
/// imagen plegada sobre sí misma.
///
/// Se ordenan por el ángulo alrededor del centro, que es robusto para cualquier
/// giro. Como la `y` de una imagen crece hacia abajo, el ángulo creciente
/// recorre el cuadrilátero **en el sentido del reloj**, que es el que se
/// quiere.
///
/// Cuál de los cuatro es «arriba a la izquierda» se decide por la suma `x + y`
/// menor. Para un cuadrilátero girado 45° la pregunta no tiene respuesta buena
/// —ninguna esquina está arriba a la izquierda— y esto elige una cualquiera de
/// forma estable; enderezar una foto girada media vuelta no es el caso de uso,
/// y quien la haga verá el resultado antes de aceptarlo.
Encuadre? ordenarEsquinas(List<Punto> puntos) {
  if (puntos.length != 4) return null;

  final cx = puntos.map((p) => p.x).reduce((a, b) => a + b) / 4;
  final cy = puntos.map((p) => p.y).reduce((a, b) => a + b) / 4;

  final porAngulo = [...puntos]..sort((a, b) {
    final angA = math.atan2(a.y - cy, a.x - cx);
    final angB = math.atan2(b.y - cy, b.x - cx);
    return angA.compareTo(angB);
  });

  var inicio = 0;
  var menor = double.infinity;
  for (var i = 0; i < 4; i++) {
    final suma = porAngulo[i].x + porAngulo[i].y;
    if (suma < menor) {
      menor = suma;
      inicio = i;
    }
  }

  Punto en(int desplazamiento) => porAngulo[(inicio + desplazamiento) % 4];

  return Encuadre(
    arribaIzquierda: en(0),
    arribaDerecha: en(1),
    abajoDerecha: en(2),
    abajoIzquierda: en(3),
  );
}

/// Si el cuadrilátero se puede enderezar, o si está doblado o aplastado.
///
/// Hay dos formas de que las cuatro esquinas no sirvan, y las dos llegan desde
/// la pantalla táctil sin ningún esfuerzo: arrastrar una esquina más allá de la
/// contraria cruza dos lados y hace un lazo, y juntar dos esquinas deja el
/// cuadrilátero sin área. La homografía de cualquiera de los dos casos existe
/// pero no significa nada: sale una imagen plegada o una tira de un píxel.
///
/// Se comprueba antes de enderezar y no después porque después ya no se
/// distingue de una foto mala, y lo que hay que decirle a quien la hizo es
/// «mueve esa esquina», no «no se pudo leer».
bool encuadreValido(Encuadre encuadre, {double areaMinima = 1}) {
  final p = encuadre.enOrden;

  // Convexidad: los cuatro productos cruzados de lados consecutivos tienen que
  // llevar el mismo signo. Si alguno cambia, el recorrido se dobla hacia dentro
  // y hay dos lados que se cruzan.
  var positivos = 0;
  var negativos = 0;
  for (var i = 0; i < 4; i++) {
    final a = p[i];
    final b = p[(i + 1) % 4];
    final c = p[(i + 2) % 4];
    final cruz = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cruz > 0) positivos++;
    if (cruz < 0) negativos++;
  }
  if (positivos != 4 && negativos != 4) return false;

  return areaDe(encuadre) >= areaMinima;
}

/// El área del cuadrilátero, por la fórmula del cordón de zapato.
double areaDe(Encuadre encuadre) {
  final p = encuadre.enOrden;
  var suma = 0.0;
  for (var i = 0; i < 4; i++) {
    final a = p[i];
    final b = p[(i + 1) % 4];
    suma += a.x * b.y - b.x * a.y;
  }
  return suma.abs() / 2;
}

/// Cuánto va a medir la imagen enderezada.
///
/// Se toma el **mayor** de cada par de lados opuestos, no el promedio: el lado
/// que se ve más largo en la foto es el que está más cerca de la cámara, y por
/// tanto el que conserva más detalle real. Promediar tiraría resolución del
/// lado bueno para igualarlo con el lado lejano, que ya viene comprimido.
///
/// Esto da la proporción aparente y no la verdadera. Recuperar la de verdad se
/// puede —de la homografía sale, suponiendo una distancia focal— pero depende
/// de datos de la cámara que no siempre están y falla feo cuando la suposición
/// no se cumple. Para leer un diagrama con un modelo de visión, la aparente
/// sobra: lo que había que quitar era el escorzo, no ajustar el formato al
/// milímetro.
///
/// El `ladoMaximo` es un fusible de memoria. Una foto de 12 Mpx enderezada a su
/// tamaño son unos 48 MB de mapa de bits en RAM, y el recorrido píxel a píxel
/// es Dart puro: en un teléfono modesto eso es la app muerta o medio minuto de
/// pantalla congelada. Para leer un diagrama no hace falta tanto.
({int ancho, int alto}) medidaDeSalida(Encuadre e, {int ladoMaximo = 1600}) {
  final arriba = e.arribaIzquierda.distanciaA(e.arribaDerecha);
  final abajo = e.abajoIzquierda.distanciaA(e.abajoDerecha);
  final izquierda = e.arribaIzquierda.distanciaA(e.abajoIzquierda);
  final derecha = e.arribaDerecha.distanciaA(e.abajoDerecha);

  var ancho = math.max(arriba, abajo);
  var alto = math.max(izquierda, derecha);

  final mayor = math.max(ancho, alto);
  if (mayor > ladoMaximo) {
    final factor = ladoMaximo / mayor;
    ancho *= factor;
    alto *= factor;
  }

  return (ancho: math.max(1, ancho.round()), alto: math.max(1, alto.round()));
}

/// El cuadrilátero con el que se abre la pantalla de recorte.
///
/// Un margen dentro de la foto y no la foto entera. Si empezara en los bordes
/// exactos, las cuatro asas quedarían medio fuera de la pantalla y la primera
/// acción de todo el mundo sería pelearse para agarrar una. Metido un 8 %, las
/// cuatro se ven enteras y se entiende de un vistazo que eso se arrastra.
Encuadre encuadrePorDefecto(int ancho, int alto, {double margen = 0.08}) {
  final dx = ancho * margen;
  final dy = alto * margen;
  return Encuadre(
    arribaIzquierda: Punto(dx, dy),
    arribaDerecha: Punto(ancho - dx, dy),
    abajoDerecha: Punto(ancho - dx, alto - dy),
    abajoIzquierda: Punto(dx, alto - dy),
  );
}

/// La homografía que lleva el rectángulo de salida al cuadrilátero de la foto.
///
/// Se calcula en esa dirección —destino hacia origen— y no al revés porque así
/// es como se muestrea: se recorre la imagen de salida píxel a píxel y para
/// cada uno se pregunta de dónde sale. Al revés quedarían huecos, porque los
/// píxeles del origen no caen en una rejilla entera al proyectarse.
///
/// El modelo es el proyectivo de ocho parámetros:
///
/// ```
/// x = (a·u + b·v + c) / (g·u + h·v + 1)
/// y = (d·u + e·v + f) / (g·u + h·v + 1)
/// ```
///
/// El divisor es lo que la interpolación bilineal no tiene, y es exactamente el
/// escorzo: hace que avanzar un píxel en la salida avance más o menos en el
/// origen según lo lejos que esté esa parte de la escena. Con `g = h = 0` se
/// recupera la transformación afín, que es lo máximo que puede representar un
/// mapa sin divisor.
///
/// Cuatro correspondencias dan ocho ecuaciones lineales en las ocho incógnitas.
///
/// ## Por qué no basta con que el sistema lineal se resuelva
///
/// Era lo que parecía: si tres esquinas del destino quedan en línea recta no
/// hay homografía, luego el sistema tiene que salir singular y con detectar el
/// pivote cero está resuelto. **Es falso**, y la prueba lo enseñó: con las
/// esquinas `(0,0) (50,50) (100,100) (0,100)` la eliminación termina sin un
/// solo pivote pequeño y devuelve `[1, 0, 0, 1, 0, 0, 0,01, −0,01]`, que tiene
/// muy buen aspecto.
///
/// Lo que pasa es que esa matriz aplasta el plano entero sobre la recta
/// `x = y`, y cumple la cuarta correspondencia haciendo que su divisor valga
/// exactamente cero —o sea, mandando esa esquina al infinito—. Formalmente el
/// sistema lineal *sí* tiene solución única; lo que no tiene es sentido
/// geométrico. Quien solo mire el pivote se lleva una matriz degenerada y
/// pinta una imagen que es una raya.
///
/// Lo que sí funciona es mirar el divisor, y está explicado donde se hace, al
/// final de la función. El segundo intento —reproyectar las cuatro esquinas y
/// exigir que cayeran donde se pidió— tampoco valía, por un motivo que merece
/// quedar escrito: esa condición *es* el sistema de ecuaciones, así que se
/// cumple por construcción y no comprueba nada.
///
/// Devuelve `null` en el caso degenerado y en el casi degenerado: mejor un
/// nulo, que la pantalla de recorte sabe traducir a «mueve esa esquina», que
/// una imagen de basura sin aviso.
List<double>? homografiaHacia(double ancho, double alto, Encuadre destino) {
  // Las cuatro esquinas del rectángulo de salida, en el mismo orden.
  final origen = [
    const Punto(0, 0),
    Punto(ancho, 0),
    Punto(ancho, alto),
    Punto(0, alto),
  ];
  final llegada = destino.enOrden;

  // Matriz ampliada 8×9: ocho ecuaciones, ocho incógnitas y el término
  // independiente.
  final m = List.generate(8, (_) => List<double>.filled(9, 0));
  for (var i = 0; i < 4; i++) {
    final u = origen[i].x;
    final v = origen[i].y;
    final x = llegada[i].x;
    final y = llegada[i].y;

    // a·u + b·v + c − g·u·x − h·v·x = x
    m[i * 2] = [u, v, 1, 0, 0, 0, -u * x, -v * x, x];
    // d·u + e·v + f − g·u·y − h·v·y = y
    m[i * 2 + 1] = [0, 0, 0, u, v, 1, -u * y, -v * y, y];
  }

  final h = _resolver(m);
  if (h == null) return null;

  // El divisor tiene que mantenerse lejos de cero en toda la salida.
  //
  // Comprobar las esquinas basta, y no es una aproximación: `w = g·u + h·v + 1`
  // es afín, así que sus extremos sobre un rectángulo están siempre en los
  // vértices. Tampoco sirve reproyectar las cuatro esquinas para ver si vuelven
  // a su sitio —que fue el primer intento—: las ecuaciones del sistema *son*
  // esa condición, así que vuelven por construcción y la prueba no distingue
  // nada.
  //
  // `w` vale exactamente 1 en la esquina de origen, o sea que es el factor de
  // escala relativo: `w = 0,2` significa que ese trozo de la escena se ve cinco
  // veces más comprimido. Que se anule quiere decir que la línea del horizonte
  // atraviesa el recorte, y entonces media imagen sale reflejada y la otra
  // media estirada al infinito. El milésimo es un umbral deliberadamente
  // generoso —admite una compresión de mil a uno, cuando una foto ya es
  // ilegible mucho antes— porque lo que aquí se descarta es lo imposible, no lo
  // feo; de decidir si el recorte es razonable ya se encarga `encuadreValido`.
  const divisorMinimo = 1e-3;
  for (final punto in origen) {
    if (h[6] * punto.x + h[7] * punto.y + 1 < divisorMinimo) return null;
  }

  return h;
}

/// De dónde sale el píxel `(u, v)` de la salida, en coordenadas de la foto.
Punto proyectar(List<double> h, double u, double v) {
  final w = h[6] * u + h[7] * v + 1;
  // Un `w` de cero es un punto que la homografía manda al infinito: existe en
  // cualquier proyectiva, y cae fuera de la foto de todas formas. Se devuelve
  // algo finito para que el muestreo lo descarte por estar fuera, en vez de
  // propagar un NaN que pintaría basura.
  if (w == 0) return const Punto(-1, -1);
  return Punto(
    (h[0] * u + h[1] * v + h[2]) / w,
    (h[3] * u + h[4] * v + h[5]) / w,
  );
}

/// Eliminación de Gauss con pivoteo parcial sobre una matriz ampliada.
///
/// El pivoteo no es un adorno académico. Sin él, la primera ecuación de este
/// sistema empieza por `u = 0` —la esquina de arriba a la izquierda del
/// rectángulo de salida está en el origen— así que el primer pivote es cero
/// exacto y la eliminación divide por él en el primer paso.
List<double>? _resolver(List<List<double>> m) {
  const n = 8;

  for (var col = 0; col < n; col++) {
    var mejor = col;
    for (var fila = col + 1; fila < n; fila++) {
      if (m[fila][col].abs() > m[mejor][col].abs()) mejor = fila;
    }
    if (m[mejor][col].abs() < 1e-10) return null;

    final intercambio = m[col];
    m[col] = m[mejor];
    m[mejor] = intercambio;

    final pivote = m[col][col];
    for (var j = col; j <= n; j++) {
      m[col][j] /= pivote;
    }

    for (var fila = 0; fila < n; fila++) {
      if (fila == col) continue;
      final factor = m[fila][col];
      if (factor == 0) continue;
      for (var j = col; j <= n; j++) {
        m[fila][j] -= factor * m[col][j];
      }
    }
  }

  final solucion = List<double>.filled(n, 0);
  for (var i = 0; i < n; i++) {
    solucion[i] = m[i][n];
    if (!solucion[i].isFinite) return null;
  }
  return solucion;
}
