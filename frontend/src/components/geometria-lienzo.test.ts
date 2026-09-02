import { describe, expect, it } from 'vitest';
import { UmlClassSchema, UmlRelationSchema, type UmlClass, type UmlRelation } from '@app/shared';
import {
  ANCHO_MAXIMO,
  ANCHO_MINIMO,
  anclaje,
  desviosPorPar,
  etiquetaClase,
  medidasDe,
  puntoEnCurva,
  recortar,
  textoAtributo,
} from './geometria-lienzo';

/**
 * Pruebas de la geometría del lienzo.
 *
 * Lo que se comprueba aquí no lo detecta el compilador y tampoco se nota
 * leyendo el código: son propiedades del dibujo. Que dos relaciones entre las
 * mismas clases no acaben una encima de otra, que una línea salga por el borde
 * de la caja y no desde su centro, que un nombre larguísimo no desborde. Todo
 * eso compilaba igual de bien cuando estaba mal.
 */

/*
  Se construyen pasando por el esquema y no a mano: así los valores por defecto
  —el tipo de clase, la posición, el tamaño— son exactamente los mismos que en la
  aplicación, y una fixture no puede quedarse desfasada del modelo sin que estas
  pruebas se enteren. El parámetro va suelto porque lo que se escribe aquí es la
  *entrada* del esquema, donde todo lo que tiene defecto es opcional.
*/
const clase = (parcial: Record<string, unknown>): UmlClass => UmlClassSchema.parse(parcial);

const relacion = (id: string, origen: string, destino: string): UmlRelation =>
  UmlRelationSchema.parse({
    id,
    kind: 'association',
    source: { classId: origen },
    target: { classId: destino },
  });

describe('medidasDe', () => {
  it('una clase de nombre corto y sin miembros ocupa el ancho mínimo', () => {
    const medida = medidasDe(clase({ id: 'c1', name: 'Pago' }));
    expect(medida.ancho).toBe(ANCHO_MINIMO);
  });

  it('la caja crece cuando un atributo no cabría en el ancho mínimo', () => {
    const corta = medidasDe(clase({ id: 'c1', name: 'Pedido' }));
    const larga = medidasDe(
      clase({
        id: 'c2',
        name: 'Pedido',
        attributes: [
          {
            id: 'a1',
            name: 'direccionDeFacturacionCompleta',
            type: { name: 'String' },
            visibility: '+',
          },
        ],
      }),
    );
    expect(larga.ancho).toBeGreaterThan(corta.ancho);
  });

  it('por larga que sea la fila, la caja no pasa del tope', () => {
    const medida = medidasDe(
      clase({
        id: 'c1',
        name: 'Pedido',
        methods: [
          {
            id: 'm1',
            name: 'recalcularTotalConDescuentosEImpuestosAplicables',
            visibility: '+',
            parameters: [
              { name: 'porcentajeDeDescuentoSobreElSubtotal', type: { name: 'Double' } },
              { name: 'tipoImpositivoDelPaisDeEntrega', type: { name: 'Double' } },
            ],
          },
        ],
      }),
    );
    expect(medida.ancho).toBe(ANCHO_MAXIMO);
  });

  it('un nombre muy largo también ensancha la caja, no solo los miembros', () => {
    const medida = medidasDe(clase({ id: 'c1', name: 'RegistroDeAuditoriaDeAccesos' }));
    expect(medida.ancho).toBeGreaterThan(ANCHO_MINIMO);
  });

  it('el alto crece una fila por cada miembro', () => {
    const uno = medidasDe(
      clase({
        id: 'c1',
        name: 'A',
        attributes: [{ id: 'a1', name: 'a', type: { name: 'String' }, visibility: '+' }],
      }),
    );
    const dos = medidasDe(
      clase({
        id: 'c2',
        name: 'A',
        attributes: [
          { id: 'a1', name: 'a', type: { name: 'String' }, visibility: '+' },
          { id: 'a2', name: 'b', type: { name: 'String' }, visibility: '+' },
        ],
      }),
    );
    expect(dos.alto).toBeGreaterThan(uno.alto);
  });
});

describe('recortar', () => {
  it('deja intacto lo que cabe', () => {
    expect(recortar('+ id: Long', ANCHO_MINIMO)).toBe('+ id: Long');
  });

  it('lo que no cabe se corta y se marca con puntos suspensivos', () => {
    const largo = '+ direccionDeFacturacionCompletaDelCliente: String';
    const recortado = recortar(largo, ANCHO_MINIMO);
    expect(recortado.endsWith('…')).toBe(true);
    expect(recortado.length).toBeLessThan(largo.length);
  });

  it('nunca devuelve la cadena vacía, por estrecha que sea la caja', () => {
    expect(recortar('nombre', 0).length).toBeGreaterThan(0);
  });
});

