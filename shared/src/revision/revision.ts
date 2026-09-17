import {
  findSuperclass,
  isPersistent,
  isToMany,
  listClasses,
  listRelations,
  type ClassDiagram,
  type Id,
  type UmlClass,
} from '../model/uml.js';
import { isPrimitiveType } from '../model/type-catalog.js';

/**
 * Revisión de modelado: si el diagrama está *bien hecho*, no si se puede generar.
 *
 * Hay dos preguntas distintas que suenan igual, y confundirlas es lo que dejaba
 * esto sin escribir. `shared/src/validation/validate.ts` contesta a «¿puedo
 * emitir Java, JPA y SQL a partir de esto?»: tipo desconocido, entidad sin clave
 * primaria, herencia múltiple, ciclo de composición. Son 44 códigos y todos
 * miran al código de salida. Un diagrama puede pasarlos enteros y seguir siendo
 * un mal diagrama de clases: una clase llamada `SistemaDeGestion`, un importe
 * guardado como texto, una subclase que vuelve a declarar los atributos de su
 * padre. Eso compila. Y eso es exactamente lo que corrige un profesor.
 *
 * Este módulo contesta a la segunda pregunta. No comparte códigos con el
 * validador del generador ni repite ninguna de sus comprobaciones: si algo ya
 * bloquea la generación, no hace falta decirlo dos veces con otras palabras.
 *
 * ## Lo que esto NO es
 *
 * No es un oráculo. Cada hallazgo es un *candidato*: un patrón que casi siempre
 * indica un problema, señalado con el motivo a la vista para que quien mira el
 * diagrama decida. Un revisor que afirmara «tiene exactamente dos errores y son
 * estos» mentiría, porque el criterio de quién corrige no está en el fichero.
 * Por eso los hallazgos llevan gravedad y explicación, y por eso la pantalla que
 * los enseña dice de dónde salen.
 *
 * La contención está en el otro extremo: un aviso que no corresponde a un
 * problema real es peor que ningún aviso, porque enseña a ignorarlos todos y el
 * día que uno importe también se ignorará. Cada regla de aquí abajo lleva
 * escrito por qué se dispara y, cuando la heurística es discutible, qué la
 * frena.
 *
 * ## Por qué vive en `shared`
 *
 * Es una función pura del modelo: diagrama entra, lista sale. Sin red, sin IA y
 * sin servidor, así que funciona con el portátil desconectado —que es el
 * requisito de la defensa— y se prueba en Node como el resto. Está en `shared` y
 * no en `frontend` porque el asistente y el backend también saben preguntar por
 * la calidad de un modelo, y una regla escrita dos veces se separa.
 */

export type GravedadRevision = 'error' | 'aviso' | 'sugerencia';

export type CodigoRevision =
  | 'ATRIBUTO_HEREDADO_REPETIDO'
  | 'CLASE_SIN_CONTENIDO'
  | 'COMPOSICION_COMPARTIDA'
  | 'ATRIBUTO_QUE_ES_RELACION'
  | 'TIPO_SOSPECHOSO'
  | 'CLASE_AISLADA'
  | 'CLASE_NO_ES_DEL_DOMINIO'
  | 'MUCHOS_A_MUCHOS_SIN_CLASE'
  | 'RELACION_DUPLICADA';

export interface Hallazgo {
  codigo: CodigoRevision;
  gravedad: GravedadRevision;
  /** Qué se ha visto, en una línea y con los nombres del diagrama dentro. */
  titulo: string;
  /** Por qué es un problema y qué se hace al respecto. */
  detalle: string;
  /** Clase a la que llevar la vista al pulsar el hallazgo. */
  classId?: Id;
  relationId?: Id;
}

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

/** Diacríticos combinantes, escritos con escapes para que el fichero sea ASCII. */
const TILDES = new RegExp('[\\u0300-\\u036f]', 'g');

/** Parte un identificador en palabras sueltas, en minúscula y sin tildes. */
function palabras(nombre: string): string[] {
  return nombre
    .normalize('NFD')
    .replace(TILDES, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 0);
}

