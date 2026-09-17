import 'dart:math' as math;

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/camara/geometria.dart';

/// La geometría del recorte, comprobada sin teléfono y sin una sola imagen.
///
/// Esto es la parte del enderezado que se puede equivocar en silencio. Un mapa
/// mal calculado no lanza: devuelve una foto. Sale una imagen con las cuatro
/// esquinas donde tocan y el interior estirado, y nadie lo mira con una regla
/// —se mira si «se ve bien»—, así que el fallo viaja hasta el modelo de visión
/// y allí se manifiesta como un diagrama mal leído, que es donde ya no se puede
/// atribuir a nada.
///
/// De ahí que la prueba central de este fichero no sea que las esquinas cuadren
/// —eso lo cumple también la interpolación bilineal que se descartó— sino
/// **dónde cae el centro**. Es el único punto que separa una homografía de
/// verdad de un mapa que solo aparenta serlo.
void main() {
  /// El trapecio de referencia: una pizarra fotografiada de frente pero desde
  /// abajo, con el borde de arriba lejos y comprimido.
  ///
  /// El borde superior mide 20 y el inferior 100. La proporción 5:1 es más
  /// bruta que ninguna foto real, y está elegida así a propósito: exagera el
  /// escorzo hasta que la diferencia entre los dos mapas se mide en decenas de
  /// píxeles en vez de en unidades, y una prueba que falla por 33 píxeles no se
  /// confunde nunca con ruido de coma flotante.
  const trapecio = Encuadre(
    arribaIzquierda: Punto(40, 0),
    arribaDerecha: Punto(60, 0),
    abajoDerecha: Punto(100, 100),
    abajoIzquierda: Punto(0, 100),
  );

  group('la homografía reproduce el escorzo, no solo coloca las esquinas', () {
    test('el centro de la salida no cae en el promedio de las cuatro esquinas', () {
      final h = homografiaHacia(100, 100, trapecio);
      expect(h, isNotNull);

      final centro = proyectar(h!, 50, 50);

      // Donde lo pondría `copyRectify`: la media aritmética de los vértices.
      // Es el valor equivocado, y se escribe aquí para que la prueba diga qué
      // está descartando y no solo qué está afirmando.
      const bilineal = Punto(50, 50);

      // Donde cae de verdad. La recta de fuga de este trapecio está en
      // y = −25 (es donde el ancho se haría cero), el borde lejano está a 25 de
      // ella y el cercano a 125; el punto medio del plano se proyecta a la
      // media armónica de esas dos distancias, 41,67, o sea y = 16,67.
      expect(centro.x, closeTo(50, 1e-9));
      expect(centro.y, closeTo(50 / 3, 1e-9));

      expect(
        (centro.y - bilineal.y).abs(),
        greaterThan(30),
        reason: 'si el centro sale en 50 es que el mapa volvió a ser bilineal',
      );
    });

    test('la diagonal de la salida sigue siendo recta en la foto', () {
      // La otra cara de lo mismo, y la propiedad que de verdad importa para
      // leer un diagrama: una homografía lleva rectas a rectas. La bilineal
      // conserva las paralelas a los ejes —por eso los bordes engañan— y
      // arquea todo lo demás, que es donde viven las líneas de las relaciones.
      final h = homografiaHacia(100, 100, trapecio)!;

      final a = proyectar(h, 0, 0);
      final b = proyectar(h, 100, 100);

      for (final t in [0.25, 0.5, 0.75]) {
        final medio = proyectar(h, 100 * t, 100 * t);
        // Área del triángulo que forman los tres puntos: cero si son colineales.
        final cruz =
            (b.x - a.x) * (medio.y - a.y) - (b.y - a.y) * (medio.x - a.x);
        expect(cruz.abs(), lessThan(1e-6), reason: 'la diagonal se arqueó en t=$t');
      }
    });

    test('las cuatro esquinas caen exactamente donde se pidió', () {
      final h = homografiaHacia(100, 100, trapecio)!;

      final esperadas = trapecio.enOrden;
      final obtenidas = [
        proyectar(h, 0, 0),
        proyectar(h, 100, 0),
        proyectar(h, 100, 100),
        proyectar(h, 0, 100),
      ];

      for (var i = 0; i < 4; i++) {
        expect(obtenidas[i].x, closeTo(esperadas[i].x, 1e-9));
        expect(obtenidas[i].y, closeTo(esperadas[i].y, 1e-9));
      }
    });

    test('un rectángulo hacia sí mismo da la identidad', () {
      // El caso que se da cuando alguien fotografía de frente y no mueve las
      // asas. Si esto no saliera exacto, enderezar una foto ya recta la movería
      // medio píxel y la volvería borrosa al muestrear.
      final h = homografiaHacia(
        200,
        100,
        const Encuadre(
          arribaIzquierda: Punto(0, 0),
          arribaDerecha: Punto(200, 0),
          abajoDerecha: Punto(200, 100),
          abajoIzquierda: Punto(0, 100),
        ),
      );
      expect(h, isNotNull);

      for (final punto in [
        const Punto(0, 0),
        const Punto(137, 42),
        const Punto(200, 100),
      ]) {
        final ida = proyectar(h!, punto.x, punto.y);
        expect(ida.x, closeTo(punto.x, 1e-9));
        expect(ida.y, closeTo(punto.y, 1e-9));
      }
    });

    test('devuelve nulo si tres esquinas quedan en línea recta', () {
      // Se llega arrastrando una esquina hasta el lado de enfrente.
      //
      // Esta prueba tumbó la primera versión, y por eso está escrita con el
      // caso exacto. Parecía que un destino degenerado haría singular el
      // sistema lineal y bastaría con vigilar el pivote. No: la eliminación
      // termina limpiamente y devuelve [1, 0, 0, 1, 0, 0, 0,01, −0,01], una
      // matriz que aplasta el plano sobre la recta x = y y cumple la cuarta
      // esquina mandándola al infinito. Con solo mirar el pivote, esto pasaba
      // y el recorte salía convertido en una raya.
      final h = homografiaHacia(
        100,
        100,
        const Encuadre(
          arribaIzquierda: Punto(0, 0),
          arribaDerecha: Punto(50, 50),
          abajoDerecha: Punto(100, 100),
          abajoIzquierda: Punto(0, 100),
        ),
      );
      expect(h, isNull);
    });

    test('devuelve nulo si tres esquinas quedan casi en línea recta', () {
      // El caso peor, porque no salta ningún cero: sale una matriz finita con
      // un divisor minúsculo, y la esquina de abajo a la izquierda aterriza a
      // miles de píxeles de donde se pidió. Una imagen así no está «un poco
      // mal», está irreconocible, y conviene que se rechace igual que la
      // degenerada en vez de quedar en tierra de nadie.
      final h = homografiaHacia(
        100,
        100,
        const Encuadre(
          arribaIzquierda: Punto(0, 0),
          arribaDerecha: Punto(50, 49.999),
          abajoDerecha: Punto(100, 100),
          abajoIzquierda: Punto(0, 100),
        ),
      );
      expect(h, isNull);
    });

    test('un punto que la homografía manda al infinito sale fuera, no NaN', () {
      // Divisor cero en u = 10. No pasa con encuadres razonables, pero el
      // muestreo recorre la salida entera y un NaN en la coordenada se
      // convierte en un píxel leído de cualquier sitio.
      final h = <double>[1, 0, 0, 0, 1, 0, -0.1, 0];
      final fuera = proyectar(h, 10, 0);

      expect(fuera.x, -1);
      expect(fuera.y, -1);
      expect(fuera.x.isFinite, isTrue);
    });
  });

  group('ordenar las esquinas aguanta el giro', () {
    test('cuatro puntos desordenados recuperan su nombre', () {
      final orden = ordenarEsquinas([
        const Punto(100, 100), // abajo derecha
        const Punto(0, 0), // arriba izquierda
        const Punto(0, 100), // abajo izquierda
        const Punto(100, 0), // arriba derecha
      ]);

      expect(orden, isNotNull);
      expect(orden!.arribaIzquierda, const Punto(0, 0));
      expect(orden.arribaDerecha, const Punto(100, 0));
      expect(orden.abajoDerecha, const Punto(100, 100));
      expect(orden.abajoIzquierda, const Punto(0, 100));
    });

    test('un cuadrado girado 30° no se reparte cruzado', () {
      // El caso que rompe el reparto por mínimos y máximos. En este cuadrado la
      // esquina de menor `x` es la de abajo a la izquierda, no la de arriba a
      // la izquierda: quien decida «la de menor x es la izquierda» intercambia
      // dos vértices y pliega la imagen.
      const centro = Punto(200, 200);
      const radio = 70.710678118654755; // 50·√2
      final girados = <Punto>[];
      for (var i = 0; i < 4; i++) {
        // Las cuatro esquinas de un cuadrado están a 90° una de otra; 45° las
        // pone en las diagonales y los 30° son el giro que se comprueba.
        final angulo = (45 + 30 + 90 * i) * math.pi / 180;
        girados.add(
          Punto(
            centro.x + radio * math.cos(angulo),
            centro.y + radio * math.sin(angulo),
          ),
        );
      }

      // Se barajan para que el resultado no dependa del orden de entrada.
      final orden = ordenarEsquinas([girados[2], girados[0], girados[3], girados[1]]);
      expect(orden, isNotNull);

      // El giro es de 30°, así que la esquina que era «arriba a la izquierda»
      // sigue siéndolo: la que menos suma `x + y` tiene.
      final menorSuma = girados.reduce((a, b) => a.x + a.y <= b.x + b.y ? a : b);
      expect(orden!.arribaIzquierda.x, closeTo(menorSuma.x, 1e-9));
      expect(orden.arribaIzquierda.y, closeTo(menorSuma.y, 1e-9));

      // Y el recorrido sigue siendo circular: el resultado es convexo y con
      // área, que es lo que se rompería si hubiera dos vértices cruzados.
      expect(encuadreValido(orden), isTrue);
      expect(areaDe(orden), closeTo(10000, 1e-6));

      // La comprobación explícita de que el criterio por ejes habría fallado.
      final menorX = girados.reduce((a, b) => a.x <= b.x ? a : b);
      expect(
        menorX.x,
        isNot(closeTo(orden.arribaIzquierda.x, 1e-9)),
        reason: 'si coinciden, este cuadrado ya no distingue los dos criterios',
      );
    });

    test('rechaza una lista que no tenga cuatro puntos', () {
      expect(ordenarEsquinas([const Punto(0, 0)]), isNull);
      expect(
        ordenarEsquinas([
          const Punto(0, 0),
          const Punto(1, 0),
          const Punto(1, 1),
          const Punto(0, 1),
          const Punto(2, 2),
        ]),
        isNull,
      );
    });
  });

  group('la validez del encuadre se decide antes de enderezar', () {
    test('un cuadrilátero normal vale', () {
      expect(encuadreValido(trapecio), isTrue);
    });

    test('un lazo no vale', () {
      // Se hace arrastrando la esquina de abajo a la derecha por encima de la
      // de abajo a la izquierda. Los lados se cruzan y la homografía existe,
      // pero pinta la mitad de la imagen del revés.
      const lazo = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(100, 0),
        abajoDerecha: Punto(0, 100),
        abajoIzquierda: Punto(100, 100),
      );
      expect(encuadreValido(lazo), isFalse);
    });

    test('un cuadrilátero aplastado no vale', () {
      const aplastado = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(100, 0),
        abajoDerecha: Punto(100, 0),
        abajoIzquierda: Punto(0, 0),
      );
      expect(encuadreValido(aplastado), isFalse);
      expect(areaDe(aplastado), closeTo(0, 1e-9));
    });

    test('el área mínima se puede subir para exigir algo que se pueda leer', () {
      const minusculo = Encuadre(
        arribaIzquierda: Punto(10, 10),
        arribaDerecha: Punto(14, 10),
        abajoDerecha: Punto(14, 14),
        abajoIzquierda: Punto(10, 14),
      );
      expect(encuadreValido(minusculo), isTrue);
      expect(encuadreValido(minusculo, areaMinima: 1000), isFalse);
    });

    test('el área no depende de dónde esté el cuadrilátero', () {
      expect(areaDe(trapecio), closeTo(6000, 1e-9));
    });
  });

  group('la medida de salida', () {
    test('toma el lado mayor de cada par, no el promedio', () {
      // El borde de abajo mide 100 y el de arriba 20. Promediar daría 60 y
      // tiraría a la basura la mitad del detalle del borde que está cerca de
      // la cámara, que es el único que lo tiene de verdad.
      final medida = medidaDeSalida(trapecio);
      expect(medida.ancho, 100);
      // Los dos lados inclinados miden √(40² + 100²) ≈ 107,7.
      expect(medida.alto, 108);
    });

    test('el lado mayor se topa con el fusible de memoria', () {
      const enorme = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(4000, 0),
        abajoDerecha: Punto(4000, 3000),
        abajoIzquierda: Punto(0, 3000),
      );

      final medida = medidaDeSalida(enorme);
      expect(medida.ancho, 1600);
      expect(medida.alto, 1200);

      // Y la proporción se conserva al recortar: si no, la imagen saldría
      // estirada justo en las fotos grandes, que son todas las de un teléfono.
      expect(medida.ancho / medida.alto, closeTo(4000 / 3000, 1e-3));
    });

    test('el fusible se puede bajar y nunca devuelve cero', () {
      const enorme = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(4000, 0),
        abajoDerecha: Punto(4000, 3000),
        abajoIzquierda: Punto(0, 3000),
      );
      expect(medidaDeSalida(enorme, ladoMaximo: 800).ancho, 800);

      // Un cuadrilátero por debajo de un píxel redondearía a cero, y una imagen
      // de ancho cero es una excepción al reservar el mapa de bits.
      const casiNada = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(0.2, 0),
        abajoDerecha: Punto(0.2, 0.2),
        abajoIzquierda: Punto(0, 0.2),
      );
      final medida = medidaDeSalida(casiNada);
      expect(medida.ancho, greaterThanOrEqualTo(1));
      expect(medida.alto, greaterThanOrEqualTo(1));
    });

    test('una foto por debajo del tope se queda como está', () {
      const modesta = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(300, 0),
        abajoDerecha: Punto(300, 200),
        abajoIzquierda: Punto(0, 200),
      );
      final medida = medidaDeSalida(modesta);
      expect(medida.ancho, 300);
      expect(medida.alto, 200);
    });
  });

  group('el encuadre de partida', () {
    test('deja un margen para que las cuatro asas se vean enteras', () {
      final inicial = encuadrePorDefecto(1000, 800);

      expect(inicial.arribaIzquierda, const Punto(80, 64));
      expect(inicial.arribaDerecha, const Punto(920, 64));
      expect(inicial.abajoDerecha, const Punto(920, 736));
      expect(inicial.abajoIzquierda, const Punto(80, 736));
    });

    test('el de partida siempre es válido y enderezable', () {
      for (final medida in [
        (1000, 800),
        (800, 1000),
        (4032, 3024),
        (100, 100),
      ]) {
        final inicial = encuadrePorDefecto(medida.$1, medida.$2);
        expect(encuadreValido(inicial), isTrue);

        final salida = medidaDeSalida(inicial);
        expect(
          homografiaHacia(salida.ancho.toDouble(), salida.alto.toDouble(), inicial),
          isNotNull,
          reason: 'el encuadre inicial de ${medida.$1}×${medida.$2} no se resuelve',
        );
      }
    });
  });

  group('la distancia entre puntos', () {
    test('es la euclídea', () {
      expect(const Punto(0, 0).distanciaA(const Punto(3, 4)), closeTo(5, 1e-12));
      expect(const Punto(7, 7).distanciaA(const Punto(7, 7)), 0);
    });
  });
}
