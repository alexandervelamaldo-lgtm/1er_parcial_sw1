import { MAXIMO_MENSAJES_POR_PROYECTO, type MensajePublico } from '@app/shared';

/**
 * El tablón por dentro: fusión del sondeo, agrupación del hilo y cadencia.
 *
 * Sin DOM y sin `fetch`. Aquí están las tres decisiones que se pueden
 * equivocar sin que se note mirando la pantalla —qué mensaje gana cuando llega
 * dos veces, dónde se corta un bloque, cada cuánto se vuelve a preguntar— y
 * que por eso se prueban aparte. `Tablon.tsx` solo dibuja lo que salga de
 * aquí.
 */

/* --------------------------------------------------------------------------
   Fusión
   -------------------------------------------------------------------------- */

/**
 * Mezcla lo que ya había en pantalla con lo que acaba de traer el sondeo.
 *
 * Tres cosas que no son evidentes:
 *
 * 1. **Gana la `version` más alta, no lo que llega después.** El cliente
 *    publica un mensaje y lo pinta con la respuesta del `POST`; el sondeo que
 *    estaba en vuelo puede contestar después con una copia anterior del mismo
 *    mensaje. Sin comparar versiones, esa respuesta tardía repondría un
 *    mensaje ya retirado.
 * 2. **El orden sale de `secuencia`, no del orden de llegada.** Es lo que hace
 *    que un mensaje retirado se quede donde estaba en lugar de saltar al final
 *    del hilo cuando su retirada llega por el sondeo.
 * 3. **La lista se recorta por arriba.** Una pestaña abierta toda la tarde
 *    acumularía en memoria todo lo que el servidor ya ni guarda.
 */
export function fusionar(
  actuales: readonly MensajePublico[],
  llegados: readonly MensajePublico[],
  maximo: number = MAXIMO_MENSAJES_POR_PROYECTO,
): MensajePublico[] {
  const porId = new Map<string, MensajePublico>();
  for (const mensaje of actuales) porId.set(mensaje.id, mensaje);

  for (const mensaje of llegados) {
    const previo = porId.get(mensaje.id);
    if (!previo || mensaje.version >= previo.version) porId.set(mensaje.id, mensaje);
  }

  const hilo = [...porId.values()].sort((a, b) => a.secuencia - b.secuencia);
  return hilo.length > maximo ? hilo.slice(hilo.length - maximo) : hilo;
}

/**
 * El cursor que se manda en el siguiente sondeo.
 *
 * Se toma el que diga el servidor y solo se sube si lo recibido va por delante.
 * Nunca baja: con dos peticiones en vuelo —el sondeo periódico y el que dispara
 * el usuario al volver a la pestaña— la respuesta más vieja puede llegar la
 * última, y aceptar su cursor obligaría a releer un tramo del hilo que ya
 * estaba en pantalla.
 */
export function avanzarCursor(actual: number, recibido: number): number {
  return Math.max(actual, recibido);
}

/* --------------------------------------------------------------------------
   Agrupación
   -------------------------------------------------------------------------- */

/**
 * Hueco a partir del cual dos mensajes de la misma persona dejan de ser una
 * parrafada y pasan a ser dos intervenciones.
 *
 * Cinco minutos. Por debajo, quien escribe tres líneas seguidas produce tres
 * cabeceras con su nombre repetido y el hilo se lee como un formulario; por
 * encima, dos conversaciones separadas por media hora se pintan pegadas y
 * parece que la respuesta fue inmediata.
 */
export const HUECO_DE_BLOQUE_MS = 5 * 60 * 1000;

export interface BloqueDeTablon {
  /** Estable entre renderizados: es el `id` del primer mensaje del bloque. */
  clave: string;
  autorId: string;
  autorNombre: string | null;
  /** El día al que pertenece el bloque, en formato ISO corto (`2026-09-15`). */
  dia: string;
  mensajes: MensajePublico[];
}

/** El día local de una marca ISO, para comparar sin arrastrar la hora. */
function diaDe(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');
  return `${String(fecha.getFullYear())}-${mes}-${dia}`;
}

/**
 * Parte el hilo en bloques de «una persona hablando seguido».
 *
 * Se corta al cambiar de autor, al cambiar de día y al pasar `HUECO_DE_BLOQUE_MS`
 * entre dos mensajes. Un mensaje retirado **no** parte el bloque: sigue siendo
 * la misma persona hablando, y romper por él dejaría el nombre repetido a los
 * dos lados de una lápida.
 */
export function agrupar(mensajes: readonly MensajePublico[]): BloqueDeTablon[] {
  const bloques: BloqueDeTablon[] = [];

  for (const mensaje of mensajes) {
    const dia = diaDe(mensaje.creadoEn);
    const ultimo = bloques[bloques.length - 1];
    const anterior = ultimo?.mensajes[ultimo.mensajes.length - 1];

    const sigue =
      ultimo !== undefined &&
      anterior !== undefined &&
      ultimo.autorId === mensaje.autorId &&
      ultimo.dia === dia &&
      new Date(mensaje.creadoEn).getTime() - new Date(anterior.creadoEn).getTime() <=
        HUECO_DE_BLOQUE_MS;

    if (sigue) {
      ultimo.mensajes.push(mensaje);
      // El nombre del bloque lo pone el mensaje más reciente que lo traiga: si
      // una cuenta se borró y luego se leyó bien, vale más el dato que existe
      // que el hueco con el que se abrió el bloque.
      if (mensaje.autorNombre !== null) ultimo.autorNombre = mensaje.autorNombre;
      continue;
    }

    bloques.push({
      clave: mensaje.id,
      autorId: mensaje.autorId,
      autorNombre: mensaje.autorNombre,
      dia,
      mensajes: [mensaje],
    });
  }

  return bloques;
}