/**
 * Quita el plural en inglés y en castellano, lo justo para emparejar
 * `books` con `Book` y `libros` con `Libro`. No pretende ser lingüística.
 */
function singular(palabra: string): string {
  if (palabra.endsWith('ies') && palabra.length > 4) return `${palabra.slice(0, -3)}y`;
  if (palabra.endsWith('es') && palabra.length > 3) return palabra.slice(0, -2);
  if (palabra.endsWith('s') && palabra.length > 2) return palabra.slice(0, -1);
  return palabra;
}

/**
 * Palabras que delatan que una clase no es del dominio sino de la
 * implementación. `LibraryManagementSystem` no es una cosa que exista en una
 * biblioteca: es el programa. `LibraryDatabase` tampoco: es dónde se guarda.
 * Meterlas en el diagrama de clases del dominio y colgarles asociaciones es el
 * error de bulto más repetido en los diagramas de examen, y además aquí tiene
 * consecuencia: el generador les hace tabla, repositorio y CRUD REST.
 */
const PALABRAS_TECNICAS = new Set([
  'system', 'sistema', 'database', 'db', 'bd', 'basedatos',
  'main', 'app', 'aplicacion', 'application', 'software', 'programa',
  'manager', 'management', 'gestor', 'gestion',
  'controller', 'controlador', 'service', 'servicio', 'repository', 'repositorio',
  'dao', 'helper', 'util', 'utils', 'utilidades', 'handler', 'factory',
  'gui', 'ui', 'screen', 'pantalla', 'form', 'formulario', 'ventana',
  'connection', 'conexion', 'session', 'sesion',
]);

/**
 * Palabras que convierten el nombre en una *cuenta de* algo.
 *
 * Están en su propia constante porque las usan dos reglas con intención
 * opuesta. Para el tipo, `noOfBooksIssued` promete un número. Para la regla de
 * los atributos que en realidad son relaciones, esa misma palabra es el freno:
 * «número de libros» no es un enlace con `Book`, es un contador —un valor
 * derivado de la asociación, que es otra cosa— y señalarlo como relación mal
 * puesta sería el falso positivo exacto que esta pantalla no se puede permitir.
 */
const CUANTIFICADORES = new Set([
  'cantidad', 'numero', 'num', 'no', 'count', 'total', 'edad', 'age',
  'stock', 'existencias', 'anio', 'ano', 'year', 'paginas', 'pages',
  'copias', 'copies', 'unidades', 'quantity', 'qty',
]);

/** Familias de tipo que el nombre de un atributo delata. */
interface FamiliaSospechosa {
  palabras: Set<string>;
  /** Qué tipos del catálogo cuadran con esa familia. */
  esperado: string;
  /** Nombres canónicos aceptables; si el atributo ya usa uno, no hay hallazgo. */
  aceptados: Set<string>;
  /** Requiere más de una palabra para disparar (para prefijos ambiguos). */
  soloCompuesto?: boolean;
}

