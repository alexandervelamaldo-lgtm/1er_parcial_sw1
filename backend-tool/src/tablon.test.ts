import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from './config.js';
import { createApp, createDependencies, type AppDependencies } from './app.js';
import { LocalIdentityProvider } from './auth/identity.js';
import { FileTablonStore } from './storage/tablon.js';

/**
 * El tablón de extremo a extremo: desde la petición HTTP hasta el disco.
 *
 * Se levanta la aplicación entera sobre un directorio temporal, igual que en
 * `api.test.ts` y por el mismo motivo: lo que hay que comprobar aquí no es que
 * el almacén ordene bien —eso ya lo mira `storage/tablon.test.ts`— sino que las
 * comprobaciones de permiso están *conectadas* a las rutas, que es justo lo que
 * un doble de prueba esconde.
 */

let app: Express;
let deps: AppDependencies;
let dataDir: string;

/** Un WebM mínimo. Al servicio le da igual el contenido; el tamaño no. */
function audio(tamano = 512): Buffer {
  return Buffer.alloc(tamano, 7);
}

async function registrar(email: string): Promise<{ token: string; id: string }> {
  const respuesta = await request(app)
    .post('/api/auth/registro')
    .send({ email, password: 'contraseña-larga', nombre: email.split('@')[0] });
  expect(respuesta.status).toBe(201);
  const yo = await request(app)
    .get('/api/auth/yo')
    .set('Authorization', `Bearer ${respuesta.body.token}`);
  return { token: respuesta.body.token as string, id: yo.body.usuario.id as string };
}

async function crearProyecto(token: string): Promise<string> {
  const respuesta = await request(app)
    .post('/api/proyectos')
    .set('Authorization', `Bearer ${token}`)
    .send({ nombre: 'Tienda', descripcion: '' });
  expect(respuesta.status).toBe(201);
  return respuesta.body.proyecto.id as string;
}

async function invitar(
  token: string,
  proyectoId: string,
  email: string,
  rol: 'editor' | 'viewer',
): Promise<void> {
  const respuesta = await request(app)
    .post(`/api/proyectos/${proyectoId}/miembros`)
    .set('Authorization', `Bearer ${token}`)
    .send({ email, rol });
  expect(respuesta.status).toBe(201);
}

function publicar(token: string, proyectoId: string, texto: string) {
  return request(app)
    .post(`/api/proyectos/${proyectoId}/tablon`)
    .set('Authorization', `Bearer ${token}`)
    .send({ texto });
}

function publicarVoz(
  token: string,
  proyectoId: string,
  cuerpo: { audio?: string; tipo?: string; duracionMs?: number } = {},
) {
  return request(app)
    .post(`/api/proyectos/${proyectoId}/tablon/voz`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      audio: cuerpo.audio ?? audio().toString('base64'),
      tipo: cuerpo.tipo ?? 'audio/webm;codecs=opus',
      duracionMs: cuerpo.duracionMs ?? 4200,
    });
}

