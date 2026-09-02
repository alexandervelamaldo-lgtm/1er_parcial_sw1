import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ClassDiagramSchema } from '@app/shared';
import { CORPUS } from './fixtures/corpus.js';
import { generate } from './index.js';
import { writeToDisk } from './package/zip.js';

/**
 * CLI de desarrollo.
 *
 * No es el camino de producción —eso es el endpoint HTTP de `backend-tool`—
 * sino la forma de inspeccionar y compilar el resultado sin levantar nada:
 *
 *   npm run demo -w @app/generator -- --corpus tienda --out ./salida
 *   npm run demo -w @app/generator -- --file diagrama.json --out ./salida
 */

interface Args {
  corpus?: string;
  file?: string;
  out: string;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: resolve('./salida'), list: false };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === '--list') {
      args.list = true;
    } else if (flag === '--corpus' && value) {
      args.corpus = value;
      i += 1;
    } else if (flag === '--file' && value) {
      args.file = value;
      i += 1;
    } else if (flag === '--out' && value) {
      args.out = resolve(value);
      i += 1;
    }
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const entry of CORPUS) {
      console.log(entry.name);
    }
    return 0;
  }

  const diagram = args.file
    ? ClassDiagramSchema.parse(JSON.parse(await readFile(args.file, 'utf8')))
    : CORPUS.find((c) => c.name === (args.corpus ?? 'tienda'))?.diagram();

  if (!diagram) {
    console.error(
      `Diagrama desconocido: ${args.corpus}. Disponibles: ${CORPUS.map((c) => c.name).join(', ')}`,
    );
    return 2;
  }

  const outcome = generate(diagram);

  if (!outcome.ok) {
    console.error(`El diagrama «${diagram.name}» no es válido:`);
    for (const error of outcome.validation.errors) {
      console.error(`  [${error.code}] ${error.message}`);
    }
    return 1;
  }

  for (const warning of outcome.warnings) {
    console.warn(`  aviso [${warning.code}] ${warning.message}`);
  }

  const written = await writeToDisk(outcome.files, args.out);
  console.log(
    `Generados ${written.length} ficheros de «${diagram.name}» en ${args.out}\n` +
      `  entidades: ${outcome.ir.entities.length}` +
      `  enums: ${outcome.ir.enums.length}` +
      `  tablas: ${outcome.ir.migration.tables.length}`,
  );
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