const FAMILIAS: FamiliaSospechosa[] = [
  {
    // Dinero. Se separa de los enteros porque el tipo correcto es distinto:
    // un importe en `Double` acumula error de redondeo y en `String` no se
    // puede ni sumar.
    palabras: new Set([
      'precio', 'price', 'importe', 'amount', 'monto', 'coste', 'cost',
      'salario', 'salary', 'sueldo', 'saldo', 'balance', 'fine', 'multa',
      'subtotal', 'descuento', 'discount', 'pago', 'payment', 'tarifa', 'fee',
    ]),
    esperado: 'Decimal',
    aceptados: new Set(['Decimal', 'BigDecimal']),
  },
  {
    palabras: CUANTIFICADORES,
    esperado: 'Integer',
    aceptados: new Set(['Integer', 'Int', 'Long', 'Short', 'Double', 'Float', 'Decimal', 'BigDecimal']),
    // `no` a secas puede ser una negación; `noOfBooks` no lo es. Y `total`
    // solo, en una factura, suele ser el importe y ya lo coge la familia de
    // arriba.
    soloCompuesto: true,
  },
  {
    palabras: new Set([
      'fecha', 'date', 'dia', 'day', 'vencimiento', 'expiry', 'expiration',
      'nacimiento', 'birth', 'alta', 'emision', 'issue', 'devolucion',
      'return', 'prestamo', 'deadline', 'plazo',
    ]),
    esperado: 'Date',
    aceptados: new Set(['Date', 'DateTime', 'Instant', 'Time']),
  },
  {
    palabras: new Set([
      'activo', 'active', 'disponible', 'available', 'borrado', 'deleted',
      'habilitado', 'enabled', 'pagado', 'paid', 'devuelto', 'returned',
      'vigente', 'valido', 'valid', 'confirmado', 'confirmed',
    ]),
    esperado: 'Boolean',
    aceptados: new Set(['Boolean']),
  },
];

/** Tipos de texto: los únicos sobre los que se sospecha. */
const TEXTO = new Set(['string', 'text']);

// ---------------------------------------------------------------------------
// Entrada pública
// ---------------------------------------------------------------------------

const ORDEN: Record<GravedadRevision, number> = { error: 0, aviso: 1, sugerencia: 2 };

/**
 * Revisa el modelado del diagrama y devuelve los hallazgos ordenados por
 * gravedad.
 *
 * El orden dentro de cada gravedad es el de aparición de las clases tal y como
 * las devuelve el modelo, que es estable: dos ejecuciones sobre el mismo
 * diagrama dan la misma lista en el mismo orden. Sin eso, la pantalla barajaría
 * los hallazgos en cada apertura y nadie sabría si acaba de arreglar uno.
 */
export function revisarDiagrama(diagrama: ClassDiagram): Hallazgo[] {
  const hallazgos: Hallazgo[] = [
    ...atributosHeredadosRepetidos(diagrama),
    ...clasesSinContenido(diagrama),
    ...composicionesCompartidas(diagrama),
    ...atributosQueSonRelaciones(diagrama),
    ...tiposSospechosos(diagrama),
    ...clasesAisladas(diagrama),
    ...clasesQueNoSonDelDominio(diagrama),
    ...relacionesDuplicadas(diagrama),
    ...muchosAMuchosSinClase(diagrama),
  ];

  // `sort` de JavaScript es estable desde ES2019, así que agrupar por gravedad
  // no reordena lo de dentro.
  return hallazgos.sort((a, b) => ORDEN[a.gravedad] - ORDEN[b.gravedad]);
}

