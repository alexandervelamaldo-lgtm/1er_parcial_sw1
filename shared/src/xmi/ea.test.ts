import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createClass, createDiagram, withClass } from '../model/factory.js';
import type { ClassDiagram } from '../model/uml.js';
import { leerXmi } from './import.js';
import { decodificarXml } from './xml.js';

/**
 * Un fichero de verdad, exportado por Enterprise Architect.
 *
 * El resto de pruebas de XMI trabaja sobre ficheros escritos a mano contra la
 * especificación, y por eso no encontraron esto: la especificación dice una
 * cosa y EA escribe otra, las dos válidas. Este es el `.xmi` que un usuario
 * intentó importar y que devolvía «no se ha encontrado ninguna clase», así que
 * se guarda tal cual, con su codificación windows-1252 y sus 57 KB de bloque de
 * extensión, porque un fixture recortado a mano dejaría de ser una prueba de lo
 * que las herramientas hacen y pasaría a serlo de lo que yo creo que hacen.
 *
 * Lo que el fichero contiene y por qué costaba leerlo:
 *
 *   - los participantes son `uml:Component`, no `uml:Class`;
 *   - los objetos son `uml:InstanceSpecification` con `classifier` al componente;
 *   - los `ownedConnector` cuelgan del paquete, no de la `Collaboration`;
 *   - **no hay ni un solo `uml:Message`**: los mensajes viven únicamente en el
 *     bloque `<xmi:Extension extender="Enterprise Architect">`.
 */

const aqui = dirname(fileURLToPath(import.meta.url));

function ficheroEa(): string {
  return decodificarXml(readFileSync(join(aqui, 'fixtures', 'ea-comunicacion.xmi')));
}

const vacio = (): ClassDiagram => createDiagram({ name: 'Proyecto' });

