import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { initializeEmpty, readDiagram } from '../crdt/document.js';
import { applyOperations } from '../crdt/operations.js';
import { llevaCardinalidad, type ClassDiagram } from '../model/uml.js';
import { isDestructiveOperation } from './operations.js';
import {
  interpretarDiagramaExtraido,
  parseDiagramaExtraido,
  sugerirCardinalidades,
  type ClaseExtraida,
  type DiagramaExtraido,
  type RelacionExtraida,
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
 * Una clase leída de la foto, con todo lo que no interesa a la prueba ya puesto.
 *
 * Existe por una asimetría de Zod que muerde en cuanto el esquema crece: un
 * campo con `.default([])` es opcional al *entrar* y obligatorio al *salir*, y
 * estas pruebas construyen el tipo de salida a mano. El día que se añadió
 * `metodos` aparecieron dieciséis errores de tipos idénticos, todos en pruebas
 * que no hablaban de métodos. Con la fábrica, el siguiente campo con valor por
 * defecto se añade una vez aquí y no dieciséis veces ahí abajo.
 */
function clase(parcial: Partial<ClaseExtraida> & { nombre: string }): ClaseExtraida {
  return {
    estereotipo: 'class',
    atributos: [],
    metodos: [],
    filas: [],
    ...parcial,
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
      clase({ nombre: 'Class A' }),
      clase({ nombre: 'Class B' }),
      clase({ nombre: 'Class C' }),
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
          clase({ nombre: 'Animal', estereotipo: 'abstract' }),
          clase({ nombre: 'Perro' }),
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
          clase({
            nombre: 'Empleado',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: 'nombre', tipo: 'String', esClave: false },
            ],
            filas: [['1', 'Ana']],
          }),
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
          clase({
            nombre: 'Empleado',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: 'correo', tipo: 'String', esClave: false },
            ],
            filas: [
              ['1', 'ana@rrhh.com'],
              ['2', 'luis@rrhh.com'],
            ],
          }),
        ],
      }),
      readDiagram(doc),
    );

    expect(resultado.resumen.filas).toBe(2);
    const aplicado = applyOperations(doc, resultado.operaciones);
    expect(aplicado.ok).toBe(true);

    const empleado = Object.values(readDiagram(doc).classes).find((c) => c.name === 'Empleado');
    expect(empleado?.seedRows).toHaveLength(2);
    expect(empleado?.seedRows?.[0]?.correo).toBe('ana@rrhh.com');
  });

  it('descarta la fila desalineada y solo esa', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          clase({
            nombre: 'Empleado',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: 'correo', tipo: 'String', esClave: false },
            ],
            filas: [['1', 'ana@rrhh.com'], ['2'], ['3', 'luis@rrhh.com']],
          }),
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
          clase({ nombre: "Robert'); DROP TABLE alumnos;--" }),
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
          clase({
            nombre: 'Empleado',
            atributos: [
              { nombre: 'id', tipo: 'Long', esClave: true },
              { nombre: '¿¿??', tipo: 'String', esClave: false },
            ],
            filas: [],
          }),
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
          clase({
            nombre: 'Empleado',
            atributos: [{ nombre: 'sueldo', tipo: 'MonedaFuerte', esClave: false }],
            filas: [],
          }),
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
        clases: [clase({ nombre: 'Nodo' })],
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
        clases: [clase({ nombre: 'Empleado' })],
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
          clase({
            nombre: 'Empleado',
            atributos: [
              { nombre: 'nombre', tipo: 'String', esClave: false },
              { nombre: 'correo', tipo: 'String', esClave: false },
            ],
            filas: [],
          }),
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
          clase({
            nombre: 'Imprimible',
            estereotipo: 'interface',
            atributos: [{ nombre: 'formato', tipo: 'String', esClave: false }],
            filas: [],
          }),
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
        clases: [clase({ nombre: 'Animal', estereotipo: 'abstract' })],
      }),
      diagramaVacio(),
    );

    // `abstract` es un tipo de clase, no una marca aparte: si se tradujera a
    // `class` la jerarquía generada perdería su raíz abstracta.
    expect(resultado.operaciones[0]).toMatchObject({ op: 'addClass', kind: 'abstract' });
  });
});

/**
 * El tercer compartimento del recuadro.
 *
 * Un recuadro UML tiene tres: nombre, atributos y operaciones. Durante un tiempo
 * este lector solo preguntó por dos, y el resultado fue de los que no se
 * denuncian solos: la importación decía «7 clases · 8 relaciones», todo verde, y
 * los nueve métodos dibujados en la foto —«+deposit()», «+withdraw()»,
 * «+verifyPassword()»— no aparecían por ninguna parte. Nadie echa de menos lo
 * que nunca vio. Estas pruebas existen para que el compartimento de operaciones
 * no vuelva a desaparecer en silencio.
 */