/** Cuántos hallazgos hay de cada gravedad. Para el resumen de la pantalla. */
export function resumirRevision(hallazgos: Hallazgo[]): Record<GravedadRevision, number> {
  const cuenta: Record<GravedadRevision, number> = { error: 0, aviso: 0, sugerencia: 0 };
  for (const h of hallazgos) cuenta[h.gravedad] += 1;
  return cuenta;
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

/** Los ancestros de una clase, del padre hacia arriba, sin repetir. */
function ascendencia(diagrama: ClassDiagram, clase: UmlClass): UmlClass[] {
  const cadena: UmlClass[] = [];
  const vistos = new Set<Id>([clase.id]);
  let actual = findSuperclass(diagrama, clase.id);
  // El corte por `vistos` no es defensivo de más: un ciclo de herencia es un
  // diagrama que el validador del generador rechaza, pero esto se ejecuta
  // mientras se dibuja, y a mitad de dibujar el ciclo existe.
  while (actual && !vistos.has(actual.id)) {
    cadena.push(actual);
    vistos.add(actual.id);
    actual = findSuperclass(diagrama, actual.id);
  }
  return cadena;
}

/**
 * Una subclase que vuelve a declarar un atributo que ya tiene su padre.
 *
 * Es el error clásico de quien dibuja las clases por separado y luego les pone
 * la flecha de herencia: `Bibliotecario` con `nombre` e `id` propios colgando de
 * `Usuario`, que ya los tiene. En el modelo significa que la herencia no está
 * aportando nada; en el código generado, un campo que tapa al del padre.
 *
 * Es error y no aviso porque no admite lectura benévola: o sobra el atributo, o
 * sobra la herencia.
 */
function atributosHeredadosRepetidos(diagrama: ClassDiagram): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const clase of listClasses(diagrama)) {
    const ancestros = ascendencia(diagrama, clase);
    if (ancestros.length === 0) continue;

    const arriba = new Map<string, string>();
    for (const ancestro of ancestros) {
      for (const atributo of ancestro.attributes) {
        const clave = atributo.name.toLowerCase();
        if (!arriba.has(clave)) arriba.set(clave, ancestro.name);
      }
    }

    for (const atributo of clase.attributes) {
      const donde = arriba.get(atributo.name.toLowerCase());
      if (donde === undefined) continue;
      hallazgos.push({
        codigo: 'ATRIBUTO_HEREDADO_REPETIDO',
        gravedad: 'error',
        titulo: `«${clase.name}» vuelve a declarar «${atributo.name}», que ya hereda de «${donde}»`,
        detalle:
          `Al heredar de «${donde}», «${clase.name}» ya tiene «${atributo.name}». ` +
          'Declararlo otra vez lo duplica: o se borra el atributo de la subclase, ' +
          'o lo que sobra es la herencia porque las dos clases no comparten nada.',
        classId: clase.id,
      });
    }
  }

  return hallazgos;
}

/**
 * Una clase que no dice nada: sin atributos, sin métodos y sin literales.
 *
 * Si además no hereda de nadie es un error: el generador le hará una tabla con
 * una sola columna de clave primaria, que no guarda ningún dato. Si hereda, se
 * queda en aviso, porque una subclase vacía puede ser legítima —marca un tipo
 * dentro de una jerarquía— aunque casi siempre indica que se dibujó la caja y se
 * olvidó rellenarla.
 */
function clasesSinContenido(diagrama: ClassDiagram): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const clase of listClasses(diagrama)) {
    if (!isPersistent(clase)) continue;
    if (clase.attributes.length > 0 || clase.methods.length > 0) continue;

    const padre = findSuperclass(diagrama, clase.id);
    hallazgos.push({
      codigo: 'CLASE_SIN_CONTENIDO',
      gravedad: padre ? 'aviso' : 'error',
      titulo: `«${clase.name}» está vacía: ni atributos ni métodos`,
      detalle: padre
        ? `«${clase.name}» hereda de «${padre.name}» y no añade nada propio. ` +
          'Si no se distingue en nada de su padre, la subclase sobra; si sí, ' +
          'le falta el atributo o el método que la distingue.'
        : `«${clase.name}» no guarda ningún dato. Tal y como está, su tabla ` +
          'tendría solo la clave primaria. Cabe añadirle sus atributos o quitarla ' +
          'del diagrama.',
      classId: clase.id,
    });
  }

  return hallazgos;
}

/**
 * Una misma clase siendo la parte de dos composiciones distintas.
 *
 * La composición dice que la parte pertenece a un único todo y muere con él. Si
 * `Linea` está compuesta a la vez por `Pedido` y por `Factura`, la afirmación se
 * contradice sola: no puede morir con los dos. Lo normal es que una de las dos
 * quisiera ser una agregación o una asociación.
 *
 * El validador del generador vigila los ciclos de composición y la
 * multiplicidad del extremo `source`; esto no, y es un error de modelado
 * distinto.
 */
