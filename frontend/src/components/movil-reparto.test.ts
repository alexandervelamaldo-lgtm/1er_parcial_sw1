import { describe, expect, it } from 'vitest';
import { FRACCION_COMPLETA, FRACCION_MEDIA } from './movil-hoja';
import {
  ALTO_BARRA_SUPERIOR,
  ANCHO_MINIMO_LIENZO,
  ANCHO_PANEL_LATERAL,
  cabeElPanel,
  centroVisible,
  repartir,
  sitioDelDetalle,
  zonaVisibleDelLienzo,
  type Pantalla,
} from './movil-reparto';

/**
 * Pruebas del reparto de la pantalla, sin navegador.
 *
 * Las medidas son de aparatos reales y están puestas con su nombre al lado, porque
 * «800 × 360» no dice nada y «un teléfono normal tumbado» sí. Lo que se comprueba
 * es que el diagrama nunca se queda sin sitio y que la hoja y el panel se cobran
 * en dimensiones distintas, que es de donde sale toda la lógica.
 */

/** Un móvil corriente de pie. */
const TELEFONO: Pantalla = { ancho: 390, alto: 844, altoVisible: 844 };

/** El mismo móvil tumbado: sobra anchura y falta altura. */
const TUMBADO: Pantalla = { ancho: 844, alto: 390, altoVisible: 390 };

/** Una tablet de pie: ahí ya cabe todo. */
const TABLET: Pantalla = { ancho: 820, alto: 1180, altoVisible: 1180 };

/** El móvil de pie con el teclado abierto. */
const CON_TECLADO: Pantalla = { ancho: 390, alto: 844, altoVisible: 480 };

describe('dónde va lo que se está editando', () => {
  it('en un teléfono de pie, en una hoja', () => {
    expect(sitioDelDetalle(TELEFONO)).toBe('hoja');
  });

  it('en el mismo teléfono tumbado, en un panel al lado', () => {
    /*
      El requisito del encargo: en apaisado sí cabe un panel, y tiene que
      aprovecharlo el mismo código en vez de estirar la versión de teléfono. Aquí
      es donde se comprueba que la decisión se toma sola al girar el aparato.
    */
    expect(sitioDelDetalle(TUMBADO)).toBe('panel');
  });

  it('en una tablet, en un panel', () => {
    expect(sitioDelDetalle(TABLET)).toBe('panel');
  });

  it('el umbral es la suma del panel y el suelo del lienzo, no un número suelto', () => {
    const justo = ANCHO_PANEL_LATERAL + ANCHO_MINIMO_LIENZO;
    expect(cabeElPanel({ ...TELEFONO, ancho: justo })).toBe(true);
    expect(cabeElPanel({ ...TELEFONO, ancho: justo - 1 })).toBe(false);
  });

  it('un apaisado pequeño se queda con la hoja', () => {
    /*
      640 px tumbado. Con panel el lienzo se quedaría en 280 px, menos que un
      móvil de pie, y encima de forma permanente: un panel no se cierra al
      soltarlo como una hoja. Mejor la hoja, que al bajar devuelve la pantalla
      entera.
    */
    const pequeno: Pantalla = { ancho: 640, alto: 360, altoVisible: 360 };
    expect(sitioDelDetalle(pequeno)).toBe('hoja');
  });

  it('no depende de la altura: lo que decide es la anchura', () => {
    // Una tablet en pantalla partida a lo alto sigue teniendo sitio de sobra a
    // lo ancho. Si esto mirara la altura, perdería el panel sin motivo.
    expect(sitioDelDetalle({ ancho: 820, alto: 1180, altoVisible: 400 })).toBe('panel');
  });
});

describe('el lienzo nunca se queda sin sitio', () => {
  it('con el detalle cerrado se lleva la ventana entera menos la barra', () => {
    const r = repartir(TELEFONO, 'media', false);
    expect(r.lienzo.ancho).toBe(390);
    expect(r.lienzo.alto).toBe(844 - ALTO_BARRA_SUPERIOR);
    expect(r.panel).toBe(0);
    expect(r.hoja).toBe(0);
  });

  it('con el panel abierto le quedan al menos los 320 del suelo', () => {
    for (const ancho of [680, 700, 844, 1024, 1280]) {
      const r = repartir({ ancho, alto: 800, altoVisible: 800 }, 'media', true);
      expect(r.lienzo.ancho, `con ${ancho} px de ventana`).toBeGreaterThanOrEqual(
        ANCHO_MINIMO_LIENZO,
      );
    }
  });

  it('nunca devuelve medidas negativas, ni en una ventana absurda', () => {
    // Un `altoVisible` por debajo de la barra superior sale al abrir el teclado
    // en un apaisado diminuto. Un alto negativo pasado a React Flow no se queda
    // en un detalle visual: rompe el cálculo del encuadre.
    const absurda: Pantalla = { ancho: 200, alto: 40, altoVisible: 30 };
    const r = repartir(absurda, 'completa', true);
    expect(r.lienzo.alto).toBeGreaterThanOrEqual(0);
    expect(r.lienzo.ancho).toBeGreaterThanOrEqual(0);
  });
});

