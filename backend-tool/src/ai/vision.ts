import {
  listSupportedTypes,
  parseDiagramaExtraido,
  parseTablaExtraida,
  type DiagramaExtraido,
  type TablaExtraida,
} from '@app/shared';
import { extractJson } from './assistant.js';
import { ErrorDeModelo, pedirAlModelo } from './transporte.js';

/**
 * Lectura de una tabla fotografiada (RF-OCR-01).
 *
 * No es un OCR en el sentido clásico —no hay Tesseract ni cajas de texto— sino
 * un modelo de visión al que se le pide la tabla ya estructurada. La diferencia
 * importa: un OCR devuelve caracteres y deja el problema difícil sin resolver
 * (qué es cabecera, qué es dato, dónde acaba una celda), mientras que el modelo
 * devuelve el JSON completo. A cambio, se equivoca de otra manera.
 *
 * Y de qué manera. Probando esto contra una tabla nítida generada por ordenador
 * —sin ruido, sin escritura a mano, sin sombras— el modelo leyó `ana@rrhh.com`
 * como `ana@rrrh.com`, informó `"confianza":1.0` y dejó `"ilegible":[]`. En su
 * razonamiento visible se le ve confirmándose el error a sí mismo. Es decir: la
 * confianza que declara no covaría con acertar, y usarla como umbral para
 * importar sin revisión sería importar datos falsos con más seguridad cuanto
 * más seguro está el modelo.
 *
 * De ahí que este módulo se limite a devolver lo que el modelo dice, validado
 * en su forma pero no creído en su contenido. Quién decide qué entra en el
 * diagrama es la persona que mira la foto y la tabla lado a lado.
 */

const INSTRUCCION = `Extrae la tabla de base de datos que aparece en la imagen.

Responde ÚNICAMENTE con un objeto JSON, sin texto alrededor y sin vallas de código:
{"tabla":"NOMBRE","columnas":[{"nombre":"","tipo":"TIPOS","esClave":true|false}],"filas":[["valor","valor"]],"confianza":0.0-1.0,"ilegible":["..."]}

Reglas:
- "filas" lleva los valores en el mismo orden que "columnas", y cada fila debe tener exactamente tantos valores como columnas haya.
- Los tipos se infieren del contenido de las celdas. Usa solo los de la lista.
- Marca "esClave" en la columna que sea la clave primaria, si la hay.
- Transcribe los valores tal como se leen. No corrijas ortografía, no completes abreviaturas y no normalices formatos de fecha o de número.
- Si una celda, una cabecera o una zona no se lee con seguridad, descríbela en "ilegible" y deja la celda como cadena vacía. Es preferible declarar que no se ve a adivinar.
- Si en la imagen no hay ninguna tabla, devuelve "columnas": [] y explica qué hay en su lugar dentro de "ilegible".`;

/**
 * Instrucción para leer un diagrama de clases entero (RF-VIS-01).
 *
 * Difiere de la de arriba en algo más que el esquema. Al leer una tabla el
 * modelo transcribe texto; al leer un diagrama tiene que interpretar *dibujo*:
 * qué línea une qué recuadros, hacia dónde apunta la punta, si el rombo está
 * relleno o hueco. Ahí se equivoca de formas que no se parecen a una errata.
 *
 * De todo lo que puede leer mal, lo que más caro sale es la cardinalidad: un
 * «0..*» y un «0..1» se distinguen por un carácter junto a una línea, y de esa
 * diferencia depende que el generador emita una clave foránea o una tabla de
 * unión. Por eso la instrucción insiste en que deje el campo vacío antes que
 * suponerlo: una cardinalidad ausente se marca en la revisión y alguien la mira,
 * mientras que una inventada llega al esquema pareciendo leída.
 */
