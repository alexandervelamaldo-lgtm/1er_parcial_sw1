/// La pantalla de recorte, montada de verdad y arrastrada con el dedo.
///
/// Lo que se prueba aquí es el cableado, no las cuentas: que el toque llegue a
/// la esquina correcta, que lo que sale por el `Navigator` sea lo que se
/// enderezó, y que los dos casos en que hay que decir algo —encuadre imposible
/// y enderezado fallido— lo digan en vez de dejar la pantalla muda. La
/// geometría y la conversión de coordenadas ya están probadas sin teléfono en
/// `geometria_test.dart` y `recorte_en_pantalla_test.dart`.
///
/// El enderezado se sustituye por una función de mentira. Con el de verdad,
/// cada prueba de esta pantalla tardaría un segundo recorriendo píxeles y
/// estaría midiendo `rectificar.dart`, que tiene sus propias diecisiete
/// pruebas.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:uml_movil/camara/geometria.dart';
import 'package:uml_movil/camara/pantalla_recorte.dart';
import 'package:uml_movil/camara/recorte_en_pantalla.dart';
import 'package:uml_movil/camara/rectificar.dart';

const int anchoFoto = 400;
const int altoFoto = 300;

/// Un JPEG de verdad, para que `Image.memory` tenga algo que decodificar.
final Uint8List bytesDeLaFoto = Uint8List.fromList(
  img.encodeJpg(img.Image(width: anchoFoto, height: altoFoto)),
);

final FotoDerecha foto = FotoDerecha(
  bytes: bytesDeLaFoto,
  ancho: anchoFoto,
  alto: altoFoto,
);

/// Lo que el enderezado de mentira devolvió y con qué se le llamó.
class Espia {
  PeticionDeRectificado? peticion;
  int llamadas = 0;

  Rectificador queDevuelve(Uint8List? resultado) {
    return (p) async {
      peticion = p;
      llamadas++;
      return resultado;
    };
  }

  Rectificador queLanza() {
    return (p) async {
      peticion = p;
      llamadas++;
      throw StateError('sin memoria');
    };
  }
}

final Uint8List jpegEnderezado = Uint8List.fromList([1, 2, 3, 4, 5]);

/// Monta la pantalla y recoge lo que devuelva al cerrarse.
///
/// Se abre empujada sobre otra pantalla, y no como `home`, porque lo que se
/// quiere comprobar es justo lo que sale por el `pop`.
Future<List<Uint8List?>> montar(
  WidgetTester tester, {
  required Rectificador rectificador,
}) async {
  final devueltos = <Uint8List?>[];

  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Center(
          child: ElevatedButton(
            onPressed: () async {
              final resultado = await Navigator.of(context).push<Uint8List>(
                MaterialPageRoute<Uint8List>(
                  builder: (_) => PantallaRecorte(
                    foto: foto,
                    rectificador: rectificador,
                  ),
                ),
              );
              devueltos.add(resultado);
            },
            child: const Text('abrir'),
          ),
        ),
      ),
    ),
  );

  await tester.tap(find.text('abrir'));
  await tester.pumpAndSettle();
  return devueltos;
}

/// El ajuste que la pantalla está usando ahora mismo, deducido de su tamaño.
Ajuste ajusteEnPantalla(WidgetTester tester) {
  final zona = tester.getRect(find.byKey(claveZonaDeRecorte));
  return ajustarDentro(
    anchoImagen: anchoFoto,
    altoImagen: altoFoto,
    anchoCaja: zona.width,
    altoCaja: zona.height,
  )!;
}

/// Dónde hay que tocar la pantalla para agarrar la esquina `indice`.
Offset dondeEsta(WidgetTester tester, Encuadre encuadre, int indice) {
  final zona = tester.getRect(find.byKey(claveZonaDeRecorte));
  final enPantalla = ajusteEnPantalla(tester).aPantalla(encuadre.enOrden[indice]);
  return zona.topLeft + Offset(enPantalla.x, enPantalla.y);
}

