import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initializeEmpty, readDiagram } from '../crdt/document.js';
import { applyOperation, applyOperations } from '../crdt/operations.js';
import type { ClassDiagram } from '../model/uml.js';
import { describeImpact, describeBatchImpact } from './impact.js';
import { isDestructiveOperation, type Operation } from './operations.js';
import { interpretarTablaExtraida, parseTablaExtraida, type TablaExtraida } from './import-table.js';

/**
 * Pruebas de la importación por foto y de las salvaguardas que la rodean.
 *
 * El hilo conductor de todas ellas es el mismo: lo que devuelve el modelo de
 * visión es una *afirmación*, no un dato. Cada prueba comprueba que una
 * afirmación equivocada se detiene antes de convertirse en una clase, una
 * columna SQL o una fila del `data.sql`.
 */

function docVacio(): Y.Doc {
  const doc = new Y.Doc();
  initializeEmpty(doc, {
    name: 'Prueba',
    basePackage: 'com.ejemplo.prueba',
    artifactId: 'prueba',
  });
  return doc;
}

function diagramaVacio(): ClassDiagram {
  return readDiagram(docVacio());
}

function tabla(overrides: Partial<TablaExtraida> = {}): TablaExtraida {
  return {
    tabla: 'Empleado',
    columnas: [
      { nombre: 'id', tipo: 'Long', esClave: true },
      { nombre: 'nombre completo', tipo: 'texto', esClave: false },
      { nombre: 'salario', tipo: 'Double', esClave: false },
    ],
    filas: [
      ['1', 'Ana Pérez', '2500.50'],
      ['2', 'Luis Gómez', '1800'],
    ],
    confianza: 1,
    ilegible: [],
    ...overrides,
  };
}

