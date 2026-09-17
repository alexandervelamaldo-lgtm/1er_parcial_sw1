import type {
  ClaseDeMensaje,
  DiagramaComunicacionUml,
  EnlaceUml,
  MensajeUml,
  ParticipanteUml,
} from '../model/comunicacion-uml.js';
import { compararNumeros } from '../model/comunicacion-uml.js';
import { idDe, indexarPorId, refDe, tipoUml, type AvisoXmi } from './comun.js';
import { analizarEtiqueta } from './etiqueta-mensaje.js';
import { attr, descendientes, hijos, type XmlNode } from './xml.js';

/**
 * Lee de un XMI el diagrama de comunicación **entero**, para guardarlo y
 * dibujarlo.
 *
 * EN QUÉ SE DIFERENCIA DE `comunicacion.ts`. Aquel lector traduce: convierte
 * los mensajes en métodos y los enlaces en dependencias del diagrama de clases,
 * y tira el resto, empezando por el orden de los mensajes. Hizo bien mientras
 * el proyecto solo tenía un documento —un diagrama de clases—, porque un
 * diagrama de comunicación no tenía dónde vivir. Ahora sí lo tiene, así que
 * este lector no traduce nada: devuelve los objetos, las flechas y su
 * numeración tal y como venían.
 *
 * Los dos conviven y los dos se ejecutan sobre el mismo fichero, a propósito.
 * Importar un diagrama de comunicación sigue debiendo añadir los métodos a las
 * clases —es la mitad útil de la operación— y ahora además conserva el
 * diagrama. Lo que no puede pasar es que uno de los dos cambie de criterio sin
 * el otro, y por eso el despiece de las etiquetas está en un tercer fichero
 * (`etiqueta-mensaje.ts`) que usan ambos.
 *
 * DIALECTOS QUE ACEPTA, que son los dos que se pidieron:
 *
 * - **Enterprise Architect, XMI 2.1.** Es el que hay delante: el fixture
 *   `fixtures/ea-comunicacion.xmi` es una exportación real de Sparx EA 6.5, en
 *   `windows-1252`, y varias de las decisiones de abajo están tomadas por lo
 *   que hace ese fichero y no por lo que dice el estándar.
 * - **UML 2.5.1 / XMI 2.5.1 canónico.** El de la OMG, con
 *   `MessageOccurrenceSpecification` como `fragment` y `signature` apuntando a
 *   la operación en vez de llevar el nombre en la etiqueta.
 *
 * No se detecta el dialecto para luego ramificar. Se prueban las formas por
 * orden de fiabilidad y se acepta la primera que resuelva, porque las
 * herramientas no se ajustan del todo a ninguna de las dos especificaciones y
 * un `if (esEA)` acabaría siendo una lista de excepciones de cada versión de
 * cada programa. Lo que sí se hace es **decir** lo que no se ha podido
 * resolver, en vez de dejar el diagrama a medias y callarse.
 *
 * LO QUE NO SE LEE, y conviene saberlo: la geometría. Dónde puso cada caja
 * quien dibujó el diagrama vive en el bloque de extensión de cada herramienta
 * (`<xmi:Extension extender="Enterprise Architect">`), en un formato que es
 * distinto en cada una y que además no viene en muchos ficheros. Las posiciones
 * se calculan al dibujar, a partir de quién habla con quién. Ver
 * `frontend/src/components/comunicacion-importada.ts`.
 */

/** Un diagrama con doscientos objetos no es un diagrama, es un volcado. */
const MAX_PARTICIPANTES = 200;
const MAX_MENSAJES = 500;
const MAX_DIAGRAMAS = 50;

export interface LecturaComunicacionUml {
  readonly diagramas: readonly DiagramaComunicacionUml[];
  readonly avisos: readonly AvisoXmi[];
}

// ---------------------------------------------------------------------------
// Clase de mensaje
// ---------------------------------------------------------------------------

