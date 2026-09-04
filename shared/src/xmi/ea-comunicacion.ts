import {
  argumentosDelMensaje,
  enlacesDe,
  nombreDelMensaje,
  operacionesPorClase,
  type CasoDeUso,
  type Estereotipo,
  type Participante,
} from './analisis.js';
import { Xml } from './escritor.js';

/**
 * Escritura de un diagrama de comunicación que Enterprise Architect **dibuja**.
 *
 * POR QUÉ ESTO NO ES `export.ts` OTRA VEZ. El exportador de diagramas de clases
 * escribe UML estándar y deja escrito, en su cabecera, que la geometría no viaja
 * a EA: al importar, los elementos aparecen en el navegador de proyecto y el
 * diagrama hay que recomponerlo arrastrando cajas. Eso era cierto mientras no
 * hubiera un fichero real de EA que enseñara cómo guarda sus diagramas. Ahora lo
 * hay —`fixtures/ea-comunicacion.xmi`, exportado por el propio usuario— y de él
 * sale la plantilla de este módulo: el bloque
 * `<xmi:Extension extender="Enterprise Architect">` con sus `<elements>`,
 * `<connectors>` y, sobre todo, `<diagrams>`. Ese último es el que hace que EA
 * abra el fichero y **ya esté el diagrama montado**.
 *
 * Nada aquí está inventado por analogía con la especificación. Cada atributo que
 * se emite aparece en ese fichero. Lo único que se ha deducido y no se ha podido
 * contrastar está marcado abajo, en `estereotipo`.
 *
 * LOS MENSAJES SE ESCRIBEN DOS VECES, A PROPÓSITO. En el fichero de EA no hay ni
 * un solo `uml:Message`: los mensajes de una comunicación viven únicamente como
 * conectores `ea_type="Collaboration"` dentro de la extensión. Un fichero así lo
 * dibuja EA y no lo entiende nadie más —tampoco nuestro propio importador, que
 * lee `uml:Message`—. De modo que se emiten las dos formas:
 *
 * - `uml:Message` con sus `uml:OccurrenceSpecification` en el cuerpo estándar.
 *   Es lo que hace que el fichero se pueda **verificar sin abrir EA**, pasándolo
 *   por `leerXmi`, y lo que hace que otra herramienta vea algo.
 * - Conectores de la extensión con `privatedata4` (el número de secuencia),
 *   `message_link` (el enlace por el que va el mensaje) y `<labels lt="…"/>`.
 *   Es lo que hace que EA lo dibuje.
 *
 * Escribir las dos es estrictamente mejor que lo que exporta EA. El riesgo es
 * que EA, al ver `uml:Message`, cree además unos elementos «Message» sueltos en
 * el navegador de proyecto. Si molesta, `mensajesEstandar: false` los quita sin
 * tocar nada más — pero entonces el fichero deja de poder verificarse aquí.
 *
 * IDENTIFICADORES DETERMINISTAS Y SIN `node:crypto`. `shared/` lo empaqueta
 * también el navegador, así que aquí no entra un módulo de Node. Los GUID salen
 * de un FNV-1a de 32 bits sobre una clave semántica (`CU1:clase:pantalla`), lo
 * que da dos propiedades que importan: regenerar el catálogo dos veces produce
 * ficheros idénticos —el `diff` solo enseña lo que cambió de verdad— y volver a
 * importar en EA actualiza los elementos en vez de duplicarlos, porque EA
 * empareja por `xmi:id`.
 *
 * CODIFICACIÓN. El fichero de EA declara `windows-1252`. Aquí se declara
 * `UTF-8`, que es lo que realmente se escribe: los nombres llevan tildes y
 * mentir en la declaración las rompe. EA lee UTF-8 sin problema.
 */

const CABECERA = '<?xml version="1.0" encoding="UTF-8"?>';
const NS_XMI = 'http://schema.omg.org/spec/XMI/2.1';
const NS_UML = 'http://schema.omg.org/spec/UML/2.1';
const BIBLIOTECA_UML = 'http://schema.omg.org/spec/UML/2.1/uml.xml#';

/** Fecha por defecto de los sellos de EA. Fija, para que el fichero sea reproducible. */
const FECHA_POR_DEFECTO = '2026-01-01 00:00:00';

/**
 * Estilo del lienzo, copiado tal cual del fichero de EA.
 *
 * No es contenido nuestro: es la configuración por defecto de un diagrama de
 * colaboración. Se copia entera en vez de escribir solo lo que parece
 * relevante porque no hay forma de saber cuál de estas cuarenta claves es la
 * que EA echa de menos, y el coste de copiarlas todas es cero.
 */
const ESTILO_1 =
  'ShowPrivate=1;ShowProtected=1;ShowPublic=1;HideRelationships=0;Locked=0;Border=1;' +
  'HighlightForeign=1;PackageContents=1;SequenceNotes=0;ScalePrintImage=0;PPgs.cx=1;PPgs.cy=1;' +
  'DocSize.cx=827;DocSize.cy=1169;ShowDetails=0;Orientation=P;Zoom=100;ShowTags=0;OpParams=1;' +
  'VisibleAttributeDetail=0;ShowOpRetType=1;ShowIcons=1;CollabNums=0;HideProps=0;ShowReqs=0;' +
  'ShowCons=0;PaperSize=9;HideParents=0;UseAlias=0;HideAtts=0;HideOps=0;HideStereo=0;' +
  'HideElemStereo=0;ShowTests=0;ShowMaint=0;ConnectorNotation=UML 2.1;ExplicitNavigability=0;' +
  'ShowShape=1;AllDockable=0;AdvancedElementProps=1;AdvancedFeatureProps=1;' +
  'AdvancedConnectorProps=1;m_bElementClassifier=1;SPT=1;ShowNotes=0;SuppressBrackets=0;' +
  'SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;NoFullScope=1;';

