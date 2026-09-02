import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initializeEmpty, readDiagram } from '../crdt/document.js';
import { applyOperations } from '../crdt/operations.js';
import type { ClassDiagram } from '../model/uml.js';
import { isDestructiveOperation } from './operations.js';
import {
  interpretarDiagramaExtraido,
  parseDiagramaExtraido,
  type DiagramaExtraido,
} from './import-diagram.js';

/**
 * Pruebas de la lectura de un diagrama de clases fotografiado.
 *
 * El criterio es el mismo que en `import-table.test.ts` y conviene repetirlo
 * porque aquí se nota más: lo que devuelve el modelo de visión es una
 * *afirmación sobre una foto*, no un dato. La diferencia con leer una tabla es
 * que un error en una celda estropea un valor, mientras que un error en una
 * cardinalidad estropea el esquema entero de la base de datos generada.
 *
 * Por eso muchas de estas pruebas no comprueban que algo funcione, sino que algo
 * *se detenga*: un nombre hostil que no se limpia, una relación que no se
 * inventa, una fila desalineada que no se cuela bajo la columna equivocada.
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

function extraido(overrides: Partial<DiagramaExtraido> = {}): DiagramaExtraido {
  return {
    clases: [],
    relaciones: [],
    confianza: 0.9,
    ilegible: [],
    ...overrides,
  };
}

/**
 * El diagrama exacto de la imagen que trajo el usuario.
 *
 * Tres clases sin atributos y dos asociaciones con roles, una con `0..*` en un
 * extremo y otra con `0..1`. Es el caso que hay que resolver bien; el resto de
 * pruebas son variaciones sobre sus fallos posibles.
 */
function diagramaDeLaFoto(): DiagramaExtraido {
  return extraido({
    clases: [
      { nombre: 'Class A', estereotipo: 'class', atributos: [], filas: [] },
      { nombre: 'Class B', estereotipo: 'class', atributos: [], filas: [] },
      { nombre: 'Class C', estereotipo: 'class', atributos: [], filas: [] },
    ],
    relaciones: [
      {
        origen: 'Class A',
        destino: 'Class B',
        tipo: 'association',
        cardinalidadOrigen: '1',
        cardinalidadDestino: '0..*',
        nombre: 'Association A',
      },
      {
        origen: 'Class B',
        destino: 'Class C',
        tipo: 'association',
        cardinalidadOrigen: '1',
        cardinalidadDestino: '0..1',
        nombre: 'Association B',
      },
    ],
  });
}

describe('parseDiagramaExtraido', () => {
  it('acepta lo mínimo que puede devolver el modelo', () => {
    const resultado = parseDiagramaExtraido({ clases: [{ nombre: 'Cliente' }] });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    // Los valores por omisión existen para que el modelo no tenga que repetir
    // lo evidente en cada clase.
    expect(resultado.value.clases[0]?.estereotipo).toBe('class');
    expect(resultado.value.clases[0]?.atributos).toEqual([]);
    expect(resultado.value.relaciones).toEqual([]);
  });

  it('rechaza una respuesta que no es un diagrama', () => {
    expect(parseDiagramaExtraido({ tabla: 'Empleado' }).ok).toBe(false);
    expect(parseDiagramaExtraido('no soy JSON').ok).toBe(false);
    expect(parseDiagramaExtraido(null).ok).toBe(false);
  });

  it('rechaza un tipo de relación que no existe en el modelo', () => {
    const resultado = parseDiagramaExtraido({
      clases: [{ nombre: 'A' }, { nombre: 'B' }],
      relaciones: [{ origen: 'A', destino: 'B', tipo: 'depende_un_poco' }],
    });
    expect(resultado.ok).toBe(false);
  });
});

