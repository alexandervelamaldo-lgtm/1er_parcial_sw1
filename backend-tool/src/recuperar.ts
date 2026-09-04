import { cargarEnv, loadConfig, type Config } from './config.js';
import { LocalIdentityProvider, type IdentityProvider } from './auth/identity.js';

/**
 * Escotilla de operador: emite un código de recuperación para una cuenta.
 *
 *   npm run recuperar --workspace @app/backend-tool -- alguien@ejemplo.com
 *
 * Existe porque el sistema no manda correos (ver `auth/identity.ts`): quien
 * pierda a la vez su contraseña y su código de recuperación no tiene forma de
 * volver a entrar por sí mismo. Esto es esa forma, y pasa por alguien con acceso
 * al servidor, que es exactamente el nivel de confianza que la operación merece.
 *
 * ## Por qué emite un código y no pone una contraseña
 *
 * Un `npm run … -- correo contraseñaNueva` sería más corto y bastante peor: la
 * contraseña quedaría en el historial del intérprete de órdenes, en la lista de
 * procesos mientras corre y, si el servidor es compartido, a la vista de
 * cualquiera que ejecute `ps`. Un código de un solo uso que caduca al usarse no
 * tiene ninguno de esos problemas, y además obliga a que sea el dueño de la
 * cuenta —y no el operador— quien elija la contraseña. El operador nunca llega a
 * saberla.
 */

async function abrirIdentidad(config: Config): Promise<{
  identity: IdentityProvider;
  cerrar: () => Promise<void>;
}> {
  if (!config.databaseUrl) {
    const identity = await LocalIdentityProvider.open(
      config.dataDir,
      config.sessionSecret,
      config.sessionTtl,
    );
    // El `flush` no es opcional: `persist()` escribe en segundo plano y el
    // proceso terminaría antes de que el fichero llegue al disco. Sin esperar,
    // el código impreso en pantalla no sería el guardado.
    return { identity, cerrar: () => identity.flush() };
  }

  const { abrirPool, aplicarEsquema } = await import('./storage/postgres.js');
  const { PostgresIdentityProvider } = await import('./storage/postgres-stores.js');
  const pool = await abrirPool(config.databaseUrl);
  // Se aplica el esquema por si la base viene de antes de que existieran las
  // columnas de recuperación: sin esto, el `update` fallaría con «columna
  // desconocida» justo cuando alguien intenta rescatar una cuenta.
  await aplicarEsquema(pool);
  return {
    identity: new PostgresIdentityProvider(pool, config.sessionSecret, config.sessionTtl),
    cerrar: () => pool.end(),
  };
}

async function main(): Promise<void> {
  cargarEnv();
  const config = loadConfig();

  const correo = process.argv[2];
  if (!correo) {
    console.error(
      'Falta el correo de la cuenta.\n' +
        '  npm run recuperar --workspace @app/backend-tool -- alguien@ejemplo.com',
    );
    process.exit(1);
  }

  const { identity, cerrar } = await abrirIdentidad(config);
  try {
    const usuario = await identity.findByEmail(correo);
    if (!usuario) {
      // Aquí sí se dice que la cuenta no existe, al revés que en la ruta HTTP.
      // Quien ejecuta esto ya tiene el fichero de usuarios delante; ocultárselo
      // no protegería nada y solo le haría perder el rato buscando una errata
      // que el programa ya ha visto.
      console.error(`No hay ninguna cuenta con el correo ${correo}.`);
      process.exit(1);
    }

    const codigo = await identity.emitirCodigoRecuperacion(usuario.id);
    console.log(
      `\nCódigo de recuperación para ${usuario.email}:\n\n    ${codigo}\n\n` +
        'Dáselo a esa persona por un canal en el que confíes. Con él y su correo\n' +
        'puede poner una contraseña nueva desde «He olvidado mi contraseña».\n\n' +
        'Vale una sola vez, y emitirlo ha anulado cualquier código anterior.',
    );
  } finally {
    await cerrar();
  }
}

main().catch((error: unknown) => {
  console.error('\nNo se ha podido emitir el código:');
  console.error(error);
  process.exit(1);
});
