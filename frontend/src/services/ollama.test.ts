import { describe, expect, it } from 'vitest';
import { construirCorpus, indexar, type Documento } from '@app/shared';
import { modelosDisponibles, preguntar, trozoDeLinea } from './ollama.js';

/**
 * El cliente del modelo local, probado sin modelo local.
 *
 * Una prueba no debe depender de que un servicio esté levantado ni de lo que un
 * modelo decida contestar hoy. Se inyecta un `fetch` falso y se afirma sobre lo
 * que sí es nuestro: qué se le manda, cómo se lee lo que contesta y —lo que más
 * importa— qué pasa cuando no contesta nadie.
 *
 * Tiene un punto ciego que conviene tener presente: el doble lo escribimos
 * nosotros, así que estas pruebas confirman que el lector de NDJSON hace lo que
 * *creemos* que Ollama manda. Si esa creencia fuera falsa, pasarían en verde
 * igualmente. Esa mitad la cubre `ollama.integracion.test.ts`, que habla con un
 * Ollama de verdad y se salta sola si no hay `TEST_OLLAMA_URL`.
 */

const MANUAL: Documento = {
  nombre: 'Guía',
  ruta: 'docs/05-guia.md',
  markdown: [
    '# Guía',
    '',
    '## Exportar XMI',
    '',
    'El fichero que sale se abre en Enterprise Architect.',
    '',
    '## Control por voz',
    '',
    'Se dicta una orden y el asistente propone una operación.',
  ].join('\n'),
};

const indice = indexar(construirCorpus([MANUAL]));

