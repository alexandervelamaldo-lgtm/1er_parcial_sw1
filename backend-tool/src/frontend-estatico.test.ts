import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from './config.js';
import { createApp, createDependencies, type AppDependencies } from './app.js';

/**
 * El servicio sirviendo también el frontend construido.
 *
 * Hace falta para desplegar en un solo contenedor, y eso no es una comodidad:
 * el cliente deriva la URL del canal colaborativo de `location.host`, así que
 * servir el frontend desde otro origen dejaría al navegador buscando el
 * WebSocket donde no hay nadie escuchando.
 *
 * Lo que estas pruebas vigilan de verdad es el orden de los middlewares. Montar
 * el comodín del frontend antes que la API haría que `/api/...` devolviera el
 * `index.html` con un 200, y el cliente se encontraría HTML donde espera JSON.
 */

let app: Express;
let deps: AppDependencies;
let dataDir: string;
let frontendDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-static-'));
  frontendDir = join(dataDir, 'dist');
  await mkdir(join(frontendDir, 'assets'), { recursive: true });
  await writeFile(join(frontendDir, 'index.html'), '<!doctype html><title>UML</title>');
  await writeFile(join(frontendDir, 'assets', 'app-a1b2c3.js'), 'console.log(1);');

  const config = {
    ...loadConfig({ SESSION_SECRET: 'secreto-de-prueba' }),
    dataDir,
    frontendDir,
  };
  deps = await createDependencies(config);
  app = createApp(deps).app;
});

afterEach(async () => {
  await deps.rooms.shutdown();
  await rm(dataDir, { recursive: true, force: true });
});

describe('frontend servido por el propio servicio', () => {
  it('devuelve el index en la raíz', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>UML</title>');
  });

  it('devuelve el index en una ruta del cliente para que la recarga funcione', async () => {
    // `/proyectos/:id` no es un fichero. Sin el comodín, recargar la página
    // estando dentro de un proyecto daría 404.
    const response = await request(app).get('/proyectos/algo');
    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>UML</title>');
  });

  it('sirve los ficheros con hash y los marca como cacheables para siempre', async () => {
    const response = await request(app).get('/assets/app-a1b2c3.js');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('immutable');
  });

  it('no cachea el index, que es quien apunta al resto', async () => {
    // Cachear el `index.html` dejaría a los navegadores pidiendo ficheros con
    // el hash viejo, que tras el despliegue siguiente ya no existen.
    const response = await request(app).get('/');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('una ruta de API inexistente sigue devolviendo JSON y no el index', async () => {
    // El fallo que este montaje puede introducir: si el comodín se tragara
    // `/api`, el cliente recibiría HTML donde espera JSON y el error real
    // quedaría escondido tras un «Unexpected token <».
    const response = await request(app).get('/api/no-existe');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.text).not.toContain('<title>');
  });

  it('la API protegida sigue exigiendo sesión en vez de servir el index', async () => {
    const response = await request(app).get('/api/proyectos');
    expect(response.status).toBe(401);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('la ruta de salud no queda tapada por el frontend', async () => {
    // El balanceador de AWS comprueba esta ruta. Si devolviera el index con un
    // 200 la comprobación pasaría siempre, incluso con el servicio roto.
    const response = await request(app).get('/salud');
    expect(response.status).toBe(200);
    expect(response.body.estado).toBe('ok');
  });

  it('no sirve nada fuera del directorio del frontend', async () => {
    // Escape de directorio: el `.env` vive por encima de `dist/`.
    await writeFile(join(dataDir, 'secreto.txt'), 'no debería salir de aquí');
    const response = await request(app).get('/../secreto.txt');
    expect(response.text).not.toContain('no debería salir de aquí');
  });
});

describe('sin frontend construido', () => {
  it('la API funciona igual y la raíz da un 404 con explicación', async () => {
    // Es el despliegue de solo API, y también lo que pasa en desarrollo, donde
    // el frontend lo sirve Vite.
    const soloApi = await createDependencies({
      ...loadConfig({ SESSION_SECRET: 'secreto-de-prueba' }),
      dataDir,
    });
    const { app: sinFrontend } = createApp(soloApi);
    try {
      const salud = await request(sinFrontend).get('/salud');
      expect(salud.status).toBe(200);

      const raiz = await request(sinFrontend).get('/');
      expect(raiz.status).toBe(404);
      expect(raiz.headers['content-type']).toContain('application/json');
    } finally {
      await soloApi.rooms.shutdown();
    }
  });
});
