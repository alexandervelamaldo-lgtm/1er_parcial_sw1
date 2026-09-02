import { randomBytes, randomUUID } from 'node:crypto';
import {
  AuthError,
  SesionFirmada,
  hashPassword,
  normalizarCorreo,
  safeEquals,
  toProfile,
  validarRegistro,
  type IdentityProvider,
  type Session,
  type StoredUser,
  type UserProfile,
} from '../auth/identity.js';
import type { Membership, Project, ProjectStore, Role } from './store.js';
import type { DocumentStore } from './documents.js';
import {
  aIso,
  enTransaccion,
  esViolacionDeUnicidad,
  type PoolPostgres,
} from './postgres.js';

/**
 * Las tres implementaciones contra PostgreSQL.
 *
 * Cumplen las mismas interfaces que las de fichero y no añaden ni un método:
 * si algo de aquí necesitara ampliar el contrato, sería señal de que la
 * interfaz se escribió mirando la implementación de fichero en lugar de
 * mirando lo que el servicio necesita.
 *
 * Las consultas van siempre parametrizadas (`$1`, `$2`). Ninguna cadena que
 * venga del usuario se concatena en el SQL, ni siquiera las que ya pasaron por
 * validación: el nombre de un proyecto lo escribe una persona, y RNF-SEG-06 dice
 * que eso es entrada no confiable en todo el recorrido, no solo en el primer
 * tramo.
 */

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------

interface FilaProyecto {
  id: string;
  nombre: string;
  descripcion: string;
  propietario_id: string;
  creado_en: Date | string;
  actualizado_en: Date | string;
}

function aProyecto(fila: FilaProyecto): Project {
  return {
    id: fila.id,
    name: fila.nombre,
    description: fila.descripcion,
    ownerId: fila.propietario_id,
    createdAt: aIso(fila.creado_en),
    updatedAt: aIso(fila.actualizado_en),
  };
}

const COLUMNAS_PROYECTO = 'id, nombre, descripcion, propietario_id, creado_en, actualizado_en';

export class PostgresProjectStore implements ProjectStore {
  constructor(private readonly pool: PoolPostgres) {}

  async createProject(input: {
    name: string;
    description: string;
    ownerId: string;
  }): Promise<Project> {
    // Las dos inserciones van juntas o no van. Un proyecto sin la pertenencia de
    // su propietario es un proyecto al que nadie puede entrar y que nadie puede
    // borrar: queda ocupando sitio y sin dueño que lo reclame.
    return enTransaccion(this.pool, async (cliente) => {
      const { rows } = await cliente.query<FilaProyecto>(
        `insert into proyectos (id, nombre, descripcion, propietario_id)
         values ($1, $2, $3, $4)
         returning ${COLUMNAS_PROYECTO}`,
        [randomUUID(), input.name, input.description, input.ownerId],
      );
      const fila = rows[0];
      if (!fila) throw new Error('La inserción del proyecto no devolvió ninguna fila');

      await cliente.query(
        `insert into miembros (proyecto_id, usuario_id, rol) values ($1, $2, 'owner')`,
        [fila.id, input.ownerId],
      );
      return aProyecto(fila);
    });
  }

  async getProject(id: string): Promise<Project | null> {
    const { rows } = await this.pool.query<FilaProyecto>(
      `select ${COLUMNAS_PROYECTO} from proyectos where id = $1`,
      [id],
    );
    const fila = rows[0];
    return fila ? aProyecto(fila) : null;
  }

  async listProjectsForUser(userId: string): Promise<(Project & { role: Role })[]> {
    const { rows } = await this.pool.query<FilaProyecto & { rol: Role }>(
      `select p.id, p.nombre, p.descripcion, p.propietario_id, p.creado_en,
              p.actualizado_en, m.rol
         from proyectos p
         join miembros m on m.proyecto_id = p.id
        where m.usuario_id = $1
        order by p.actualizado_en desc`,
      [userId],
    );
    return rows.map((fila) => ({ ...aProyecto(fila), role: fila.rol }));
  }