/**
 * `messageSort` → clase de mensaje.
 *
 * Las claves no coinciden entre herramientas ni entre versiones del estándar:
 * UML 2.5.1 dice `asynchSignal`, hay exportadores que escriben `asynchSignal`
 * con otra grafía y otros que se inventan `synchronous`. Se normaliza a
 * minúsculas y se aceptan las variantes conocidas; lo desconocido cae en
 * `llamada`, que es lo que es un mensaje del que solo sabes que va de A a B.
 */
const CLASES: Record<string, ClaseDeMensaje> = {
  synchcall: 'llamada',
  synchronouscall: 'llamada',
  synchronous: 'llamada',
  synch: 'llamada',
  call: 'llamada',
  asynchcall: 'asincrono',
  asynchronouscall: 'asincrono',
  asynchsignal: 'asincrono',
  asynchronoussignal: 'asincrono',
  asynchronous: 'asincrono',
  asynch: 'asincrono',
  signal: 'asincrono',
  reply: 'respuesta',
  return: 'respuesta',
  createmessage: 'creacion',
  create: 'creacion',
  deletemessage: 'destruccion',
  delete: 'destruccion',
};

function claseDeMensaje(crudo: string | undefined): ClaseDeMensaje {
  if (crudo === undefined) return 'llamada';
  return CLASES[crudo.trim().toLowerCase()] ?? 'llamada';
}

// ---------------------------------------------------------------------------
// Índice de padres
// ---------------------------------------------------------------------------

/**
 * De cada nodo a quien lo contiene.
 *
 * `XmlNode` no guarda el padre —lo tendría que mantener el analizador y solo
 * haría falta aquí—, pero para titular un diagrama sí hace falta subir: la
 * `uml:Interaction` de Enterprise Architect se llama «EA_Interaction1», que no
 * le dice nada a nadie, mientras que el paquete que la contiene se llama
 * «Communication Diagram with Three Components», que es el título que el
 * usuario le puso al diagrama.
 */
function indexarPadres(raiz: XmlNode): Map<XmlNode, XmlNode> {
  const padres = new Map<XmlNode, XmlNode>();
  const pendientes: XmlNode[] = [raiz];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    for (const hijo of actual.children) {
      padres.set(hijo, actual);
      pendientes.push(hijo);
    }
  }
  return padres;
}

/**
 * «EA_Model», «EA_Collaboration1», «EA_Interaction1».
 *
 * Son los nombres que pone Enterprise Architect cuando el usuario no puso
 * ninguno. Titular con ellos es peor que no titular, porque parecen un nombre
 * de verdad y no lo son.
 */
const NOMBRE_DE_RELLENO = /^EA_/;

function nombreUtil(nodo: XmlNode): string | undefined {
  const valor = attr(nodo, 'name')?.trim();
  if (valor === undefined || valor === '' || NOMBRE_DE_RELLENO.test(valor)) return undefined;
  return valor;
}

/** El paquete con nombre que contiene al elemento, si lo hay. */
function paqueteDe(nodo: XmlNode, padres: ReadonlyMap<XmlNode, XmlNode>): XmlNode | undefined {
  let actual = padres.get(nodo);
  let saltos = 0;
  while (actual !== undefined && saltos < 8) {
    if (tipoUml(actual) === 'Package' && nombreUtil(actual) !== undefined) return actual;
    actual = padres.get(actual);
    saltos += 1;
  }
  return undefined;
}

/**
 * Cómo se llama cada diagrama.
 *
 * En los dos dialectos que hay delante, el nombre que un usuario reconocería
 * es el del **paquete**, no el de la interacción: Enterprise Architect llama a
 * la suya «EA_Interaction1» dentro de un paquete «Communication Diagram with
 * Three Components», y el emisor de este proyecto la llama «Interaccion_CU1»
 * dentro de «CU1 - Iniciar sesión». En los dos casos el paquete *es* el
 * diagrama.
 *
 * Pero eso solo vale cuando el paquete tiene un diagrama y no varios: con dos
 * interacciones en el mismo paquete, tomar su nombre daría dos diagramas
 * llamados igual, que en una lista es indistinguible de haberlo importado dos
 * veces. Así que se comprueba antes, y si hay más de uno manda el nombre
 * propio de cada interacción.
 */
