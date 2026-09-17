/**
 * Genera un proyecto Spring Boot de verdad y describe lo que emitió.
 *
 * Existe para que la evidencia del caso de prueba CP-07 sea una ejecución y no
 * una afirmación: se corre el generador sobre un diagrama del corpus y se
 * enumeran los ficheros con su tamaño. Nada se escribe en disco; lo que
 * interesa es qué sale y si sale entero.
 *
 * Uso: npx tsx backend-tool/scripts/generar-demo.mts
 */

import { generate, tiendaDiagram } from '../../generator/src/index.js';

const diagrama = tiendaDiagram();
const resultado = generate(diagrama, {
  basePackage: 'com.ejemplo.tienda',
  artifactId: 'tienda',
});

if (!resultado.ok) {
  console.log('El diagrama no es válido; no se genera nada:');
  for (const e of resultado.validation.errors) console.log(`  - ${e.message}`);
  process.exit(1);
}

const { files, warnings } = resultado;
const bytes = files.reduce((t, f) => t + Buffer.byteLength(f.content, 'utf8'), 0);

// Las clases y las relaciones se guardan indexadas por identificador, no en
// lista: el documento compartido es un mapa CRDT y el modelo conserva esa forma.
const clases = Object.keys(diagrama.classes).length;
const relaciones = Object.keys(diagrama.relations).length;

console.log(`Diagrama de entrada: "${diagrama.name}" — ${clases} clases, ${relaciones} relaciones`);
console.log(`Validacion previa: ok, ${warnings.length} avisos`);
console.log(`Ficheros emitidos: ${files.length}  (${(bytes / 1024).toFixed(1)} KiB en total)`);

/** Agrupa por capa para que el recuento se lea de un golpe. */
const capas: [string, RegExp][] = [
  ['Entidades JPA (domain)', /\/domain\//],
  ['Repositorios', /\/repository\//],
  ['Servicios e implementaciones', /\/service\//],
  ['Controladores REST', /\/controller\//],
  ['DTO y mapeadores', /\/dto\//],
  ['Manejo de errores', /\/exception\//],
  ['Idempotencia (reenvio offline)', /\/infraestructura\//],
  ['Migraciones y datos semilla', /\/(db\/migration|data\.sql)/],
  ['Manifiesto del asistente', /manifiesto\.json/],
  ['Proyecto y despliegue', /^(pom\.xml|docker-compose\.yml|README\.md|\.gitignore|.*application\.yml|.*Application\.java)$/],
];

console.log('');
for (const [nombre, patron] of capas) {
  const suyos = files.filter((f) => patron.test(f.path));
  const lineas = suyos.reduce((t, f) => t + f.content.split('\n').length, 0);
  console.log(
    `  ${nombre.padEnd(34)} ${String(suyos.length).padStart(3)} ficheros  ${String(lineas).padStart(5)} lineas`,
  );
}

const sueltos = files.filter((f) => !capas.some(([, p]) => p.test(f.path)));
if (sueltos.length) {
  console.log('');
  console.log(`  Sin clasificar: ${sueltos.map((f) => f.path).join(', ')}`);
}

const vacios = files.filter((f) => f.content.trim().length === 0);
console.log('');
console.log(`Ficheros vacios o a medias: ${vacios.length}`);
console.log(
  `Entidades con clave primaria: ${
    files.filter((f) => /\/domain\//.test(f.path) && f.content.includes('@Id')).length
  } de ${files.filter((f) => /\/domain\//.test(f.path) && f.content.includes('@Entity')).length}`,
);
const union = files.find((f) => /V1__esquema_inicial\.sql$/.test(f.path));
console.log(
  `Tablas de union en la migracion inicial: ${
    union ? (union.content.match(/create table/gi) ?? []).length : 0
  } sentencias create table`,
);
