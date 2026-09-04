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
 * contempla verificación de correo.
 *
 * ## Recuperar la contraseña sin servidor de correo
 *
 * Lo normal sería mandar un enlace por correo. Aquí no se puede: el proyecto no
 * tiene ninguna dependencia de envío, y la defensa se hace en localhost, donde
 * un SMTP exigiría credenciales que nadie va a tener a mano. Un flujo que
 * depende del correo sería un flujo que en la demostración no funciona.
 *
 * Así que se usa el otro patrón conocido, el de los códigos de recuperación de
 * GitHub o Bitwarden: al registrarse se entrega un código de un solo uso, y para
 * recuperar la cuenta hacen falta el correo y ese código. Del código se guarda
 * solo el hash, derivado igual que la contraseña. Tiene una propiedad que el
 * enlace por correo no tiene: funciona sin red, que es justo la postura del
 * resto del sistema. Y una debilidad clara: quien pierda el código pierde la
 * cuenta, y por eso existe además la escotilla de operador (`restablecer.ts`).
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

  /**
   * Genera un código de recuperación nuevo y lo devuelve **en claro una sola
   * vez**: de ahí en adelante solo queda su hash, igual que con la contraseña.
   *
   * Invalida el anterior. Que sea uno solo y no una lista es deliberado: una
   * lista de diez códigos es diez veces más superficie para el mismo problema,
   * y aquí no hay un segundo factor que proteger, solo una contraseña.
   */
  emitirCodigoRecuperacion(userId: string): Promise<string>;

  /**
   * Cambia la contraseña si el código es el que toca, y consume el código.
   *
   * Devuelve una sesión —no un booleano— porque quien acaba de demostrar que
   * tiene el código ya ha demostrado lo mismo que demuestra quien acierta la
   * contraseña. Obligarle a escribirla otra vez en la pantalla siguiente no
   * añade seguridad; en el móvil, además, es donde más gente se equivoca.
   *
   * `null` cubre a la vez «ese correo no existe» y «el código no es ese». La
   * ruta no puede distinguirlos ni queriendo, que es exactamente el punto.
   */
  restablecerConCodigo(
    email: string,
    codigo: string,
    passwordNueva: string,
  ): Promise<Session | null>;
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
  /**
   * Sal y hash del código de recuperación vigente, si lo hay.
   *
   * Opcionales porque los usuarios registrados antes de que esto existiera no
   * los tienen, y porque un código consumido se borra en lugar de marcarse:
   * «no queda ninguno» y «queda uno ya usado» son el mismo estado para todo el
   * que pregunte, y guardar el segundo solo daría algo que robar.
   */
  recoverySalt?: string;
  recoveryHash?: string;
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
 * Alfabeto del código de recuperación.
 *
 * Faltan la I, la L, la O, la U, el 0 y el 1. Este código se copia a mano desde
 * un papel o desde una captura de pantalla, muchas veces en un teléfono, y las
 * parejas 0/O y 1/I/L son el motivo habitual de que un código correcto se
 * escriba mal. La U se quita por otra razón: sin ella no se pueden formar
 * palabrotas por accidente, que es un detalle tonto hasta que sale en la
 * proyección de una defensa.
 */
const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const LARGO_CODIGO = 20;
const GRUPO_CODIGO = 5;

/**
 * Un código nuevo, en grupos de cinco separados por guiones.
 *
 * Veinte caracteres sobre un alfabeto de treinta son algo menos de 98 bits: muy
 * por encima de lo que se puede adivinar a fuerza bruta contra un servidor, que
 * es el único sitio donde se puede probar.
 */
export function generarCodigoRecuperacion(): string {
  let codigo = '';
  while (codigo.length < LARGO_CODIGO) {
    // Rechazo de los bytes de la cola en lugar de `% 30` a secas: 256 no es
    // múltiplo de 30, así que el resto directo haría los dieciséis primeros
    // símbolos del alfabeto más probables que los catorce últimos. Es un sesgo
    // pequeño, pero es gratis no tenerlo.
    for (const byte of randomBytes(LARGO_CODIGO)) {
      if (byte >= 240) continue;
      codigo += ALFABETO_CODIGO[byte % ALFABETO_CODIGO.length];
      if (codigo.length === LARGO_CODIGO) break;
    }
  }

  const grupos: string[] = [];
  for (let i = 0; i < codigo.length; i += GRUPO_CODIGO) {
    grupos.push(codigo.slice(i, i + GRUPO_CODIGO));
  }
  return grupos.join('-');
}

/**
 * El código tal y como se compara: en mayúsculas y sin nada que no sea del
 * alfabeto.
 *
 * Se tira lo demás en vez de rechazarlo porque lo demás son los guiones que el
 * propio sistema puso, más los espacios que deja el pegar desde otro sitio y la
 * mayúscula que el teclado del móvil añade sola. Ninguna de esas tres cosas es
 * un código equivocado.
 */
export function normalizarCodigo(codigo: string): string {
  return [...codigo.toUpperCase()].filter((c) => ALFABETO_CODIGO.includes(c)).join('');
}

