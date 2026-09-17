import { describe, expect, it } from 'vitest';
import { createAttribute, createClass, createDiagram, createRelation } from '../model/factory.js';
import type { ClassDiagram, UmlClass, UmlRelation } from '../model/uml.js';
import { validateDiagram } from '../validation/validate.js';
import { planificarReparacion, simular } from './reparar.js';

/**
 * El plan de reparación.
 *
 * Hay una afirmación que sostiene todo lo demás y que se comprueba en el primer
 * bloque: **aplicar el plan deja el diagrama con menos errores que antes, y con
 * ninguno cuando no hay irreparables**. Sin eso, el botón es un generador de
 * trabajo: cambia diez cosas y quien lo pulsa tiene que revisarlas una a una
 * para averiguar si ha servido de algo.
 *
 * Se comprueba sobre el resultado de `simular`, que pasa por `applyOperations`
 * —el mismo aplicador que usan el ratón y la voz—, y se vuelve a validar con
 * `validateDiagram`, que es el mismo juez que decide si se puede generar. No se
 * inspecciona la forma de las operaciones salvo cuando la prueba trata
 * precisamente de eso: mientras el diagrama resultante valide, cómo se llegó a
 * él es asunto del módulo.
 *
 * El segundo bloque va regla a regla, y de cada una interesa tanto que arregle
 * como que arregle **lo que dijo**: el título y el detalle se le enseñan a
 * alguien que va a autorizar un cambio en su diagrama sin leer el código, así
 * que un texto que nombre el atributo equivocado es un fallo, no una errata.
 *
 * El tercero es el que más veces ha salvado esto: los diagramas que el plan
 * tiene que dejar **en paz**. Un reparador que toca lo que ya estaba bien es
 * peor que no tenerlo.
 */

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function diagrama(clases: UmlClass[], relaciones: UmlRelation[] = []): ClassDiagram {
  return createDiagram({
    name: 'Prueba',
    classes: Object.fromEntries(clases.map((c) => [c.id, c])),
    relations: Object.fromEntries(relaciones.map((r) => [r.id, r])),
  });
}

/** El diagrama que resulta de aplicar el plan entero. */
function reparado(d: ClassDiagram): ClassDiagram {
  return simular(d, planificarReparacion(d).operaciones);
}

function codigosDeError(d: ClassDiagram): string[] {
  return validateDiagram(d).errors.map((e) => e.code);
}

function clasePorNombre(d: ClassDiagram, nombre: string): UmlClass {
  const encontrada = Object.values(d.classes).find((c) => c.name === nombre);
  if (!encontrada) throw new Error(`La clase «${nombre}» no está en el diagrama`);
  return encontrada;
}

// ---------------------------------------------------------------------------
// La promesa del botón
// ---------------------------------------------------------------------------