/* --------------------------------------------------------------------------
   Cadencia del sondeo
   -------------------------------------------------------------------------- */

/** Conversación en marcha: el retardo que se nota poco al escribir a la vez. */
export const ESPERA_VIVA_MS = 3_000;
/** Nadie ha dicho nada en un rato. */
export const ESPERA_TIBIA_MS = 10_000;
/** Hace mucho que nadie dice nada: el tablón está abierto pero parado. */
export const ESPERA_DORMIDA_MS = 30_000;
/** La pestaña no está a la vista. Se sigue sondeando, pero de lejos. */
export const ESPERA_OCULTA_MS = 60_000;
/** Techo del retroceso cuando el servidor no contesta. */
export const ESPERA_MAXIMA_MS = 30_000;

export interface EstadoDeSondeo {
  /** Sondeos seguidos que no han traído nada. */
  vacios: number;
  /** Fallos de red seguidos. Se pone a cero con la primera respuesta buena. */
  fallos: number;
  /** ¿Está la pestaña a la vista? */
  visible: boolean;
}

/**
 * Cuánto esperar antes de volver a preguntar.
 *
 * Un intervalo fijo de tres segundos es lo fácil de escribir y lo caro de
 * tener: veinte peticiones por minuto y persona, también a las tres de la
 * madrugada con la pestaña olvidada en segundo plano y también cuando el
 * servidor lleva un minuto sin contestar. Las tres situaciones se tratan
 * distinto:
 *
 * - **Con fallos**, retroceso exponencial hasta medio minuto. Si el servicio se
 *   ha caído, insistir cada tres segundos multiplica la carga justo cuando
 *   menos puede con ella.
 * - **En segundo plano**, un minuto. No se para del todo a propósito: al volver
 *   a la pestaña conviene que el hilo ya esté casi al día en lugar de enseñar
 *   una conversación de hace media hora mientras carga.
 * - **En primer plano**, de tres a treinta segundos según lleve rato sin pasar
 *   nada. Cualquier mensaje que se reciba devuelve el contador a cero, así que
 *   una conversación activa nunca se ralentiza.
 */
export function siguienteEspera(estado: EstadoDeSondeo): number {
  if (estado.fallos > 0) {
    const retroceso = Math.min(ESPERA_VIVA_MS * 2 ** estado.fallos, ESPERA_MAXIMA_MS);
    return estado.visible ? retroceso : Math.max(retroceso, ESPERA_OCULTA_MS);
  }
  if (!estado.visible) return ESPERA_OCULTA_MS;
  if (estado.vacios < 5) return ESPERA_VIVA_MS;
  if (estado.vacios < 20) return ESPERA_TIBIA_MS;
  return ESPERA_DORMIDA_MS;
}

/* --------------------------------------------------------------------------
   Lo que se lee en pantalla
   -------------------------------------------------------------------------- */

/** `0:07`, `1:23`. Los milisegundos se redondean hacia abajo: un contador que
 *  empieza en `0:01` parece que va adelantado. */
export function duracionLegible(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutos = Math.floor(total / 60);
  return `${String(minutos)}:${String(total % 60).padStart(2, '0')}`;
}

/** La hora del mensaje, sin segundos: `09:42`. */
export function horaCorta(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * El separador de día: «Hoy», «Ayer» o «14 de marzo».
 *
 * `hoy` se pasa como parámetro en vez de leer el reloj dentro porque si no la
 * función solo se podría probar el día que se escribió la prueba.
 */
export function etiquetaDeDia(dia: string, hoy: Date): string {
  const [ano, mes, numero] = dia.split('-').map(Number);
  if (ano === undefined || mes === undefined || numero === undefined) return '';

  const suyo = new Date(ano, mes - 1, numero);
  const referencia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dias = Math.round((referencia.getTime() - suyo.getTime()) / 86_400_000);

  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Ayer';
  const conAno = suyo.getFullYear() === hoy.getFullYear() ? '' : ` de ${String(ano)}`;
  return `${String(numero)} de ${MESES[mes - 1] ?? ''}${conAno}`;
}

/**
 * ¿Puede esta persona retirar este mensaje?
 *
 * La misma regla que aplica el servidor en `api/tablon.ts`: el autor y el
 * propietario del proyecto. Se repite aquí solo para no ofrecer un botón que
 * va a dar 403; la que manda es la del servidor, porque esta corre en el
 * navegador y ahí no se decide nada.
 */
export function puedeRetirar(
  mensaje: MensajePublico,
  usuarioId: string,
  rol: 'owner' | 'editor' | 'viewer',
): boolean {
  if (mensaje.retirado) return false;
  return mensaje.autorId === usuarioId || rol === 'owner';
}

/**
 * Qué se enseña en el sitio de un mensaje retirado.
 *
 * Se deja el hueco con una frase en lugar de quitar la fila: quien estaba
 * leyendo el hilo vio que había algo ahí, y hacerlo desaparecer en silencio
 * deja la conversación con respuestas a preguntas que ya no están.
 */
export const TEXTO_RETIRADO = 'Mensaje retirado';

/** Lo que se lee cuando el proyecto todavía no tiene conversación. */
export const TABLON_VACIO =
  'Aquí se coordinan los cambios del diagrama. Todavía no hay ningún mensaje.';
