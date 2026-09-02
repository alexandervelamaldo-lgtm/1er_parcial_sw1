import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import archiver from 'archiver';
import { isSafeRelativePath } from '@app/shared';
import type { GeneratedFile } from '../ir/types.js';

/**
 * Empaquetado del proyecto generado.
 *
 * Dos salidas posibles: un ZIP en memoria (lo que descarga el navegador) o un
 * volcado a disco (lo que usan las pruebas y la CLI para poder inspeccionar y
 * compilar el resultado).
 */

export async function toZipBuffer(files: GeneratedFile[]): Promise<Buffer> {
  assertSafe(files);

  const archive = archiver('zip', { zlib: { level: 9 } });
  const chunks: Buffer[] = [];

  archive.on('data', (chunk: Buffer) => chunks.push(chunk));

  const finished = new Promise<void>((resolvePromise, rejectPromise) => {
    archive.on('end', () => resolvePromise());
    archive.on('error', rejectPromise);
    archive.on('warning', rejectPromise);
  });

  for (const file of files) {
    archive.append(file.content, { name: file.path });
  }
  await archive.finalize();
  await finished;

  return Buffer.concat(chunks);
}

/**
 * Escribe el proyecto en disco.
 *
 * Cada ruta se resuelve y se comprueba que sigue dentro del directorio de
 * salida. La validación de `isSafeRelativePath` ya lo garantiza sobre la cadena;
 * esta segunda comprobación lo garantiza sobre la ruta ya resuelta, que es lo
 * que realmente determina dónde se escribe.
 */
export async function writeToDisk(
  files: GeneratedFile[],
  outputDir: string,
): Promise<string[]> {
  assertSafe(files);

  const root = resolve(outputDir);
  const written: string[] = [];

  for (const file of files) {
    const target = resolve(root, file.path);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`La ruta ${file.path} escapa del directorio de salida`);
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
    written.push(target);
  }

  return written;
}

export async function writeZipToDisk(
  files: GeneratedFile[],
  zipPath: string,
): Promise<void> {
  const buffer = await toZipBuffer(files);
  await mkdir(dirname(resolve(zipPath)), { recursive: true });
  await writeFile(zipPath, buffer);
}

/** Tamaño del ZIP sin materializarlo, para comprobar cuotas antes de enviar. */
export async function zipSize(files: GeneratedFile[]): Promise<number> {
  return (await toZipBuffer(files)).byteLength;
}

function assertSafe(files: GeneratedFile[]): void {
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) {
      throw new Error(`Ruta de fichero no segura en el paquete: ${file.path}`);
    }
  }
}
