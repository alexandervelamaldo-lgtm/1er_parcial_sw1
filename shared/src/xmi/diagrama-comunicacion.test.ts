import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  comprobarIntegridad,
  type CodigoIntegridad,
} from '../model/comunicacion-integridad.js';
import {
  clavePar,
  compararNumeros,
  enlacesEfectivos,
  numeroPadre,
  type DiagramaComunicacionUml,
  type EnlaceUml,
  type MensajeUml,
  type ParticipanteUml,
} from '../model/comunicacion-uml.js';
import { createDiagram } from '../model/factory.js';
import { readComunicaciones, writeComunicacion } from '../crdt/comunicaciones.js';
import { leerDiagramasComunicacion } from './diagrama-comunicacion.js';
import { analizarEtiqueta } from './etiqueta-mensaje.js';
import { leerXmi } from './import.js';
import { decodificarXml, parseXml } from './xml.js';

/**
 * La importación de diagramas de comunicación, probada contra los dos
 * dialectos que se pidieron y contra lo que emite este mismo proyecto.
 *
 * POR QUÉ TRES CORPUS Y NO UNO. Un importador de XMI que solo se prueba contra
 * los ficheros que uno mismo escribe no prueba nada: los dos lados comparten
 * las mismas suposiciones, y las suposiciones son justo lo que falla cuando
 * llega un fichero de fuera. Así que hay:
 *
 * 1. `fixtures/ea-comunicacion.xmi` — exportación **real** de Sparx Enterprise
 *    Architect, en windows-1252, con la cadena larga hasta el clasificador y
 *    sin un solo mensaje. Nadie lo escribió para pasar estas pruebas.
 * 2. `fixtures/uml-251-comunicacion.xmi` — UML 2.5.1 canónico, escrito a mano
 *    contra la especificación de la OMG: los extremos apuntan al rol, los
 *    mensajes no declaran `sendEvent` y uno de ellos no tiene ni nombre.
 * 3. Los diecinueve `docs/uml/CU*-comunicacion.xmi` que emite este proyecto,
 *    como barrido: no se comprueba uno por uno, se comprueba que ninguno se
 *    importe roto.
 *
 * Y hay una cuarta prueba que no es de lectura sino de **conservación**: un
 * diagrama leído, guardado en el documento Yjs, serializado, aplicado a otro
 * documento y vuelto a leer tiene que ser el mismo. Es el camino que recorre
 * de verdad —del fichero al navegador de otra persona— y es donde un campo que
 * se olvidó de escribir no se nota hasta que alguien abre el proyecto mañana.
 */

const AQUI = fileURLToPath(new URL('.', import.meta.url));

function leerFichero(ruta: string): ReturnType<typeof leerDiagramasComunicacion> {
  const texto = decodificarXml(readFileSync(ruta));
  const analizado = parseXml(texto);
  if (!analizado.ok) throw new Error(`${ruta}: ${analizado.error}`);
  return leerDiagramasComunicacion(analizado.root, ruta);
}

const ea = (): ReturnType<typeof leerDiagramasComunicacion> =>
  leerFichero(`${AQUI}fixtures/ea-comunicacion.xmi`);
const canonico = (): ReturnType<typeof leerDiagramasComunicacion> =>
  leerFichero(`${AQUI}fixtures/uml-251-comunicacion.xmi`);

/** Los mensajes en forma legible, para comparar de un vistazo. */
function guion(diagrama: DiagramaComunicacionUml): string[] {
  const alias = new Map(diagrama.participantes.map((p) => [p.id, p.alias]));
  return diagrama.mensajes.map(
    (m) =>
      `${m.numero} ${alias.get(m.de) ?? '?'}->${alias.get(m.a) ?? '?'} ` +
      `${m.nombre}(${m.argumentos.join(', ')})`,
  );
}

// ---------------------------------------------------------------------------
// La etiqueta
// ---------------------------------------------------------------------------

