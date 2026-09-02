import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDiagram, createClass, createAttribute } from '@app/shared';
import { GrammarAssistant, LlmAssistant, createAssistant, extractJson } from './assistant.js';
import { OpenAiVisionEngine, createVisionEngine } from './vision.js';
import { ErrorDeModelo } from './transporte.js';

/**
 * Pruebas del asistente y del motor de visión contra un proveedor simulado.
 *
 * Se levanta un servidor HTTP local que habla el mismo protocolo que DeepSeek u
 * OpenAI. No se llama al proveedor real: una prueba que depende de la red, del
 * saldo de una clave y de que el modelo repita hoy lo de ayer no comprueba el
 * código, comprueba el clima. Lo que sí se comprueba —y es lo que importa— es
 * qué hace este código cuando el modelo devuelve basura, tarda demasiado, o
 * responde con un JSON que valida a medias.
 */

let server: Server;
let baseUrl: string;
/** Lo que el proveedor falso responderá a la siguiente petición. */
let responder: (body: unknown) => { status: number; payload: unknown };
/** Los cuerpos que ha recibido, para comprobar qué se le manda. */
let recibidos: Record<string, unknown>[];

const diagrama = createDiagram({
  id: 'D1',
  name: 'Prueba',
  classes: {
    C1: createClass({
      id: 'C1',
      name: 'Cliente',
      attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long', isIdentifier: true })],
    }),
  },
});

/** Respuesta con forma de OpenAI, que es la que hablan DeepSeek y compañía. */
function comoOpenAi(contenido: string, extra: Record<string, unknown> = {}) {
  return { choices: [{ message: { content: contenido, ...extra } }] };
}

