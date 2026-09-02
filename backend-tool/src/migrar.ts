import { cargarEnv, loadConfig } from './config.js';
import { abrirPool, aplicarEsquema } from './storage/postgres.js';
import { describirResumen, leerDatosDeFichero, migrar } from './storage/migracion.js';

/**
 * Pasa los datos de fichero a PostgreSQL.
 *
 *   npm run migrar --workspace @app/backend-tool
 *
 * No borra nada del disco. Si algo sale mal, quitar `DATABASE_URL` devuelve el
 * servicio exactamente al estado anterior, con sus ficheros intactos.
 */

async function main(): Promise<void> {
  cargarEnv();
  const config = loadConfig();

  if (!config.databaseUrl) {
    console.error(
      'Falta DATABASE_URL: no hay adónde migrar.\n' +
        'Ponla en el `.env` o en el entorno, por ejemplo:\n' +
        '  DATABASE_URL=postgresql://postgres@localhost:5432/uml_herramienta\n' +
        '(la contraseña puede ir en PGPASSWORD en lugar de dentro de la URL).',
    );
    process.exit(1);
  }

  console.log(`Leyendo de ${config.dataDir}…`);
  const datos = await leerDatosDeFichero(config.dataDir);

  console.log(
    `Encontrado: ${datos.usuarios.length} usuarios, ${datos.proyectos.length} proyectos, ` +
      `${datos.pertenencias.length} permisos, ${datos.documentos.length} diagramas.`,
  );

  if (datos.usuarios.length === 0 && datos.proyectos.length === 0) {
    console.log('No hay nada que migrar. ¿Es correcto el DATA_DIR?');
    return;
  }

  // La cadena de conexión se enseña sin credenciales. `URL` deja usuario y
  // contraseña en propiedades aparte, así que basta con vaciarlas: construir el
  // texto a mano es como acaban las contraseñas en los registros.
  const destino = new URL(config.databaseUrl);
  destino.password = '';
  console.log(`Escribiendo en ${destino.toString()}…`);

  const pool = await abrirPool(config.databaseUrl);
  try {
    await aplicarEsquema(pool);
    const resumen = await migrar(pool, datos);
    console.log(`\n${describirResumen(resumen)}`);
    console.log(
      '\nListo. Los ficheros de `datos/` siguen intactos: si algo no cuadra, ' +
        'quitar DATABASE_URL devuelve el servicio al estado anterior.',
    );
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('\nLa migración no se ha completado. No se ha escrito nada a medias:');
  console.error(error);
  process.exit(1);
});