  async renameProject(id: string, name: string, description: string): Promise<Project | null> {
    const { rows } = await this.pool.query<FilaProyecto>(
      `update proyectos
          set nombre = $2, descripcion = $3, actualizado_en = now()
        where id = $1
      returning ${COLUMNAS_PROYECTO}`,
      [id, name, description],
    );
    const fila = rows[0];
    return fila ? aProyecto(fila) : null;
  }

  async deleteProject(id: string): Promise<boolean> {
    // Las pertenencias caen por la cascada de la tabla. El documento
    // colaborativo no: lo borra `RoomManager.discard()`, porque el almacén de
    // documentos puede no estar en esta misma base de datos.
    const { rows } = await this.pool.query<{ id: string }>(
      'delete from proyectos where id = $1 returning id',
      [id],
    );
    return rows.length > 0;
  }

  async addMember(projectId: string, userId: string, role: Role): Promise<Membership> {
    // Invitar a quien ya está no es un error: es cambiarle el permiso, que es lo
    // que la interfaz espera y lo que hace la implementación de fichero.
    await this.pool.query(
      `insert into miembros (proyecto_id, usuario_id, rol) values ($1, $2, $3)
       on conflict (proyecto_id, usuario_id) do update set rol = excluded.rol`,
      [projectId, userId, role],
    );
    return { projectId, userId, role };
  }

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ usuario_id: string }>(
      'delete from miembros where proyecto_id = $1 and usuario_id = $2 returning usuario_id',
      [projectId, userId],
    );
    return rows.length > 0;
  }

  async listMembers(projectId: string): Promise<Membership[]> {
    const { rows } = await this.pool.query<{ usuario_id: string; rol: Role }>(
      'select usuario_id, rol from miembros where proyecto_id = $1',
      [projectId],
    );
    return rows.map((fila) => ({ projectId, userId: fila.usuario_id, role: fila.rol }));
  }

  async roleOf(projectId: string, userId: string): Promise<Role | null> {
    const { rows } = await this.pool.query<{ rol: Role }>(
      'select rol from miembros where proyecto_id = $1 and usuario_id = $2',
      [projectId, userId],
    );
    return rows[0]?.rol ?? null;
  }
}

// ---------------------------------------------------------------------------
// Identidad
// ---------------------------------------------------------------------------

interface FilaUsuario {
  id: string;
  correo: string;
  nombre: string;
  sal: string;
  hash: string;
}

function aUsuario(fila: FilaUsuario): StoredUser {
  return {
    id: fila.id,
    email: fila.correo,
    displayName: fila.nombre,
    salt: fila.sal,
    hash: fila.hash,
  };
}

/**
 * Usuarios en PostgreSQL.
 *
 * La derivación de la contraseña, la comparación en tiempo constante y la firma
 * del token son las mismas funciones que usa la implementación local, importadas
 * y no copiadas. Es la única forma de que cambiar de almacén no cambie, de
 * paso, las propiedades de seguridad.
 */
export class PostgresIdentityProvider implements IdentityProvider {
  private readonly sesiones: SesionFirmada;

  constructor(
    private readonly pool: PoolPostgres,
    secret: string,
    ttlSeconds: number,
  ) {
    this.sesiones = new SesionFirmada(secret, ttlSeconds);
  }

  async register(email: string, password: string, displayName: string): Promise<UserProfile> {
    const normalized = validarRegistro(email, password);
    const sal = randomBytes(16).toString('hex');

    try {
      const { rows } = await this.pool.query<FilaUsuario>(
        `insert into usuarios (id, correo, nombre, sal, hash)
         values ($1, $2, $3, $4, $5)
         returning id, correo, nombre, sal, hash`,
        [
          randomUUID(),
          normalized,
          displayName.trim() || normalized.split('@')[0] || 'Usuario',
          sal,
          hashPassword(password, sal),
        ],
      );
      const fila = rows[0];
      if (!fila) throw new Error('La inserción del usuario no devolvió ninguna fila');
      return toProfile(aUsuario(fila));
    } catch (error) {
      // No se consulta antes si el correo existe: entre la consulta y la
      // inserción caben dos registros simultáneos con el mismo correo. La
      // restricción de unicidad de la tabla no tiene esa ventana.
      if (esViolacionDeUnicidad(error)) {
        throw new AuthError('Ese correo ya está registrado', 409, 'EMAIL_DUPLICADO');
      }
      throw error;
    }
  }

