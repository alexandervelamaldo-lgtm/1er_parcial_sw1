import * as Y from 'yjs';
import type {
  ClaseDeMensaje,
  DiagramaComunicacionUml,
  EnlaceUml,
  MensajeUml,
  OrigenDeOrden,
  ParticipanteUml,
} from '../model/comunicacion-uml.js';
import { compararNumeros } from '../model/comunicacion-uml.js';
import { getCommunicationsMap } from './document.js';

/**
 * Los diagramas de comunicación importados, dentro del documento del proyecto.
 *
 * DÓNDE VIVEN Y POR QUÉ AHÍ. Un diagrama importado es un documento más del
 * proyecto, al lado del diagrama de clases: se abre con el proyecto, se ve
 * desde otro ordenador y sigue ahí mañana. Eso descarta guardarlo en el
 * `localStorage` del navegador, que es de una máquina y de un perfil, y
 * descarta tenerlo solo en memoria.
 *
 * Lo que no hizo falta fue tocar el almacenamiento. El `DocumentStore` guarda
 * el documento Yjs entero como un blob opaco —los bytes de
 * `Y.encodeStateAsUpdate`— y no interpreta nada de lo que hay dentro, porque
 * la convergencia la garantiza el CRDT y no el servidor. Así que un tipo raíz
 * nuevo viaja hasta el disco y hasta PostgreSQL sin cambiar una línea del
 * almacén, sin migración de esquema y sin ruta nueva en la API.
 *
 * FORMA. El mapa raíz va indexado por el `xmi:id` de la interacción, que es el
 * identificador que traía el fichero. Reimportar el mismo XMI encima
 * *reemplaza* el diagrama en vez de duplicarlo, que es lo que uno espera
 * cuando corrige el original y lo vuelve a exportar; si se quisiera conservar
 * el anterior habría que dárselo a elegir, y no es lo que se pidió.
 *
 * Dentro, las tres listas son `Y.Array` y no mapas indexados. Es la excepción
 * que ya se hace con los atributos de una clase, y por la misma razón: aquí el
 * orden es información. El de los mensajes *es* el diagrama. La contrapartida
 * conocida de un array en un CRDT —dos inserciones simultáneas en la misma
 * posición no se resuelven tan limpiamente como dos claves distintas— no
 * aplica del mismo modo a algo que se escribe entero de una vez al importar y
 * después solo se lee.
 *
 * CADA MENSAJE ES UN `Y.Map`, no una cadena serializada. Cuesta más de
 * escribir, pero un JSON metido en una celda es un valor único para Yjs: dos
 * personas que tocan dos campos distintos del mismo mensaje perderían una de
 * las dos ediciones, y el conflicto ni siquiera se vería.
 */

