/**
 * Validación y conversión de identificadores.
 *
 * SEGURIDAD (RNF-SEG-06): todo nombre que llega desde un diagrama es entrada no
 * confiable. Un usuario puede llamar a una clase `User; DROP TABLE--` o
 * `../../../etc/passwd`. Estas funciones son la frontera que impide que esos
 * nombres lleguen a una plantilla, a un fichero o a una sentencia SQL.
 *
 * La regla es la lista blanca: se acepta lo que encaja con el patrón de
 * identificador y se rechaza todo lo demás. Nunca se intenta "limpiar" una
 * cadena peligrosa quitándole caracteres, porque ese enfoque siempre deja
 * huecos.
 */

/** Identificador Java válido, restringido deliberadamente a ASCII. */
const JAVA_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Identificador SQL sin comillas. */
const SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Nombre de paquete Java: segmentos separados por punto. */
const JAVA_PACKAGE = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/;

export const JAVA_RESERVED = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
  'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
  'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
  'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
  'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
  'transient', 'try', 'void', 'volatile', 'while',
  'true', 'false', 'null', 'var', 'record', 'sealed', 'permits', 'yield',
]);

/**
 * Palabras reservadas de PostgreSQL que no pueden usarse como nombre de tabla o
 * columna sin comillas. Lista de las reservadas y de las que en la práctica dan
 * problemas; no es la lista exhaustiva del estándar SQL.
 */
export const SQL_RESERVED = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc',
  'asymmetric', 'authorization', 'binary', 'both', 'case', 'cast', 'check',
  'collate', 'collation', 'column', 'concurrently', 'constraint', 'create',
  'cross', 'current_catalog', 'current_date', 'current_role', 'current_schema',
  'current_time', 'current_timestamp', 'current_user', 'default', 'deferrable',
  'desc', 'distinct', 'do', 'else', 'end', 'except', 'false', 'fetch', 'for',
  'foreign', 'freeze', 'from', 'full', 'grant', 'group', 'having', 'ilike',
  'in', 'initially', 'inner', 'intersect', 'into', 'is', 'isnull', 'join',
  'lateral', 'leading', 'left', 'like', 'limit', 'localtime', 'localtimestamp',
  'natural', 'not', 'notnull', 'null', 'offset', 'on', 'only', 'or', 'order',
  'outer', 'overlaps', 'placing', 'primary', 'references', 'returning',
  'right', 'select', 'session_user', 'similar', 'some', 'symmetric', 'table',
  'tablesample', 'then', 'to', 'trailing', 'true', 'union', 'unique', 'user',
  'using', 'variadic', 'verbose', 'when', 'where', 'window', 'with',
  // No reservadas por el estándar pero conflictivas en la práctica:
  'order', 'group', 'value', 'values', 'type', 'name', 'key', 'level',
]);

export function isValidJavaIdentifier(name: string): boolean {
  return JAVA_IDENTIFIER.test(name) && !JAVA_RESERVED.has(name.toLowerCase());
}

export function isValidSqlIdentifier(name: string): boolean {
  return (
    SQL_IDENTIFIER.test(name) &&
    name.length <= 63 && // límite de PostgreSQL
    !SQL_RESERVED.has(name.toLowerCase())
  );
}

export function isValidJavaPackage(name: string): boolean {
  if (!JAVA_PACKAGE.test(name)) return false;
  return name.split('.').every((segment) => !JAVA_RESERVED.has(segment));
}

/**
 * Un único segmento de paquete: `ventas` sí, `com.ventas` no.
 *
 * Lo usan los módulos, que aportan un solo tramo al paquete base. Rechazar el
 * punto es lo que impide que un módulo llamado `..` o `com.otro` acabe
 * escribiendo fuera del paquete base del proyecto.
 */
export function isValidJavaPackageSegment(name: string): boolean {
  return !name.includes('.') && isValidJavaPackage(name);
}

// ---------------------------------------------------------------------------
// Conversión de mayúsculas y minúsculas
// ---------------------------------------------------------------------------

