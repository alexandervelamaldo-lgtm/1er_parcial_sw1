import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Conexión a PostgreSQL.
 *
 * ## Por qué `pg` no se importa arriba
 *
 * El almacén por defecto sigue siendo el de ficheros: un `import` normal haría
 * que una instalación de desarrollo, que no necesita base de datos para nada,
 * no arrancase sin el driver puesto. Aquí se carga bajo demanda y solo cuando
 * hay `DATABASE_URL`, así que `pg` es una dependencia opcional de verdad y su
 * ausencia se cuenta con un mensaje que dice qué ejecutar.
 *
 * ## Por qué los tipos son de cosecha propia
 *
 * Lo que sigue es la porción de la API de `pg` que este proyecto usa —tres
 * métodos— descrita de forma estructural. No es un sustituto de `@types/pg`
 * pretendiendo ser exhaustivo: es la superficie que se toca, escrita para que
 * el proyecto siga typechequeando esté instalado el driver o no. Con
 * `@types/pg` presente tampoco estorba, porque nunca se asigna un `Pool` real
 * a estos tipos: el módulo entra por un `import()` dinámico y se afirma una vez,
 * en `abrirPool`, que es el único punto donde hay que confiar.
 */

export interface ResultadoConsulta<F> {
  rows: F[];
  /** `null` en sentencias que no devuelven filas. */
  rowCount: number | null;
}

export interface ClientePostgres {
  query<F = Record<string, unknown>>(
    texto: string,
    valores?: unknown[],
  ): Promise<ResultadoConsulta<F>>;
  /** Devuelve la conexión al pool. Olvidarlo lo agota y el servicio se cuelga. */
  release(): void;
}

export interface PoolPostgres {
  query<F = Record<string, unknown>>(
    texto: string,
    valores?: unknown[],
  ): Promise<ResultadoConsulta<F>>;
  connect(): Promise<ClientePostgres>;
  end(): Promise<void>;
}

interface ModuloPg {
  Pool: new (config: Record<string, unknown>) => PoolPostgres;
}

/**
 * Código de error de PostgreSQL para violación de unicidad.
 *
 * Se usa en lugar de comprobar antes si el correo existe, porque entre la
 * comprobación y la inserción caben dos registros simultáneos con el mismo
 * correo. La restricción de la tabla no tiene esa ventana.
 */
export const VIOLACION_UNICIDAD = '23505';

export function esViolacionDeUnicidad(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === VIOLACION_UNICIDAD
  );
}

/**
 * Traduce `sslmode` de la cadena de conexión a la opción de `pg`.
 *
 * Se respeta lo que diga la URL porque es lo que entiende cualquiera que haya
 * usado `psql`, y porque la alternativa —decidir por nuestra cuenta— acaba
 * siempre en el mismo sitio: desactivar la verificación «temporalmente» y
 * dejarlo así.
 *
 * Conviene tener claro qué significa cada valor:
 *
 * - `disable`: sin TLS. Correcto contra un PostgreSQL en la misma máquina.
 * - `require`: cifra, pero **no comprueba de quién es el certificado**. Protege
 *   de quien escucha el cable, no de quien se hace pasar por la base de datos.
 * - `verify-full`: cifra y verifica. Es lo que debería usarse contra RDS, y
 *   requiere que el certificado de la autoridad de Amazon esté en el almacén de
 *   confianza del sistema (`NODE_EXTRA_CA_CERTS` apuntando al bundle de RDS).
 *
 * Sin `sslmode`, se asume TLS sin verificación para cualquier host que no sea
 * local: es lo que hace falta para que RDS conteste, y anunciarlo aquí es mejor
 * que un fallo de conexión sin explicación en el primer despliegue.
 */
