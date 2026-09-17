import {
  clavePar,
  numeroPadre,
  type DiagramaComunicacionUml,
  type MensajeUml,
} from './comunicacion-uml.js';

/**
 * ¿Está entero lo que se ha importado?
 *
 * QUÉ PREGUNTA ES ESTA Y CUÁL NO. No es «¿el fichero es XML válido?» —de eso se
 * ocupa `xml.ts` y falla antes— ni «¿el diagrama está bien modelado?». Es la de
 * en medio, y es la que se le escapa a casi todo importador: el fichero se lee
 * sin un solo error, el diagrama aparece en pantalla, y le faltan tres flechas
 * porque apuntaban a una línea de vida que no venía en el fichero. Nadie se
 * entera hasta que alguien cuenta las flechas del original y las del importado.
 *
 * Así que esto se ejecuta siempre, y en dos momentos distintos:
 *
 * 1. **Justo después de leer el XMI**, para poder enseñar los problemas en la
 *    pantalla de revisión antes de que nadie acepte nada.
 * 2. **Al leer el diagrama del documento compartido.** Que ya se validara al
 *    importar no basta: entre medias ha pasado por un CRDT, por el disco y
 *    quizá por PostgreSQL, y sobre todo ha pasado por las manos de otra
 *    persona que pudo borrar el objeto al que apuntaban cuatro mensajes. Un
 *    diagrama con un mensaje colgando no se puede dibujar, y es mejor decirlo
 *    que dibujar media flecha.
 *
 * NO ARREGLA NADA. Devuelve la lista y se acaba su trabajo. Corregir en
 * silencio —tirar el mensaje huérfano, renumerar lo que está repetido— es lo
 * que hace que una importación parezca perfecta y no lo sea, y aquí eso es
 * justamente lo que se quiere evitar. Quien llame decide: la pantalla de
 * revisión los enseña, el visor omite lo que no puede pintar *y lo dice*.
 *
 * SEVERIDAD. `error` es «esto no se puede representar»: un mensaje que va a
 * ninguna parte. `aviso` es «esto se puede representar pero probablemente no es
 * lo que había en el original»: un hueco en la numeración, un objeto que no
 * habla con nadie. La distinción importa porque un error bloquea la
 * importación y un aviso no, y confundirlos convierte la pantalla de revisión
 * en una que se acepta sin leer.
 */

export type CodigoIntegridad =
  /** El diagrama no tiene ni un objeto. */
  | 'sin-participantes'
  /** Un mensaje sale de un objeto que no está en el diagrama. */
  | 'emisor-colgante'
  /** Un mensaje llega a un objeto que no está en el diagrama. */
  | 'destinatario-colgante'
  /** Un enlace tiene un extremo que no está en el diagrama. */
  | 'enlace-colgante'
  /** Dos objetos distintos con la misma etiqueta. */
  | 'alias-repetido'
  /** El objeto no declara de qué clase es. */
  | 'objeto-sin-clase'
  /** El objeto no manda ni recibe nada. */
  | 'objeto-aislado'
  /** Dos mensajes con el mismo número de secuencia. */
  | 'numero-repetido'
  /** Hay un `1.2` y no hay ningún `1`. */
  | 'secuencia-sin-padre'
  /** Hay un `1` y un `3` y no hay `2`. */
  | 'secuencia-con-hueco'
  /** Un mensaje sin nombre: la flecha saldría en blanco. */
  | 'mensaje-sin-nombre'
  /** Una respuesta que no contesta a ninguna llamada. */
  | 'respuesta-sin-llamada'
  /** Un mensaje que viaja por donde el fichero no declara enlace. */
  | 'mensaje-sin-enlace';

export interface ProblemaIntegridad {
  readonly severidad: 'error' | 'aviso';
  readonly codigo: CodigoIntegridad;
  /** Redactado para quien importó el fichero, no para quien escribió esto. */
  readonly mensaje: string;
  /** `xmi:id` de lo que falla, para poder buscarlo en el fichero original. */
  readonly elementos: readonly string[];
}

export interface Integridad {
  /** `false` si hay algún `error`. Los avisos no lo tumban. */
  readonly integro: boolean;
  readonly problemas: readonly ProblemaIntegridad[];
}

// ---------------------------------------------------------------------------