void main() {
  final porDefecto = encuadrePorDefecto(anchoFoto, altoFoto);

  setUp(() {
    // Un tamaño fijo y con proporción de teléfono, en vez del 800×600 del
    // entorno de pruebas. No es cosmético: la conversión de coordenadas
    // depende de los márgenes, así que conviene que la prueba corra sobre una
    // caja donde de verdad haya banda —aquí sobra por arriba y por abajo— y no
    // sobre una donde los márgenes valgan cero y un error de margen pase
    // desapercibido.
    final vista = TestWidgetsFlutterBinding.instance.platformDispatcher.views.first;
    vista.physicalSize = const Size(400, 800);
    vista.devicePixelRatio = 1;
  });

  tearDown(() {
    final vista = TestWidgetsFlutterBinding.instance.platformDispatcher.views.first;
    vista.resetPhysicalSize();
    vista.resetDevicePixelRatio();
  });

  group('al abrirse', () {
    testWidgets('propone un recorte válido y deja aceptarlo', (tester) async {
      await montar(tester, rectificador: Espia().queDevuelve(jpegEnderezado));

      expect(find.text('Usar la foto'), findsOneWidget);
      expect(find.text('Los lados se cruzan. Arrastra las esquinas para '
          'deshacer el cruce.'), findsNothing);

      final boton = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(boton.onPressed, isNotNull);
    });

    testWidgets('dice qué hay que hacer sin que haya que adivinarlo', (
      tester,
    ) async {
      await montar(tester, rectificador: Espia().queDevuelve(jpegEnderezado));
      expect(find.textContaining('Arrastra las cuatro esquinas'), findsOneWidget);
    });
  });

  group('arrastrar una esquina', () {
    testWidgets('la esquina agarrada llega al sitio donde se soltó', (
      tester,
    ) async {
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));

      final ajuste = ajusteEnPantalla(tester);
      final desde = dondeEsta(tester, porDefecto, 0);
      const empujon = Offset(-20, -12);

      await tester.dragFrom(desde, empujon);
      await tester.pumpAndSettle();

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      // Lo que se comprueba es la coordenada que se le pasó al enderezado, o
      // sea la que de verdad se va a recortar. Mirar el dibujo no valdría: una
      // conversión mal hecha pinta el asa donde está el dedo y recorta en otro
      // sitio, que es exactamente el fallo que se busca.
      final esperado = ajuste.aImagen(
        Punto(
          ajuste.aPantalla(porDefecto.arribaIzquierda).x + empujon.dx,
          ajuste.aPantalla(porDefecto.arribaIzquierda).y + empujon.dy,
        ),
      );
      final obtenido = espia.peticion!.encuadre.arribaIzquierda;

      expect(obtenido.x, closeTo(esperado.x, 0.5));
      expect(obtenido.y, closeTo(esperado.y, 0.5));
    });

    testWidgets('las otras tres esquinas se quedan donde estaban', (
      tester,
    ) async {
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));

      await tester.dragFrom(
        dondeEsta(tester, porDefecto, 2),
        const Offset(15, 10),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      final salida = espia.peticion!.encuadre;
      expect(salida.arribaIzquierda, porDefecto.arribaIzquierda);
      expect(salida.arribaDerecha, porDefecto.arribaDerecha);
      expect(salida.abajoIzquierda, porDefecto.abajoIzquierda);
      expect(salida.abajoDerecha, isNot(porDefecto.abajoDerecha));
    });

    testWidgets('tocar lejos de las asas no mueve nada', (tester) async {
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));

      final zona = tester.getRect(find.byKey(claveZonaDeRecorte));
      await tester.dragFrom(zona.center, const Offset(40, 40));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      final salida = espia.peticion!.encuadre;
      expect(salida.arribaIzquierda, porDefecto.arribaIzquierda);
      expect(salida.arribaDerecha, porDefecto.arribaDerecha);
      expect(salida.abajoDerecha, porDefecto.abajoDerecha);
      expect(salida.abajoIzquierda, porDefecto.abajoIzquierda);
    });

    testWidgets('un arrastre que se sale de la foto se queda en el borde', (
      tester,
    ) async {
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));

      await tester.dragFrom(
        dondeEsta(tester, porDefecto, 0),
        const Offset(-4000, -4000),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      expect(espia.peticion!.encuadre.arribaIzquierda, const Punto(0, 0));
    });
  });

  group('cuando el recorte no vale', () {
    /// Dónde acaba la esquina de arriba a la izquierda una vez cruzada.
    ///
    /// Se deja diez puntos más allá de la de arriba a la derecha, que es lo
    /// justo para que los dos lados se corten y sigan cabiendo las dos asas en
    /// la pantalla.
    Offset trasElCruce(WidgetTester tester) =>
        dondeEsta(tester, porDefecto, 1) + const Offset(10, 4);

    /// Cruza dos lados llevando la esquina de arriba a la izquierda más allá
    /// de la de la derecha.
    Future<void> cruzarLosLados(WidgetTester tester) async {
      final desde = dondeEsta(tester, porDefecto, 0);
      await tester.dragFrom(desde, trasElCruce(tester) - desde);
      await tester.pumpAndSettle();
    }

    testWidgets('se avisa y se dice qué gesto lo arregla', (tester) async {
      await montar(tester, rectificador: Espia().queDevuelve(jpegEnderezado));
      await cruzarLosLados(tester);

      expect(find.textContaining('se cruzan'), findsOneWidget);
      expect(find.textContaining('Arrastra las esquinas'), findsOneWidget);
    });

    testWidgets('no se puede aceptar', (tester) async {
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));
      await cruzarLosLados(tester);

      final boton = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(boton.onPressed, isNull);

      // Y pulsarlo de todas formas no llama al enderezado.
      await tester.tap(find.text('Usar la foto'), warnIfMissed: false);
      await tester.pumpAndSettle();
      expect(espia.llamadas, 0);
    });

    testWidgets('se puede deshacer moviendo la esquina de vuelta', (
      tester,
    ) async {
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));
      await cruzarLosLados(tester);
      expect(find.textContaining('se cruzan'), findsOneWidget);

      // El recorte estuvo en un estado inválido y se sale de él arrastrando la
      // misma esquina de vuelta. Es la razón de que `moverEsquina` no bloquee
      // el arrastre cuando el cuadrilátero deja de valer: si lo bloqueara, el
      // cruce no se podría deshacer nunca.
      //
      // El agarre se hace justo donde quedó la esquina cruzada. Ahí las dos
      // asas de arriba están a diez puntos, o sea que sus zonas sensibles se
      // solapan, y esto solo funciona porque `asaMasCercana` devuelve la más
      // cercana y no la primera del orden.
      final vuelta = dondeEsta(tester, porDefecto, 0);
      await tester.dragFrom(trasElCruce(tester), vuelta - trasElCruce(tester));
      await tester.pumpAndSettle();

      expect(find.textContaining('se cruzan'), findsNothing);
      final boton = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(boton.onPressed, isNotNull);

      // Y vuelve exactamente a su sitio, no a un sitio cualquiera que resulte
      // válido: sin esta comprobación la prueba pasaría con cualquier arrastre
      // que enderezara el cuadrilátero por casualidad.
      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();
      final recuperada = espia.peticion!.encuadre.arribaIzquierda;
      expect(recuperada.x, closeTo(porDefecto.arribaIzquierda.x, 0.5));
      expect(recuperada.y, closeTo(porDefecto.arribaIzquierda.y, 0.5));
    });

    testWidgets('«Reiniciar» devuelve el recorte de partida', (tester) async {
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));
      await cruzarLosLados(tester);
      expect(find.textContaining('se cruzan'), findsOneWidget);

      await tester.tap(find.text('Reiniciar'));
      await tester.pumpAndSettle();

      expect(find.textContaining('se cruzan'), findsNothing);

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();
      final salida = espia.peticion!.encuadre;
      expect(salida.arribaIzquierda, porDefecto.arribaIzquierda);
      expect(salida.abajoDerecha, porDefecto.abajoDerecha);
    });
  });

  group('al aceptar', () {
    testWidgets('se cierra con el JPEG que devolvió el enderezado', (
      tester,
    ) async {
      final espia = Espia();
      final devueltos = await montar(
        tester,
        rectificador: espia.queDevuelve(jpegEnderezado),
      );

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      expect(espia.llamadas, 1);
      expect(devueltos, [jpegEnderezado]);
      expect(find.byType(PantallaRecorte), findsNothing);
    });

    testWidgets('se enderezan los bytes ya girados, no otros', (tester) async {
      // El motivo está en el docstring de `enderezarOrientacion`: si aquí
      // viajaran los bytes de la cámara, la pantalla habría enseñado la foto
      // girada por el EXIF y el enderezado la trataría sin girar.
      final espia = Espia();
      await montar(tester, rectificador: espia.queDevuelve(jpegEnderezado));

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      expect(espia.peticion!.foto, same(foto.bytes));
    });

    testWidgets('si el enderezado no sale, se dice y no se cierra', (
      tester,
    ) async {
      final espia = Espia();
      final devueltos = await montar(
        tester,
        rectificador: espia.queDevuelve(null),
      );

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      expect(find.byType(PantallaRecorte), findsOneWidget);
      expect(devueltos, isEmpty);
      expect(find.textContaining('No se pudo enderezar'), findsOneWidget);
    });

    testWidgets('si el enderezado lanza, tampoco se queda colgada', (
      tester,
    ) async {
      // Reservar el mapa de bits en el otro isolate puede quedarse sin
      // memoria. Sin capturarlo, el indicador daría vueltas para siempre.
      final espia = Espia();
      await montar(tester, rectificador: espia.queLanza());

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      expect(find.textContaining('No se pudo enderezar'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.byType(PantallaRecorte), findsOneWidget);
    });

    testWidgets('tras un fallo se puede volver a intentar', (tester) async {
      var toca = 0;
      final devueltos = <Uint8List?>[];

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Center(
              child: ElevatedButton(
                onPressed: () async {
                  devueltos.add(
                    await Navigator.of(context).push<Uint8List>(
                      MaterialPageRoute<Uint8List>(
                        builder: (_) => PantallaRecorte(
                          foto: foto,
                          rectificador: (p) async {
                            toca++;
                            return toca == 1 ? null : jpegEnderezado;
                          },
                        ),
                      ),
                    ),
                  );
                },
                child: const Text('abrir'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('abrir'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();
      expect(find.textContaining('No se pudo enderezar'), findsOneWidget);

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      expect(devueltos, [jpegEnderezado]);
    });
  });

  group('en una pantalla estrecha', () {
    testWidgets('la barra de abajo cabe entera en 320 puntos', (tester) async {
      // La primera versión de esta barra daba anchos fijos a los tres botones y
      // se salía por la derecha en cuanto la pantalla bajaba de unos 500
      // puntos, o sea en todos los teléfonos; lo que quedaba fuera era medio
      // botón de aceptar. El entorno de pruebas convierte un desbordamiento en
      // fallo, así que basta con montarla estrecha —320 es el ancho del
      // teléfono más pequeño que sigue en circulación—.
      final vista = tester.view;
      vista.physicalSize = const Size(320, 640);
      vista.devicePixelRatio = 1;

      await montar(tester, rectificador: Espia().queDevuelve(jpegEnderezado));

      expect(find.text('Cancelar'), findsOneWidget);
      expect(find.text('Reiniciar'), findsOneWidget);
      expect(find.text('Usar la foto'), findsOneWidget);

      // Y los tres siguen midiendo lo que hace falta para acertarlos con el
      // pulgar. El ancho puede encogerse; el alto es el que no se negocia.
      for (final boton in [
        find.widgetWithText(TextButton, 'Cancelar'),
        find.widgetWithText(TextButton, 'Reiniciar'),
        find.widgetWithText(FilledButton, 'Usar la foto'),
      ]) {
        expect(tester.getSize(boton).height, greaterThanOrEqualTo(48));
      }
    });

    testWidgets('y se puede aceptar con normalidad', (tester) async {
      final vista = tester.view;
      vista.physicalSize = const Size(320, 640);
      vista.devicePixelRatio = 1;

      final espia = Espia();
      final devueltos = await montar(
        tester,
        rectificador: espia.queDevuelve(jpegEnderezado),
      );

      await tester.tap(find.text('Usar la foto'));
      await tester.pumpAndSettle();

      expect(devueltos, [jpegEnderezado]);
    });
  });

  group('mientras endereza', () {
    testWidgets('se ve que está trabajando y no se puede pulsar dos veces', (
      tester,
    ) async {
      // La razón de que el enderezado se haga en esta pantalla y no en quien la
      // abrió: es la única que puede enseñar que está ocupada. Sin indicador,
      // ese segundo de espera se lee como que el botón no funcionó.
      final terminar = Completer<Uint8List?>();
      var llamadas = 0;
      final devueltos = <Uint8List?>[];

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => Center(
              child: ElevatedButton(
                onPressed: () async {
                  devueltos.add(
                    await Navigator.of(context).push<Uint8List>(
                      MaterialPageRoute<Uint8List>(
                        builder: (_) => PantallaRecorte(
                          foto: foto,
                          rectificador: (p) {
                            llamadas++;
                            return terminar.future;
                          },
                        ),
                      ),
                    ),
                  );
                },
                child: const Text('abrir'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('abrir'));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Usar la foto'));
      await tester.pump();

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.text('Usar la foto'), findsNothing);

      // Los tres botones quedan fuera de servicio: aceptar dos veces lanzaría
      // dos enderezados, y cancelar a mitad dejaría el `pop` del final
      // buscando una pantalla que ya no está en la pila.
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      for (final boton in tester.widgetList<TextButton>(
        find.byType(TextButton),
      )) {
        expect(boton.onPressed, isNull);
      }

      await tester.tap(find.byType(FilledButton), warnIfMissed: false);
      await tester.pump();
      expect(llamadas, 1);

      terminar.complete(jpegEnderezado);
      await tester.pumpAndSettle();

      expect(devueltos, [jpegEnderezado]);
      expect(find.byType(PantallaRecorte), findsNothing);
    });
  });

  group('al cancelar', () {
    testWidgets('se cierra sin nada y sin enderezar', (tester) async {
      final espia = Espia();
      final devueltos = await montar(
        tester,
        rectificador: espia.queDevuelve(jpegEnderezado),
      );

      await tester.tap(find.text('Cancelar'));
      await tester.pumpAndSettle();

      expect(devueltos, [null]);
      expect(espia.llamadas, 0);
      expect(find.byType(PantallaRecorte), findsNothing);
    });
  });
}
