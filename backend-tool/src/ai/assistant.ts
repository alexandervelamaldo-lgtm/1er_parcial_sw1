import type { AssistantResponse, ClassDiagram } from '@app/shared';
import { interpretCommand, listSupportedTypes, parseAssistantResponse } from '@app/shared';
import { pedirAlModelo } from './transporte.js';

/**
 * Asistente conversacional (RF-IA-01 … RF-IA-05).
 *
 * Dos motores tras una misma interfaz (decisión D5): un modelo de lenguaje
 * cuando hay red, y la gramática cerrada de `shared` cuando no la hay. Que la
 * gramática viva en `shared` no es casualidad: el navegador la ejecuta offline y
 * el servidor la usa como red de seguridad, y debe entender exactamente lo
 * mismo en ambos sitios.
 *
 * Ninguno de los dos escribe en el diagrama. Devuelven una propuesta que el
 * usuario acepta o descarta (decisión D6, RF-IA-04). Un modelo que edita
 * directamente convierte cada alucinación en trabajo perdido.
 */

export interface AssistantEngine {
  readonly name: string;
  interpret(prompt: string, diagram: ClassDiagram): Promise<AssistantResponse>;
}

/** Motor sin red. Determinista y sin dependencias. */
export class GrammarAssistant implements AssistantEngine {
  readonly name = 'gramatica-local';

  async interpret(prompt: string): Promise<AssistantResponse> {
    return interpretCommand(prompt);
  }
}

const SYSTEM_PROMPT = `Eres un asistente de modelado UML. Traduces peticiones en castellano a operaciones sobre un diagrama de clases.

Respondes ÚNICAMENTE con un objeto JSON, sin texto alrededor y sin vallas de código, con esta forma:
{"operations": [...], "confidence": 0.0-1.0, "clarification": string|null, "explanation": string}

Cada operación es uno de estos objetos:
- {"op":"addClass","name":"Pascal","kind":"class|interface|enum|abstract","position":{"x":n,"y":n}}
- {"op":"renameClass","ref":{"name":"X"},"name":"Y"}
- {"op":"removeClass","ref":{"name":"X"}}
- {"op":"moveClass","ref":{"name":"X"},"position":{"x":n,"y":n}}
- {"op":"setClassKind","ref":{"name":"X"},"kind":"class|interface|enum|abstract"}
- {"op":"addAttribute","classRef":{"name":"X"},"name":"camelCase","type":"T","visibility":"-","isIdentifier":false,"isNullable":true,"isUnique":false}
- {"op":"updateAttribute","classRef":{"name":"X"},"attributeName":"a","changes":{...}}
- {"op":"removeAttribute","classRef":{"name":"X"},"attributeName":"a"}
- {"op":"addMethod","classRef":{"name":"X"},"name":"m","returnType":"T"|null,"parameters":[{"name":"p","type":"T"}],"visibility":"+"}
- {"op":"removeMethod","classRef":{"name":"X"},"methodName":"m"}
- {"op":"addRelation","kind":"association|aggregation|composition|inheritance|realization|dependency","source":{"name":"A"},"target":{"name":"B"},"sourceMultiplicity":"1","targetMultiplicity":"*"}
- {"op":"removeRelation","id":"..."}
- {"op":"addEnumLiteral","classRef":{"name":"X"},"literal":"LITERAL"}
- {"op":"setSeedRows","classRef":{"name":"X"},"rows":[{"atributo":"valor"}]}
- {"op":"removeSeedRow","classRef":{"name":"X"},"index":1}

Reglas:
- Referencia las clases por nombre, exactamente como aparecen en el diagrama actual.
- Tipos admitidos: TIPOS. No inventes otros; para referirte a otra clase usa una relación, no un atributo.
- En "A tiene muchos B", la multiplicidad del extremo A es "1" y la de B es "*".
- Si la petición es ambigua o falta un dato, devuelve "operations": [] y explica qué falta en "clarification". No adivines.
- No elimines nada que el usuario no haya pedido eliminar explícitamente.
- "setSeedRows" sustituye TODAS las filas de datos de ejemplo de la clase. Úsala solo si el usuario dicta el contenido completo; para añadir una fila a las que ya hay, repite las anteriores. Las claves de cada fila son nombres de atributos de esa clase, y todos los valores van como texto.
- "removeSeedRow" usa índice de base 1, tal como se dice: «borra la segunda fila» es index 2.
- Los datos de ejemplo son filas de una tabla del proyecto generado, no registros de una base de datos en producción: no hay ninguna operación que borre datos reales, y no debes ofrecerla.`;

export interface LlmOptions {
  apiKey: string;
  /**
   * Protocolo, no marca. `anthropic` es `/v1/messages`; `openai` es
   * `/chat/completions`, que es lo que sirven DeepSeek, OpenAI y la mayoría.
   */
  provider?: 'anthropic' | 'openai';
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fallback?: AssistantEngine;
}

/** Valores por defecto de cada protocolo, para no repetirlos en las llamadas. */
const DEFECTOS = {
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
} as const;

/**
 * Motor con modelo de lenguaje.
 *
 * La salida del modelo se valida contra el esquema de operaciones antes de
 * mostrarse (RNF-IA-06): si no valida, se descarta entera y se recurre a la
 * gramática. Aceptar una salida parcialmente válida sería peor que no responder,
 * porque el usuario vería una propuesta coherente a medias y la aprobaría.
 */