/** Un Ollama de mentira que contesta NDJSON en los trozos que se le pidan. */
function ollamaFalso(trozos: readonly string[], opciones: { estado?: number } = {}) {
  const llamadas: { url: string; cuerpo: unknown }[] = [];

  const fetch = (async (entrada: unknown, init?: RequestInit) => {
    const url = String(entrada);
    llamadas.push({
      url,
      cuerpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const estado = opciones.estado ?? 200;
    if (estado !== 200) return new Response('', { status: estado });

    const cuerpo = new ReadableStream<Uint8Array>({
      start(controlador) {
        const codificador = new TextEncoder();
        for (const trozo of trozos) controlador.enqueue(codificador.encode(trozo));
        controlador.close();
      },
    });
    return new Response(cuerpo, { status: 200 });
  }) as unknown as typeof globalThis.fetch;

  return { fetch, llamadas };
}

/** Una línea NDJSON como las que manda Ollama. */
const linea = (contenido: string): string =>
  `${JSON.stringify({ message: { role: 'assistant', content: contenido }, done: false })}\n`;

describe('leer lo que Ollama va contestando', () => {
  it('saca el texto de una línea de NDJSON', () => {
    expect(trozoDeLinea(linea('hola'))).toBe('hola');
  });

  it('ignora las líneas vacías y las que no son JSON', () => {
    // Llegan de verdad: la última lectura del socket suele terminar en un salto
    // de línea suelto. Si esto lanzara, la respuesta se perdería entera al final.
    expect(trozoDeLinea('')).toBeNull();
    expect(trozoDeLinea('   ')).toBeNull();
    expect(trozoDeLinea('{"message":{"cont')).toBeNull();
    expect(trozoDeLinea('{"done":true}')).toBeNull();
  });

  it('junta la respuesta aunque los trozos no lleguen alineados con las líneas', async () => {
    // El caso que rompe una implementación ingenua: aquí una línea de JSON viene
    // partida por la mitad entre dos lecturas. Si se parseara cada lectura tal
    // cual, ese trozo se descartaría y la respuesta saldría con un hueco.
    const completo = linea('El fichero ') + linea('se abre en EA.');
    const mitad = Math.floor(completo.length / 2);
    const { fetch } = ollamaFalso([completo.slice(0, mitad), completo.slice(mitad)]);

    const r = await preguntar(indice, '¿cómo exporto un XMI?', { fetch });
    expect(r.texto).toBe('El fichero se abre en EA.');
  });

  it('no se come el último trozo cuando no termina en salto de línea', async () => {
    const { fetch } = ollamaFalso([linea('primero '), JSON.stringify({ message: { content: 'y último' } })]);

    const r = await preguntar(indice, 'exportar xmi', { fetch });
    expect(r.texto).toBe('primero y último');
  });

  it('va entregando los trozos según llegan, para poder escribirlos', async () => {
    // Con un modelo pequeño en una máquina de escritorio, la respuesta tarda
    // segundos. Mostrarla mientras se escribe es la diferencia entre parecer
    // que piensa y parecer que se ha colgado.
    const vistos: string[] = [];
    const { fetch } = ollamaFalso([linea('uno '), linea('dos')]);

    await preguntar(indice, 'exportar xmi', { fetch, onTrozo: (t) => vistos.push(t) });
    expect(vistos).toEqual(['uno ', 'dos']);
  });
});

describe('lo que se le manda al modelo', () => {
  it('le pasa el manual como contexto y devuelve de qué secciones salió', () => {
    // Es lo que convierte esto en una guía y no en un modelo opinando: la
    // respuesta viene acompañada de la sección, que se puede leer y contrastar.
    return preguntar(indice, '¿cómo exporto un XMI?', { fetch: ollamaFalso([linea('ok')]).fetch }).then(
      (r) => {
        expect(r.fuentes.length).toBeGreaterThan(0);
        expect(r.fuentes[0]!.fragmento.titulo).toBe('Exportar XMI');
      },
    );
  });

  it('incluye el texto del manual y la pregunta en el cuerpo de la petición', async () => {
    const { fetch, llamadas } = ollamaFalso([linea('ok')]);
    await preguntar(indice, '¿cómo exporto un XMI?', { fetch });

    const cuerpo = llamadas[0]!.cuerpo as {
      messages: { role: string; content: string }[];
      stream: boolean;
    };
    expect(llamadas[0]!.url).toBe('http://localhost:11434/api/chat');
    expect(cuerpo.stream).toBe(true);
    expect(cuerpo.messages[0]!.role).toBe('system');
    expect(cuerpo.messages[1]!.content).toContain('Enterprise Architect');
    expect(cuerpo.messages[1]!.content).toContain('¿cómo exporto un XMI?');
  });

  it('le prohíbe inventar y le da la frase exacta para cuando no sabe', () => {
    const { fetch, llamadas } = ollamaFalso([linea('ok')]);
    return preguntar(indice, 'exportar xmi', { fetch }).then(() => {
      const sistema = (llamadas[0]!.cuerpo as { messages: { content: string }[] }).messages[0]!;
      expect(sistema.content).toContain('Eso no lo cubre el manual.');
    });
  });

  it('ni siquiera llama al modelo si el manual no dice nada del tema', async () => {
    // Sin contexto un modelo solo puede improvisar. Preguntarle igualmente sería
    // pedirle justo lo que se le ha prohibido hacer.
    const { fetch, llamadas } = ollamaFalso([linea('me lo invento')]);
    const r = await preguntar(indice, 'receta de albóndigas suecas', { fetch });

    expect(llamadas).toEqual([]);
    expect(r.texto).toBe('Eso no lo cubre el manual.');
    expect(r.fuentes).toEqual([]);
  });

  it('avisa con algo accionable si Ollama está pero el modelo no', async () => {
    const { fetch } = ollamaFalso([], { estado: 404 });
    await expect(preguntar(indice, 'exportar xmi', { fetch })).rejects.toThrow(/modelo/i);
  });
});

describe('averiguar si hay un modelo escuchando', () => {
  it('devuelve los modelos que Ollama declara', async () => {
    const fetch = (async () =>
      new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:1.5b' }] }), {
        status: 200,
      })) as unknown as typeof globalThis.fetch;

    expect(await modelosDisponibles({ fetch })).toEqual(['llama3.2:3b', 'qwen2.5:1.5b']);
  });

  it('dice que no hay ninguno en vez de propagar el fallo', async () => {
    // Que no haya Ollama es el caso normal, no una avería: en el móvil lo es
    // siempre. Si esto lanzara, cada apertura del panel de ayuda tendría que
    // envolverse en un `try`, y quien olvidara hacerlo rompería la ayuda entera
    // justo en el dispositivo donde más falta hace.
    const explota = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;

    expect(await modelosDisponibles({ fetch: explota })).toEqual([]);
  });

  it('tampoco se cae si contesta algo que no esperábamos', async () => {
    const raro = (async () =>
      new Response('no soy JSON', { status: 200 })) as unknown as typeof globalThis.fetch;

    expect(await modelosDisponibles({ fetch: raro })).toEqual([]);
  });
});