function leer(token: string, proyectoId: string, consulta = '') {
  return request(app)
    .get(`/api/proyectos/${proyectoId}/tablon${consulta}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-tablon-api-'));
  const config = { ...loadConfig({ SESSION_SECRET: 'secreto-de-prueba' }), dataDir };
  deps = await createDependencies(config);
  app = createApp(deps).app;
});

afterEach(async () => {
  await deps.rooms.shutdown();
  if (deps.identity instanceof LocalIdentityProvider) await deps.identity.flush();
  // Mismo motivo que el `flush` de arriba: el almacén del tablón escribe en
  // segundo plano y en Windows el borrado del directorio compite con una
  // escritura a medio hacer, que es una prueba en rojo por el desmontaje.
  if (deps.tablon instanceof FileTablonStore) await deps.tablon.flush();
  await rm(dataDir, { recursive: true, force: true });
});

describe('permisos del tablón', () => {
  it('quien no es miembro no sabe siquiera que el proyecto existe', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    // 404 y no 403: distinguirlos permitiría averiguar qué proyectos hay.
    expect((await leer(beto.token, proyecto)).status).toBe(404);
    expect((await publicar(beto.token, proyecto, 'hola')).status).toBe(404);
  });

  it('sin sesión no se entra', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await request(app).get(`/api/proyectos/${proyecto}/tablon`);
    expect(respuesta.status).toBe(401);
  });

  it('un invitado de solo lectura puede escribir en el tablón', async () => {
    // Es la decisión que separa este módulo de un panel de anuncios: a un
    // `viewer` se le invita para que revise, y un revisor que no puede decir
    // «esta cardinalidad está al revés» no revisa nada.
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    await invitar(ana.token, proyecto, 'beto@ejemplo.com', 'viewer');

    const respuesta = await publicar(beto.token, proyecto, 'la cardinalidad está al revés');
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.mensaje.texto).toBe('la cardinalidad está al revés');
  });
});

describe('publicar texto', () => {
  it('devuelve el mensaje con su autor ya resuelto', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await publicar(ana.token, proyecto, '  hola  ');
    expect(respuesta.status).toBe(201);
    expect(respuesta.body.mensaje).toMatchObject({
      texto: 'hola',
      tipo: 'texto',
      autorId: ana.id,
      autorNombre: 'ana',
      secuencia: 1,
      version: 1,
      retirado: false,
      audio: null,
    });
  });

  it('un mensaje en blanco no llega al almacén', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await publicar(ana.token, proyecto, '   \n  ');
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.code).toBe('MENSAJE_INVALIDO');
    expect((await leer(ana.token, proyecto)).body.mensajes).toEqual([]);
  });

  it('pasarse de largo se explica en caracteres, no en un error de esquema', async () => {
    // El esquema admite más de la cuenta a propósito: si cortara en 2000, quien
    // se pasa recibiría «String must contain at most 2000 character(s)» sobre
    // un campo, en inglés, en vez de la frase que dice cuánto sobra.
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await publicar(ana.token, proyecto, 'a'.repeat(2001));
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.code).toBe('MENSAJE_INVALIDO');
    expect(respuesta.body.error).toMatch(/2000 caracteres/);
  });
});

describe('notas de voz', () => {
  it('se publican, se listan con sus metadatos y se descargan enteras', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    const bytes = audio(777);

    const publicada = await publicarVoz(ana.token, proyecto, {
      audio: bytes.toString('base64'),
      duracionMs: 4200,
    });
    expect(publicada.status).toBe(201);
    expect(publicada.body.mensaje).toMatchObject({
      tipo: 'voz',
      texto: '',
      // El tipo guardado es nuestro literal, no la cadena del navegador con su
      // `;codecs=opus` detrás.
      audio: { tipo: 'audio/webm', bytes: 777, duracionMs: 4200 },
    });

    const id = publicada.body.mensaje.id as string;
    const descarga = await request(app)
      .get(`/api/proyectos/${proyecto}/tablon/${id}/audio`)
      .set('Authorization', `Bearer ${ana.token}`)
      .responseType('blob');

    expect(descarga.status).toBe(200);
    expect(descarga.headers['content-type']).toBe('audio/webm');
    expect(descarga.headers['content-disposition']).toBe('inline; filename="nota-1.webm"');
    expect(Buffer.from(descarga.body as Buffer).equals(bytes)).toBe(true);
  });

  it('un formato que no está en la lista se rechaza, no se arregla', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await publicarVoz(ana.token, proyecto, { tipo: 'audio/wav' });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.code).toBe('AUDIO_NO_ADMITIDO');
  });

  it('un tipo con salto de línea dentro no llega a ninguna cabecera', async () => {
    // Si se guardara la cadena del cliente, este valor saldría tal cual en el
    // `Content-Type` de la descarga y añadiría una cabecera inventada.
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await publicarVoz(ana.token, proyecto, {
      tipo: 'audio/webm\r\nX-Inyectada: si',
    });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.code).toBe('AUDIO_NO_ADMITIDO');
  });

  it('una nota que no cabe se rechaza antes de tocar el disco', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await publicarVoz(ana.token, proyecto, {
      audio: audio(1024 * 1024 + 1).toString('base64'),
    });
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.code).toBe('AUDIO_DEMASIADO_GRANDE');
    expect((await leer(ana.token, proyecto)).body.mensajes).toEqual([]);
  });

  it('una cadena que no es base64 se detecta aquí y no al reproducir', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    const respuesta = await publicarVoz(ana.token, proyecto, { audio: 'esto no es base64 ***' });
    expect(respuesta.status).toBe(400);
  });

  it('el audio de un proyecto no se descarga desde otro', async () => {
    // Conocer el identificador de un mensaje no debe bastar: la ruta filtra por
    // proyecto y quien pregunta tiene que ser miembro de *ese* proyecto.
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const deAna = await crearProyecto(ana.token);
    const deBeto = await crearProyecto(beto.token);

    const publicada = await publicarVoz(ana.token, deAna);
    const id = publicada.body.mensaje.id as string;

    const robo = await request(app)
      .get(`/api/proyectos/${deBeto}/tablon/${id}/audio`)
      .set('Authorization', `Bearer ${beto.token}`);
    expect(robo.status).toBe(404);
  });
});

describe('sondeo', () => {
  it('el cursor al día no devuelve nada, y lo nuevo sí', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    await publicar(ana.token, proyecto, 'viejo');

    const primera = await leer(ana.token, proyecto);
    expect(primera.body.mensajes).toHaveLength(1);

    const alDia = await leer(ana.token, proyecto, `?desde=${primera.body.cursor}`);
    expect(alDia.body.mensajes).toEqual([]);
    expect(alDia.body.cursor).toBe(primera.body.cursor);

    await publicar(ana.token, proyecto, 'nuevo');
    const sondeo = await leer(ana.token, proyecto, `?desde=${primera.body.cursor}`);
    expect(sondeo.body.mensajes.map((m: { texto: string }) => m.texto)).toEqual(['nuevo']);
  });

  it('entrega la retirada a quien ya había visto el mensaje', async () => {
    // El caso que justifica que haya dos numeraciones. Sin él, la nota de voz
    // seguiría sonando en la pantalla de quien ya la tenía.
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    const publicada = await publicarVoz(ana.token, proyecto);
    const id = publicada.body.mensaje.id as string;

    const { cursor } = (await leer(ana.token, proyecto)).body;
    await request(app)
      .delete(`/api/proyectos/${proyecto}/tablon/${id}`)
      .set('Authorization', `Bearer ${ana.token}`);

    const sondeo = await leer(ana.token, proyecto, `?desde=${cursor}`);
    expect(sondeo.body.mensajes).toHaveLength(1);
    expect(sondeo.body.mensajes[0]).toMatchObject({ id, retirado: true, audio: null });
  });

  it('se puede subir por el hilo con antesDe', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    for (let i = 1; i <= 4; i += 1) await publicar(ana.token, proyecto, `m${i}`);

    const arriba = await leer(ana.token, proyecto, '?antesDe=3');
    expect(arriba.body.mensajes.map((m: { texto: string }) => m.texto)).toEqual(['m1', 'm2']);
  });

  it('un cursor con letras dentro se ignora en vez de romper la pantalla', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    await publicar(ana.token, proyecto, 'uno');

    const respuesta = await leer(ana.token, proyecto, '?desde=xxx');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.mensajes).toHaveLength(1);
  });
});

describe('retirar', () => {
  it('el autor retira lo suyo y el audio deja de servirse', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    const publicada = await publicarVoz(ana.token, proyecto);
    const id = publicada.body.mensaje.id as string;

    const retirada = await request(app)
      .delete(`/api/proyectos/${proyecto}/tablon/${id}`)
      .set('Authorization', `Bearer ${ana.token}`);
    expect(retirada.status).toBe(200);
    expect(retirada.body.mensaje.retirado).toBe(true);

    const descarga = await request(app)
      .get(`/api/proyectos/${proyecto}/tablon/${id}/audio`)
      .set('Authorization', `Bearer ${ana.token}`);
    expect(descarga.status).toBe(404);
  });

  it('un compañero no puede borrar lo que escribió otro', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    await invitar(ana.token, proyecto, 'beto@ejemplo.com', 'editor');

    const mensaje = await publicar(ana.token, proyecto, 'mío');
    const respuesta = await request(app)
      .delete(`/api/proyectos/${proyecto}/tablon/${mensaje.body.mensaje.id}`)
      .set('Authorization', `Bearer ${beto.token}`);

    expect(respuesta.status).toBe(403);
  });

  it('el propietario sí puede, porque responde del proyecto', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    await invitar(ana.token, proyecto, 'beto@ejemplo.com', 'editor');

    const mensaje = await publicar(beto.token, proyecto, 'algo que no debería estar');
    const respuesta = await request(app)
      .delete(`/api/proyectos/${proyecto}/tablon/${mensaje.body.mensaje.id}`)
      .set('Authorization', `Bearer ${ana.token}`);

    expect(respuesta.status).toBe(200);
    expect(respuesta.body.mensaje.texto).toBe('');
  });
});

describe('ciclo de vida del proyecto', () => {
  it('borrar el proyecto se lleva el tablón por delante', async () => {
    // Con PostgreSQL bastaría la cascada; con el almacén de fichero no hay
    // ninguna, y las conversaciones quedarían en disco después de que alguien
    // pidiera borrar el proyecto.
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);
    await publicarVoz(ana.token, proyecto);
    await publicar(ana.token, proyecto, 'algo');

    const borrado = await request(app)
      .delete(`/api/proyectos/${proyecto}`)
      .set('Authorization', `Bearer ${ana.token}`);
    expect(borrado.status).toBe(204);

    const restos = await deps.tablon.ultimos(proyecto, 50);
    expect(restos.mensajes).toEqual([]);
  });
});

describe('cuota', () => {
  it('la publicación tiene tope y el sondeo no', async () => {
    // Si el límite estuviera montado sobre el camino entero, un tablón abierto
    // sondeando cada tres segundos se apagaría solo a los pocos minutos.
    const ana = await registrar('ana@ejemplo.com');
    const proyecto = await crearProyecto(ana.token);

    let ultimo = 201;
    for (let i = 0; i < 31 && ultimo !== 429; i += 1) {
      ultimo = (await publicar(ana.token, proyecto, `m${i}`)).status;
    }
    expect(ultimo).toBe(429);

    for (let i = 0; i < 40; i += 1) {
      expect((await leer(ana.token, proyecto, '?desde=0')).status).toBe(200);
    }
  });
});