describe('interpretarDiagramaExtraido: métodos', () => {
  it('emite los métodos de la foto como addMethod', () => {
    const doc = docVacio();
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          clase({
            nombre: 'Account',
            atributos: [{ nombre: 'id', tipo: 'Long', esClave: true }],
            metodos: [
              {
                nombre: 'deposit',
                tipoRetorno: 'Boolean',
                visibilidad: '+',
                // «BigDecimal» es como se escribe en una pizarra y como lo lee el
                // modelo; el nombre canónico del modelo de datos es «Decimal».
                parametros: [{ nombre: 'amount', tipo: 'BigDecimal' }],
              },
              { nombre: 'withdraw', tipoRetorno: '', visibilidad: '-', parametros: [] },
            ],
          }),
        ],
      }),
      readDiagram(doc),
    );

    expect(resultado.resumen.metodos).toBe(2);
    expect(resultado.operaciones).toContainEqual({
      op: 'addMethod',
      classRef: { name: 'Account' },
      name: 'deposit',
      returnType: 'Boolean',
      parameters: [{ name: 'amount', type: 'Decimal' }],
      visibility: '+',
    });

    // Sin tipo escrito es `void`, y `void` en el modelo es `null`. Inventarle un
    // retorno cambiaría la firma del método generado.
    expect(resultado.operaciones).toContainEqual({
      op: 'addMethod',
      classRef: { name: 'Account' },
      name: 'withdraw',
      returnType: null,
      parameters: [],
      visibility: '-',
    });

    // Y que de verdad se puedan aplicar, no solo que tengan buena pinta.
    expect(applyOperations(doc, resultado.operaciones).ok).toBe(true);
    const account = Object.values(readDiagram(doc).classes).find((c) => c.name === 'Account');
    expect(account?.methods.map((m) => m.name).sort()).toEqual(['deposit', 'withdraw']);
  });

  it('quita los paréntesis que vengan pegados al nombre', () => {
    // El modelo de visión lee la firma tal como está escrita en la pizarra, y a
    // veces devuelve «deposit()» entero. Un paréntesis en el nombre no es un
    // identificador Java válido y se perdería el método por un detalle de forma.
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          clase({
            nombre: 'Cuenta',
            metodos: [
              { nombre: 'deposit(amount)', tipoRetorno: '', visibilidad: '+', parametros: [] },
            ],
          }),
        ],
      }),
      diagramaVacio(),
    );

    expect(resultado.operaciones).toContainEqual(
      expect.objectContaining({ op: 'addMethod', name: 'deposit' }),
    );
  });

  it('rechaza un nombre de método hostil en vez de limpiarlo (RNF-SEG-06)', () => {
    // El nombre acaba escrito en un fichero .java generado. Vale el mismo
    // criterio que para las clases: se descarta y se dice, no se «arregla».
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          clase({
            nombre: 'Cuenta',
            atributos: [{ nombre: 'id', tipo: 'Long', esClave: true }],
            metodos: [
              { nombre: '¿¿??', tipoRetorno: '', visibilidad: '+', parametros: [] },
              { nombre: 'saldo', tipoRetorno: '', visibilidad: '+', parametros: [] },
            ],
          }),
        ],
      }),
      diagramaVacio(),
    );

    expect(resultado.resumen.metodos).toBe(1);
    expect(resultado.avisos.some((a) => a.mensaje.includes('¿¿??'))).toBe(true);
    // La clase sobrevive: un método ilegible no invalida el recuadro entero.
    expect(resultado.aplicable).toBe(true);
  });

  it('no se inventa métodos cuando el recuadro no tenía tercer compartimento', () => {
    const resultado = interpretarDiagramaExtraido(diagramaDeLaFoto(), diagramaVacio());

    expect(resultado.resumen.metodos).toBe(0);
    expect(resultado.operaciones.some((o) => o.op === 'addMethod')).toBe(false);
  });
});

/**
 * Dos clases unidas por más de una línea.
 *
 * Un banco tiene «Customer —Has→ Account» y «Customer —Owns→ Account», y son dos
 * relaciones distintas con significados distintos. El modelo siempre lo admitió
 * —`relations` va por id— y el lienzo también —`desviosPorPar` las abre en
 * abanico para que no se pisen—. El único que las juntaba era este lector, y lo
 * hacía con un `continue` mudo: la segunda desaparecía sin aviso, que es la
 * peor forma de perder algo, porque quien revisa mira lo que hay y no lo que
 * falta.
 */
