import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { loadConfig } from './config.js';
import { createApp, createDependencies, type AppDependencies } from './app.js';

/**
 * Pruebas de la API contra la aplicación entera.
 *
 * Se levanta el servicio real sobre un directorio temporal en vez de simular el
 * almacén: lo que hay que comprobar aquí es que las comprobaciones de permiso
 * están *conectadas*, y eso es justo lo que un doble de prueba oculta.
 */

let app: Express;
let deps: AppDependencies;
let dataDir: string;

async function registrar(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/registro')
    .send({ email, password: 'contraseña-larga', nombre: email.split('@')[0] });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

async function crearProyecto(token: string, nombre = 'Tienda'): Promise<string> {
  const response = await request(app)
    .post('/api/proyectos')
    .set('Authorization', `Bearer ${token}`)
    .send({ nombre, descripcion: '' });
  expect(response.status).toBe(201);
  return response.body.proyecto.id as string;
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-api-'));
  const config = { ...loadConfig({ SESSION_SECRET: 'secreto-de-prueba' }), dataDir };
  deps = await createDependencies(config);
  app = createApp(deps).app;
});

afterEach(async () => {
  await deps.rooms.shutdown();
  await rm(dataDir, { recursive: true, force: true });
});

describe('autenticación', () => {
  it('registra y devuelve un token utilizable', async () => {
    const token = await registrar('ana@ejemplo.com');
    const yo = await request(app).get('/api/auth/yo').set('Authorization', `Bearer ${token}`);

    expect(yo.status).toBe(200);
    expect(yo.body.usuario.email).toBe('ana@ejemplo.com');
  });

  it('rechaza una contraseña demasiado corta', async () => {
    const response = await request(app)
      .post('/api/auth/registro')
      .send({ email: 'ana@ejemplo.com', password: 'corta', nombre: 'Ana' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PASSWORD_CORTA');
  });

  it('no distingue correo inexistente de contraseña incorrecta', async () => {
    await registrar('ana@ejemplo.com');

    const malaPassword = await request(app)
      .post('/api/auth/acceso')
      .send({ email: 'ana@ejemplo.com', password: 'otra-contraseña' });
    const noExiste = await request(app)
      .post('/api/auth/acceso')
      .send({ email: 'nadie@ejemplo.com', password: 'otra-contraseña' });

    expect(malaPassword.status).toBe(401);
    expect(noExiste.status).toBe(401);
    expect(malaPassword.body.error).toBe(noExiste.body.error);
  });

  it('rechaza sin token', async () => {
    expect((await request(app).get('/api/proyectos')).status).toBe(401);
  });

  it('rechaza un token manipulado', async () => {
    const token = await registrar('ana@ejemplo.com');
    const manipulado = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    const response = await request(app)
      .get('/api/auth/yo')
      .set('Authorization', `Bearer ${manipulado}`);
    expect(response.status).toBe(401);
  });
});

describe('proyectos', () => {
  it('crea el proyecto con su documento ya inicializado', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token, 'Tienda en línea');

    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);

    expect(diagrama.status).toBe(200);
    expect(diagrama.body.diagrama.name).toBe('Tienda en línea');
    expect(diagrama.body.diagrama.meta.artifactId).toBe('tienda-en-linea');
  });

  it('solo lista los proyectos del usuario', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    await crearProyecto(ana);

    const listaBeto = await request(app)
      .get('/api/proyectos')
      .set('Authorization', `Bearer ${beto}`);
    expect(listaBeto.body.proyectos).toHaveLength(0);
  });

  it('responde 404 y no 403 a un extraño, para no revelar que existe', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);

    const response = await request(app)
      .get(`/api/proyectos/${proyectoId}`)
      .set('Authorization', `Bearer ${beto}`);
    expect(response.status).toBe(404);
  });

  it('invita a un colaborador por correo', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);

    const invitacion = await request(app)
      .post(`/api/proyectos/${proyectoId}/miembros`)
      .set('Authorization', `Bearer ${ana}`)
      .send({ email: 'beto@ejemplo.com', rol: 'viewer' });
    expect(invitacion.status).toBe(201);

    const lista = await request(app)
      .get('/api/proyectos')
      .set('Authorization', `Bearer ${beto}`);
    expect(lista.body.proyectos).toHaveLength(1);
    expect(lista.body.proyectos[0].role).toBe('viewer');
  });

  it('no deja expulsar al propietario', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(ana);
    const yo = await request(app).get('/api/auth/yo').set('Authorization', `Bearer ${ana}`);

    const response = await request(app)
      .delete(`/api/proyectos/${proyectoId}/miembros/${yo.body.usuario.id}`)
      .set('Authorization', `Bearer ${ana}`);
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('PROPIETARIO_INTOCABLE');
  });

  it('al borrar el proyecto borra también su documento', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(ana);

    expect(
      (
        await request(app)
          .delete(`/api/proyectos/${proyectoId}`)
          .set('Authorization', `Bearer ${ana}`)
      ).status,
    ).toBe(204);

    const despues = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${ana}`);
    expect(despues.status).toBe(404);
  });
});

describe('diagrama', () => {
  it('aplica operaciones y las refleja en el diagrama', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operaciones: [
          { op: 'addClass', name: 'Cliente', kind: 'class' },
          {
            op: 'addAttribute',
            classRef: { name: 'Cliente' },
            name: 'id',
            type: 'Long',
            isIdentifier: true,
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.aplicadas).toBe(2);
    const clases = Object.values(response.body.diagrama.classes) as { name: string }[];
    expect(clases.map((c) => c.name)).toEqual(['Cliente']);
  });

  it('devuelve 422 y no aplica nada si una operación del lote falla', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operaciones: [
          { op: 'addClass', name: 'Cliente', kind: 'class' },
          { op: 'removeClass', ref: { name: 'NoExiste' } },
        ],
      });

    expect(response.status).toBe(422);
    expect(response.body.operacion).toBe(1);

    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);
    expect(Object.keys(diagrama.body.diagrama.classes)).toHaveLength(0);
  });

  it('rechaza una operación mal formada antes de tocar el documento', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operaciones: [{ op: 'operacionInventada' }] });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CUERPO_INVALIDO');
  });

  it('un usuario de solo lectura puede leer pero no escribir', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);
    await request(app)
      .post(`/api/proyectos/${proyectoId}/miembros`)
      .set('Authorization', `Bearer ${ana}`)
      .send({ email: 'beto@ejemplo.com', rol: 'viewer' });

    expect(
      (
        await request(app)
          .get(`/api/proyectos/${proyectoId}/diagrama`)
          .set('Authorization', `Bearer ${beto}`)
      ).status,
    ).toBe(200);

    const escritura = await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${beto}`)
      .send({ operaciones: [{ op: 'addClass', name: 'Cliente', kind: 'class' }] });
    expect(escritura.status).toBe(403);
  });

  /**
   * Es el camino de RF-OFF-04: el cliente vuelve con trabajo hecho sin conexión
   * y debe fusionarse con lo que hayan hecho los demás, sin perder ninguna de
   * las dos partes.
   */
  it('fusiona el trabajo hecho offline con el del servidor', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    const cabecera = { Authorization: `Bearer ${token}` };

    const inicial = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama/estado`)
      .set(cabecera);

    // El servidor avanza mientras el cliente está desconectado.
    await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set(cabecera)
      .send({ operaciones: [{ op: 'addClass', name: 'Servidor', kind: 'class' }] });

    // El cliente trabaja sobre su copia y luego envía lo suyo.
    const Y = await import('yjs');
    const { applyOperation } = await import('@app/shared');
    const local = new Y.Doc();
    Y.applyUpdate(local, new Uint8Array(Buffer.from(inicial.body.actualizacion, 'base64')));
    applyOperation(local, { op: 'addClass', name: 'Offline', kind: 'class' });

    const fusion = await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/estado`)
      .set(cabecera)
      .send({
        actualizacion: Buffer.from(Y.encodeStateAsUpdate(local)).toString('base64'),
        // Sin el vector el servidor no puede saber qué le falta al cliente y
        // tiene que devolver el documento entero; se envía porque es lo que
        // hará el cliente real al reconectar.
        vectorEstado: Buffer.from(Y.encodeStateVector(local)).toString('base64'),
      });
    expect(fusion.status).toBe(200);

    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set(cabecera);
    const nombres = (Object.values(diagrama.body.diagrama.classes) as { name: string }[])
      .map((c) => c.name)
      .sort();
    expect(nombres).toEqual(['Offline', 'Servidor']);

    // Y la respuesta trae al cliente lo que le faltaba.
    Y.applyUpdate(local, new Uint8Array(Buffer.from(fusion.body.actualizacion, 'base64')));
    const { readDiagram } = await import('@app/shared');
    expect(Object.keys(readDiagram(local).classes)).toHaveLength(2);
  });
});