const INSTRUCCION_DIAGRAMA = `Extrae el diagrama de clases UML que aparece en la imagen.

Responde ÚNICAMENTE con un objeto JSON, sin texto alrededor y sin vallas de código:
{"clases":[{"nombre":"","estereotipo":"class|interface|enum|abstract","atributos":[{"nombre":"","tipo":"TIPOS","esClave":true|false}],"metodos":[{"nombre":"","tipoRetorno":"","visibilidad":"+|-|#|~","parametros":[{"nombre":"","tipo":"TIPOS"}]}],"filas":[["valor"]]}],"relaciones":[{"origen":"","destino":"","tipo":"association|aggregation|composition|inheritance|realization|dependency","cardinalidadOrigen":"","cardinalidadDestino":"","nombre":""}],"confianza":0.0-1.0,"ilegible":["..."]}

Reglas:
- "nombre" de cada clase es el texto del compartimento superior del recuadro, tal como se lee.
- Un recuadro UML tiene hasta tres compartimentos: nombre, atributos y operaciones. El TERCERO va en "metodos" y no se puede omitir: si el recuadro tiene un compartimento inferior con nombres seguidos de paréntesis —"+deposit()", "+verifyPassword()"— cada uno es un método.
- Distingue un atributo de un método por el paréntesis, no por el compartimento: si lleva "()" es método aunque esté escrito arriba.
- En "metodos", "nombre" va SIN los paréntesis. Si dentro del paréntesis hay parámetros, ponlos en "parametros"; si está vacío, deja "parametros": [].
- "tipoRetorno" es lo que aparece tras los dos puntos al final de la firma. Si no hay nada escrito, deja "" —significa void— y no lo inventes.
- "visibilidad" es el símbolo que precede al nombre: "+" público, "-" privado, "#" protegido, "~" de paquete. Si no hay símbolo, usa "+".
- Si una clase no tiene compartimento de operaciones, deja "metodos": []. No te inventes métodos que no estén dibujados.
- "origen" y "destino" deben coincidir EXACTAMENTE con el "nombre" de alguna clase de la lista. No los abrevies ni los reescribas.
- Las cardinalidades van tal como aparecen escritas junto a cada extremo de la línea: "1", "0..1", "*", "0..*", "1..*", "5".
- Si una cardinalidad no está escrita en el dibujo, o no la lees con seguridad, deja "" en ese campo. NO la supongas: es preferible declarar que no se ve.
- El sentido importa. En una herencia, "origen" es la clase hija y "destino" la clase padre. En una composición o agregación, "origen" es el todo y "destino" la parte.
- Distingue composición (rombo relleno) de agregación (rombo hueco). Si no distingues el relleno, usa "association" y dilo en "ilegible".
- Los tipos de atributo se infieren del texto. Usa solo los de la lista. Si el diagrama no escribe tipos, usa "String".
- "filas" solo se rellena si el recuadro contiene datos de ejemplo además de la definición; si no, déjalo como [].
- Transcribe los nombres tal como se leen. No corrijas ortografía ni completes abreviaturas.
- Si en la imagen no hay ningún diagrama de clases, devuelve "clases": [] y explica qué hay en su lugar dentro de "ilegible".`;

/**
 * ¿Es esta respuesta un «no veo ningún diagrama»?
 *
 * Misma lógica que `describirTablaAusente` y por el mismo motivo: la instrucción
 * le pide al modelo que devuelva la lista vacía cuando no ve nada, y eso es una
 * respuesta correcta que no debe llegar a la pantalla disfrazada de error de
 * validación.
 */
function describirDiagramaAusente(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const objeto = json as { clases?: unknown; ilegible?: unknown };
  if (!Array.isArray(objeto.clases) || objeto.clases.length > 0) return null;

  const pistas = Array.isArray(objeto.ilegible)
    ? objeto.ilegible.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : [];
  return pistas.join('; ').slice(0, 300);
}

/**
 * ¿Es esta respuesta un «no veo ninguna tabla»?
 *
 * Devuelve `null` si la respuesta trae columnas —o sea, si hay algo que
 * validar—; si no, devuelve lo que el modelo dice ver, que puede ser cadena
 * vacía si no lo ha explicado.
 */