describe('anclaje', () => {
  const caja = clase({ id: 'c1', name: 'A', position: { x: 100, y: 100 } });
  const medida = { ancho: 200, alto: 100 };

  it('hacia la derecha, el punto sale por el borde derecho', () => {
    const punto = anclaje(caja, medida, { x: 1000, y: 150 });
    expect(punto.x).toBeCloseTo(300);
    expect(punto.y).toBeCloseTo(150);
  });

  it('hacia arriba, el punto sale por el borde superior', () => {
    const punto = anclaje(caja, medida, { x: 200, y: -500 });
    expect(punto.y).toBeCloseTo(100);
  });

  it('el punto siempre queda sobre el borde, nunca dentro de la caja', () => {
    for (const objetivo of [
      { x: 500, y: 500 },
      { x: -400, y: 130 },
      { x: 190, y: 900 },
      { x: -50, y: -80 },
    ]) {
      const punto = anclaje(caja, medida, objetivo);
      const enBordeX = Math.abs(punto.x - 100) < 1e-6 || Math.abs(punto.x - 300) < 1e-6;
      const enBordeY = Math.abs(punto.y - 100) < 1e-6 || Math.abs(punto.y - 200) < 1e-6;
      expect(enBordeX || enBordeY).toBe(true);
    }
  });

  it('si el objetivo es el propio centro devuelve el centro en vez de dividir por cero', () => {
    const punto = anclaje(caja, medida, { x: 200, y: 150 });
    expect(Number.isFinite(punto.x)).toBe(true);
    expect(Number.isFinite(punto.y)).toBe(true);
  });
});

describe('desviosPorPar', () => {
  it('una relación sola no se desvía: la línea queda recta', () => {
    const desvios = desviosPorPar([relacion('r1', 'a', 'b')]);
    expect(desvios.get('r1')).toBe(0);
  });

  it('dos relaciones entre las mismas clases se separan a lados opuestos', () => {
    const desvios = desviosPorPar([relacion('r1', 'a', 'b'), relacion('r2', 'a', 'b')]);
    expect(desvios.get('r1')).toBe(-0.5);
    expect(desvios.get('r2')).toBe(0.5);
  });

  it('A→B y B→A cuentan como el mismo par, o volverían a superponerse', () => {
    const desvios = desviosPorPar([relacion('r1', 'a', 'b'), relacion('r2', 'b', 'a')]);
    expect(desvios.get('r1')).not.toBe(desvios.get('r2'));
  });

  it('tres entre el mismo par dejan una recta en medio y una a cada lado', () => {
    const desvios = desviosPorPar([
      relacion('r1', 'a', 'b'),
      relacion('r2', 'a', 'b'),
      relacion('r3', 'a', 'b'),
    ]);
    expect([desvios.get('r1'), desvios.get('r2'), desvios.get('r3')]).toEqual([-1, 0, 1]);
  });

  it('pares distintos no se contagian el desvío', () => {
    const desvios = desviosPorPar([relacion('r1', 'a', 'b'), relacion('r2', 'c', 'd')]);
    expect(desvios.get('r1')).toBe(0);
    expect(desvios.get('r2')).toBe(0);
  });
});

describe('puntoEnCurva', () => {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 100, y: 0 };

  it('en t=0 y t=1 devuelve los extremos', () => {
    expect(puntoEnCurva(p0, { x: 50, y: 40 }, p1, 0)).toEqual(p0);
    expect(puntoEnCurva(p0, { x: 50, y: 40 }, p1, 1)).toEqual(p1);
  });

  it('con el control en el medio, la curva es la propia recta', () => {
    expect(puntoEnCurva(p0, { x: 50, y: 0 }, p1, 0.5)).toEqual({ x: 50, y: 0 });
  });

  it('la curva se queda a mitad de camino del punto de control', () => {
    // De aquí sale el factor del abanico: para separar 17 px hay que tirar del
    // control 34. Si esta relación cambiara, las relaciones paralelas dejarían
    // de estar donde se dijo que estarían.
    expect(puntoEnCurva(p0, { x: 50, y: 40 }, p1, 0.5).y).toBe(20);
  });
});

describe('etiquetas del texto de una caja', () => {
  it('el atributo identificador lleva su llave', () => {
    const conClave = clase({
      id: 'c1',
      name: 'Cliente',
      attributes: [
        { id: 'a1', name: 'id', type: { name: 'Long' }, visibility: '+', isIdentifier: true },
        { id: 'a2', name: 'correo', type: { name: 'String' }, visibility: '+' },
      ],
    });
    expect(textoAtributo(conClave.attributes[0]!)).toContain('🔑');
    expect(textoAtributo(conClave.attributes[1]!)).not.toContain('🔑');
  });

  it('cada tipo de clase enseña su estereotipo, y una clase normal ninguno', () => {
    expect(etiquetaClase(clase({ id: 'c1', name: 'A', kind: 'interface' }))).toBe('«interface»');
    expect(etiquetaClase(clase({ id: 'c2', name: 'A', kind: 'enum' }))).toBe('«enumeration»');
    expect(etiquetaClase(clase({ id: 'c3', name: 'A', kind: 'abstract' }))).toBe('«abstract»');
    expect(etiquetaClase(clase({ id: 'c4', name: 'A', kind: 'class' }))).toBeNull();
  });
});