/**
 * La huella de la credencial actual que va dentro de la firma del token.
 *
 * De aquí sale la revocación: como el hash de la contraseña entra en el cálculo
 * de la firma, cambiar la contraseña cambia la huella y **todos los tokens
 * emitidos antes dejan de validar**, sin necesidad de una tabla de sesiones ni
 * de una lista negra. Es el mismo mecanismo que Django llama
 * `get_session_auth_hash`.
 *
 * El hash no viaja: solo entra en el HMAC, cuya salida no permite recuperarlo.
 */
export function marcaDeCredencial(user: StoredUser): string {
  return user.hash.slice(0, 32);
}

/**
 * Emisión y lectura del token de sesión: `usuario.caducidad.firma`.
 *
 * El token sigue siendo autocontenido —no hay tabla de sesiones—, pero la firma
 * se calcula sobre la huella de la contraseña además de sobre el identificador y
 * la caducidad. Eso da la única revocación que hacía falta: la de restablecer la
 * contraseña porque alguien más ha entrado. Sin ella, cambiar la contraseña
 * cambiaría la cerradura dejando dentro al que ya estaba.
 *
 * Lo que sigue sin poder hacerse es cerrar una sesión concreta o echar a alguien
 * sin tocar su contraseña; para eso sí haría falta un registro de tokens.
 */
export class SesionFirmada {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  emitir(user: UserProfile, marca: string): Session {
    const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    const payload = `${user.id}.${expiresAt}`;
    return {
      token: `${payload}.${this.sign(`${payload}.${marca}`)}`,
      user,
      expiresAt: expiresAt * 1000,
    };
  }

  /**
   * Identificador del usuario si el token no ha caducado y la firma cuadra con
   * la huella **actual** de su credencial; si no, `null`.
   *
   * La huella se pide con una función porque cada almacén la busca a su manera y
   * uno de los dos tiene que ir a la base de datos.
   */
  async leer(
    token: string,
    marcaDe: (userId: string) => Promise<string | null>,
  ): Promise<string | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [userId, expiresAt, signature] = parts as [string, string, string];

    // La caducidad se mira antes de ir al almacén. Es dato sin verificar todavía,
    // y por eso solo sirve para rechazar antes —adelantar un rechazo nunca
    // convierte un token falso en válido—, pero evita que cualquiera pueda
    // provocar una consulta a la base mandando basura.
    if (!/^\d+$/.test(expiresAt)) return null;
    if (Number.parseInt(expiresAt, 10) * 1000 < Date.now()) return null;

    const marca = await marcaDe(userId);
    if (marca === null) return null;
    if (!safeEquals(signature, this.sign(`${userId}.${expiresAt}.${marca}`))) return null;
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

    return this.sesiones.emitir(toProfile(user), marcaDeCredencial(user));
  }

  async verify(token: string): Promise<UserProfile | null> {
    const userId = await this.sesiones.leer(token, async (id) => {
      const encontrado = this.users.get(id);
      return encontrado ? marcaDeCredencial(encontrado) : null;
    });
    if (!userId) return null;
    const user = this.users.get(userId);
    return user ? toProfile(user) : null;
  }

  async emitirCodigoRecuperacion(userId: string): Promise<string> {
    const user = this.users.get(userId);
    if (!user) throw new AuthError('Ese usuario no existe', 404, 'USUARIO_DESCONOCIDO');

    const codigo = generarCodigoRecuperacion();
    user.recoverySalt = randomBytes(16).toString('hex');
    user.recoveryHash = hashPassword(normalizarCodigo(codigo), user.recoverySalt);
    this.persist();
    return codigo;
  }

  async restablecerConCodigo(
    email: string,
    codigo: string,
    passwordNueva: string,
  ): Promise<Session | null> {
    // La contraseña se valida antes de mirar el código, y con la misma función
    // que usa el registro: si la regla viviera en dos sitios, dentro de un mes
    // uno de los dos aceptaría lo que el otro rechaza.
    const normalized = validarRegistro(email, passwordNueva);

    const id = this.byEmail.get(normalized);
    const user = id ? this.users.get(id) : undefined;

    // Igual que en `authenticate`: se deriva siempre, exista el usuario o no y
    // tenga código o no. Si se saliera antes, el tiempo de respuesta diría quién
    // tiene cuenta y, peor, quién tiene una recuperación pendiente.
    const candidate = hashPassword(
      normalizarCodigo(codigo),
      user?.recoverySalt ?? 'sal-inexistente',
    );
    if (!user?.recoveryHash || !safeEquals(candidate, user.recoveryHash)) return null;

    user.salt = randomBytes(16).toString('hex');
    user.hash = hashPassword(passwordNueva, user.salt);
    // El código se borra aquí y no después de emitir la sesión: si algo fallara
    // en medio, lo que interesa es que el código gastado ya no valga.
    delete user.recoverySalt;
    delete user.recoveryHash;
    this.persist();

    // La sesión se emite con la huella nueva, así que las anteriores —incluida
    // la de quien hubiera entrado con la contraseña vieja— quedan muertas.
    return this.sesiones.emitir(toProfile(user), marcaDeCredencial(user));
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
