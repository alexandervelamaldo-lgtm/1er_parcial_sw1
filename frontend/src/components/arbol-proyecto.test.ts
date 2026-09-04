import { describe, expect, it } from 'vitest';
import { ClassDiagramSchema, type ClassDiagram } from '@app/shared';
import {
  GRUPO_CLASES,
  GRUPO_RELACIONES,
  expandidosIniciales,
  filasDelArbol,
  moverEnArbol,
  type FilaArbol,
} from './arbol-proyecto';

/**
 * Pruebas del árbol del proyecto.
 *
 * Lo que se comprueba es lo que no se ve leyendo el código: que el orden de las
 * filas no dependa de quién creó qué, que plegar un grupo se lleve por delante a
 * sus hijos —y no solo a su flecha—, y que las flechas del teclado hagan lo que
 * hace un árbol en cualquier otro sitio. Nada de esto lo detecta el compilador:
 * un árbol que se reordena solo compila perfectamente.
 */

/*
  Igual que en `geometria-lienzo.test.ts`: se pasa por el esquema para que los
  valores por defecto sean los mismos que en la aplicación y una fixture no pueda
  quedarse desfasada del modelo sin que estas pruebas se enteren.
*/
const diagrama = (parcial: Record<string, unknown>): ClassDiagram =>
  ClassDiagramSchema.parse({ id: 'd1', name: 'Diagrama', ...parcial });

const clase = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  ...extra,
});

const asociacion = (id: string, origen: string, destino: string) => ({
  id,
  kind: 'association',
  source: { classId: origen },
  target: { classId: destino },
});

/** Un diagrama con las clases metidas a propósito en desorden alfabético. */
const tresClases = diagrama({
  classes: {
    c2: clase('c2', 'Zapato'),
    c1: clase('c1', 'Almacen'),
    c3: clase('c3', 'Pedido'),
  },
  relations: {},
});

const etiquetas = (filas: FilaArbol[]): string[] => filas.map((f) => f.etiqueta);