  async authenticate(email: string, password: string): Promise<Session | null> {
    const usuario = await this.buscar('correo', normalizarCorreo(email));

    // El hash se calcula también cuando el usuario no existe: si se saliera
    // antes, la diferencia de tiempo entre un correo registrado y uno que no lo
    // está permitiría averiguar quién tiene cuenta.
    const candidato = hashPassword(password, usuario?.salt ?? 'sal-inexistente');
    if (!usuario || !safeEquals(candidato, usuario.hash)) return null;

    return this.sesiones.emitir(toProfile(usuario));
  }

  async verify(token: string): Promise<UserProfile | null> {
    const userId = this.sesiones.leer(token);
    if (!userId) return null;
    return this.findById(userId);
  }

  async findById(id: string): Promise<UserProfile | null> {
    // El identificador llega de dentro del token ya verificado, pero sigue
    // siendo texto: si no es un UUID, PostgreSQL rechaza la comparación con un
    // error de tipo en lugar de devolver «no encontrado». Se distingue aquí.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const usuario = await this.buscar('id', id);
    return usuario ? toProfile(usuario) : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const usuario = await this.buscar('correo', normalizarCorreo(email));
    return usuario ? toProfile(usuario) : null;
  }

  /**
   * El nombre de columna es literal en las dos llamadas de este fichero y nunca
   * viene de fuera; el valor sí, y por eso va parametrizado.
   */
  private async buscar(columna: 'id' | 'correo', valor: string): Promise<StoredUser | null> {
    const { rows } = await this.pool.query<FilaUsuario>(
      `select id, correo, nombre, sal, hash from usuarios where ${columna} = $1`,
      [valor],
    );
    const fila = rows[0];
    return fila ? aUsuario(fila) : null;
  }
}

// ---------------------------------------------------------------------------
// Documentos colaborativos
// ---------------------------------------------------------------------------

/**
 * El documento Yjs como un `bytea`.
 *
 * Se guarda el estado entero en cada volcado, no incrementos. Es más escritura,
 * pero deja una única fila que siempre se puede aplicar; con incrementos habría
 * que leerlos todos en orden y un hueco los invalidaría a partir de ahí. Con un
 * volcado cada dos segundos y diagramas de kilobytes, la diferencia no se nota.
 */
export class PostgresDocumentStore implements DocumentStore {
  constructor(
    private readonly pool: PoolPostgres,
    /**
     * Si este almacén es el dueño del pool compartido.
     *
     * `RoomManager.shutdown()` es el último paso del apagado del servicio
     * (`main.ts`), después de vaciar la cola de guardado, así que es el momento
     * correcto para cerrar el pool. Cerrarlo antes perdería exactamente el
     * trabajo que el apagado ordenado existe para salvar.
     */
    private readonly cierraElPool = true,
  ) {}

  async load(roomId: string): Promise<Uint8Array | null> {
    const { rows } = await this.pool.query<{ estado: Buffer }>(
      'select estado from documentos where sala_id = $1',
      [roomId],
    );
    const fila = rows[0];
    return fila ? new Uint8Array(fila.estado) : null;
  }

  async save(roomId: string, update: Uint8Array): Promise<void> {
    // `Buffer.from` sobre un `Uint8Array` copia: el documento se sigue editando
    // mientras esta consulta viaja, y compartir la memoria significaría mandar
    // un estado a medio reescribir.
    await this.pool.query(
      `insert into documentos (sala_id, estado, actualizado_en) values ($1, $2, now())
       on conflict (sala_id) do update
         set estado = excluded.estado, actualizado_en = now()`,
      [roomId, Buffer.from(update)],
    );
  }

  async delete(roomId: string): Promise<void> {
    await this.pool.query('delete from documentos where sala_id = $1', [roomId]);
  }

  async close(): Promise<void> {
    if (this.cierraElPool) await this.pool.end();
  }
}