beforeEach(async () => {
  recibidos = [];
  responder = () => ({ status: 200, payload: comoOpenAi('{"operations":[]}') });

  server = createServer((request, response) => {
    let cuerpo = '';
    request.on('data', (trozo) => (cuerpo += trozo));
    request.on('end', () => {
      const parseado = cuerpo ? JSON.parse(cuerpo) : {};
      recibidos.push(parseado);
      const { status, payload } = responder(parseado);
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function motor(overrides: Record<string, unknown> = {}) {
  return new LlmAssistant({
    apiKey: 'clave-de-prueba',
    provider: 'openai',
    baseUrl,
    model: 'modelo-de-prueba',
    timeoutMs: 1000,
    ...overrides,
  });
}

describe('extractJson', () => {
  it('acepta el JSON pelado', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('recorta las vallas de código que algunos modelos añaden igualmente', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('descarta la prosa alrededor del objeto', () => {
    expect(extractJson('Claro, aquí tienes:\n{"a":1}\nEspero que te sirva.')).toEqual({ a: 1 });
  });

  it('falla si no hay ningún objeto, en lugar de devolver algo inventado', () => {
    expect(() => extractJson('lo siento, no puedo ayudarte con eso')).toThrow();
  });
});

describe('LlmAssistant contra un proveedor simulado', () => {
  it('manda el resumen del diagrama y no el documento entero', async () => {
    await motor().interpret('crea la clase Pedido', diagrama);

    const mensajes = recibidos[0]?.messages as { role: string; content: string }[];
    const usuario = mensajes.find((m) => m.role === 'user')?.content ?? '';
    expect(usuario).toContain('Cliente');
    // Ni identificadores internos ni posiciones: gastan contexto y le dan al
    // modelo material para inventarse referencias.
    expect(usuario).not.toContain('C1');
    expect(usuario).not.toContain('position');
  });

  it('autentica con Bearer en el protocolo de OpenAI', async () => {
    const conCabecera = new Promise<string | undefined>((resolve) => {
      server.once('request', (request) => resolve(request.headers.authorization));
    });
    await motor().interpret('crea la clase Pedido', diagrama);

    expect(await conCabecera).toBe('Bearer clave-de-prueba');
  });

  it('devuelve las operaciones que el modelo propone', async () => {
    responder = () => ({
      status: 200,
      payload: comoOpenAi(
        JSON.stringify({
          operations: [{ op: 'addClass', name: 'Pedido', kind: 'class' }],
          confidence: 0.9,
          clarification: null,
          explanation: 'Se crea la clase Pedido.',
        }),
      ),
    });

    const respuesta = await motor().interpret('crea la clase Pedido', diagrama);

    expect(respuesta.operations).toEqual([{ op: 'addClass', name: 'Pedido', kind: 'class' }]);
    expect(respuesta.confidence).toBe(0.9);
  });

  it('ignora el razonamiento en voz alta y se queda con «content»', async () => {
    // Los modelos que razonan devuelven en `reasoning_content` borradores de
    // JSON que ellos mismos descartaron. Quedarse con el primero que parsee
    // sería aprobar una versión que el modelo rechazó.
    responder = () => ({
      status: 200,
      payload: comoOpenAi(
        JSON.stringify({ operations: [{ op: 'addClass', name: 'Correcta', kind: 'class' }] }),
        {
          reasoning_content:
            'Podría ser {"operations":[{"op":"removeClass","ref":{"name":"Cliente"}}]}… no, mejor no.',
        },
      ),
    });

    const respuesta = await motor().interpret('crea la clase Correcta', diagrama);

    expect(respuesta.operations).toEqual([{ op: 'addClass', name: 'Correcta', kind: 'class' }]);
  });

  it('descarta entera una respuesta que no valida y recurre a la gramática', async () => {
    // Aceptar la mitad válida sería peor: el usuario vería una propuesta
    // coherente a medias y la aprobaría sin notar lo que falta.
    responder = () => ({
      status: 200,
      payload: comoOpenAi(
        JSON.stringify({
          operations: [
            { op: 'addClass', name: 'Pedido', kind: 'class' },
            { op: 'esto_no_existe', cosa: 'rara' },
          ],
        }),
      ),
    });

    const respuesta = await motor().interpret('crea la clase Pedido', diagrama);

    expect(respuesta.operations).toEqual([{ op: 'addClass', name: 'Pedido', kind: 'class' }]);
    // La operación inventada no aparece por ninguna parte, ni siquiera la
    // válida que la acompañaba: lo que se muestra viene de la gramática.
    expect(respuesta.explanation).toMatch(/sin conexión|sin el modelo remoto/);
  });

  it('degrada a la gramática cuando el proveedor devuelve un error', async () => {
    responder = () => ({ status: 402, payload: { error: 'Insufficient Balance' } });

    const respuesta = await motor().interpret('crea la clase Pedido', diagrama);

    // Degradación, no fallo: es la misma experiencia que sin conexión.
    expect(respuesta.operations).toEqual([{ op: 'addClass', name: 'Pedido', kind: 'class' }]);
  });

  it('degrada a la gramática cuando el modelo no responde a tiempo', async () => {
    responder = () => ({ status: 200, payload: comoOpenAi('{}') });
    server.removeAllListeners('request');
    server.on('request', () => {
      /* se deja colgada a propósito */
    });

    const respuesta = await motor({ timeoutMs: 100 }).interpret('crea la clase Pedido', diagrama);

    expect(respuesta.operations).toEqual([{ op: 'addClass', name: 'Pedido', kind: 'class' }]);
  });

  it('sin gramática que lo entienda, pide una aclaración en vez de inventar', async () => {
    responder = () => ({ status: 500, payload: { error: 'boom' } });

    const respuesta = await motor().interpret('ya sabes lo que quiero', diagrama);

    expect(respuesta.operations).toHaveLength(0);
    expect(respuesta.clarification).toBeTruthy();
  });

  it('usa el protocolo de Anthropic cuando se le pide', async () => {
    responder = () => ({
      status: 200,
      payload: {
        // La respuesta empieza sin la llave porque se fuerza como prefijo.
        content: [{ type: 'text', text: '"operations":[],"confidence":0,"explanation":"nada"}' }],
      },
    });

    const conCabecera = new Promise<string | undefined>((resolve) => {
      server.once('request', (request) => resolve(request.headers['x-api-key'] as string));
    });

    const respuesta = await new LlmAssistant({
      apiKey: 'clave-de-prueba',
      provider: 'anthropic',
      baseUrl,
      model: 'modelo-de-prueba',
      timeoutMs: 1000,
    }).interpret('no importa qué', diagrama);

    expect(await conCabecera).toBe('clave-de-prueba');
    expect(respuesta.operations).toHaveLength(0);
  });
});

describe('createAssistant', () => {
  it('sin clave devuelve la gramática, que no es un modo degradado', () => {
    const motorSinClave = createAssistant({});
    expect(motorSinClave).toBeInstanceOf(GrammarAssistant);
  });

  it('con clave devuelve el motor remoto, con el modelo en el nombre', () => {
    const remoto = createAssistant({ llmApiKey: 'k', llmProvider: 'openai', llmModel: 'algo' });
    expect(remoto).toBeInstanceOf(LlmAssistant);
    expect(remoto.name).toContain('algo');
  });
});

describe('createVisionEngine', () => {
  it('sin modelo de visión no hay motor, aunque sobre la clave', () => {
    expect(createVisionEngine({ llmApiKey: 'k' })).toBeUndefined();
  });

  it('hereda la clave del texto cuando la visión va al mismo proveedor', () => {
    const motor = createVisionEngine({
      llmApiKey: 'k',
      llmBaseUrl: 'https://api.deepseek.com',
      llmVisionModel: 'algo-con-vision',
    });
    expect(motor?.model).toBe('algo-con-vision');
  });

  /*
   * Esta es la importante. Con la visión apuntando a Google y sin clave propia,
   * heredar la del texto le entregaría a Google la clave de DeepSeek: un secreto
   * enviado a un tercero por un descuido de configuración, sin que nadie lo pida
   * ni se entere. Antes que eso, la lectura de fotos se queda desactivada.
   */
  it('no le presta a un proveedor la clave de otro', () => {
    const motor = createVisionEngine({
      llmApiKey: 'clave-de-deepseek',
      llmBaseUrl: 'https://api.deepseek.com',
      llmVisionModel: 'gemini-3.6-flash',
      llmVisionBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      llmVisionApiKey: '',
    });
    expect(motor).toBeUndefined();
  });

  it('trata una variable escrita pero vacía como si no estuviera', () => {
    // `LLM_VISION_API_KEY=` en un .env llega como cadena vacía, no como
    // `undefined`; con `??` habría pasado por clave buena.
    expect(
      createVisionEngine({ llmApiKey: '', llmVisionApiKey: '', llmVisionModel: 'm' }),
    ).toBeUndefined();
  });
});

describe('OpenAiVisionEngine contra un proveedor simulado', () => {
  function vision(overrides: Record<string, unknown> = {}) {
    return new OpenAiVisionEngine({
      apiKey: 'clave-de-prueba',
      model: 'vision-de-prueba',
      baseUrl,
      timeoutMs: 1000,
      // La espera entre reintentos es de casi un segundo en producción, a
      // propósito. Aquí se baja a 1 ms: lo que hay que comprobar es a cuántos
      // fallos se reintenta y a cuáles no, no cuánto se duerme entre medias.
      pausaMs: 1,
      ...overrides,
    });
  }

  const tablaValida = {
    tabla: 'Empleado',
    columnas: [{ nombre: 'id', tipo: 'Long', esClave: true }],
    filas: [['1']],
    confianza: 0.8,
    ilegible: [],
  };

  it('empotra la imagen en la petición en lugar de exponerla en una URL', async () => {
    responder = () => ({ status: 200, payload: comoOpenAi(JSON.stringify(tablaValida)) });

    await vision().extraerTabla('QUJD', 'image/png');

    const mensajes = recibidos[0]?.messages as { content: { type: string; image_url?: { url: string } }[] }[];
    const imagen = mensajes[0]?.content.find((parte) => parte.type === 'image_url');
    expect(imagen?.image_url?.url).toBe('data:image/png;base64,QUJD');
  });

  it('devuelve la tabla cuando el modelo responde con la forma esperada', async () => {
    responder = () => ({ status: 200, payload: comoOpenAi(JSON.stringify(tablaValida)) });

    const tabla = await vision().extraerTabla('QUJD', 'image/png');
    expect(tabla.tabla).toBe('Empleado');
  });

  it('descarta entera una tabla a medias en vez de devolverla incompleta', async () => {
    // Columnas sí, filas rotas: parece una lectura correcta y no lo es, y quien
    // revisa aprobaría lo que ve sin saber que falta la mitad.
    responder = () => ({
      status: 200,
      payload: comoOpenAi(
        JSON.stringify({
          tabla: 'Empleado',
          columnas: [{ nombre: 'id', tipo: 'Long', esClave: true }],
          filas: 'no es lista',
        }),
      ),
    });

    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.toBeInstanceOf(ErrorDeModelo);
  });

  /*
   * «No hay ninguna tabla aquí» es la respuesta que la propia instrucción le
   * pide al modelo cuando no ve una, y sin embargo el esquema exige al menos una
   * columna. Esa contradicción salía a la pantalla como «la respuesta del modelo
   * no tiene la forma esperada: columnas: Array must contain at least 1
   * element(s)», que parece una avería del programa. Es además el síntoma exacto
   * de haber configurado en LLM_VISION_MODEL un modelo que no sabe mirar
   * imágenes: no ve nada, dice que no hay tabla, y el mensaje no ayudaba a
   * descubrirlo.
   */
  it('no llama avería a que el modelo diga que no hay ninguna tabla', async () => {
    responder = () => ({
      status: 200,
      payload: comoOpenAi(JSON.stringify({ tabla: '', columnas: [], ilegible: ['un gato'] })),
    });

    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.toThrow(
      /no ha encontrado ninguna tabla/,
    );
    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.not.toThrow(/forma esperada/);
  });

  it('cuenta lo que el modelo dice ver, que es la única pista de por qué falló', async () => {
    responder = () => ({
      status: 200,
      payload: comoOpenAi(
        JSON.stringify({ tabla: '', columnas: [], ilegible: ['una foto de un perro'] }),
      ),
    });

    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.toThrow(
      /una foto de un perro/,
    );
  });

  it('sin explicación, apunta al modelo mal configurado', async () => {
    responder = () => ({
      status: 200,
      payload: comoOpenAi(JSON.stringify({ tabla: '', columnas: [], ilegible: [] })),
    });

    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.toThrow(/LLM_VISION_MODEL/);
  });

  it('avisa cuando la respuesta ni siquiera es JSON', async () => {
    responder = () => ({ status: 200, payload: comoOpenAi('no veo ninguna tabla en la imagen') });

    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.toThrow(/JSON/);
  });

  it('avisa cuando la respuesta viene vacía', async () => {
    responder = () => ({ status: 200, payload: comoOpenAi('   ') });

    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.toThrow(/vacía/);
  });

  it('propaga el motivo del proveedor, que es lo único accionable', async () => {
    responder = () => ({ status: 402, payload: 'Insufficient Balance' });

    await expect(vision().extraerTabla('QUJD', 'image/png')).rejects.toThrow(
      /Insufficient Balance/,
    );
  });

  // -------------------------------------------------------------------------
  // Lectura de un diagrama de clases entero
  // -------------------------------------------------------------------------

  const diagramaValido = {
    clases: [
      { nombre: 'Class A', estereotipo: 'class', atributos: [], filas: [] },
      { nombre: 'Class B', estereotipo: 'class', atributos: [], filas: [] },
    ],
    relaciones: [
      {
        origen: 'Class A',
        destino: 'Class B',
        tipo: 'association',
        cardinalidadOrigen: '1',
        cardinalidadDestino: '0..*',
        nombre: 'Association A',
      },
    ],
    confianza: 0.8,
    ilegible: [],
  };

  it('devuelve el diagrama cuando el modelo responde con la forma esperada', async () => {
    responder = () => ({ status: 200, payload: comoOpenAi(JSON.stringify(diagramaValido)) });

    const diagrama = await vision().extraerDiagrama('QUJD', 'image/png');
    expect(diagrama.clases).toHaveLength(2);
    // La cardinalidad llega cruda hasta aquí; canonizarla es trabajo del
    // intérprete, no del transporte.
    expect(diagrama.relaciones[0]?.cardinalidadDestino).toBe('0..*');
  });

  it('le pide al modelo que deje la cardinalidad vacía antes que suponerla', async () => {
    responder = () => ({ status: 200, payload: comoOpenAi(JSON.stringify(diagramaValido)) });

    await vision().extraerDiagrama('QUJD', 'image/png');

    const mensajes = recibidos[0]?.messages as { content: { type: string; text?: string }[] }[];
    const texto = mensajes[0]?.content.find((parte) => parte.type === 'text')?.text ?? '';
    // Es la instrucción de la que depende que una cardinalidad ilegible se marque
    // como dudosa en vez de colarse inventada en el esquema.
    expect(texto).toMatch(/NO la supongas/);
    expect(texto).toMatch(/diagrama de clases/);
  });

  it('descarta entero un diagrama con las relaciones rotas', async () => {
    // Clases bien y relaciones mal se aprueba de un vistazo, y genera un esquema
    // al que le faltan claves foráneas que nadie echa en falta hasta muy tarde.
    responder = () => ({
      status: 200,
      payload: comoOpenAi(
        JSON.stringify({ clases: [{ nombre: 'A' }], relaciones: 'no es lista' }),
      ),
    });

    await expect(vision().extraerDiagrama('QUJD', 'image/png')).rejects.toBeInstanceOf(
      ErrorDeModelo,
    );
  });

  it('no llama avería a que el modelo diga que no hay ningún diagrama', async () => {
    responder = () => ({
      status: 200,
      payload: comoOpenAi(JSON.stringify({ clases: [], ilegible: ['una foto de un perro'] })),
    });

    await expect(vision().extraerDiagrama('QUJD', 'image/png')).rejects.toThrow(
      /una foto de un perro/,
    );
    await expect(vision().extraerDiagrama('QUJD', 'image/png')).rejects.not.toThrow(
      /forma esperada/,
    );
  });

  it('sin explicación, apunta al modelo mal configurado', async () => {
    responder = () => ({
      status: 200,
      payload: comoOpenAi(JSON.stringify({ clases: [], ilegible: [] })),
    });

    await expect(vision().extraerDiagrama('QUJD', 'image/png')).rejects.toThrow(
      /LLM_VISION_MODEL/,
    );
  });

  // -------------------------------------------------------------------------
  // Reintentos ante un fallo pasajero del proveedor
  //
  // Un `503 UNAVAILABLE` de la capa gratuita de Gemini le costaba al usuario
  // volver a subir la foto por algo que se arregla solo esperando un segundo.
  // Lo que hay que sujetar con pruebas es la frontera: qué se reintenta y qué
  // no. Reintentar de más es peor que no reintentar, porque convierte una clave
  // mal escrita en una espera larga que acaba en el mismo error.
  // -------------------------------------------------------------------------

  it('reintenta un 503 y devuelve el diagrama cuando el proveedor se recupera', async () => {
    let llamadas = 0;
    responder = () => {
      llamadas += 1;
      return llamadas === 1
        ? { status: 503, payload: { error: { code: 503, message: 'high demand' } } }
        : { status: 200, payload: comoOpenAi(JSON.stringify(diagramaValido)) };
    };

    const leido = await vision().extraerDiagrama('QUJD', 'image/png');

    expect(leido.clases).toHaveLength(2);
    expect(llamadas).toBe(2);
  });

  it('se rinde tras agotar los reintentos y deja ver el motivo', async () => {
    responder = () => ({
      status: 503,
      payload: { error: { code: 503, message: 'high demand' } },
    });

    await expect(vision().extraerDiagrama('QUJD', 'image/png')).rejects.toThrow(/high demand/);
    // Tres intentos: el original más los dos reintentos por defecto.
    expect(recibidos).toHaveLength(3);
  });

  it('no reintenta un 402: sin saldo no se arregla insistiendo', async () => {
    responder = () => ({ status: 402, payload: 'Insufficient Balance' });

    await expect(vision().extraerDiagrama('QUJD', 'image/png')).rejects.toThrow(
      /Insufficient Balance/,
    );
    expect(recibidos).toHaveLength(1);
  });

  it('no reintenta un 404: el modelo retirado lo sigue estando', async () => {
    responder = () => ({ status: 404, payload: 'no longer available' });

    await expect(vision().extraerDiagrama('QUJD', 'image/png')).rejects.toThrow(
      /no longer available/,
    );
    expect(recibidos).toHaveLength(1);
  });

  it('respeta que le pidan no reintentar', async () => {
    responder = () => ({ status: 503, payload: 'high demand' });

    await expect(
      vision({ reintentos: 0 }).extraerDiagrama('QUJD', 'image/png'),
    ).rejects.toThrow(/high demand/);
    expect(recibidos).toHaveLength(1);
  });

  it('la lectura de tablas se reintenta igual que la de diagramas', async () => {
    // Las dos comparten transporte justamente para que no se arreglen por
    // separado. Si un día alguien mete el reintento solo en una, esto lo dice.
    let llamadas = 0;
    responder = () => {
      llamadas += 1;
      return llamadas === 1
        ? { status: 503, payload: 'high demand' }
        : { status: 200, payload: comoOpenAi(JSON.stringify(tablaValida)) };
    };

    const tabla = await vision().extraerTabla('QUJD', 'image/png');

    expect(tabla.tabla).toBe('Empleado');
    expect(llamadas).toBe(2);
  });
});
