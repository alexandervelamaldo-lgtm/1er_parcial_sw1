import { createHmac, randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Identidad y sesiones.
 *
 * `IdentityProvider` es una frontera deliberada (Arquitectura §2.9, decisión D8):
 * la autenticación definitiva la aporta Architech Enterprise y su contrato aún
 * no se conoce (pregunta abierta Q2). Todo el resto del backend depende de esta
 * interfaz y de nada más, así que sustituir la implementación local por la real
 * no debería tocar ni rutas ni canal colaborativo.
 *
 * La implementación incluida es de desarrollo. Es correcta —scrypt, comparación
 * en tiempo constante, tokens firmados— pero guarda los usuarios en memoria y no
 * contempla recuperación de contraseña, verificación de correo ni revocación.
 */

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
}

export interface Session {
  token: string;
  user: UserProfile;
  expiresAt: number;
}

export interface IdentityProvider {
  register(email: string, password: string, displayName: string): Promise<UserProfile>;
  authenticate(email: string, password: string): Promise<Session | null>;
  /** Devuelve el usuario si el token es válido y no ha caducado. */
  verify(token: string): Promise<UserProfile | null>;
  findById(id: string): Promise<UserProfile | null>;
  /** Necesario para invitar por correo a un proyecto (RF-COL-02). */
  findByEmail(email: string): Promise<UserProfile | null>;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface StoredUser extends UserProfile {
  salt: string;
  hash: string;
}

const KEY_LENGTH = 64;

/**
 * Las piezas de abajo se exportan para que la implementación contra PostgreSQL
 * use *exactamente* estas y no una copia.
 *
 * Que dos proveedores de identidad deriven la contraseña o firmen el token de
 * formas ligeramente distintas es el tipo de divergencia que no se nota hasta
 * que alguien cambia de almacén y descubre que ningún usuario puede entrar —o,
 * peor, que sí puede alguien que no debería.
 */

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, KEY_LENGTH).toString('hex');
}

/**
 * Compara en tiempo constante. Una comparación con `===` filtra por el tiempo de
 * ejecución cuántos caracteres iniciales coinciden.
 */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Correo en la forma en que se guarda y se busca: sin espacios y en minúsculas. */
export function normalizarCorreo(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Comprueba lo que se exige al registrarse y devuelve el correo normalizado.
 *
 * No mira si el correo ya existe: eso depende del almacén, y cada uno lo
 * resuelve como puede hacerlo bien —el de fichero con un índice en memoria, el
 * de PostgreSQL dejando que falle la restricción de unicidad.
 */
export function validarRegistro(email: string, password: string): string {
  const normalized = normalizarCorreo(email);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new AuthError('El correo no tiene un formato válido', 400, 'EMAIL_INVALIDO');
  }
  if (password.length < 10) {
    throw new AuthError('La contraseña debe tener al menos 10 caracteres', 400, 'PASSWORD_CORTA');
  }
  return normalized;
}

/**
 * Emisión y lectura del token de sesión: `usuario.caducidad.firma`.
 *
 * El token no se consulta en ninguna tabla —es autocontenido y firmado—, así que
 * esta clase es idéntica para cualquier almacén. La contrapartida conocida es
 * que no hay revocación: un token robado vale hasta que caduca.
 */
export class SesionFirmada {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  emitir(user: UserProfile): Session {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const payload = `${user.id}.${expiresAt}`;
    return {
      token: `${payload}.${this.sign(payload)}`,
      user,
      expiresAt: expiresAt * 1000,
    };
  }

  /** Identificador del usuario si la firma es válida y no ha caducado; si no, `null`. */
  leer(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [userId, expiresAt, signature] = parts as [string, string, string];

    if (!safeEquals(signature, this.sign(`${userId}.${expiresAt}`))) return null;
    if (Number.parseInt(expiresAt, 10) * 1000 < Date.now()) return null;
    return userId;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('hex');
  }
}

export class LocalIdentityProvider implements IdentityProvider {
  private readonly users = new Map<string, StoredUser>();
  private readonly byEmail = new Map<string, string>();
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly sesiones: SesionFirmada;

  constructor(
    secret: string,
    ttlSeconds: number,
    /** Fichero de usuarios. Sin él, el proveedor es puramente en memoria. */
    private readonly filePath: string | null = null,
  ) {
    this.sesiones = new SesionFirmada(secret, ttlSeconds);
  }

  /**
   * Carga los usuarios de disco.
   *
   * Sin persistencia, un reinicio dejaría cada proyecto con permisos que
   * apuntan a identificadores de usuario inexistentes: el propietario no podría
   * volver a entrar en su propio proyecto.
   */
  static async open(
    dataDir: string,
    secret: string,
    ttlSeconds: number,
  ): Promise<LocalIdentityProvider> {
    const filePath = join(resolve(dataDir), 'usuarios.json');
    const provider = new LocalIdentityProvider(secret, ttlSeconds, filePath);
    try {
      const raw = await readFile(filePath, 'utf8');
      for (const user of JSON.parse(raw) as StoredUser[]) {
        provider.users.set(user.id, user);
        provider.byEmail.set(user.email, user.id);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return provider;
  }

  private persist(): void {
    const filePath = this.filePath;
    if (!filePath) return;
    const snapshot = [...this.users.values()];
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8');
      })
      .catch((error: unknown) => {
        console.error('No se pudieron persistir los usuarios:', error);
      });
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async register(email: string, password: string, displayName: string): Promise<UserProfile> {
    const normalized = validarRegistro(email, password);

    if (this.byEmail.has(normalized)) {
      throw new AuthError('Ese correo ya está registrado', 409, 'EMAIL_DUPLICADO');
    }

    const salt = randomBytes(16).toString('hex');
    const user: StoredUser = {
      id: randomUUID(),
      email: normalized,
      displayName: displayName.trim() || normalized.split('@')[0] || 'Usuario',
      salt,
      hash: hashPassword(password, salt),
    };

    this.users.set(user.id, user);
    this.byEmail.set(normalized, user.id);
    this.persist();
    return toProfile(user);
  }

  async authenticate(email: string, password: string): Promise<Session | null> {
    const id = this.byEmail.get(normalizarCorreo(email));
    const user = id ? this.users.get(id) : undefined;

    // Se calcula el hash aunque el usuario no exista para que el tiempo de
    // respuesta no revele qué correos están registrados.
    const candidate = hashPassword(password, user?.salt ?? 'sal-inexistente');
    if (!user || !safeEquals(candidate, user.hash)) return null;

    return this.sesiones.emitir(toProfile(user));
  }

  async verify(token: string): Promise<UserProfile | null> {
    const userId = this.sesiones.leer(token);
    if (!userId) return null;
    const user = this.users.get(userId);
    return user ? toProfile(user) : null;
  }

  async findById(id: string): Promise<UserProfile | null> {
    const user = this.users.get(id);
    return user ? toProfile(user) : null;
  }

  async findByEmail(email: string): Promise<UserProfile | null> {
    const id = this.byEmail.get(normalizarCorreo(email));
    return id ? this.findById(id) : null;
  }
}

export function toProfile(user: StoredUser): UserProfile {
  return { id: user.id, email: user.email, displayName: user.displayName };
}