function composicionesCompartidas(diagrama: ClassDiagram): Hallazgo[] {
  const todos = new Map<Id, string[]>();

  for (const relacion of listRelations(diagrama)) {
    if (relacion.kind !== 'composition') continue;
    // El «todo» es el extremo `source`: es quien propaga el borrado
    // (`generator/src/ir/normalize.ts`).
    const dueño = diagrama.classes[relacion.source.classId];
    if (!dueño) continue;
    const lista = todos.get(relacion.target.classId) ?? [];
    lista.push(dueño.name);
    todos.set(relacion.target.classId, lista);
  }

  const hallazgos: Hallazgo[] = [];
  for (const [parteId, dueños] of todos) {
    if (dueños.length < 2) continue;
    const parte = diagrama.classes[parteId];
    if (!parte) continue;
    hallazgos.push({
      codigo: 'COMPOSICION_COMPARTIDA',
      gravedad: 'error',
      titulo: `«${parte.name}» es parte de ${dueños.length} composiciones a la vez`,
      detalle:
        `La composición significa que «${parte.name}» pertenece a un solo dueño y ` +
        `desaparece con él, pero aquí la reclaman ${dueños.join(' y ')}. ` +
        'Solo una puede ser composición; las demás son agregación o asociación.',
      classId: parte.id,
    });
  }

  return hallazgos;
}

/**
 * Un atributo de texto cuyo nombre es, en realidad, otra clase del diagrama.
 *
 * `listOfBooks: String` dentro de `Biblioteca` no es un dato: es la asociación
 * con `Book` escrita a mano dentro de la caja. Es el error que más silenciosamente
 * estropea el backend generado, porque no falla nada —sale una columna
 * `VARCHAR(255)` llamada `list_of_books`— y la relación que debía existir entre
 * las dos tablas no existe.
 *
 * Solo se dispara sobre tipos de texto. Si el atributo ya está tipado con la
 * clase, está bien puesto y no hay nada que decir.
 */
function atributosQueSonRelaciones(diagrama: ClassDiagram): Hallazgo[] {
  const clases = listClasses(diagrama);
  const porPalabra = new Map<string, UmlClass>();
  for (const clase of clases) {
    for (const palabra of palabras(clase.name)) {
      // Se indexa por la última palabra del nombre además de por el nombre
      // entero: `LibroPrestado` responde a `libro`. Con `set` sin comprobar,
      // la última clase gana; da igual cuál sea, el hallazgo dice «alguna
      // clase de este diagrama».
      porPalabra.set(singular(palabra), clase);
    }
  }

  const hallazgos: Hallazgo[] = [];
  for (const clase of clases) {
    for (const atributo of clase.attributes) {
      if (!TEXTO.has(atributo.type.name.trim().toLowerCase())) continue;

      const trozos = palabras(atributo.name);
      // «númeroDeLibros» menciona a `Libro` y aun así no es la asociación: es
      // cuántos hay. Lo que le pasa es que está guardado como texto, y de eso
      // ya se encarga la regla del tipo.
      if (trozos.some((p) => CUANTIFICADORES.has(p))) continue;

      for (const palabra of trozos) {
        const destino = porPalabra.get(singular(palabra));
        if (!destino || destino.id === clase.id) continue;
        hallazgos.push({
          codigo: 'ATRIBUTO_QUE_ES_RELACION',
          gravedad: 'aviso',
          titulo: `«${clase.name}.${atributo.name}» parece una relación con «${destino.name}», no un texto`,
          detalle:
            `«${atributo.name}» está declarado como ${atributo.type.name} y en el nombre ` +
            `menciona a «${destino.name}», que es una clase de este diagrama. Guardado así ` +
            'sale una columna de texto y las dos tablas quedan sin unir. Lo que ' +
            `describe es una asociación entre «${clase.name}» y «${destino.name}».`,
          classId: clase.id,
        });
        break; // un aviso por atributo, no uno por palabra
      }
    }
  }

  return hallazgos;
}

/**
 * Un atributo cuyo nombre promete un número, una fecha o un sí/no y está
 * declarado como texto.
 *
 * `fineAmount: String` no permite sumar la multa, `dueDate: String` no permite
 * ordenar por vencimiento y `noOfBooks: String` deja pasar «tres». Es un error de
 * modelado con consecuencia directa en la columna que se genera.
 *
 * Se limita a los tipos de texto y a un vocabulario cerrado. La familia de los
 * enteros exige nombre compuesto porque `no` suelto puede ser una negación.
 */
