import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {
  CollabProvider,
  applyOperation,
  getHistorialArray,
  readDiagram,
  type EstadoConexion,
  type SocketFactory,
} from '@app/shared';
import { loadConfig } from '../config.js';
import { createApp, createDependencies, type AppDependencies } from '../app.js';
import type { CollabServer } from './server.js';

/**
 * Colaboración en tiempo real de extremo a extremo.
 *
 * Las pruebas de `crdt.test.ts` demuestran que dos réplicas convergen cuando
 * alguien les pasa las actualizaciones a mano. Eso es la mitad de la promesa:
 * falta que el servidor las transporte de verdad, con sockets, permisos y
 * concurrencia. Esta prueba levanta el servicio en un puerto real y conecta
 * clientes que hablan el protocolo completo, porque un fallo en el transporte
 * —un evento no suscrito, un origen mal comparado, un permiso comprobado en el
 * sitio equivocado— no lo detecta ninguna prueba unitaria del CRDT.
 */

let app: Express;
let deps: AppDependencies;
let collab: CollabServer;
let server: Server;
let dataDir: string;
let baseUrl: string;

/**
 * Cliente colaborativo: exactamente el que corre en el navegador.
 *
 * Esta clase no implementa el protocolo, solo envuelve `CollabProvider` de
 * `shared` para darle a la prueba el vocabulario que necesita. Esa diferencia
 * es el motivo de que el cliente viva en `shared` y no en el frontend: si la
 * prueba hablara el protocolo por su cuenta, demostraría que el servidor
 * sincroniza con *la prueba*, y el navegador podría no sincronizar con nada
 * sin que ninguna prueba se enterase.
 */
class ClienteColaborativo {
  readonly doc = new Y.Doc();
  private provider!: CollabProvider;
  /** Estados por los que ha pasado la conexión, en orden. */
  readonly estados: { estado: EstadoConexion; detalle?: string }[] = [];
  /** Primer fallo del socket subyacente; lleva el código HTTP del rechazo. */
  private fallo: Error | null = null;

  constructor(readonly nombre: string) {}

  /**
   * Fábrica de sockets que además se queda con el error del apretón de manos.
   *
   * El proveedor no distingue un 403 de un corte de red —y hace bien: ante un
   * cierre 1006 lo correcto es reintentar—. Pero las pruebas de autorización
   * necesitan comprobar *qué* rechazo hubo, y esa información solo existe en el
   * evento de error de `ws`. Se captura aquí, fuera del código de producción.
   */
  private fabricaDeSockets(): SocketFactory {
    const cliente = this;
    class SocketVigilado extends WebSocket {
      constructor(url: string) {
        super(url);
        this.on('error', (error: Error) => {
          cliente.fallo ??= error;
        });
      }
    }
    return SocketVigilado as unknown as SocketFactory;
  }

  async conectar(proyectoId: string, token: string): Promise<void> {
    const url = `${baseUrl.replace('http', 'ws')}/colaboracion?proyecto=${proyectoId}&token=${encodeURIComponent(token)}`;

    this.provider = new CollabProvider({
      url,
      doc: this.doc,
      WebSocketImpl: this.fabricaDeSockets(),
      onEstado: (estado, detalle) => {
        this.estados.push({ estado, detalle });
        this.traza.push(`estado=${estado}${detalle ? ` (${detalle})` : ''}`);
      },
      onSincronizado: () => {
        this.traza.push(`sincronizado → ${JSON.stringify(readDiagram(this.doc).name)}`);
      },
    });

    await new Promise<void>((resolve, reject) => {
      const limite = Date.now() + 3000;
      const revisar = setInterval(() => {
        if (this.fallo) {
          clearInterval(revisar);
          // Sin esto el proveedor seguiría reintentando contra un servidor que
          // la prueba está a punto de apagar, y el reintento caería en el
          // siguiente caso de prueba.
          this.provider.destroy();
          reject(this.fallo);
        } else if (this.provider.estado === 'conectado') {
          clearInterval(revisar);
          resolve();
        } else if (Date.now() > limite) {
          clearInterval(revisar);
          this.provider.destroy();
          reject(new Error(`${this.nombre}: tiempo agotado al conectar`));
        }
      }, 10);
    });
  }

  get awareness(): CollabProvider['awareness'] {
    return this.provider.awareness;
  }

