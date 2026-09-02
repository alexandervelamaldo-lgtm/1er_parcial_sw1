import { describe, expect, it } from 'vitest';
import { interpretCommand } from './grammar.js';

describe('interpretCommand', () => {
  it('reconoce la creación de una clase', () => {
    const { operations } = interpretCommand('crea la clase Cliente');
    expect(operations).toEqual([{ op: 'addClass', name: 'Cliente', kind: 'class' }]);
  });

  it('distingue interfaz, enumeración y clase abstracta', () => {
    expect(interpretCommand('crea una interfaz Facturable').operations[0]).toMatchObject({
      kind: 'interface',
    });
    expect(interpretCommand('crea una enumeración EstadoPedido').operations[0]).toMatchObject({
      kind: 'enum',
    });
    expect(interpretCommand('crea una clase abstracta Persona').operations[0]).toMatchObject({
      kind: 'abstract',
    });
  });

  it('crea la clase y sus atributos en una sola orden', () => {
    // Es literalmente el ejemplo que el asistente ofrece como sugerencia en su
    // caja de texto. Antes producía una única clase llamada
    // «PedidoConElAtributoTotalDeTipoDouble»: el nombre se comía la cola.
    const { operations } = interpretCommand(
      'crea la clase Pedido con el atributo total de tipo Double',
    );
    expect(operations).toEqual([
      { op: 'addClass', name: 'Pedido', kind: 'class' },
      {
        op: 'addAttribute',
        classRef: { name: 'Pedido' },
        name: 'total',
        type: 'Double',
        visibility: '-',
        isIdentifier: false,
        isNullable: true,
        isUnique: false,
      },
    ]);
  });

  it('admite varios atributos enumerados en la misma orden', () => {
    const { operations } = interpretCommand(
      'crea la clase Cliente con los atributos nombre de tipo texto, correo de tipo texto y edad de tipo entero',
    );
    expect(operations).toHaveLength(4);
    expect(operations[0]).toMatchObject({ op: 'addClass', name: 'Cliente' });
    expect(
      operations.slice(1).map((o) => (o.op === 'addAttribute' ? [o.name, o.type] : null)),
    ).toEqual([
      ['nombre', 'String'],
      ['correo', 'String'],
      ['edad', 'Integer'],
    ]);
  });

  it('no se inventa un nombre de clase cuando no entiende la cola', () => {
    // Entender mal y crear algo plausible es peor que no entender: lo primero
    // pasa la revisión de nadie, porque parece que ha funcionado.
    const result = interpretCommand('crea la clase Pedido con lo que haga falta');
    expect(result.operations).toHaveLength(0);
    expect(result.clarification).toBeTruthy();
  });

  it('normaliza el nombre a PascalCase', () => {
    const { operations } = interpretCommand('crea la clase pedido de venta');
    expect(operations[0]).toMatchObject({ name: 'PedidoDeVenta' });
  });

  it('conserva las tildes del nombre pese a comparar sin ellas', () => {
    const { operations } = interpretCommand('crea la clase Créditos');
    expect(operations[0]).toMatchObject({ name: 'Créditos' });
  });

  it('funciona igual si se dicta sin tildes', () => {
    expect(interpretCommand('anade una enumeracion Estado').operations[0]).toMatchObject({
      kind: 'enum',
      name: 'Estado',
    });
  });

  it('traduce el tipo dicho en castellano al del catálogo', () => {
    const { operations } = interpretCommand('añade el campo correo de tipo texto a Cliente');
    expect(operations[0]).toMatchObject({
      op: 'addAttribute',
      classRef: { name: 'Cliente' },
      name: 'correo',
      type: 'String',
    });
  });

  it('entiende la herencia', () => {
    const { operations } = interpretCommand('Empleado hereda de Persona');
    expect(operations[0]).toMatchObject({
      op: 'addRelation',
      kind: 'inheritance',
      source: { name: 'Empleado' },
      target: { name: 'Persona' },
    });
  });

  it('lee la cardinalidad de «tiene muchos»', () => {
    const { operations } = interpretCommand('un Cliente tiene muchos Pedidos');
    expect(operations[0]).toMatchObject({
      op: 'addRelation',
      kind: 'association',
      sourceMultiplicity: '1',
      targetMultiplicity: '*',
    });
  });

  it('lee la cardinalidad de «tiene un»', () => {
    const { operations } = interpretCommand('un Pedido tiene una Direccion');
    expect(operations[0]).toMatchObject({ targetMultiplicity: '1' });
  });

  it('convierte el literal a mayúsculas', () => {
    const { operations } = interpretCommand('añade el literal pendiente de pago a EstadoPedido');
    expect(operations[0]).toMatchObject({ op: 'addEnumLiteral', literal: 'PENDIENTE_DE_PAGO' });
  });

  it('encadena varias órdenes separadas por punto', () => {
    const { operations } = interpretCommand('crea la clase Cliente. crea la clase Pedido');
    expect(operations).toHaveLength(2);
    expect(operations.map((o) => (o.op === 'addClass' ? o.name : ''))).toEqual([
      'Cliente',
      'Pedido',
    ]);
  });

  it('pide una aclaración en lugar de inventar cuando no entiende', () => {
    const result = interpretCommand('hazme el diagrama de una tienda entera, ya sabes cuál');
    expect(result.operations).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.clarification).toBeTruthy();
  });

  it('baja la confianza si solo entendió parte de la orden', () => {
    const result = interpretCommand('crea la clase Cliente. y luego lo que te parezca mejor');
    expect(result.operations).toHaveLength(1);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
    expect(result.clarification).toContain('lo que te parezca mejor');
  });

  it('elimina una clase cuando se le nombra como tal', () => {
    const { operations } = interpretCommand('elimina la clase Pedido');
    expect(operations).toEqual([{ op: 'removeClass', ref: { name: 'Pedido' } }]);
  });

  it('dicta un uno a muchos', () => {
    const { operations } = interpretCommand('un Cliente tiene muchos Pedidos');
    expect(operations[0]).toMatchObject({
      op: 'addRelation',
      kind: 'association',
      sourceMultiplicity: '1',
      targetMultiplicity: '*',
    });
  });

  it('dicta un muchos a muchos, que genera tabla de unión y no clave ajena', () => {
    // La diferencia con el caso de arriba no es de matiz: un muchos a muchos
    // guardado como uno a muchos produce un esquema distinto, y no hay forma de
    // notarlo hasta abrir el proyecto generado.
    const { operations } = interpretCommand('muchos Productos tienen muchas Categorías');
    expect(operations[0]).toMatchObject({
      op: 'addRelation',
      sourceMultiplicity: '*',
      targetMultiplicity: '*',
    });
  });

  it('sin cuantificador plural en el sujeto sigue siendo uno a uno', () => {
    const { operations } = interpretCommand('Pedido tiene una Factura');
    expect(operations[0]).toMatchObject({
      op: 'addRelation',
      sourceMultiplicity: '1',
      targetMultiplicity: '1',
    });
  });

  it('borra un atributo sin llevarse por delante la clase', () => {
    // El fallo que esta prueba vigila: si la regla de clase suelta se evaluase
    // antes, «elimina el campo correo de Cliente» borraría Cliente entera.
    const { operations } = interpretCommand('elimina el campo correo de Cliente');
    expect(operations).toEqual([
      { op: 'removeAttribute', classRef: { name: 'Cliente' }, attributeName: 'correo' },
    ]);
  });

  it('borra un método aunque se dicte con los paréntesis', () => {
    const { operations } = interpretCommand('elimina el método calcularTotal() de Pedido');
    expect(operations).toEqual([
      { op: 'removeMethod', classRef: { name: 'Pedido' }, methodName: 'calcularTotal' },
    ]);
  });

  it('borra una fila de datos por número', () => {
    const { operations } = interpretCommand('borra la fila 2 de Empleado');
    expect(operations).toEqual([
      { op: 'removeSeedRow', classRef: { name: 'Empleado' }, index: 2 },
    ]);
  });

  it('borra una fila de datos por ordinal, que es como se dicta', () => {
    const { operations } = interpretCommand('elimina la segunda fila de la tabla Empleado');
    expect(operations).toEqual([
      { op: 'removeSeedRow', classRef: { name: 'Empleado' }, index: 2 },
    ]);
  });

  it('entiende el ordinal dictado sin tilde', () => {
    const { operations } = interpretCommand('borra la séptima fila de Empleado');
    expect(operations[0]).toMatchObject({ op: 'removeSeedRow', index: 7 });
  });

  it('encadena una creación y un borrado unidos por «y»', () => {
    const { operations } = interpretCommand(
      'crea la clase Cliente y elimina la clase Temporal',
    );
    expect(operations.map((o) => o.op)).toEqual(['addClass', 'removeClass']);
  });

  it('la aclaración menciona también lo que sabe borrar', () => {
    const result = interpretCommand('haz algo con la base de datos');
    expect(result.clarification).toContain('eliminar');
  });

  it('nunca borra nada que no se le haya pedido borrar', () => {
    const ordenes = [
      'crea la clase Cliente',
      'añade el campo correo de tipo texto a Cliente',
      'Empleado hereda de Persona',
      'un Cliente tiene muchos Pedidos',
    ];
    for (const orden of ordenes) {
      const ops = interpretCommand(orden).operations;
      expect(ops.some((o) => o.op.startsWith('remove'))).toBe(false);
    }
  });
});
