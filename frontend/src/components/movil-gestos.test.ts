import { describe, expect, it } from 'vitest';
import {
  MS_MANTENIDO,
  QUIETO,
  TOLERANCIA_MANTENIDO,
  cuentaAtrasViva,
  menuPedido,
  siguiente,
  type EstadoMantenido,
  type SucesoGesto,
} from './movil-gestos';

/**
 * Pruebas del «mantener pulsado», sin navegador y sin reloj.
 *
 * El tiempo entra como un número en cada suceso, así que aquí no hay
 * temporizadores falsos ni esperas: una prueba que tarda medio segundo de
 * verdad es una prueba que alguien acabará quitando.
 *
 * Las cuatro primeras pruebas del último grupo son las cuatro formas de
 * equivocarse que están enumeradas en la cabecera del módulo. Están escritas
 * para que se rompa una sola si alguien toca una sola.
 */

/** Encadena sucesos desde el reposo y devuelve el estado final. */
function tras(...sucesos: SucesoGesto[]): EstadoMantenido {
  return sucesos.reduce(siguiente, QUIETO);
}

/** Un dedo que se posa sobre la clase «Cliente» en el instante 0. */
const POSAR: SucesoGesto = {
  tipo: 'posar',
  puntero: 1,
  x: 100,
  y: 100,
  clase: 'Cliente',
  ahora: 0,
};

describe('posar el dedo', () => {
  it('sobre una clase arranca la cuenta atrás', () => {
    const estado = tras(POSAR);
    expect(estado.fase).toBe('esperando');
    expect(cuentaAtrasViva(estado)).toBe(true);
    expect(menuPedido(estado)).toBeNull();
  });

  it('sobre el fondo del lienzo no arranca nada', () => {
    /*
      Mantener pulsado el fondo no abre ningún menú. Si lo abriera, aparecería
      cada vez que alguien apoya el pulgar en el cristal para sujetar el
      teléfono, que es la postura normal de leer un diagrama.
    */
    const estado = tras({ ...POSAR, clase: null });
    expect(estado).toEqual(QUIETO);
    expect(cuentaAtrasViva(estado)).toBe(false);
  });
});

describe('cumplir el plazo', () => {
  it('antes de tiempo no pasa nada', () => {
    const estado = tras(POSAR, { tipo: 'tictac', ahora: MS_MANTENIDO - 1 });
    expect(menuPedido(estado)).toBeNull();
    expect(estado.fase).toBe('esperando');
  });

  it('al cumplirse justo, se pide el menú de esa clase', () => {
    const estado = tras(POSAR, { tipo: 'tictac', ahora: MS_MANTENIDO });
    expect(menuPedido(estado)).toBe('Cliente');
  });

  it('el menú es el de la clase que había debajo, no el de otra', () => {
    const estado = tras(
      { ...POSAR, clase: 'Factura' },
      { tipo: 'tictac', ahora: MS_MANTENIDO + 40 },
    );
    expect(menuPedido(estado)).toBe('Factura');
  });

  it('una vez disparado deja de haber cuenta atrás', () => {
    // El `.tsx` desmonta el temporizador mirando esto. Si siguiera viva, se
    // volvería a pedir el mismo menú en cada tictac.
    const estado = tras(POSAR, { tipo: 'tictac', ahora: MS_MANTENIDO });
    expect(cuentaAtrasViva(estado)).toBe(false);
  });

  it('un tictac de más no cambia nada', () => {
    const uno = tras(POSAR, { tipo: 'tictac', ahora: MS_MANTENIDO });
    const dos = siguiente(uno, { tipo: 'tictac', ahora: MS_MANTENIDO + 500 });
    expect(dos).toEqual(uno);
  });
});

describe('el dedo tiembla pero no se va', () => {
  it('un temblor por debajo de la tolerancia no cancela', () => {
    // Un dedo apoyado en el cristal rueda sobre la yema. Con tolerancia cero
    // este gesto no se conseguiría ni queriendo.
    const estado = tras(
      POSAR,
      { tipo: 'mover', puntero: 1, x: 100 + TOLERANCIA_MANTENIDO - 2, y: 100 },
      { tipo: 'tictac', ahora: MS_MANTENIDO },
    );
    expect(menuPedido(estado)).toBe('Cliente');
  });

  it('el temblor se mide contra donde se posó, no contra el último punto', () => {
    /*
      Si cada movimiento tolerado corriera el origen, se podría recorrer la
      pantalla entera a pasos de nueve píxeles sin cancelar nunca: la caja
      acabaría en la otra punta del lienzo y el menú saltaría igual.
    */
    const pasos: SucesoGesto[] = [];
    for (let i = 1; i <= 10; i++) {
      pasos.push({ tipo: 'mover', puntero: 1, x: 100 + i * 9, y: 100 });
    }
    const estado = tras(POSAR, ...pasos, { tipo: 'tictac', ahora: MS_MANTENIDO });
    expect(menuPedido(estado)).toBeNull();
  });

  it('la tolerancia es un radio, no un rectángulo', () => {
    // En diagonal, 8 y 8 pasan de 10 aunque ninguno de los dos llegue solo.
    const estado = tras(
      POSAR,
      { tipo: 'mover', puntero: 1, x: 108, y: 108 },
      { tipo: 'tictac', ahora: MS_MANTENIDO },
    );
    expect(menuPedido(estado)).toBeNull();
  });

  it('el movimiento de otro dedo no cancela este gesto', () => {
    // Sin esta guarda, el temblor de un dedo apoyado en otra parte de la
    // pantalla mataría un mantenido perfectamente válido.
    const estado = tras(
      POSAR,
      { tipo: 'mover', puntero: 99, x: 900, y: 900 },
      { tipo: 'tictac', ahora: MS_MANTENIDO },
    );
    expect(menuPedido(estado)).toBe('Cliente');
  });
});

