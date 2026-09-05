import { describe, expect, it } from 'vitest';
import {
  OPERACIONES_REST,
  clasesConApi,
  comunicacionDe,
  createAttribute,
  createClass,
  createDiagram,
  withClass,
  type ClassDiagram,
} from '@app/shared';
import { CAJA, POSICIONES, VISTA, trazar } from './comunicacion';

/**
 * La geometría del visor.
 *
 * Que cada mensaje corresponda a una llamada real del backend generado lo
 * comprueba `generator/src/comunicacion.test.ts`. Lo que se comprueba aquí es lo
 * otro: que el dibujo quepa en su lienzo, que dos mensajes del mismo enlace no
 * salgan uno encima del otro y que ninguna flecha caiga dentro de una caja, que
 * es la manera de que un diagrama correcto se vea mal.
 */

function tienda(): ClassDiagram {
  const pedido = createClass({
    id: 'C1',
    name: 'Pedido',
    attributes: [
      createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true, isNullable: false }),
    ],
  });
  return withClass(
    createDiagram({
      name: 'Tienda',
      meta: { basePackage: 'com.ejemplo.tienda', artifactId: 'tienda', description: '' },
    }),
    pedido,
  );
}

const DIAGRAMA = tienda();
const PEDIDO = clasesConApi(DIAGRAMA)[0]!;

function dentroDeAlgunaCaja(x: number, y: number, alias: string[]): boolean {
  return alias.some((a) => {
    const c = POSICIONES[a]!;
    return (
      Math.abs(x - c.x) < CAJA.ancho / 2 + 4 && Math.abs(y - c.y) < CAJA.alto / 2 + 4
    );
  });
}

describe('trazado del diagrama de comunicación', () => {
  it.each(OPERACIONES_REST)('«%s» cabe entero en el lienzo', (operacion) => {
    const { cajas, flechas } = trazar(comunicacionDe(DIAGRAMA, PEDIDO, operacion));

    for (const caja of cajas) {
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.y).toBeGreaterThanOrEqual(0);
      expect(caja.x + CAJA.ancho).toBeLessThanOrEqual(VISTA.ancho);
      expect(caja.y + CAJA.alto).toBeLessThanOrEqual(VISTA.alto);
    }

    for (const flecha of flechas) {
      expect(flecha.tx).toBeGreaterThan(0);
      expect(flecha.tx).toBeLessThan(VISTA.ancho);
      expect(flecha.ty).toBeGreaterThan(0);
      expect(flecha.ty).toBeLessThan(VISTA.alto);
    }
  });

  it.each(OPERACIONES_REST)('en «%s» ningún número cae dentro de una caja', (operacion) => {
    const comunicacion = comunicacionDe(DIAGRAMA, PEDIDO, operacion);
    const alias = comunicacion.participantes.map((p) => p.alias);
    for (const flecha of trazar(comunicacion).flechas) {
      expect(
        dentroDeAlgunaCaja(flecha.tx, flecha.ty, alias),
        `${operacion} ${flecha.numero} queda tapado por una caja`,
      ).toBe(false);
    }
  });

  it.each(OPERACIONES_REST)('en «%s» dos números no ocupan el mismo sitio', (operacion) => {
    const flechas = trazar(comunicacionDe(DIAGRAMA, PEDIDO, operacion)).flechas;
    for (const a of flechas) {
      for (const b of flechas) {
        if (a === b) continue;
        expect(
          Math.hypot(a.tx - b.tx, a.ty - b.ty),
          `${operacion}: ${a.numero} y ${b.numero} se pisan`,
        ).toBeGreaterThan(14);
      }
    }
  });

  it('la llamada y su retorno van a lados distintos de la misma línea', () => {
    const flechas = trazar(comunicacionDe(DIAGRAMA, PEDIDO, 'obtener')).flechas;
    const ida = flechas.find((f) => f.numero === '1' && !f.retorno)!;
    const vuelta = flechas.find((f) => f.numero === '1' && f.retorno)!;
    // El enlace cliente–controlador es horizontal: separarse quiere decir que
    // uno queda por encima y el otro por debajo.
    expect((ida.ty - POSICIONES.cliente!.y) * (vuelta.ty - POSICIONES.cliente!.y)).toBeLessThan(0);
  });

  it('el auto-mensaje del mapeador se dibuja como bucle, no como recta', () => {
    const flechas = trazar(comunicacionDe(DIAGRAMA, PEDIDO, 'crear')).flechas;
    const bucle = flechas.find((f) => f.numero === '1.1.1.2')!;
    expect(bucle.d).toContain('A ');
    expect(bucle.ty).toBeLessThan(POSICIONES.mapeador!.y - CAJA.alto / 2);
  });

  it('borrar dibuja cuatro cajas y ninguna del mapeador', () => {
    const { cajas, lineas } = trazar(comunicacionDe(DIAGRAMA, PEDIDO, 'borrar'));
    expect(cajas.map((c) => c.alias)).toEqual([
      'cliente',
      'controlador',
      'servicio',
      'repositorio',
    ]);
    expect(lineas).toHaveLength(3);
  });
});
