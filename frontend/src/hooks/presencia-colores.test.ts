import { describe, expect, it } from 'vitest';
import { repartirColores } from './usePresencia';

/**
 * El reparto de colores de presencia (RF-COL-04).
 *
 * Estas pruebas existen porque la versión anterior —`COLORES[clientId % 8]`,
 * con el `clientID` aleatorio de Yjs— pasaba cualquier inspección visual: se
 * veían cursores de colores y parecía correcto. Solo fallaba en las dos
 * situaciones que nadie reproduce a mano: recargar la página y ser cuatro.
 *
 * Que la función sea pura es lo que permite comprobarlo aquí en milisegundos
 * en vez de con cuatro navegadores abiertos. Es la razón de que se extrajera.
 */

/** Ocho identidades bastan para llenar la paleta. */
const OCHO = ['ana', 'bruno', 'carla', 'diego', 'elena', 'fran', 'gabi', 'hugo'];

describe('repartirColores', () => {
  it('le da a cada persona el mismo color en cada llamada', () => {
    // La avería de fondo de la versión anterior: el color era de la pestaña.
    // Al recargar salía otro, y ningún compañero llegaba a asociar color y
    // persona, que es lo único para lo que sirve ponerles color.
    const primera = repartirColores(OCHO);
    const segunda = repartirColores(OCHO);

    for (const quien of OCHO) {
      expect(segunda.get(quien)).toBe(primera.get(quien));
    }
  });

  it('no depende del orden en que lleguen los participantes', () => {
    /*
      Esta es la que sostiene todo el diseño. Cada navegador ejecuta el reparto
      por su cuenta sobre los estados que le han ido llegando, y no llegan en el
      mismo orden en todas partes. Si el orden influyera, cada uno vería una
      sala de colores distinta y no habría forma de hablar de «el cursor azul».
    */
    const alDerecho = repartirColores(OCHO);
    const alReves = repartirColores([...OCHO].reverse());

    expect(Object.fromEntries(alReves)).toEqual(Object.fromEntries(alDerecho));
  });

  it('no repite color mientras quepan', () => {
    const reparto = repartirColores(OCHO);
    const colores = [...reparto.values()];

    expect(colores).toHaveLength(8);
    expect(new Set(colores).size).toBe(8);
  });

  it('tampoco repite en grupos pequeños, que es donde más se nota', () => {
    // Con cuatro al azar entre ocho colores, la probabilidad de que dos
    // coincidieran era del 34%: una de cada tres salas. No es un caso raro,
    // es el tamaño normal de un grupo de prácticas.
    for (const grupo of [
      ['ana', 'bruno'],
      ['ana', 'bruno', 'carla'],
      ['ana', 'bruno', 'carla', 'diego'],
      ['u-17', 'u-18', 'u-19', 'u-20', 'u-21'],
    ]) {
      const colores = [...repartirColores(grupo).values()];
      expect(new Set(colores).size, `${grupo.join(', ')} comparten color`).toBe(grupo.length);
    }
  });

  it('a la misma persona en dos pestañas le da un solo color', () => {
    // Es la respuesta correcta y además la que confunde al demostrarlo: con
    // una sola cuenta abierta dos veces parece que no funciona. Hacen falta
    // dos cuentas.
    const reparto = repartirColores(['ana', 'ana', 'bruno']);

    expect(reparto.size).toBe(2);
    expect(reparto.get('ana')).not.toBe(reparto.get('bruno'));
  });

  it('con más de ocho repite, pero repite igual para todos', () => {
    // Se agota la paleta y no hay nada que hacer. Lo que no puede pasar es que
    // se agote de forma distinta en cada navegador.
    const doce = [...OCHO, 'irene', 'jose', 'kira', 'luis'];

    expect(new Set(repartirColores(doce).values()).size).toBe(8);
    expect(Object.fromEntries(repartirColores([...doce].reverse()))).toEqual(
      Object.fromEntries(repartirColores(doce)),
    );
  });

  it('reparte colores de la paleta y no inventa ninguno', () => {
    // Los ocho de la paleta están comprobados en `estilos.test.ts`: contraste,
    // saturación acotada y distancia entre ellos. Un color fabricado aquí se
    // saltaría esas tres comprobaciones sin que nadie se enterara.
    for (const color of repartirColores([...OCHO, 'irene']).values()) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('no se cae con una sala vacía', () => {
    expect(repartirColores([]).size).toBe(0);
  });
});
