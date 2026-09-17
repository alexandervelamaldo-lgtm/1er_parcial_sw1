import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  documentarCasosDeUso,
  exportarComunicacionEa,
  modeloDeCasosDeUso,
  nombreDeFichero,
  revisarModelo,
  type CasoDeUso,
} from '@app/shared';

/**
 * Escribe los `.xmi` de los casos de uso para abrirlos en Enterprise Architect.
 *
 *   npm run diagramas --workspace @app/backend-tool
 *   npm run diagramas --workspace @app/backend-tool -- CU8
 *
 * Los ficheros salen a `docs/uml/`, uno por caso de uso, y se importan en EA con
 * *Project → Model Import/Export → Import Package from XMI*.
 *
 * ## Por qué se generan y no se dibujan
 *
 * De cada caso de uso salen cuatro diagramas que cuentan lo mismo con distinta
 * forma. Dibujarlos a mano en la herramienta son cincuenta y seis diagramas que
 * hay que rehacer enteros cada vez que un paso cambia de sitio, y que se
 * desincronizan a la primera. Aquí el caso vive en `shared/src/xmi/casos-de-uso.ts`
 * y esto solo lo traduce: cambiar un paso y volver a ejecutar esta orden deja los
 * cuatro al día.
 *
 * ## Por qué revisa antes de escribir nada
 *
 * `revisarModelo` mira los diecinueve casos de una vez. Si algo está mal, la orden
 * no escribe ni un fichero y lista todos los problemas juntos. La alternativa
 * —escribir los que salgan y fallar en el séptimo— deja `docs/uml/` a medias, con
 * una mezcla de ficheros nuevos y viejos que no se distingue a simple vista.
 *
 * ## Qué sale hoy y qué falta
 *
 * De los cinco diagramas por caso, hoy sale el de **comunicación**. Los de caso de
 * uso, actividad, secuencia y análisis de clases necesitan antes un fichero de
 * muestra exportado desde la propia herramienta: el bloque `<xmi:Extension>` que
 * hace que EA *dibuje* el diagrama —y no solo meta los elementos en el árbol del
 * proyecto— no está en ninguna especificación, y deducirlo por analogía produce
 * ficheros que importan sin error y aparecen vacíos.
 */

const aqui = dirname(fileURLToPath(import.meta.url));
/** `backend-tool/src` → la raíz del monorepo. */
const raiz = resolve(aqui, '..', '..');
const destino = join(raiz, 'docs', 'uml');

function elegir(argumentos: readonly string[]): readonly CasoDeUso[] {
  if (argumentos.length === 0) return modeloDeCasosDeUso.casos;

  const pedidos = argumentos.map((a) => a.toUpperCase());
  const encontrados = modeloDeCasosDeUso.casos.filter((c) => pedidos.includes(c.id.toUpperCase()));
  const sueltos = pedidos.filter(
    (p) => !modeloDeCasosDeUso.casos.some((c) => c.id.toUpperCase() === p),
  );

  if (sueltos.length > 0) {
    // Se para en vez de generar los que sí existen: quien escribe `CU20` cree que
    // hay veinte casos, y darle diecinueve ficheros sin decir nada le confirma la
    // idea equivocada.
    console.error(`No existe ningún caso de uso llamado ${sueltos.join(', ')}.`);
    console.error(`Los que hay: ${modeloDeCasosDeUso.casos.map((c) => c.id).join(', ')}.`);
    process.exit(1);
  }

  return encontrados;
}

function main(): void {
  const problemas = revisarModelo(modeloDeCasosDeUso);
  if (problemas.length > 0) {
    console.error(`El catálogo tiene ${problemas.length} problema(s) y no se ha escrito nada:\n`);
    for (const problema of problemas) {
      console.error(`  ${problema.caso}: ${problema.mensaje}`);
    }
    process.exit(1);
  }

  const casos = elegir(process.argv.slice(2));
  mkdirSync(destino, { recursive: true });

  for (const caso of casos) {
    const nombre = nombreDeFichero(caso, 'comunicacion');
    // UTF-8 a propósito, y declarado como tal en la cabecera del fichero. EA
    // exporta en windows-1252, pero lee lo que la declaración diga; escribir
    // windows-1252 desde aquí obligaría a un transcodificador propio para que
    // «Recuperación» no se convirtiera en dos caracteres rotos.
    writeFileSync(join(destino, nombre), exportarComunicacionEa(caso), 'utf8');
    console.log(`  docs/uml/${nombre}  ${caso.id} — ${caso.nombre}`);
  }

  // El documento sale del mismo catálogo que los diagramas, y por eso se escribe
  // aquí y no a mano: si se mantuvieran por separado, el que se quedaría viejo
  // sería siempre el documento, porque los diagramas se miran en la defensa y el
  // documento no. Se reescribe entero aunque se haya pedido un solo caso: describe
  // los diecinueve y quedarse a medias sería peor que no tocarlo.
  const documento = join(raiz, 'docs', '08-casos-de-uso.md');
  writeFileSync(documento, documentarCasosDeUso(modeloDeCasosDeUso), 'utf8');
  console.log('  docs/08-casos-de-uso.md  (catálogo completo, entra en la guía)');

  console.log(
    `\n${casos.length} diagrama(s) de comunicación escritos en docs/uml/.\n` +
      'En Enterprise Architect: Project → Model Import/Export → Import Package from XMI.',
  );
}

main();