function describirTablaAusente(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null;
  const objeto = json as { columnas?: unknown; ilegible?: unknown };
  if (!Array.isArray(objeto.columnas) || objeto.columnas.length > 0) return null;

  const pistas = Array.isArray(objeto.ilegible)
    ? objeto.ilegible.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    : [];
  // Se recorta: esto acaba en un cuadro rojo de la interfaz, no en un registro.
  return pistas.join('; ').slice(0, 300);
}

/**
 * Lo leído, junto al modelo que de verdad lo leyó.
 *
 * El modelo viaja con la lectura y no como propiedad del motor porque **no
 * siempre es el que está configurado**: si el primero de la cadena está
 * saturado, contesta el siguiente. Guardarlo en el motor (`this.model = …` al
 * terminar) habría sido más corto y habría mentido en cuanto dos personas
 * importan una foto a la vez: la respuesta de una llevaría el modelo que
 * contestó a la otra. Y esa línea de la pantalla —«modelo: X»— es justo la que
 * alguien mirará dentro de un mes para explicar por qué una lectura salió
 * distinta de la otra.
 */
export interface Lectura<T> {
  readonly datos: T;
  readonly modelo: string;
}

export interface VisionEngine {
  /** La cadena configurada, para diagnóstico. Lo que contestó va en cada `Lectura`. */
  readonly model: string;
  /** `imagen` es el contenido en base64, sin el prefijo `data:`. */
  extraerTabla(imagen: string, mimeType: string): Promise<Lectura<TablaExtraida>>;
  /** Lee un diagrama de clases completo: varias clases y las relaciones entre ellas. */
  extraerDiagrama(imagen: string, mimeType: string): Promise<Lectura<DiagramaExtraido>>;
}

export interface VisionOptions {
  apiKey: string;
  /** El modelo preferido: el que se prueba primero. */
  model: string;
  /**
   * A quién preguntar si el preferido no está disponible, en orden.
   *
   * No es redundancia por si acaso: las capas gratuitas de los modelos de visión
   * recientes dan `503 UNAVAILABLE` con bastante alegría, y ese 503 dura minutos,
   * no segundos. Reintentar contra el mismo modelo no sirve —ya se hace tres
   * veces antes de llegar aquí—; lo que saca del atasco es preguntarle a otro.
   */
  modelosDeReserva?: readonly string[];
  baseUrl: string;
  timeoutMs?: number;
  /** Reintentos ante un fallo pasajero del proveedor. Por defecto 2. */
  reintentos?: number;
  /** Espera base entre reintentos. Existe para que las pruebas no tarden segundos. */
  pausaMs?: number;
  /** Techo de la respuesta. Ver `MAX_TOKENS_POR_DEFECTO`. */
  maxTokens?: number;
}

interface RespuestaOpenAi {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
}

/**
 * Cuánto se le deja escribir al modelo.
 *
 * Empezó en 4096 y ese número rompió la lectura de diagramas de forma
 * especialmente cara: no fallaba, *mentía*. Al pasar de la cuenta, el proveedor
 * corta la respuesta a media palabra y devuelve un JSON sin cerrar. `extractJson`
 * recorta desde la primera `{` hasta la última `}`, que en un texto truncado ya
 * no es la del objeto raíz sino la de cualquier objeto interior, y lo que sale
 * de ahí revienta con «Expected ',' or ']' after array element in JSON at
 * position 1503» —un error de sintaxis que apunta al parseador y no a la causa,
 * y que manda a quien lo lee a buscar un fallo que no existe.
 *
 * El límite se agota antes de lo que parece con los modelos que razonan: en el
 * traductor de Google al protocolo de OpenAI, `max_tokens` se convierte en
 * `maxOutputTokens`, y los tokens de pensamiento de Gemini 3 se descuentan del
 * mismo saco. O sea, el modelo puede gastarse el presupuesto entero pensando y
 * quedarse sin sitio para contestar. Con un diagrama de quince clases —el tipo
 * de cosa que trae un enunciado de banco o de barbería— eso pasa sin esfuerzo.
 *
 * 32768 no es generosidad: es el orden de magnitud correcto para que el techo lo
 * ponga el diagrama y no la configuración. Solo se cobra lo que se usa.
 */