describe('despiece de la etiqueta de un mensaje', () => {
  it('separa los cuatro adornos del ejemplo del manual', () => {
    const piezas = analizarEtiqueta('*[i := 1..n] 2.3: total := calcular(iva, base)');

    expect(piezas).toEqual({
      numero: '2.3',
      guarda: 'i := 1..n',
      iteracion: true,
      asignacion: 'total',
      nombre: 'calcular',
      argumentos: ['iva', 'base'],
      sobra: false,
    });
  });

  it('no pierde la guarda por culpa del asterisco que la precede', () => {
    // El fallo que tuvo esto: consumir el `*` en una vuelta del bucle dejaba
    // `[i]` sin el asterisco y la rama de la guarda ya no reconocía el par.
    const piezas = analizarEtiqueta('*[i] 1: siguiente()');

    expect(piezas?.iteracion).toBe(true);
    expect(piezas?.guarda).toBe('i');
    expect(piezas?.numero).toBe('1');
  });

  it('acepta la iteración sin guarda', () => {
    const piezas = analizarEtiqueta('*2: siguiente()');

    expect(piezas?.iteracion).toBe(true);
    expect(piezas?.guarda).toBeUndefined();
    expect(piezas?.numero).toBe('2');
  });

  it('admite los números con hilo y con marca de concurrencia', () => {
    expect(analizarEtiqueta('A1: arrancar()')?.numero).toBe('A1');
    expect(analizarEtiqueta('1.2a: avisar()')?.numero).toBe('1.2a');
  });

  it('no se inventa un número cuando la etiqueta no lo trae', () => {
    const piezas = analizarEtiqueta('guardar(pedido)');

    expect(piezas?.numero).toBeUndefined();
    expect(piezas?.nombre).toBe('guardar');
  });

  it('marca lo que sobra detrás del paréntesis en vez de tirarlo', () => {
    // RNF-SEG-06. Quedarse con `borrar` a secas y callar el resto es lo que
    // hace que una inyección entre en el modelo sin que nadie la vea.
    const piezas = analizarEtiqueta('1: borrar(); DROP TABLE pedidos');

    expect(piezas?.nombre).toBe('borrar');
    expect(piezas?.sobra).toBe(true);
    expect(piezas?.argumentos).toEqual([]);
  });

  it('devuelve null cuando no queda ningún nombre', () => {
    expect(analizarEtiqueta('1:')).toBeNull();
    expect(analizarEtiqueta('   ')).toBeNull();
  });

  it('una letra seguida de dígitos delante de los dos puntos es un número de hilo', () => {
    // `p1:Pedido` se despieza como número `p1` y nombre `Pedido`, igual que
    // `A1: arrancar()`. Es ambiguo en el propio UML y no hay forma de
    // distinguirlos mirando solo la cadena. Se deja así a propósito: esta
    // función se aplica a **etiquetas de mensaje**, donde `A1:` es la forma
    // legítima, y nunca al nombre de un objeto. El convenio `p1:Pedido` de los
    // participantes lo parte `leerParticipante`, que sabe que está mirando un
    // objeto y no un mensaje.
    const piezas = analizarEtiqueta('p1:Pedido');

    expect(piezas?.numero).toBe('p1');
    expect(piezas?.nombre).toBe('Pedido');
  });
});

// ---------------------------------------------------------------------------
// Enterprise Architect 2.1
// ---------------------------------------------------------------------------

