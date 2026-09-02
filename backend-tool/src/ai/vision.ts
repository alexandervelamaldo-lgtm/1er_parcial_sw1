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
{"clases":[{"nombre":"","estereotipo":"class|interface|enum|abstract","atributos":[{"nombre":"","tipo":"TIPOS","esClave":true|false}],"filas":[["valor"]]}],"relaciones":[{"origen":"","destino":"","tipo":"association|aggregation|composition|inheritance|realization|dependency","cardinalidadOrigen":"","cardinalidadDestino":"","nombre":""}],"confianza":0.0-1.0,"ilegible":["..."]}

Reglas:
- "nombre" de cada clase es el texto del compartimento superior del recuadro, tal como se lee.
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

export interface VisionEngine {
  readonly model: string;
  /** `imagen` es el contenido en base64, sin el prefijo `data:`. */
  extraerTabla(imagen: string, mimeType: string): Promise<TablaExtraida>;
  /** Lee un diagrama de clases completo: varias clases y las relaciones entre ellas. */
  extraerDiagrama(imagen: string, mimeType: string): Promise<DiagramaExtraido>;
}

export interface VisionOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs?: number;
  /** Reintentos ante un fallo pasajero del proveedor. Por defecto 2. */
  reintentos?: number;
  /** Espera base entre reintentos. Existe para que las pruebas no tarden segundos. */
  pausaMs?: number;
}

interface RespuestaOpenAi {
  choices?: { message?: { content?: string } }[];
}

/**
 * Motor de visión sobre el protocolo compatible con OpenAI.
 *
 * Solo se implementa ese: es el que hablan DeepSeek, OpenAI y el resto de
 * proveedores con visión, y añadir el de Anthropic aquí duplicaría el código
 * para un caso que hoy nadie usa. El día que haga falta, se separa igual que en
 * `assistant.ts`.
 */
export class OpenAiVisionEngine implements VisionEngine {
  readonly model: string;

  constructor(private readonly options: VisionOptions) {
    this.model = options.model;
  }

  /**
   * Manda la imagen con una instrucción y devuelve el JSON ya extraído del texto.
   *
   * Lo común a leer una tabla y leer un diagrama es todo menos la instrucción y
   * el esquema: la petición, el tiempo de espera, de qué campo se saca la
   * respuesta y qué hacer cuando llega vacía o sin JSON. Tenerlo en un sitio
   * evita que las dos lecturas se comporten distinto ante el mismo fallo del
   * proveedor, que es lo que pasa cuando una se corrige y la otra no.
   */
  private async preguntar(
    imagen: string,
    mimeType: string,
    instruccion: string,
  ): Promise<unknown> {
    const baseUrl = this.options.baseUrl.replace(/\/+$/, '');

    const payload = await pedirAlModelo<RespuestaOpenAi>({
      url: `${baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      body: {
        model: this.options.model,
        max_tokens: 4096,
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
    const raw = payload.choices?.[0]?.message?.content ?? '';
    if (!raw.trim()) throw new ErrorDeModelo('el modelo devolvió una respuesta vacía');

    try {
      return extractJson(raw);
    } catch (error) {
      throw new ErrorDeModelo(`la respuesta no era JSON: ${(error as Error).message}`);
    }
  }

  async extraerTabla(imagen: string, mimeType: string): Promise<TablaExtraida> {
    const json = await this.preguntar(imagen, mimeType, INSTRUCCION);

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
    return parsed.value;
  }

  async extraerDiagrama(imagen: string, mimeType: string): Promise<DiagramaExtraido> {
    const json = await this.preguntar(imagen, mimeType, INSTRUCCION_DIAGRAMA);

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
    return parsed.value;
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

  if (!apiKey || !config.llmVisionModel) return undefined;
  return new OpenAiVisionEngine({
    apiKey,
    model: config.llmVisionModel,
    baseUrl: baseUrl || 'https://api.openai.com/v1',
  });
}