function tiposSospechosos(diagrama: ClassDiagram): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const clase of listClasses(diagrama)) {
    for (const atributo of clase.attributes) {
      const tipo = atributo.type.name.trim();
      if (!TEXTO.has(tipo.toLowerCase())) continue;
      // Un tipo que no está en el catálogo ya lo denuncia el validador del
      // generador; aquí solo se mira lo que es texto de verdad.
      if (!isPrimitiveType(tipo)) continue;

      const trozos = palabras(atributo.name);
      const familia = FAMILIAS.find(
        (f) =>
          !f.aceptados.has(tipo) &&
          (f.soloCompuesto !== true || trozos.length > 1) &&
          trozos.some((p) => f.palabras.has(p) || f.palabras.has(singular(p))),
      );
      if (!familia) continue;

      hallazgos.push({
        codigo: 'TIPO_SOSPECHOSO',
        gravedad: 'aviso',
        titulo: `«${clase.name}.${atributo.name}» es ${tipo}; por el nombre debería ser ${familia.esperado}`,
        detalle:
          `Guardado como ${tipo}, «${atributo.name}» no se puede sumar, comparar ni ordenar, ` +
          'y la columna admite cualquier cosa que se escriba. ' +
          `El tipo ${familia.esperado} lo impide desde la base de datos.`,
        classId: clase.id,
      });
    }
  }

  return hallazgos;
}

/**
 * Una clase sin ninguna relación.
 *
 * En un diagrama de una sola clase no significa nada, y por eso la regla se
 * calla si hay menos de dos: el aviso solo aparece cuando hay un modelo del que
 * la clase se ha quedado fuera.
 */
function clasesAisladas(diagrama: ClassDiagram): Hallazgo[] {
  const clases = listClasses(diagrama);
  if (clases.length < 2) return [];

  const conectadas = new Set<Id>();
  for (const relacion of listRelations(diagrama)) {
    conectadas.add(relacion.source.classId);
    conectadas.add(relacion.target.classId);
  }

  return clases
    .filter((clase) => !conectadas.has(clase.id))
    .map((clase) => ({
      codigo: 'CLASE_AISLADA' as const,
      gravedad: 'aviso' as const,
      titulo: `«${clase.name}» no está conectada con ninguna otra clase`,
      detalle:
        `Nada del diagrama se relaciona con «${clase.name}». O le falta la asociación ` +
        'que la une al resto, o pertenece a otro modelo y aquí sobra.',
      classId: clase.id,
    }));
}

/**
 * Una clase que es el programa, la pantalla o la base de datos, no una cosa del
 * negocio.
 *
 * El diagrama de clases del dominio describe *de qué habla* el sistema: libros,
 * socios, préstamos. `SistemaDeGestionDeBiblioteca` no es una cosa de la que
 * hable la biblioteca; es el propio programa mirándose al espejo. Suele
 * aparecer con asociaciones a todo lo demás, que es la pista de que no modela
 * nada: solo dice «esto forma parte del sistema», que ya se sabe.
 *
 * Aquí, además, tiene coste: el generador le crea tabla, repositorio, servicio y
 * CRUD REST.
 */
function clasesQueNoSonDelDominio(diagrama: ClassDiagram): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const clase of listClasses(diagrama)) {
    if (clase.kind === 'interface' || clase.kind === 'enum') continue;

    const culpable = palabras(clase.name).find((p) => PALABRAS_TECNICAS.has(p));
    if (culpable === undefined) continue;

    hallazgos.push({
      codigo: 'CLASE_NO_ES_DEL_DOMINIO',
      gravedad: 'aviso',
      titulo: `«${clase.name}» parece una pieza del programa, no una cosa del negocio`,
      detalle:
        `La palabra «${culpable}» del nombre apunta a la implementación —el sistema, ` +
        'la pantalla, dónde se guardan los datos— y no a algo de lo que hable el ' +
        'dominio. En un diagrama de clases de análisis esas piezas no se dibujan: ' +
        `el generador le crearía tabla, repositorio y API a «${clase.name}» como a ` +
        'cualquier entidad.',
      classId: clase.id,
    });
  }

  return hallazgos;
}

