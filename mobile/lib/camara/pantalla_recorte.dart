/// La pantalla donde se ajustan las cuatro esquinas antes de enderezar.
///
/// Aquí solo hay dibujo y gestos. Las cuentas —dónde cae la foto dentro de la
/// caja, qué asa agarra un toque, hasta dónde puede llegar un arrastre, qué
/// aviso toca— están en `recorte_en_pantalla.dart`, que es Dart puro y se
/// prueba sin teléfono. La separación no es ceremonia: los fallos de este sitio
/// son de conversión de coordenadas, y salen en un móvil con otra proporción de
/// pantalla mientras el emulador los tapa.
///
/// ## Qué devuelve
///
/// Se cierra con el JPEG ya enderezado, o con `null` si se cancela. Endereza
/// aquí dentro, y no en quien la abrió, porque es la única pantalla que puede
/// enseñar que está trabajando: el recorrido píxel a píxel de una foto de dos
/// megapíxeles tarda alrededor de un segundo, y sin nada en pantalla ese
/// segundo se interpreta como que el botón no funcionó y se vuelve a pulsar.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'geometria.dart';
import 'rectificar.dart';
import 'recorte_en_pantalla.dart';

/// Quién hace el trabajo pesado. Se cambia en las pruebas.
///
/// En una prueba de widget no hay isolates de verdad —`compute` funciona, pero
/// obliga a que la función sea de nivel superior y a esperar a un hilo real, y
/// convierte cada prueba de la interfaz en una prueba del enderezado, que ya
/// está probado aparte—.
typedef Rectificador = Future<Uint8List?> Function(PeticionDeRectificado);

/// El enderezado de verdad, fuera del hilo de la interfaz.
///
/// `compute` y no una llamada directa: mil milisegundos de Dart puro en el hilo
/// de la interfaz son sesenta fotogramas perdidos, o sea la animación del botón
/// congelada y, si se alarga, el diálogo de «la aplicación no responde» de
/// Android.
Future<Uint8List?> rectificarEnOtroHilo(PeticionDeRectificado peticion) =>
    compute(rectificar, peticion);

/// La zona de la foto donde se arrastran las asas.
const Key claveZonaDeRecorte = Key('zona-de-recorte');

class PantallaRecorte extends StatefulWidget {
  const PantallaRecorte({
    super.key,
    required this.foto,
    this.rectificador = rectificarEnOtroHilo,
  });

  /// La foto **ya enderezada de orientación** por `enderezarOrientacion`.
  ///
  /// No los bytes de la cámara. Si aquí entrasen los originales, esta pantalla
  /// pintaría la foto girada por la etiqueta EXIF —que Flutter sí aplica— y el
  /// enderezado trabajaría sobre la imagen sin girar —porque `decodeImage` no
  /// la aplica—, así que las esquinas marcadas y las esquinas usadas serían de
  /// dos imágenes distintas.
  final FotoDerecha foto;

  final Rectificador rectificador;

  @override
  State<PantallaRecorte> createState() => _PantallaRecorteState();
}

class _PantallaRecorteState extends State<PantallaRecorte> {
  late Encuadre _encuadre = encuadrePorDefecto(
    widget.foto.ancho,
    widget.foto.alto,
  );

  /// Qué asa tiene el dedo encima, si hay alguna.
  int? _arrastrando;

  /// Lo que hay entre el dedo y la esquina que agarró, en puntos de pantalla.
  ///
  /// Sin esto la esquina salta al centro del dedo en cuanto se la toca, y como
  /// la zona sensible tiene cuarenta y cuatro puntos, ese salto puede ser de
  /// medio centímetro. Guardando la diferencia al agarrar, la esquina se mueve
  /// lo que se mueve el dedo y no más.
  Offset _desfase = Offset.zero;

  bool _trabajando = false;
  String? _fallo;

  @override
  Widget build(BuildContext context) {
    final aviso = avisoDelEncuadre(_encuadre, areaMinima: 4);

    return Scaffold(
      backgroundColor: const Color(0xFF0F1115),
      body: SafeArea(
        child: Column(
          children: [
            const _Instruccion(),
            Expanded(child: _zonaDeLaFoto()),
            _Avisos(aviso: aviso, fallo: _fallo),
            _BarraDeAcciones(
              // La barra abajo y no arriba: es donde llega el pulgar con el
              // teléfono en una mano, que es la misma razón de la barra del
              // editor en la web.
              trabajando: _trabajando,
              puedeAceptar: aviso == null && !_trabajando,
              alCancelar: () => Navigator.of(context).pop(),
              alReiniciar: _trabajando ? null : _reiniciar,
              alAceptar: _aceptar,
            ),
          ],
        ),
      ),
    );
  }

