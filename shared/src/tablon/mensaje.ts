import { z } from 'zod';

/**
 * Tablón del proyecto: el contrato del módulo de comunicación interna.
 *
 * Qué es. Un hilo de mensajes por proyecto, compartido por todos sus miembros,
 * donde se escribe o se deja una nota de voz. No es mensajería privada entre
 * dos personas ni un canal por clase del diagrama: es **un solo tablón por
 * proyecto**, que es la unidad que la herramienta ya sabe autorizar. Los
 * permisos salen gratis de `ProjectStore.roleOf`, y no hay una segunda noción
 * de «quién ve qué» que pueda desincronizarse de la primera.
 *
 * ## Por qué se llama tablón y no «comunicación»
 *
 * En este proyecto «diagrama de comunicación» ya significa otra cosa —el
 * diagrama UML que se importa desde Enterprise Architect y se dibuja en
 * `VisorComunicacion`—, y hay un `comunicacion.ts` en `shared/src/model`, otro
 * en `shared/src/crdt` y dos componentes más en el frontend. Un tercer sentido
 * de la misma palabra convertiría cada importación en una pregunta. El nombre
 * de cara al usuario sí es «Comunicación interna»; el del código es «tablón».
 *
 * ## Las dos numeraciones, que no son la misma
 *
 * Cada mensaje lleva `secuencia` y `version`, y confundirlas rompe una de las
 * dos cosas:
 *
 * - **`secuencia` ordena.** Se asigna al publicar y no cambia nunca. Es lo que
 *   decide en qué orden se pintan los mensajes.
 * - **`version` sincroniza.** Se asigna al publicar y **vuelve a asignarse**
 *   cada vez que el mensaje cambia, que hoy solo ocurre al retirarlo. Es lo que
 *   el cliente manda en `?desde=` para pedir «lo que no he visto».
 *
 * Con una sola numeración habría que elegir cuál se rompe. Si se reutilizara
 * `secuencia` como cursor y se bumpeara al retirar, el mensaje retirado saltaría
 * al final del hilo delante de quien lo estuviera mirando. Si no se bumpeara,
 * quien ya hubiera pasado de ese número **nunca se enteraría de la retirada**:
 * la nota de voz seguiría en su pantalla, y reproducible, después de borrarse
 * del servidor. Son dos preguntas distintas —«¿dónde va esto?» y «¿qué ha
 * cambiado desde que miré?»— y necesitan dos respuestas.
 *
 * Las dos salen del mismo contador por proyecto, así que siempre son
 * comparables entre sí y nunca hay empates.
 *
 * ## Por qué retirar deja lápida
 *
 * Borrar la fila entera sería invisible para el sondeo: quien ya tuviera el
 * mensaje en pantalla se lo quedaría para siempre, porque un cliente que
 * pregunta «¿qué hay de nuevo?» no puede recibir por respuesta la ausencia de
 * algo. Así que la fila sobrevive con `retirado: true` y sin contenido, y lo que
 * sí se borra de verdad es lo que importa: el texto y **los bytes del audio**.
 */

/**
 * Tope del texto de un mensaje.
 *
 * Dos mil caracteres son unas trescientas palabras: de sobra para «el atributo
 * de Cliente lo dejamos como String» y corto para que nadie pegue aquí el
 * manual entero. El límite se comprueba sobre el texto ya recortado, para que
 * dos mil espacios no cuenten como un mensaje.
 */
export const MAXIMO_TEXTO = 2000;

/**
 * Tope de una nota de voz, en bytes.
 *
 * Un megabyte son unos cinco minutos de Opus a la calidad que usa el navegador
 * para voz, muy por encima del minuto y medio que admite la duración. Sobra a
 * propósito: el límite que debe frenar al usuario es el de tiempo, que se ve
 * contando mientras graba, y no uno de tamaño que dependa del códec que le haya
 * tocado al navegador y que solo aparezca al soltar el botón.
 */
export const MAXIMO_AUDIO_BYTES = 1024 * 1024;

/**
 * Duración máxima de una nota de voz.
 *
 * Noventa segundos. Una nota más larga que eso es una reunión, y nadie la
 * escucha: el formato pide que quien habla resuma, igual que el tope de texto
 * pide que quien escribe no pegue un documento. Además acota el gasto de
 * almacenamiento por mensaje sin tener que explicar bytes a nadie.
 */