describe('las cuatro formas de equivocarse', () => {
  it('1. no salta después de levantar el dedo', () => {
    /*
      El fallo de no cancelar el temporizador: se toca una clase, se la
      selecciona, y medio segundo más tarde aparece un menú encima de lo que se
      estuviera mirando.
    */
    const estado = tras(
      POSAR,
      { tipo: 'levantar', puntero: 1 },
      { tipo: 'tictac', ahora: MS_MANTENIDO + 1000 },
    );
    expect(menuPedido(estado)).toBeNull();
    expect(estado).toEqual(QUIETO);
  });

  it('2. sí salta aunque el dedo no esté perfectamente quieto', () => {
    const estado = tras(
      POSAR,
      { tipo: 'mover', puntero: 1, x: 103, y: 102 },
      { tipo: 'mover', puntero: 1, x: 101, y: 104 },
      { tipo: 'tictac', ahora: MS_MANTENIDO },
    );
    expect(menuPedido(estado)).toBe('Cliente');
  });

  it('3. no salta a media pinza', () => {
    // El primer dedo lleva un rato quieto sobre la clase y llega el segundo
    // para hacer zoom. El menú no puede aparecer sobre lo que se quería mirar.
    const estado = tras(
      POSAR,
      { tipo: 'posar', puntero: 2, x: 300, y: 300, clase: null, ahora: 100 },
      { tipo: 'tictac', ahora: MS_MANTENIDO },
    );
    expect(menuPedido(estado)).toBeNull();
  });

  it('3b. un segundo dedo cierra incluso un menú ya pedido', () => {
    const estado = tras(
      POSAR,
      { tipo: 'tictac', ahora: MS_MANTENIDO },
      { tipo: 'posar', puntero: 2, x: 300, y: 300, clase: 'Factura', ahora: 600 },
    );
    expect(menuPedido(estado)).toBeNull();
  });

  it('4. no salta al arrastrar la caja', () => {
    // Mover una clase empieza igual que mantenerla pulsada. Lo que las separa
    // es si el dedo llega a moverse antes de que se cumpla el plazo.
    const estado = tras(
      POSAR,
      { tipo: 'mover', puntero: 1, x: 260, y: 180 },
      { tipo: 'tictac', ahora: MS_MANTENIDO },
    );
    expect(menuPedido(estado)).toBeNull();
    expect(cuentaAtrasViva(estado)).toBe(false);
  });
});

describe('levantar y cancelar', () => {
  it('levantar otro dedo no termina este gesto', () => {
    const estado = tras(
      POSAR,
      { tipo: 'levantar', puntero: 42 },
      { tipo: 'tictac', ahora: MS_MANTENIDO },
    );
    expect(menuPedido(estado)).toBe('Cliente');
  });

  it('levantar el dedo del gesto lo termina', () => {
    expect(tras(POSAR, { tipo: 'levantar', puntero: 1 })).toEqual(QUIETO);
  });

  it('levantar después de disparar no vuelve a pedir el menú', () => {
    const estado = tras(
      POSAR,
      { tipo: 'tictac', ahora: MS_MANTENIDO },
      { tipo: 'levantar', puntero: 1 },
    );
    expect(menuPedido(estado)).toBeNull();
  });

  it('una llamada entrante cancela desde cualquier fase', () => {
    expect(tras(POSAR, { tipo: 'cancelar' })).toEqual(QUIETO);
    expect(
      tras(POSAR, { tipo: 'tictac', ahora: MS_MANTENIDO }, { tipo: 'cancelar' }),
    ).toEqual(QUIETO);
  });

  it('un suceso suelto en reposo no rompe nada', () => {
    expect(siguiente(QUIETO, { tipo: 'mover', puntero: 1, x: 5, y: 5 })).toEqual(QUIETO);
    expect(siguiente(QUIETO, { tipo: 'levantar', puntero: 1 })).toEqual(QUIETO);
    expect(siguiente(QUIETO, { tipo: 'tictac', ahora: 9999 })).toEqual(QUIETO);
  });
});

describe('se puede volver a empezar', () => {
  it('después de un gesto completo, el siguiente funciona igual', () => {
    const primero = tras(
      POSAR,
      { tipo: 'tictac', ahora: MS_MANTENIDO },
      { tipo: 'levantar', puntero: 1 },
    );
    const segundo = siguiente(primero, {
      tipo: 'posar',
      puntero: 3,
      x: 400,
      y: 400,
      clase: 'Pedido',
      ahora: 2000,
    });
    expect(segundo.fase).toBe('esperando');
    expect(menuPedido(siguiente(segundo, { tipo: 'tictac', ahora: 2000 + MS_MANTENIDO }))).toBe(
      'Pedido',
    );
  });

  it('el plazo se mide desde que se posó ese dedo, no desde el arranque', () => {
    // Un gesto que empieza en el segundo 10 no puede dispararse de inmediato
    // porque el reloj ya pasara de 500.
    const estado = tras(
      { ...POSAR, ahora: 10_000 },
      { tipo: 'tictac', ahora: 10_000 + MS_MANTENIDO - 1 },
    );
    expect(menuPedido(estado)).toBeNull();
  });
});
