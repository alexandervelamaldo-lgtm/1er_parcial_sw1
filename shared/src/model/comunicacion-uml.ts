/**
 * Un diagrama de comunicación UML tal y como viene de fuera.
 *
 * POR QUÉ NO SIRVE EL QUE YA HAY. En `capas.ts` vive `DiagramaComunicacion`, y
 * describe otra cosa: los diagramas que esta herramienta *dibuja sola* a partir
 * del backend que genera. Por eso lleva `operacion: 'listar' | 'crear' | …`,
 * `metodo: 'GET' | 'POST' | …`, `ruta` y una `capa` por participante. Son
 * campos ciertos —el diagrama sale de un controlador REST concreto— pero son
 * del backend generado, no de UML. Un fichero que exporta alguien desde
 * Enterprise Architect no tiene ruta, ni verbo HTTP, ni seis capas: tiene los
 * objetos que le dé la gana tener. Meter eso en aquel tipo obligaría a
 * inventarle a cada participante una capa y a cada diagrama un verbo, y el
 * primer sitio donde se notaría la mentira sería el visor, que coloca las cajas
 * *por la capa*.
 *
 * Así que hay dos modelos y no uno, a sabiendas. Este es el de UML: solo tiene
 * lo que el estándar define, y todo lo que aquí es opcional es opcional porque
 * un fichero real puede no traerlo.
 *
 * LO QUE SÍ SE CONSERVA, que es el motivo de que exista. El orden de los
 * mensajes. En un diagrama de comunicación la secuencia no se ve en la
 * geometría —no hay eje de tiempo, como en uno de secuencia—: se ve en el
 * número que lleva cada flecha, y esa numeración es jerárquica, `1`, `1.1`,
 * `1.2`, `2`. Es literalmente la única forma de saber qué pasa antes que qué.
 * El lector viejo (`xmi/comunicacion.ts`) la tira, y no le queda otra: traduce
 * a un diagrama de clases, donde no hay dónde ponerla. Aquí se guarda.
 *
 * IDENTIDAD. Los identificadores son los `xmi:id` del fichero, no unos nuevos.
 * Es lo que permite reimportar el mismo fichero encima y que el diagrama se
 * reconozca en vez de duplicarse, y lo que permite decir «el mensaje
 * EAID_6D15… apunta a una línea de vida que no existe» en un aviso que alguien
 * puede ir a buscar con un editor de texto.
 */

/** Cómo llegó el número de secuencia de un mensaje. */
export type OrigenDeOrden =
  /** Venía escrito en la etiqueta: `1.2: pagar()`. */
  | 'fichero'
  /** No venía y se ha numerado por el orden en que aparecen en el documento. */
  | 'documento';

/**
 * Clase de mensaje, en los términos de UML 2.5.1 (`messageSort`).
 *
 * Se traduce en vez de guardar la cadena cruda porque los valores que emiten
 * las herramientas no coinciden: `synchCall` y `synchronousCall` son lo mismo,
 * y EA escribe `asynchSignal` donde el estándar dice `asynchSignal`. Comparar
 * cadenas sueltas en el visor sería repetir esa tabla en cada sitio.
 */
export type ClaseDeMensaje =
  | 'llamada'
  | 'asincrono'
  | 'respuesta'
  | 'creacion'
  | 'destruccion';

/** Un objeto del diagrama: la línea de vida o el rol que recibe mensajes. */
export interface ParticipanteUml {
  /** `xmi:id` de la línea de vida, o del objeto si no hay línea de vida. */
  readonly id: string;
  /**
   * La etiqueta de la instancia: `p1`, `con`, `:pedido`.
   *
   * Puede estar vacía. Un objeto anónimo —`:Pedido`— es legal en UML y lo que
   * el diagrama enseña en ese caso es solo el nombre de la clase.
   */
  readonly alias: string;
  /**
   * La clase de la que el objeto es instancia, si el fichero lo dice.
   *
   * `undefined` no es un error: hay diagramas donde los objetos no declaran
   * clasificador. Lo que sería un error es *inventarla* a partir del alias,
   * porque `con` no es la clase `Con`.
   */
  readonly clase: string | undefined;
  /** Si el clasificador es un `uml:Actor` y no una clase. Se dibuja distinto. */
  readonly actor: boolean;
  /** `true` si es un objeto múltiple (`multi-object`, `isMultiple`). */
  readonly multiple: boolean;
}

/** Una flecha del diagrama: quién llama a quién, cuándo y con qué. */
export interface MensajeUml {
  /** `xmi:id` del `uml:Message`. */
  readonly id: string;
  /**
   * Número de secuencia jerárquico: `1`, `1.2`, `2.3.1`.
   *
   * Se guarda como cadena y no como lista de enteros porque UML admite letras
   * —`1a` y `1b` son dos mensajes concurrentes tras el `1`—, y porque lo que
   * hay que pintar en la flecha es exactamente este texto. Para ordenar está
   * `compararNumeros`.
   */
  readonly numero: string;
  readonly ordenDe: OrigenDeOrden;
  /** La etiqueta entera tal cual venía, adornos incluidos. Se enseña en crudo. */
  readonly etiqueta: string;
  /** El nombre de la operación, ya sin número, guarda ni asignación. */
  readonly nombre: string;
  /** Los argumentos tal cual estaban escritos entre paréntesis. */
  readonly argumentos: readonly string[];
  /** Id del participante que lo envía. */
  readonly de: string;
  /** Id del participante que lo recibe. */
  readonly a: string;
  readonly clase: ClaseDeMensaje;
  /** `[hay saldo]`, sin los corchetes. */
  readonly guarda: string | undefined;
  /** `*` delante: el mensaje se repite. */
  readonly iteracion: boolean;
  /** `total :=` delante: dónde se recoge lo que devuelve. */
  readonly asignacion: string | undefined;
}