const MAX_TOKENS_POR_DEFECTO = 32_768;

/**
 * Motor de visión sobre el protocolo compatible con OpenAI.
 *
 * Solo se implementa ese: es el que hablan DeepSeek, OpenAI y el resto de
 * proveedores con visión, y añadir el de Anthropic aquí duplicaría el código
 * para un caso que hoy nadie usa. El día que haga falta, se separa igual que en
 * `assistant.ts`.
 */
/**
 * Cuándo tiene sentido preguntarle al siguiente modelo de la cadena.
 *
 * `429/502/503/504` es el modelo saturado y `404` es el modelo retirado: en los
 * cinco casos, *otro* modelo sí puede contestar.
 *
 * Fuera queda todo lo que no se arregla cambiando de modelo, y la lista corta
 * importa. `401/403` (clave rechazada) y `402` (sin saldo) hablan de la clave, y
 * la cadena entera comparte la misma clave: probar el siguiente solo alargaría
 * la espera para enseñar el mismo mensaje. `400` es la petición mal formada.
 *
 * Tampoco se pasa al siguiente cuando el modelo *contestó* y su respuesta no
 * servía —vacía, sin JSON, cortada por el límite de tokens, o sin ningún
 * diagrama dentro—. Eso no es un modelo caído: es un modelo que miró la foto y
 * dijo algo. Encadenar ahí convertiría «esta foto no se entiende» en tres
 * llamadas de pago para acabar en el mismo sitio, y taparía el diagnóstico
 * bueno, que es justo el que hace falta cuando la foto está mal.
 */
function mereceOtroModelo(error: unknown): boolean {
  return error instanceof ErrorDeModelo && CAMBIAR_DE_MODELO.has(error.status ?? 0);
}

const CAMBIAR_DE_MODELO = new Set([404, 429, 502, 503, 504]);

/**
 * Lo que contestó un modelo, en cuatro palabras.
 *
 * El cuerpo crudo del proveedor ocupa diez líneas y solo hace falta el del
 * primer fallo. De los demás basta saber si fue la clave, el saldo, el nombre o
 * la congestión: eso es lo que decide qué se toca.
 */
function resumirFallo(error: unknown): string {
  if (!(error instanceof ErrorDeModelo)) {
    return error instanceof Error ? error.message.slice(0, 120) : 'fallo desconocido';
  }
  const motivo = MOTIVOS[error.status ?? 0];
  return motivo ? `${error.status} ${motivo}` : error.message.slice(0, 120);
}

const MOTIVOS: Record<number, string> = {
  400: 'petición rechazada',
  401: 'clave rechazada',
  402: 'sin saldo',
  403: 'clave sin permiso',
  404: 'el proveedor no lo conoce',
  429: 'sin cuota por ahora',
  500: 'error del proveedor',
  502: 'saturado',
  503: 'saturado',
  504: 'saturado',
};

/** Un modelo de la cadena que no pudo contestar. */
interface Fallo {
  readonly modelo: string;
  readonly error: unknown;
}

/**
 * Convierte los fallos de la cadena en un solo error, con dos decisiones dentro.
 *
 * **El titular es el primer fallo, no el último.** Esto empezó al revés y salió
 * mal a la primera prueba real. Con `gemini-3.6-flash,gemini-2.5-flash`, el
 * preferido cayó y el de reserva contestó un 404 diciendo «gemini-2.5-flash ya
 * no está disponible, use gemini-3.6-flash». Lo que llegó a la pantalla fue ese
 * 404: un mensaje que manda a revisar `LLM_VISION_MODEL` y que nombra como
 * sustituto **el modelo que ya estaba en primera posición**. O sea, un error que
 * describe el suplente y manda a arreglar algo que ya estaba bien. El fallo que
 * importa es el del preferido: es el que se quiere que funcione, y el que
 * explica por qué se llegó a la reserva siquiera.
 *
 * **Y se dice qué contestó cada uno.** Sin eso, «se probaron: a → b» dice a
 * quién se preguntó pero no qué respondió ninguno, que es justo lo accionable:
 * dos saturados se arreglan esperando, dos nombres retirados se arreglan
 * editando el `.env`, y una mezcla de los dos —el caso real— no se parece a
 * ninguna de las dos cosas.
 */