describe('interpretarDiagramaExtraido: varias relaciones entre el mismo par', () => {
  it('conserva dos relaciones distintas entre las mismas dos clases', () => {
    const doc = docVacio();
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [clase({ nombre: 'Customer' }), clase({ nombre: 'Account' })],
        relaciones: [
          {
            origen: 'Customer',
            destino: 'Account',
            tipo: 'association',
            cardinalidadOrigen: '1',
            cardinalidadDestino: '0..*',
            nombre: 'Has',
          },
          {
            origen: 'Customer',
            destino: 'Account',
            tipo: 'association',
            cardinalidadOrigen: '1',
            cardinalidadDestino: '0..*',
            nombre: 'Owns',
          },
        ],
      }),
      readDiagram(doc),
    );

    expect(resultado.resumen.relaciones).toBe(2);
    expect(applyOperations(doc, resultado.operaciones).ok).toBe(true);
    expect(Object.values(readDiagram(doc).relations)).toHaveLength(2);
  });

  it('el rótulo de la línea llega hasta la operación', () => {
    // «Has», «Account Transaction», «Savings-Checking»: el nombre estaba escrito
    // sobre la línea en la foto, se leía, y se tiraba a la basura al construir la
    // operación. Es además lo que distingue una relación de la otra.
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [clase({ nombre: 'Customer' }), clase({ nombre: 'Account' })],
        relaciones: [
          {
            origen: 'Customer',
            destino: 'Account',
            tipo: 'association',
            cardinalidadOrigen: '1',
            cardinalidadDestino: '0..*',
            nombre: 'Has',
          },
        ],
      }),
      diagramaVacio(),
    );

    expect(resultado.operaciones).toContainEqual(
      expect.objectContaining({ op: 'addRelation', name: 'Has' }),
    );
  });

  it('sigue quitando la relación repetida de verdad, y lo dice', () => {
    // Que se admitan varias no significa que se admita la misma dos veces: el
    // modelo de visión repite líneas cuando la foto está torcida. El criterio es
    // el nombre, porque es lo único que las distingue en el dibujo.
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [clase({ nombre: 'Customer' }), clase({ nombre: 'Account' })],
        relaciones: [
          {
            origen: 'Customer',
            destino: 'Account',
            tipo: 'association',
            cardinalidadOrigen: '1',
            cardinalidadDestino: '0..*',
            nombre: 'Has',
          },
          {
            origen: 'Customer',
            destino: 'Account',
            tipo: 'association',
            cardinalidadOrigen: '1',
            cardinalidadDestino: '0..*',
            nombre: 'Has',
          },
        ],
      }),
      diagramaVacio(),
    );

    expect(resultado.resumen.relaciones).toBe(1);
    expect(resultado.avisos.some((a) => a.mensaje.includes('repite la relación'))).toBe(true);
  });
});

/** Una relación leída de la foto, con lo que no interesa a la prueba ya puesto. */
function relacion(parcial: Partial<RelacionExtraida> = {}): RelacionExtraida {
  return {
    origen: 'Cliente',
    destino: 'Cuenta',
    tipo: 'association',
    cardinalidadOrigen: '',
    cardinalidadDestino: '',
    nombre: '',
    ...parcial,
  };
}

describe('llevaCardinalidad', () => {
  it('la herencia y la realización no llevan cardinalidad', () => {
    expect(llevaCardinalidad('inheritance')).toBe(false);
    expect(llevaCardinalidad('realization')).toBe(false);
  });

  it('las demás sí', () => {
    expect(llevaCardinalidad('association')).toBe(true);
    expect(llevaCardinalidad('aggregation')).toBe(true);
    expect(llevaCardinalidad('composition')).toBe(true);
    expect(llevaCardinalidad('dependency')).toBe(true);
  });

  /**
   * La prueba que corresponde a la captura del usuario: dos herencias hacia la
   * misma clase padre, ninguna con cardinalidad, y ni un solo aviso. Estaba
   * pasando en el servidor y fallando en la pantalla, así que aquí se fija el
   * comportamiento correcto para que la pantalla no vuelva a divergir.
   */
  it('una herencia sin cardinalidad no es dudosa ni genera aviso', () => {
    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [clase({ nombre: 'User' }), clase({ nombre: 'Staff' }), clase({ nombre: 'Student' })],
        relaciones: [
          relacion({ origen: 'Staff', destino: 'User', tipo: 'inheritance' }),
          relacion({ origen: 'Student', destino: 'User', tipo: 'inheritance' }),
        ],
      }),
      diagramaVacio(),
    );

    expect(resultado.resumen.relaciones).toBe(2);
    expect(resultado.resumen.cardinalidadesDudosas).toBe(0);
    expect(resultado.avisos.filter((a) => a.mensaje.includes('cardinalidad'))).toEqual([]);
  });
});

