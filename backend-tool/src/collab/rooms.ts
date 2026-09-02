import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import type { DocumentStore } from '../storage/documents.js';

/**
 * Salas de colaboración.
 *
 * Una sala es un documento Yjs vivo en memoria más su lista de conexiones. El
 * servidor no interpreta el contenido del documento: solo retransmite
 * actualizaciones y las va guardando. Esto es lo que hace que la aplicación
 * funcione igual offline y online (decisión D1): la convergencia la garantiza el
 * CRDT, no el servidor, y el servidor es un participante más que además tiene
 * disco.
 *
 * La persistencia guarda el estado completo, no el registro de operaciones. Yjs
 * comprime el historial al codificar el estado, así que un documento con miles
 * de ediciones ocupa lo que ocupa su contenido, no su historia.
 */

export interface RoomConnection {
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
  readonly userId: string;
  /**
   * No es de solo lectura a propósito: el permiso puede cambiar con el socket
   * abierto y el servidor lo actualiza sin obligar a reconectar.
   */
  canWrite: boolean;
}

export class Room {
  readonly doc = new Y.Doc();
  readonly awareness: Awareness;
  readonly connections = new Set<RoomConnection>();

  private dirty = false;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    private readonly documents: DocumentStore,
    private readonly persistIntervalMs: number,
  ) {
    this.awareness = new Awareness(this.doc);
    // El servidor no es un usuario: no debe aparecer como cursor en el lienzo.
    this.awareness.setLocalState(null);

    this.doc.on('update', () => {
      this.dirty = true;
      this.scheduleSave();
    });
  }

  async load(): Promise<void> {
    const stored = await this.documents.load(this.id);
    if (stored === null) return;
    Y.applyUpdate(this.doc, stored, 'persistencia');
    // `applyUpdate` dispara el evento `update`, que marca el documento como
    // sucio. Cargar no es modificar: sin esto, abrir un proyecto y no tocarlo
    // reescribiría el mismo estado en disco a los dos segundos.
    this.dirty = false;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, this.persistIntervalMs);
    // No debe mantener vivo el proceso: si no queda nada más que hacer, el
    // apagado limpio ya fuerza un guardado final.
    this.saveTimer.unref?.();
  }

  /**
   * Guarda el estado completo, no el registro de operaciones. Cómo se escriba
   * sin corromper el documento es cosa del almacén: en disco es un temporal más
   * un renombrado, y en PostgreSQL un `UPDATE`, que ya es atómico.
   *
   * Los guardados se encadenan en una promesa para que dos no se solapen. Sin
   * eso, el segundo podría terminar antes que el primero y dejar persistido un
   * estado más viejo que el que ya se había escrito.
   */
  async save(): Promise<void> {
    if (!this.dirty) return;
    this.dirty = false;

    const update = Y.encodeStateAsUpdate(this.doc);
    this.saving = this.saving.then(() => this.documents.save(this.id, update));
    await this.saving;
  }

  broadcast(message: Uint8Array, except?: RoomConnection): void {
    for (const connection of this.connections) {
      if (connection === except) continue;
      connection.send(message);
    }
  }

  /**
   * Echa de la sala a quien ya no tiene acceso.
   *
   * Hace falta además de la comprobación por mensaje: quien es expulsado y no
   * vuelve a escribir seguiría recibiendo por el socket todo lo que hagan los
   * demás, y perder el acceso a un proyecto tiene que significar dejar de verlo.
   */
  disconnectUser(userId: string, reason: string): void {
    for (const connection of [...this.connections]) {
      if (connection.userId !== userId) continue;
      this.connections.delete(connection);
      connection.close(1008, reason);
    }
  }

  get isEmpty(): boolean {
    return this.connections.size === 0;
  }

  async destroy(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
    this.awareness.destroy();
    this.doc.destroy();
  }

  /** Libera la sala sin guardar. Solo tiene sentido si el fichero va a borrarse. */
  abandon(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.dirty = false;
    this.awareness.destroy();
    this.doc.destroy();
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly opening = new Map<string, Promise<Room>>();

  constructor(
    private readonly documents: DocumentStore,
    private readonly persistIntervalMs: number,
  ) {}

  /**
   * Abre la sala, cargándola de disco la primera vez.
   *
   * Las aperturas concurrentes comparten la misma promesa. Sin esto, dos
   * clientes que entran a la vez crearían dos documentos distintos y el segundo
   * sobrescribiría al primero.
   */
  async open(roomId: string): Promise<Room> {
    const existing = this.rooms.get(roomId);
    if (existing) return existing;

    const inFlight = this.opening.get(roomId);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const room = new Room(roomId, this.documents, this.persistIntervalMs);
      await room.load();
      this.rooms.set(roomId, room);
      this.opening.delete(roomId);
      return room;
    })();

    this.opening.set(roomId, promise);
    return promise;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Cierra la sala si ya no queda nadie. Mantener documentos vacíos en memoria
   * es una fuga lenta: un servidor con meses de uso acabaría reteniendo todos
   * los proyectos que alguien abrió alguna vez.
   */
  async closeIfEmpty(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    if (!room || !room.isEmpty) return;
    this.rooms.delete(roomId);
    await room.destroy();
  }

  /**
   * Descarta la sala y su fichero. Se usa al borrar un proyecto.
   *
   * Expulsa a quien siga conectado y evita el guardado final: guardar un
   * documento que se acaba de borrar volvería a crear el fichero justo después
   * de eliminarlo.
   */
  async discard(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId);
    this.rooms.delete(roomId);
    if (room) {
      for (const connection of room.connections) {
        connection.close(1001, 'El proyecto ha sido eliminado');
      }
      room.connections.clear();
      room.abandon();
    }
    await this.documents.delete(roomId);
  }

  /**
   * Corta las conexiones de un usuario en un proyecto, si la sala está abierta.
   *
   * No abre la sala si no lo estaba: sin sala abierta no hay a quien echar, y
   * cargar el documento para comprobarlo sería trabajo inútil en el caso normal,
   * que es expulsar a alguien que no está conectado.
   */
  evictUser(roomId: string, userId: string, reason: string): void {
    this.rooms.get(roomId)?.disconnectUser(userId, reason);
  }

  async shutdown(): Promise<void> {
    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    await Promise.all(rooms.map((room) => room.destroy()));
    // El almacén se cierra al final y no antes: `destroy()` fuerza el guardado
    // pendiente de cada sala, y cerrar el pool de PostgreSQL primero perdería
    // exactamente el trabajo que el apagado ordenado existe para salvar.
    await this.documents.close?.();
  }

  get openRoomIds(): string[] {
    return [...this.rooms.keys()];
  }
}

/**
 * Identificador de sala a partir del proyecto.
 *
 * Se separa de la ruta en disco a propósito: el identificador viene del cliente
 * y se valida antes de tocar el sistema de ficheros.
 */
export function roomIdForProject(projectId: string): string {
  return projectId;
}

/** Solo UUID: cualquier otra cosa no llega al nombre de un fichero. */
export function isValidRoomId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