function resumirCadena(fallos: readonly Fallo[]): unknown {
  const primero = fallos[0];
  if (primero === undefined) return new ErrorDeModelo('no se llegó a probar ningún modelo');
  // Con un solo modelo no hay cadena que resumir, y añadir corchetes a un error
  // que ya se entiende solo es ruido.
  if (fallos.length === 1 || !(primero.error instanceof ErrorDeModelo)) return primero.error;

  const detalle = fallos.map((f) => `${f.modelo}: ${resumirFallo(f.error)}`).join('; ');
  return new ErrorDeModelo(
    `${primero.error.message} [se probaron ${fallos.length} modelos → ${detalle}]`,
    primero.error.status,
  );
}

export class OpenAiVisionEngine implements VisionEngine {
  readonly model: string;

  private readonly cadena: readonly string[];

  constructor(private readonly options: VisionOptions) {
    this.cadena = [options.model, ...(options.modelosDeReserva ?? [])];
    this.model = this.cadena.join(', ');
  }

  /**
   * Manda la imagen con una instrucción y devuelve el JSON ya extraído del texto.
   *
   * Lo común a leer una tabla y leer un diagrama es todo menos la instrucción y
   * el esquema: la petición, el tiempo de espera, de qué campo se saca la
   * respuesta y qué hacer cuando llega vacía o sin JSON. Tenerlo en un sitio
   * evita que las dos lecturas se comporten distinto ante el mismo fallo del
   * proveedor, que es lo que pasa cuando una se corrige y la otra no.
   *
   * Recorre la cadena de modelos: el preferido primero y los de reserva después,
   * solo si el fallo es de los que se arreglan cambiando de modelo.
   */
  private async preguntar(
    imagen: string,
    mimeType: string,
    instruccion: string,
  ): Promise<Lectura<unknown>> {
    const fallos: Fallo[] = [];
    for (const [i, modelo] of this.cadena.entries()) {
      try {
        return { datos: await this.preguntarA(modelo, imagen, mimeType, instruccion), modelo };
      } catch (error) {
        fallos.push({ modelo, error });
        const quedan = i < this.cadena.length - 1;
        if (!quedan || !mereceOtroModelo(error)) throw resumirCadena(fallos);
      }
    }
    // Inalcanzable: la cadena nunca está vacía y el último intento o devuelve o
    // lanza. Está por el comprobador de tipos, no por el flujo.
    throw new ErrorDeModelo('no había ningún modelo de visión que probar');
  }

