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
import { diagramaAXmi } from './export.js';
import { leerXmi } from './import.js';
import { attr, descendientes, parseXml, type XmlNode } from './xml.js';

/**
 * Que el fichero que exportamos se abra bien en Enterprise Architect.
 *
 * Estas pruebas miran **el XML que sale**, no el resultado de volver a
 * importarlo. La diferencia importa: las pruebas de ida y vuelta que ya
 * existían pasaban en verde mientras EA abría el fichero mal, porque nuestro
 * lector es tolerante y acepta formas que EA no lee. Una prueba que solo
 * comprueba que el diagrama sobrevive al viaje de aquí a aquí no puede detectar
 * eso; hay que afirmar sobre la forma concreta que se escribe.
 *
 * Lo que se comprueba es lo que se rompió al abrirlo en EA:
 *
 *   - el nombre del proyecto se le pegaba a todas las clases, porque no había
 *     ningún paquete al que pertenecer;
 *   - las asociaciones llegaban sin unir ninguna caja, porque el tipo del
 *     extremo iba en un atributo que EA no lee;
 *   - aparecían elementos «String» y «Boolean» que nadie había dibujado.
 */

function diagramaCompleto(): ClassDiagram {
  const cliente = createClass({
    id: 'CLIENTE',
    name: 'Cliente',
    attributes: [
      createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true }),
      createAttribute({ id: 'A2', name: 'nombre', type: 'String', isNullable: false }),
      createAttribute({ id: 'A3', name: 'activo', type: 'Boolean' }),
    ],
    seedRows: [{ nombre: 'Ana' }],
  });
  const pedido = createClass({
    id: 'PEDIDO',
    name: 'Pedido',
    attributes: [createAttribute({ id: 'B1', name: 'total', type: 'Decimal' })],
    methods: [
      createMethod({
        id: 'M1',
        name: 'calcularTotal',
        returnType: { name: 'Decimal', collection: false },
        parameters: [{ name: 'descuento', type: { name: 'Double', collection: false } }],
      }),
    ],
  });
  const persona = createClass({ id: 'PERSONA', name: 'Persona', kind: 'abstract' });
  const estado = createClass({
    id: 'ESTADO',
    name: 'EstadoPedido',
    kind: 'enum',
    literals: ['PENDIENTE', 'PAGADO'],
  });

  let d = createDiagram({ name: 'Proyecto' });
  for (const c of [cliente, pedido, persona, estado]) d = withClass(d, c);
  d = withRelation(
    d,
    createRelation({
      id: 'R1',
      kind: 'composition',
      sourceId: 'CLIENTE',
      targetId: 'PEDIDO',
      sourceMultiplicity: '1',
      targetMultiplicity: '*',
    }),
  );
  d = withRelation(
    d,
    createRelation({ id: 'R2', kind: 'inheritance', sourceId: 'CLIENTE', targetId: 'PERSONA' }),
  );
  return d;
}

/** La raíz ya analizada, para no repetir el `if (!r.ok)` en cada prueba. */
function raiz(diagrama: ClassDiagram = diagramaCompleto()): XmlNode {
  const r = parseXml(diagramaAXmi(diagrama));
  if (!r.ok) throw new Error('el exportador ha producido XML inválido');
  return r.root;
}

const porTipo = (nodo: XmlNode, tipo: string): XmlNode[] =>
  descendientes(nodo, 'packagedElement').filter((n) => attr(n, 'xmi:type') === tipo);

