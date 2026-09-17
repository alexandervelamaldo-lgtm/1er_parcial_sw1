/// Las cuentas de la pantalla de recorte, probadas sin montar la pantalla.
///
/// Todo lo de `recorte_en_pantalla.dart` es Dart puro precisamente para esto:
/// los fallos que se buscan aquí —una conversión de coordenadas con el margen
/// cambiado, un asa que no se puede agarrar— son los que en el emulador se ven
/// bien y en otro teléfono no, porque dependen de la proporción de la pantalla.
/// Probarlos con el widget montado significaría depender del tamaño de la
/// ventana de prueba, que es justo la variable que se quiere quitar de en
/// medio.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:uml_movil/camara/geometria.dart';
import 'package:uml_movil/camara/recorte_en_pantalla.dart';

/// Un ajuste uno a uno, para las pruebas donde la escala no es lo que se mira.
///
/// Con escala 1 y márgenes a cero, píxel de la imagen y punto de pantalla
/// coinciden, así que las coordenadas de la prueba se leen directamente.
Ajuste ajusteDirecto(int lado) => ajustarDentro(
  anchoImagen: lado,
  altoImagen: lado,
  anchoCaja: lado.toDouble(),
  altoCaja: lado.toDouble(),
)!;

void main() {
  group('ajustarDentro', () {
    test('una imagen apaisada deja banda arriba y abajo', () {
      final ajuste = ajustarDentro(
        anchoImagen: 1000,
        altoImagen: 500,
        anchoCaja: 300,
        altoCaja: 300,
      )!;

      expect(ajuste.escala, closeTo(0.3, 1e-12));
      expect(ajuste.margenX, closeTo(0, 1e-12));
      expect(ajuste.margenY, closeTo(75, 1e-12));
    });

    test('una imagen vertical deja banda a los lados', () {
      final ajuste = ajustarDentro(
        anchoImagen: 500,
        altoImagen: 1000,
        anchoCaja: 300,
        altoCaja: 300,
      )!;

      expect(ajuste.escala, closeTo(0.3, 1e-12));
      expect(ajuste.margenX, closeTo(75, 1e-12));
      expect(ajuste.margenY, closeTo(0, 1e-12));
    });

    test('la escala es la misma en los dos ejes, o sea que no deforma', () {
      // Se comprueba por las consecuencias y no leyendo el campo: un cuadrado
      // de la imagen tiene que seguir siendo un cuadrado en la pantalla.
      final ajuste = ajustarDentro(
        anchoImagen: 1200,
        altoImagen: 400,
        anchoCaja: 300,
        altoCaja: 600,
      )!;

      final a = ajuste.aPantalla(const Punto(100, 100));
      final b = ajuste.aPantalla(const Punto(200, 200));
      expect(b.x - a.x, closeTo(b.y - a.y, 1e-12));
    });

    test('la imagen cabe entera dentro de la caja', () {
      final ajuste = ajustarDentro(
        anchoImagen: 1333,
        altoImagen: 777,
        anchoCaja: 411,
        altoCaja: 890,
      )!;

      final abajoDerecha = ajuste.aPantalla(const Punto(1333, 777));
      expect(abajoDerecha.x, lessThanOrEqualTo(411 + 1e-9));
      expect(abajoDerecha.y, lessThanOrEqualTo(890 + 1e-9));

      // Y toca uno de los dos bordes: si sobrara por los dos lados es que se
      // encogió de más.
      final tocaAncho = (abajoDerecha.x - 411).abs() < 1e-9;
      final tocaAlto = (abajoDerecha.y - 890).abs() < 1e-9;
      expect(tocaAncho || tocaAlto, isTrue);
    });

    test('queda centrada: las dos bandas del mismo lado miden igual', () {
      final ajuste = ajustarDentro(
        anchoImagen: 800,
        altoImagen: 600,
        anchoCaja: 500,
        altoCaja: 500,
      )!;

      final arribaIzquierda = ajuste.aPantalla(const Punto(0, 0));
      final abajoDerecha = ajuste.aPantalla(const Punto(800, 600));

      expect(arribaIzquierda.x, closeTo(500 - abajoDerecha.x, 1e-9));
      expect(arribaIzquierda.y, closeTo(500 - abajoDerecha.y, 1e-9));
    });

    test('ida y vuelta entre pantalla e imagen devuelve el mismo punto', () {
      for (final ajuste in [
        ajustarDentro(
          anchoImagen: 4000,
          altoImagen: 3000,
          anchoCaja: 411.42857,
          altoCaja: 731.4285,
        )!,
        ajustarDentro(
          anchoImagen: 3000,
          altoImagen: 4000,
          anchoCaja: 411.42857,
          altoCaja: 731.4285,
        )!,
      ]) {
        for (final punto in const [
          Punto(0, 0),
          Punto(1234.5, 987.25),
          Punto(2999, 2999),
        ]) {
          final vuelta = ajuste.aImagen(ajuste.aPantalla(punto));
          expect(vuelta.x, closeTo(punto.x, 1e-9));
          expect(vuelta.y, closeTo(punto.y, 1e-9));
        }
      }
    });

    test('una caja sin tamaño da null en vez de infinitos', () {
      // El caso del primer fotograma, antes de que se mida el árbol. Si esto
      // devolviera un ajuste, la escala sería infinita y las asas quedarían en
      // NaN para el resto de la vida de la pantalla.
      expect(
        ajustarDentro(
          anchoImagen: 100,
          altoImagen: 100,
          anchoCaja: 0,
          altoCaja: 300,
        ),
        isNull,
      );
      expect(
        ajustarDentro(
          anchoImagen: 100,
          altoImagen: 100,
          anchoCaja: 300,
          altoCaja: 0,
        ),
        isNull,
      );
    });

    test('una caja infinita o NaN da null', () {
      // Pasa de verdad: un widget dentro de un scroll sin límite recibe alto
      // infinito en la medida.
      expect(
        ajustarDentro(
          anchoImagen: 100,
          altoImagen: 100,
          anchoCaja: double.infinity,
          altoCaja: 300,
        ),
        isNull,
      );
      expect(
        ajustarDentro(
          anchoImagen: 100,
          altoImagen: 100,
          anchoCaja: 300,
          altoCaja: double.nan,
        ),
        isNull,
      );
    });

    test('una imagen sin tamaño da null', () {
      expect(
        ajustarDentro(
          anchoImagen: 0,
          altoImagen: 100,
          anchoCaja: 300,
          altoCaja: 300,
        ),
        isNull,
      );
      expect(
        ajustarDentro(
          anchoImagen: 100,
          altoImagen: -5,
          anchoCaja: 300,
          altoCaja: 300,
        ),
        isNull,
      );
    });
  });

  group('asaMasCercana', () {
    const encuadre = Encuadre(
      arribaIzquierda: Punto(0, 0),
      arribaDerecha: Punto(100, 0),
      abajoDerecha: Punto(100, 100),
      abajoIzquierda: Punto(0, 100),
    );

    test('cada esquina se agarra con su índice', () {
      final ajuste = ajusteDirecto(100);
      expect(asaMasCercana(encuadre, ajuste, const Punto(2, 2)), 0);
      expect(asaMasCercana(encuadre, ajuste, const Punto(98, 2)), 1);
      expect(asaMasCercana(encuadre, ajuste, const Punto(98, 98)), 2);
      expect(asaMasCercana(encuadre, ajuste, const Punto(2, 98)), 3);
    });

    test('un toque lejos de todas no agarra nada', () {
      final ajuste = ajusteDirecto(200);
      // El centro de un cuadrado de 200 está a 141 de cada esquina.
      const centrado = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(200, 0),
        abajoDerecha: Punto(200, 200),
        abajoIzquierda: Punto(0, 200),
      );
      expect(asaMasCercana(centrado, ajuste, const Punto(100, 100)), isNull);
    });

    test('con dos asas juntas se agarra la más cercana, no la primera', () {
      // Este es el motivo de que la función busque el mínimo en vez de
      // quedarse con la primera que caiga dentro del radio. Con una pizarra
      // estrecha las dos asas de arriba están a 30 puntos, sus radios de 44 se
      // solapan, y quedarse con la primera del orden dejaría la de la derecha
      // imposible de agarrar por mucho que se afine el dedo.
      const estrecho = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(30, 0),
        abajoDerecha: Punto(30, 200),
        abajoIzquierda: Punto(0, 200),
      );
      final ajuste = ajusteDirecto(200);

      expect(asaMasCercana(estrecho, ajuste, const Punto(20, 0)), 1);
      expect(asaMasCercana(estrecho, ajuste, const Punto(10, 0)), 0);
      // Justo en medio gana la primera, porque el desempate es estricto. Da
      // igual cuál salga; lo que importa es que no se quede en null.
      expect(asaMasCercana(estrecho, ajuste, const Punto(15, 0)), isNotNull);
    });

    test('el radio se mide en la pantalla y no en píxeles de la imagen', () {
      // Una foto de 1000 metida en una caja de 100: cada punto de pantalla son
      // diez píxeles. Un toque a 40 puntos del asa la agarra, aunque en la
      // imagen esté a 400 píxeles. Si el radio se comparase contra la
      // distancia en píxeles, en una foto grande no se podría agarrar nada y
      // en una pequeña se agarraría todo.
      final ajuste = ajustarDentro(
        anchoImagen: 1000,
        altoImagen: 1000,
        anchoCaja: 100,
        altoCaja: 100,
      )!;
      const grande = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(1000, 0),
        abajoDerecha: Punto(1000, 1000),
        abajoIzquierda: Punto(0, 1000),
      );

      expect(asaMasCercana(grande, ajuste, const Punto(40, 0)), 0);
      expect(asaMasCercana(grande, ajuste, const Punto(46, 0)), isNull);
    });

    test('el borde del radio entra y un pelo más allá no', () {
      final ajuste = ajusteDirecto(400);
      const lejos = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(400, 0),
        abajoDerecha: Punto(400, 400),
        abajoIzquierda: Punto(0, 400),
      );

      expect(asaMasCercana(lejos, ajuste, const Punto(44, 0)), 0);
      expect(asaMasCercana(lejos, ajuste, const Punto(44.001, 0)), isNull);
    });

    test('se puede pedir un radio distinto del de la yema', () {
      final ajuste = ajusteDirecto(400);
      const lejos = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(400, 0),
        abajoDerecha: Punto(400, 400),
        abajoIzquierda: Punto(0, 400),
      );

      expect(
        asaMasCercana(lejos, ajuste, const Punto(60, 0), radio: 80),
        0,
      );
      expect(
        asaMasCercana(lejos, ajuste, const Punto(60, 0), radio: 10),
        isNull,
      );
    });

    test('el asa mide lo mismo que el objetivo táctil de la web', () {
      // El mismo número que LADO_TACTIL en barra-pulgar.ts. Si uno de los dos
      // cambia, el otro tiene que cambiar con él.
      expect(ladoDelAsa, 44);
    });
  });

  group('moverEsquina', () {
    const encuadre = Encuadre(
      arribaIzquierda: Punto(10, 10),
      arribaDerecha: Punto(90, 10),
      abajoDerecha: Punto(90, 90),
      abajoIzquierda: Punto(10, 90),
    );

    test('la esquina va donde se la lleva', () {
      final movido = moverEsquina(
        encuadre,
        1,
        const Punto(70, 25),
        ajusteDirecto(100),
      );
      expect(movido.arribaDerecha, const Punto(70, 25));
    });

    test('las otras tres no se mueven', () {
      final movido = moverEsquina(
        encuadre,
        2,
        const Punto(55, 44),
        ajusteDirecto(100),
      );
      expect(movido.arribaIzquierda, encuadre.arribaIzquierda);
      expect(movido.arribaDerecha, encuadre.arribaDerecha);
      expect(movido.abajoIzquierda, encuadre.abajoIzquierda);
      expect(movido.abajoDerecha, const Punto(55, 44));
    });

    test('un arrastre fuera de la foto se sujeta al borde', () {
      // Sujetar y no ignorar. Ignorando, el asa se despegaría del dedo y se
      // quedaría atrás, que se siente como que la app se ha colgado.
      final movido = moverEsquina(
        encuadre,
        0,
        const Punto(-500, 300),
        ajusteDirecto(100),
      );
      expect(movido.arribaIzquierda, const Punto(0, 100));
    });

    test('sujetar deja el asa deslizándose por el borde', () {
      // Lo que hace que se sienta bien: al salirse por la izquierda, la
      // coordenada que sigue dentro continúa siguiendo al dedo.
      final ajuste = ajusteDirecto(100);
      final a = moverEsquina(encuadre, 3, const Punto(-40, 20), ajuste);
      final b = moverEsquina(encuadre, 3, const Punto(-40, 60), ajuste);

      expect(a.abajoIzquierda.x, 0);
      expect(b.abajoIzquierda.x, 0);
      expect(a.abajoIzquierda.y, 20);
      expect(b.abajoIzquierda.y, 60);
    });

    test('respeta que la imagen no sea cuadrada', () {
      final ajuste = ajustarDentro(
        anchoImagen: 400,
        altoImagen: 100,
        anchoCaja: 400,
        altoCaja: 100,
      )!;
      final movido = moverEsquina(encuadre, 2, const Punto(9999, 9999), ajuste);
      expect(movido.abajoDerecha, const Punto(400, 100));
    });

    test('deja llegar a una posición inválida a propósito', () {
      // Bloquear el arrastre a mitad de camino sería peor: para deshacer un
      // cruce muchas veces hay que pasar por una posición que no vale. Se
      // avisa en la pantalla y se comprueba al aceptar, no aquí.
      final cruzado = moverEsquina(
        encuadre,
        0,
        const Punto(95, 95),
        ajusteDirecto(100),
      );
      expect(cruzado.arribaIzquierda, const Punto(95, 95));
      expect(encuadreValido(cruzado, areaMinima: 4), isFalse);
    });
  });

  group('avisoDelEncuadre', () {
    test('un recorte normal no dice nada', () {
      const bueno = Encuadre(
        arribaIzquierda: Punto(10, 10),
        arribaDerecha: Punto(90, 12),
        abajoDerecha: Punto(88, 90),
        abajoIzquierda: Punto(12, 88),
      );
      expect(avisoDelEncuadre(bueno), isNull);
    });

    test('un recorte aplastado pide separar las esquinas', () {
      const aplastado = Encuadre(
        arribaIzquierda: Punto(50, 50),
        arribaDerecha: Punto(52, 50),
        abajoDerecha: Punto(52, 51),
        abajoIzquierda: Punto(50, 51),
      );
      expect(avisoDelEncuadre(aplastado), contains('Separa las esquinas'));
    });

    test('cuatro esquinas en el mismo sitio también piden separarlas', () {
      const colapsado = Encuadre(
        arribaIzquierda: Punto(40, 40),
        arribaDerecha: Punto(40, 40),
        abajoDerecha: Punto(40, 40),
        abajoIzquierda: Punto(40, 40),
      );
      expect(avisoDelEncuadre(colapsado), contains('Separa las esquinas'));
    });

    test('un lazo pide deshacer el cruce', () {
      // Con área de sobra —mil— para que no se confunda con el caso aplastado:
      // aquí lo que está mal es el orden, no el tamaño.
      const lazo = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(100, 0),
        abajoDerecha: Punto(10, 100),
        abajoIzquierda: Punto(90, 100),
      );
      expect(areaDe(lazo), greaterThan(4));
      expect(avisoDelEncuadre(lazo), contains('se cruzan'));
    });

    test('los dos avisos dicen qué hacer y no qué pasó', () {
      // Lo que pasó ya se ve en la propia foto; lo que no se ve es el gesto
      // que lo arregla. Además no tutean por descuido en una sola forma: las
      // dos frases usan la misma persona que el resto de la aplicación.
      const lazo = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(100, 0),
        abajoDerecha: Punto(10, 100),
        abajoIzquierda: Punto(90, 100),
      );
      const aplastado = Encuadre(
        arribaIzquierda: Punto(50, 50),
        arribaDerecha: Punto(52, 50),
        abajoDerecha: Punto(52, 51),
        abajoIzquierda: Punto(50, 51),
      );

      expect(avisoDelEncuadre(lazo), contains('Arrastra'));
      expect(avisoDelEncuadre(aplastado), contains('Separa'));
    });

    test('el área mínima se puede subir y entonces sí avisa', () {
      const pequeno = Encuadre(
        arribaIzquierda: Punto(0, 0),
        arribaDerecha: Punto(10, 0),
        abajoDerecha: Punto(10, 10),
        abajoIzquierda: Punto(0, 10),
      );
      expect(avisoDelEncuadre(pequeno), isNull);
      expect(
        avisoDelEncuadre(pequeno, areaMinima: 500),
        contains('Separa las esquinas'),
      );
    });
  });

  group('el recorte de arranque llega entero a la pantalla', () {
    test('las cuatro asas del encuadre por defecto se pueden agarrar', () {
      // La razón de ser del margen del 8 %: que ninguna asa nazca pegada al
      // borde de la caja, donde medio círculo quedaría fuera de la pantalla.
      const anchoImagen = 4000;
      const altoImagen = 3000;
      const anchoCaja = 360.0;
      const altoCaja = 640.0;

      final ajuste = ajustarDentro(
        anchoImagen: anchoImagen,
        altoImagen: altoImagen,
        anchoCaja: anchoCaja,
        altoCaja: altoCaja,
      )!;
      final encuadre = encuadrePorDefecto(anchoImagen, altoImagen);

      for (final esquina in encuadre.enOrden) {
        final enPantalla = ajuste.aPantalla(esquina);
        expect(enPantalla.x, greaterThanOrEqualTo(ladoDelAsa / 2));
        expect(enPantalla.y, greaterThanOrEqualTo(0));
        expect(enPantalla.x, lessThanOrEqualTo(anchoCaja - ladoDelAsa / 2));
        expect(enPantalla.y, lessThanOrEqualTo(altoCaja));
      }
    });

    test('el encuadre por defecto no trae ningún aviso', () {
      expect(avisoDelEncuadre(encuadrePorDefecto(4000, 3000)), isNull);
    });

    test('tocar cada asa de arranque devuelve su propio índice', () {
      final ajuste = ajustarDentro(
        anchoImagen: 4000,
        altoImagen: 3000,
        anchoCaja: 360,
        altoCaja: 640,
      )!;
      final encuadre = encuadrePorDefecto(4000, 3000);
      final esquinas = encuadre.enOrden;

      for (var i = 0; i < 4; i++) {
        final toque = ajuste.aPantalla(esquinas[i]);
        expect(asaMasCercana(encuadre, ajuste, toque), i);
      }
    });
  });

  group('un arrastre completo, del toque al recorte', () {
    test('agarrar, mover y soltar deja la esquina bajo el dedo', () {
      // La secuencia entera tal y como la hará el widget, para que quede
      // probado que las tres funciones encajan: el toque llega en puntos de
      // pantalla, se agarra un asa, se convierte a píxeles de la imagen y se
      // mueve. El fallo que esto atrapa es el de convertir en el sitio
      // equivocado, que da un recorte desplazado justo por el margen.
      const anchoImagen = 1200;
      const altoImagen = 900;
      final ajuste = ajustarDentro(
        anchoImagen: anchoImagen,
        altoImagen: altoImagen,
        anchoCaja: 300,
        altoCaja: 500,
      )!;
      var encuadre = encuadrePorDefecto(anchoImagen, altoImagen);

      final agarre = ajuste.aPantalla(encuadre.arribaIzquierda);
      final indice = asaMasCercana(encuadre, ajuste, agarre);
      expect(indice, 0);

      const destinoEnPantalla = Punto(120, 190);
      encuadre = moverEsquina(
        encuadre,
        indice!,
        ajuste.aImagen(destinoEnPantalla),
        ajuste,
      );

      final dondeQuedo = ajuste.aPantalla(encuadre.arribaIzquierda);
      expect(dondeQuedo.x, closeTo(destinoEnPantalla.x, 1e-9));
      expect(dondeQuedo.y, closeTo(destinoEnPantalla.y, 1e-9));
    });

    test('el recorte no se mueve al girar el teléfono', () {
      // El motivo de guardar las esquinas en píxeles de la imagen. Se ajusta
      // un recorte en vertical, se gira, y tiene que seguir tapando lo mismo
      // de la foto: las coordenadas de pantalla cambian, las de la imagen no.
      const anchoImagen = 1200;
      const altoImagen = 900;
      final vertical = ajustarDentro(
        anchoImagen: anchoImagen,
        altoImagen: altoImagen,
        anchoCaja: 360,
        altoCaja: 640,
      )!;
      final apaisado = ajustarDentro(
        anchoImagen: anchoImagen,
        altoImagen: altoImagen,
        anchoCaja: 640,
        altoCaja: 360,
      )!;

      final encuadre = moverEsquina(
        encuadrePorDefecto(anchoImagen, altoImagen),
        1,
        vertical.aImagen(const Punto(300, 260)),
        vertical,
      );

      // La misma esquina se dibuja en dos sitios distintos de la pantalla...
      final enVertical = vertical.aPantalla(encuadre.arribaDerecha);
      final enApaisado = apaisado.aPantalla(encuadre.arribaDerecha);
      expect(enApaisado.x, isNot(closeTo(enVertical.x, 1)));

      // ...y sigue señalando el mismo píxel de la foto, que es lo que se
      // recortará.
      expect(
        vertical.aImagen(enVertical).x,
        closeTo(apaisado.aImagen(enApaisado).x, 1e-9),
      );
      expect(
        vertical.aImagen(enVertical).y,
        closeTo(apaisado.aImagen(enApaisado).y, 1e-9),
      );
    });
  });
}
