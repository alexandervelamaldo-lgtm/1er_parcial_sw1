import { describe, expect, it } from 'vitest';
import {
  type ClassDiagram,
  type UmlModule,
  createAttribute,
  createClass,
  createDiagram,
} from '@app/shared';
import {
  errorDeNombre,
  errorDeSegmento,
  repartoDeModulos,
  rutaDeClase,
  sugerirSegmento,
} from './modulos';

const VENTAS: UmlModule = {
  id: 'M1',
  name: 'Ventas',
  packageSegment: 'ventas',
  description: '',
};
const CATALOGO: UmlModule = {
  id: 'M2',
  name: 'Catálogo',
  packageSegment: 'catalogo',
  description: '',
};

function clase(id: string, name: string, moduleId: string | null = null) {
  return createClass({
    id,
    name,
    moduleId,
    attributes: [createAttribute({ id: `${id}A`, name: 'id', type: 'Long', isIdentifier: true })],
  });
}

function diagrama(
  clases: ReturnType<typeof clase>[],
  modules: Record<string, UmlModule> = {},
): ClassDiagram {
  return createDiagram({
    id: 'D1',
    name: 'Tienda',
    meta: { basePackage: 'com.ejemplo.tienda', artifactId: 'tienda', description: '' },
    classes: Object.fromEntries(clases.map((c) => [c.id, c])),
    modules,
  });
}

describe('reparto en módulos', () => {
  it('sin módulos, todo cuelga del paquete base en una sola fila', () => {
    const filas = repartoDeModulos(diagrama([clase('C1', 'Pedido'), clase('C2', 'Cliente')]));

    expect(filas).toHaveLength(1);
    expect(filas[0]!.modulo).toBeNull();
    expect(filas[0]!.paquete).toBe('com.ejemplo.tienda');
    expect(filas[0]!.clases.map((c) => c.name)).toEqual(['Cliente', 'Pedido']);
  });

  it('cada módulo lleva su paquete completo y sus clases', () => {
    const filas = repartoDeModulos(
      diagrama([clase('C1', 'Pedido', 'M1'), clase('C2', 'Producto', 'M2')], {
        M1: VENTAS,
        M2: CATALOGO,
      }),
    );

    expect(filas.map((f) => f.paquete)).toEqual([
      'com.ejemplo.tienda.catalogo',
      'com.ejemplo.tienda.ventas',
    ]);
    expect(filas[1]!.clases.map((c) => c.name)).toEqual(['Pedido']);
  });

  it('un módulo vacío sigue apareciendo, para poder borrarlo o llenarlo', () => {
    const filas = repartoDeModulos(diagrama([clase('C1', 'Pedido')], { M1: VENTAS }));

    expect(filas).toHaveLength(2);
    expect(filas[0]!.modulo?.name).toBe('Ventas');
    expect(filas[0]!.clases).toEqual([]);
  });

  it('la fila sin módulo no sale cuando no hay nadie fuera', () => {
    const filas = repartoDeModulos(diagrama([clase('C1', 'Pedido', 'M1')], { M1: VENTAS }));

    expect(filas.every((f) => f.modulo !== null)).toBe(true);
  });

  it('una clase que apunta a un módulo borrado se cuenta como sin asignar', () => {
    // Pasa a diario: uno borra el módulo mientras otro le mete una clase, y el
    // CRDT conserva las dos operaciones. Tratarlo como error convertiría una
    // carrera corriente en un diagrama que no se puede generar.
    const filas = repartoDeModulos(diagrama([clase('C1', 'Pedido', 'M-BORRADO')]));

    expect(filas).toHaveLength(1);
    expect(filas[0]!.modulo).toBeNull();
    expect(filas[0]!.paquete).toBe('com.ejemplo.tienda');
  });
});

describe('segmento propuesto a partir del nombre', () => {
  it('junta las palabras y quita las tildes', () => {
    expect(sugerirSegmento('Recursos Humanos')).toBe('recursos_humanos');
    expect(sugerirSegmento('Catálogo')).toBe('catalogo');
    expect(sugerirSegmento('Ventas')).toBe('ventas');
  });

  it('no propone nada cuando de ahí no sale un paquete válido', () => {
    // Antes que inventar `class2` o `m2020`, que acabarían en el `package` sin
    // que nadie haya decidido llamarlo así.
    expect(sugerirSegmento('2020')).toBe('');
    expect(sugerirSegmento('class')).toBe('');
    expect(sugerirSegmento('   ')).toBe('');
  });
});

describe('validación del segmento', () => {
  it('acepta un segmento libre', () => {
    expect(errorDeSegmento('inventario', [VENTAS])).toBeNull();
  });

  it('explica que un paquete con punto no es un módulo', () => {
    expect(errorDeSegmento('com.ventas', [])).toMatch(/único tramo/);
  });

  it('rechaza el intento de salirse del paquete base', () => {
    // No se limpia el `..` para dejarlo pasar: se rechaza (RNF-SEG-06).
    expect(errorDeSegmento('../otro', [])).not.toBeNull();
    expect(errorDeSegmento('..', [])).not.toBeNull();
  });

  it('rechaza una palabra reservada de Java', () => {
    expect(errorDeSegmento('package', [])).not.toBeNull();
    expect(errorDeSegmento('int', [])).not.toBeNull();
  });

  it('rechaza mayúsculas y espacios', () => {
    expect(errorDeSegmento('Ventas', [])).not.toBeNull();
    expect(errorDeSegmento('recursos humanos', [])).not.toBeNull();
  });

  it('avisa de que el paquete ya está ocupado, nombrando al que lo ocupa', () => {
    expect(errorDeSegmento('ventas', [VENTAS])).toMatch(/«Ventas»/);
  });

  it('el módulo que se está editando no colisiona consigo mismo', () => {
    expect(errorDeSegmento('ventas', [VENTAS], VENTAS.id)).toBeNull();
  });
});

describe('validación del nombre', () => {
  it('pide un nombre', () => {
    expect(errorDeNombre('  ', [])).not.toBeNull();
  });

  it('rechaza el nombre repetido sin distinguir mayúsculas', () => {
    expect(errorDeNombre('ventas', [VENTAS])).not.toBeNull();
  });

  it('el módulo que se edita conserva su nombre', () => {
    expect(errorDeNombre('Ventas', [VENTAS], VENTAS.id)).toBeNull();
  });
});

describe('ruta del fichero que se va a generar', () => {
  it('cambia al mover la clase de módulo', () => {
    const fuera = diagrama([clase('C1', 'Pedido')]);
    const dentro = diagrama([clase('C1', 'Pedido', 'M1')], { M1: VENTAS });

    expect(rutaDeClase(fuera, fuera.classes.C1!)).toBe('com/ejemplo/tienda/domain/Pedido.java');
    expect(rutaDeClase(dentro, dentro.classes.C1!)).toBe(
      'com/ejemplo/tienda/ventas/domain/Pedido.java',
    );
  });
});