/**
 * Un enlace entre dos objetos: por dónde puede viajar un mensaje.
 *
 * No lleva dirección. Un `uml:Connector` de UML no la tiene —la dirección la
 * ponen los mensajes que circulan por él—, y dársela aquí obligaría a decidir
 * cuál de los dos extremos es el origen cuando el fichero no lo dice.
 */
export interface EnlaceUml {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  /** Nombre del enlace, si lo trae. */
  readonly nombre: string | undefined;
}

export interface DiagramaComunicacionUml {
  /** `xmi:id` de la `uml:Interaction`. */
  readonly id: string;
  /** El de la interacción, o el del paquete que la contiene si ella no lo trae. */
  readonly nombre: string;
  /** De qué fichero salió. Para poder decirlo en la interfaz. */
  readonly fuente: string;
  readonly participantes: readonly ParticipanteUml[];
  /** En orden de secuencia, no en orden de documento. Ver `compararNumeros`. */
  readonly mensajes: readonly MensajeUml[];
  readonly enlaces: readonly EnlaceUml[];
}

// ---------------------------------------------------------------------------
// Numeración
// ---------------------------------------------------------------------------

/** `1.2a` → `[{ n: 1 }, { n: 2, letra: 'a' }]`. */
function partes(numero: string): { n: number; letra: string }[] {
  return numero.split('.').map((trozo) => {
    const casa = /^([A-Za-z]*)(\d+)([A-Za-z]*)$/.exec(trozo.trim());
    if (casa === null) return { n: Number.MAX_SAFE_INTEGER, letra: trozo };
    // El prefijo de hilo (`A1`, `B1`) va delante del número y la marca de
    // concurrencia (`1a`, `1b`) detrás. Se concatenan porque para ordenar da
    // igual de dónde venga la letra: lo que manda es el número.
    return { n: Number(casa[2]), letra: (casa[1] ?? '') + (casa[3] ?? '') };
  });
}

/**
 * Orden de ejecución entre dos números jerárquicos.
 *
 * Nivel a nivel y numéricamente, que es lo que hace falta y lo que un orden
 * alfabético no da: con `sort()` a secas, `10` va antes que `2` y el diagrama
 * se lee al revés a partir del décimo mensaje. Es el fallo clásico de esto y no
 * se nota hasta que el diagrama crece.
 *
 * A igualdad de número, el más corto va primero: `1` es la llamada y `1.1` es
 * lo que esa llamada provoca, así que `1` pasa antes.
 */
export function compararNumeros(a: string, b: string): number {
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i += 1) {
    const x = pa[i]!;
    const y = pb[i]!;
    if (x.n !== y.n) return x.n - y.n;
    if (x.letra !== y.letra) return x.letra < y.letra ? -1 : 1;
  }
  return pa.length - pb.length;
}

/**
 * El número del padre: de `1.2.3` sale `1.2`; de `1` no sale nada.
 *
 * Lo usa la validación para comprobar que un mensaje anidado cuelga de alguien.
 */
export function numeroPadre(numero: string): string | undefined {
  const corte = numero.lastIndexOf('.');
  return corte === -1 ? undefined : numero.slice(0, corte);
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/** Lo que se enseña en la caja del objeto: `p1:Pedido`, `:Pedido` o `p1`. */
export function etiquetaDeParticipante(p: ParticipanteUml): string {
  if (p.clase === undefined) return p.alias;
  return `${p.alias}:${p.clase}`;
}

/**
 * Los enlaces por los que de verdad circula algo, deducidos de los mensajes.
 *
 * Hace falta porque los dos vienen por caminos distintos y ninguno es completo:
 * hay ficheros con `uml:Connector` y sin mensajes —el fixture real de
 * Enterprise Architect es justo eso: tres objetos, tres enlaces y ni un
 * mensaje— y hay ficheros con mensajes y sin un solo conector. Dibujar solo los
 * conectores dejaría flechas en el aire; dibujar solo los mensajes perdería la
 * estructura del primer caso.
 */
export function enlacesEfectivos(diagrama: DiagramaComunicacionUml): EnlaceUml[] {
  const salida: EnlaceUml[] = [...diagrama.enlaces];
  const vistos = new Set(diagrama.enlaces.map((e) => clavePar(e.a, e.b)));
  for (const mensaje of diagrama.mensajes) {
    if (mensaje.de === mensaje.a) continue;
    const clave = clavePar(mensaje.de, mensaje.a);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ id: `deducido:${clave}`, a: mensaje.de, b: mensaje.a, nombre: undefined });
  }
  return salida;
}

/** Clave simétrica de un par de participantes. */
export function clavePar(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