describe('sugerirCardinalidades', () => {
  it('rellena los dos extremos cuando no se leyó ninguno', () => {
    expect(sugerirCardinalidades([relacion()])).toEqual([
      { indice: 0, cardinalidadOrigen: '1', cardinalidadDestino: '*' },
    ]);
  });

  /**
   * Lo importante de esta: rellena *el hueco*, no la relación. Si sustituyera
   * también el `0..1` leído en la pizarra dejaría de ser una ayuda y sería una
   * fuente de errores imposible de auditar, porque nadie distingue después qué
   * puso el modelo y qué puso el botón.
   */
  it('no toca el extremo que sí se leyó', () => {
    expect(sugerirCardinalidades([relacion({ cardinalidadOrigen: '0..1' })])).toEqual([
      { indice: 0, cardinalidadDestino: '*' },
    ]);
    expect(sugerirCardinalidades([relacion({ cardinalidadDestino: '1..5' })])).toEqual([
      { indice: 0, cardinalidadOrigen: '1' },
    ]);
  });

  it('no propone nada cuando la relación ya está completa', () => {
    expect(
      sugerirCardinalidades([relacion({ cardinalidadOrigen: '1', cardinalidadDestino: '*' })]),
    ).toEqual([]);
  });

  it('se salta la herencia y la realización', () => {
    expect(
      sugerirCardinalidades([
        relacion({ tipo: 'inheritance' }),
        relacion({ tipo: 'realization' }),
      ]),
    ).toEqual([]);
  });

  it('cuenta un valor ilegible como hueco, no como valor', () => {
    // «muchos» no es una multiplicidad; `canonizarCardinalidad` lo rechaza y por
    // tanto es un hueco. Si esto se colase como leído, el generador emitiría el
    // esquema equivocado sin que nadie hubiera visto un aviso.
    expect(sugerirCardinalidades([relacion({ cardinalidadOrigen: 'muchos' })])).toEqual([
      { indice: 0, cardinalidadOrigen: '1', cardinalidadDestino: '*' },
    ]);
  });

  it('devuelve el índice de la relación en la lista original, no el de las que rellena', () => {
    // Con la herencia en medio, los índices de entrada y de salida ya no
    // coinciden. Si aquí se devolviera un contador propio, el botón escribiría
    // la cardinalidad en la fila de al lado.
    const sugerencias = sugerirCardinalidades([
      relacion({ cardinalidadOrigen: '1', cardinalidadDestino: '1' }),
      relacion({ tipo: 'inheritance' }),
      relacion({ origen: 'Cuenta', destino: 'Movimiento' }),
    ]);
    expect(sugerencias).toEqual([{ indice: 2, cardinalidadOrigen: '1', cardinalidadDestino: '*' }]);
  });

  it('sobre una lista vacía no propone nada', () => {
    expect(sugerirCardinalidades([])).toEqual([]);
  });

  /**
   * La sugerencia tiene que dejar el diagrama listo para importar: si lo que
   * propone no sobreviviera a `interpretarDiagramaExtraido`, el botón sería un
   * adorno. Se comprueba de punta a punta.
   */
  it('lo que propone deja el diagrama sin extremos dudosos', () => {
    const relaciones = [relacion(), relacion({ origen: 'Cuenta', destino: 'Movimiento' })];
    const sugerencias = sugerirCardinalidades(relaciones);
    const rellenas: RelacionExtraida[] = relaciones.map((r, i) => {
      const s = sugerencias.find((x) => x.indice === i);
      if (!s) return r;
      const { indice: _, ...valores } = s;
      return { ...r, ...valores };
    });

    const resultado = interpretarDiagramaExtraido(
      extraido({
        clases: [
          clase({ nombre: 'Cliente' }),
          clase({ nombre: 'Cuenta' }),
          clase({ nombre: 'Movimiento' }),
        ],
        relaciones: rellenas,
      }),
      diagramaVacio(),
    );

    expect(resultado.resumen.cardinalidadesDudosas).toBe(0);
    expect(resultado.resumen.relaciones).toBe(2);
  });
});