describe('el XMI que exportamos, visto como lo ve Enterprise Architect', () => {
  it('mete las clases en un paquete y le pone a ese paquete el nombre del proyecto', () => {
    const root = raiz();
    const paquetes = porTipo(root, 'uml:Package');

    expect(paquetes).toHaveLength(1);
    expect(attr(paquetes[0]!, 'name')).toBe('Proyecto');

    // Y las clases están dentro de él, no sueltas bajo el modelo.
    expect(porTipo(paquetes[0]!, 'uml:Class').map((n) => attr(n, 'name'))).toEqual([
      'Cliente',
      'Pedido',
      'Persona',
    ]);
  });

  it('no le pone a ninguna clase el nombre del proyecto', () => {
    // El fallo tal y como se vio: abrir el fichero en EA y encontrarse
    // «Proyecto» escrito en todas las cajas. El nombre del proyecto tiene que
    // aparecer una sola vez en todo el cuerpo estándar, y en el paquete.
    const root = raiz();
    const modelo = descendientes(root, 'Model')[0]!;
    const conNombreDelProyecto = descendientes(modelo, 'packagedElement').filter(
      (n) => attr(n, 'name') === 'Proyecto',
    );

    expect(conNombreDelProyecto).toHaveLength(1);
    expect(attr(conNombreDelProyecto[0]!, 'xmi:type')).toBe('uml:Package');
    expect(attr(modelo, 'name')).toBe('EA_Model');
  });

  it('el tipo del extremo de una asociación es un hijo, no un atributo', () => {
    // Con `type="…"` en el atributo, EA se traía la asociación sin extremos
    // tipados y la línea no unía ninguna de las dos clases. Las dos formas son
    // XMI válido; solo una la lee EA.
    const root = raiz();
    const extremos = descendientes(root, 'ownedEnd');
    expect(extremos.length).toBeGreaterThan(0);

    for (const extremo of extremos) {
      expect(extremo.attributes['type']).toBeUndefined();
      const tipo = descendientes(extremo, 'type')[0];
      expect(tipo).toBeDefined();
      expect(attr(tipo!, 'xmi:idref')).toBeDefined();
    }

    // Y apuntan a las dos clases que la relación une.
    const idsApuntados = extremos.map((e) => attr(descendientes(e, 'type')[0]!, 'xmi:idref'));
    expect(idsApuntados).toEqual(['id_CLIENTE', 'id_PEDIDO']);
  });

  it('cada memberEnd apunta a un extremo que existe en el fichero', () => {
    const root = raiz();
    const idsDeExtremo = new Set(descendientes(root, 'ownedEnd').map((e) => attr(e, 'xmi:id')));
    const miembros = descendientes(root, 'memberEnd');

    expect(miembros).toHaveLength(2);
    for (const miembro of miembros) {
      expect(idsDeExtremo.has(attr(miembro, 'xmi:idref'))).toBe(true);
    }
  });

  it('ninguna referencia del fichero apunta a un id que no está', () => {
    // La comprobación que cubre todo lo demás: `general`, `association`,
    // `client`, `supplier`, `xmi:idref`. Una referencia rota no rompe el XML
    // —el fichero abre igual— y se manifiesta como una relación que falta o
    // una clase sin padre, que es justo lo difícil de ver a ojo.
    const root = raiz();
    const ids = new Set<string>();
    const recoger = (nodo: XmlNode): void => {
      const id = nodo.attributes['xmi:id'];
      if (id !== undefined) ids.add(id);
      for (const hijo of nodo.children) recoger(hijo);
    };
    recoger(root);

    const rotas: string[] = [];
    const revisar = (nodo: XmlNode): void => {
      for (const clave of ['xmi:idref', 'general', 'association', 'client', 'supplier']) {
        const valor = nodo.attributes[clave];
        // El bloque de extensión referencia estos mismos ids, así que entra en
        // la comprobación igual que el cuerpo estándar.
        if (valor !== undefined && !ids.has(valor)) rotas.push(`${nodo.name}/@${clave}=${valor}`);
      }
      for (const hijo of nodo.children) revisar(hijo);
    };
    revisar(root);

    expect(rotas).toEqual([]);
  });

  it('no declara como elementos del modelo los tipos que UML ya trae', () => {
    // Cada `uml:PrimitiveType` declarado aquí es un elemento que aparece en el
    // navegador de proyecto de EA sin que nadie lo haya dibujado. `String` y
    // `Boolean` existen en UML: se referencian a la biblioteca estándar.
    const root = raiz();
    const declarados = porTipo(root, 'uml:PrimitiveType').map((n) => attr(n, 'name'));

    expect(declarados).not.toContain('String');
    expect(declarados).not.toContain('Boolean');

    const hrefs = descendientes(root, 'type')
      .map((n) => attr(n, 'href'))
      .filter((h): h is string => h !== undefined);
    expect(hrefs).toContain('http://schema.omg.org/spec/UML/2.1/uml.xml#String');
    expect(hrefs).toContain('http://schema.omg.org/spec/UML/2.1/uml.xml#Boolean');
  });

  it('sí declara los tipos que UML no tiene, porque si no serían un nombre suelto', () => {
    const root = raiz();
    const declarados = porTipo(root, 'uml:PrimitiveType').map((n) => attr(n, 'name'));

    expect(declarados).toContain('Long');
    expect(declarados).toContain('Decimal');
    expect(declarados).toContain('Double');
  });

  it('el parámetro de retorno se llama «return», como en los ficheros de EA', () => {
    const root = raiz();
    const retorno = descendientes(root, 'ownedParameter').find(
      (p) => attr(p, 'direction') === 'return',
    );

    expect(retorno).toBeDefined();
    expect(attr(retorno!, 'name')).toBe('return');
  });

  it('la enumeración conserva sus literales dentro del paquete', () => {
    const root = raiz();
    const enumeracion = porTipo(root, 'uml:Enumeration')[0];

    expect(enumeracion).toBeDefined();
    expect(descendientes(enumeracion!, 'ownedLiteral').map((l) => attr(l, 'name'))).toEqual([
      'PENDIENTE',
      'PAGADO',
    ]);
  });

  it('la herencia sigue estando y apunta a la clase padre', () => {
    const root = raiz();
    const generalizaciones = descendientes(root, 'generalization');

    expect(generalizaciones).toHaveLength(1);
    expect(attr(generalizaciones[0]!, 'general')).toBe('id_PERSONA');
  });

  it('y después de todo esto el fichero se sigue reimportando aquí entero', () => {
    // El cambio de forma es para EA, pero no puede costarnos la ida y vuelta:
    // el paquete nuevo no es una clase, y el tipo que ahora va por `href` tiene
    // que resolverse igual que cuando iba por `idref`.
    const r = leerXmi(diagramaAXmi(diagramaCompleto()), createDiagram({ name: 'Otro' }));

    expect(r.aplicable).toBe(true);
    expect(r.clases).toEqual(['Cliente', 'Pedido', 'Persona', 'EstadoPedido']);
    expect(r.clases).not.toContain('Proyecto');

    const atributos = r.operaciones.filter((o) => o.op === 'addAttribute');
    const nombre = atributos.find((o) => o.op === 'addAttribute' && o.name === 'nombre');
    if (nombre?.op !== 'addAttribute') throw new Error('no se importó el atributo «nombre»');
    expect(nombre.type).toBe('String');

    const total = atributos.find((o) => o.op === 'addAttribute' && o.name === 'total');
    if (total?.op !== 'addAttribute') throw new Error('no se importó el atributo «total»');
    expect(total.type).toBe('Decimal');

    expect(r.avisos.filter((a) => a.severidad === 'error')).toEqual([]);
  });
});