const ESTILO_2 =
  'ExcludeRTF=0;DocAll=0;HideQuals=0;AttPkg=1;ShowTests=0;ShowMaint=0;SuppressFOC=1;' +
  'MatrixActive=0;SwimlanesActive=1;KanbanActive=0;MatrixLineWidth=1;MatrixLineClr=0;' +
  'MatrixLocked=0;TConnectorNotation=UML 2.1;TExplicitNavigability=0;AdvancedElementProps=1;' +
  'AdvancedFeatureProps=1;AdvancedConnectorProps=1;m_bElementClassifier=1;SPT=1;MDGDgm=;' +
  'STBLDgm=;ShowNotes=0;VisibleAttributeDetail=0;ShowOpRetType=1;SuppressBrackets=0;' +
  'SuppConnectorLabels=0;PrintPageHeadFoot=0;ShowAsList=0;NoFullScope=1;SuppressedCompartments=;' +
  'Theme=:119;';

const APARIENCIA_ELEMENTO =
  'BackColor=-1;BorderColor=-1;BorderWidth=-1;FontColor=-1;VSwimLanes=1;HSwimLanes=1;BorderStyle=0;';

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------

const ANCHO = 150;
const ALTO = 60;
const PASO_X = 200;
const PASO_Y = 150;
const X0 = 60;
const Y0 = 80;
const COLUMNAS = 4;