describe('XMI de un diagrama de comunicación de Enterprise Architect', () => {
  it('se importa, en vez de decir que el fichero está vacío', () => {
    const resultado = leerXmi(ficheroEa(), vacio());

    expect(resultado.aplicable).toBe(true);
    expect(resultado.operaciones.length).toBeGreaterThan(0);
    expect(resultado.avisos.filter((a) => a.severidad === 'error')).toEqual([]);
  });

  it('trae los tres participantes con el nombre del componente, no el del objeto', () => {
    // Los objetos se llaman `con`, `cth` y `ctw`. Son etiquetas de instancia: la
    // clase está detrás del `classifier`. Importar «Con» y «Ctw» habría sido un
    // fallo silencioso, porque el diagrama se llena igual y solo se nota al
    // mirar los nombres.
    const resultado = leerXmi(ficheroEa(), vacio());

    expect(resultado.clases).toEqual(['ComponentA', 'ComponentB', 'ComponentC']);
    expect(resultado.clases).not.toContain('Con');
    expect(resultado.clases).not.toContain('Ctw');
  });

  it('trae las operaciones que cada componente declara', () => {
    const resultado = leerXmi(ficheroEa(), vacio());
    const metodos = resultado.operaciones.filter((o) => o.op === 'addMethod');

    expect(metodos.length).toBeGreaterThanOrEqual(3);
    expect(metodos.map((m) => m.name)).toContain('operationOne');
  });

  it('lee el parámetro entero y no lo convierte en String', () => {
    const resultado = leerXmi(ficheroEa(), vacio());
    const metodo = resultado.operaciones.find(
      (o) => o.op === 'addMethod' && o.parameters.length > 0,
    );

    expect(metodo).toBeDefined();
    if (metodo?.op !== 'addMethod') throw new Error('no hay ningún método con parámetros');
    expect(metodo.parameters[0]).toEqual({ name: 'parameterOne', type: 'Integer' });
  });

  it('entiende que `EAnone_void` significa que el método no devuelve nada', () => {
    // Sin reconocer la marca, el tipo se buscaba, no se encontraba, y el método
    // acababa devolviendo String con un aviso al lado.
    const resultado = leerXmi(ficheroEa(), vacio());
    const metodos = resultado.operaciones.filter((o) => o.op === 'addMethod');

    for (const metodo of metodos) {
      if (metodo.op !== 'addMethod') continue;
      expect(metodo.returnType).toBeNull();
    }
    expect(resultado.avisos.map((a) => a.mensaje).join(' ')).not.toContain('EAnone');
  });

  it('dibuja tres relaciones y no seis, porque los enlaces repiten las asociaciones', () => {
    // Este fichero trae los mismos tres vínculos dos veces: como `uml:Association`
    // entre los componentes y como `ownedConnector` entre las instancias. Son la
    // misma línea del diagrama contada de dos maneras, así que el resultado
    // correcto son tres relaciones —las asociaciones, que llevan más
    // información— y cero dependencias encima. Seis flechas entre tres cajas
    // sería un lienzo ilegible sacado de un diagrama que no tenía nada malo.
    const resultado = leerXmi(ficheroEa(), vacio());
    const relaciones = resultado.operaciones.filter((o) => o.op === 'addRelation');

    expect(relaciones).toHaveLength(3);
    for (const relacion of relaciones) {
      if (relacion.op !== 'addRelation') continue;
      expect(relacion.kind).toBe('association');
    }
    expect(resultado.resumen.enlaces).toBe(0);
  });

  it('los enlaces sí cuentan cuando el fichero no trae la asociación equivalente', () => {
    // Sin este caso, la prueba de arriba pasaría igual con el lector viejo, que
    // no miraba los conectores de fuera de la `Collaboration`: las asociaciones
    // tapaban el fallo. Aquí solo hay conectores, y cuelgan del paquete.
    const soloConectores = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmlns:uml="http://schema.omg.org/spec/UML/2.1"
               xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">
        <uml:Model xmi:type="uml:Model" name="M">
          <packagedElement xmi:type="uml:Package" xmi:id="P1" name="Componentes">
            <packagedElement xmi:type="uml:Component" xmi:id="CA" name="Cobro"/>
            <packagedElement xmi:type="uml:Component" xmi:id="CB" name="Factura"/>
          </packagedElement>
          <packagedElement xmi:type="uml:Package" xmi:id="P2" name="Instancias">
            <packagedElement xmi:type="uml:InstanceSpecification" xmi:id="O1" name="c1" classifier="CA"/>
            <packagedElement xmi:type="uml:InstanceSpecification" xmi:id="O2" name="f1" classifier="CB"/>
            <ownedConnector xmi:type="uml:Connector" xmi:id="K1">
              <end xmi:type="uml:ConnectorEnd" xmi:id="K1S" role="O1"/>
              <end xmi:type="uml:ConnectorEnd" xmi:id="K1D" role="O2"/>
            </ownedConnector>
          </packagedElement>
        </uml:Model>
      </xmi:XMI>`;

    const resultado = leerXmi(soloConectores, vacio());

    expect(resultado.resumen.enlaces).toBe(1);
    const relacion = resultado.operaciones.find((o) => o.op === 'addRelation');
    if (relacion?.op !== 'addRelation') throw new Error('no se dedujo ninguna relación');
    expect(relacion.kind).toBe('dependency');
    // Y con el nombre de la clase, no el del objeto.
    expect([relacion.source, relacion.target]).toEqual([{ name: 'Cobro' }, { name: 'Factura' }]);
  });

  it('lo declara como diagrama de comunicación', () => {
    expect(leerXmi(ficheroEa(), vacio()).comunicacion).toBe(true);
  });

  it('sobre un diagrama que ya tiene una de las clases, la amplía en vez de duplicarla', () => {
    const diagrama = withClass(vacio(), createClass({ id: 'CA', name: 'ComponentA' }));
    const resultado = leerXmi(ficheroEa(), diagrama);

    expect(resultado.clases).not.toContain('ComponentA');
    const nuevas = resultado.operaciones.filter(
      (o) => o.op === 'addClass' && o.name === 'ComponentA',
    );
    expect(nuevas).toEqual([]);
  });
});

describe('la codificación que el fichero declara', () => {
  it('lee windows-1252 sin romper los acentos', () => {
    // 0xED es «í» en windows-1252 y no es UTF-8 válido: decodificado como UTF-8
    // se convierte en el rombo de interrogación y «Artículo» deja de pasar la
    // lista blanca de nombres, con un aviso que además culpa al nombre.
    const bytes = Uint8Array.from([
      ...new TextEncoder().encode('<?xml version="1.0" encoding="windows-1252"?><a n="Art'),
      0xed,
      ...new TextEncoder().encode('culo"/>'),
    ]);

    expect(decodificarXml(bytes)).toContain('Artículo');
    expect(decodificarXml(bytes)).not.toContain('�');
  });

  it('sin declaración supone UTF-8, que es lo que dice el estándar', () => {
    const bytes = new TextEncoder().encode('<?xml version="1.0"?><a n="Artículo"/>');
    expect(decodificarXml(bytes)).toContain('Artículo');
  });

  it('una codificación que el entorno no conoce no impide leer el fichero', () => {
    const bytes = new TextEncoder().encode(
      '<?xml version="1.0" encoding="x-inventada"?><a n="Pedido"/>',
    );
    expect(decodificarXml(bytes)).toContain('Pedido');
  });
});