/**
 * Sustituye letras acentuadas por su equivalente ASCII.
 *
 * Esto NO contradice la regla de la lista blanca de arriba. La diferencia está
 * en el origen del texto: un nombre de clase lo escribe una persona sabiendo
 * que es un identificador, y si escribe `Créditos` hay que decírselo, no
 * corregirlo a su espalda. En cambio el `artifactId` y el nombre de la base de
 * datos se *derivan* de la prosa libre del proyecto («Tienda en línea»), donde
 * la tilde es ortografía correcta y no un error que reportar.
 *
 * Solo se transliteran las letras que tienen equivalente evidente. Lo demás se
 * deja intacto para que la validación posterior lo rechace: convertir a la
 * fuerza cualquier alfabeto acabaría produciendo cadenas vacías o colisiones
 * entre nombres distintos.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

function transliterate(input: string): string {
  // NFD separa la letra de su tilde; el rango es el de los diacríticos
  // combinantes. La `ñ` se convierte así en `n`, que es lo que se espera de un
  // nombre de tabla o de un identificador de artefacto.
  return input.normalize('NFD').replace(COMBINING_MARKS, '');
}

/** Parte una cadena en palabras, admitiendo camelCase, snake_case y kebab-case. */
function splitWords(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter((w) => w.length > 0);
}

export function toPascalCase(input: string): string {
  return splitWords(input)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

export function toCamelCase(input: string): string {
  const pascal = toPascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

// `toSnakeCase` y `toKebabCase` producen nombres de tabla, de base de datos y de
// artefacto Maven, contextos que solo admiten ASCII. Por eso transliteran,
// mientras que `toPascalCase` y `toCamelCase` —que producen nombres de clase y
// de campo Java— no lo hacen: ahí el nombre viene del diagrama y debe llegar
// intacto al validador para que el usuario vea el error.

export function toSnakeCase(input: string): string {
  return splitWords(transliterate(input))
    .map((w) => w.toLowerCase())
    .join('_');
}

export function toKebabCase(input: string): string {
  return splitWords(transliterate(input))
    .map((w) => w.toLowerCase())
    .join('-');
}

export function toScreamingSnakeCase(input: string): string {
  return toSnakeCase(input).toUpperCase();
}

// ---------------------------------------------------------------------------
// Pluralización
// ---------------------------------------------------------------------------

const IRREGULAR_PLURALS: Record<string, string> = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
  tooth: 'teeth',
  foot: 'feet',
  mouse: 'mice',
  goose: 'geese',
};

/**
 * Pluralización en inglés, suficiente para nombres de tabla y rutas REST.
 * No pretende ser lingüísticamente completa: cubre los casos habituales de
 * nombres de entidad y es determinista, que es lo que importa para que el
 * código generado sea estable entre ejecuciones.
 */
export function pluralize(word: string): string {
  const lower = word.toLowerCase();
  if (IRREGULAR_PLURALS[lower]) {
    return matchCase(word, IRREGULAR_PLURALS[lower]!);
  }
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  if (/[^f]fe$/i.test(word)) return word.slice(0, -2) + 'ves';
  if (/[^f]f$/i.test(word)) return word.slice(0, -1) + 'ves';
  return word + 's';
}

function matchCase(source: string, target: string): string {
  if (source[0] && source[0] === source[0].toUpperCase()) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

// ---------------------------------------------------------------------------
// Rutas de fichero
// ---------------------------------------------------------------------------

/**
 * Comprueba que una ruta relativa generada no escapa del directorio de salida.
 * Sin esto, una clase llamada `../../../etc/passwd` escribiría fuera del ZIP
 * (escape de directorio). Se rechaza cualquier segmento `..`, ruta absoluta o
 * letra de unidad de Windows.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (path.includes('\0')) return false;

  const segments = path.split(/[/\\]/);
  return segments.every((s) => s !== '..' && s !== '' && s !== '.');
}

export function packageToPath(pkg: string): string {
  return pkg.split('.').join('/');
}
