import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { FileDocumentStore, MemoryDocumentStore, type DocumentStore } from './documents.js';
import { Room, RoomManager } from '../collab/rooms.js';

/**
 * Pruebas del almacén de documentos colaborativos.
 *
 * Existe porque `Room` tenía las rutas de fichero cableadas y era el único de
 * los tres almacenes sin costura por donde sustituir el disco. Mientras siguiera
 * así, cualquier despliegue con sistema de ficheros efímero perdía los diagramas
 * en cada arranque y no había dónde enchufar la alternativa.
 */

const ID = '00000000-0000-4000-8000-000000000001';

/** Documento Yjs con una clase dentro, para tener bytes de verdad que guardar. */
function documentoConTexto(texto: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('clases').set('c1', texto);
  return Y.encodeStateAsUpdate(doc);
}

function leerTexto(update: Uint8Array): unknown {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc.getMap('clases').get('c1');
}

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-docs-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe.each<[string, () => DocumentStore]>([
  ['en fichero', () => new FileDocumentStore(dataDir)],
  ['en memoria', () => new MemoryDocumentStore()],
])('almacén de documentos %s', (_nombre, crear) => {
  it('devuelve null cuando el documento aún no existe', async () => {
    // Un proyecto recién creado no tiene documento. Distinguir «no existe» de un
    // fallo real es lo que evita que la sala trate un error de disco como si
    // fuera un proyecto vacío y lo sobrescriba.
    expect(await crear().load(ID)).toBeNull();
  });

  it('devuelve lo que guardó', async () => {
    const store = crear();
    await store.save(ID, documentoConTexto('Cliente'));
    const leido = await store.load(ID);
    expect(leido).not.toBeNull();
    expect(leerTexto(leido as Uint8Array)).toBe('Cliente');
  });

  it('sobrescribe el estado anterior en lugar de acumularlo', async () => {
    const store = crear();
    await store.save(ID, documentoConTexto('Primero'));
    await store.save(ID, documentoConTexto('Segundo'));
    expect(leerTexto((await store.load(ID)) as Uint8Array)).toBe('Segundo');
  });

  it('tras borrar, vuelve a comportarse como si nunca hubiera existido', async () => {
    const store = crear();
    await store.save(ID, documentoConTexto('Cliente'));
    await store.delete(ID);
    expect(await store.load(ID)).toBeNull();
  });

  it('borrar algo que no existe no es un error', async () => {
    // Se borra el documento al eliminar el proyecto, y un proyecto que nadie
    // llegó a abrir no tiene documento. Si esto lanzara, borrar ese proyecto
    // fallaría por no tener nada que borrar.
    await expect(crear().delete(ID)).resolves.toBeUndefined();
  });

  it('mantiene separados los documentos de proyectos distintos', async () => {
    const store = crear();
    const otro = '00000000-0000-4000-8000-000000000002';
    await store.save(ID, documentoConTexto('Uno'));
    await store.save(otro, documentoConTexto('Dos'));
    expect(leerTexto((await store.load(ID)) as Uint8Array)).toBe('Uno');
    expect(leerTexto((await store.load(otro)) as Uint8Array)).toBe('Dos');
  });
});

describe('almacén en fichero', () => {
  it('no deja el fichero temporal del guardado atómico', async () => {
    // Se escribe a `.tmp` y se renombra para que una interrupción no deje el
    // documento truncado. Si el temporal sobreviviera, el directorio acabaría
    // con un fichero basura por documento.
    const store = new FileDocumentStore(dataDir);
    await store.save(ID, documentoConTexto('Cliente'));
    const { readdir } = await import('node:fs/promises');
    const ficheros = await readdir(join(dataDir, 'documentos'));
    expect(ficheros).toEqual([`${ID}.bin`]);
  });

  it('propaga un fichero ilegible en vez de fingir que no existe', async () => {
    // Un documento corrupto tiene que dar la cara. Tratarlo como «todavía no
    // existe» empezaría un proyecto en blanco y el primer guardado se llevaría
    // por delante lo que hubiera.
    const store = new FileDocumentStore(dataDir);
    await store.save(ID, documentoConTexto('Cliente'));
    await writeFile(join(dataDir, 'documentos', `${ID}.bin`), 'esto no es un documento Yjs');

    const leido = await store.load(ID);
    expect(leido).not.toBeNull();
    // El almacén devuelve los bytes tal cual; quien falla al interpretarlos es
    // Yjs, y ahí el error dice qué pasa en lugar de perderse.
    expect(() => Y.applyUpdate(new Y.Doc(), leido as Uint8Array)).toThrow();
  });
});

describe('las salas usan el almacén', () => {
  it('el documento sobrevive a reabrir la sala con un gestor nuevo', async () => {
    // Es la prueba que justifica todo el refactor: el mismo almacén detrás de
    // dos gestores distintos conserva el trabajo.
    const store = new MemoryDocumentStore();

    const primero = new RoomManager(store, 5);
    const sala = await primero.open(ID);
    sala.doc.getMap('clases').set('c1', 'Persistente');
    await primero.shutdown();

    const segundo = new RoomManager(store, 5);
    try {
      const recuperada = await segundo.open(ID);
      expect(recuperada.doc.getMap('clases').get('c1')).toBe('Persistente');
    } finally {
      await segundo.shutdown();
    }
  });

  it('cargar un documento no lo marca como sucio', async () => {
    // `applyUpdate` dispara el evento `update`. Si cargar contase como
    // modificar, abrir un proyecto y no tocarlo reescribiría el mismo estado.
    const store = new MemoryDocumentStore();
    await store.save(ID, documentoConTexto('Cliente'));

    const sala = new Room(ID, store, 5);
    await sala.load();

    let guardados = 0;
    const original = store.save.bind(store);
    store.save = async (id, update) => {
      guardados += 1;
      await original(id, update);
    };

    await sala.save();
    expect(guardados).toBe(0);
  });

  it('borrar el proyecto borra su documento del almacén', async () => {
    const store = new MemoryDocumentStore();
    const manager = new RoomManager(store, 5);
    const sala = await manager.open(ID);
    sala.doc.getMap('clases').set('c1', 'Efímero');
    await sala.save();
    expect(store.size).toBe(1);

    await manager.discard(ID);
    expect(store.size).toBe(0);
    await manager.shutdown();
  });

  it('el apagado cierra el almacén después de guardar, no antes', async () => {
    // El orden importa: cerrar el pool de PostgreSQL antes del volcado final
    // perdería exactamente el trabajo que el apagado ordenado existe para salvar.
    const orden: string[] = [];
    const store = new MemoryDocumentStore() as MemoryDocumentStore & DocumentStore;
    const guardar = store.save.bind(store);
    store.save = async (id, update) => {
      orden.push('guardar');
      await guardar(id, update);
    };
    store.close = async () => {
      orden.push('cerrar');
    };

    const manager = new RoomManager(store, 5);
    const sala = await manager.open(ID);
    sala.doc.getMap('clases').set('c1', 'Cliente');
    await manager.shutdown();

    expect(orden).toEqual(['guardar', 'cerrar']);
  });
});