describe('generación', () => {
  async function proyectoConDiagrama(): Promise<{ token: string; proyectoId: string }> {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operaciones: [
          { op: 'addClass', name: 'Cliente', kind: 'class' },
          {
            op: 'addAttribute',
            classRef: { name: 'Cliente' },
            name: 'id',
            type: 'Long',
            isIdentifier: true,
          },
          {
            op: 'addAttribute',
            classRef: { name: 'Cliente' },
            name: 'nombre',
            type: 'String',
            isNullable: false,
          },
        ],
      });
    return { token, proyectoId };
  }

  it('avisa de que un diagrama vacío todavía no puede generarse', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const validacion = await request(app)
      .get(`/api/proyectos/${proyectoId}/validacion`)
      .set('Authorization', `Bearer ${token}`);
    expect(validacion.body.valido).toBe(false);

    const generacion = await request(app)
      .post(`/api/proyectos/${proyectoId}/generacion`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(generacion.status).toBe(422);
  });

  it('genera las cuatro capas a partir del diagrama del documento', async () => {
    const { token, proyectoId } = await proyectoConDiagrama();

    const previa = await request(app)
      .post(`/api/proyectos/${proyectoId}/generacion/previsualizacion`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paqueteBase: 'com.tienda.api' });

    expect(previa.status).toBe(200);
    const rutas = (previa.body.ficheros as { ruta: string }[]).map((f) => f.ruta);
    expect(rutas).toContain('src/main/java/com/tienda/api/domain/Cliente.java');
    expect(rutas).toContain('src/main/java/com/tienda/api/repository/ClienteRepository.java');
    expect(rutas).toContain('src/main/java/com/tienda/api/service/ClienteService.java');
    expect(rutas).toContain('src/main/java/com/tienda/api/controller/ClienteController.java');
  });

  it('devuelve un ZIP descargable', async () => {
    const { token, proyectoId } = await proyectoConDiagrama();

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/generacion`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .buffer()
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    // Firma de un fichero ZIP: sin esto, un cuerpo JSON de error pasaría igual.
    expect((response.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('rechaza un paquete base que no es un paquete Java', async () => {
    const { token, proyectoId } = await proyectoConDiagrama();

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/generacion`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paqueteBase: '../../etc/passwd' });

    expect(response.status).toBe(422);
    expect(response.body.errores[0].code).toBe('INVALID_BASE_PACKAGE');
  });
});

describe('asistente', () => {
  it('propone operaciones sin aplicarlas', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/asistente`)
      .set('Authorization', `Bearer ${token}`)
      .send({ texto: 'crea la clase Cliente' });

    expect(response.status).toBe(200);
    expect(response.body.propuesta).toHaveLength(1);
    expect(response.body.propuesta[0].descripcion).toContain('Cliente');

    // Lo importante: el diagrama sigue vacío hasta que el usuario acepte.
    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);
    expect(Object.keys(diagrama.body.diagrama.classes)).toHaveLength(0);
  });

  it('pide una aclaración en lugar de inventar', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/asistente`)
      .set('Authorization', `Bearer ${token}`)
      .send({ texto: 'ya sabes lo que quiero' });

    expect(response.body.propuesta).toHaveLength(0);
    expect(response.body.aclaracion).toBeTruthy();
  });
});

describe('salud', () => {
  it('responde sin autenticación', async () => {
    const response = await request(app).get('/salud');
    expect(response.status).toBe(200);
    expect(response.body.estado).toBe('ok');
  });
});