export function comprobarIntegridad(diagrama: DiagramaComunicacionUml): Integridad {
  const problemas: ProblemaIntegridad[] = [];
  const anotar = (
    severidad: 'error' | 'aviso',
    codigo: CodigoIntegridad,
    mensaje: string,
    elementos: readonly string[] = [],
  ): void => {
    problemas.push({ severidad, codigo, mensaje, elementos });
  };

  const porId = new Map(diagrama.participantes.map((p) => [p.id, p]));
  const etiqueta = (id: string): string => {
    const p = porId.get(id);
    if (p === undefined) return id;
    if (p.alias !== '' && p.clase !== undefined) return `${p.alias}:${p.clase}`;
    if (p.alias !== '') return p.alias;
    return p.clase ?? id;
  };

  // ---- objetos ------------------------------------------------------------

  if (diagrama.participantes.length === 0) {
    anotar(
      'error',
      'sin-participantes',
      `«${diagrama.nombre}» no tiene ningún objeto. Un diagrama de comunicación sin objetos ` +
        'no es representable; probablemente el fichero trae la interacción pero no sus líneas de vida.',
    );
    return { integro: false, problemas };
  }

  const porEtiqueta = new Map<string, string[]>();
  for (const p of diagrama.participantes) {
    if (p.clase === undefined) {
      anotar(
        'aviso',
        'objeto-sin-clase',
        `El objeto «${p.alias === '' ? p.id : p.alias}» no dice de qué clase es. Se dibuja igual, ` +
          'pero no se puede relacionar con el diagrama de clases.',
        [p.id],
      );
    }
    const clave = `${p.alias.toLowerCase()}|${(p.clase ?? '').toLowerCase()}`;
    if (clave === '|') continue;
    porEtiqueta.set(clave, [...(porEtiqueta.get(clave) ?? []), p.id]);
  }
  for (const [, ids] of porEtiqueta) {
    if (ids.length < 2) continue;
    anotar(
      'aviso',
      'alias-repetido',
      `Hay ${String(ids.length)} objetos que se llaman «${etiqueta(ids[0]!)}». En el dibujo son ` +
        'cajas distintas y no se van a poder distinguir; en el fichero original quizá eran el mismo.',
      ids,
    );
  }

  // ---- extremos -----------------------------------------------------------

  const hablan = new Set<string>();
  for (const m of diagrama.mensajes) {
    if (!porId.has(m.de)) {
      anotar(
        'error',
        'emisor-colgante',
        `El mensaje «${m.numero}: ${m.nombre}» sale de un objeto que no está en el diagrama.`,
        [m.id, m.de],
      );
    } else hablan.add(m.de);

    if (!porId.has(m.a)) {
      anotar(
        'error',
        'destinatario-colgante',
        `El mensaje «${m.numero}: ${m.nombre}» va a un objeto que no está en el diagrama.`,
        [m.id, m.a],
      );
    } else hablan.add(m.a);

    if (m.nombre.trim() === '') {
      anotar(
        'aviso',
        'mensaje-sin-nombre',
        `El mensaje número ${m.numero} no tiene nombre: la flecha sale en blanco.`,
        [m.id],
      );
    }
  }

  for (const e of diagrama.enlaces) {
    if (porId.has(e.a) && porId.has(e.b)) continue;
    anotar(
      'error',
      'enlace-colgante',
      'Hay un enlace con un extremo que no está en el diagrama.',
      [e.id, e.a, e.b],
    );
  }

  for (const p of diagrama.participantes) {
    if (hablan.has(p.id)) continue;
    if (diagrama.enlaces.some((e) => e.a === p.id || e.b === p.id)) continue;
    anotar(
      'aviso',
      'objeto-aislado',
      `El objeto «${etiqueta(p.id)}» no manda ni recibe nada, y no tiene ningún enlace. ` +
        'Se importa, pero en el original quizá sí participaba y el mensaje se ha perdido.',
      [p.id],
    );
  }

  // ---- secuencia ----------------------------------------------------------

  comprobarSecuencia(diagrama.mensajes, anotar);

  // ---- respuestas ---------------------------------------------------------

  const llamadas = new Set<string>();
  for (const m of diagrama.mensajes) {
    if (m.clase === 'llamada' || m.clase === 'asincrono') llamadas.add(`${m.de}>${m.a}`);
  }
  for (const m of diagrama.mensajes) {
    if (m.clase !== 'respuesta') continue;
    // Una respuesta va al revés que su llamada: de B a A contesta a la de A a B.
    if (llamadas.has(`${m.a}>${m.de}`)) continue;
    anotar(
      'aviso',
      'respuesta-sin-llamada',
      `«${m.numero}: ${m.nombre}» está marcado como respuesta, pero ${etiqueta(m.a)} nunca llama ` +
        `a ${etiqueta(m.de)}. Comprueba el sentido de la flecha en el original.`,
      [m.id],
    );
  }

  // ---- mensajes fuera de enlace -------------------------------------------

  /*
    Solo cuando el fichero declara enlaces. UML dice que un mensaje viaja por un
    enlace, pero hay muchos diagramas —los que emite este mismo proyecto, sin ir
    más lejos, antes de la versión que añadió los conectores— en los que los
    enlaces están implícitos en los mensajes y no se escriben. Con esos, la
    comprobación saltaría en cada flecha y no informaría de nada.
  */
  if (diagrama.enlaces.length > 0) {
    const declarados = new Set(diagrama.enlaces.map((e) => clavePar(e.a, e.b)));
    const yaDicho = new Set<string>();
    for (const m of diagrama.mensajes) {
      if (m.de === m.a) continue;
      if (!porId.has(m.de) || !porId.has(m.a)) continue;
      const clave = clavePar(m.de, m.a);
      if (declarados.has(clave) || yaDicho.has(clave)) continue;
      yaDicho.add(clave);
      anotar(
        'aviso',
        'mensaje-sin-enlace',
        `${etiqueta(m.de)} manda mensajes a ${etiqueta(m.a)} pero el fichero no declara un ` +
          'enlace entre los dos. Se dibuja el enlace de todos modos, porque el mensaje lo prueba.',
        [m.id],
      );
    }
  }

  return { integro: !problemas.some((p) => p.severidad === 'error'), problemas };
}

