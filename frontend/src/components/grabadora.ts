import { MAXIMA_DURACION_MS, TIPOS_AUDIO, normalizarTipoAudio } from '@app/shared';

/**
 * La grabadora de notas de voz, sin `MediaRecorder` y sin DOM.
 *
 * Aquí está la máquina de estados —qué pasa al pulsar, al soltar, al pasar el
 * tiempo, al fallar— y fuera queda todo lo que toca el micrófono. La razón de
 * separarlo es que los fallos de esta parte son invisibles en una demo y
 * costosos en uso real: una grabación que no se corta sola a los noventa
 * segundos se sube, la rechaza el servidor y quien habló pierde el minuto y
 * medio entero.
 *
 * `Tablon.tsx` pone el micrófono; esto decide qué se ve y cuándo se envía.
 */

/**
 * Duración por debajo de la cual no se envía nada.
 *
 * Medio segundo. Un botón de «mantener pulsado» recoge muchos toques
 * accidentales, y cada uno sería una nota de voz vacía en el hilo de todo el
 * proyecto. Se descarta en silencio con un aviso corto, en vez de subir un
 * fichero de 40 bytes que nadie puede reproducir.
 */
export const MINIMA_DURACION_MS = 500;

/**
 * Cuándo empieza a avisarse de que se acaba el tiempo.
 *
 * Diez segundos antes del tope. Si la cuenta atrás apareciera solo al llegar,
 * el corte automático sería una sorpresa a mitad de frase.
 */
export const AVISO_FINAL_MS = 10_000;

export type FaseGrabacion = 'inactiva' | 'grabando' | 'enviando' | 'error';

export interface EstadoGrabadora {
  fase: FaseGrabacion;
  /** Milisegundos grabados. Solo significa algo en `grabando` y `enviando`. */
  transcurridoMs: number;
  /** Lo que se dice en pantalla cuando algo ha salido mal. */
  error: string | null;
  /**
   * `true` en la transición exacta en la que hay que cerrar el micrófono y
   * subir lo grabado. Lo consume el componente y no sobrevive a la acción
   * siguiente: es un aviso de una sola vez, no un estado.
   */
  hayQueEnviar: boolean;
}

export const GRABADORA_INACTIVA: EstadoGrabadora = {
  fase: 'inactiva',
  transcurridoMs: 0,
  error: null,
  hayQueEnviar: false,
};

export type AccionGrabadora =
  | { tipo: 'empezar' }
  /** El reloj del componente, con el tiempo total desde que se empezó. */
  | { tipo: 'tictac'; transcurridoMs: number }
  | { tipo: 'soltar' }
  | { tipo: 'cancelar' }
  | { tipo: 'enviada' }
  | { tipo: 'fallo'; motivo: string };

/**
 * La máquina de estados de la grabadora.
 *
 * Las transiciones que importan, y por qué:
 *
 * - **`tictac` pasado el tope corta solo.** No es una comodidad: el servidor
 *   rechaza lo que pase de `MAXIMA_DURACION_MS`, así que sin este corte la
 *   grabación llega al final, se sube y se pierde entera. Se envía lo grabado
 *   hasta el tope en lugar de tirarlo.
 * - **`soltar` antes de `MINIMA_DURACION_MS` no envía.** Un toque accidental
 *   no es una nota de voz.
 * - **`empezar` mientras se envía no hace nada.** Dos grabaciones a la vez
 *   dejarían una sin dueño, y el micrófono es uno.
 * - **`cancelar` siempre vuelve al principio**, incluso desde `error`: es lo
 *   que hace el botón de cerrar, y un estado del que no se puede salir es un
 *   panel bloqueado.
 */
export function reducir(estado: EstadoGrabadora, accion: AccionGrabadora): EstadoGrabadora {
  switch (accion.tipo) {
    case 'empezar':
      if (estado.fase === 'enviando') return estado;
      return { fase: 'grabando', transcurridoMs: 0, error: null, hayQueEnviar: false };

    case 'tictac': {
      if (estado.fase !== 'grabando') return estado;
      if (accion.transcurridoMs >= MAXIMA_DURACION_MS) {
        return {
          fase: 'enviando',
          transcurridoMs: MAXIMA_DURACION_MS,
          error: null,
          hayQueEnviar: true,
        };
      }
      return { ...estado, transcurridoMs: accion.transcurridoMs, hayQueEnviar: false };
    }

    case 'soltar': {
      if (estado.fase !== 'grabando') return estado;
      if (estado.transcurridoMs < MINIMA_DURACION_MS) {
        return {
          fase: 'inactiva',
          transcurridoMs: 0,
          error: 'La nota de voz es demasiado corta.',
          hayQueEnviar: false,
        };
      }
      return { ...estado, fase: 'enviando', error: null, hayQueEnviar: true };
    }

    case 'cancelar':
      return GRABADORA_INACTIVA;

    case 'enviada':
      return GRABADORA_INACTIVA;

    case 'fallo':
      return { fase: 'error', transcurridoMs: 0, error: accion.motivo, hayQueEnviar: false };
  }
}

