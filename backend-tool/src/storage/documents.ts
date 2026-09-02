import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/**
 * Almacén de documentos colaborativos.
 *
 * Existe por la misma razón que `ProjectStore` e `IdentityProvider`, y llegó más
 * tarde que ninguno: `Room` tenía la ruta del fichero cableada, así que era el
 * único de los tres almacenes sin costura por donde sustituir el disco. Mientras
 * siguiera así, desplegar en cualquier sitio con sistema de ficheros efímero
 * —App Runner, ECS, Render— significaba perder los diagramas en cada despliegue,
 * y no había dónde enchufar la alternativa.
 *
 * El documento se guarda como un blob opaco: son los bytes que devuelve
 * `Y.encodeStateAsUpdate`. El almacén no interpreta el contenido y no debe
 * hacerlo, porque la convergencia la garantiza el CRDT y no el servidor.
 */
export interface DocumentStore {
  /** `null` si el documento aún no existe: es un proyecto recién creado, no un error. */
  load(roomId: string): Promise<Uint8Array | null>;
  save(roomId: string, update: Uint8Array): Promise<void>;
  delete(roomId: string): Promise<void>;
  /** Libera conexiones o descriptores. Los almacenes sin estado no hacen nada. */
  close?(): Promise<void>;
}

/**
 * Implementación en disco, la de desarrollo.
 *
 * Escribe a un temporal y renombra. Un `writeFile` directo que se interrumpa
 * deja el documento truncado, y un documento Yjs truncado no se puede aplicar:
 * se perdería el proyecto entero, no el último cambio.
 */
export class FileDocumentStore implements DocumentStore {
  private readonly directory: string;
  private ready: Promise<void> | null = null;

  constructor(dataDir: string) {
    this.directory = join(resolve(dataDir), 'documentos');
  }

  /**
   * El directorio se crea una sola vez y todas las llamadas comparten la misma
   * promesa. Antes se creaba al abrir cada sala, lo que repetía la llamada al
   * sistema en cada apertura sin necesidad.
   */
  private async ensureDirectory(): Promise<void> {
    this.ready ??= mkdir(this.directory, { recursive: true }).then(() => undefined);
    await this.ready;
  }

  private pathFor(roomId: string): string {
    return join(this.directory, `${roomId}.bin`);
  }

  async load(roomId: string): Promise<Uint8Array | null> {
    try {
      const stored = await readFile(this.pathFor(roomId));
      return new Uint8Array(stored);
    } catch (error) {
      // Primer arranque del proyecto: todavía no hay fichero. Lo demás sí es real.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(roomId: string, update: Uint8Array): Promise<void> {
    await this.ensureDirectory();
    const target = this.pathFor(roomId);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, update);
    await rename(temporary, target);
  }

  async delete(roomId: string): Promise<void> {
    await rm(this.pathFor(roomId), { force: true });
  }
}

/**
 * Almacén en memoria, para pruebas.
 *
 * No es un adorno: las pruebas de salas creaban directorios temporales de
 * verdad, y una prueba que toca el disco es una prueba que falla por razones
 * que no tienen que ver con lo que prueba.
 */
export class MemoryDocumentStore implements DocumentStore {
  private readonly documents = new Map<string, Uint8Array>();

  async load(roomId: string): Promise<Uint8Array | null> {
    return this.documents.get(roomId) ?? null;
  }

  async save(roomId: string, update: Uint8Array): Promise<void> {
    this.documents.set(roomId, update);
  }

  async delete(roomId: string): Promise<void> {
    this.documents.delete(roomId);
  }

  get size(): number {
    return this.documents.size;
  }
}