describe('interpretarDiagramaExtraido: el diagrama de la foto', () => {
  it('reconoce las tres clases y las dos asociaciones', () => {
    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), diagramaVacio());

    expect(resultado.aplicable).toBe(true);
    expect(resultado.clases).toEqual(['ClassA', 'ClassB', 'ClassC']);
    expect(resultado.resumen.relaciones).toBe(2);
    // Ninguna cardinalidad era ilegible en este caso.
    expect(resultado.resumen.cardinalidadesDudosas).toBe(0);
    expect(resultado.relaciones.every((r) => !r.dudosa)).toBe(true);
  });

  it('canoniza «0..*» a «*» para que el panel pueda mostrarla', () => {
    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), diagramaVacio());

    // El desplegable de la interfaz solo ofrece 1, 0..1, * y 1..*. Dejar «0..*»
    // tal cual daría una relación que se ve en el lienzo pero no se puede editar.
    expect(resultado.relaciones[0]?.cardinalidadDestino).toBe('*');
    // «0..1» sí es una de las cuatro, y se respeta: es información real de la
    // foto y convertirla a «1» cambiaría el esquema.
    expect(resultado.relaciones[1]?.cardinalidadDestino).toBe('0..1');
  });

  it('las operaciones se aplican de verdad sobre un documento', () => {
    // Esta es la prueba que valida las formas: si `addClass` o `addRelation` no
    // llevaran los campos que espera el esquema, aquí falla.
    const doc = docVacio();
    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), readDiagram(doc));
    const aplicado = applyOperations(doc, resultado.operaciones);

    expect(aplicado.ok).toBe(true);
    const final = readDiagram(doc);
    expect(Object.values(final.classes).map((c) => c.name).sort()).toEqual([
      'ClassA',
      'ClassB',
      'ClassC',
    ]);
    expect(Object.values(final.relations)).toHaveLength(2);
  });
});

describe('interpretarDiagramaExtraido: cardinalidades dudosas', () => {
  it('propone 1→* y lo marca cuando el modelo no pudo leerla', () => {
    const entrada = diagramaDeLaFoto();
    // El modelo declara no haber leído el extremo de destino.
    entrada.relaciones[1]!.cardinalidadDestino = '';

    const resultado = interpretarDiagramaExtraido(entrada, diagramaVacio());

    const relacion = resultado.relaciones[1]!;
    expect(relacion.dudosa).toBe(true);
    expect(relacion.cardinalidadOrigen).toBe('1');
    expect(relacion.cardinalidadDestino).toBe('*');
    expect(resultado.resumen.cardinalidadesDudosas).toBe(1);
  });

  it('el aviso dice qué extremo falló y por qué importa', () => {
    const entrada = diagramaDeLaFoto();
    entrada.relaciones[1]!.cardinalidadDestino = '';

    const resultado = interpretarDiagramaExtraido(entrada, diagramaVacio());
    const aviso = resultado.avisos.find((a) => a.mensaje.includes('cardinalidad'));

    expect(aviso).toBeDefined();
    // Nombrar el extremo concreto es la diferencia entre «mira la foto otra
    // vez» y «mira este sitio de la foto».
    expect(aviso!.mensaje).toContain('ClassC');
    // Y decir la consecuencia es lo que hace que alguien se moleste en mirar.
    expect(aviso!.mensaje).toContain('clave foránea');
  });

  it('la relación se conserva aunque la cardinalidad sea dudosa', () => {
    const entrada = diagramaDeLaFoto();
    entrada.relaciones[0]!.cardinalidadOrigen = '';
    entrada.relaciones[0]!.cardinalidadDestino = '';

    const resultado = interpretarDiagramaExtraido(entrada, diagramaVacio());

    // Descartarla sería perder en silencio una asociación que sí está dibujada:
    // peor que proponer una cardinalidad revisable.
    expect(resultado.resumen.relaciones).toBe(2);
    expect(resultado.relaciones[0]?.dudosa).toBe(true);
  });

  it('una cardinalidad ininteligible se trata como ilegible, no se cuela', () => {
    const entrada = diagramaDeLaFoto();
    entrada.relaciones[0]!.cardinalidadDestino = '??';

    const resultado = interpretarDiagramaExtraido(entrada, diagramaVacio());

    expect(resultado.relaciones[0]?.dudosa).toBe(true);
    expect(resultado.relaciones[0]?.cardinalidadDestino).toBe('*');
  });

  it('la herencia no se marca dudosa por no traer cardinalidad', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          { nombre: 'Animal', estereotipo: 'abstract', atributos: [], filas: [] },
          { nombre: 'Perro', estereotipo: 'class', atributos: [], filas: [] },
        ],
        relaciones: [
          {
            origen: 'Perro',
            destino: 'Animal',
            tipo: 'inheritance',
            cardinalidadOrigen: '',
            cardinalidadDestino: '',
            nombre: '',
          },
        ],
      }),
      diagramaVacio(),
    );

    // Una herencia no lleva multiplicidad; avisar de que «falta» sería ruido que
    // enseña a ignorar los avisos.
    expect(resultado.resumen.cardinalidadesDudosas).toBe(0);
    expect(resultado.avisos.some((a) => a.mensaje.includes('cardinalidad'))).toBe(false);
  });
});