  private async preguntarA(
    modelo: string,
    imagen: string,
    mimeType: string,
    instruccion: string,
  ): Promise<unknown> {
    const baseUrl = this.options.baseUrl.replace(/\/+$/, '');

    const payload = await pedirAlModelo<RespuestaOpenAi>({
      url: `${baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      body: {
        model: modelo,
        max_tokens: this.options.maxTokens ?? MAX_TOKENS_POR_DEFECTO,
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: instruccion.replace('TIPOS', listSupportedTypes().join('|')),
              },
              // La imagen viaja empotrada en la petición. Es lo que evita tener
              // que exponerla en una URL pública para que el modelo la alcance:
              // la foto de una pizarra puede tener delante el esquema entero de
              // un cliente.
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imagen}` } },
            ],
          },
        ],
      },
      // Más holgado que el del asistente de texto: mirar una imagen y
      // transcribir treinta celdas tarda bastante más que interpretar una frase.
      timeoutMs: this.options.timeoutMs ?? 60_000,
      // Aquí sí se reintenta, y en el asistente de texto no. La diferencia es lo
      // que cuesta el fallo: una orden dictada se repite en dos segundos, pero
      // un 503 leyendo una foto obliga a volver a subirla, y las capas gratuitas
      // de los proveedores de visión dan 503 con bastante alegría.
      reintentos: this.options.reintentos ?? 2,
      pausaMs: this.options.pausaMs,
    });

    // `content`, nunca `reasoning_content`. En los modelos que razonan en voz
    // alta el razonamiento contiene versiones anteriores del JSON que el propio
    // modelo descartó; quedarse con la primera que parsee sería quedarse con la
    // que él mismo rechazó.
    const eleccion = payload.choices?.[0];
    const raw = eleccion?.message?.content ?? '';

    /*
      Mirar `finish_reason` **antes** de intentar parsear.

      Es la diferencia entre un diagnóstico y una adivinanza. Una respuesta
      cortada por el límite de tokens es un JSON sin cerrar, y al parsearlo sale
      un error de sintaxis que señala una posición concreta del texto: parece que
      el modelo escribió algo mal, cuando lo que pasó es que no le dejaron
      terminar. Ese mensaje se ha llegado a leer como un fallo del programa.

      `length` es la palabra que usan tanto OpenAI como el traductor de Google
      para decir «me quedé sin presupuesto». Convertirla en una frase que nombra
      la causa y la salida ahorra la tarde de depuración que costó descubrirla.

      Se comprueba también con el contenido vacío, y ese caso es el peor de los
      dos: un modelo que razona puede gastarse el presupuesto entero pensando y
      devolver `content: ""` con `finish_reason: "length"`. Sin esta rama, eso
      salía como «el modelo devolvió una respuesta vacía», que suena a avería del
      proveedor y se arregla subiendo un número.
    */
    if (eleccion?.finish_reason === 'length') {
      throw new ErrorDeModelo(
        'la respuesta del modelo se cortó por el límite de tokens, así que llegó incompleta. ' +
          'Suele pasar con diagramas de muchas clases, y con los modelos que razonan, porque el ' +
          'razonamiento consume el mismo presupuesto que la respuesta. Prueba con una foto de ' +
          'menos clases, o sube LLM_VISION_MAX_TOKENS en el .env del servidor.',
      );
    }

    if (!raw.trim()) throw new ErrorDeModelo('el modelo devolvió una respuesta vacía');

    try {
      return extractJson(raw);
    } catch (error) {
      throw new ErrorDeModelo(`la respuesta no era JSON: ${(error as Error).message}`);
    }
  }

  async extraerTabla(imagen: string, mimeType: string): Promise<Lectura<TablaExtraida>> {
    const { datos: json, modelo } = await this.preguntar(imagen, mimeType, INSTRUCCION);

    // «No hay tabla aquí» es una respuesta correcta, no un fallo de formato.
    //
    // La instrucción le pide al modelo que devuelva `columnas: []` cuando en la
    // imagen no ve ninguna tabla; el esquema, en cambio, exige al menos una
    // columna. Esa contradicción hacía que la respuesta más informativa que
    // puede dar el modelo llegara a la pantalla como «la respuesta del modelo no
    // tiene la forma esperada: columnas: Array must contain at least 1
    // element(s)», que parece una avería del programa y no lo es. Peor: se
    // tiraba lo único que servía para entender qué había pasado, que es lo que
    // el modelo dice haber visto en su lugar.
    const nadaQueLeer = describirTablaAusente(json);
    if (nadaQueLeer !== null) {
      throw new ErrorDeModelo(
        nadaQueLeer
          ? `el modelo no ha encontrado ninguna tabla en la imagen. Dice ver esto: ${nadaQueLeer}`
          : 'el modelo no ha encontrado ninguna tabla en la imagen, y no ha explicado qué ve en su lugar. ' +
            'Si la foto sí tiene una tabla, lo más probable es que el modelo configurado en ' +
            'LLM_VISION_MODEL no sepa mirar imágenes.',
      );
    }

    const parsed = parseTablaExtraida(json);
    if (!parsed.ok) {
      // Se descarta entera. Una tabla a medias —columnas sí, filas no— parece
      // una lectura correcta y es una lectura rota, y quien revisa aprobaría lo
      // que ve sin saber que falta la mitad.
      throw new ErrorDeModelo(`la respuesta del modelo no tiene la forma esperada: ${parsed.error}`);
    }
    return { datos: parsed.value, modelo };
  }

  async extraerDiagrama(imagen: string, mimeType: string): Promise<Lectura<DiagramaExtraido>> {
    const { datos: json, modelo } = await this.preguntar(imagen, mimeType, INSTRUCCION_DIAGRAMA);

    const nadaQueLeer = describirDiagramaAusente(json);
    if (nadaQueLeer !== null) {
      throw new ErrorDeModelo(
        nadaQueLeer
          ? `el modelo no ha encontrado ningún diagrama de clases en la imagen. Dice ver esto: ${nadaQueLeer}`
          : 'el modelo no ha encontrado ningún diagrama de clases en la imagen, y no ha explicado ' +
            'qué ve en su lugar. Si la foto sí tiene un diagrama, lo más probable es que el modelo ' +
            'configurado en LLM_VISION_MODEL no sepa mirar imágenes.',
      );
    }

    const parsed = parseDiagramaExtraido(json);
    if (!parsed.ok) {
      // Se descarta entero, igual que la tabla y por la misma razón: un diagrama
      // con las clases bien y las relaciones rotas se aprueba de un vistazo y
      // genera un esquema sin las claves foráneas que faltan.
      throw new ErrorDeModelo(`la respuesta del modelo no tiene la forma esperada: ${parsed.error}`);
    }
    return { datos: parsed.value, modelo };
  }
}