// ---------------------------------------------------------------------------
// Numeración
// ---------------------------------------------------------------------------

function comprobarSecuencia(
  mensajes: readonly MensajeUml[],
  anotar: (
    severidad: 'error' | 'aviso',
    codigo: CodigoIntegridad,
    mensaje: string,
    elementos?: readonly string[],
  ) => void,
): void {
  /*
    Solo se comprueba la numeración que venía escrita en el fichero.

    La que se deduce del orden del documento es contigua por construcción —1, 2,
    3…—, así que buscarle huecos sería comprobar el código propio, y además
    daría falsos positivos en cuanto un fichero mezcle las dos cosas: los
    números deducidos rellenan los que la numeración escrita dejó libres, y eso
    no es un error, es el reparto.
  */
  const delFichero = mensajes.filter((m) => m.ordenDe === 'fichero');
  if (delFichero.length === 0) return;

  const porNumero = new Map<string, string[]>();
  for (const m of delFichero) {
    porNumero.set(m.numero, [...(porNumero.get(m.numero) ?? []), m.id]);
  }
  for (const [numero, ids] of porNumero) {
    if (ids.length < 2) continue;
    anotar(
      'aviso',
      'numero-repetido',
      `Hay ${String(ids.length)} mensajes numerados «${numero}». En un diagrama de comunicación ` +
        'el número es lo que dice el orden, así que dos iguales dejan la secuencia ambigua.',
      ids,
    );
  }

  const existentes = new Set(porNumero.keys());
  for (const numero of existentes) {
    const padre = numeroPadre(numero);
    if (padre === undefined || existentes.has(padre)) continue;
    anotar(
      'aviso',
      'secuencia-sin-padre',
      `Hay un mensaje «${numero}» pero ninguno «${padre}». El ${numero} es lo que provoca el ` +
        `${padre}, así que falta el mensaje que lo desencadena o su número está mal escrito.`,
      porNumero.get(numero) ?? [],
    );
  }

  // Huecos dentro de un mismo nivel: `1, 2, 4` sin el `3`.
  const niveles = new Map<string, Set<number>>();
  for (const numero of existentes) {
    const padre = numeroPadre(numero) ?? '';
    const ultimo = numero.slice(padre === '' ? 0 : padre.length + 1);
    const casa = /^[A-Za-z]?(\d+)[a-z]?$/.exec(ultimo);
    if (casa === null) continue;
    const conjunto = niveles.get(padre) ?? new Set<number>();
    conjunto.add(Number(casa[1]));
    niveles.set(padre, conjunto);
  }
  for (const [padre, numeros] of niveles) {
    const mayor = Math.max(...numeros);
    const faltan: number[] = [];
    for (let i = 1; i < mayor; i += 1) if (!numeros.has(i)) faltan.push(i);
    if (faltan.length === 0) continue;
    const donde = padre === '' ? '' : ` bajo «${padre}»`;
    anotar(
      'aviso',
      'secuencia-con-hueco',
      `La numeración${donde} salta: falta ${faltan.map((n) => `«${prefijar(padre, n)}»`).join(', ')}. ` +
        'O el fichero venía así, o esos mensajes no se han podido importar.',
    );
  }
}

function prefijar(padre: string, n: number): string {
  return padre === '' ? String(n) : `${padre}.${String(n)}`;
}