export interface ComunicacionGuardada extends DiagramaComunicacionUml {
  /** ISO 8601. Cuándo se importó, para poder ordenarlos y decirlo en pantalla. */
  readonly importadoEl: string;
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function cadena(map: Y.Map<unknown>, clave: string, porDefecto = ''): string {
  const valor = map.get(clave);
  return typeof valor === 'string' ? valor : porDefecto;
}

function booleano(map: Y.Map<unknown>, clave: string): boolean {
  return map.get(clave) === true;
}

/** Una cadena vacía guardada significa «no lo traía», no «lo traía vacío». */
function opcional(map: Y.Map<unknown>, clave: string): string | undefined {
  const valor = map.get(clave);
  return typeof valor === 'string' && valor !== '' ? valor : undefined;
}

function leerParticipante(map: Y.Map<unknown>): ParticipanteUml | null {
  const id = cadena(map, 'id');
  if (id === '') return null;
  return {
    id,
    alias: cadena(map, 'alias'),
    clase: opcional(map, 'clase'),
    actor: booleano(map, 'actor'),
    multiple: booleano(map, 'multiple'),
  };
}

const CLASES_VALIDAS = new Set<ClaseDeMensaje>([
  'llamada',
  'asincrono',
  'respuesta',
  'creacion',
  'destruccion',
]);

function leerMensaje(map: Y.Map<unknown>): MensajeUml | null {
  const id = cadena(map, 'id');
  if (id === '') return null;
  const clase = cadena(map, 'clase') as ClaseDeMensaje;
  const orden = cadena(map, 'ordenDe') as OrigenDeOrden;
  const argumentos = map.get('argumentos');
  return {
    id,
    numero: cadena(map, 'numero', '1'),
    // Un valor que no reconocemos se trata como lo que es —desconocido— y no
    // se propaga: dejar pasar una cadena arbitraria haría que el visor
    // intentara dibujar una flecha de una clase que no existe.
    ordenDe: orden === 'fichero' || orden === 'documento' ? orden : 'documento',
    etiqueta: cadena(map, 'etiqueta'),
    nombre: cadena(map, 'nombre'),
    argumentos:
      argumentos instanceof Y.Array
        ? argumentos.toArray().filter((a): a is string => typeof a === 'string')
        : [],
    de: cadena(map, 'de'),
    a: cadena(map, 'a'),
    clase: CLASES_VALIDAS.has(clase) ? clase : 'llamada',
    guarda: opcional(map, 'guarda'),
    iteracion: booleano(map, 'iteracion'),
    asignacion: opcional(map, 'asignacion'),
  };
}

function leerEnlace(map: Y.Map<unknown>): EnlaceUml | null {
  const id = cadena(map, 'id');
  const a = cadena(map, 'a');
  const b = cadena(map, 'b');
  if (id === '' || a === '' || b === '') return null;
  return { id, a, b, nombre: opcional(map, 'nombre') };
}

function leerUno(map: Y.Map<unknown>, clave: string): ComunicacionGuardada | null {
  const id = cadena(map, 'id', clave);
  if (id === '') return null;

  const participantes: ParticipanteUml[] = [];
  const enParticipantes = map.get('participantes');
  if (enParticipantes instanceof Y.Array) {
    for (const bruto of enParticipantes) {
      if (!(bruto instanceof Y.Map)) continue;
      const p = leerParticipante(bruto);
      if (p !== null) participantes.push(p);
    }
  }

  const mensajes: MensajeUml[] = [];
  const enMensajes = map.get('mensajes');
  if (enMensajes instanceof Y.Array) {
    for (const bruto of enMensajes) {
      if (!(bruto instanceof Y.Map)) continue;
      const m = leerMensaje(bruto);
      if (m !== null) mensajes.push(m);
    }
  }
  // El orden se recalcula al leer y no se confía en el del array. Dos réplicas
  // pueden haber insertado mensajes en distinto orden, y lo que manda es el
  // número de secuencia, que es determinista.
  mensajes.sort((x, y) => compararNumeros(x.numero, y.numero));

  const enlaces: EnlaceUml[] = [];
  const enEnlaces = map.get('enlaces');
  if (enEnlaces instanceof Y.Array) {
    for (const bruto of enEnlaces) {
      if (!(bruto instanceof Y.Map)) continue;
      const e = leerEnlace(bruto);
      if (e !== null) enlaces.push(e);
    }
  }

  return {
    id,
    nombre: cadena(map, 'nombre', 'Diagrama de comunicación'),
    fuente: cadena(map, 'fuente'),
    importadoEl: cadena(map, 'importadoEl'),
    participantes,
    mensajes,
    enlaces,
  };
}

/**
 * Todos los diagramas guardados, del más reciente al más antiguo.
 *
 * Tolerante a propósito, igual que `readDiagram`: una entrada que no es un
 * mapa, o un mensaje sin identificador, se omiten en vez de reventar la
 * lectura. Un documento compartido puede traer cualquier cosa —una versión
 * anterior del programa, una edición a medias— y que el proyecto entero deje
 * de abrirse por un mensaje mal formado sería un intercambio pésimo. Lo que
 * *no* se hace es esconderlo: `comprobarIntegridad` sobre el resultado dice
 * exactamente qué falta.
 */
export function readComunicaciones(doc: Y.Doc): ComunicacionGuardada[] {
  const raiz = getCommunicationsMap(doc);
  const salida: ComunicacionGuardada[] = [];
  for (const [clave, valor] of raiz.entries()) {
    if (!(valor instanceof Y.Map)) continue;
    const leido = leerUno(valor, clave);
    if (leido !== null) salida.push(leido);
  }
  salida.sort((a, b) => (a.importadoEl < b.importadoEl ? 1 : a.importadoEl > b.importadoEl ? -1 : 0));
  return salida;
}

export function readComunicacion(doc: Y.Doc, id: string): ComunicacionGuardada | null {
  const valor = getCommunicationsMap(doc).get(id);
  return valor instanceof Y.Map ? leerUno(valor, id) : null;
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

function escribirParticipante(p: ParticipanteUml): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', p.id);
  map.set('alias', p.alias);
  // Solo se escribe lo que hay. Un `clase: ''` explícito en cada objeto haría
  // que un diagrama existente cambiara de estado al abrirlo con una versión
  // nueva, y ese cambio se propagaría a todo el mundo como si alguien lo
  // hubiera editado.
  if (p.clase !== undefined) map.set('clase', p.clase);
  if (p.actor) map.set('actor', true);
  if (p.multiple) map.set('multiple', true);
  return map;
}

function escribirMensaje(m: MensajeUml): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', m.id);
  map.set('numero', m.numero);
  map.set('ordenDe', m.ordenDe);
  map.set('etiqueta', m.etiqueta);
  map.set('nombre', m.nombre);
  const argumentos = new Y.Array<unknown>();
  argumentos.push([...m.argumentos]);
  map.set('argumentos', argumentos);
  map.set('de', m.de);
  map.set('a', m.a);
  map.set('clase', m.clase);
  if (m.guarda !== undefined) map.set('guarda', m.guarda);
  if (m.iteracion) map.set('iteracion', true);
  if (m.asignacion !== undefined) map.set('asignacion', m.asignacion);
  return map;
}