/** ¿Queda poco para el corte automático? Pinta la cuenta atrás en rojo. */
export function seAcabaElTiempo(transcurridoMs: number): boolean {
  return transcurridoMs >= MAXIMA_DURACION_MS - AVISO_FINAL_MS;
}

/** Lo que queda, para la cuenta atrás. Nunca negativo. */
export function restanteMs(transcurridoMs: number): number {
  return Math.max(0, MAXIMA_DURACION_MS - transcurridoMs);
}

/**
 * Elige el formato con el que grabar.
 *
 * El navegador decide qué sabe producir y no coincide entre unos y otros:
 * Chrome da WebM, Safari da MP4 y Firefox de escritorio da Ogg. La lista de
 * candidatos es la misma que acepta el servidor —con el códec explícito
 * primero, que es lo que hace que Chrome elija Opus en vez de lo que le
 * apetezca— y se devuelve el primero que el navegador reconozca.
 *
 * `null` significa «ninguno de los tres»: entonces no se ofrece grabar en vez
 * de dejar que `MediaRecorder` escoja por su cuenta un formato que el servidor
 * va a rechazar después de que la persona haya hablado.
 *
 * `soporta` se pasa como parámetro —en producción es
 * `MediaRecorder.isTypeSupported`— para que esto se pueda probar sin navegador.
 */
export function tipoPreferido(soporta: (tipo: string) => boolean): string | null {
  const candidatos = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  return candidatos.find((tipo) => soporta(tipo)) ?? null;
}

/**
 * Traduce el fallo de `getUserMedia` a algo accionable.
 *
 * Los nombres son los del estándar. Importa distinguirlos porque cada uno se
 * arregla en un sitio distinto y el mensaje genérico —«no se pudo acceder al
 * micrófono»— manda a mirar el navegador cuando el problema puede ser que el
 * teléfono no tenga concedido el permiso al sistema, o que la página se esté
 * sirviendo por HTTP, donde el micrófono no existe y nunca va a existir.
 */
export function explicarFalloDeMicrofono(error: unknown): string {
  const nombre = error instanceof Error ? error.name : '';

  switch (nombre) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'El navegador ha denegado el acceso al micrófono. Se concede desde el candado de la barra de direcciones.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No se ha encontrado ningún micrófono conectado.';
    case 'NotReadableError':
      return 'El micrófono está ocupado por otra aplicación.';
    default:
      // Sin contexto seguro no hay `mediaDevices` y el fallo es un
      // `TypeError` sin nombre útil: es el caso del despliegue servido por
      // HTTP, donde no hay nada que tocar en el navegador.
      return typeof navigator !== 'undefined' && !navigator.mediaDevices
        ? 'La grabación de voz necesita una conexión segura (HTTPS).'
        : 'No se ha podido abrir el micrófono.';
  }
}

/**
 * Comprueba lo grabado antes de subirlo.
 *
 * Mismo criterio que el servidor y por adelantado: subir un megabyte para que
 * lo rechacen es un minuto perdido con la barra de progreso llena, sobre todo
 * desde un móvil. El tipo se reduce con la misma función que usa el servidor,
 * así que no hay dos listas de formatos que puedan discrepar.
 */
export function comprobarGrabacion(
  bytes: number,
  tipo: string,
  maximoBytes: number,
): { ok: true } | { ok: false; motivo: string } {
  if (bytes === 0) return { ok: false, motivo: 'La grabación ha salido vacía.' };
  if (bytes > maximoBytes) {
    return {
      ok: false,
      motivo: `La nota de voz ocupa ${String(Math.round(bytes / 1024))} kB y el máximo son ${String(Math.round(maximoBytes / 1024))} kB.`,
    };
  }
  if (!normalizarTipoAudio(tipo)) {
    return {
      ok: false,
      motivo: `Este navegador graba en un formato que no se admite (${TIPOS_AUDIO.join(', ')}).`,
    };
  }
  return { ok: true };
}