export const MAXIMA_DURACION_MS = 90_000;

/**
 * Mensajes que se conservan por proyecto.
 *
 * Por encima de este número se borran los más antiguos, con sus audios. El
 * tablón es para coordinarse mientras se dibuja, no un archivo histórico: sin
 * tope, un proyecto de un cuatrimestre con notas de voz diarias crece sin que
 * nadie lo mire hasta que el disco lo mira por nosotros.
 *
 * El recorte **no** se anuncia por el sondeo, y es una diferencia real con la
 * retirada: un cliente que lleve abierto lo suficiente como para tener en
 * pantalla un mensaje ya recortado seguirá viéndolo hasta que recargue. Se
 * acepta porque el recorte solo alcanza a lo que quedó quinientos mensajes
 * atrás, que nadie tiene delante.
 */
export const MAXIMO_MENSAJES_POR_PROYECTO = 500;

/** Mensajes que devuelve una página del listado. */
export const MENSAJES_POR_PAGINA = 50;

/**
 * Tipos de audio que se aceptan, sin parámetros.
 *
 * La lista es cerrada porque este valor vuelve a salir tal cual en la cabecera
 * `Content-Type` de la descarga. Si se guardara lo que mande el cliente, una
 * cadena con un salto de línea dentro sería una inyección de cabeceras, y una
 * con `text/html` convertiría una nota de voz en una página servida desde
 * nuestro origen. Al guardar solo uno de estos literales, lo que se escribe en
 * la cabecera es siempre una constante de este fichero.
 *
 * Los tres cubren lo que producen los navegadores reales: `webm` en Chrome y
 * derivados, `mp4` en Safari, `ogg` en Firefox de escritorio.
 */
export const TIPOS_AUDIO = ['audio/webm', 'audio/ogg', 'audio/mp4'] as const;
export type TipoAudio = (typeof TIPOS_AUDIO)[number];

/**
 * Reduce el `MediaRecorder.mimeType` del navegador a uno de los tipos
 * aceptados, o devuelve `null` si no es ninguno.
 *
 * Hace falta porque el navegador no manda `audio/webm` sino
 * `audio/webm;codecs=opus`, y comparar con igualdad rechazaría todas las
 * grabaciones reales. Se recorta el parámetro y se compara el tipo base contra
 * la lista blanca: **rechazando, no arreglando**. Lo que se devuelve no es la
 * cadena del cliente saneada, sino el literal de `TIPOS_AUDIO` que le
 * corresponde, que es una constante nuestra.
 */
export function normalizarTipoAudio(valor: string): TipoAudio | null {
  const base = valor.split(';')[0]?.trim().toLowerCase() ?? '';
  return TIPOS_AUDIO.find((tipo) => tipo === base) ?? null;
}

/** Extensión con la que se ofrece la descarga de cada tipo. */
export function extensionDeAudio(tipo: TipoAudio): string {
  const extensiones: Record<TipoAudio, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
  };
  return extensiones[tipo];
}

export const TipoAudioSchema = z.enum(TIPOS_AUDIO);

/**
 * Metadatos del audio. Los bytes no viajan aquí: se piden aparte, por su propia
 * ruta, para que listar el tablón no descargue cinco minutos de voz que quizá
 * nadie reproduzca.
 */
export const AudioSchema = z.object({
  tipo: TipoAudioSchema,
  bytes: z.number().int().positive().max(MAXIMO_AUDIO_BYTES),
  /**
   * La mide el navegador que graba, así que es orientativa: sirve para pintar
   * «0:14» junto al botón antes de descargar nada, no para cortar la
   * reproducción.
   */
  duracionMs: z.number().int().nonnegative().max(MAXIMA_DURACION_MS),
});
export type Audio = z.infer<typeof AudioSchema>;

/**
 * Identificador de autor.
 *
 * No se exige UUID. La identidad definitiva la aportará un proveedor externo
 * (Arquitectura §2.9, decisión D8) que numerará a su manera, y una restricción
 * de formato aquí obligaría a relajarla justo el día de esa integración. Lo que
 * sí se acota es la longitud, porque el valor acaba en un índice.
 */