describe('filasDelArbol', () => {
  it('un diagrama vacío sigue teniendo sus dos grupos', () => {
    // Sin esto el panel aparecería en blanco y no habría dónde pulsar para
    // entender que el proyecto está vacío pero el árbol funciona.
    const filas = filasDelArbol(diagrama({ classes: {}, relations: {} }), expandidosIniciales());
    expect(etiquetas(filas)).toEqual(['Clases', 'Relaciones']);
    expect(filas[0]?.detalle).toBe('0');
  });

  it('ordena las clases por nombre y no por orden de creación', () => {
    // El objeto `classes` conserva el orden de inserción, que depende de quién
    // creara cada clase y en qué orden llegara por el canal colaborativo.
    const filas = filasDelArbol(tresClases, expandidosIniciales());
    expect(etiquetas(filas)).toEqual(['Clases', 'Almacen', 'Pedido', 'Zapato', 'Relaciones']);
  });

  it('el grupo plegado se lleva a sus hijos, no solo a su flecha', () => {
    const filas = filasDelArbol(tresClases, new Set([GRUPO_RELACIONES]));
    expect(etiquetas(filas)).toEqual(['Clases', 'Relaciones']);
    expect(filas[0]?.expandida).toBe(false);
  });

  it('cuenta las clases y las relaciones en el detalle del grupo', () => {
    const filas = filasDelArbol(tresClases, expandidosIniciales());
    expect(filas.find((f) => f.id === GRUPO_CLASES)?.detalle).toBe('3');
    expect(filas.find((f) => f.id === GRUPO_RELACIONES)?.detalle).toBe('0');
  });

  it('marca cada clase con la letra de su tipo', () => {
    const conTipos = diagrama({
      classes: {
        a: clase('a', 'Ana', { kind: 'class' }),
        b: clase('b', 'Beto', { kind: 'interface' }),
        c: clase('c', 'Ceci', { kind: 'abstract' }),
        d: clase('d', 'Dani', { kind: 'enum' }),
      },
      relations: {},
    });
    const marcas = filasDelArbol(conTipos, expandidosIniciales())
      .filter((f) => f.tipo === 'clase')
      .map((f) => f.marca);
    expect(marcas).toEqual(['C', 'I', 'A', 'E']);
  });

  it('una clase sin miembros no es expandible', () => {
    const filas = filasDelArbol(tresClases, expandidosIniciales());
    expect(filas.find((f) => f.id === 'c:c1')?.expandible).toBe(false);
  });

  it('despliega atributos, métodos y literales de la clase abierta', () => {
    const conMiembros = diagrama({
      classes: {
        c1: clase('c1', 'Pago', {
          attributes: [{ id: 'a1', name: 'importe', type: { name: 'Double' }, visibility: '-' }],
          methods: [{ id: 'm1', name: 'cobrar', returnType: { name: 'void' }, visibility: '+' }],
        }),
      },
      relations: {},
    });
    const filas = filasDelArbol(conMiembros, new Set([GRUPO_CLASES, 'c:c1']));
    const miembros = filas.filter((f) => f.tipo === 'miembro');
    expect(miembros).toHaveLength(2);
    expect(miembros[0]?.nivel).toBe(3);
  });

  it('un miembro selecciona su clase y no a sí mismo', () => {
    // El árbol y el lienzo comparten una sola selección, y en el lienzo no se
    // puede seleccionar un atributo suelto. Si la fila del atributo intentara
    // seleccionarse a sí misma, los dos dirían cosas distintas.
    const conMiembros = diagrama({
      classes: {
        c1: clase('c1', 'Pago', {
          attributes: [{ id: 'a1', name: 'importe', type: { name: 'Double' }, visibility: '-' }],
        }),
      },
      relations: {},
    });
    const filas = filasDelArbol(conMiembros, new Set([GRUPO_CLASES, 'c:c1']));
    const miembro = filas.find((f) => f.tipo === 'miembro');
    expect(miembro?.clase).toBe('c1');
    expect(miembro?.centrar).toEqual(['c1']);
  });

  it('una relación nombra sus dos extremos y encuadra a los dos', () => {
    const conRelacion = diagrama({
      classes: { c1: clase('c1', 'Pedido'), c2: clase('c2', 'Linea') },
      relations: { r1: asociacion('r1', 'c1', 'c2') },
    });
    const fila = filasDelArbol(conRelacion, expandidosIniciales()).find(
      (f) => f.tipo === 'relacion',
    );
    expect(fila?.etiqueta).toBe('Pedido → Linea');
    expect(fila?.centrar).toEqual(['c1', 'c2']);
    expect(fila?.detalle).toContain('sociación');
  });

  it('la herencia no anuncia cardinalidad', () => {
    // Una herencia con «uno a muchos» al lado no significa nada y confunde a
    // quien esté aprendiendo UML, que es medio curso.
    const conHerencia = diagrama({
      classes: { c1: clase('c1', 'Perro'), c2: clase('c2', 'Animal') },
      relations: {
        r1: { id: 'r1', kind: 'inheritance', source: { classId: 'c1' }, target: { classId: 'c2' } },
      },
    });
    const fila = filasDelArbol(conHerencia, expandidosIniciales()).find(
      (f) => f.tipo === 'relacion',
    );
    expect(fila?.detalle).not.toContain('·');
  });

  it('una relación a una clase que ya no existe se dice, no se deja en blanco', () => {
    // No debería poder ocurrir —al borrar una clase se borran sus relaciones—,
    // pero un documento colaborativo puede llegar de cualquier versión anterior,
    // y una fila vacía parece un fallo de pintado en vez de un dato que falta.
    const roto = diagrama({
      classes: { c1: clase('c1', 'Pedido') },
      relations: { r1: asociacion('r1', 'c1', 'fantasma') },
    });
    const fila = filasDelArbol(roto, expandidosIniciales()).find((f) => f.tipo === 'relacion');
    expect(fila?.etiqueta).toBe('Pedido → (sin clase)');
  });

  it('los identificadores de fila no chocan entre grupos', () => {
    // Son claves de React y destinos de foco: dos filas con la misma clave
    // harían que enfocar una moviera el foco a la otra.
    const mezclado = diagrama({
      classes: { x: clase('x', 'Uno'), y: clase('y', 'Dos') },
      relations: { x: asociacion('x', 'x', 'y') },
    });
    const ids = filasDelArbol(mezclado, expandidosIniciales()).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('moverEnArbol', () => {
  const filas = filasDelArbol(tresClases, expandidosIniciales());
  // ['Clases', 'Almacen', 'Pedido', 'Zapato', 'Relaciones']

  it('abajo y arriba se mueven de una en una', () => {
    expect(moverEnArbol(filas, 1, 'ArrowDown')?.indice).toBe(2);
    expect(moverEnArbol(filas, 1, 'ArrowUp')?.indice).toBe(0);
  });

  it('no se sale por ninguno de los dos extremos', () => {
    // Envolver de la última a la primera desorienta: quien pulsa abajo dos veces
    // de más espera seguir en el sitio, no haber vuelto al principio.
    expect(moverEnArbol(filas, 0, 'ArrowUp')?.indice).toBe(0);
    expect(moverEnArbol(filas, filas.length - 1, 'ArrowDown')?.indice).toBe(filas.length - 1);
  });

  it('Inicio y Fin saltan a los extremos', () => {
    expect(moverEnArbol(filas, 2, 'Home')?.indice).toBe(0);
    expect(moverEnArbol(filas, 2, 'End')?.indice).toBe(filas.length - 1);
  });

  it('la flecha derecha despliega una fila cerrada sin mover el foco', () => {
    const cerrado = filasDelArbol(tresClases, new Set([GRUPO_RELACIONES]));
    const movimiento = moverEnArbol(cerrado, 0, 'ArrowRight');
    expect(movimiento).toEqual({ indice: 0, alternar: GRUPO_CLASES });
  });

  it('la flecha derecha sobre una fila ya abierta entra en el primer hijo', () => {
    expect(moverEnArbol(filas, 0, 'ArrowRight')).toEqual({ indice: 1 });
  });

  it('la flecha izquierda pliega la fila abierta', () => {
    expect(moverEnArbol(filas, 0, 'ArrowLeft')).toEqual({ indice: 0, alternar: GRUPO_CLASES });
  });

  it('la flecha izquierda sobre un hijo sube al padre', () => {
    expect(moverEnArbol(filas, 2, 'ArrowLeft')).toEqual({ indice: 0 });
  });

  it('Entrar y espacio activan la fila', () => {
    expect(moverEnArbol(filas, 1, 'Enter')).toEqual({ indice: 1, activar: true });
    expect(moverEnArbol(filas, 1, ' ')).toEqual({ indice: 1, activar: true });
  });

  it('una tecla que el árbol no usa no se consume', () => {
    // Devolver null es lo que deja que Suprimir y Escape lleguen a los atajos del
    // editor en vez de morir dentro del árbol.
    expect(moverEnArbol(filas, 1, 'Delete')).toBeNull();
    expect(moverEnArbol(filas, 1, 'a')).toBeNull();
  });

  it('un índice que no existe no rompe nada', () => {
    expect(moverEnArbol(filas, 99, 'ArrowDown')).toBeNull();
    expect(moverEnArbol([], 0, 'ArrowDown')).toBeNull();
  });
});