describe('interpretarDiagramaExtraido: orden de las operaciones', () => {
  it('todas las clases van antes que cualquier relación', () => {
    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), diagramaVacio());

    const primeraRelacion = resultado.operaciones.findIndex((o) => o.op === 'addRelation');
    const ultimaClase = resultado.operaciones.map((o) => o.op).lastIndexOf('addClass');

    // Una relación entre la primera y la última clase fallaría si se emitiera
    // junto a la primera, y el lote entero se revierte.
    expect(ultimaClase).toBeLessThan(primeraRelacion);
  });

  it('las filas van al final, después de sus atributos', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          {
            nombre: 'Empleado',
            estereotipo: 'class',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: 'nombre', tipo: 'String', esClave: false },
            ],
            filas: [['1', 'Ana']],
          },
        ],
        relaciones: [],
      }),
      diagramaVacio(),
    );

    const seed = resultado.operaciones.findIndex((o) => o.op === 'setSeedRows');
    const ultimoAtributo = resultado.operaciones.map((o) => o.op).lastIndexOf('addAttribute');
    // `setSeedRows` rechaza columnas que aún no existan.
    expect(ultimoAtributo).toBeLessThan(seed);
  });
});

describe('interpretarDiagramaExtraido: los datos no se pierden', () => {
  it('una tabla fotografiada con filas sigue cargando sus filas', () => {
    // Esto es lo que hace que este lector pueda sustituir al de tablas sin
    // perder capacidad: la migración de contenido sigue existiendo.
    const doc = docVacio();
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          {
            nombre: 'Empleado',
            estereotipo: 'class',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: 'correo', tipo: 'String', esClave: false },
            ],
            filas: [
              ['1', 'ana@rrhh.com'],
              ['2', 'luis@rrhh.com'],
            ],
          },
        ],
      }),
      readDiagram(doc),
    );

    expect(resultado.resumen.filas).toBe(2);
    const aplicado = applyOperations(doc, resultado.operaciones);
    expect(aplicado.ok).toBe(true);

    const clase = Object.values(readDiagram(doc).classes).find((c) => c.name === 'Empleado');
    expect(clase?.seedRows).toHaveLength(2);
    expect(clase?.seedRows?.[0]?.correo).toBe('ana@rrhh.com');
  });

  it('descarta la fila desalineada y solo esa', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          {
            nombre: 'Empleado',
            estereotipo: 'class',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: 'correo', tipo: 'String', esClave: false },
            ],
            filas: [['1', 'ana@rrhh.com'], ['2'], ['3', 'luis@rrhh.com']],
          },
        ],
      }),
      diagramaVacio(),
    );

    // Colocar el «2» bajo una columna cualquiera daría una fila que parece
    // correcta al revisarla por encima. Se prefiere perderla y decirlo.
    expect(resultado.resumen.filas).toBe(2);
    expect(resultado.avisos.some((a) => a.mensaje.includes('se descarta'))).toBe(true);
  });
});

