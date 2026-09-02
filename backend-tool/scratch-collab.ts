import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import WebSocket from 'ws';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { readDiagram } from '@app/shared';
import { loadConfig } from './src/config.js';
import { createApp, createDependencies } from './src/app.js';

const dataDir = await mkdtemp(join(tmpdir(), 'scratch-'));
const deps = await createDependencies({ ...loadConfig({ SESSION_SECRET: 'x' }), dataDir });
const { app, collab } = createApp(deps);
const server = createServer(app);
collab.attach(server);
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

async function registrar(email: string): Promise<string> {
  const r = await request(app)
    .post('/api/auth/registro')
    .send({ email, password: 'contraseña-larga', nombre: email });
  return r.body.token;
}

const tokenAna = await registrar('ana@e.com');
const tokenBeto = await registrar('beto@e.com');
const proy = await request(app)
  .post('/api/proyectos')
  .set('Authorization', `Bearer ${tokenAna}`)
  .send({ nombre: 'Tienda', descripcion: '' });
const proyectoId = proy.body.proyecto.id;
const inv = await request(app)
  .post(`/api/proyectos/${proyectoId}/miembros`)
  .set('Authorization', `Bearer ${tokenAna}`)
  .send({ email: 'beto@e.com', rol: 'editor' });
console.log('invitación', inv.status);

function conectar(nombre: string, token: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const ws = new WebSocket(
    `ws://127.0.0.1:${port}/colaboracion?proyecto=${proyectoId}&token=${encodeURIComponent(token)}`,
  );
  ws.on('error', (e) => console.log(nombre, 'ERROR', e.message));
  ws.on('close', (c, r) => console.log(nombre, 'CLOSE', c, r.toString()));
  ws.on('message', (data: Buffer) => {
    const bytes = new Uint8Array(data);
    const decoder = decoding.createDecoder(bytes);
    const tipo = decoding.readVarUint(decoder);
    if (tipo !== 0) {
      console.log(nombre, '<- presencia', bytes.length);
      return;
    }
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    const sub = syncProtocol.readSyncMessage(decoder, enc, doc, 'remoto');
    console.log(
      nombre,
      `<- sync sub=${sub} ${bytes.length}B -> resp ${encoding.length(enc)}B | nombre=${JSON.stringify(readDiagram(doc).name)}`,
    );
    if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
  });

  return new Promise((resolve) => {
    ws.once('open', () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, doc);
      console.log(nombre, '-> paso1', encoding.length(enc), 'B');
      ws.send(encoding.toUint8Array(enc));
      resolve(doc);
    });
  });
}

const anaDoc = await conectar('ana ', tokenAna);
const betoDoc = await conectar('beto', tokenBeto);

await new Promise((r) => setTimeout(r, 1000));
console.log('ANA :', JSON.stringify(readDiagram(anaDoc).name));
console.log('BETO:', JSON.stringify(readDiagram(betoDoc).name));
process.exit(0);