/** Clave estable para el par de clases de una relación, sin importar el orden. */
function parDeClases(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Dos relaciones del mismo tipo entre el mismo par de clases y sin rol que las
 * distinga.
 *
 * Dos asociaciones entre `Persona` y `Libro` son perfectamente correctas si una
 * es `autor` y la otra `revisor`: son dos hechos distintos. Sin rol en ninguna
 * de las dos no hay nada que las distinga y lo que hay es una línea dibujada dos
 * veces —normalmente al arrastrar sin querer— que el generador convertirá en dos
 * columnas iguales.
 *
 * Esa condición sobre el rol es la que evita el falso positivo, y por eso la
 * regla se queda en aviso: la que sobra puede ser cualquiera de las dos.
 */
function relacionesDuplicadas(diagrama: ClassDiagram): Hallazgo[] {
  const vistas = new Map<string, string>();
  const hallazgos: Hallazgo[] = [];

  for (const relacion of listRelations(diagrama)) {
    const origen = diagrama.classes[relacion.source.classId];
    const destino = diagrama.classes[relacion.target.classId];
    if (!origen || !destino) continue;

    const conRol =
      (relacion.source.role ?? '') !== '' || (relacion.target.role ?? '') !== '';
    if (conRol) continue;

    const clave = `${relacion.kind}:${parDeClases(relacion.source.classId, relacion.target.classId)}`;
    if (!vistas.has(clave)) {
      vistas.set(clave, relacion.id);
      continue;
    }

    hallazgos.push({
      codigo: 'RELACION_DUPLICADA',
      gravedad: 'aviso',
      titulo: `«${origen.name}» y «${destino.name}» están unidas dos veces de la misma forma`,
      detalle:
        'Hay dos relaciones del mismo tipo entre estas dos clases y ninguna lleva rol, ' +
        'así que no representan hechos distintos. Si son dos vínculos de verdad ' +
        '—autor y revisor, por ejemplo— conviene ponerles nombre de rol; si no, sobra una.',
      classId: origen.id,
      relationId: relacion.id,
    });
  }

  return hallazgos;
}

/**
 * Una asociación de muchos a muchos.
 *
 * No está mal en sí, y por eso es sugerencia y no aviso. Pero en cuanto la
 * relación tiene datos propios —la fecha del préstamo, la nota de la
 * matrícula, la cantidad de la línea de pedido— la tabla intermedia que el
 * generador crea no tiene dónde ponerlos, y es justo lo que se pide en la
 * corrección de un diagrama de biblioteca.
 */
function muchosAMuchosSinClase(diagrama: ClassDiagram): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const relacion of listRelations(diagrama)) {
    if (relacion.kind !== 'association' && relacion.kind !== 'aggregation') continue;
    if (!isToMany(relacion.source.multiplicity) || !isToMany(relacion.target.multiplicity)) continue;

    const origen = diagrama.classes[relacion.source.classId];
    const destino = diagrama.classes[relacion.target.classId];
    if (!origen || !destino) continue;

    hallazgos.push({
      codigo: 'MUCHOS_A_MUCHOS_SIN_CLASE',
      gravedad: 'sugerencia',
      titulo: `«${origen.name}» y «${destino.name}» se relacionan de muchos a muchos`,
      detalle:
        `Si el vínculo entre «${origen.name}» y «${destino.name}» tiene datos propios ` +
        '—una fecha, una cantidad, un estado— no hay dónde guardarlos: la tabla ' +
        'intermedia que se genera solo lleva las dos claves. En ese caso el vínculo ' +
        'es una clase más. Si no los tiene, está bien como está.',
      classId: origen.id,
      relationId: relacion.id,
    });
  }

  return hallazgos;
}
