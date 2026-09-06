import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GuiaDelManual, leerDocumentos } from './guia.js';

/**
 * La guía del servidor, contra el manual de verdad y un modelo simulado.
 *
 * Aquí sí se leen los documentos reales de `docs/`, al revés que en las pruebas
 * de `shared`, y es a propósito: esto es lo único que comprueba que el manual
 * que hay hoy en el repositorio se puede trocear y buscar. Un documento nuevo
 * con encabezados raros, o un `docs/` que alguien mueva, se detecta aquí y no en
 * producción cuando la ayuda deje de encontrar nada.
 *
 * Las afirmaciones sobre el contenido son deliberadamente flojas —que salga
 * *algo*, que venga del documento que toca— porque el manual se reescribe a
 * menudo y una prueba que falla porque alguien añadió un párrafo no está
 * midiendo la guía. Lo que sí se afirma con dureza es el comportamiento ante el
 * fallo del modelo, que es donde está el riesgo real.
 */

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs');

let server: Server;
let baseUrl: string;
let responder: () => { status: number; payload: unknown };
let recibidos: Record<string, unknown>[];

beforeEach(async () => {
  recibidos = [];
  responder = () => ({
    status: 200,
    payload: { choices: [{ message: { content: 'Se exporta desde la barra.' } }] },
  });

  server = createServer((request, response) => {
    let cuerpo = '';
    request.on('data', (trozo) => (cuerpo += trozo));
    request.on('end', () => {
      recibidos.push(cuerpo ? JSON.parse(cuerpo) : {});
      const { status, payload } = responder();
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((listo) => server.listen(0, '127.0.0.1', listo));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((listo) => server.close(() => listo()));
});

/** Una guía sin modelo: solo busca. Es el modo que funciona en todas partes. */
const soloBusqueda = (): Promise<GuiaDelManual> => GuiaDelManual.abrir(DOCS);

/** Una guía con un «DeepSeek» de mentira detrás. */
const conModelo = (): Promise<GuiaDelManual> =>
  GuiaDelManual.abrir(DOCS, { apiKey: 'de-mentira', baseUrl, model: 'modelo-falso', timeoutMs: 2000 });

describe('leer el manual del disco', () => {
  it('encuentra los documentos y les pone el título que llevan dentro', async () => {
    const documentos = await leerDocumentos(DOCS);

    expect(documentos.length).toBeGreaterThan(3);
    for (const documento of documentos) {
      expect(documento.markdown.length).toBeGreaterThan(100);
      expect(documento.ruta).toMatch(/^docs\/.+\.md$/);
      // El nombre sale del primer `#` del fichero, no del nombre del fichero:
      // «Guía de voz y OCR» y no «05-guia-voz-y-ocr».
      expect(documento.nombre).not.toMatch(/^\d+-/);
      expect(documento.nombre).not.toContain('.md');
    }
  });

  it('falla al abrir si el directorio no está, en vez de servir un manual vacío', async () => {
    // Es la avería que hay que ver pronto: una guía con cero fragmentos contesta
    // «eso no lo cubre el manual» a todo, y parece que funciona.
    await expect(GuiaDelManual.abrir(resolve(DOCS, 'no-existe'))).rejects.toThrow();
  });

  it('trocea el manual de hoy en algo que se puede buscar', async () => {
    const guia = await soloBusqueda();
    expect(guia.fragmentos).toBeGreaterThan(50);
  });
});

describe('responder sin modelo', () => {
  it('devuelve las secciones del manual y dice que vienen de la búsqueda', async () => {
    const guia = await soloBusqueda();
    const r = await guia.responder('¿cómo exporto el diagrama a Enterprise Architect?');

    expect(r.motor).toBe('busqueda-en-el-manual');
    expect(r.texto).toBeNull();
    expect(r.fuentes.length).toBeGreaterThan(0);
    expect(r.fuentes.some((f) => /xmi|export/i.test(f.fragmento.ruta.join(' ')))).toBe(true);
  });

  it('con clave pero sin modelo no inventa un proveedor: no llama a nadie', async () => {
    /*
      Aquí había un `deepseek-chat` por defecto, y no dejaba a la guía sin
      servicio: la dejaba mandando el modelo de un proveedor a la URL de otro.
      Quien tenía puesta la clave y la URL de Gemini y se olvidaba de
      `LLM_MODEL` recibía un 404 que nombraba un modelo que él no había
      escrito en ninguna parte.

      Lo que se comprueba no es el aviso, es que `recibidos` sigue vacío: la
      prueba de que no se ha adivinado nada es que no ha salido la petición.
    */
    const guia = await GuiaDelManual.abrir(DOCS, { apiKey: 'de-mentira', baseUrl, timeoutMs: 2000 });
    const r = await guia.responder('¿cómo exporto el diagrama a Enterprise Architect?');

    expect(recibidos).toHaveLength(0);
    expect(r.motor).toBe('busqueda-en-el-manual');
    expect(r.fuentes.length).toBeGreaterThan(0);
    expect(r.aviso).toContain('LLM_MODEL');
  });

  it('con clave y modelo pero sin URL tampoco supone a quién preguntar', async () => {
    const guia = await GuiaDelManual.abrir(DOCS, {
      apiKey: 'de-mentira',
      model: 'modelo-falso',
      timeoutMs: 2000,
    });
    const r = await guia.responder('¿cómo exporto el diagrama a Enterprise Architect?');

    expect(recibidos).toHaveLength(0);
    expect(r.motor).toBe('busqueda-en-el-manual');
    expect(r.aviso).toContain('LLM_BASE_URL');
  });

  it('encuentra en el manual con qué base de datos trabaja el proyecto', async () => {
    const guia = await soloBusqueda();
    const r = await guia.responder('¿qué base de datos usa?');

    const todo = r.fuentes.map((f) => f.fragmento.texto).join('\n');
    expect(todo).toMatch(/postgres/i);
  });

  it('no inventa una respuesta cuando la pregunta no va del manual', async () => {
    const guia = await soloBusqueda();
    const r = await guia.responder('cuál es la capital de Mongolia');

    expect(r.texto).toBe('Eso no lo cubre el manual.');
    expect(r.fuentes).toEqual([]);
  });
});

describe('responder con modelo', () => {
  it('le manda el manual y la pregunta, y devuelve lo que redacta', async () => {
    const guia = await conModelo();
    const r = await guia.responder('¿cómo exporto a Enterprise Architect?');

    expect(r.motor).toBe('modelo-falso');
    expect(r.texto).toBe('Se exporta desde la barra.');

    const cuerpo = recibidos[0] as { messages: { role: string; content: string }[] };
    expect(cuerpo.messages[0]!.content).toContain('ÚNICAMENTE');
    expect(cuerpo.messages[1]!.content).toContain('MANUAL:');
    expect(cuerpo.messages[1]!.content).toContain('¿cómo exporto a Enterprise Architect?');
  });

  it('no gasta una llamada si el manual no tiene nada que citar', async () => {
    // Sin contexto el modelo solo puede improvisar, que es justo lo que el
    // sistema le prohíbe. Preguntar igualmente es pagar por un «no lo sé».
    const guia = await conModelo();
    const r = await guia.responder('cuál es la capital de Mongolia');

    expect(recibidos).toEqual([]);
    expect(r.texto).toBe('Eso no lo cubre el manual.');
  });

  it('si el modelo falla, contesta con el manual en vez de con un error', async () => {
    // Es el caso que justifica recuperar SIEMPRE antes de llamar al modelo: en
    // el momento del fallo ya teníamos una respuesta buena en la mano, y
    // propagar la excepción sería tirarla.
    responder = () => ({ status: 402, payload: { error: 'Insufficient Balance' } });

    const guia = await conModelo();
    const r = await guia.responder('¿cómo exporto a Enterprise Architect?');

    expect(r.motor).toBe('busqueda-en-el-manual');
    expect(r.texto).toBeNull();
    expect(r.fuentes.length).toBeGreaterThan(0);
    // Y se dice que se ha degradado: si no, una clave caducada dejaría la ayuda
    // «funcionando» y nadie iría a mirar los registros.
    expect(r.aviso).toMatch(/402|no contestó/i);
  });

  it('trata una respuesta vacía del modelo como un fallo, no como una respuesta', async () => {
    responder = () => ({ status: 200, payload: { choices: [{ message: { content: '  ' } }] } });

    const guia = await conModelo();
    const r = await guia.responder('¿cómo exporto a Enterprise Architect?');

    expect(r.texto).toBeNull();
    expect(r.motor).toBe('busqueda-en-el-manual');
    expect(r.fuentes.length).toBeGreaterThan(0);
  });
});