  Widget _zonaDeLaFoto() {
    return LayoutBuilder(
      builder: (context, restricciones) {
        final ajuste = ajustarDentro(
          anchoImagen: widget.foto.ancho,
          altoImagen: widget.foto.alto,
          anchoCaja: restricciones.maxWidth,
          altoCaja: restricciones.maxHeight,
        );

        // En el primer fotograma la caja puede llegar sin tamaño. Devolver algo
        // vacío es la única salida honesta: con una escala infinita las cuatro
        // asas quedarían en NaN, y un NaN sobrevive a cualquier operación
        // posterior, así que la pantalla ya no se recuperaría nunca.
        if (ajuste == null) return const SizedBox.shrink();

        return GestureDetector(
          // La clave es para las pruebas: sin ella no hay forma de localizar
          // esta zona en el árbol, porque la pantalla tiene varios
          // `GestureDetector` —los tres botones llevan el suyo dentro—.
          key: claveZonaDeRecorte,
          // `opaque` para que los toques en las bandas negras de los lados
          // también lleguen: una esquina arrastrada hasta el borde de la foto
          // tiene media zona sensible fuera de la imagen, y sin esto esa mitad
          // no respondería.
          behavior: HitTestBehavior.opaque,
          onPanStart: (detalle) => _agarrar(ajuste, detalle.localPosition),
          onPanUpdate: (detalle) => _mover(ajuste, detalle.localPosition),
          onPanEnd: (_) => setState(() => _arrastrando = null),
          onPanCancel: () => setState(() => _arrastrando = null),
          child: Stack(
            fit: StackFit.expand,
            children: [
              Image.memory(
                widget.foto.bytes,
                fit: BoxFit.contain,
                // El mismo encaje que calcula `ajustarDentro`. Si uno de los
                // dos cambiara, la foto y las asas dejarían de coincidir.
                filterQuality: FilterQuality.medium,
              ),
              CustomPaint(
                painter: _PintorDelRecorte(
                  encuadre: _encuadre,
                  ajuste: ajuste,
                  valido: encuadreValido(_encuadre, areaMinima: 4),
                  agarrada: _arrastrando,
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _agarrar(Ajuste ajuste, Offset toque) {
    final punto = Punto(toque.dx, toque.dy);
    final indice = asaMasCercana(_encuadre, ajuste, punto);
    if (indice == null) return;

    final enPantalla = ajuste.aPantalla(_encuadre.enOrden[indice]);
    setState(() {
      _arrastrando = indice;
      _desfase = Offset(enPantalla.x - toque.dx, enPantalla.y - toque.dy);
      // Un fallo anterior deja de tener sentido en cuanto se vuelve a tocar.
      _fallo = null;
    });
  }

  void _mover(Ajuste ajuste, Offset toque) {
    final indice = _arrastrando;
    if (indice == null) return;

    // Desde la posición absoluta del dedo cada vez, y no acumulando el
    // desplazamiento: acumulando, un arrastre que se sale de la foto y vuelve
    // deja la esquina desplazada para siempre, porque lo que se recortó contra
    // el borde no se recupera al volver.
    final destino = ajuste.aImagen(
      Punto(toque.dx + _desfase.dx, toque.dy + _desfase.dy),
    );
    setState(() {
      _encuadre = moverEsquina(_encuadre, indice, destino, ajuste);
    });
  }

  void _reiniciar() {
    setState(() {
      _encuadre = encuadrePorDefecto(widget.foto.ancho, widget.foto.alto);
      _fallo = null;
    });
  }

  Future<void> _aceptar() async {
    if (_trabajando) return;
    if (avisoDelEncuadre(_encuadre, areaMinima: 4) != null) return;

    // El navegador se resuelve antes del `await`: después, esta pantalla puede
    // haberse desmontado —el botón «atrás» del sistema sigue vivo mientras se
    // endereza— y buscar el contexto entonces es mirar un árbol que ya no está.
    final navegador = Navigator.of(context);
    setState(() {
      _trabajando = true;
      _fallo = null;
    });

    Uint8List? jpeg;
    try {
      jpeg = await widget.rectificador(
        PeticionDeRectificado(widget.foto.bytes, encuadre: _encuadre),
      );
    } catch (error) {
      // Enderezar reserva un mapa de bits de varios megas en otro isolate.
      // Quedarse sin memoria ahí lanza, y sin esto la pantalla se quedaría con
      // el indicador dando vueltas para siempre.
      jpeg = null;
    }

    if (!mounted) return;

    if (jpeg == null) {
      setState(() {
        _trabajando = false;
        _fallo = 'No se pudo enderezar la foto. Prueba a mover las esquinas o '
            'a hacer otra foto.';
      });
      return;
    }

    navegador.pop(jpeg);
  }
}

class _Instruccion extends StatelessWidget {
  const _Instruccion();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.fromLTRB(20, 14, 20, 10),
      child: Text(
        'Arrastra las cuatro esquinas hasta los bordes del diagrama.',
        textAlign: TextAlign.center,
        style: TextStyle(color: Color(0xFF8A93A6), fontSize: 13, height: 1.4),
      ),
    );
  }
}

/// El aviso del encuadre y el fallo del enderezado, en ese orden.
///
/// Reserva su altura aunque no haya nada que decir. Si apareciera y
/// desapareciera, la foto y las cuatro asas se moverían solas cada vez que el
/// recorte cruza la frontera de lo válido —que es mientras se arrastra—, y la
/// esquina se escaparía del dedo justo en el momento de colocarla.
class _Avisos extends StatelessWidget {
  const _Avisos({required this.aviso, required this.fallo});

  final String? aviso;
  final String? fallo;

  @override
  Widget build(BuildContext context) {
    final texto = fallo ?? aviso;
    return Container(
      width: double.infinity,
      constraints: const BoxConstraints(minHeight: 46),
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: texto == null
          ? null
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.error_outline,
                  size: 18,
                  color: Color(0xFFFFB4A2),
                ),
                const SizedBox(width: 10),
                Flexible(
                  child: Text(
                    texto,
                    style: const TextStyle(
                      color: Color(0xFFFFB4A2),
                      fontSize: 13,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _BarraDeAcciones extends StatelessWidget {
  const _BarraDeAcciones({
    required this.trabajando,
    required this.puedeAceptar,
    required this.alCancelar,
    required this.alReiniciar,
    required this.alAceptar,
  });

  final bool trabajando;
  final bool puedeAceptar;
  final VoidCallback alCancelar;
  final VoidCallback? alReiniciar;
  final VoidCallback alAceptar;

  @override
  Widget build(BuildContext context) {
    // Los tres botones van en `Expanded` y no a su tamaño natural. Con anchos
    // fijos la fila se salía por la derecha en cuanto la pantalla bajaba de
    // unos 500 puntos —o sea, en cualquier teléfono de verdad— y lo que se
    // quedaba fuera era medio botón de aceptar. Repartiendo el ancho
    // disponible, la barra cabe igual en 320 que en una tableta.
    const estiloSecundario = ButtonStyle(
      // Cuarenta y ocho de alto: el mínimo que se acierta con el pulgar sin
      // mirar, igual que en la barra de la web. Se fija el alto y se deja el
      // ancho libre, que es lo que permite que quepa.
      minimumSize: WidgetStatePropertyAll(Size.fromHeight(48)),
      padding: WidgetStatePropertyAll(EdgeInsets.symmetric(horizontal: 8)),
      foregroundColor: WidgetStatePropertyAll(Color(0xFF8A93A6)),
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: TextButton(
              onPressed: trabajando ? null : alCancelar,
              style: estiloSecundario,
              child: const Text('Cancelar', maxLines: 1),
            ),
          ),
          Expanded(
            flex: 3,
            child: TextButton(
              onPressed: alReiniciar,
              style: estiloSecundario,
              child: const Text('Reiniciar', maxLines: 1),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 5,
            child: FilledButton(
              onPressed: puedeAceptar ? alAceptar : null,
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
                padding: const EdgeInsets.symmetric(horizontal: 8),
              ),
              child: trabajando
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.2,
                        color: Colors.white,
                      ),
                    )
                  : const Text(
                      'Usar la foto',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Oscurece lo que queda fuera del recorte y dibuja las cuatro asas.
class _PintorDelRecorte extends CustomPainter {
  const _PintorDelRecorte({
    required this.encuadre,
    required this.ajuste,
    required this.valido,
    required this.agarrada,
  });

  final Encuadre encuadre;
  final Ajuste ajuste;
  final bool valido;
  final int? agarrada;

  static const Color _bien = Color(0xFF5B9CFF);
  static const Color _mal = Color(0xFFFF6B6B);

  @override
  void paint(Canvas lienzo, Size medida) {
    final esquinas = encuadre.enOrden
        .map(ajuste.aPantalla)
        .map((p) => Offset(p.x, p.y))
        .toList();

    final recorte = Path()..addPolygon(esquinas, true);
    final color = valido ? _bien : _mal;

    // Lo de fuera, más oscuro. Es lo que hace entender de un vistazo qué parte
    // de la foto se va a quedar, sin ninguna etiqueta que leer.
    lienzo.drawPath(
      Path.combine(
        PathOperation.difference,
        Path()..addRect(Offset.zero & medida),
        recorte,
      ),
      Paint()..color = const Color(0xFF0F1115).withValues(alpha: 0.62),
    );

    lienzo.drawPath(
      recorte,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..color = color,
    );

    for (var i = 0; i < esquinas.length; i++) {
      final radio = i == agarrada ? 15.0 : 11.0;
      lienzo.drawCircle(
        esquinas[i],
        radio,
        Paint()..color = const Color(0xFF0F1115).withValues(alpha: 0.85),
      );
      lienzo.drawCircle(
        esquinas[i],
        radio,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 3
          ..color = color,
      );
    }
  }

  @override
  bool shouldRepaint(_PintorDelRecorte anterior) {
    if (anterior.valido != valido) return true;
    if (anterior.agarrada != agarrada) return true;
    if (anterior.ajuste.escala != ajuste.escala) return true;
    if (anterior.ajuste.margenX != ajuste.margenX) return true;
    if (anterior.ajuste.margenY != ajuste.margenY) return true;

    final antes = anterior.encuadre.enOrden;
    final ahora = encuadre.enOrden;
    for (var i = 0; i < 4; i++) {
      if (antes[i] != ahora[i]) return true;
    }
    return false;
  }
}