/**
 * Construye el motor si la configuración lo permite.
 *
 * Devuelve `undefined` en lugar de un motor que falla al usarse: así la ruta
 * puede responder «esta instalación no tiene lectura de imágenes configurada»,
 * que es accionable, en vez de un error del proveedor que no lo es.
 *
 * La visión puede apuntar a un proveedor distinto del asistente de texto, y no
 * es un capricho: no todos los que sirven un buen modelo de texto barato sirven
 * además uno que sepa mirar imágenes. Cuando `LLM_VISION_API_KEY` o
 * `LLM_VISION_BASE_URL` no están, se heredan las del texto, que es el caso
 * normal de quien usa un solo proveedor para todo.
 */
export function createVisionEngine(config: {
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmVisionModel?: string;
  llmVisionApiKey?: string;
  llmVisionBaseUrl?: string;
  llmVisionMaxTokens?: number;
}): VisionEngine | undefined {
  // `||` y no `??`: en un .env lo normal es dejar la variable escrita y vacía,
  // y `LLM_VISION_API_KEY=` llega como cadena vacía, no como `undefined`. Con
  // `??` una clave vacía se daría por buena y se mandaría al proveedor.
  const baseUrl = config.llmVisionBaseUrl || config.llmBaseUrl;

  // La clave del texto solo se hereda si la visión va al mismo sitio. Heredarla
  // siempre significaría mandarle a Google la clave de DeepSeek en cuanto
  // alguien apunta la visión a otro proveedor y se deja la suya sin poner: un
  // secreto entregado a un tercero por un descuido de configuración.
  const mismoProveedor = !config.llmVisionBaseUrl || config.llmVisionBaseUrl === config.llmBaseUrl;
  const apiKey = config.llmVisionApiKey || (mismoProveedor ? config.llmApiKey : undefined);

  // `LLM_VISION_MODEL` admite varios separados por comas: el primero es el
  // preferido y los demás son la reserva, en orden. Un solo nombre —el caso
  // normal— produce una cadena de uno y se comporta exactamente como antes.
  const cadena = (config.llmVisionModel ?? '')
    .split(',')
    .map((nombre) => nombre.trim())
    .filter((nombre) => nombre !== '');

  const [preferido, ...reserva] = cadena;
  if (!apiKey || !preferido) return undefined;
  return new OpenAiVisionEngine({
    apiKey,
    model: preferido,
    modelosDeReserva: reserva,
    baseUrl: baseUrl || 'https://api.openai.com/v1',
    maxTokens: config.llmVisionMaxTokens,
  });
}