function escribirEnlace(e: EnlaceUml): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set('id', e.id);
  map.set('a', e.a);
  map.set('b', e.b);
  if (e.nombre !== undefined) map.set('nombre', e.nombre);
  return map;
}

/**
 * Guarda un diagrama importado en el proyecto.
 *
 * Reemplaza el que hubiera con el mismo identificador, que es lo que se quiere
 * al reimportar un fichero corregido. Todo va en una transacción para que los
 * demás reciban el diagrama de una pieza: sin ella, otra réplica podría
 * pintarlo con los objetos puestos y los mensajes aún no, y `comprobarIntegridad`
 * se quejaría de mensajes colgantes que en realidad solo iban de camino.
 */
export function writeComunicacion(
  doc: Y.Doc,
  diagrama: DiagramaComunicacionUml,
  importadoEl: string = new Date().toISOString(),
): void {
  doc.transact(() => {
    const map = new Y.Map<unknown>();
    map.set('id', diagrama.id);
    map.set('nombre', diagrama.nombre);
    map.set('fuente', diagrama.fuente);
    map.set('importadoEl', importadoEl);

    const participantes = new Y.Array<unknown>();
    participantes.push(diagrama.participantes.map(escribirParticipante));
    map.set('participantes', participantes);

    const mensajes = new Y.Array<unknown>();
    mensajes.push(diagrama.mensajes.map(escribirMensaje));
    map.set('mensajes', mensajes);

    const enlaces = new Y.Array<unknown>();
    enlaces.push(diagrama.enlaces.map(escribirEnlace));
    map.set('enlaces', enlaces);

    getCommunicationsMap(doc).set(diagrama.id, map);
  }, 'comunicacion');
}

export function deleteComunicacion(doc: Y.Doc, id: string): void {
  doc.transact(() => {
    getCommunicationsMap(doc).delete(id);
  }, 'comunicacion');
}
