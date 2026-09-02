import { describe, expect, it } from 'vitest';
import {
  createAttribute,
  createClass,
  createDiagram,
  createMethod,
  createRelation,
  withClass,
  withRelation,
} from '../model/factory.js';
import type { ClassDiagram } from '../model/uml.js';
import type { Operation } from '../ops/operations.js';
import { diagramaAXmi } from './export.js';
import { leerXmi } from './import.js';
import { attr, descendientes, escaparXml, parseXml } from './xml.js';

const vacio = (): ClassDiagram => createDiagram({ name: 'Proyecto' });

/** Diagrama de referencia: cubre las formas que el exportador tiene que emitir. */
function diagramaCompleto(): ClassDiagram {
  const cliente = createClass({
    id: 'CLIENTE',
    name: 'Cliente',
    position: { x: 40, y: 80 },
    attributes: [
      createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true }),
      createAttribute({ id: 'A2', name: 'nombre', type: 'String', isNullable: false }),
      createAttribute({ id: 'A3', name: 'correo', type: 'String', isUnique: true }),
    ],
    seedRows: [{ nombre: 'Ana', correo: 'ana@rrhh.com' }],
  });
  const pedido = createClass({
    id: 'PEDIDO',
    name: 'Pedido',
    attributes: [
      createAttribute({ id: 'B1', name: 'id', type: 'Long', isIdentifier: true }),
      createAttribute({ id: 'B2', name: 'total', type: 'Decimal' }),
    ],
    methods: [
      createMethod({
        id: 'M1',
        name: 'calcularTotal',
        returnType: { name: 'Decimal', collection: false },
        parameters: [{ name: 'descuento', type: { name: 'Double', collection: false } }],
      }),
    ],
  });
  const linea = createClass({ id: 'LINEA', name: 'LineaPedido' });
  const estado = createClass({
    id: 'ESTADO',
    name: 'EstadoPedido',
    kind: 'enum',
    literals: ['PENDIENTE', 'PAGADO'],
  });
  const persona = createClass({ id: 'PERSONA', name: 'Persona', kind: 'abstract' });

  let d = vacio();
  for (const c of [cliente, pedido, linea, estado, persona]) d = withClass(d, c);

  d = withRelation(
    d,
    createRelation({
      id: 'R1',
      kind: 'association',
      sourceId: 'CLIENTE',
      targetId: 'PEDIDO',
      sourceMultiplicity: '1',
      targetMultiplicity: '*',
    }),
  );
  d = withRelation(
    d,
    createRelation({
      id: 'R2',
      kind: 'composition',
      sourceId: 'PEDIDO',
      targetId: 'LINEA',
      sourceMultiplicity: '1',
      targetMultiplicity: '*',
    }),
  );
  d = withRelation(
    d,
    createRelation({ id: 'R3', kind: 'inheritance', sourceId: 'CLIENTE', targetId: 'PERSONA' }),
  );
  return d;
}

/** Aplica las operaciones de una importación sobre un diagrama en memoria. */
function resumirOperaciones(operaciones: Operation[]): {
  clases: string[];
  atributos: Record<string, string[]>;
  relaciones: string[];
} {
  const clases: string[] = [];
  const atributos: Record<string, string[]> = {};
  const relaciones: string[] = [];
  for (const op of operaciones) {
    if (op.op === 'addClass') {
      clases.push(`${op.name}:${op.kind}`);
      atributos[op.name] = [];
    } else if (op.op === 'addAttribute') {
      const clase = 'name' in op.classRef ? op.classRef.name : '?';
      (atributos[clase as string] ??= []).push(`${op.name}:${op.type}`);
    } else if (op.op === 'addRelation') {
      const s = 'name' in op.source ? op.source.name : '?';
      const t = 'name' in op.target ? op.target.name : '?';
      relaciones.push(`${op.kind} ${s}[${op.sourceMultiplicity}]->${t}[${op.targetMultiplicity}]`);
    }
  }
  return { clases, atributos, relaciones };
}

/** «Clase.metodo(param:Tipo)» de cada addMethod, para comparar de un vistazo. */
function metodosDe(operaciones: Operation[]): string[] {
  const salida: string[] = [];
  for (const op of operaciones) {
    if (op.op !== 'addMethod') continue;
    const clase = 'name' in op.classRef ? op.classRef.name : '?';
    const parametros = op.parameters.map((p) => `${p.name}:${p.type}`).join(', ');
    salida.push(`${clase}.${op.name}(${parametros})`);
  }
  return salida;
}

// ---------------------------------------------------------------------------