function titular(
  contenedores: readonly XmlNode[],
  padres: ReadonlyMap<XmlNode, XmlNode>,
): Map<XmlNode, string> {
  const cuantos = new Map<XmlNode, number>();
  for (const contenedor of contenedores) {
    const paquete = paqueteDe(contenedor, padres);
    if (paquete !== undefined) cuantos.set(paquete, (cuantos.get(paquete) ?? 0) + 1);
  }

  const titulos = new Map<XmlNode, string>();
  for (const contenedor of contenedores) {
    const paquete = paqueteDe(contenedor, padres);
    const delPaquete =
      paquete !== undefined && cuantos.get(paquete) === 1 ? nombreUtil(paquete) : undefined;
    titulos.set(
      contenedor,
      delPaquete ??
        nombreUtil(contenedor) ??
        (paquete !== undefined ? nombreUtil(paquete) : undefined) ??
        attr(contenedor, 'name')?.trim() ??
        'Diagrama de comunicación',
    );
  }
  return titulos;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

const CONTENEDORES = ['packagedElement', 'ownedBehavior', 'ownedMember', 'ownedElement'];

export function leerDiagramasComunicacion(raiz: XmlNode, fuente: string): LecturaComunicacionUml {
  const esTipo = (tipo: string) => (nodo: XmlNode): boolean => tipoUml(nodo) === tipo;

  const interacciones = descendientes(raiz, ...CONTENEDORES, 'Interaction').filter(
    esTipo('Interaction'),
  );
  const colaboraciones = descendientes(raiz, ...CONTENEDORES, 'Collaboration').filter(
    esTipo('Collaboration'),
  );
  if (interacciones.length === 0 && colaboraciones.length === 0) {
    return { diagramas: [], avisos: [] };
  }

  const porId = indexarPorId(raiz);
  const padres = indexarPadres(raiz);
  const avisos: AvisoXmi[] = [];

  /*
    Los conectores se buscan en el documento entero y no dentro de la
    colaboración, que es donde el estándar los pone y donde casi nadie los
    pone: Enterprise Architect deja la colaboración con las líneas de vida y
    saca los `ownedConnector` al paquete de instancias, un nivel más arriba.
    A cada diagrama se le asignan después los que tengan los dos extremos entre
    sus participantes, que es un criterio que funciona igual esté el conector
    colgado de quien esté y que además no mezcla dos diagramas del mismo
    fichero.
  */
  const conectores = descendientes(raiz, 'ownedConnector', 'Connector').filter(esTipo('Connector'));

  // Una colaboración que ya contiene una interacción no da un diagrama aparte:
  // el diagrama es la interacción. Las que no contienen ninguna sí, porque una
  // colaboración con roles y conectores y sin mensajes es un diagrama de
  // comunicación legítimo —el esqueleto, sin la conversación.
  const conInteraccion = new Set<XmlNode>();
  for (const interaccion of interacciones) {
    let actual: XmlNode | undefined = padres.get(interaccion);
    while (actual !== undefined) {
      if (colaboraciones.includes(actual)) {
        conInteraccion.add(actual);
        break;
      }
      actual = padres.get(actual);
    }
  }

  const contenedores: XmlNode[] = [
    ...interacciones,
    ...colaboraciones.filter((c) => !conInteraccion.has(c)),
  ];

  const titulos = titular(contenedores, padres);
  const diagramas: DiagramaComunicacionUml[] = [];
  let recortados = false;

  for (const contenedor of contenedores) {
    if (diagramas.length >= MAX_DIAGRAMAS) {
      recortados = true;
      break;
    }
    const nombre = titulos.get(contenedor) ?? 'Diagrama de comunicación';
    const leido = leerUno(contenedor, nombre, { porId, padres, conectores, fuente, avisos });
    if (leido !== null) diagramas.push(leido);
  }

  if (recortados) {
    avisos.push({
      severidad: 'aviso',
      mensaje: `El fichero trae más de ${MAX_DIAGRAMAS} interacciones: se importan las primeras.`,
    });
  }

  // Los avisos repetidos vienen de repetir la misma causa —veinte mensajes sin
  // destinatario dan veinte líneas idénticas—, y una lista así deja de leerse.
  const vistos = new Set<string>();
  const unicos = avisos.filter((a) => {
    const clave = `${a.severidad}:${a.mensaje}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });

  return { diagramas, avisos: unicos };
}

interface Entorno {
  readonly porId: ReadonlyMap<string, XmlNode>;
  readonly padres: ReadonlyMap<XmlNode, XmlNode>;
  readonly conectores: readonly XmlNode[];
  readonly fuente: string;
  readonly avisos: AvisoXmi[];
}

function leerUno(
  contenedor: XmlNode,
  nombre: string,
  e: Entorno,
): DiagramaComunicacionUml | null {
  const id = idDe(contenedor) ?? `sin-id:${contenedor.name}`;

  // ---- participantes ------------------------------------------------------

  const participantes: ParticipanteUml[] = [];
  /** Cualquier id por el que se puede llegar a un participante → su id. */
  const alias = new Map<string, string>();
  /** Alias en minúsculas → id, para los conectores que apuntan por nombre. */
  const porAlias = new Map<string, string>();
  /** Clase en minúsculas → id, solo si esa clase la tiene un participante. */
  const porClase = new Map<string, string | null>();

  for (const nodo of objetosDe(contenedor, e)) {
    if (participantes.length >= MAX_PARTICIPANTES) {
      e.avisos.push({
        severidad: 'aviso',
        mensaje:
          `«${nombre}» tiene más de ${MAX_PARTICIPANTES} objetos: se importan los primeros. ` +
          'Un diagrama de comunicación de ese tamaño no se puede leer en pantalla.',
      });
      break;
    }
    const p = leerParticipante(nodo, e, alias);
    if (p === null) continue;
    participantes.push(p);
    const clave = p.alias.trim().toLowerCase();
    if (clave !== '' && !porAlias.has(clave)) porAlias.set(clave, p.id);
    if (p.clase !== undefined) {
      const porNombre = p.clase.toLowerCase();
      // `null` marca «esta clase la tienen dos objetos»: a partir de ahí deja
      // de servir para identificar a ninguno, y adivinar sería peor que no
      // resolver, porque la flecha acabaría en la caja equivocada sin avisar.
      porClase.set(porNombre, porClase.has(porNombre) ? null : p.id);
    }
  }

  if (participantes.length === 0) return null;

  const resolver = (nodo: XmlNode | undefined): string | undefined => {
    if (nodo === undefined) return undefined;
    const propioId = idDe(nodo);
    if (propioId !== undefined) {
      const directo = alias.get(propioId);
      if (directo !== undefined) return directo;
    }
    const suNombre = attr(nodo, 'name')?.trim().toLowerCase();
    if (suNombre !== undefined && suNombre !== '') {
      const porElNombre = porAlias.get(suNombre);
      if (porElNombre !== undefined) return porElNombre;
    }
    const clasificador = refDe(nodo, 'classifier', 'type');
    if (clasificador !== undefined) {
      const destino = e.porId.get(clasificador);
      const suClase = destino !== undefined ? attr(destino, 'name')?.trim().toLowerCase() : undefined;
      if (suClase !== undefined && suClase !== '') {
        const unico = porClase.get(suClase);
        if (unico !== undefined && unico !== null) return unico;
      }
    }
    return undefined;
  };

  // ---- mensajes -----------------------------------------------------------

  const { mensajes, sinExtremo } = leerMensajes(contenedor, e, resolver, nombre);

  if (sinExtremo > 0) {
    e.avisos.push({
      severidad: 'aviso',
      mensaje:
        `En «${nombre}» hay ${String(sinExtremo)} mensaje(s) cuyo emisor o destinatario no ` +
        'apunta a ningún objeto del diagrama: se descartan. Suele venir de un fichero ' +
        'exportado a medias, con la interacción pero sin las líneas de vida.',
    });
  }

  // ---- enlaces ------------------------------------------------------------

  const enlaces: EnlaceUml[] = [];
  const yaEnlazados = new Set<string>();
  for (const conector of e.conectores) {
    const extremos: string[] = [];
    for (const punta of hijos(conector, 'end', 'ConnectorEnd')) {
      const rol = refDe(punta, 'role', 'partWithPort');
      const resuelto = resolver(rol !== undefined ? e.porId.get(rol) : undefined);
      if (resuelto !== undefined) extremos.push(resuelto);
    }
    // Los dos extremos tienen que ser de *este* diagrama. Es lo que permite
    // buscar los conectores por todo el documento sin que los de una
    // interacción acaben en otra.
    if (extremos.length !== 2) continue;
    const [a, b] = extremos as [string, string];
    if (a === b) continue;
    const clave = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (yaEnlazados.has(clave)) continue;
    yaEnlazados.add(clave);
    const suNombre = attr(conector, 'name')?.trim();
    enlaces.push({
      id: idDe(conector) ?? `enlace:${clave}`,
      a,
      b,
      nombre: suNombre !== undefined && suNombre !== '' ? suNombre : undefined,
    });
  }

  return { id, nombre, fuente: e.fuente, participantes, mensajes, enlaces };
}

// ---------------------------------------------------------------------------
// Participantes
// ---------------------------------------------------------------------------

/**
 * Los objetos del diagrama: líneas de vida si las hay, roles si no.
 *
 * Una interacción los declara como `lifeline`. Una colaboración suelta —sin
 * interacción dentro— los declara como `ownedAttribute`, que es lo que dice
 * UML 2.5.1: los participantes de una colaboración son sus roles. Se aceptan
 * los dos y no se mezclan: si hay líneas de vida, mandan ellas, porque en un
 * fichero de Enterprise Architect la colaboración tiene además una propiedad
 * por cada línea de vida y contarlas todas duplicaría cada objeto.
 */
function objetosDe(contenedor: XmlNode, e: Entorno): XmlNode[] {
  const lineas = descendientes(contenedor, 'lifeline', 'Lifeline').filter(
    (n) => tipoUml(n) === 'Lifeline' || n.name === 'lifeline',
  );
  if (lineas.length > 0) return lineas;

  const roles = hijos(contenedor, 'ownedAttribute', 'role').filter((n) => {
    const tipo = tipoUml(n);
    return tipo === 'Property' || tipo === 'ConnectableElement' || n.name === 'role';
  });
  if (roles.length > 0) return roles;

  // Último recurso: una colaboración cuyos participantes solo existen como
  // instancias sueltas en el mismo paquete. Pasa con diagramas dibujados a
  // mano y exportados sin colaboración.
  const padre = e.padres.get(contenedor);
  if (padre === undefined) return [];
  return hijos(padre, 'packagedElement').filter((n) => tipoUml(n) === 'InstanceSpecification');
}

/**
 * De un objeto del diagrama a su participante, siguiendo la cadena entera.
 *
 * La cadena es el punto delicado de todo esto y no es la misma en los dos
 * dialectos:
 *
 *   EA 2.1     lifeline → represents → Property → type → InstanceSpecification
 *              → classifier → Component        (el nombre está en la instancia)
 *   UML 2.5.1  lifeline → represents → Property → type → Class
 *              (el nombre está en la línea de vida)
 *
 * Por eso se recorre hasta el final en vez de quedarse con el primer nombre
 * que aparezca: el nombre del objeto (`con`, `p1`, `usuario`) es la etiqueta de
 * la instancia, no el de su clase, y quedarse con él llena el diagrama de
 * clases llamadas «Con» y «Usuario» que no existen en ninguna parte.
 *
 * Todos los identificadores por los que se pasa se apuntan en `alias`, porque
 * los conectores apuntan a cualquiera de ellos según la herramienta: EA usa el
 * de la instancia y el estándar el de la propiedad.
 */
function leerParticipante(
  nodo: XmlNode,
  e: Entorno,
  alias: Map<string, string>,
): ParticipanteUml | null {
  const id = idDe(nodo);
  if (id === undefined) return null;
  if (alias.has(id)) return null;
  alias.set(id, id);

  let etiqueta = attr(nodo, 'name')?.trim() ?? '';
  let clase: string | undefined;
  let actor = false;
  let multiple = esVerdad(attr(nodo, 'isMultiple')) || esVerdad(attr(nodo, 'multi'));

  let actual: XmlNode | undefined = nodo;
  let saltos = 0;
  // Seis saltos son de sobra para la cadena más larga que emite ninguna
  // herramienta, y el tope es lo que impide que un `type` que se apunta a sí
  // mismo —que los hay, en ficheros corruptos— cuelgue la importación.
  while (actual !== undefined && saltos < 6) {
    const tipo = tipoUml(actual);
    if (tipo === 'Actor') actor = true;
    if (esVerdad(attr(actual, 'isMultiple'))) multiple = true;

    const siguienteId = refDe(actual, 'represents', 'base_Property', 'classifier', 'type');
    if (siguienteId === undefined) {
      // Un `<type href="…#Integer">` no apunta a este documento: el nombre va
      // detrás de la almohadilla.
      const hijoTipo = hijos(actual, 'type')[0];
      const href = hijoTipo !== undefined ? attr(hijoTipo, 'href') : undefined;
      if (href !== undefined && href.includes('#')) clase ??= href.slice(href.lastIndexOf('#') + 1);
      break;
    }

    const siguiente = e.porId.get(siguienteId);
    if (siguiente === undefined) break;
    if (alias.get(siguienteId) !== undefined && alias.get(siguienteId) !== id) break;
    alias.set(siguienteId, id);

    const suNombre = attr(siguiente, 'name')?.trim() ?? '';
    const suTipo = tipoUml(siguiente);
    if (suTipo === 'Class' || suTipo === 'Actor' || suTipo === 'Component' || suTipo === 'Interface') {
      // Se acabó la cadena: esto ya es el clasificador.
      if (suNombre !== '') clase = suNombre;
      if (suTipo === 'Actor') actor = true;
      break;
    }
    // Una instancia por el camino aporta la etiqueta si la línea de vida no la
    // traía, y sigue teniendo clasificador detrás.
    if (etiqueta === '' && suNombre !== '') etiqueta = suNombre;

    actual = siguiente;
    saltos += 1;
  }

  if (clase === undefined) {
    // El convenio `p1:Pedido` escrito en el nombre es lo último que se mira,
    // porque es lo único que puede equivocarse: nada garantiza que lo de
    // detrás de los dos puntos sea una clase.
    const corte = etiqueta.indexOf(':');
    if (corte !== -1) {
      const cola = etiqueta.slice(corte + 1).trim();
      if (cola !== '') {
        clase = cola;
        etiqueta = etiqueta.slice(0, corte).trim();
      }
    }
  }

  return { id, alias: etiqueta, clase, actor, multiple };
}

function esVerdad(valor: string | undefined): boolean {
  return valor === 'true' || valor === '1';
}

// ---------------------------------------------------------------------------
// Mensajes
// ---------------------------------------------------------------------------

function leerMensajes(
  contenedor: XmlNode,
  e: Entorno,
  resolver: (nodo: XmlNode | undefined) => string | undefined,
  nombreDiagrama: string,
): { mensajes: MensajeUml[]; sinExtremo: number } {
  const nodos = descendientes(contenedor, 'message', 'Message', 'ownedMember').filter(
    (n) => tipoUml(n) === 'Message',
  );

  /*
    Índice inverso: de un mensaje a las ocurrencias que dicen pertenecerle.

    Hace falta para el XMI 2.5.1 canónico, donde el enlace puede ir al revés que
    en EA: el mensaje no declara `sendEvent`/`receiveEvent` y son los
    `MessageOccurrenceSpecification` los que llevan `message="…"`. Sin esto, un
    fichero perfectamente válido de la OMG se importa con cero mensajes y sin
    que nada falle de forma visible, que es el peor resultado posible.
  */
  const ocurrenciasDe = new Map<string, XmlNode[]>();
  for (const fragmento of descendientes(contenedor, 'fragment', 'OccurrenceSpecification')) {
    const deQuien = refDe(fragmento, 'message');
    if (deQuien === undefined) continue;
    const lista = ocurrenciasDe.get(deQuien) ?? [];
    lista.push(fragmento);
    ocurrenciasDe.set(deQuien, lista);
  }

  /** Mensaje → línea de vida de uno de sus extremos. */
  const extremo = (mensaje: XmlNode, campo: 'sendEvent' | 'receiveEvent'): XmlNode | undefined => {
    const alternativa = campo === 'receiveEvent' ? 'receiver' : 'sender';
    const referencia = refDe(mensaje, campo, alternativa);
    if (referencia !== undefined) {
      const apuntado = e.porId.get(referencia);
      if (apuntado !== undefined) {
        if (tipoUml(apuntado) === 'Lifeline' || apuntado.name === 'lifeline') return apuntado;
        const cubierta = refDe(apuntado, 'covered');
        return cubierta !== undefined ? e.porId.get(cubierta) : apuntado;
      }
    }
    // Camino canónico inverso. El orden de los fragmentos en el documento es el
    // orden en que ocurren, así que el primero es el envío y el último la
    // recepción; es lo que dice UML 2.5.1 sobre el orden de `fragment` dentro
    // de una interacción, y es lo único de lo que se dispone aquí.
    const suyas = ocurrenciasDe.get(idDe(mensaje) ?? '');
    if (suyas === undefined || suyas.length === 0) return undefined;
    const elegida = campo === 'sendEvent' ? suyas[0]! : suyas[suyas.length - 1]!;
    const cubierta = refDe(elegida, 'covered');
    return cubierta !== undefined ? e.porId.get(cubierta) : undefined;
  };

  /** El nombre del mensaje, de la etiqueta o de la operación que firma. */
  const etiquetaDe = (mensaje: XmlNode): string => {
    const directa = attr(mensaje, 'name')?.trim();
    if (directa !== undefined && directa !== '') return directa;
    // En XMI 2.5.1 el mensaje suele no llevar nombre y apuntar con `signature`
    // a la `uml:Operation` a la que llama.
    const firma = refDe(mensaje, 'signature');
    if (firma === undefined) return '';
    const operacion = e.porId.get(firma);
    if (operacion === undefined) return '';
    const suNombre = attr(operacion, 'name')?.trim() ?? '';
    if (suNombre === '') return '';
    const parametros = hijos(operacion, 'ownedParameter')
      .filter((p) => (attr(p, 'direction') ?? 'in') !== 'return')
      .map((p) => attr(p, 'name')?.trim() ?? '')
      .filter((n) => n !== '');
    return `${suNombre}(${parametros.join(', ')})`;
  };

  interface Crudo {
    readonly id: string;
    readonly etiqueta: string;
    readonly piezas: ReturnType<typeof analizarEtiqueta>;
    readonly de: string;
    readonly a: string;
    readonly clase: ClaseDeMensaje;
  }

  const crudos: Crudo[] = [];
  let sinExtremo = 0;
  let recortados = false;

  for (const nodo of nodos) {
    if (crudos.length >= MAX_MENSAJES) {
      recortados = true;
      break;
    }
    const de = resolver(extremo(nodo, 'sendEvent'));
    const a = resolver(extremo(nodo, 'receiveEvent'));
    if (de === undefined || a === undefined) {
      sinExtremo += 1;
      continue;
    }
    const etiqueta = etiquetaDe(nodo);
    crudos.push({
      id: idDe(nodo) ?? `mensaje:${String(crudos.length)}`,
      etiqueta,
      piezas: analizarEtiqueta(etiqueta),
      de,
      a,
      clase: claseDeMensaje(attr(nodo, 'messageSort')),
    });
  }

  if (recortados) {
    e.avisos.push({
      severidad: 'aviso',
      mensaje: `«${nombreDiagrama}» trae más de ${MAX_MENSAJES} mensajes: se importan los primeros.`,
    });
  }

  // ---- numeración ---------------------------------------------------------

  /*
    Dos fuentes para el número de secuencia, y ninguna se impone a la otra.

    Si la etiqueta lo trae —`1.2: pagar()`, que es como se escribe un diagrama
    de comunicación a mano— se respeta tal cual, jerarquía incluida: es
    información que puso una persona y que ningún cálculo puede reconstruir.
    Si no lo trae —y no lo traen los ficheros que emitimos nosotros, donde el
    orden es el del documento— se numera 1, 2, 3… por el orden en que los
    mensajes aparecen en el XMI, que es lo que UML 2.5.1 define como el orden de
    los fragmentos de una interacción.

    Cada mensaje lleva apuntado de dónde salió su número (`ordenDe`), para que
    la interfaz pueda decirlo y para que nadie confunda una numeración deducida
    con una escrita.
  */
  const usados = new Set<string>();
  for (const crudo of crudos) {
    const numero = crudo.piezas?.numero;
    if (numero !== undefined) usados.add(numero);
  }

  let siguiente = 1;
  const proximoLibre = (): string => {
    while (usados.has(String(siguiente))) siguiente += 1;
    const salida = String(siguiente);
    usados.add(salida);
    return salida;
  };

  let delFichero = 0;
  let delDocumento = 0;
  const mensajes: MensajeUml[] = crudos.map((crudo) => {
    const piezas = crudo.piezas;
    const numero = piezas?.numero;
    const puesto = numero ?? proximoLibre();
    if (numero === undefined) delDocumento += 1;
    else delFichero += 1;
    return {
      id: crudo.id,
      numero: puesto,
      ordenDe: numero === undefined ? 'documento' : 'fichero',
      etiqueta: crudo.etiqueta,
      // Una etiqueta vacía es legal: un mensaje puede no tener nombre. Lo que
      // no se hace es inventárselo.
      nombre: piezas?.nombre ?? '',
      argumentos: piezas?.argumentos ?? [],
      de: crudo.de,
      a: crudo.a,
      clase: crudo.clase,
      guarda: piezas?.guarda,
      iteracion: piezas?.iteracion ?? false,
      asignacion: piezas?.asignacion,
    };
  });

  if (delFichero > 0 && delDocumento > 0) {
    e.avisos.push({
      severidad: 'aviso',
      mensaje:
        `En «${nombreDiagrama}» unos mensajes traen número de secuencia y otros no ` +
        `(${String(delFichero)} sí, ${String(delDocumento)} no). A los que no lo traen se les ` +
        'ha puesto uno por su orden en el fichero; comprueba que la secuencia es la que querías.',
    });
  }

  mensajes.sort((x, y) => compararNumeros(x.numero, y.numero));
  return { mensajes, sinExtremo };
}