describe('interpretarDiagramaExtraido: seguridad y prudencia', () => {
  it('nunca propone borrar nada', () => {
    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), diagramaVacio());
    // Una foto es una sugerencia sobre lo que hay que añadir, jamás una orden de
    // quitar lo que ya está en el proyecto de otra persona.
    expect(resultado.operaciones.some(isDestructiveOperation)).toBe(false);
  });

  it('rechaza un nombre de clase hostil en vez de limpiarlo (RNF-SEG-06)', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          { nombre: "Robert'); DROP TABLE alumnos;--", estereotipo: 'class', atributos: [], filas: [] },
        ],
      }),
      diagramaVacio(),
    );

    // Quitar los caracteres peligrosos produciría una clase «RobertDropTable»
    // que nadie pidió y que oculta que la foto traía algo raro.
    expect(resultado.aplicable).toBe(false);
    expect(resultado.operaciones).toEqual([]);
  });

  it('rechaza un atributo con nombre inválido sin tocar el resto de la clase', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          {
            nombre: 'Empleado',
            estereotipo: 'class',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: '¿¿??', tipo: 'String', esClave: false },
            ],
            filas: [],
          },
        ],
      }),
      diagramaVacio(),
    );

    expect(resultado.resumen.atributos).toBe(1);
    expect(resultado.aplicable).toBe(true);
  });

  it('un tipo inventado cae a String y se avisa, no se manda al generador', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          {
            nombre: 'Empleado',
            estereotipo: 'class',
            atributos: [{ nombre: 'sueldo', tipo: 'MonedaFuerte', esClave: false }],
            filas: [],
          },
        ],
      }),
      diagramaVacio(),
    );

    const attr = resultado.operaciones.find((o) => o.op === 'addAttribute');
    expect(attr).toMatchObject({ type: 'String' });
    expect(resultado.avisos.some((a) => a.mensaje.includes('MonedaFuerte'))).toBe(true);
  });

  it('descarta que una clase herede de sí misma', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [{ nombre: 'Nodo', estereotipo: 'class', atributos: [], filas: [] }],
        relaciones: [
          {
            origen: 'Nodo',
            destino: 'Nodo',
            tipo: 'inheritance',
            cardinalidadOrigen: '',
            cardinalidadDestino: '',
            nombre: '',
          },
        ],
      }),
      diagramaVacio(),
    );

    // El generador entraría en recursión infinita al emitir el `extends`.
    expect(resultado.resumen.relaciones).toBe(0);
  });

  it('permite la autorrelación que sí es legítima', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [{ nombre: 'Empleado', estereotipo: 'class', atributos: [], filas: [] }],
        relaciones: [
          {
            origen: 'Empleado',
            destino: 'Empleado',
            tipo: 'association',
            cardinalidadOrigen: '1',
            cardinalidadDestino: '*',
            nombre: 'jefe de',
          },
        ],
      }),
      diagramaVacio(),
    );

    // «Un empleado tiene muchos subordinados» es un diagrama correcto.
    expect(resultado.resumen.relaciones).toBe(1);
  });
});