describe('lector XML', () => {
  it('lee elementos, atributos y anidamiento', () => {
    const r = parseXml('<a x="1"><b y="2"/><b y="3"/></a>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.name).toBe('a');
    expect(r.root.attributes['x']).toBe('1');
    expect(r.root.children.map((c) => c.attributes['y'])).toEqual(['2', '3']);
  });

  it('separa el prefijo del espacio de nombres del nombre local', () => {
    const r = parseXml('<uml:Model xmi:id="7"/>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.prefix).toBe('uml');
    expect(r.root.name).toBe('Model');
    expect(attr(r.root, 'xmi:id')).toBe('7');
  });

  it('traduce las entidades estándar y las numéricas', () => {
    const r = parseXml('<a t="&lt;b&gt; &amp; &#65; &#x42;"/>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.attributes['t']).toBe('<b> & A B');
  });

  it('no resuelve entidades externas: el DOCTYPE se ignora entero (XXE)', () => {
    // Si esto dejara de cumplirse, un fichero XMI recibido de un compañero
    // podría leer ficheros del disco de quien lo importa. La entidad se queda
    // literal, que es visible y no ejecuta nada.
    const r = parseXml(
      '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><a t="&xxe;">&xxe;</a>',
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.attributes['t']).toBe('&xxe;');
    expect(r.root.text).toBe('&xxe;');
  });

  it('acepta comentarios, declaración y CDATA', () => {
    const r = parseXml('<?xml version="1.0"?><!-- hola --><a><![CDATA[<crudo>]]></a>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.text).toBe('<crudo>');
  });

  it('rechaza etiquetas mal emparejadas en vez de adivinar', () => {
    const r = parseXml('<a><b></a></b>');
    expect(r.ok).toBe(false);
  });

  it('devuelve los descendientes en orden de documento', () => {
    const r = parseXml('<a><x n="1"/><y><x n="2"/></y><x n="3"/></a>');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(descendientes(r.root, 'x').map((n) => n.attributes['n'])).toEqual(['1', '2', '3']);
  });

  it('escapa lo que hay que escapar', () => {
    expect(escaparXml('a & b < c "d" \'e\'')).toBe('a &amp; b &lt; c &quot;d&quot; &apos;e&apos;');
  });
});

describe('exportación a XMI', () => {
  it('produce un documento bien formado con la raíz xmi:XMI', () => {
    const xmi = diagramaAXmi(diagramaCompleto());
    expect(xmi.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const r = parseXml(xmi);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.root.prefix).toBe('xmi');
    expect(r.root.name).toBe('XMI');
  });

  it('usa el tipo UML que corresponde a cada clase', () => {
    const r = parseXml(diagramaAXmi(diagramaCompleto()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const porNombre = new Map(
      descendientes(r.root, 'packagedElement').map((n) => [attr(n, 'name'), n]),
    );
    expect(attr(porNombre.get('Cliente')!, 'xmi:type')).toBe('uml:Class');
    expect(attr(porNombre.get('EstadoPedido')!, 'xmi:type')).toBe('uml:Enumeration');
    // Una clase abstracta no es un tipo aparte en UML: es uml:Class con marca.
    expect(attr(porNombre.get('Persona')!, 'xmi:type')).toBe('uml:Class');
    expect(attr(porNombre.get('Persona')!, 'isAbstract')).toBe('true');
  });

  it('ningún xmi:id empieza por dígito', () => {
    // Los ULID empiezan por dígito la mitad de las veces y los identificadores
    // XML no lo admiten; sin el prefijo, media exportación sería inválida y las
    // herramientas la rechazarían sin explicar por qué.
    const r = parseXml(diagramaAXmi(diagramaCompleto()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = descendientes(r.root, ...['packagedElement', 'ownedAttribute', 'ownedEnd'])
      .map((n) => attr(n, 'xmi:id'))
      .filter((v): v is string => v !== undefined);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => /^[A-Za-z_]/.test(id))).toBe(true);
  });

  it('escribe la multiplicidad como lowerValue y upperValue', () => {
    const r = parseXml(diagramaAXmi(diagramaCompleto()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const extremos = descendientes(r.root, 'ownedEnd');
    const altos = extremos.map((e) => attr(descendientes(e, 'upperValue')[0]!, 'value'));
    expect(altos).toContain('*');
    expect(altos).toContain('1');
  });

  it('escapa los nombres hostiles en lugar de romper el documento', () => {
    // Un nombre así no pasa la validación al generar, pero sí puede estar en el
    // diagrama mientras se edita, y exportarlo no debe producir XML inválido.
    const d = withClass(vacio(), createClass({ id: 'X', name: 'A<b>&"c"' }));
    const r = parseXml(diagramaAXmi(d));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Por tipo y no por posición: el primer `packagedElement` es el paquete que
    // envuelve al diagrama, no la clase.
    const clase = descendientes(r.root, 'packagedElement').find(
      (n) => attr(n, 'xmi:type') === 'uml:Class',
    );
    expect(clase).toBeDefined();
    expect(attr(clase!, 'name')).toBe('A<b>&"c"');
  });

  it('guarda en xmi:Extension lo que UML no sabe guardar', () => {
    const r = parseXml(diagramaAXmi(diagramaCompleto()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const extension = descendientes(r.root, 'Extension')[0];
    expect(extension).toBeDefined();
    expect(attr(extension!, 'extender')).toBe('uml-colaborativo');
    expect(descendientes(extension!, 'celda').map((c) => attr(c, 'valor'))).toContain(
      'ana@rrhh.com',
    );
  });
});

describe('importación de XMI', () => {
  it('rechaza un fichero que no es XML', () => {
    const r = leerXmi('esto no es xml', vacio());
    expect(r.aplicable).toBe(false);
    expect(r.avisos[0]?.mensaje).toContain('no es XML válido');
  });

  it('lo dice claramente cuando el XMI no trae clases', () => {
    const r = leerXmi('<xmi:XMI><uml:Model name="v"/></xmi:XMI>', vacio());
    expect(r.aplicable).toBe(false);
    expect(r.avisos[0]?.mensaje).toContain('ninguna clase');
  });

  it('no escribe nada: solo devuelve operaciones', () => {
    // La garantía que sostiene toda la pantalla de revisión.
    const diagrama = vacio();
    const antes = JSON.stringify(diagrama);
    leerXmi(diagramaAXmi(diagramaCompleto()), diagrama);
    expect(JSON.stringify(diagrama)).toBe(antes);
  });

  it('da la vuelta completa: exportar e importar conserva el diagrama', () => {
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    expect(r.aplicable).toBe(true);

    const { clases, atributos, relaciones } = resumirOperaciones(r.operaciones);
    expect(clases).toEqual([
      'Cliente:class',
      'Pedido:class',
      'LineaPedido:class',
      'EstadoPedido:enum',
      'Persona:abstract',
    ]);
    expect(atributos['Cliente']).toEqual(['id:Long', 'nombre:String', 'correo:String']);
    expect(atributos['Pedido']).toEqual(['id:Long', 'total:Decimal']);
    expect(relaciones).toEqual(
      expect.arrayContaining([
        'inheritance Cliente[1]->Persona[1]',
        'association Cliente[1]->Pedido[*]',
        'composition Pedido[1]->LineaPedido[*]',
      ]),
    );
  });

  it('conserva la clave primaria, que el UML estándar no sabe expresar', () => {
    // Sin esto la entidad importada no tendría @Id y el proyecto generado no
    // compilaría, con un error que aparece mucho después de la importación.
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    const clave = r.operaciones.find(
      (o) => o.op === 'addAttribute' && o.name === 'id' && o.isIdentifier,
    );
    expect(clave).toBeDefined();
  });

  it('conserva las filas de datos de ejemplo', () => {
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    const filas = r.operaciones.find((o) => o.op === 'setSeedRows');
    expect(filas).toMatchObject({
      op: 'setSeedRows',
      rows: [{ nombre: 'Ana', correo: 'ana@rrhh.com' }],
    });
  });

  it('conserva los literales de la enumeración', () => {
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    const literales = r.operaciones
      .filter((o) => o.op === 'addEnumLiteral')
      .map((o) => (o.op === 'addEnumLiteral' ? o.literal : ''));
    expect(literales).toEqual(['PENDIENTE', 'PAGADO']);
  });

  it('conserva el método con su parámetro y su tipo de retorno', () => {
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    const metodo = r.operaciones.find((o) => o.op === 'addMethod');
    expect(metodo).toMatchObject({
      name: 'calcularTotal',
      returnType: 'Decimal',
      parameters: [{ name: 'descuento', type: 'Double' }],
    });
  });

  it('no confunde el xmi:type del atributo con el tipo del atributo', () => {
    // El fallo concreto: `<ownedAttribute xmi:type="uml:Property">` tiene un
    // atributo cuyo nombre local es «type». Si la búsqueda tolera prefijos, el
    // tipo de la columna se resuelve como «uml:Property» y todo acaba en String
    // sin que nada falle de forma visible.
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    const total = r.operaciones.find((o) => o.op === 'addAttribute' && o.name === 'total');
    expect(total).toMatchObject({ type: 'Decimal' });
  });

  it('lee una asociación cuyos extremos son ownedAttribute apuntados por memberEnd', () => {
    // Es la forma que emiten varias herramientas cuando la asociación es
    // navegable desde las clases, y no se parece a la que escribimos nosotros.
    const xmi = `<xmi:XMI>
      <uml:Model name="m">
        <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Cliente">
          <ownedAttribute xmi:type="uml:Property" xmi:id="p1" name="pedidos"
                          type="c2" association="a1">
            <lowerValue xmi:type="uml:LiteralInteger" value="0"/>
            <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="*"/>
          </ownedAttribute>
        </packagedElement>
        <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Pedido"/>
        <packagedElement xmi:type="uml:Association" xmi:id="a1">
          <memberEnd xmi:idref="p2"/>
          <memberEnd xmi:idref="p1"/>
          <ownedEnd xmi:type="uml:Property" xmi:id="p2" type="c1" association="a1">
            <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>
          </ownedEnd>
        </packagedElement>
      </uml:Model>
    </xmi:XMI>`;
    const r = leerXmi(xmi, vacio());
    expect(r.aplicable).toBe(true);
    expect(resumirOperaciones(r.operaciones).relaciones).toEqual([
      'association Cliente[1]->Pedido[*]',
    ]);
  });

  it('canoniza «0..*» como «*», que es lo que ofrece el panel', () => {
    // Si volviera «0..*», el desplegable de multiplicidad de la relación
    // importada no tendría ninguna opción marcada: solo ofrece 1, 0..1, * y 1..*.
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    const relaciones = resumirOperaciones(r.operaciones).relaciones.join(' ');
    expect(relaciones).toContain('[*]');
    expect(relaciones).not.toContain('0..*');
  });

  it('sin cota inferior aplica el uno del estándar, no el cero', () => {
    // UML 2.5: un MultiplicityElement sin lowerValue vale 1. La diferencia
    // decide si la columna generada admite nulos.
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Cliente"/>
      <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Pedido"/>
      <packagedElement xmi:type="uml:Association" xmi:id="a1">
        <ownedEnd xmi:id="e1" type="c1"/>
        <ownedEnd xmi:id="e2" type="c2">
          <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="*"/>
        </ownedEnd>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    expect(resumirOperaciones(leerXmi(xmi, vacio()).operaciones).relaciones).toEqual([
      'association Cliente[1]->Pedido[1..*]',
    ]);
  });

  it('no convierte el extremo de una asociación en una columna fantasma', () => {
    // `ownedAttribute` con `association` es un extremo, no un atributo. Si se
    // tratara como columna, la tabla Cliente tendría un campo «pedidos».
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Cliente">
        <ownedAttribute xmi:type="uml:Property" xmi:id="p1" name="pedidos" type="c2" association="a1"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="p9" name="nombre"/>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Pedido"/>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, vacio());
    expect(resumirOperaciones(r.operaciones).atributos['Cliente']).toEqual(['nombre:String']);
  });

  it('acepta la marca de composición en cualquiera de los dos extremos', () => {
    // Las herramientas no coinciden en qué extremo la escribe. Se deduce el
    // «todo» de dónde está la marca en lugar de dar por bueno un convenio.
    const conMarcaEn = (extremo: 1 | 2): string => `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Pedido"/>
      <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Linea"/>
      <packagedElement xmi:type="uml:Association" xmi:id="a1">
        <ownedEnd xmi:id="e1" type="c1" aggregation="${extremo === 1 ? 'composite' : 'none'}"/>
        <ownedEnd xmi:id="e2" type="c2" aggregation="${extremo === 2 ? 'composite' : 'none'}"/>
      </packagedElement>
    </uml:Model></xmi:XMI>`;

    // Marca en el extremo tipado por la parte: el todo es el otro.
    expect(resumirOperaciones(leerXmi(conMarcaEn(2), vacio()).operaciones).relaciones).toEqual([
      'composition Pedido[1]->Linea[1]',
    ]);
    // Marca en el primero: hay que invertir para que el todo siga siendo Linea.
    expect(resumirOperaciones(leerXmi(conMarcaEn(1), vacio()).operaciones).relaciones).toEqual([
      'composition Linea[1]->Pedido[1]',
    ]);
  });

  it('entiende el estilo antiguo de XMI 1.x', () => {
    const xmi = `<XMI xmi.version="1.2">
      <XMI.content>
        <UML:Class xmi.id="c1" name="Cliente">
          <UML:Attribute xmi.id="a1" name="nombre"/>
        </UML:Class>
      </XMI.content>
    </XMI>`;
    const r = leerXmi(xmi, vacio());
    expect(r.aplicable).toBe(true);
    expect(resumirOperaciones(r.operaciones).clases).toEqual(['Cliente:class']);
  });

  it('rechaza los nombres que no sirven como identificador, sin limpiarlos', () => {
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Cliente; DROP TABLE usuarios--"/>
      <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Pedido"/>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, vacio());
    expect(resumirOperaciones(r.operaciones).clases).toEqual(['Pedido:class']);
    expect(r.avisos.some((a) => a.mensaje.includes('DROP TABLE'))).toBe(true);
  });

  it('omite una clase que ya existe en lugar de duplicarla', () => {
    const diagrama = withClass(vacio(), createClass({ id: 'YA', name: 'Cliente' }));
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Cliente"/>
      <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Pedido"/>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, diagrama);
    expect(resumirOperaciones(r.operaciones).clases).toEqual(['Pedido:class']);
    expect(r.avisos.some((a) => a.mensaje.includes('ya existe'))).toBe(true);
  });

  it('descarta la asociación que apunta a una clase que no se importó', () => {
    const diagrama = withClass(vacio(), createClass({ id: 'YA', name: 'Cliente' }));
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Cliente"/>
      <packagedElement xmi:type="uml:Class" xmi:id="c2" name="Pedido"/>
      <packagedElement xmi:type="uml:Association" xmi:id="a1" name="hace">
        <ownedEnd xmi:id="e1" type="c1"/>
        <ownedEnd xmi:id="e2" type="c2"/>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, diagrama);
    expect(resumirOperaciones(r.operaciones).relaciones).toEqual([]);
    expect(r.avisos.some((a) => a.mensaje.includes('«hace»'))).toBe(true);
  });

  it('nunca propone borrar nada', () => {
    // Importar añade. Si alguna vez se colara un `remove*`, un fichero ajeno
    // podría vaciar el diagrama de todo un equipo con un solo clic.
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    expect(r.operaciones.some((o) => o.op.startsWith('remove'))).toBe(false);
  });

  it('resume lo que va a hacer para poder enseñarlo antes de aplicar', () => {
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    expect(r.resumen).toMatchObject({ clases: 5, atributos: 5, metodos: 1, filas: 1 });
    expect(r.resumen.relaciones).toBeGreaterThanOrEqual(3);
  });

  it('un diagrama de clases no activa nada del lector de comunicación', () => {
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), vacio());
    expect(r.comunicacion).toBe(false);
    expect(r.resumen.mensajes).toBe(0);
    expect(r.resumen.enlaces).toBe(0);
    expect(r.ampliadas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Diagramas de comunicación
// ---------------------------------------------------------------------------

/**
 * Un diagrama de comunicación en la forma del estándar: colaboración con roles,
 * conector entre ellos e interacción con líneas de vida y mensajes.
 *
 * Cliente le manda «hacerPedido(fecha)» a Pedido. Es el camino largo completo:
 * mensaje → ocurrencia → `covered` → línea de vida → `represents` → rol →
 * `type` → clasificador.
 */
const COMUNICACION_ESTANDAR = `<xmi:XMI>
  <uml:Model name="Ventas">
    <packagedElement xmi:type="uml:Collaboration" xmi:id="col1" name="Compra">
      <ownedAttribute xmi:type="uml:Property" xmi:id="r1" name="c" type="k1"/>
      <ownedAttribute xmi:type="uml:Property" xmi:id="r2" name="p" type="k2"/>
      <ownedConnector xmi:type="uml:Connector" xmi:id="con1">
        <end xmi:type="uml:ConnectorEnd" xmi:id="ce1" role="r1"/>
        <end xmi:type="uml:ConnectorEnd" xmi:id="ce2" role="r2"/>
      </ownedConnector>
      <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1" name="Compra">
        <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="c" represents="r1"/>
        <lifeline xmi:type="uml:Lifeline" xmi:id="l2" name="p" represents="r2"/>
        <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="s1" covered="l1" message="m1"/>
        <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l2" message="m1"/>
        <message xmi:type="uml:Message" xmi:id="m1" name="1: hacerPedido(fecha)"
                 messageSort="synchCall" sendEvent="s1" receiveEvent="e1"/>
      </ownedBehavior>
    </packagedElement>
    <packagedElement xmi:type="uml:Class" xmi:id="k1" name="Cliente"/>
    <packagedElement xmi:type="uml:Class" xmi:id="k2" name="Pedido"/>
  </uml:Model>
</xmi:XMI>`;

/** Solo objetos y mensajes: las clases están implícitas en «u:Usuario». */
const COMUNICACION_SIN_CLASES = `<xmi:XMI><uml:Model>
  <packagedElement xmi:type="uml:Collaboration" xmi:id="col1" name="Alta">
    <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
      <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="u:Usuario"/>
      <lifeline xmi:type="uml:Lifeline" xmi:id="l2" name=":Registro"/>
      <lifeline xmi:type="uml:Lifeline" xmi:id="l3" name="tmp"/>
      <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="s1" covered="l1"/>
      <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l2"/>
      <message xmi:type="uml:Message" xmi:id="m1" name="1: registrar()" sendEvent="s1" receiveEvent="e1"/>
      <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="s2" covered="l1"/>
      <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e2" covered="l3"/>
      <message xmi:type="uml:Message" xmi:id="m2" name="2: perdido()" sendEvent="s2" receiveEvent="e2"/>
    </ownedBehavior>
  </packagedElement>
</uml:Model></xmi:XMI>`;

describe('importación de un diagrama de comunicación', () => {
  it('el mensaje se convierte en método de quien lo RECIBE, no de quien lo envía', () => {
    // Es la regla que da sentido a todo lo demás. Al revés —el método en el
    // emisor— produce un modelo que parece correcto y está del revés entero.
    const r = leerXmi(COMUNICACION_ESTANDAR, vacio());
    expect(r.aplicable).toBe(true);
    expect(metodosDe(r.operaciones)).toEqual(['Pedido.hacerPedido(fecha:String)']);
  });

  it('quien llama depende de a quién llama', () => {
    const r = leerXmi(COMUNICACION_ESTANDAR, vacio());
    expect(resumirOperaciones(r.operaciones).relaciones).toEqual([
      'dependency Cliente[1]->Pedido[1]',
    ]);
  });

  it('el enlace no repite la dependencia que ya dio el mensaje', () => {
    // El conector une los mismos dos objetos que el mensaje. Dos flechas entre
    // las mismas cajas no dicen nada más y ensucian el lienzo.
    const r = leerXmi(COMUNICACION_ESTANDAR, vacio());
    expect(r.resumen.enlaces).toBe(1);
  });

  it('deduce las clases cuando el fichero solo trae objetos', () => {
    // Antes esto fallaba con «no se ha encontrado ninguna clase»: el lector se
    // rendía antes de mirar la interacción.
    const r = leerXmi(COMUNICACION_SIN_CLASES, vacio());
    expect(r.aplicable).toBe(true);
    expect(resumirOperaciones(r.operaciones).clases).toEqual(['Usuario:class', 'Registro:class']);
    expect(metodosDe(r.operaciones)).toEqual(['Registro.registrar()']);
  });

  it('un objeto que no dice de qué clase es se descarta y se explica', () => {
    // «tmp» puede ser cualquier cosa. Crear una clase «Tmp» sería inventarse
    // una caja que nadie dibujó.
    const r = leerXmi(COMUNICACION_SIN_CLASES, vacio());
    expect(resumirOperaciones(r.operaciones).clases).not.toContain('Tmp:class');
    expect(r.avisos.some((a) => a.mensaje.includes('perdido'))).toBe(true);
  });

  it('el número de secuencia y la guarda no acaban dentro del nombre del método', () => {
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="f:Factura"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m1" receiveEvent="e1"
                   name="*[i:=1..n] 2.3: total := calcular(iva)"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    expect(metodosDe(leerXmi(xmi, vacio()).operaciones)).toEqual(['Factura.calcular(iva:String)']);
  });

  it('un mensaje de respuesta no inventa un método', () => {
    // El `reply` es la vuelta de una llamada que ya generó el suyo. Contarlo
    // otra vez pondría en la clase un método con el nombre del valor devuelto.
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="a:Caja"/>
          <lifeline xmi:type="uml:Lifeline" xmi:id="l2" name="b:Banco"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="s1" covered="l1"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l2"/>
          <message xmi:type="uml:Message" xmi:id="m1" name="1: cobrar()" messageSort="synchCall"
                   sendEvent="s1" receiveEvent="e1"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="s2" covered="l2"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e2" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m2" name="1.1: importe" messageSort="reply"
                   sendEvent="s2" receiveEvent="e2"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, vacio());
    expect(metodosDe(r.operaciones)).toEqual(['Banco.cobrar()']);
    // La dependencia sí se conserva: son dos objetos que se hablan.
    expect(r.resumen.enlaces).toBe(1);
  });

  it('un automensaje da método pero no una relación consigo mismo', () => {
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="p:Pedido"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="s1" covered="l1"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m1" name="1: validar()" sendEvent="s1" receiveEvent="e1"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, vacio());
    expect(metodosDe(r.operaciones)).toEqual(['Pedido.validar()']);
    expect(resumirOperaciones(r.operaciones).relaciones).toEqual([]);
  });

  it('amplía una clase que ya está en el diagrama en vez de omitirla', () => {
    // El choque de nombres es lo NORMAL aquí: los objetos de un diagrama de
    // comunicación son las clases que ya tienes. Omitirlas, como hace la
    // importación de un diagrama de clases, dejaría la importación en nada.
    const diagrama = withClass(vacio(), createClass({ id: 'YA', name: 'Pedido' }));
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="k1" name="Pedido"/>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedAttribute xmi:type="uml:Property" xmi:id="r1" name="p" type="k1"/>
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" represents="r1"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m1" name="1: cerrar()" receiveEvent="e1"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, diagrama);
    expect(resumirOperaciones(r.operaciones).clases).toEqual([]);
    expect(metodosDe(r.operaciones)).toEqual(['Pedido.cerrar()']);
    expect(r.ampliadas).toEqual(['Pedido']);
  });

  it('no duplica un método que la clase ya declara en el mismo fichero', () => {
    // `applyOperations` es todo o nada, y `addMethod` sobre un método que ya
    // existe devuelve error: un duplicado no molestaría, tumbaría la
    // importación entera.
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="k1" name="Pedido">
        <ownedOperation xmi:id="o1" name="cerrar"/>
      </packagedElement>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedAttribute xmi:type="uml:Property" xmi:id="r1" name="p" type="k1"/>
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" represents="r1"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m1" name="1: cerrar()" receiveEvent="e1"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    expect(metodosDe(leerXmi(xmi, vacio()).operaciones)).toEqual(['Pedido.cerrar()']);
  });

  it('no duplica un método que la clase ya tiene en el diagrama', () => {
    const diagrama = withClass(
      vacio(),
      createClass({ id: 'YA', name: 'Pedido', methods: [createMethod({ id: 'M', name: 'cerrar' })] }),
    );
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="p:Pedido"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m1" name="1: cerrar()" receiveEvent="e1"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    expect(metodosDe(leerXmi(xmi, diagrama).operaciones)).toEqual([]);
  });

  it('no añade una dependencia donde ya hay una relación dibujada', () => {
    let diagrama = withClass(vacio(), createClass({ id: 'C', name: 'Cliente' }));
    diagrama = withClass(diagrama, createClass({ id: 'P', name: 'Pedido' }));
    diagrama = withRelation(
      diagrama,
      createRelation({ id: 'R', kind: 'association', sourceId: 'C', targetId: 'P' }),
    );
    const r = leerXmi(COMUNICACION_ESTANDAR, diagrama);
    expect(resumirOperaciones(r.operaciones).relaciones).toEqual([]);
    expect(metodosDe(r.operaciones)).toEqual(['Pedido.hacerPedido(fecha:String)']);
  });

  it('dice que la secuencia no se conserva en vez de perderla en silencio', () => {
    // Es lo único que un diagrama de clases no puede representar. Callarlo
    // dejaría creer que la importación trajo el diagrama entero.
    const r = leerXmi(COMUNICACION_ESTANDAR, vacio());
    expect(r.avisos.some((a) => a.mensaje.includes('secuencia'))).toBe(true);
  });

  it('avisa una sola vez de que los tipos de los argumentos son supuestos', () => {
    const r = leerXmi(COMUNICACION_ESTANDAR, vacio());
    const sobreTipos = r.avisos.filter((a) => a.mensaje.includes('String'));
    expect(sobreTipos).toHaveLength(1);
  });

  it('respeta el tipo del argumento cuando el mensaje sí lo declara', () => {
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="f:Factura"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m1" receiveEvent="e1"
                   name="1: aplicar(descuento: Double, 42, quien)"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    // `42` es un valor concreto, no un parámetro con nombre: inventarle uno
    // pondría en la clase generada algo que nadie escribió.
    expect(metodosDe(leerXmi(xmi, vacio()).operaciones)).toEqual([
      'Factura.aplicar(descuento:Double, quien:String)',
    ]);
  });

  it('un nombre de mensaje hostil se rechaza, no se limpia (RNF-SEG-06)', () => {
    const xmi = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" name="p:Pedido"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l1"/>
          <message xmi:type="uml:Message" xmi:id="m1" receiveEvent="e1" name="1: borrar(); DROP TABLE pedidos--"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(xmi, vacio());
    expect(metodosDe(r.operaciones)).toEqual([]);
    expect(r.avisos.some((a) => a.mensaje.includes('DROP TABLE'))).toBe(true);
  });

  it('lee un fichero con los dos diagramas sin duplicar las clases', () => {
    const conAmbos = `<xmi:XMI><uml:Model>
      <packagedElement xmi:type="uml:Class" xmi:id="k1" name="Cliente">
        <ownedAttribute xmi:type="uml:Property" xmi:id="a1" name="nombre"/>
      </packagedElement>
      <packagedElement xmi:type="uml:Class" xmi:id="k2" name="Pedido"/>
      <packagedElement xmi:type="uml:Association" xmi:id="as1">
        <ownedEnd xmi:id="oe1" type="k1"/>
        <ownedEnd xmi:id="oe2" type="k2">
          <upperValue xmi:type="uml:LiteralUnlimitedNatural" value="*"/>
        </ownedEnd>
      </packagedElement>
      <packagedElement xmi:type="uml:Collaboration" xmi:id="col1">
        <ownedAttribute xmi:type="uml:Property" xmi:id="r1" name="c" type="k1"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="r2" name="p" type="k2"/>
        <ownedBehavior xmi:type="uml:Interaction" xmi:id="int1">
          <lifeline xmi:type="uml:Lifeline" xmi:id="l1" represents="r1"/>
          <lifeline xmi:type="uml:Lifeline" xmi:id="l2" represents="r2"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="s1" covered="l1"/>
          <fragment xmi:type="uml:MessageOccurrenceSpecification" xmi:id="e1" covered="l2"/>
          <message xmi:type="uml:Message" xmi:id="m1" name="1: confirmar()" sendEvent="s1" receiveEvent="e1"/>
        </ownedBehavior>
      </packagedElement>
    </uml:Model></xmi:XMI>`;
    const r = leerXmi(conAmbos, vacio());
    const { clases, relaciones } = resumirOperaciones(r.operaciones);
    expect(clases).toEqual(['Cliente:class', 'Pedido:class']);
    expect(metodosDe(r.operaciones)).toEqual(['Pedido.confirmar()']);
    // La asociación ya une las dos clases: la dependencia sobraría.
    // Es `1..*` y no `*` porque el extremo no trae `lowerValue`, y ahí el
    // estándar manda el uno.
    expect(relaciones).toEqual(['association Cliente[1]->Pedido[1..*]']);
  });

  it('las clases se crean antes que los métodos que van dentro', () => {
    // `applyOperations` las ejecuta en orden y para al primer fallo. Un
    // `addMethod` sobre una clase que todavía no existe rompe el lote entero.
    const operaciones = leerXmi(COMUNICACION_SIN_CLASES, vacio()).operaciones;
    const creada = new Set<string>();
    for (const op of operaciones) {
      if (op.op === 'addClass') creada.add(op.name);
      if (op.op === 'addMethod' && 'name' in op.classRef) {
        expect(creada.has(op.classRef.name)).toBe(true);
      }
      if (op.op === 'addRelation' && 'name' in op.source && 'name' in op.target) {
        expect(creada.has(op.source.name) && creada.has(op.target.name)).toBe(true);
      }
    }
  });

  it('nunca propone borrar nada, tampoco por esta vía', () => {
    const r = leerXmi(COMUNICACION_SIN_CLASES, vacio());
    expect(r.operaciones.some((o) => o.op.startsWith('remove'))).toBe(false);
  });

  it('cuenta las clases que va a crear para que el botón no mienta', () => {
    const r = leerXmi(COMUNICACION_SIN_CLASES, vacio());
    expect(r.resumen.clases).toBe(2);
    expect(r.clases).toEqual(['Usuario', 'Registro']);
    expect(r.comunicacion).toBe(true);
  });

  it('sigue diciéndolo claro cuando el fichero no trae nada aprovechable', () => {
    const r = leerXmi('<xmi:XMI><uml:Model name="v"/></xmi:XMI>', vacio());
    expect(r.aplicable).toBe(false);
    expect(r.avisos[0]?.mensaje).toContain('ninguna clase');
    expect(r.avisos[0]?.mensaje).toContain('comunicación');
  });
});