export function opcionesSsl(databaseUrl: string): false | { rejectUnauthorized: boolean } {
  let host = '';
  let modo = '';
  try {
    const url = new URL(databaseUrl);
    host = url.hostname;
    modo = url.searchParams.get('sslmode') ?? '';
  } catch {
    // Cadena con formato propio (`host=… port=…`). Sin poder leerla, lo prudente
    // es cifrar: equivocarse hacia el cifrado no rompe nada que no estuviera roto.
    return { rejectUnauthorized: false };
  }

  if (modo === 'disable') return false;
  if (modo === 'verify-full' || modo === 'verify-ca') return { rejectUnauthorized: true };
  if (modo === 'require' || modo === 'prefer') return { rejectUnauthorized: false };

  const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return esLocal ? false : { rejectUnauthorized: false };
}

/** Abre el pool y comprueba que la base de datos responde antes de devolverlo. */
export async function abrirPool(databaseUrl: string): Promise<PoolPostgres> {
  // El especificador se anota como `string` a propósito: con el literal `'pg'`,
  // TypeScript intentaría resolver el módulo y el proyecto dejaría de
  // typechequear en cuanto el driver no estuviera instalado, que es justo la
  // situación que este fichero existe para tolerar.
  const especificador: string = 'pg';

  let modulo: ModuloPg;
  try {
    modulo = (await import(especificador)) as ModuloPg;
  } catch {
    throw new Error(
      'DATABASE_URL está definida pero el driver de PostgreSQL no está instalado. ' +
        'Ejecuta:  npm install --workspace @app/backend-tool pg  ' +
        '(y, para desarrollar,  npm install -D --workspace @app/backend-tool @types/pg).',
    );
  }

  const pool = new modulo.Pool({
    connectionString: databaseUrl,
    ssl: opcionesSsl(databaseUrl),
    // Diez conexiones sobran para una instancia y dejan sitio a las demás en la
    // instancia mínima de RDS, que admite bastantes menos de las que uno cree.
    max: 10,
    idleTimeoutMillis: 30_000,
    // Sin esto, una base de datos inalcanzable deja la petición esperando para
    // siempre y el síntoma es «la aplicación no carga», sin más.
    connectionTimeoutMillis: 10_000,
  });

  // Fallar aquí y no en la primera petición: un `DATABASE_URL` mal escrito debe
  // impedir el arranque, no producir errores intermitentes en producción.
  const cliente = await pool.connect();
  cliente.release();

  return pool;
}

/**
 * Crea las tablas si no existen.
 *
 * El esquema vive en `sql/esquema.sql` y no aquí, para poder pegarlo en `psql`
 * cuando haga falta mirar qué hay. Se aplica en cada arranque porque es
 * idempotente; el día que haya que *cambiar* una columna ya existente esto no
 * bastará y hará falta una herramienta de migraciones.
 */
export async function aplicarEsquema(pool: PoolPostgres): Promise<void> {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(aqui, '..', '..', 'sql', 'esquema.sql'), 'utf8');
  await pool.query(sql);
}

/**
 * Ejecuta una función dentro de una transacción.
 *
 * El `release()` va en el `finally` porque una excepción que se lleve por
 * delante la devolución de la conexión no rompe la petición en curso —esa ya
 * está rota— sino la siguiente, y la siguiente, hasta agotar el pool. El fallo
 * aparece entonces lejos de su causa.
 */
export async function enTransaccion<T>(
  pool: PoolPostgres,
  trabajo: (cliente: ClientePostgres) => Promise<T>,
): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('begin');
    const resultado = await trabajo(cliente);
    await cliente.query('commit');
    return resultado;
  } catch (error) {
    await cliente.query('rollback').catch(() => {
      /* la conexión ya estaba perdida; el error que importa es el de arriba */
    });
    throw error;
  } finally {
    cliente.release();
  }
}

/**
 * Fechas: PostgreSQL devuelve `Date` para `timestamptz` y el modelo usa ISO 8601
 * en texto. La conversión está aquí para que ninguna implementación se invente
 * la suya.
 */
export function aIso(valor: Date | string): string {
  return typeof valor === 'string' ? valor : valor.toISOString();
}