interface Caja {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Coloca los objetos en filas de cuatro, en serpentina.
 *
 * En un diagrama de comunicación de análisis los participantes vienen ya en el
 * orden en que se hablan —actor, frontera, control, entidad—, así que ponerlos
 * en fila es lo que menos líneas cruza. A partir del quinto hay que bajar de
 * fila, y bajar volviendo hacia atrás mantiene juntos al cuarto y al quinto, que
 * es justo la pareja que se acaba de separar. En rejilla recta esos dos
 * acabarían en esquinas opuestas y la línea cruzaría el diagrama entero.
 */
function caja(indice: number): Caja {
  const fila = Math.floor(indice / COLUMNAS);
  const dentro = indice % COLUMNAS;
  const columna = fila % 2 === 0 ? dentro : COLUMNAS - 1 - dentro;
  const left = X0 + columna * PASO_X;
  const top = Y0 + fila * PASO_Y;
  return { left, top, right: left + ANCHO, bottom: top + ALTO };
}

function centro(c: Caja): { x: number; y: number } {
  return { x: (c.left + c.right) / 2, y: (c.top + c.bottom) / 2 };
}

/**
 * Por qué lado de la caja sale la línea: 1 arriba, 2 derecha, 3 abajo, 4
 * izquierda. EA lo recalcula si no le cuadra, pero acertar de entrada evita que
 * la primera apertura del diagrama enseñe las líneas dando un rodeo.
 */
function lado(a: Caja, b: Caja): number {
  const ca = centro(a);
  const cb = centro(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 2 : 4;
  return dy >= 0 ? 3 : 1;
}

// ---------------------------------------------------------------------------
// Identificadores
// ---------------------------------------------------------------------------

/**
 * FNV-1a de 32 bits. `Math.imul` porque la multiplicación de JavaScript pierde
 * los bits altos en cuanto el producto pasa de 2^53 y el hash dejaría de serlo.
 */
function fnv1a(texto: string, semilla: number): number {
  let h = (0x811c9dc5 ^ semilla) >>> 0;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hex(texto: string, semilla: number): string {
  return fnv1a(texto, semilla).toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Reparte identificadores con la forma que usa EA y garantiza que no se repiten.
 *
 * Un hash de 32 bits repartido en cinco trozos hace muy improbable la colisión
 * en un diagrama de diez elementos, pero «muy improbable» no es «imposible» y el
 * síntoma sería malísimo: dos cajas fundidas en una, en un fichero que por lo
 * demás abre bien. Sale más barato llevar la cuenta y volver a intentarlo con un
 * sufijo que depurar eso el día de la defensa.
 */
class Guids {
  private readonly asignados = new Map<string, string>();
  private readonly usados = new Set<string>();

  /** GUID en la forma `EAID_XXXXXXXX_XXXX_XXXX_XXXX_XXXXXXXXXXXX`. */
  para(clave: string): string {
    const previo = this.asignados.get(clave);
    if (previo !== undefined) return previo;

    let intento = 0;
    let cuerpo = this.cuerpo(clave);
    while (this.usados.has(cuerpo)) {
      intento += 1;
      cuerpo = this.cuerpo(`${clave}#${intento}`);
    }
    this.usados.add(cuerpo);

    const id = `EAID_${cuerpo}`;
    this.asignados.set(clave, id);
    return id;
  }

  /** El mismo identificador con la forma `{XXXXXXXX-XXXX-…}` que EA usa en `ea_guid`. */
  llaves(clave: string): string {
    return `{${this.para(clave).slice('EAID_'.length).replace(/_/g, '-')}}`;
  }

  /** Igual, pero con el prefijo `EAPK_` que EA reserva a los paquetes. */
  paquete(clave: string): string {
    return `EAPK_${this.para(clave).slice('EAID_'.length)}`;
  }

  /**
   * Los ocho hexadecimales sueltos que el bloque de diagrama usa como `DUID` de
   * un objeto y como `SOID`/`EOID` de una línea. Son distintos del `xmi:id` y
   * distintos entre sí: en el fichero de EA, el mismo objeto tiene `DUID`
   * `6B4CBD03` y aparece como `EOID=E3D7E0F0` en las tres líneas que le llegan.
   */
  corto(clave: string, papel: 'DUID' | 'OID'): string {
    return hex(`${clave}|${papel}`, papel === 'DUID' ? 7 : 8);
  }

  private cuerpo(clave: string): string {
    const a = hex(clave, 1);
    const b = hex(clave, 2).slice(0, 4);
    const c = hex(clave, 3).slice(0, 4);
    const d = hex(clave, 4).slice(0, 4);
    const e = hex(clave, 5) + hex(clave, 6).slice(0, 4);
    return `${a}_${b}_${c}_${d}_${e}`;
  }
}

// ---------------------------------------------------------------------------
// Correspondencia entre nuestro vocabulario y el de EA
// ---------------------------------------------------------------------------

/**
 * Qué metaclase de UML recibe cada participante.
 *
 * El actor se emite como `uml:Actor` para que EA lo dibuje como el monigote y no
 * como una caja más; el resto son clases con estereotipo. Es la misma distinción
 * que hace la plantilla de análisis de robustez de Jacobson, que es de donde
 * salen `boundary`, `control` y `entity`.
 */
function metaclase(estereotipo: Estereotipo): { uml: string; sType: string } {
  return estereotipo === 'actor'
    ? { uml: 'uml:Actor', sType: 'Actor' }
    : { uml: 'uml:Class', sType: 'Class' };
}

// ---------------------------------------------------------------------------

export interface OpcionesEa {
  readonly autor?: string;
  /** Sello de fecha de EA, con la forma `YYYY-MM-DD HH:MM:SS`. */
  readonly fecha?: string;
  /**
   * Emitir también los `uml:Message` del cuerpo estándar. Por defecto sí; en la
   * cabecera del módulo está explicado qué se pierde al quitarlos.
   */
  readonly mensajesEstandar?: boolean;
}

interface Objeto {
  readonly participante: Participante;
  /** `xmi:id` de la clase de análisis. */
  readonly clase: string;
  /** `xmi:id` de la instancia que se dibuja. */
  readonly instancia: string;
  /** `xmi:id` de la propiedad de la colaboración que la línea de vida representa. */
  readonly rol: string;
  /** `xmi:id` de la línea de vida. */
  readonly linea: string;
  readonly localId: number;
  readonly caja: Caja;
}

interface Enlace {
  readonly id: string;
  readonly de: Objeto;
  readonly a: Objeto;
  readonly localId: number;
}

interface Mensaje {
  readonly id: string;
  readonly numero: string;
  readonly texto: string;
  readonly de: Objeto;
  readonly a: Objeto;
  readonly enlace: Enlace;
  readonly retorno: boolean;
  readonly localId: number;
  /** Cuántos mensajes van por el mismo enlace y cuál es este, para no apilar rótulos. */
  readonly posicion: number;
  readonly total: number;
}

/**
 * Un caso de uso, convertido en el `.xmi` de su diagrama de comunicación.
 *
 * No valida: eso lo hace `revisarModelo` sobre el catálogo entero, antes de
 * llegar aquí. Si a este punto llega un caso con un paso que apunta a un alias
 * que no existe, lo que sale es un fichero roto — y el orden correcto de las
 * comprobaciones es revisar los catorce casos de una vez y no descubrir el fallo
 * en el séptimo fichero.
 */
export function exportarComunicacionEa(caso: CasoDeUso, opciones: OpcionesEa = {}): string {
  const autor = opciones.autor ?? 'uml-colaborativo';
  const fecha = opciones.fecha ?? FECHA_POR_DEFECTO;
  const conMensajesEstandar = opciones.mensajesEstandar ?? true;

  const guids = new Guids();
  const clave = (sufijo: string): string => `${caso.id}:${sufijo}`;

  const idRaiz = guids.paquete(clave('paquete'));
  const idClases = guids.paquete(clave('paquete:clases'));
  const idObjetos = guids.paquete(clave('paquete:objetos'));
  const idColaboracion = guids.para(clave('colaboracion'));
  const idInteraccion = guids.para(clave('interaccion'));
  const idDiagrama = guids.para(clave('diagrama'));

  // ---- el mundo, resuelto una sola vez -------------------------------------

  let siguienteLocal = 1;
  const objetos: Objeto[] = caso.participantes.map((participante, indice) => ({
    participante,
    clase: guids.para(clave(`clase:${participante.alias}`)),
    instancia: guids.para(clave(`objeto:${participante.alias}`)),
    rol: guids.para(clave(`rol:${participante.alias}`)),
    linea: guids.para(clave(`linea:${participante.alias}`)),
    localId: siguienteLocal++,
    caja: caja(indice),
  }));

  const porAlias = new Map(objetos.map((o) => [o.participante.alias, o]));
  const objeto = (alias: string): Objeto => {
    const encontrado = porAlias.get(alias);
    if (encontrado === undefined) {
      throw new Error(`El caso ${caso.id} usa el alias «${alias}», que no es participante.`);
    }
    return encontrado;
  };

  let siguienteConector = 1;
  const enlaces: Enlace[] = enlacesDe(caso).map((par) => ({
    id: guids.para(clave(`enlace:${[par.de, par.a].sort().join('-')}`)),
    de: objeto(par.de),
    a: objeto(par.a),
    localId: siguienteConector++,
  }));

  const enlacePorPar = new Map(
    enlaces.map((e) => [[e.de.participante.alias, e.a.participante.alias].sort().join('|'), e]),
  );

  // Cuántos mensajes comparte cada enlace: hace falta antes de asignar sitio a
  // ninguno, porque el desplazamiento de un rótulo depende de cuántos hermanos
  // tenga encima y debajo.
  const porEnlace = new Map<string, number>();
  for (const paso of caso.pasos) {
    if (paso.de === paso.a) continue;
    const par = [paso.de, paso.a].sort().join('|');
    porEnlace.set(par, (porEnlace.get(par) ?? 0) + 1);
  }
  const colocados = new Map<string, number>();

  const mensajes: Mensaje[] = [];
  for (const paso of caso.pasos) {
    if (paso.de === paso.a) continue;
    const par = [paso.de, paso.a].sort().join('|');
    const enlace = enlacePorPar.get(par);
    if (enlace === undefined) continue;
    const posicion = colocados.get(par) ?? 0;
    colocados.set(par, posicion + 1);
    mensajes.push({
      id: guids.para(clave(`mensaje:${paso.numero}`)),
      numero: paso.numero,
      texto: paso.mensaje,
      de: objeto(paso.de),
      a: objeto(paso.a),
      enlace,
      retorno: paso.retorno === true,
      localId: siguienteConector++,
      posicion,
      total: porEnlace.get(par) ?? 1,
    });
  }

  const operaciones = operacionesPorClase(caso);

  // ---- cuerpo estándar -----------------------------------------------------

  const xml = new Xml();
  xml.crudo(CABECERA);
  xml.abrir('xmi:XMI', {
    'xmi:version': '2.1',
    'xmlns:uml': NS_UML,
    'xmlns:xmi': NS_XMI,
  });
  xml.vacio('xmi:Documentation', {
    exporter: 'uml-colaborativo',
    exporterVersion: '6.5',
  });

  xml.abrir('uml:Model', { 'xmi:type': 'uml:Model', name: 'EA_Model', visibility: 'public' });
  xml.abrir('packagedElement', {
    'xmi:type': 'uml:Package',
    'xmi:id': idRaiz,
    name: `${caso.id} - ${caso.nombre}`,
    visibility: 'public',
  });

  // La colaboración: las líneas de vida y, si se piden, los mensajes.
  xml.abrir('packagedElement', {
    'xmi:type': 'uml:Collaboration',
    'xmi:id': idColaboracion,
    name: `Comunicacion_${caso.id}`,
    visibility: 'public',
  });
  xml.abrir('ownedBehavior', {
    'xmi:type': 'uml:Interaction',
    'xmi:id': idInteraccion,
    name: `Interaccion_${caso.id}`,
    visibility: 'public',
  });
  for (const o of objetos) {
    xml.vacio('lifeline', {
      'xmi:type': 'uml:Lifeline',
      'xmi:id': o.linea,
      name: o.participante.alias,
      visibility: 'public',
      represents: o.rol,
    });
  }
  if (conMensajesEstandar) {
    for (const m of mensajes) {
      const envio = guids.para(clave(`envio:${m.numero}`));
      const recibo = guids.para(clave(`recibo:${m.numero}`));
      xml.vacio('fragment', {
        'xmi:type': 'uml:OccurrenceSpecification',
        'xmi:id': envio,
        covered: m.de.linea,
      });
      xml.vacio('fragment', {
        'xmi:type': 'uml:OccurrenceSpecification',
        'xmi:id': recibo,
        covered: m.a.linea,
      });
      xml.vacio('message', {
        'xmi:type': 'uml:Message',
        'xmi:id': m.id,
        name: m.texto,
        visibility: 'public',
        sendEvent: envio,
        receiveEvent: recibo,
        messageSort: m.retorno ? 'reply' : 'synchCall',
      });
    }
  }
  xml.cerrar('ownedBehavior');
  // Cada línea de vida representa una propiedad, y esa propiedad es la que sabe
  // de qué clase es el objeto. Es el camino que sigue nuestro importador y el
  // que sigue EA; sin él la línea de vida no tiene clasificador y el mensaje se
  // descarta por no saberse a quién va.
  for (const o of objetos) {
    xml.abrir('ownedAttribute', { 'xmi:type': 'uml:Property', 'xmi:id': o.rol });
    xml.vacio('type', { 'xmi:idref': o.clase });
    xml.cerrar('ownedAttribute');
  }
  xml.cerrar('packagedElement');

  // Las clases de análisis, con las operaciones deducidas de lo que reciben.
  xml.abrir('packagedElement', {
    'xmi:type': 'uml:Package',
    'xmi:id': idClases,
    name: 'Clases de análisis',
    visibility: 'public',
  });
  for (const o of objetos) {
    const meta = metaclase(o.participante.estereotipo);
    const ops = operaciones.get(o.participante.clase) ?? [];
    if (ops.length === 0) {
      xml.vacio('packagedElement', {
        'xmi:type': meta.uml,
        'xmi:id': o.clase,
        name: o.participante.clase,
        visibility: 'public',
      });
      continue;
    }
    xml.abrir('packagedElement', {
      'xmi:type': meta.uml,
      'xmi:id': o.clase,
      name: o.participante.clase,
      visibility: 'public',
    });
    for (const op of ops) {
      const idOp = guids.para(clave(`op:${o.participante.clase}.${op.nombre}`));
      xml.abrir('ownedOperation', {
        'xmi:id': idOp,
        name: op.nombre,
        visibility: 'public',
        concurrency: 'sequential',
      });
      for (const argumento of op.argumentos) {
        xml.abrir('ownedParameter', {
          'xmi:id': guids.para(clave(`par:${o.participante.clase}.${op.nombre}.${argumento}`)),
          name: argumento,
          direction: 'in',
          isStream: 'false',
          isException: 'false',
          isOrdered: 'false',
          isUnique: 'true',
        });
        xml.vacio('type', {
          'xmi:type': 'uml:PrimitiveType',
          href: `${BIBLIOTECA_UML}String`,
        });
        xml.cerrar('ownedParameter');
      }
      xml.vacio('ownedParameter', {
        'xmi:id': guids.para(clave(`ret:${o.participante.clase}.${op.nombre}`)),
        name: 'return',
        direction: 'return',
        type: 'EAnone_void',
      });
      xml.cerrar('ownedOperation');
    }
    xml.cerrar('packagedElement');
  }
  // Las asociaciones entre clases. En un diagrama de comunicación el enlace se
  // dibuja entre objetos, pero EA quiere además la asociación entre sus clases:
  // sin ella el enlace queda huérfano y no se puede colgar un mensaje de él.
  for (const enlace of enlaces) {
    const idOrigen = guids.para(clave(`asocSrc:${enlace.id}`));
    const idDestino = guids.para(clave(`asocDst:${enlace.id}`));
    const idAsociacion = guids.para(clave(`asoc:${enlace.id}`));
    xml.abrir('packagedElement', {
      'xmi:type': 'uml:Association',
      'xmi:id': idAsociacion,
      visibility: 'public',
    });
    for (const [idExtremo, destino] of [
      [idDestino, enlace.a],
      [idOrigen, enlace.de],
    ] as const) {
      xml.vacio('memberEnd', { 'xmi:idref': idExtremo });
      xml.abrir('ownedEnd', {
        'xmi:type': 'uml:Property',
        'xmi:id': idExtremo,
        visibility: 'public',
        association: idAsociacion,
        isStatic: 'false',
        isReadOnly: 'false',
        isDerived: 'false',
        isOrdered: 'false',
        isUnique: 'true',
        isDerivedUnion: 'false',
        aggregation: 'none',
      });
      xml.vacio('type', { 'xmi:idref': destino.clase });
      xml.cerrar('ownedEnd');
    }
    xml.cerrar('packagedElement');
  }
  xml.cerrar('packagedElement');

  // Los objetos y los enlaces por los que viajan los mensajes.
  xml.abrir('packagedElement', {
    'xmi:type': 'uml:Package',
    'xmi:id': idObjetos,
    name: 'Objetos',
    visibility: 'public',
  });
  for (const o of objetos) {
    xml.vacio('packagedElement', {
      'xmi:type': 'uml:InstanceSpecification',
      'xmi:id': o.instancia,
      name: o.participante.alias,
      visibility: 'public',
      classifier: o.clase,
    });
  }
  for (const enlace of enlaces) {
    xml.abrir('ownedConnector', {
      'xmi:type': 'uml:Connector',
      'xmi:id': enlace.id,
      visibility: 'public',
    });
    xml.vacio('end', {
      'xmi:type': 'uml:ConnectorEnd',
      'xmi:id': guids.para(clave(`extremoA:${enlace.id}`)),
      role: enlace.de.instancia,
    });
    xml.vacio('end', {
      'xmi:type': 'uml:ConnectorEnd',
      'xmi:id': guids.para(clave(`extremoB:${enlace.id}`)),
      role: enlace.a.instancia,
    });
    xml.cerrar('ownedConnector');
  }
  xml.cerrar('packagedElement');

  xml.cerrar('packagedElement');
  xml.cerrar('uml:Model');

  // ---- extensión de Enterprise Architect -----------------------------------

  xml.abrir('xmi:Extension', { extender: 'Enterprise Architect', extenderID: '6.5' });

  const proyecto = (): void => {
    xml.vacio('project', {
      author: autor,
      version: '1.0',
      phase: '1.0',
      created: fecha,
      modified: fecha,
      complexity: '1',
      status: 'Proposed',
    });
  };
  const tiempos = (): void => {
    xml.vacio('times', {
      created: fecha,
      modified: fecha,
      lastloaddate: fecha,
      lastsavedate: fecha,
    });
  };

  xml.abrir('elements');

  const paquete = (
    id: string,
    nombre: string,
    contenedor: string | undefined,
    nombreContenedor: string,
    localId: number,
  ): void => {
    xml.abrir('element', {
      'xmi:idref': id,
      'xmi:type': 'uml:Package',
      name: nombre,
      scope: 'public',
    });
    xml.vacio('model', {
      package2: `EAID_${id.slice('EAPK_'.length)}`,
      package: contenedor,
      tpos: '0',
      ea_localid: String(localId),
      ea_eleType: 'package',
    });
    xml.vacio('properties', {
      isSpecification: 'false',
      sType: 'Package',
      nType: '0',
      scope: 'public',
    });
    proyecto();
    xml.vacio('code', { gentype: '<none>' });
    xml.vacio('style', { appearance: APARIENCIA_ELEMENTO });
    xml.vacio('tags');
    xml.vacio('xrefs');
    xml.vacio('extendedProperties', { tagged: '0', package_name: nombreContenedor });
    xml.vacio('packageproperties', { version: '1.0' });
    xml.vacio('paths');
    tiempos();
    xml.vacio('flags', {
      iscontrolled: 'FALSE',
      isprotected: 'FALSE',
      batchsave: '0',
      batchload: '0',
      usedtd: 'FALSE',
      logxml: 'FALSE',
    });
    xml.cerrar('element');
  };

  paquete(idRaiz, `${caso.id} - ${caso.nombre}`, undefined, 'Model', siguienteLocal++);
  paquete(idClases, 'Clases de análisis', idRaiz, `${caso.id} - ${caso.nombre}`, siguienteLocal++);
  paquete(idObjetos, 'Objetos', idRaiz, `${caso.id} - ${caso.nombre}`, siguienteLocal++);

  // Las clases de análisis.
  for (const o of objetos) {
    const meta = metaclase(o.participante.estereotipo);
    const ops = operaciones.get(o.participante.clase) ?? [];
    xml.abrir('element', {
      'xmi:idref': o.clase,
      'xmi:type': meta.uml,
      name: o.participante.clase,
      scope: 'public',
    });
    xml.vacio('model', {
      package: idClases,
      tpos: '0',
      ea_localid: String(siguienteLocal++),
      ea_eleType: 'element',
    });
    // `stereotype` aquí es el único atributo de este módulo que no aparece en el
    // fichero de EA que tenemos —el suyo dibuja componentes, que no llevan
    // estereotipo—. Es la forma documentada por Sparx y la que usan sus propios
    // ficheros de clases; queda por contrastar contra `ea-clases.xmi`. Si
    // fallara, lo que se pierde son las etiquetas «boundary»/«control»/«entity»,
    // no el diagrama.
    xml.vacio('properties', {
      isSpecification: 'false',
      sType: meta.sType,
      nType: '0',
      stereotype: o.participante.estereotipo === 'actor' ? undefined : o.participante.estereotipo,
      scope: 'public',
      isRoot: 'false',
      isLeaf: 'false',
      isAbstract: 'false',
    });
    proyecto();
    xml.vacio('code', { gentype: '<none>' });
    xml.vacio('style', { appearance: APARIENCIA_ELEMENTO });
    xml.vacio('tags');
    xml.vacio('xrefs');
    xml.vacio('extendedProperties', { tagged: '0', package_name: 'Clases de análisis' });
    if (ops.length > 0) {
      xml.abrir('operations');
      ops.forEach((op, posicion) => {
        const idOp = guids.para(clave(`op:${o.participante.clase}.${op.nombre}`));
        xml.abrir('operation', { 'xmi:idref': idOp, name: op.nombre, scope: 'Public' });
        xml.vacio('properties', { position: String(posicion) });
        xml.vacio('stereotype');
        xml.vacio('model', {
          ea_guid: guids.llaves(clave(`op:${o.participante.clase}.${op.nombre}`)),
          ea_localid: String(posicion + 1),
        });
        xml.vacio('type', {
          type: 'void',
          const: 'false',
          static: 'false',
          isAbstract: 'false',
          synchronised: '0',
          concurrency: 'Sequential',
          returnarray: '0',
          pure: '0',
          isQuery: 'false',
        });
        xml.vacio('behaviour');
        xml.vacio('code');
        xml.vacio('style');
        xml.vacio('styleex');
        xml.vacio('documentation');
        xml.vacio('tags');
        xml.abrir('parameters');
        for (const argumento of op.argumentos) {
          xml.abrir('parameter', {
            'xmi:idref': guids.para(
              clave(`par:${o.participante.clase}.${op.nombre}.${argumento}`),
            ),
            visibility: 'public',
          });
          xml.vacio('properties', {
            pos: '0',
            type: 'String',
            const: 'false',
            ea_guid: guids.llaves(clave(`par:${o.participante.clase}.${op.nombre}.${argumento}`)),
          });
          xml.vacio('style');
          xml.vacio('styleex');
          xml.vacio('documentation');
          xml.vacio('tags');
          xml.vacio('xrefs');
          xml.cerrar('parameter');
        }
        xml.cerrar('parameters');
        xml.vacio('xrefs');
        xml.cerrar('operation');
      });
      xml.cerrar('operations');
    }
    xml.cerrar('element');
  }

  // Los objetos, cada uno con la lista de líneas que le tocan.
  for (const o of objetos) {
    const meta = metaclase(o.participante.estereotipo);
    xml.abrir('element', {
      'xmi:idref': o.instancia,
      'xmi:type': meta.uml,
      name: o.participante.alias,
      scope: 'public',
      classifier: o.clase,
    });
    xml.vacio('model', {
      package: idObjetos,
      tpos: '0',
      ea_localid: String(o.localId),
      ea_eleType: 'element',
    });
    xml.vacio('properties', {
      isSpecification: 'false',
      sType: meta.sType,
      nType: '0',
      classname: o.participante.clase,
      scope: 'public',
      isRoot: 'false',
      isLeaf: 'false',
      isAbstract: 'false',
    });
    proyecto();
    xml.vacio('code', { gentype: '<none>' });
    xml.vacio('style', { appearance: APARIENCIA_ELEMENTO });
    xml.vacio('tags');
    xml.vacio('xrefs');
    xml.vacio('extendedProperties', { tagged: '0', package_name: 'Objetos' });
    xml.abrir('links');
    for (const enlace of enlaces) {
      if (enlace.de !== o && enlace.a !== o) continue;
      xml.vacio('Association', {
        'xmi:id': enlace.id,
        start: enlace.de.instancia,
        end: enlace.a.instancia,
      });
    }
    for (const m of mensajes) {
      if (m.de !== o && m.a !== o) continue;
      xml.vacio('Collaboration', {
        'xmi:id': m.id,
        start: m.de.instancia,
        end: m.a.instancia,
      });
    }
    xml.cerrar('links');
    xml.cerrar('element');
  }

  xml.cerrar('elements');

  // ---- conectores ----------------------------------------------------------

  xml.abrir('connectors');

  const extremo = (
    etiqueta: 'source' | 'target',
    o: Objeto,
    navegable: boolean,
    conAgregacion: boolean,
  ): void => {
    xml.abrir(etiqueta, { 'xmi:idref': o.instancia });
    xml.vacio('model', {
      ea_localid: String(o.localId),
      type: metaclase(o.participante.estereotipo).sType,
      name: o.participante.alias,
    });
    xml.vacio('role', { visibility: 'Public', targetScope: 'instance' });
    xml.vacio('type', {
      aggregation: conAgregacion ? 'none' : undefined,
      containment: 'Unspecified',
    });
    xml.vacio('constraints');
    xml.vacio('modifiers', {
      isOrdered: 'false',
      changeable: 'none',
      isNavigable: navegable ? 'true' : 'false',
    });
    xml.vacio('style', {
      value:
        'Union=0;Derived=0;AllowDuplicates=0;Owned=0;Navigable=' +
        (navegable ? 'Navigable' : 'Unspecified') +
        ';',
    });
    xml.vacio('documentation');
    xml.vacio('xrefs');
    xml.vacio('tags');
    xml.cerrar(etiqueta);
  };

  for (const enlace of enlaces) {
    xml.abrir('connector', { 'xmi:idref': enlace.id });
    extremo('source', enlace.de, false, true);
    extremo('target', enlace.a, false, true);
    xml.vacio('model', { ea_localid: String(enlace.localId) });
    xml.vacio('properties', { ea_type: 'Association', direction: 'Unspecified' });
    xml.vacio('modifiers', { isRoot: 'false', isLeaf: 'false' });
    xml.vacio('parameterSubstitutions');
    xml.vacio('documentation');
    xml.vacio('appearance', {
      linemode: '3',
      linecolor: '-1',
      linewidth: '0',
      seqno: '0',
      headStyle: '0',
      lineStyle: '0',
    });
    xml.vacio('labels');
    xml.vacio('extendedProperties', { virtualInheritance: '0' });
    xml.vacio('style');
    xml.vacio('xrefs');
    xml.vacio('tags');
    xml.cerrar('connector');
  }

  for (const m of mensajes) {
    const argumentos = argumentosDelMensaje(m.texto);
    xml.abrir('connector', { 'xmi:idref': m.id, name: m.texto });
    extremo('source', m.de, false, false);
    extremo('target', m.a, true, true);
    xml.vacio('model', { ea_localid: String(m.localId) });
    xml.vacio('properties', {
      name: m.texto,
      ea_type: 'Collaboration',
      direction: 'Source -> Destination',
    });
    xml.vacio('documentation');
    xml.vacio('appearance', {
      linemode: '3',
      linecolor: '-1',
      linewidth: '0',
      seqno: String(m.localId),
      headStyle: '0',
      lineStyle: '0',
    });
    // El rótulo que se lee en el diagrama. El número va delante porque en una
    // comunicación el orden no se deduce de la posición: es el número o nada.
    xml.vacio('labels', { lt: `${m.numero}: ${m.texto}` });
    xml.vacio('extendedProperties', {
      stateflags: `IsReturn=${m.retorno ? 'true' : 'false'};`,
      virtualInheritance: '0',
      // El mensaje no flota: va montado sobre un enlace concreto, y EA lo dibuja
      // pegado a esa línea. Sin `message_link` el mensaje entra pero no aparece.
      message_link: m.enlace.id,
      privatedata1: m.retorno ? 'Asynchronous' : 'Synchronous',
      privatedata2: `retval=void;params=;paramsDlg=${argumentos.join(',')};`,
      privatedata3: m.retorno ? 'Return' : 'Call',
      privatedata4: m.numero,
    });
    xml.vacio('style');
    xml.vacio('xrefs');
    xml.vacio('tags');
    xml.cerrar('connector');
  }

  xml.cerrar('connectors');

  // `EAnone_void` es el tipo de retorno al que apuntan todas las operaciones. Si
  // no se declara, EA lo importa como una referencia rota.
  xml.abrir('primitivetypes');
  xml.abrir('packagedElement', {
    'xmi:type': 'uml:Package',
    'xmi:id': 'EAPrimitiveTypesPackage',
    name: 'EA_PrimitiveTypes_Package',
    visibility: 'public',
  });
  xml.abrir('packagedElement', {
    'xmi:type': 'uml:Package',
    'xmi:id': 'EAnoneTypesPackage',
    name: 'EA_none_Types_Package',
    visibility: 'public',
  });
  xml.vacio('packagedElement', {
    'xmi:type': 'uml:PrimitiveType',
    'xmi:id': 'EAnone_void',
    name: 'void',
    visibility: 'public',
  });
  xml.cerrar('packagedElement');
  xml.cerrar('packagedElement');
  xml.cerrar('primitivetypes');

  // ---- el diagrama, que es lo que distingue esto de un volcado de elementos --

  xml.abrir('diagrams');
  xml.abrir('diagram', { 'xmi:id': idDiagrama });
  xml.vacio('model', { package: idRaiz, localID: '1', owner: idRaiz });
  xml.vacio('properties', {
    name: `Comunicación - ${caso.id} ${caso.nombre}`,
    type: 'Collaboration',
  });
  xml.vacio('project', { author: autor, version: '1.0', created: fecha, modified: fecha });
  xml.vacio('style1', { value: ESTILO_1 });
  xml.vacio('style2', { value: ESTILO_2 });
  xml.vacio('swimlanes', {
    value:
      'locked=false;orientation=0;width=0;inbar=false;names=false;color=-1;bold=false;fcol=0;' +
      'tcol=-1;ofCol=-1;ufCol=-1;hl=0;ufh=0;hh=0;cls=0;bw=0;hli=0;',
  });
  xml.vacio('matrixitems', {
    value:
      'locked=false;matrixactive=false;swimlanesactive=true;kanbanactive=false;width=1;' +
      'clrLine=0;',
  });
  xml.vacio('extendedProperties');
  xml.abrir('elements');

  const oid = (o: Objeto): string => guids.corto(o.instancia, 'OID');

  objetos.forEach((o, indice) => {
    const c = o.caja;
    xml.vacio('element', {
      geometry: `Left=${c.left};Top=${c.top};Right=${c.right};Bottom=${c.bottom};`,
      subject: o.instancia,
      seqno: String(indice + 1),
      style: `DUID=${guids.corto(o.instancia, 'DUID')};`,
    });
  });

  const estiloLinea = (de: Objeto, a: Objeto): string =>
    `Mode=3;EOID=${oid(a)};SOID=${oid(de)};Color=-1;LWidth=0;Hidden=0;`;

  for (const enlace of enlaces) {
    xml.vacio('element', {
      geometry:
        `EDGE=${lado(enlace.de.caja, enlace.a.caja)};` +
        '$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;Path=;',
      subject: enlace.id,
      style: estiloLinea(enlace.de, enlace.a),
    });
  }

  for (const m of mensajes) {
    // Varios mensajes por el mismo enlace se apilan: sin este desplazamiento se
    // dibujan uno encima de otro y el diagrama queda ilegible justo donde más
    // información hay. Treinta píxeles es lo que separa los dos rótulos que
    // comparten enlace en el fichero de EA.
    const desplazamiento = Math.round((m.posicion - (m.total - 1) / 2) * 30);
    xml.vacio('element', {
      geometry:
        `SX=0;SY=${desplazamiento};EX=0;EY=${desplazamiento};` +
        `EDGE=${lado(m.de.caja, m.a.caja)};` +
        '$LLB=;LLT=;LMT=;LMB=;LRT=;LRB=;IRHS=;ILHS=;Path=;',
      subject: m.id,
      style: `Mode=1;EOID=${oid(m.a)};SOID=${oid(m.de)};Color=-1;LWidth=0;Hidden=0;`,
    });
  }

  xml.cerrar('elements');
  xml.cerrar('diagram');
  xml.cerrar('diagrams');

  xml.cerrar('xmi:Extension');
  xml.cerrar('xmi:XMI');

  return xml.texto();
}

/**
 * Nombre de fichero para el diagrama de un caso de uso.
 *
 * `CU1-comunicacion.xmi`. Sin tildes ni espacios: estos ficheros se acaban
 * pasando por correo, por WhatsApp y por un pendrive a la máquina donde está
 * instalado EA, y cada uno de esos saltos es una ocasión de que un nombre con
 * acentos llegue roto.
 */
export function nombreDeFichero(caso: CasoDeUso, tipo: string): string {
  return `${caso.id}-${tipo}.xmi`;
}

/** Sólo para las pruebas: la caja que le toca al participante número `indice`. */
export const _cajaDePrueba = caja;