  /**
   * Qué le fue pasando al cliente y en qué quedó el documento.
   *
   * Un fallo aquí se manifiesta como un tiempo agotado, que por sí solo no dice
   * nada: no distingue «no llegó» de «llegó y no sirvió». Volcar esto al agotar
   * la espera fue lo que localizó el defecto de los mapas anidados.
   */
  readonly traza: string[] = [];

  /**
   * ¿Ha llegado ya el documento?
   *
   * Se exige lo uno y lo otro. `estaSincronizado` es lo que el proveedor le dirá
   * al indicador de la interfaz, y el nombre del diagrama es lo único que el
   * servidor tiene y el cliente no al conectarse a un proyecto recién creado.
   * Comprobar solo el nombre dejaría sin verificar el aviso que ve el usuario;
   * comprobar solo el aviso no distinguiría «el diagrama llegó» de «el diagrama
   * llegó vacío», que para un contador de clases son el mismo estado.
   */
  get sincronizado(): boolean {
    return this.provider.estaSincronizado && readDiagram(this.doc).name === 'Tienda';
  }

  get clases(): string[] {
    return Object.values(readDiagram(this.doc).classes)
      .map((c) => c.name)
      .sort();
  }

  cerrar(): void {
    this.provider.destroy();
  }
}

/**
 * Espera a que una condición se cumpla.
 *
 * La propagación es asíncrona por definición, así que no hay nada que esperar
 * de forma determinista; un `setTimeout` fijo o bien alarga la prueba o bien la
 * vuelve intermitente en una máquina cargada. Se sondea con un tope.
 */
async function esperarA(condicion: () => boolean, mensaje: string, ms = 3000): Promise<void> {
  const limite = Date.now() + ms;
  while (Date.now() < limite) {
    if (condicion()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  const detalle = abiertos.map((c) => `${c.nombre}: [${c.traza.join(' | ')}]`).join('\n');
  throw new Error(`Tiempo agotado esperando: ${mensaje}\n${detalle}`);
}

/** Deja pasar el tiempo suficiente para afirmar que algo NO llegó. */
async function margen(ms = 250): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function registrar(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/registro')
    .send({ email, password: 'contraseña-larga', nombre: email.split('@')[0] });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

async function crearProyecto(token: string): Promise<string> {
  const response = await request(app)
    .post('/api/proyectos')
    .set('Authorization', `Bearer ${token}`)
    .send({ nombre: 'Tienda', descripcion: '' });
  expect(response.status).toBe(201);
  return response.body.proyecto.id as string;
}

async function invitar(token: string, proyectoId: string, email: string, rol: string): Promise<void> {
  const response = await request(app)
    .post(`/api/proyectos/${proyectoId}/miembros`)
    .set('Authorization', `Bearer ${token}`)
    .send({ email, rol });
  expect(response.status).toBe(201);
}

const abiertos: ClienteColaborativo[] = [];

async function conectar(nombre: string, proyectoId: string, token: string): Promise<ClienteColaborativo> {
  const cliente = new ClienteColaborativo(nombre);
  await cliente.conectar(proyectoId, token);
  abiertos.push(cliente);
  return cliente;
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-collab-'));
  const config = { ...loadConfig({ SESSION_SECRET: 'secreto-de-prueba' }), dataDir };
  deps = await createDependencies(config);
  const built = createApp(deps);
  app = built.app;
  collab = built.collab;

  server = createServer(app);
  collab.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('sin dirección');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const cliente of abiertos.splice(0)) cliente.cerrar();
  await collab.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await deps.rooms.shutdown();
  await rm(dataDir, { recursive: true, force: true });
});

describe('edición simultánea', () => {
  it('lo que escribe uno aparece en la pantalla del otro', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenBeto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'beto@ejemplo.com', 'editor');

    const ana = await conectar('ana', proyectoId, tokenAna);
    const beto = await conectar('beto', proyectoId, tokenBeto);

    // Ambos deben partir del mismo estado inicial que guardó la creación.
    await esperarA(() => ana.sincronizado, 'sincronización inicial de Ana');
    await esperarA(() => beto.sincronizado, 'sincronización inicial de Beto');

    applyOperation(ana.doc, { op: 'addClass', name: 'Cliente', kind: 'class' });

    await esperarA(() => beto.clases.includes('Cliente'), 'Beto ve la clase de Ana');
  });

  it('dos ediciones a la vez no se pisan', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenBeto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'beto@ejemplo.com', 'editor');

    const ana = await conectar('ana', proyectoId, tokenAna);
    const beto = await conectar('beto', proyectoId, tokenBeto);
    await esperarA(() => beto.sincronizado, 'sincronización inicial');

    // Sin await entre medias: es el caso que importa, dos personas tecleando en
    // el mismo instante sin haber visto lo del otro.
    applyOperation(ana.doc, { op: 'addClass', name: 'Cliente', kind: 'class' });
    applyOperation(beto.doc, { op: 'addClass', name: 'Pedido', kind: 'class' });

    await esperarA(() => ana.clases.length === 2, 'Ana recibe la clase de Beto');
    await esperarA(() => beto.clases.length === 2, 'Beto recibe la clase de Ana');

    expect(ana.clases).toEqual(['Cliente', 'Pedido']);
    expect(beto.clases).toEqual(['Cliente', 'Pedido']);
  });

  it('el tercero que llega tarde recibe todo lo anterior', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenBeto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'beto@ejemplo.com', 'editor');

    const ana = await conectar('ana', proyectoId, tokenAna);
    await esperarA(() => ana.sincronizado, 'sincronización inicial');
    applyOperation(ana.doc, { op: 'addClass', name: 'Cliente', kind: 'class' });
    applyOperation(ana.doc, { op: 'addClass', name: 'Pedido', kind: 'class' });

    const beto = await conectar('beto', proyectoId, tokenBeto);
    await esperarA(() => beto.clases.length === 2, 'Beto recibe el historial al conectarse');
    expect(beto.clases).toEqual(['Cliente', 'Pedido']);
  });

  it('un cambio hecho por HTTP llega a quien está conectado', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    const ana = await conectar('ana', proyectoId, token);
    await esperarA(() => ana.sincronizado, 'sincronización inicial');

    // El asistente aplica operaciones por la API, no por el socket. Si esa vía
    // no difundiera, quien tuviera el diagrama abierto no vería aparecer lo que
    // acaba de aceptarle al asistente hasta recargar la página.
    await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operaciones: [{ op: 'addClass', name: 'DesdeLaApi', kind: 'class' }] });

    await esperarA(() => ana.clases.includes('DesdeLaApi'), 'el cambio de la API llega al socket');
  });
});