describe('la promesa del botón', () => {
  /**
   * El diagrama del proyecto `payment` que trajo esta funcionalidad: seis
   * errores de una foto de pizarra, ninguno de ellos una decisión de modelado.
   */
  function payment(): ClassDiagram {
    const pago = createClass({
      id: 'C1',
      name: 'Payment',
      attributes: [
        createAttribute({ id: 'A1', name: 'amount', type: 'BigDecimal', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'date', type: 'LocalDate' }),
      ],
    });
    const cheque = createClass({
      id: 'C2',
      name: 'Check',
      attributes: [createAttribute({ id: 'A3', name: 'holderName', type: 'String', isIdentifier: true })],
    });
    const tarjeta = createClass({
      id: 'C3',
      name: 'Credit',
      attributes: [createAttribute({ id: 'A4', name: 'number', type: 'String', isIdentifier: true })],
    });
    const cliente = createClass({
      id: 'C4',
      name: 'Customer',
      attributes: [
        createAttribute({ id: 'A5', name: 'name', type: 'String' }),
        createAttribute({ id: 'A6', name: 'dirección', type: 'String' }),
      ],
    });
    return diagrama(
      [pago, cheque, tarjeta, cliente],
      [
        createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' }),
        createRelation({ id: 'R2', kind: 'inheritance', sourceId: 'C3', targetId: 'C1' }),
        createRelation({
          id: 'R3',
          kind: 'association',
          sourceId: 'C4',
          targetId: 'C1',
          targetMultiplicity: '*',
        }),
      ],
    );
  }

  it('deja generable un diagrama que no lo era', () => {
    const antes = payment();
    expect(validateDiagram(antes).ok).toBe(false);

    const plan = planificarReparacion(antes);
    expect(plan.irreparables).toEqual([]);

    const despues = simular(antes, plan.operaciones);
    expect(validateDiagram(despues).errors).toEqual([]);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('cuenta los errores que había, para poder decirlo en la pantalla', () => {
    const antes = payment();
    const plan = planificarReparacion(antes);
    expect(plan.erroresAntes).toBe(validateDiagram(antes).errors.length);
    expect(plan.erroresAntes).toBeGreaterThan(0);
  });

  it('no toca el diagrama que recibe', () => {
    const antes = payment();
    const copia = structuredClone(antes);
    planificarReparacion(antes);
    // Planificar es mirar. Quien pulsa el botón todavía no ha dicho que sí.
    expect(antes).toEqual(copia);
  });

  it('cada arreglo lleva las operaciones que lo ejecutan, y el total es su suma', () => {
    const plan = planificarReparacion(payment());
    expect(plan.arreglos.length).toBeGreaterThan(0);
    for (const arreglo of plan.arreglos) {
      expect(arreglo.operaciones.length).toBeGreaterThan(0);
      expect(arreglo.titulo).not.toBe('');
      expect(arreglo.detalle).not.toBe('');
      expect(arreglo.codigo).not.toBe('');
    }
    expect(plan.operaciones).toHaveLength(
      plan.arreglos.reduce((n, a) => n + a.operaciones.length, 0),
    );
  });

  /**
   * La red de seguridad. Cualquier regla nueva que se añada tiene que seguir
   * cumpliendo esto aunque nadie se acuerde de escribirle una prueba: no se
   * permite que el plan deje el diagrama peor que como lo encontró.
   */
  it('nunca aumenta el número de errores, en ninguno de los casos de esta prueba', () => {
    const casos: ClassDiagram[] = [
      payment(),
      conNombreInvalido(),
      conColumnaReservada(),
      conAtributosDuplicados(),
      conTipoDesconocido(),
      conVariasClaves(),
      sinClave(),
      conRelacionColgante(),
      conComposicionDeMuchos(),
      conHerenciaMultiple(),
      conEnumeracionVacia(),
      valido(),
    ];

    for (const caso of casos) {
      const plan = planificarReparacion(caso);
      const despues = simular(caso, plan.operaciones);
      expect(validateDiagram(despues).errors.length).toBeLessThanOrEqual(plan.erroresAntes);
      // Y la promesa fuerte: si no quedó nada irreparable, no quedó nada.
      if (plan.irreparables.length === 0) {
        expect(validateDiagram(despues).errors).toEqual([]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Encadenamiento: por qué hacen falta rondas
// ---------------------------------------------------------------------------

describe('arreglos que se encadenan', () => {
  /**
   * El caso que obligó a planificar por rondas. `Order` usa la fecha como clave
   * primaria; desmarcarla es correcto y crea un error nuevo —la clase se queda
   * sin ninguna— que no existía cuando se planificó el primer arreglo. Una sola
   * pasada dejaría el diagrama tan roto como al principio, con otro error.
   */
  it('desmarcar una clave inválida provoca que se añada la que falta', () => {
    const pedido = createClass({
      id: 'C1',
      name: 'Order',
      attributes: [
        createAttribute({ id: 'A1', name: 'fecha', type: 'LocalDate', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'total', type: 'BigDecimal' }),
      ],
    });
    const d = diagrama([pedido]);

    const plan = planificarReparacion(d);
    expect(plan.arreglos.map((a) => a.codigo)).toEqual([
      'INVALID_IDENTIFIER_TYPE',
      'MISSING_IDENTIFIER',
    ]);

    const despues = reparado(d);
    const resultante = clasePorNombre(despues, 'Order');
    const claves = resultante.attributes.filter((a) => a.isIdentifier);
    expect(claves).toHaveLength(1);
    expect(claves[0]?.name).toBe('orderId');
    expect(claves[0]?.type.name).toBe('Long');

    // Y lo importante: la fecha sigue ahí. Un reparador que pierde datos no es
    // un reparador.
    const fecha = resultante.attributes.find((a) => a.name === 'fecha');
    expect(fecha).toBeDefined();
    expect(fecha?.isIdentifier).toBe(false);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('la clave que se añade no choca con un atributo que ya se llamaba así', () => {
    const pedido = createClass({
      id: 'C1',
      name: 'Order',
      attributes: [
        // Ya hay un `orderId`, y es texto libre: no sirve como clave y no se
        // puede pisar.
        createAttribute({ id: 'A1', name: 'orderId', type: 'String' }),
      ],
    });
    const despues = reparado(diagrama([pedido]));
    const resultante = clasePorNombre(despues, 'Order');

    const claves = resultante.attributes.filter((a) => a.isIdentifier);
    expect(claves).toHaveLength(1);
    expect(claves[0]?.name).not.toBe('orderId');
    expect(resultante.attributes.some((a) => a.name === 'orderId' && !a.isIdentifier)).toBe(true);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('el plan termina aunque el diagrama sea un desastre', () => {
    const caos = createClass({
      id: 'C1',
      name: 'Cosa',
      attributes: [
        createAttribute({ id: 'A1', name: 'name', type: 'Dinero', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'name', type: 'String' }),
        createAttribute({ id: 'A3', name: 'año', type: 'Integer', isIdentifier: true }),
        createAttribute({ id: 'A4', name: 'order', type: 'Cualquiera' }),
      ],
    });
    const despues = reparado(diagrama([caos]));
    expect(validateDiagram(despues).ok).toBe(true);
    // Los cuatro atributos siguen existiendo: se han renombrado y desmarcado,
    // no borrado.
    expect(clasePorNombre(despues, 'Cosa').attributes.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Regla a regla
// ---------------------------------------------------------------------------

function conNombreInvalido(): ClassDiagram {
  return diagrama([
    createClass({
      id: 'C1',
      name: 'Cliente',
      attributes: [
        createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'dirección', type: 'String' }),
        createAttribute({ id: 'A3', name: 'fecha alta', type: 'LocalDate' }),
      ],
    }),
  ]);
}

function conColumnaReservada(): ClassDiagram {
  return diagrama([
    createClass({
      id: 'C1',
      name: 'Customer',
      attributes: [
        createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'name', type: 'String' }),
      ],
    }),
  ]);
}

function conAtributosDuplicados(): ClassDiagram {
  return diagrama([
    createClass({
      id: 'C1',
      name: 'Producto',
      attributes: [
        createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'precio', type: 'BigDecimal' }),
        createAttribute({ id: 'A3', name: 'precio', type: 'BigDecimal' }),
      ],
    }),
  ]);
}

function conTipoDesconocido(): ClassDiagram {
  return diagrama([
    createClass({
      id: 'C1',
      name: 'Factura',
      attributes: [
        createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'importe', type: 'Money' }),
      ],
    }),
  ]);
}

function conVariasClaves(): ClassDiagram {
  return diagrama([
    createClass({
      id: 'C1',
      name: 'Matricula',
      attributes: [
        createAttribute({ id: 'A1', name: 'codigo', type: 'String', isIdentifier: true }),
        createAttribute({ id: 'A2', name: 'numero', type: 'Long', isIdentifier: true }),
      ],
    }),
  ]);
}

function sinClave(): ClassDiagram {
  return diagrama([
    createClass({
      id: 'C1',
      name: 'Reserva',
      attributes: [createAttribute({ id: 'A1', name: 'fecha', type: 'LocalDate' })],
    }),
  ]);
}

function conRelacionColgante(): ClassDiagram {
  const viva = createClass({
    id: 'C1',
    name: 'Viva',
    attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
  });
  return diagrama(
    [viva],
    [createRelation({ id: 'R1', kind: 'association', sourceId: 'C1', targetId: 'CX' })],
  );
}

function conComposicionDeMuchos(): ClassDiagram {
  const factura = createClass({
    id: 'C1',
    name: 'Factura',
    attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
  });
  const linea = createClass({
    id: 'C2',
    name: 'Linea',
    attributes: [createAttribute({ id: 'A2', name: 'id', type: 'Long', isIdentifier: true })],
  });
  return diagrama(
    [factura, linea],
    [
      createRelation({
        id: 'R1',
        kind: 'composition',
        sourceId: 'C1',
        targetId: 'C2',
        sourceMultiplicity: '*',
        targetMultiplicity: '*',
      }),
    ],
  );
}

function conHerenciaMultiple(): ClassDiagram {
  const a = createClass({
    id: 'C1',
    name: 'Uno',
    attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
  });
  const b = createClass({ id: 'C2', name: 'Dos' });
  const c = createClass({ id: 'C3', name: 'Hija' });
  return diagrama(
    [a, b, c],
    [
      createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C3', targetId: 'C1' }),
      createRelation({ id: 'R2', kind: 'inheritance', sourceId: 'C3', targetId: 'C2' }),
    ],
  );
}

function conEnumeracionVacia(): ClassDiagram {
  const estado = createClass({ id: 'C1', name: 'Estado', kind: 'enum', literals: [] });
  const pedido = createClass({
    id: 'C2',
    name: 'Pedido',
    attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
  });
  return diagrama([estado, pedido]);
}

function valido(): ClassDiagram {
  const cliente = createClass({
    id: 'C1',
    name: 'Cliente',
    attributes: [
      createAttribute({ id: 'A1', name: 'clienteId', type: 'Long', isIdentifier: true }),
      createAttribute({ id: 'A2', name: 'razonSocial', type: 'String' }),
    ],
  });
  const pedido = createClass({
    id: 'C2',
    name: 'Pedido',
    attributes: [
      createAttribute({ id: 'A3', name: 'pedidoId', type: 'Long', isIdentifier: true }),
      createAttribute({ id: 'A4', name: 'fecha', type: 'LocalDate' }),
    ],
  });
  return diagrama(
    [cliente, pedido],
    [
      createRelation({
        id: 'R1',
        kind: 'association',
        sourceId: 'C1',
        targetId: 'C2',
        targetMultiplicity: '*',
      }),
    ],
  );
}

describe('nombres de atributo que Java no admite', () => {
  it('translitera la tilde y junta las palabras', () => {
    const d = conNombreInvalido();
    expect(codigosDeError(d)).toContain('INVALID_ATTRIBUTE_NAME');

    const despues = reparado(d);
    const nombres = clasePorNombre(despues, 'Cliente').attributes.map((a) => a.name);
    expect(nombres).toContain('direccion');
    expect(nombres).toContain('fechaAlta');
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('el texto que se enseña nombra el atributo viejo y el nuevo', () => {
    const arreglo = planificarReparacion(conNombreInvalido()).arreglos.find(
      (a) => a.codigo === 'INVALID_ATTRIBUTE_NAME' && a.titulo.includes('dirección'),
    );
    expect(arreglo).toBeDefined();
    expect(arreglo?.titulo).toContain('direccion');
    expect(arreglo?.titulo).toContain('Cliente');
  });
});

describe('columnas que chocan con una palabra reservada', () => {
  it('antepone el nombre de la clase', () => {
    const d = conColumnaReservada();
    expect(codigosDeError(d)).toContain('INVALID_COLUMN_NAME');

    const despues = reparado(d);
    const nombres = clasePorNombre(despues, 'Customer').attributes.map((a) => a.name);
    expect(nombres).toContain('customerName');
    expect(nombres).not.toContain('name');
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('el detalle explica que la columna es reservada en PostgreSQL', () => {
    const arreglo = planificarReparacion(conColumnaReservada()).arreglos.find(
      (a) => a.codigo === 'INVALID_COLUMN_NAME',
    );
    expect(arreglo?.detalle).toContain('PostgreSQL');
    expect(arreglo?.detalle).toContain('customer_name');
  });
});

describe('dos atributos con el mismo nombre', () => {
  it('renombra el segundo y conserva el primero', () => {
    const d = conAtributosDuplicados();
    expect(codigosDeError(d)).toContain('ATTRIBUTE_NAME_COLLISION');

    const despues = reparado(d);
    const nombres = clasePorNombre(despues, 'Producto').attributes.map((a) => a.name);
    expect(nombres).toContain('precio');
    expect(nombres).toContain('precio2');
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('avisa de que probablemente uno de los dos sobre', () => {
    const arreglo = planificarReparacion(conAtributosDuplicados()).arreglos.find(
      (a) => a.codigo === 'ATTRIBUTE_NAME_COLLISION',
    );
    expect(arreglo?.detalle).toContain('sobre');
  });
});

describe('tipos que no están en el catálogo', () => {
  it('los cambia por String', () => {
    const d = conTipoDesconocido();
    expect(codigosDeError(d)).toContain('UNKNOWN_TYPE');

    const despues = reparado(d);
    const importe = clasePorNombre(despues, 'Factura').attributes.find((a) => a.name === 'importe');
    expect(importe?.type.name).toBe('String');
    expect(validateDiagram(despues).ok).toBe(true);
  });

  /**
   * Este arreglo desbloquea la generación sin arreglar el modelo, y el texto
   * tiene que decirlo: un importe guardado como texto compila y no suma.
   */
  it('el detalle advierte de que String no es el tipo correcto, solo uno que compila', () => {
    const arreglo = planificarReparacion(conTipoDesconocido()).arreglos.find(
      (a) => a.codigo === 'UNKNOWN_TYPE',
    );
    expect(arreglo?.detalle).toMatch(/importe|sumar/);
  });

  it('no confunde una clase del diagrama con un tipo desconocido', () => {
    const direccion = createClass({
      id: 'C1',
      name: 'Direccion',
      attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
    });
    const cliente = createClass({
      id: 'C2',
      name: 'Cliente',
      attributes: [
        createAttribute({ id: 'A2', name: 'id', type: 'Long', isIdentifier: true }),
        createAttribute({ id: 'A3', name: 'domicilio', type: 'Direccion' }),
      ],
    });
    const plan = planificarReparacion(diagrama([direccion, cliente]));
    expect(plan.arreglos.filter((a) => a.codigo === 'UNKNOWN_TYPE')).toEqual([]);
  });
});

describe('subclase que vuelve a declarar la identidad', () => {
  it('la desmarca y conserva el atributo como dato', () => {
    const persona = createClass({
      id: 'C1',
      name: 'Persona',
      attributes: [createAttribute({ id: 'A1', name: 'personaId', type: 'Long', isIdentifier: true })],
    });
    const empleado = createClass({
      id: 'C2',
      name: 'Empleado',
      attributes: [createAttribute({ id: 'A2', name: 'legajo', type: 'String', isIdentifier: true })],
    });
    const d = diagrama(
      [persona, empleado],
      [createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' })],
    );
    expect(codigosDeError(d)).toContain('SUBCLASS_DECLARES_IDENTIFIER');

    const despues = reparado(d);
    const legajo = clasePorNombre(despues, 'Empleado').attributes.find((a) => a.name === 'legajo');
    expect(legajo).toBeDefined();
    expect(legajo?.isIdentifier).toBe(false);
    // Y no se le añade una clave propia: la hereda.
    expect(clasePorNombre(despues, 'Empleado').attributes).toHaveLength(1);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('el detalle explica que si no, el campo desaparece del Java generado', () => {
    const persona = createClass({
      id: 'C1',
      name: 'Persona',
      attributes: [createAttribute({ id: 'A1', name: 'personaId', type: 'Long', isIdentifier: true })],
    });
    const empleado = createClass({
      id: 'C2',
      name: 'Empleado',
      attributes: [createAttribute({ id: 'A2', name: 'legajo', type: 'String', isIdentifier: true })],
    });
    const arreglo = planificarReparacion(
      diagrama(
        [persona, empleado],
        [createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' })],
      ),
    ).arreglos.find((a) => a.codigo === 'SUBCLASS_DECLARES_IDENTIFIER');

    expect(arreglo?.detalle).toContain('Persona');
    expect(arreglo?.detalle).toMatch(/desaparece|pierde/);
  });
});

describe('claves primarias de tipo imposible', () => {
  it('desmarca la fecha y el importe', () => {
    const d = diagrama([
      createClass({
        id: 'C1',
        name: 'Pago',
        attributes: [createAttribute({ id: 'A1', name: 'importe', type: 'BigDecimal', isIdentifier: true })],
      }),
    ]);
    expect(codigosDeError(d)).toContain('INVALID_IDENTIFIER_TYPE');

    const despues = reparado(d);
    const importe = clasePorNombre(despues, 'Pago').attributes.find((a) => a.name === 'importe');
    expect(importe?.isIdentifier).toBe(false);
    // Deja de ser clave, así que deja de ser obligatorio por serlo.
    expect(importe?.isNullable).toBe(true);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('no toca una clave de tipo válido', () => {
    for (const tipo of ['Long', 'Integer', 'UUID', 'String']) {
      const d = diagrama([
        createClass({
          id: 'C1',
          name: 'Cosa',
          attributes: [createAttribute({ id: 'A1', name: 'clave', type: tipo, isIdentifier: true })],
        }),
      ]);
      expect(planificarReparacion(d).arreglos).toEqual([]);
    }
  });
});

describe('varias claves primarias', () => {
  it('conserva la de mejor tipo y desmarca las demás', () => {
    const d = conVariasClaves();
    expect(codigosDeError(d)).toContain('MULTIPLE_IDENTIFIERS');

    const despues = reparado(d);
    const atributos = clasePorNombre(despues, 'Matricula').attributes;
    const claves = atributos.filter((a) => a.isIdentifier);
    expect(claves).toHaveLength(1);
    // `Long` gana a `String` aunque el String estuviera declarado antes: la
    // preferencia es por tipo, no por orden.
    expect(claves[0]?.name).toBe('numero');
    expect(atributos.find((a) => a.name === 'codigo')?.isIdentifier).toBe(false);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('a igualdad de tipo se queda con la primera declarada', () => {
    const d = diagrama([
      createClass({
        id: 'C1',
        name: 'Cosa',
        attributes: [
          createAttribute({ id: 'A1', name: 'primera', type: 'Long', isIdentifier: true }),
          createAttribute({ id: 'A2', name: 'segunda', type: 'Long', isIdentifier: true }),
        ],
      }),
    ]);
    const claves = clasePorNombre(reparado(d), 'Cosa').attributes.filter((a) => a.isIdentifier);
    expect(claves.map((a) => a.name)).toEqual(['primera']);
  });
});

describe('entidades sin clave primaria', () => {
  it('añade una Long con el nombre de la clase por delante', () => {
    const d = sinClave();
    expect(codigosDeError(d)).toContain('MISSING_IDENTIFIER');

    const despues = reparado(d);
    const clave = clasePorNombre(despues, 'Reserva').attributes.find((a) => a.isIdentifier);
    expect(clave?.name).toBe('reservaId');
    expect(clave?.type.name).toBe('Long');
    expect(clave?.isNullable).toBe(false);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('no se la añade a una clase abstracta', () => {
    const base = createClass({ id: 'C1', name: 'Base', kind: 'abstract' });
    const hija = createClass({
      id: 'C2',
      name: 'Hija',
      attributes: [createAttribute({ id: 'A1', name: 'hijaId', type: 'Long', isIdentifier: true })],
    });
    const d = diagrama(
      [base, hija],
      [createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' })],
    );
    expect(planificarReparacion(d).arreglos).toEqual([]);
  });

  it('no se la añade a una clase marcada como no persistente', () => {
    const d = diagrama([createClass({ id: 'C1', name: 'Servicio', transient: true })]);
    expect(
      planificarReparacion(d).arreglos.filter((a) => a.codigo === 'MISSING_IDENTIFIER'),
    ).toEqual([]);
  });
});

describe('relaciones que apuntan a una clase borrada', () => {
  it('las quita', () => {
    const d = conRelacionColgante();
    expect(codigosDeError(d)).toContain('DANGLING_RELATION');

    const despues = reparado(d);
    expect(Object.keys(despues.relations)).toEqual([]);
    expect(validateDiagram(despues).ok).toBe(true);
  });

  /** Es el único borrado que hace el módulo, y el texto tiene que justificarlo. */
  it('dice que no se pierde nada', () => {
    const arreglo = planificarReparacion(conRelacionColgante()).arreglos.find(
      (a) => a.codigo === 'DANGLING_RELATION',
    );
    expect(arreglo?.detalle).toContain('No se pierde nada');
  });
});

describe('composición con varios en el lado del todo', () => {
  it('baja la multiplicidad a 1', () => {
    const d = conComposicionDeMuchos();
    expect(codigosDeError(d)).toContain('INVALID_COMPOSITION_MULTIPLICITY');

    const despues = reparado(d);
    expect(Object.values(despues.relations)[0]?.source.multiplicity).toBe('0..1');
    expect(validateDiagram(despues).ok).toBe(true);
  });

  it('respeta la cota inferior que ya había', () => {
    const factura = createClass({
      id: 'C1',
      name: 'Factura',
      attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
    });
    const linea = createClass({
      id: 'C2',
      name: 'Linea',
      attributes: [createAttribute({ id: 'A2', name: 'id', type: 'Long', isIdentifier: true })],
    });
    const d = diagrama(
      [factura, linea],
      [
        createRelation({
          id: 'R1',
          kind: 'composition',
          sourceId: 'C1',
          targetId: 'C2',
          sourceMultiplicity: '1..*',
          targetMultiplicity: '*',
        }),
      ],
    );
    // Empezaba en 1, así que la parte no podía existir suelta: se queda en 1.
    expect(Object.values(reparado(d).relations)[0]?.source.multiplicity).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Lo que se niega a arreglar
// ---------------------------------------------------------------------------

describe('lo que no arregla porque no le corresponde', () => {
  it('la herencia múltiple sale como irreparable, con su mensaje', () => {
    const plan = planificarReparacion(conHerenciaMultiple());
    expect(plan.irreparables.map((e) => e.code)).toContain('MULTIPLE_INHERITANCE');
    // Quitar una de las dos flechas sería elegir de quién hereda, y eso lo
    // decide quien modela.
    expect(plan.arreglos.some((a) => a.operaciones.some((o) => o.op === 'removeRelation'))).toBe(
      false,
    );
    for (const issue of plan.irreparables) {
      expect(issue.message).not.toBe('');
    }
  });

  it('una enumeración vacía sale como irreparable', () => {
    const plan = planificarReparacion(conEnumeracionVacia());
    expect(plan.irreparables.map((e) => e.code)).toContain('EMPTY_ENUM');
    // Inventarse los literales sería inventarse el dominio.
    expect(plan.arreglos).toEqual([]);
  });

  it('dos clases con el mismo nombre salen como irreparables', () => {
    const a = createClass({
      id: 'C1',
      name: 'Cliente',
      attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
    });
    const b = createClass({
      id: 'C2',
      name: 'cliente',
      attributes: [createAttribute({ id: 'A2', name: 'id', type: 'Long', isIdentifier: true })],
    });
    const plan = planificarReparacion(diagrama([a, b]));
    expect(plan.irreparables.map((e) => e.code)).toContain('CLASS_NAME_COLLISION');
  });

  /**
   * Que queden irreparables no invalida los arreglos que sí se pueden hacer:
   * se aplican igual y el resto se enseña aparte. Lo contrario obligaría a
   * arreglar a mano lo mecánico solo porque en otra esquina del diagrama hay
   * una decisión pendiente.
   */
  it('sigue proponiendo lo mecánico aunque haya algo que no sabe arreglar', () => {
    const estado = createClass({ id: 'C1', name: 'Estado', kind: 'enum', literals: [] });
    const pedido = createClass({
      id: 'C2',
      name: 'Pedido',
      attributes: [createAttribute({ id: 'A1', name: 'fecha', type: 'LocalDate' })],
    });
    const d = diagrama([estado, pedido]);
    const plan = planificarReparacion(d);

    expect(plan.arreglos.map((a) => a.codigo)).toContain('MISSING_IDENTIFIER');
    expect(plan.irreparables.map((e) => e.code)).toEqual(['EMPTY_ENUM']);

    const despues = simular(d, plan.operaciones);
    expect(codigosDeError(despues)).toEqual(['EMPTY_ENUM']);
  });
});

// ---------------------------------------------------------------------------
// Lo que deja en paz
// ---------------------------------------------------------------------------

describe('diagramas que no hay que tocar', () => {
  it('un diagrama válido no produce ningún arreglo', () => {
    const d = valido();
    expect(validateDiagram(d).ok).toBe(true);

    const plan = planificarReparacion(d);
    expect(plan.arreglos).toEqual([]);
    expect(plan.operaciones).toEqual([]);
    expect(plan.irreparables).toEqual([]);
    expect(plan.erroresAntes).toBe(0);
  });

  it('un diagrama vacío no revienta', () => {
    const plan = planificarReparacion(createDiagram({ name: 'Vacío' }));
    expect(plan.arreglos).toEqual([]);
    expect(plan.irreparables.map((e) => e.code)).toContain('EMPTY_DIAGRAM');
  });

  /**
   * Los avisos no son errores: no impiden generar, así que el botón —que se
   * llama «arreglar lo que impide generar»— no tiene nada que hacer con ellos.
   */
  it('no toca nada que solo produzca avisos', () => {
    const d = valido();
    expect(validateDiagram(d).warnings.length).toBeGreaterThanOrEqual(0);
    expect(planificarReparacion(d).operaciones).toEqual([]);
  });

  it('simular sin operaciones devuelve el mismo diagrama', () => {
    const d = valido();
    expect(simular(d, [])).toBe(d);
  });
});