describe('parseTablaExtraida', () => {
  it('acepta la forma que promete la instrucción del modelo', () => {
    const resultado = parseTablaExtraida({
      tabla: 'Empleado',
      columnas: [{ nombre: 'id', tipo: 'Long', esClave: true }],
      filas: [['1']],
      confianza: 0.9,
      ilegible: [],
    });

    expect(resultado.ok).toBe(true);
  });

  it('rechaza una tabla sin columnas en lugar de dejarla pasar vacía', () => {
    const resultado = parseTablaExtraida({ tabla: 'X', columnas: [] });
    expect(resultado.ok).toBe(false);
  });

  it('rechaza celdas que no son texto: un número suelto rompería el escapado', () => {
    const resultado = parseTablaExtraida({
      tabla: 'X',
      columnas: [{ nombre: 'id', tipo: 'Long' }],
      filas: [[1]],
    });
    expect(resultado.ok).toBe(false);
  });

  it('pone valores por defecto en lo que el modelo omite', () => {
    const resultado = parseTablaExtraida({
      tabla: 'X',
      columnas: [{ nombre: 'id', tipo: 'Long' }],
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.value.filas).toEqual([]);
    expect(resultado.value.ilegible).toEqual([]);
    expect(resultado.value.columnas[0]?.esClave).toBe(false);
  });

  it('corta una tabla desmesurada antes de que llegue al diagrama', () => {
    const filas = Array.from({ length: 501 }, () => ['x']);
    const resultado = parseTablaExtraida({
      tabla: 'X',
      columnas: [{ nombre: 'id', tipo: 'Long' }],
      filas,
    });
    expect(resultado.ok).toBe(false);
  });
});

describe('interpretarTablaExtraida', () => {
  it('convierte una tabla limpia en clase, atributos y filas', () => {
    const resultado = interpretarTablaExtraida(tabla(), diagramaVacio());

    expect(resultado.aplicable).toBe(true);
    expect(resultado.clase).toBe('Empleado');
    expect(resultado.operaciones[0]).toMatchObject({ op: 'addClass', name: 'Empleado' });

    const atributos = resultado.operaciones.filter((o) => o.op === 'addAttribute');
    expect(atributos.map((o) => (o as { name: string }).name)).toEqual([
      'id',
      'nombreCompleto',
      'salario',
    ]);
  });

  it('pone las filas en la última operación, cuando los atributos ya existen', () => {
    const resultado = interpretarTablaExtraida(tabla(), diagramaVacio());
    const ultima = resultado.operaciones.at(-1);

    expect(ultima?.op).toBe('setSeedRows');
    expect((ultima as { rows: Record<string, string>[] }).rows).toEqual([
      { id: '1', nombreCompleto: 'Ana Pérez', salario: '2500.50' },
      { id: '2', nombreCompleto: 'Luis Gómez', salario: '1800' },
    ]);
  });

  it('traduce el tipo dicho en castellano usando el catálogo', () => {
    const resultado = interpretarTablaExtraida(tabla(), diagramaVacio());
    const nombre = resultado.operaciones.find(
      (o) => o.op === 'addAttribute' && o.name === 'nombreCompleto',
    );

    expect((nombre as { type: string }).type).toBe('String');
  });

  it('degrada a String un tipo que el modelo se ha inventado, y lo avisa', () => {
    const resultado = interpretarTablaExtraida(
      tabla({
        columnas: [
          { nombre: 'id', tipo: 'Long', esClave: true },
          { nombre: 'foto', tipo: 'BLOB_GIGANTE', esClave: false },
        ],
        filas: [],
      }),
      diagramaVacio(),
    );

    expect(resultado.aplicable).toBe(true);
    const foto = resultado.operaciones.find((o) => o.op === 'addAttribute' && o.name === 'foto');
    expect((foto as { type: string }).type).toBe('String');
    expect(resultado.avisos.some((a) => a.mensaje.includes('BLOB_GIGANTE'))).toBe(true);
  });

  it('rechaza un nombre de tabla que no da un identificador Java (RNF-SEG-06)', () => {
    const resultado = interpretarTablaExtraida(tabla({ tabla: '--; DROP TABLE' }), diagramaVacio());

    expect(resultado.aplicable).toBe(false);
    expect(resultado.operaciones).toEqual([]);
    expect(resultado.avisos[0]?.severidad).toBe('error');
  });

  it('no pisa una clase que ya existe: obliga a decidir en la revisión', () => {
    const doc = docVacio();
    applyOperation(doc, { op: 'addClass', name: 'Empleado', kind: 'class' });

    const resultado = interpretarTablaExtraida(tabla(), readDiagram(doc));

    expect(resultado.aplicable).toBe(false);
    expect(resultado.avisos[0]?.mensaje).toContain('Ya hay una clase');
  });

  it('detecta dos columnas que colapsarían en el mismo atributo', () => {
    const resultado = interpretarTablaExtraida(
      tabla({
        columnas: [
          { nombre: 'Fecha alta', tipo: 'LocalDate', esClave: false },
          { nombre: 'fecha_alta', tipo: 'LocalDate', esClave: false },
        ],
        filas: [],
      }),
      diagramaVacio(),
    );

    expect(resultado.aplicable).toBe(false);
    expect(resultado.avisos.some((a) => a.mensaje.includes('fechaAlta'))).toBe(true);
  });

  it('descarta entera la fila desalineada en lugar de colocar los valores que hay', () => {
    const resultado = interpretarTablaExtraida(
      tabla({ filas: [['1', 'Ana Pérez', '2500.50'], ['2', 'Luis Gómez']] }),
      diagramaVacio(),
    );

    const semilla = resultado.operaciones.at(-1) as { rows: Record<string, string>[] };
    expect(semilla.rows).toHaveLength(1);
    expect(resultado.avisos.some((a) => a.mensaje.includes('se descarta'))).toBe(true);
  });

  it('marca clave la primera columna si el modelo no marcó ninguna, y lo dice', () => {
    const resultado = interpretarTablaExtraida(
      tabla({
        columnas: [
          { nombre: 'codigo', tipo: 'String', esClave: false },
          { nombre: 'nombre', tipo: 'String', esClave: false },
        ],
        filas: [],
      }),
      diagramaVacio(),
    );

    const codigo = resultado.operaciones.find((o) => o.op === 'addAttribute' && o.name === 'codigo');
    expect((codigo as { isIdentifier: boolean }).isIdentifier).toBe(true);
    expect(resultado.avisos.some((a) => a.mensaje.includes('se marca'))).toBe(true);
  });

  it('trata la celda vacía como ausencia de dato y no como cadena vacía', () => {
    const resultado = interpretarTablaExtraida(
      tabla({ filas: [['1', '   ', '2500.50']] }),
      diagramaVacio(),
    );

    const semilla = resultado.operaciones.at(-1) as { rows: Record<string, string>[] };
    expect(semilla.rows[0]).toEqual({ id: '1', salario: '2500.50' });
    expect(semilla.rows[0]).not.toHaveProperty('nombreCompleto');
  });

  it('traslada a avisos lo que el modelo declara ilegible', () => {
    const resultado = interpretarTablaExtraida(
      tabla({ ilegible: ['la última fila está tapada por un reflejo'] }),
      diagramaVacio(),
    );

    expect(resultado.avisos.some((a) => a.mensaje.includes('reflejo'))).toBe(true);
    // Declarar que algo no se lee no impide importar el resto: es un aviso.
    expect(resultado.aplicable).toBe(true);
  });

  it('la confianza declarada por el modelo no cambia el resultado', () => {
    const seguro = interpretarTablaExtraida(tabla({ confianza: 1 }), diagramaVacio());
    const inseguro = interpretarTablaExtraida(tabla({ confianza: 0 }), diagramaVacio());

    expect(inseguro.operaciones).toEqual(seguro.operaciones);
    expect(inseguro.aplicable).toBe(seguro.aplicable);
  });

  it('las operaciones que produce se aplican de verdad sobre el documento', () => {
    const doc = docVacio();
    const resultado = interpretarTablaExtraida(tabla(), readDiagram(doc));

    const aplicado = applyOperations(doc, resultado.operaciones);
    expect(aplicado.ok).toBe(true);

    const clase = Object.values(readDiagram(doc).classes)[0];
    expect(clase?.name).toBe('Empleado');
    expect(clase?.attributes).toHaveLength(3);
    expect(clase?.seedRows).toHaveLength(2);
    expect(clase?.seedRows[0]?.nombreCompleto).toBe('Ana Pérez');
  });
});

describe('salvaguardas de acciones destructivas', () => {
  const borrarClase: Operation = { op: 'removeClass', ref: { name: 'Empleado' } };

  it('reconoce como destructivo todo lo que quita información', () => {
    expect(isDestructiveOperation(borrarClase)).toBe(true);
    expect(
      isDestructiveOperation({
        op: 'removeSeedRow',
        classRef: { name: 'Empleado' },
        index: 1,
      }),
    ).toBe(true);
    expect(isDestructiveOperation({ op: 'addClass', name: 'X', kind: 'class' })).toBe(false);
  });

  it('enumera lo que se pierde al borrar una clase, incluidas sus filas', () => {
    const doc = docVacio();
    applyOperations(doc, interpretarTablaExtraida(tabla(), readDiagram(doc)).operaciones);

    const impacto = describeImpact(readDiagram(doc), borrarClase);

    expect(impacto.destructiva).toBe(true);
    expect(impacto.clase).toBe('Empleado');
    expect(impacto.perdidas.some((p) => p.includes('3'))).toBe(true);
    expect(impacto.perdidas.some((p) => p.includes('2'))).toBe(true);
  });

  it('avisa de las relaciones que caen en cascada al borrar una clase', () => {
    const doc = docVacio();
    applyOperations(doc, [
      { op: 'addClass', name: 'Empleado', kind: 'class' },
      { op: 'addClass', name: 'Departamento', kind: 'class' },
      {
        op: 'addRelation',
        kind: 'association',
        source: { name: 'Departamento' },
        target: { name: 'Empleado' },
        sourceMultiplicity: '1',
        targetMultiplicity: '*',
      },
    ]);

    const impacto = describeImpact(readDiagram(doc), borrarClase);
    expect(impacto.perdidas.some((p) => p.includes('Departamento'))).toBe(true);
  });

  it('no llama destructivo a sembrar filas en una clase que no tenía ninguna', () => {
    const doc = docVacio();
    applyOperations(doc, [{ op: 'addClass', name: 'Empleado', kind: 'class' }]);

    const impacto = describeImpact(readDiagram(doc), {
      op: 'setSeedRows',
      classRef: { name: 'Empleado' },
      rows: [{ id: '1' }],
    });

    expect(impacto.destructiva).toBe(false);
  });

  it('el lote entero es destructivo si lo es una sola de sus operaciones', () => {
    const doc = docVacio();
    applyOperations(doc, interpretarTablaExtraida(tabla(), readDiagram(doc)).operaciones);

    const lote = describeBatchImpact(readDiagram(doc), [
      { op: 'addClass', name: 'Otra', kind: 'class' },
      borrarClase,
    ]);

    expect(lote.destructiva).toBe(true);
    expect(lote.perdidas.length).toBeGreaterThan(0);
  });
});