describe('presencia', () => {
  it('cada uno ve dónde está el otro', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenBeto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'beto@ejemplo.com', 'editor');

    const ana = await conectar('ana', proyectoId, tokenAna);
    const beto = await conectar('beto', proyectoId, tokenBeto);

    ana.awareness.setLocalStateField('usuario', { nombre: 'Ana', color: '#e11' });
    ana.awareness.setLocalStateField('cursor', { x: 120, y: 80 });

    await esperarA(() => {
      const estados = [...beto.awareness.getStates().values()];
      return estados.some((e) => (e as { usuario?: { nombre: string } }).usuario?.nombre === 'Ana');
    }, 'Beto ve a Ana');

    const deAna = [...beto.awareness.getStates().values()].find(
      (e) => (e as { usuario?: { nombre: string } }).usuario?.nombre === 'Ana',
    ) as { cursor?: { x: number; y: number } };
    expect(deAna.cursor).toEqual({ x: 120, y: 80 });
  });

  it('el cursor de quien se va desaparece de la pantalla de los demás', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenBeto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'beto@ejemplo.com', 'editor');

    const ana = await conectar('ana', proyectoId, tokenAna);
    const beto = await conectar('beto', proyectoId, tokenBeto);

    beto.awareness.setLocalStateField('usuario', { nombre: 'Beto', color: '#11e' });
    const veABeto = (): boolean =>
      [...ana.awareness.getStates().values()].some(
        (e) => (e as { usuario?: { nombre: string } }).usuario?.nombre === 'Beto',
      );
    await esperarA(veABeto, 'Ana ve a Beto');

    // Cerrar la pestaña no es cerrar la sesión: no hay ningún mensaje de
    // despedida, solo un socket que muere. Si el servidor no retira la presencia
    // por su cuenta, el cursor de Beto se queda para siempre donde lo dejó y
    // Ana cree que sigue ahí.
    beto.cerrar();
    abiertos.splice(abiertos.indexOf(beto), 1);

    await esperarA(() => !veABeto(), 'la presencia de Beto se retira al desconectarse');
  });

  it('el cursor no entra en el documento, ni en el historial, ni en el disco', async () => {
    /*
      La separación que sostiene el rendimiento de la sala.

      Mover el ratón produce muchísimos más mensajes que editar: el lienzo
      manda una posición cada 50 ms mientras la mano se mueve, y una tarde de
      trabajo son cientos de miles. Si esa riada entrara en el documento CRDT,
      cada movimiento quedaría registrado para siempre, se guardaría en disco,
      viajaría en la sincronización inicial de quien llegara después y engordaría
      el historial de cambios con ruido que no es un cambio. El documento crecería
      con el tiempo que la gente pasa mirándolo, no con lo que contiene.

      Por eso la presencia va por el canal de awareness, que es efímero y no se
      persiste. Es una afirmación sobre algo que NO ocurre, así que se comprueba
      por partida triple —el documento no emite ni una actualización, sus bytes
      no cambian, el fichero no se reescribe— porque cada una fallaría por un
      motivo distinto si la separación se rompiera.

      Se mueve además el cursor del usuario de solo lectura. Es la otra cara de
      RNF-SEG-04: a un lector se le permite publicar presencia precisamente
      porque la presencia no puede alcanzar el documento. Si alguna vez lo
      alcanzara, esta prueba caería a la vez que se abriría un hueco de permisos.
    */
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenLector = await registrar('lector@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'lector@ejemplo.com', 'viewer');

    const ana = await conectar('ana', proyectoId, tokenAna);
    const lector = await conectar('lector', proyectoId, tokenLector);
    await esperarA(() => ana.sincronizado, 'sincronización de Ana');
    await esperarA(() => lector.sincronizado, 'sincronización del lector');

    // Una edición de verdad primero: deja el documento en un estado no trivial y
    // fuerza la primera escritura, para que el «no se ha tocado el fichero» de
    // después compare contra un fichero que existe.
    const sala = await deps.rooms.open(proyectoId);
    applyOperation(ana.doc, { op: 'addClass', name: 'Cliente', kind: 'class' });
    await esperarA(
      () => Object.values(readDiagram(sala.doc).classes).some((c) => c.name === 'Cliente'),
      'el servidor recibe la edición',
    );
    await sala.save();

    const fichero = join(dataDir, 'documentos', `${proyectoId}.bin`);
    const bytesAntes = await readFile(fichero);
    const escrituraAntes = (await stat(fichero)).mtimeMs;
    const estadoAntes = [...Y.encodeStateAsUpdate(sala.doc)];
    const historialAntes = getHistorialArray(sala.doc).length;

    let actualizaciones = 0;
    sala.doc.on('update', () => {
      actualizaciones += 1;
    });

    // Cien posiciones cada uno: unos cinco segundos de mano moviéndose al ritmo
    // que impone el estrangulador del lienzo.
    for (let i = 0; i < 100; i += 1) {
      ana.awareness.setLocalStateField('cursor', { x: i, y: i * 2 });
      lector.awareness.setLocalStateField('cursor', { x: 400 - i, y: i });
    }
    ana.awareness.setLocalStateField('usuario', { id: 'u-ana', nombre: 'Ana' });
    lector.awareness.setLocalStateField('usuario', { id: 'u-lector', nombre: 'Lector' });

    const cursorAjenoEn = (cliente: ClienteColaborativo, quien: string) =>
      ([...cliente.awareness.getStates().values()] as {
        usuario?: { id: string };
        cursor?: { x: number; y: number };
      }[]).find((e) => e.usuario?.id === quien)?.cursor;

    // Que haya llegado el último cursor es lo que da sentido a las negaciones de
    // abajo: sin esto, un canal de presencia averiado las cumpliría todas.
    await esperarA(() => cursorAjenoEn(lector, 'u-ana')?.x === 99, 'el lector ve el cursor de Ana');
    await esperarA(
      () => cursorAjenoEn(ana, 'u-lector')?.x === 301,
      'Ana ve el cursor del usuario de solo lectura',
    );
    await margen();

    // 1. El documento no se ha enterado de nada.
    expect(actualizaciones).toBe(0);
    expect([...Y.encodeStateAsUpdate(sala.doc)]).toEqual(estadoAntes);
    expect(getHistorialArray(sala.doc).length).toBe(historialAntes);

    // 2. Y por tanto no hay nada que guardar: `save()` sale sin escribir porque
    // el documento no quedó sucio. Se comprueba con el fichero y no con la
    // bandera interna, que es un detalle de implementación.
    await sala.save();
    expect((await stat(fichero)).mtimeMs).toBe(escrituraAntes);
    expect([...(await readFile(fichero))]).toEqual([...bytesAntes]);
  });
});