describe('interpretarDiagramaExtraido: contra un diagrama que ya tiene contenido', () => {
  it('no duplica una clase que ya existe pero conserva sus relaciones', () => {
    const doc = docVacio();
    applyOperations(doc, [{ op: 'addClass', name: 'ClassA', kind: 'class' }]);

    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), readDiagram(doc));

    // ClassA se omite…
    expect(resultado.clases).toEqual(['ClassB', 'ClassC']);
    expect(resultado.avisos.some((a) => a.mensaje.includes('ya existe'))).toBe(true);
    // …pero la asociación ClassA → ClassB sigue siendo información nueva y útil.
    expect(resultado.resumen.relaciones).toBe(2);

    expect(applyOperations(doc, resultado.operaciones).ok).toBe(true);
  });

  it('casa el extremo aunque el modelo lo escriba de otra forma', () => {
    const entrada = diagramaDeLaFoto();
    // El modelo titula el recuadro «Class A» y nombra la flecha «ClassA».
    entrada.relaciones[0]!.origen = 'ClassA';

    const resultado = interpretarDiagramaExtraido(entrada, diagramaVacio());

    expect(resultado.resumen.relaciones).toBe(2);
    expect(resultado.relaciones[0]?.origen).toBe('ClassA');
  });

  it('no importa dos veces la misma relación', () => {
    const entrada = diagramaDeLaFoto();
    entrada.relaciones.push({ ...entrada.relaciones[0]! });

    const resultado = interpretarDiagramaExtraido(entrada, diagramaVacio());
    expect(resultado.resumen.relaciones).toBe(2);
  });

  it('descarta la relación cuyo extremo no es ninguna clase leída', () => {
    const entrada = diagramaDeLaFoto();
    entrada.relaciones[0]!.destino = 'ClaseFantasma';

    const resultado = interpretarDiagramaExtraido(entrada, diagramaVacio());

    // Inventar la clase que falta sería añadir al diagrama algo que nadie dibujó.
    expect(resultado.resumen.relaciones).toBe(1);
    expect(resultado.avisos.some((a) => a.mensaje.includes('ClaseFantasma'))).toBe(true);
  });

  it('no es aplicable si la imagen no traía ninguna clase nueva', () => {
    const doc = docVacio();
    applyOperations(doc, [
      { op: 'addClass', name: 'ClassA', kind: 'class' },
      { op: 'addClass', name: 'ClassB', kind: 'class' },
      { op: 'addClass', name: 'ClassC', kind: 'class' },
    ]);

    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), readDiagram(doc));

    expect(resultado.aplicable).toBe(false);
    expect(resultado.avisos.some((a) => a.severidad === 'error')).toBe(true);
  });
});

describe('interpretarDiagramaExtraido: clave primaria', () => {
  it('marca una clave si la clase no traía ninguna', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          {
            nombre: 'Empleado',
            estereotipo: 'class',
            atributos: [
              { nombre: 'nombre', tipo: 'String', esClave: false },
              { nombre: 'correo', tipo: 'String', esClave: false },
            ],
            filas: [],
          },
        ],
      }),
      diagramaVacio(),
    );

    // Sin clave primaria el proyecto no llega a generar (RF-GEN-11), y el fallo
    // aparecería mucho después, al descargar el zip.
    const attr = resultado.operaciones.find(
      (o) => o.op === 'addAttribute' && o.name === 'nombre',
    );
    expect(attr).toMatchObject({ isIdentifier: true });
    expect(resultado.avisos.some((a) => a.mensaje.includes('clave primaria'))).toBe(true);
  });

  it('no le inventa clave primaria a una interfaz', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          {
            nombre: 'Imprimible',
            estereotipo: 'interface',
            atributos: [{ nombre: 'formato', tipo: 'String', esClave: false }],
            filas: [],
          },
        ],
      }),
      diagramaVacio(),
    );

    const attr = resultado.operaciones.find((o) => o.op === 'addAttribute');
    expect(attr).toMatchObject({ isIdentifier: false });
  });

  it('conserva el estereotipo abstracto', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [{ nombre: 'Animal', estereotipo: 'abstract', atributos: [], filas: [] }],
      }),
      diagramaVacio(),
    );

    // `abstract` es un tipo de clase, no una marca aparte: si se tradujera a
    // `class` la jerarquía generada perdería su raíz abstracta.
    expect(resultado.operaciones[0]).toMatchObject({ op: 'addClass', kind: 'abstract' });
  });
});