describe('dialecto Enterprise Architect (XMI 2.1)', () => {
  it('titula el diagrama con el nombre del paquete y no con «EA_Interaction1»', () => {
    const { diagramas } = ea();

    expect(diagramas).toHaveLength(1);
    expect(diagramas[0]?.nombre).toBe('Communication Diagram with Three Components');
  });

  it('recorre la cadena entera hasta el clasificador', () => {
    // lifeline → represents → Property → type → InstanceSpecification →
    // classifier → Component. Pararse antes deja objetos de clase «Con».
    const objetos = ea().diagramas[0]?.participantes ?? [];

    expect(objetos.map((p) => `${p.alias}:${p.clase ?? '?'}`).sort()).toEqual([
      'con:Component A',
      'cth:Component C',
      'ctw:Component B',
    ]);
  });

  it('conserva los tres enlaces aunque el fichero no traiga ni un mensaje', () => {
    // Este fichero es exactamente el caso que rompió el primer diseño: los
    // conectores viven fuera de la colaboración y los mensajes no existen.
    const diagrama = ea().diagramas[0];

    expect(diagrama?.mensajes).toEqual([]);
    expect(diagrama?.enlaces).toHaveLength(3);
    const ids = new Set((diagrama?.participantes ?? []).map((p) => p.id));
    for (const enlace of diagrama?.enlaces ?? []) {
      expect(ids.has(enlace.a)).toBe(true);
      expect(ids.has(enlace.b)).toBe(true);
    }
  });

  it('lo da por íntegro: sin mensajes no hay nada colgando', () => {
    const diagrama = ea().diagramas[0]!;
    const { integro, problemas } = comprobarIntegridad(diagrama);

    expect(integro).toBe(true);
    expect(problemas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// UML 2.5.1 canónico
// ---------------------------------------------------------------------------

describe('dialecto UML 2.5.1 / XMI 2.5.1 canónico', () => {
  it('resuelve los extremos por el camino inverso, sin sendEvent', () => {
    // Sin el índice de ocurrencias, este fichero se importaría con cero
    // mensajes y sin que nada fallara de forma visible.
    const diagrama = canonico().diagramas[0]!;

    expect(diagrama.mensajes).toHaveLength(6);
    expect(guion(diagrama)).toEqual([
      '1 c->ca confirmar()',
      '1.1 ca->p crearPedido(lineas)',
      '1.2 ca->p añadirLinea(linea)',
      '2 p->pa cobrar(importe)',
      '2.1 pa->pa autorizar(tarjeta)',
      '3 pa->p notificar(correo)',
    ]);
  });

  it('lee el nombre de la operación cuando el mensaje no trae etiqueta', () => {
    // `signature` → uml:Operation. El parámetro de retorno no cuenta como
    // argumento: `notificar(correo, entregado)` sería una firma inventada.
    const tercero = canonico().diagramas[0]!.mensajes.find((m) => m.numero === '3');

    expect(tercero?.nombre).toBe('notificar');
    expect(tercero?.argumentos).toEqual(['correo']);
    expect(tercero?.clase).toBe('respuesta');
  });

  it('conserva guarda, iteración y asignación de cada rótulo', () => {
    const porNumero = new Map(canonico().diagramas[0]!.mensajes.map((m) => [m.numero, m]));

    expect(porNumero.get('1.2')?.iteracion).toBe(true);
    expect(porNumero.get('1.2')?.guarda).toBe('por cada línea');
    expect(porNumero.get('2')?.asignacion).toBe('total');
    expect(porNumero.get('2.1')?.guarda).toBe('hay saldo');
    // Los que no llevan adorno no se lo inventan.
    expect(porNumero.get('1')?.guarda).toBeUndefined();
    expect(porNumero.get('1')?.iteracion).toBe(false);
  });

  it('distingue el número escrito del deducido, y lo dice', () => {
    const { diagramas, avisos } = canonico();
    const mensajes = diagramas[0]!.mensajes;

    expect(mensajes.filter((m) => m.ordenDe === 'fichero')).toHaveLength(5);
    // El sexto no traía número: se le pone el primer entero libre, que es el 3
    // porque el 1 y el 2 ya estaban cogidos.
    const deducido = mensajes.filter((m) => m.ordenDe === 'documento');
    expect(deducido.map((m) => m.numero)).toEqual(['3']);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.mensaje).toContain('unos mensajes traen número de secuencia y otros no');
  });

  it('marca como actor al que lo es y no al resto', () => {
    const objetos = canonico().diagramas[0]!.participantes;

    expect(objetos.filter((p) => p.actor).map((p) => p.clase)).toEqual(['Cliente']);
  });

  it('reconoce los conectores que apuntan al rol y no a una instancia', () => {
    const diagrama = canonico().diagramas[0]!;
    const alias = new Map(diagrama.participantes.map((p) => [p.id, p.alias]));
    const pares = diagrama.enlaces.map((e) =>
      [alias.get(e.a), alias.get(e.b)].sort().join('-'),
    );

    expect(pares.sort()).toEqual(['c-ca', 'ca-p', 'p-pa']);
    expect(diagrama.enlaces.find((e) => e.nombre !== undefined)?.nombre).toBe('usa');
  });

  it('sale íntegro: ni un problema en un fichero bien formado', () => {
    const { integro, problemas } = comprobarIntegridad(canonico().diagramas[0]!);

    expect(problemas).toEqual([]);
    expect(integro).toBe(true);
  });

  it('no duplica el diagrama por tener colaboración e interacción', () => {
    // La colaboración contiene la interacción: el diagrama es uno, no dos.
    expect(canonico().diagramas).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Los dos dialectos dicen lo mismo de distinta manera
// ---------------------------------------------------------------------------

describe('lo que comparten los dos dialectos', () => {
  it('ninguno pierde objetos por el camino', () => {
    for (const { diagramas } of [ea(), canonico()]) {
      for (const diagrama of diagramas) {
        expect(diagrama.participantes.length).toBeGreaterThan(0);
        // Un objeto sin clase se importa igual, pero aquí los dos ficheros la
        // traen: si falta, la cadena se ha roto en algún eslabón.
        for (const p of diagrama.participantes) expect(p.clase).toBeDefined();
      }
    }
  });

  it('ningún mensaje ni enlace apunta fuera del diagrama', () => {
    for (const { diagramas } of [ea(), canonico()]) {
      for (const diagrama of diagramas) {
        const ids = new Set(diagrama.participantes.map((p) => p.id));
        for (const m of diagrama.mensajes) {
          expect(ids.has(m.de)).toBe(true);
          expect(ids.has(m.a)).toBe(true);
        }
        for (const e of diagrama.enlaces) {
          expect(ids.has(e.a)).toBe(true);
          expect(ids.has(e.b)).toBe(true);
        }
      }
    }
  });

  it('no repite identificadores dentro de un mismo diagrama', () => {
    for (const { diagramas } of [ea(), canonico()]) {
      for (const diagrama of diagramas) {
        const ids = diagrama.participantes.map((p) => p.id);
        expect(new Set(ids).size).toBe(ids.length);
        const mensajes = diagrama.mensajes.map((m) => m.id);
        expect(new Set(mensajes).size).toBe(mensajes.length);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Barrido sobre lo que emite este proyecto
// ---------------------------------------------------------------------------

describe('los diecinueve ficheros que emite este proyecto', () => {
  const casos = Array.from({ length: 19 }, (_, i) => `CU${String(i + 1)}`);

  it.each(casos)('%s se importa entero y sin problemas de integridad', (caso) => {
    const { diagramas, avisos } = leerFichero(`${AQUI}../../../docs/uml/${caso}-comunicacion.xmi`);

    expect(diagramas).toHaveLength(1);
    const diagrama = diagramas[0]!;
    expect(diagrama.participantes.length).toBeGreaterThanOrEqual(2);
    expect(diagrama.mensajes.length).toBeGreaterThanOrEqual(1);
    expect(avisos.filter((a) => a.severidad === 'error')).toEqual([]);

    const { problemas } = comprobarIntegridad(diagrama);
    expect(problemas.filter((p) => p.severidad === 'error')).toEqual([]);
  });

  it('titula cada uno con su caso de uso y no con «Interaccion_CU1»', () => {
    const { diagramas } = leerFichero(`${AQUI}../../../docs/uml/CU1-comunicacion.xmi`);

    expect(diagramas[0]?.nombre).toContain('CU1');
    expect(diagramas[0]?.nombre).not.toContain('Interaccion');
  });

  it('numera por el orden del documento cuando el fichero no trae números', () => {
    const diagrama = leerFichero(`${AQUI}../../../docs/uml/CU1-comunicacion.xmi`).diagramas[0]!;

    expect(diagrama.mensajes.every((m) => m.ordenDe === 'documento')).toBe(true);
    expect(diagrama.mensajes.map((m) => m.numero)).toEqual(
      diagrama.mensajes.map((_, i) => String(i + 1)),
    );
  });
});

// ---------------------------------------------------------------------------
// Ficheros que no traen un diagrama de comunicación
// ---------------------------------------------------------------------------

describe('ficheros que no son lo que se busca', () => {
  const leerTexto = (xml: string): ReturnType<typeof leerDiagramasComunicacion> => {
    const analizado = parseXml(xml);
    if (!analizado.ok) throw new Error(analizado.error);
    return leerDiagramasComunicacion(analizado.root, 'prueba.xmi');
  };

  it('un diagrama de clases no da ningún diagrama de comunicación', () => {
    const { diagramas, avisos } = leerTexto(
      `<?xml version="1.0" encoding="UTF-8"?>
       <xmi:XMI xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
         <uml:Model xmi:id="m" name="M">
           <packagedElement xmi:type="uml:Class" xmi:id="c1" name="Pedido"/>
         </uml:Model>
       </xmi:XMI>`,
    );

    expect(diagramas).toEqual([]);
    // Y no se queja: no encontrar lo que no hay no es un fallo.
    expect(avisos).toEqual([]);
  });

  it('una interacción sin líneas de vida se descarta en vez de dar un diagrama vacío', () => {
    const { diagramas } = leerTexto(
      `<?xml version="1.0" encoding="UTF-8"?>
       <xmi:XMI xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
         <uml:Model xmi:id="m" name="M">
           <packagedElement xmi:type="uml:Interaction" xmi:id="i1" name="Vacía"/>
         </uml:Model>
       </xmi:XMI>`,
    );

    expect(diagramas).toEqual([]);
  });

  it('avisa de los mensajes cuyo extremo no está en el fichero, en vez de perderlos callando', () => {
    const { diagramas, avisos } = leerTexto(
      `<?xml version="1.0" encoding="UTF-8"?>
       <xmi:XMI xmlns:xmi="http://schema.omg.org/spec/XMI/2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1">
         <uml:Model xmi:id="m" name="M">
           <packagedElement xmi:type="uml:Package" xmi:id="p" name="Roto">
             <packagedElement xmi:type="uml:Class" xmi:id="cA" name="A"/>
             <packagedElement xmi:type="uml:Class" xmi:id="cB" name="B"/>
             <packagedElement xmi:type="uml:Interaction" xmi:id="i1" name="Roto">
               <lifeline xmi:type="uml:Lifeline" xmi:id="lvA" name="a" represents="rA"/>
               <ownedAttribute xmi:type="uml:Property" xmi:id="rA" name="a" type="cA"/>
               <message xmi:type="uml:Message" xmi:id="msj" name="1: hola()"
                        sendEvent="lvA" receiveEvent="noExiste"/>
             </packagedElement>
           </packagedElement>
         </uml:Model>
       </xmi:XMI>`,
    );

    expect(diagramas[0]?.mensajes).toEqual([]);
    expect(avisos.map((a) => a.mensaje).join(' ')).toContain('no apunta a ningún objeto');
  });
});

// ---------------------------------------------------------------------------
// Integridad
// ---------------------------------------------------------------------------

const objeto = (id: string, alias: string, clase = 'Clase'): ParticipanteUml => ({
  id,
  alias,
  clase,
  actor: false,
  multiple: false,
});

const mensaje = (
  id: string,
  numero: string,
  de: string,
  a: string,
  extra: Partial<MensajeUml> = {},
): MensajeUml => ({
  id,
  numero,
  ordenDe: 'fichero',
  etiqueta: `${numero}: ${id}()`,
  nombre: id,
  argumentos: [],
  de,
  a,
  clase: 'llamada',
  guarda: undefined,
  iteracion: false,
  asignacion: undefined,
  ...extra,
});

const diagramaCon = (
  participantes: ParticipanteUml[],
  mensajes: MensajeUml[] = [],
  enlaces: EnlaceUml[] = [],
): DiagramaComunicacionUml => ({
  id: 'd1',
  nombre: 'Prueba',
  fuente: 'prueba.xmi',
  participantes,
  mensajes,
  enlaces,
});

const codigos = (d: DiagramaComunicacionUml): CodigoIntegridad[] =>
  comprobarIntegridad(d).problemas.map((p) => p.codigo);

describe('comprobación de integridad', () => {
  it('no encuentra nada en un diagrama correcto', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b')],
      [{ id: 'e1', a: 'a', b: 'b', nombre: undefined }],
    );

    expect(comprobarIntegridad(d)).toEqual({ integro: true, problemas: [] });
  });

  it('sin-participantes: y corta ahí, porque lo demás no tiene sentido', () => {
    const { integro, problemas } = comprobarIntegridad(diagramaCon([]));

    expect(integro).toBe(false);
    expect(problemas.map((p) => p.codigo)).toEqual(['sin-participantes']);
  });

  it('emisor-colgante y destinatario-colgante son errores, no avisos', () => {
    const d = diagramaCon(
      [objeto('a', 'a')],
      [mensaje('m1', '1', 'fantasma', 'a'), mensaje('m2', '2', 'a', 'otroFantasma')],
    );
    const { integro, problemas } = comprobarIntegridad(d);

    expect(integro).toBe(false);
    expect(problemas.map((p) => p.codigo)).toContain('emisor-colgante');
    expect(problemas.map((p) => p.codigo)).toContain('destinatario-colgante');
    // El id del objeto que falta va en la lista, para poder buscarlo en el XMI.
    const colgante = problemas.find((p) => p.codigo === 'emisor-colgante');
    expect(colgante?.elementos).toContain('fantasma');
  });

  it('enlace-colgante', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b')],
      [{ id: 'e1', a: 'a', b: 'fantasma', nombre: undefined }],
    );

    expect(codigos(d)).toContain('enlace-colgante');
    expect(comprobarIntegridad(d).integro).toBe(false);
  });

  it('alias-repetido: dos cajas que en el dibujo no se distinguen', () => {
    const d = diagramaCon(
      [objeto('a', 'p', 'Pedido'), objeto('b', 'p', 'Pedido')],
      [mensaje('m1', '1', 'a', 'b')],
    );
    const problema = comprobarIntegridad(d).problemas.find((p) => p.codigo === 'alias-repetido');

    expect(problema?.severidad).toBe('aviso');
    expect(problema?.elementos).toEqual(['a', 'b']);
    // Un aviso no tumba la importación.
    expect(comprobarIntegridad(d).integro).toBe(true);
  });

  it('objeto-sin-clase', () => {
    const d = diagramaCon(
      [{ ...objeto('a', 'a'), clase: undefined }, objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b')],
    );

    expect(codigos(d)).toContain('objeto-sin-clase');
  });

  it('objeto-aislado: ni mensajes ni enlaces', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b'), objeto('c', 'c')],
      [mensaje('m1', '1', 'a', 'b')],
    );
    const problema = comprobarIntegridad(d).problemas.find((p) => p.codigo === 'objeto-aislado');

    expect(problema?.elementos).toEqual(['c']);
  });

  it('un objeto con enlace y sin mensajes no está aislado', () => {
    // Es el fixture de Enterprise Architect entero: tres objetos, tres enlaces,
    // cero mensajes. Contarlo como aislado lo llenaría de avisos falsos.
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [],
      [{ id: 'e1', a: 'a', b: 'b', nombre: undefined }],
    );

    expect(codigos(d)).toEqual([]);
  });

  it('numero-repetido', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '1', 'b', 'a')],
    );

    expect(codigos(d)).toContain('numero-repetido');
  });

  it('secuencia-sin-padre: hay un 1.1 y no hay un 1', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1.1', 'a', 'b')],
    );

    expect(codigos(d)).toContain('secuencia-sin-padre');
  });

  it('secuencia-con-hueco: hay un 1 y un 3 y no hay un 2', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b'), mensaje('m3', '3', 'a', 'b')],
    );
    const problema = comprobarIntegridad(d).problemas.find(
      (p) => p.codigo === 'secuencia-con-hueco',
    );

    expect(problema?.mensaje).toContain('«2»');
  });

  it('la numeración deducida no se comprueba: es contigua por construcción', () => {
    // Si se comprobara, un fichero que mezcla las dos daría huecos falsos: los
    // números deducidos rellenan justo los que los escritos dejaron libres.
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [
        mensaje('m1', '5', 'a', 'b', { ordenDe: 'documento' }),
        mensaje('m2', '9', 'b', 'a', { ordenDe: 'documento' }),
      ],
    );

    expect(codigos(d)).toEqual([]);
  });

  it('mensaje-sin-nombre', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b', { nombre: '', etiqueta: '' })],
    );

    expect(codigos(d)).toContain('mensaje-sin-nombre');
  });

  it('respuesta-sin-llamada: una respuesta va al revés que su llamada', () => {
    const conLlamada = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [
        mensaje('m1', '1', 'a', 'b'),
        mensaje('m2', '2', 'b', 'a', { clase: 'respuesta' }),
      ],
    );
    const sinLlamada = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b', { clase: 'respuesta' })],
    );

    expect(codigos(conLlamada)).not.toContain('respuesta-sin-llamada');
    expect(codigos(sinLlamada)).toContain('respuesta-sin-llamada');
  });

  it('mensaje-sin-enlace solo cuando el fichero declara enlaces', () => {
    const objetos = [objeto('a', 'a'), objeto('b', 'b'), objeto('c', 'c')];
    const mensajes = [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '2', 'b', 'c')];

    // Sin conectores declarados, callar: hay ficheros —los nuestros de antes—
    // donde los enlaces están implícitos en los mensajes.
    expect(codigos(diagramaCon(objetos, mensajes))).not.toContain('mensaje-sin-enlace');

    const conUno = diagramaCon(objetos, mensajes, [
      { id: 'e1', a: 'a', b: 'b', nombre: undefined },
    ]);
    expect(codigos(conUno)).toContain('mensaje-sin-enlace');
  });

  it('un mensaje a sí mismo no necesita enlace', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '2', 'b', 'b')],
      [{ id: 'e1', a: 'a', b: 'b', nombre: undefined }],
    );

    expect(codigos(d)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Orden y enlaces deducidos
// ---------------------------------------------------------------------------

describe('orden de los números de secuencia', () => {
  it('ordena por número y no alfabéticamente', () => {
    // El fallo clásico: con sort() a secas el 10 va antes que el 2 y el
    // diagrama se lee al revés a partir del décimo mensaje.
    const numeros = ['10', '2', '1.10', '1.2', '1', '2.1'];

    expect([...numeros].sort(compararNumeros)).toEqual(['1', '1.2', '1.10', '2', '2.1', '10']);
  });

  it('el padre pasa antes que lo que provoca', () => {
    expect(compararNumeros('1', '1.1')).toBeLessThan(0);
  });

  it('los concurrentes se ordenan por su letra', () => {
    expect(['1b', '1a'].sort(compararNumeros)).toEqual(['1a', '1b']);
  });

  it('numeroPadre sube un nivel y solo uno', () => {
    expect(numeroPadre('1.2.3')).toBe('1.2');
    expect(numeroPadre('1')).toBeUndefined();
  });
});

describe('enlaces efectivos', () => {
  it('deduce de los mensajes los enlaces que el fichero no declara', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b'), objeto('c', 'c')],
      [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '2', 'b', 'c')],
      [{ id: 'e1', a: 'a', b: 'b', nombre: undefined }],
    );
    const efectivos = enlacesEfectivos(d);

    expect(efectivos).toHaveLength(2);
    expect(efectivos.map((e) => clavePar(e.a, e.b)).sort()).toEqual(['a|b', 'b|c']);
  });

  it('no duplica el que ya venía declarado ni inventa uno para el mensaje reflexivo', () => {
    const d = diagramaCon(
      [objeto('a', 'a'), objeto('b', 'b')],
      [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '2', 'b', 'a'), mensaje('m3', '3', 'a', 'a')],
      [{ id: 'e1', a: 'a', b: 'b', nombre: undefined }],
    );

    expect(enlacesEfectivos(d)).toHaveLength(1);
  });

  it('un fichero de Enterprise Architect sin mensajes conserva sus tres enlaces', () => {
    expect(enlacesEfectivos(ea().diagramas[0]!)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// El viaje entero: fichero → documento compartido → otra réplica
// ---------------------------------------------------------------------------

describe('conservación a través del documento compartido', () => {
  it('un diagrama sobrevive entero al viaje hasta otra réplica', () => {
    const original = canonico().diagramas[0]!;
    const aqui = new Y.Doc();
    writeComunicacion(aqui, original, '2026-01-15T10:00:00.000Z');

    // Lo que de verdad viaja: los bytes que el almacén guarda como un blob
    // opaco y que el servidor no interpreta.
    const alli = new Y.Doc();
    Y.applyUpdate(alli, Y.encodeStateAsUpdate(aqui));
    const leidos = readComunicaciones(alli);

    expect(leidos).toHaveLength(1);
    expect(leidos[0]).toEqual({ ...original, importadoEl: '2026-01-15T10:00:00.000Z' });
  });

  it('lo que llega al otro lado sigue siendo íntegro', () => {
    const doc = new Y.Doc();
    writeComunicacion(doc, canonico().diagramas[0]!);
    const otro = new Y.Doc();
    Y.applyUpdate(otro, Y.encodeStateAsUpdate(doc));

    expect(comprobarIntegridad(readComunicaciones(otro)[0]!).problemas).toEqual([]);
  });

  it('reimportar el mismo fichero reemplaza en vez de duplicar', () => {
    const doc = new Y.Doc();
    const diagrama = canonico().diagramas[0]!;
    writeComunicacion(doc, diagrama, '2026-01-01T00:00:00.000Z');
    writeComunicacion(doc, { ...diagrama, nombre: 'Compra corregida' }, '2026-02-01T00:00:00.000Z');

    const leidos = readComunicaciones(doc);
    expect(leidos).toHaveLength(1);
    expect(leidos[0]?.nombre).toBe('Compra corregida');
  });

  it('el fixture de EA también sobrevive: tres objetos, tres enlaces, cero mensajes', () => {
    // El caso que más fácil se pierde al serializar, porque casi todos sus
    // campos están vacíos y un escritor descuidado los omite todos.
    const original = ea().diagramas[0]!;
    const doc = new Y.Doc();
    writeComunicacion(doc, original, '2026-01-01T00:00:00.000Z');

    expect(readComunicaciones(doc)[0]).toEqual({
      ...original,
      importadoEl: '2026-01-01T00:00:00.000Z',
    });
  });

  it('los devuelve del más reciente al más antiguo', () => {
    const doc = new Y.Doc();
    const uno = canonico().diagramas[0]!;
    const otro = ea().diagramas[0]!;
    writeComunicacion(doc, uno, '2026-01-01T00:00:00.000Z');
    writeComunicacion(doc, otro, '2026-03-01T00:00:00.000Z');

    expect(readComunicaciones(doc).map((d) => d.id)).toEqual([otro.id, uno.id]);
  });

  it('una entrada corrupta se omite sin llevarse el resto por delante', () => {
    // Un documento compartido puede traer cualquier cosa: una versión anterior
    // del programa, una edición a medias. Que el proyecto entero deje de
    // abrirse por un mensaje mal formado sería un intercambio pésimo.
    const doc = new Y.Doc();
    writeComunicacion(doc, canonico().diagramas[0]!, '2026-01-01T00:00:00.000Z');
    doc.getMap('diagrama.comunicaciones').set('basura', 'esto no es un mapa');

    expect(readComunicaciones(doc)).toHaveLength(1);
  });

  it('dos réplicas que importan a la vez acaban con los dos diagramas', () => {
    const aqui = new Y.Doc();
    const alli = new Y.Doc();
    writeComunicacion(aqui, canonico().diagramas[0]!, '2026-01-01T00:00:00.000Z');
    writeComunicacion(alli, ea().diagramas[0]!, '2026-01-02T00:00:00.000Z');

    // Sin haberse visto antes, que es el caso que decide si el tipo raíz está
    // bien elegido: con un mapa anidado creado por las dos, una de las dos
    // importaciones desaparecería.
    Y.applyUpdate(aqui, Y.encodeStateAsUpdate(alli));
    Y.applyUpdate(alli, Y.encodeStateAsUpdate(aqui));

    expect(readComunicaciones(aqui)).toHaveLength(2);
    expect(readComunicaciones(alli).map((d) => d.id)).toEqual(
      readComunicaciones(aqui).map((d) => d.id),
    );
  });
});

// ---------------------------------------------------------------------------
// Integración: la importación completa
// ---------------------------------------------------------------------------

describe('leerXmi devuelve las dos mitades de la importación', () => {
  const texto = (ruta: string): string => decodificarXml(readFileSync(ruta));

  it('del fichero canónico saca a la vez los métodos y el diagrama', () => {
    const resultado = leerXmi(
      texto(`${AQUI}fixtures/uml-251-comunicacion.xmi`),
      createDiagram({ name: 'Proyecto' }),
      'uml-251-comunicacion.xmi',
    );

    expect(resultado.aplicable).toBe(true);
    // La mitad que traduce: los mensajes recibidos se vuelven operaciones.
    expect(resultado.operaciones.filter((o) => o.op === 'addMethod').length).toBeGreaterThan(0);
    // La mitad que conserva: el diagrama entero, con su numeración.
    expect(resultado.diagramas).toHaveLength(1);
    expect(resultado.diagramas[0]?.mensajes).toHaveLength(6);
    expect(resultado.diagramas[0]?.fuente).toBe('uml-251-comunicacion.xmi');
    expect(resultado.problemas).toEqual([]);
  });

  it('un fichero con diagrama y sin operaciones ya no se descarta', () => {
    // El fixture de EA no tiene ni un mensaje, así que no produce ninguna
    // operación. La versión anterior lo rechazaba entero y se llevaba por
    // delante un diagrama perfectamente bueno.
    const resultado = leerXmi(
      texto(`${AQUI}fixtures/ea-comunicacion.xmi`),
      createDiagram({ name: 'Proyecto' }),
      'ea-comunicacion.xmi',
    );

    expect(resultado.aplicable).toBe(true);
    expect(resultado.diagramas).toHaveLength(1);
    expect(resultado.diagramas[0]?.participantes).toHaveLength(3);
  });

  it('un XMI que no es ni una cosa ni la otra sigue sin ser aplicable', () => {
    const resultado = leerXmi(
      '<?xml version="1.0"?><xmi:XMI xmlns:xmi="http://schema.omg.org/spec/XMI/2.1"/>',
      createDiagram({ name: 'Proyecto' }),
    );

    expect(resultado.aplicable).toBe(false);
    expect(resultado.diagramas).toEqual([]);
  });
});