const IdAutorSchema = z.string().min(1).max(200);

export const MensajeSchema = z.object({
  id: z.string().uuid(),
  proyectoId: z.string().min(1).max(200),
  autorId: IdAutorSchema,
  /** Ordena el hilo. Inmutable. Ver la cabecera del fichero. */
  secuencia: z.number().int().positive(),
  /** Cursor del sondeo. Cambia al retirar. Ver la cabecera del fichero. */
  version: z.number().int().positive(),
  creadoEn: z.string().datetime({ offset: true }),
  tipo: z.enum(['texto', 'voz']),
  /** Vacío en las notas de voz y en los mensajes retirados. */
  texto: z.string().max(MAXIMO_TEXTO),
  /** `null` en los mensajes de texto y en las notas de voz ya retiradas. */
  audio: AudioSchema.nullable(),
  retirado: z.boolean(),
});
export type Mensaje = z.infer<typeof MensajeSchema>;

/**
 * Lo que devuelve la API: el mensaje más el nombre de quien lo escribió.
 *
 * El nombre se resuelve en el servidor y no en el cliente a partir de la lista
 * de miembros, porque quien escribió hace dos semanas puede haber sido
 * expulsado del proyecto desde entonces. Resolviéndolo en el cliente, sus
 * mensajes pasarían a aparecer firmados por nadie, y el hilo dejaría de tener
 * sentido justo en la conversación que explica por qué se fue.
 *
 * Es `null` solo si la cuenta ya no existe en el proveedor de identidad.
 */
export const MensajePublicoSchema = MensajeSchema.extend({
  autorNombre: z.string().nullable(),
});
export type MensajePublico = z.infer<typeof MensajePublicoSchema>;

export const RespuestaTablonSchema = z.object({
  mensajes: z.array(MensajePublicoSchema),
  /**
   * Cursor que el cliente devolverá en el siguiente sondeo. Lo calcula el
   * servidor y no el cliente tomando el máximo de lo recibido: con una respuesta
   * vacía el cliente no tendría de dónde sacarlo y tendría que recordar el
   * anterior, que es la clase de estado que se pierde al recargar y provoca una
   * relectura del hilo entero.
   */
  cursor: z.number().int().nonnegative(),
  /** `true` si se truncó la página y quedan mensajes más nuevos por pedir. */
  hayMas: z.boolean(),
});
export type RespuestaTablon = z.infer<typeof RespuestaTablonSchema>;

/**
 * Normaliza el texto que llega en un mensaje, o explica por qué no vale.
 *
 * Se recortan los extremos y se unifican los finales de línea de Windows, pero
 * **no** se toca nada más: el contenido es prosa de una persona y aquí no se
 * censura, se acota. Los saltos de línea interiores se respetan porque quien
 * pega una lista de tres cosas espera verlas en tres líneas.
 */
export function normalizarTexto(valor: string): { ok: true; texto: string } | { ok: false; motivo: string } {
  const texto = valor.replace(/\r\n/g, '\n').trim();
  if (texto.length === 0) return { ok: false, motivo: 'El mensaje está vacío' };
  if (texto.length > MAXIMO_TEXTO) {
    return { ok: false, motivo: `El mensaje supera los ${MAXIMO_TEXTO} caracteres` };
  }
  return { ok: true, texto };
}

/**
 * Orden en el que se pinta el hilo: por `secuencia` ascendente.
 *
 * Se ordena por el contador y no por `creadoEn` porque la fecha la pone el
 * servidor con precisión de milisegundo y dos mensajes publicados a la vez
 * pueden empatar; el contador no empata nunca. Además, si alguna vez el reloj
 * de la máquina retrocede —un ajuste NTP basta—, la fecha deja de ser monótona
 * y el contador sigue siéndolo.
 */
export function ordenarHilo(mensajes: readonly Mensaje[]): Mensaje[] {
  return [...mensajes].sort((a, b) => a.secuencia - b.secuencia);
}

/**
 * Convierte un mensaje en su lápida: sin texto, sin audio y con la marca
 * puesta. No se toca `secuencia`, para que no se mueva de sitio en el hilo.
 */
export function retirar(mensaje: Mensaje, version: number): Mensaje {
  return { ...mensaje, texto: '', audio: null, retirado: true, version };
}