describe('la hoja se superpone y el panel reparte', () => {
  it('el panel le quita anchura al lienzo de verdad', () => {
    const r = repartir(TUMBADO, 'media', true);
    expect(r.lienzo.ancho).toBe(844 - ANCHO_PANEL_LATERAL);
    expect(r.panel).toBe(ANCHO_PANEL_LATERAL);
  });

  it('la hoja no le quita nada al lienzo: flota encima', () => {
    /*
      La prueba que sostiene la decisión del módulo. Si la hoja descontara del
      alto del lienzo, el diagrama se reencuadraría en cada píxel de arrastre de
      la hoja: decenas de reencuadres por segundo mientras el dedo sube.
    */
    const cerrada = repartir(TELEFONO, 'media', false);
    const abierta = repartir(TELEFONO, 'media', true);
    expect(abierta.lienzo).toEqual(cerrada.lienzo);
    expect(abierta.hoja).toBeGreaterThan(0);
  });

  it('la hoja se mide con las mismas fracciones que el módulo de la hoja', () => {
    // No se redefinen aquí: una segunda tabla de alturas se quedaría vieja.
    const media = repartir(TELEFONO, 'media', true);
    const completa = repartir(TELEFONO, 'completa', true);
    expect(media.hoja).toBe(Math.round(844 * FRACCION_MEDIA));
    expect(completa.hoja).toBe(Math.round(844 * FRACCION_COMPLETA));
  });

  it('donde va el panel, la hoja no aparece; y al contrario', () => {
    for (const pantalla of [TELEFONO, TUMBADO, TABLET, CON_TECLADO]) {
      const r = repartir(pantalla, 'media', true);
      const unoSolo = (r.panel > 0) !== (r.hoja > 0);
      expect(unoSolo, `${pantalla.ancho}×${pantalla.altoVisible} abre los dos o ninguno`).toBe(true);
    }
  });
});

describe('la clase que se edita no se queda detrás de la hoja', () => {
  it('lo visible del lienzo es lo que la hoja no tapa', () => {
    const r = repartir(TELEFONO, 'media', true);
    const zona = zonaVisibleDelLienzo(r);
    expect(zona.alto).toBe(r.lienzo.alto - r.hoja);
    expect(zona.ancho).toBe(r.lienzo.ancho);
  });

  it('el panel no tapa nada: el lienzo ya mide menos por él', () => {
    const r = repartir(TUMBADO, 'media', true);
    const zona = zonaVisibleDelLienzo(r);
    expect(zona.alto).toBe(r.lienzo.alto);
  });

  it('el centro donde se coloca la selección sube cuando sube la hoja', () => {
    /*
      El fallo que esto evita: se pulsa una clase, sube la hoja con sus
      propiedades, y la clase que se está editando queda detrás de la hoja. Hay
      que bajarla para ver el cambio y volver a subirla para hacer el siguiente.
    */
    const cerrada = centroVisible(repartir(TELEFONO, 'media', false));
    const abierta = centroVisible(repartir(TELEFONO, 'media', true));
    expect(abierta.y).toBeLessThan(cerrada.y);
  });

  it('con la hoja completa el centro sigue dentro del lienzo', () => {
    const r = repartir(TELEFONO, 'completa', true);
    const centro = centroVisible(r);
    expect(centro.y).toBeGreaterThanOrEqual(0);
    expect(centro.y).toBeLessThanOrEqual(r.lienzo.alto);
  });

  it('si la hoja tapa más de lo que hay, lo visible es cero y no negativo', () => {
    // Pasa con el teclado abierto y la hoja completa en una pantalla corta.
    const corta: Pantalla = { ancho: 390, alto: 844, altoVisible: 300 };
    const r = repartir(corta, 'completa', true);
    expect(zonaVisibleDelLienzo(r).alto).toBeGreaterThanOrEqual(0);
  });
});

describe('al girar el aparato', () => {
  it('el mismo teléfono cambia de hoja a panel y vuelve', () => {
    /*
      Con el mismo código y sin ninguna rama por aparato: es lo que pide el
      encargo cuando dice que el panel lateral lo aproveche el mismo código en
      vez de estirar la versión de teléfono.
    */
    expect(repartir(TELEFONO, 'media', true).sitio).toBe('hoja');
    expect(repartir(TUMBADO, 'media', true).sitio).toBe('panel');
    expect(repartir(TELEFONO, 'media', true).sitio).toBe('hoja');
  });

  it('el teclado no cambia de sitio el detalle', () => {
    // Abrir el teclado reduce `altoVisible`, y si el sitio dependiera de la
    // altura la ficha saltaría de panel a hoja al empezar a escribir, perdiendo
    // el foco del campo por el camino.
    expect(sitioDelDetalle(CON_TECLADO)).toBe(sitioDelDetalle(TELEFONO));
    const tumbadoConTeclado: Pantalla = { ...TUMBADO, altoVisible: 200 };
    expect(sitioDelDetalle(tumbadoConTeclado)).toBe(sitioDelDetalle(TUMBADO));
  });

  it('el lienzo se encoge con el teclado, porque el teclado sí ocupa', () => {
    const r = repartir(CON_TECLADO, 'media', false);
    expect(r.lienzo.alto).toBe(480 - ALTO_BARRA_SUPERIOR);
  });
});