describe('permisos en el canal colaborativo', () => {
  it('quien solo puede leer recibe los cambios pero no puede hacerlos (RNF-SEG-04)', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenLector = await registrar('lector@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'lector@ejemplo.com', 'viewer');

    const ana = await conectar('ana', proyectoId, tokenAna);
    const lector = await conectar('lector', proyectoId, tokenLector);

    await esperarA(() => ana.sincronizado, 'sincronización de Ana');
    applyOperation(ana.doc, { op: 'addClass', name: 'Cliente', kind: 'class' });

    // Lee: recibe lo que hace Ana.
    await esperarA(() => lector.clases.includes('Cliente'), 'el lector recibe los cambios');

    // Escribe: su cambio se queda en su pantalla y no llega a nadie.
    applyOperation(lector.doc, { op: 'addClass', name: 'Intruso', kind: 'class' });
    await margen();

    expect(ana.clases).toEqual(['Cliente']);

    // Y tampoco quedó en el servidor, que es lo que se guardaría en disco.
    const room = await deps.rooms.open(proyectoId);
    const enServidor = Object.values(readDiagram(room.doc).classes).map((c) => c.name);
    expect(enServidor).toEqual(['Cliente']);
  });

  it('el permiso se comprueba en cada mensaje, no solo al conectar', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenBeto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);
    await invitar(tokenAna, proyectoId, 'beto@ejemplo.com', 'editor');

    const ana = await conectar('ana', proyectoId, tokenAna);
    const beto = await conectar('beto', proyectoId, tokenBeto);
    await esperarA(() => beto.sincronizado, 'sincronización inicial');

    applyOperation(beto.doc, { op: 'addClass', name: 'Antes', kind: 'class' });
    await esperarA(() => ana.clases.includes('Antes'), 'Beto podía escribir');

    // Ana lo expulsa mientras Beto tiene el socket abierto.
    const miembros = await request(app)
      .get(`/api/proyectos/${proyectoId}/miembros`)
      .set('Authorization', `Bearer ${tokenAna}`);
    const betoId = (miembros.body.miembros as { usuarioId: string; email: string }[]).find(
      (m) => m.email === 'beto@ejemplo.com',
    )?.usuarioId;
    await request(app)
      .delete(`/api/proyectos/${proyectoId}/miembros/${betoId}`)
      .set('Authorization', `Bearer ${tokenAna}`)
      .expect(204);

    applyOperation(beto.doc, { op: 'addClass', name: 'Despues', kind: 'class' });
    await margen();

    expect(ana.clases).toEqual(['Antes']);
  });

  it('rechaza la conexión de quien no es miembro', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const tokenAjeno = await registrar('ajeno@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);

    await expect(conectar('ajeno', proyectoId, tokenAjeno)).rejects.toThrow(/403/);
  });

  it('rechaza la conexión sin token válido', async () => {
    const tokenAna = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(tokenAna);

    await expect(conectar('anonimo', proyectoId, 'token-inventado')).rejects.toThrow(/401/);
  });

  it('rechaza un identificador de sala con forma de ruta', async () => {
    const token = await registrar('ana@ejemplo.com');
    await crearProyecto(token);

    await expect(conectar('ana', '../../etc/passwd', token)).rejects.toThrow(/400/);
  });
});