export class LlmAssistant implements AssistantEngine {
  readonly name: string;
  private readonly fallback: AssistantEngine;
  private readonly provider: 'anthropic' | 'openai';

  constructor(private readonly options: LlmOptions) {
    this.fallback = options.fallback ?? new GrammarAssistant();
    this.provider = options.provider ?? 'anthropic';
    this.name = `modelo-remoto (${options.model ?? DEFECTOS[this.provider].model})`;
  }

  async interpret(prompt: string, diagram: ClassDiagram): Promise<AssistantResponse> {
    try {
      const raw = await this.ask(prompt, diagram);
      const parsed = parseAssistantResponse(extractJson(raw));
      if (parsed.ok) return parsed.value;
      console.warn('El modelo devolvió una respuesta que no valida:', parsed.error);
    } catch (error) {
      console.warn('El modelo no respondió:', (error as Error).message);
    }

    // Degradación, no fallo: el usuario obtiene lo que la gramática entienda en
    // lugar de un error, que es la misma experiencia que tendría sin conexión.
    const local = await this.fallback.interpret(prompt, diagram);
    return {
      ...local,
      explanation: local.explanation || 'Respuesta generada sin el modelo remoto.',
    };
  }

  private async ask(prompt: string, diagram: ClassDiagram): Promise<string> {
    const system = SYSTEM_PROMPT.replace('TIPOS', listSupportedTypes().join(', '));
    const user = `Diagrama actual:\n${summarize(diagram)}\n\nPetición: ${prompt}`;
    const defectos = DEFECTOS[this.provider];
    const baseUrl = (this.options.baseUrl ?? defectos.baseUrl).replace(/\/+$/, '');
    const model = this.options.model ?? defectos.model;

    if (this.provider === 'anthropic') {
      const payload = await pedirAlModelo<{ content?: { type: string; text?: string }[] }>({
        url: `${baseUrl}/v1/messages`,
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model,
          max_tokens: 2048,
          system,
          messages: [
            { role: 'user', content: user },
            // Se fuerza el inicio de la respuesta para que el modelo no
            // introduzca la explicación en prosa que rompería el JSON.
            { role: 'assistant', content: '{' },
          ],
        },
        timeoutMs: this.options.timeoutMs ?? 20_000,
      });
      return `{${payload.content?.find((block) => block.type === 'text')?.text ?? ''}`;
    }

    const payload = await pedirAlModelo<RespuestaOpenAi>({
      url: `${baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.options.apiKey}` },
      body: {
        model,
        max_tokens: 2048,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      timeoutMs: this.options.timeoutMs ?? 20_000,
    });

    // Se lee `content` y nunca `reasoning_content`. Los modelos que razonan en
    // voz alta devuelven ambos, y el razonamiento contiene borradores de JSON
    // que el modelo ya descartó: quedarse con el primero que parezca válido
    // sería aprobar una versión que el modelo mismo rechazó.
    return payload.choices?.[0]?.message?.content ?? '';
  }
}

interface RespuestaOpenAi {
  choices?: { message?: { content?: string } }[];
}

/**
 * Resume el diagrama para el modelo.
 *
 * Se envía un resumen y no el documento entero porque el modelo solo necesita
 * saber qué nombres puede referenciar; mandar posiciones e identificadores
 * gastaría contexto y le daría material para inventarse referencias.
 */
function summarize(diagram: ClassDiagram): string {
  const classes = Object.values(diagram.classes);
  if (classes.length === 0) return '(vacío)';

  const lines = classes.map((cls) => {
    const attributes = cls.attributes
      .map((a) => `${a.name}: ${a.type.name}${a.isIdentifier ? ' (id)' : ''}`)
      .join(', ');
    const methods = cls.methods.map((m) => `${m.name}()`).join(', ');
    const literals = cls.literals.join(', ');
    const parts = [`${cls.kind} ${cls.name}`];
    if (attributes) parts.push(`  atributos: ${attributes}`);
    if (methods) parts.push(`  métodos: ${methods}`);
    if (literals) parts.push(`  literales: ${literals}`);
    return parts.join('\n');
  });

  const relations = Object.values(diagram.relations).map((relation) => {
    const source = diagram.classes[relation.source.classId]?.name ?? '?';
    const target = diagram.classes[relation.target.classId]?.name ?? '?';
    return `  ${source} ${relation.source.multiplicity} --${relation.kind}--> ${relation.target.multiplicity} ${target}`;
  });

  return [...lines, relations.length > 0 ? `relaciones:\n${relations.join('\n')}` : ''].join('\n');
}

/** Recorta vallas de código: algunos modelos las añaden pese a pedir JSON puro. */
export function extractJson(raw: string): unknown {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('la respuesta no contiene un objeto JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Elige el motor según la configuración.
 *
 * Sin clave se devuelve la gramática, que no es un modo degradado sino el modo
 * normal sin conexión: el mismo intérprete que corre en el navegador.
 */
export function createAssistant(config: {
  llmApiKey?: string;
  llmProvider?: 'anthropic' | 'openai';
  llmBaseUrl?: string;
  llmModel?: string;
}): AssistantEngine {
  if (!config.llmApiKey) return new GrammarAssistant();
  return new LlmAssistant({
    apiKey: config.llmApiKey,
    provider: config.llmProvider,
    baseUrl: config.llmBaseUrl,
    model: config.llmModel,
  });
}