describe('persistencia de la sala', () => {
  it('lo editado por el socket sobrevive a que se vayan todos', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const ana = await conectar('ana', proyectoId, token);
    await esperarA(() => ana.sincronizado, 'sincronización inicial');
    applyOperation(ana.doc, { op: 'addClass', name: 'Persistente', kind: 'class' });

    // Se espera a que el servidor lo tenga antes de cerrar: si se cerrara antes,
    // la prueba mediría la velocidad de la red y no la persistencia.
    const room = await deps.rooms.open(proyectoId);
    await esperarA(
      () => Object.values(readDiagram(room.doc).classes).some((c) => c.name === 'Persistente'),
      'el servidor recibe el cambio',
    );

    ana.cerrar();
    abiertos.splice(abiertos.indexOf(ana), 1);
    await deps.rooms.shutdown();

    // Se vuelve a leer desde disco con un gestor de salas nuevo.
    const recargado = await createDependencies({
      ...loadConfig({ SESSION_SECRET: 'secreto-de-prueba' }),
      dataDir,
    });
    try {
      const sala = await recargado.rooms.open(proyectoId);
      const nombres = Object.values(readDiagram(sala.doc).classes).map((c) => c.name);
      expect(nombres).toContain('Persistente');
    } finally {
      await recargado.rooms.shutdown();
    }
  });
});
