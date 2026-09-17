import * as Y from 'yjs';
import {
  isPersistent,
  listClasses,
  listRelations,
  type ClassDiagram,
  type Id,
  type UmlClass,
} from '../model/uml.js';
import { isPrimitiveType, isValidIdentifierType, resolveTypeName } from '../model/type-catalog.js';
import {
  isValidJavaIdentifier,
  isValidSqlIdentifier,
  toCamelCase,
  toPascalCase,
  toSnakeCase,
} from '../model/naming.js';
import type { Operation } from '../ops/operations.js';
import { initializeDiagram, readDiagram } from '../crdt/document.js';
import { applyOperations } from '../crdt/operations.js';
import { validateDiagram, type ValidationIssue } from '../validation/validate.js';

/**
 * Reparación automática de lo que impide generar el backend.
 *
 * ## El problema que resuelve
 *
 * `validateDiagram` sabe decir que un diagrama no se puede generar y por qué.
 * Eso bastaba mientras el diagrama lo dibujaba quien lo iba a corregir: ve
 * «`Customer.name` generaría la columna `name`, reservada en PostgreSQL», abre
 * el panel de propiedades y lo renombra. Seis errores son seis minutos.
 *
 * Deja de bastar en cuanto el diagrama llega de fuera. Una foto de una pizarra
 * ajena entra con errores mecánicos a puñados —claves primarias de tipo fecha,
 * columnas llamadas `name`, `type` u `order`, tipos que el OCR leyó como
 * `Money`— y ninguno de ellos requiere una decisión: hay una única forma
 * sensata de arreglar cada uno, y es siempre la misma. Hacerlos a mano es
 * teclear lo que el programa ya sabe.
 *
 * ## Lo que NO hace, y por qué importa
 *
 * No se aplica solo. `planificarReparacion` devuelve un plan; aplicarlo es una
 * llamada aparte que hace la interfaz cuando alguien pulsa un botón, después de
 * enseñar la lista entera de cambios. Esa separación es deliberada y responde a
 * la regla que encabeza `model/naming.ts`: un nombre escrito por una persona
 * que sabe que es un identificador no se corrige a su espalda, se le dice. Aquí
 * se le dice —cada arreglo lleva qué se cambia y por qué— y luego decide.
 *
 * Tampoco inventa criterio. Solo repara aquello cuyo arreglo es único y
 * mecánico. Que dos clases generen el mismo tipo Java, que una enumeración esté
 * vacía, que haya herencia múltiple o un ciclo de composición son problemas de
 * modelado con varias salidas posibles, y elegir una por su cuenta cambiaría el
 * significado del diagrama. Esos salen en `irreparables`, con su mensaje, para
 * que se arreglen a mano.
 *
 * ## Cómo se construye el plan
 *
 * Por rondas, y sobre el diagrama, no sobre la lista de errores.
 *
 * Sobre el diagrama porque los `ValidationIssue` identifican la *clase*
 * afectada, no el atributo: sacar el atributo del mensaje obligaría a analizar
 * prosa, y el día que alguien reescriba un mensaje se rompería en silencio.
 * Cada regla de aquí abajo vuelve a recorrer el modelo con el mismo predicado
 * que usa el validador —`isValidSqlIdentifier(toSnakeCase(…))`, no una copia—,
 * así que lo que se repite es el recorrido, nunca el criterio.
 *
 * Por rondas porque los arreglos se encadenan. Desmarcar `Order.date` como
 * clave primaria —tipo fecha, JPA no la admite— deja a `Order` sin ninguna, que
 * es un error que **todavía no existía** cuando se planificó el primero. Una
 * sola pasada dejaría el diagrama peor que antes. Cada ronda aplica lo suyo
 * sobre una copia, vuelve a validar y mira qué ha aparecido; el bucle termina
 * cuando no quedan errores o cuando una ronda no consigue proponer nada.
 *
 * La copia se hace montando un documento Yjs de usar y tirar y pasándole las
 * operaciones por `applyOperations`, el mismo camino que recorren el ratón, el
 * asistente de voz y la importación de XMI. Simular con un aplicador propio
 * sería más rápido y mentiría: el plan quedaría validado contra una semántica
 * que no es la que se va a ejecutar.
 *
 * ## Sin red
 *
 * Función pura: diagrama entra, plan sale. Ni modelo de lenguaje ni servidor,
 * así que el botón funciona con el portátil desconectado y contesta en el acto.
 */

/** Un cambio concreto, con su porqué y las operaciones que lo ejecutan. */
export interface Arreglo {
  /** El código de `validateDiagram` que este arreglo apaga. */
  codigo: string;
  /** Qué se va a cambiar, en una línea y con los nombres del diagrama dentro. */
  titulo: string;
  /** Por qué se hace así, y qué implica. */
  detalle: string;
  /** Las operaciones, en el orden en que hay que aplicarlas. */
  operaciones: Operation[];
  /** Clase afectada, para poder llevar la vista hasta ella. */
  classId?: Id;
}

export interface PlanReparacion {
  arreglos: Arreglo[];
  /** Todas las operaciones del plan, ya en orden. Es lo que se aplica. */
  operaciones: Operation[];
  /** Errores que no admiten un arreglo único: hay que decidirlos a mano. */
  irreparables: ValidationIssue[];
  /** Cuántos errores había antes de reparar. */
  erroresAntes: number;
}

/**
 * Tope de rondas.
 *
 * Cinco es holgado: la cadena más larga que se ha visto tiene dos eslabones
 * (desmarcar la clave inválida, añadir la que falta). Existe porque una regla
 * mal escrita que proponga un arreglo que no arregla nada colgaría el bucle, y
 * un botón que no responde es peor que un botón que repara de menos.
 */
const MAX_RONDAS = 5;

export function planificarReparacion(diagrama: ClassDiagram): PlanReparacion {
  const erroresAntes = validateDiagram(diagrama).errors.length;
  const arreglos: Arreglo[] = [];
  let actual = diagrama;

  for (let ronda = 0; ronda < MAX_RONDAS; ronda += 1) {
    if (validateDiagram(actual).ok) break;

    const nuevos = proponerRonda(actual);
    if (nuevos.length === 0) break;

    arreglos.push(...nuevos);
    actual = simular(
      actual,
      nuevos.flatMap((a) => a.operaciones),
    );
  }

  return {
    arreglos,
    operaciones: arreglos.flatMap((a) => a.operaciones),
    irreparables: validateDiagram(actual).errors,
    erroresAntes,
  };
}

/**
 * Aplica un plan sobre una copia y devuelve el diagrama resultante.
 *
 * Se exporta porque es lo que permite a una prueba —y a la pantalla, si algún
 * día enseña un antes y un después— comprobar el resultado sin tocar el
 * documento de verdad.
 */
export function simular(diagrama: ClassDiagram, operaciones: Operation[]): ClassDiagram {
  if (operaciones.length === 0) return diagrama;
  const doc = new Y.Doc();
  initializeDiagram(doc, diagrama);
  applyOperations(doc, operaciones);
  return readDiagram(doc);
}

// ---------------------------------------------------------------------------
// Una ronda
// ---------------------------------------------------------------------------

/**
 * Las reglas, en el orden en que se aplican dentro de una ronda.
 *
 * El orden importa poco porque las rondas se encargan de las dependencias, pero
 * sí importa que las que renombran vayan antes que las que tocan banderas: un
 * atributo renombrado cambia de nombre, y `updateAttribute` lo busca por él.
 * `tocados` impide que dos reglas se peleen por el mismo atributo en la misma
 * ronda; la que se quede fuera entrará en la siguiente, ya con el nombre nuevo.
 */
type Regla = (diagrama: ClassDiagram, tocados: Set<string>) => Arreglo[];

const REGLAS: Regla[] = [
  relacionesColgantes,
  nombresDeAtributoNoValidos,
  columnasReservadas,
  atributosDuplicados,
  tiposDesconocidos,
  subclasesQueDeclaranIdentidad,
  identificadoresDeTipoInvalido,
  identificadoresDeMas,
  entidadesSinIdentificador,
  composicionesConMuchosEnElTodo,
];

function proponerRonda(diagrama: ClassDiagram): Arreglo[] {
  const tocados = new Set<string>();
  return REGLAS.flatMap((regla) => regla(diagrama, tocados));
}

/** Marca de «este atributo ya tiene un arreglo en esta ronda». */
function marca(claseId: Id, atributo?: string): string {
  return atributo === undefined ? claseId : `${claseId}#${atributo.toLowerCase()}`;
}

/**
 * Reserva un atributo para esta ronda. Devuelve `false` si ya estaba cogido,
 * y en ese caso la regla que llama se calla y espera a la ronda siguiente.
 */
function reservar(tocados: Set<string>, claseId: Id, atributo?: string): boolean {
  const clave = marca(claseId, atributo);
  // Un arreglo que toca la clase entera bloquea también sus atributos, y al
  // revés: renombrar un atributo y borrar la clase en la misma tanda es una
  // contradicción, no dos arreglos.
  if (tocados.has(clave) || tocados.has(claseId)) return false;
  tocados.add(clave);
  return true;
}

// ---------------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------------

/**
 * Un nombre libre dentro de la clase, partiendo del propuesto.
 *
 * Compara sin distinguir mayúsculas porque el validador también lo hace
 * (`ATTRIBUTE_NAME_COLLISION` usa `toLowerCase`) y porque dos campos que solo
 * se diferencian en la caja son un accidente, no un modelo.
 */
function nombreLibre(clase: UmlClass, propuesto: string, excluir?: string): string {
  const ocupados = new Set(
    clase.attributes
      .filter((a) => a.name.toLowerCase() !== excluir?.toLowerCase())
      .map((a) => a.name.toLowerCase()),
  );

  const valido = (n: string): boolean =>
    isValidJavaIdentifier(n) && isValidSqlIdentifier(toSnakeCase(n)) && !ocupados.has(n.toLowerCase());

  if (valido(propuesto)) return propuesto;
  for (let i = 2; i < 100; i += 1) {
    const candidato = `${propuesto}${String(i)}`;
    if (valido(candidato)) return candidato;
  }
  // Inalcanzable en la práctica: haría falta una clase con noventa y nueve
  // atributos homónimos. Se devuelve algo válido en vez de lanzar porque este
  // camino no merece un modo de fallo propio.
  return `${propuesto}${String(Date.now() % 100000)}`;
}

/**
 * El nombre transliterado, para cuando el original no es un identificador Java.
 *
 * `toSnakeCase` es quien translitera en este paquete —`toCamelCase` no lo hace,
 * y con razón: produce nombres de campo que deben llegar intactos al
 * validador—. Pasar por él y volver es lo que convierte `dirección` en
 * `direccion` y `fecha alta` en `fechaAlta`.
 */
function comoIdentificador(nombre: string): string {
  return toCamelCase(toSnakeCase(nombre));
}

// ---------------------------------------------------------------------------
// Reglas
// ---------------------------------------------------------------------------

/**
 * Una relación que apunta a una clase que ya no existe.
 *
 * Es el único borrado que hace este módulo, y se permite porque no borra
 * información: la relación ya no une nada. Suele quedar de un `removeClass` que
 * se sincronizó a medias entre dos participantes sin conexión.
 */
function relacionesColgantes(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const relacion of listRelations(diagrama)) {
    const origen = diagrama.classes[relacion.source.classId];
    const destino = diagrama.classes[relacion.target.classId];
    if (origen && destino) continue;
    if (!reservar(tocados, relacion.id)) continue;

    const cual = origen?.name ?? destino?.name;
    arreglos.push({
      codigo: 'DANGLING_RELATION',
      titulo: 'Quitar una relación que apunta a una clase borrada',
      detalle:
        (cual === undefined
          ? 'Esta relación no une ninguna de las dos puntas con una clase del diagrama. '
          : `Esta relación sale de «${cual}» y llega a una clase que ya no está en el diagrama. `) +
        'No se pierde nada al quitarla: ya no representa ningún vínculo.',
      operaciones: [{ op: 'removeRelation', id: relacion.id }],
    });
  }

  return arreglos;
}

/**
 * Un atributo cuyo nombre no es un identificador Java.
 *
 * Casi siempre es una tilde o un espacio, y casi siempre viene de una foto:
 * `dirección`, `fecha alta`, `nº pedido`. La transliteración es la única salida
 * mecánica —`direccion`, `fechaAlta`— y no cambia lo que el nombre significa.
 *
 * Si lo que sobra no es un diacrítico sino algo que no se sabe convertir, el
 * resultado tampoco será válido y la regla se calla: prefiere no tocarlo a
 * dejar un nombre distinto y también roto. Ese caso acaba en `irreparables`,
 * que es donde debe estar.
 */
function nombresDeAtributoNoValidos(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    for (const atributo of clase.attributes) {
      if (isValidJavaIdentifier(atributo.name)) continue;

      const propuesto = comoIdentificador(atributo.name);
      if (propuesto === '' || !isValidJavaIdentifier(propuesto)) continue;
      if (!reservar(tocados, clase.id, atributo.name)) continue;

      const nuevo = nombreLibre(clase, propuesto, atributo.name);
      arreglos.push({
        codigo: 'INVALID_ATTRIBUTE_NAME',
        titulo: `«${clase.name}»: renombrar «${atributo.name}» a «${nuevo}»`,
        detalle:
          `«${atributo.name}» no es un nombre de campo válido en Java, así que la entidad ` +
          `no compila. «${nuevo}» dice lo mismo sin tildes ni espacios; la etiqueta que ve ` +
          'el usuario final del backend generado no depende de esto.',
        operaciones: [
          {
            op: 'updateAttribute',
            classRef: { id: clase.id },
            attributeName: atributo.name,
            changes: { name: nuevo },
          },
        ],
        classId: clase.id,
      });
    }
  }

  return arreglos;
}

/**
 * Un atributo cuya columna chocaría con una palabra reservada de PostgreSQL.
 *
 * `name`, `type`, `order`, `key`, `value`, `user`… La lista está en
 * `model/naming.ts` y es la misma que consulta el validador.
 *
 * El nombre nuevo antepone el de la clase: `Customer.name` pasa a
 * `customerName` y su columna a `customer_name`. Es redundante leído dentro de
 * la tabla `customers`, y es a propósito: cualquier otra elección —`fullName`,
 * `nombreCompleto`— sería una interpretación de qué significa ese campo, y eso
 * no lo sabe el programa. El prefijo es predecible, nunca se equivoca de
 * significado y no colisiona con nada que no colisionara ya.
 */
function columnasReservadas(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    if (!isPersistent(clase)) continue;

    for (const atributo of clase.attributes) {
      // Si el nombre ni siquiera es Java válido, de eso se ocupa la regla
      // anterior; encadenar los dos cambios en una ronda solo confundiría la
      // lista de cambios que se le enseña a quien pulsa el botón.
      if (!isValidJavaIdentifier(atributo.name)) continue;
      if (isValidSqlIdentifier(toSnakeCase(atributo.name))) continue;
      if (!reservar(tocados, clase.id, atributo.name)) continue;

      const propuesto = `${toCamelCase(clase.name)}${toPascalCase(atributo.name)}`;
      const nuevo = nombreLibre(clase, propuesto, atributo.name);

      arreglos.push({
        codigo: 'INVALID_COLUMN_NAME',
        titulo: `«${clase.name}»: renombrar «${atributo.name}» a «${nuevo}»`,
        detalle:
          `La columna «${toSnakeCase(atributo.name)}» es palabra reservada en PostgreSQL: ` +
          'cualquier consulta que la nombre sin comillas falla. Se antepone el nombre de la ' +
          `clase —«${nuevo}», columna «${toSnakeCase(nuevo)}»— porque es la única forma de ` +
          'esquivarla sin inventarse qué significa el campo.',
        operaciones: [
          {
            op: 'updateAttribute',
            classRef: { id: clase.id },
            attributeName: atributo.name,
            changes: { name: nuevo },
          },
        ],
        classId: clase.id,
      });
    }
  }

  return arreglos;
}

/**
 * Dos atributos de la misma clase que se llaman igual.
 *
 * Se renombra el segundo y los siguientes, nunca el primero: quien mira el
 * diagrama espera que el de arriba se quede como está. El sufijo numérico es
 * feo a propósito —`precio2` pide que alguien lo mire— porque aquí sí hay algo
 * que decidir: casi siempre uno de los dos sobra, y borrarlo por su cuenta sí
 * sería perder información.
 */
function atributosDuplicados(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    const vistos = new Set<string>();

    for (const atributo of clase.attributes) {
      const clave = atributo.name.toLowerCase();
      if (!vistos.has(clave)) {
        vistos.add(clave);
        continue;
      }
      if (!reservar(tocados, clase.id, atributo.name)) continue;

      const nuevo = nombreLibre(clase, atributo.name);
      vistos.add(nuevo.toLowerCase());

      arreglos.push({
        codigo: 'ATTRIBUTE_NAME_COLLISION',
        titulo: `«${clase.name}»: renombrar el segundo «${atributo.name}» a «${nuevo}»`,
        detalle:
          `«${clase.name}» tiene dos atributos llamados «${atributo.name}» y la clase Java ` +
          'no puede declarar el mismo campo dos veces. Se renombra el segundo para no ' +
          'perderlo, pero conviene mirarlo: lo normal es que uno de los dos sobre.',
        operaciones: [
          {
            op: 'updateAttribute',
            classRef: { id: clase.id },
            attributeName: atributo.name,
            changes: { name: nuevo },
          },
        ],
        classId: clase.id,
      });
    }
  }

  return arreglos;
}

/**
 * Un atributo con un tipo que no está en el catálogo ni es una clase.
 *
 * `Money`, `Texto largo`, `varchar(50)`, `imagen`. El catálogo ya resuelve
 * muchísimos alias, en castellano incluidos (`model/type-catalog.ts`), así que
 * lo que llega hasta aquí es de verdad desconocido.
 *
 * Se cae a `String`, que es el único tipo que admite cualquier contenido sin
 * perderlo. Y por eso este arreglo lleva la advertencia dentro: `String` hace
 * que el proyecto compile, no que el modelo esté bien. Un importe en `String`
 * no se puede sumar. Es una decisión que hay que revisar, y el texto lo dice en
 * vez de dejarlo caer.
 */
function tiposDesconocidos(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const nombresDeClase = new Set(listClasses(diagrama).map((c) => toPascalCase(c.name)));
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    for (const atributo of clase.attributes) {
      const tipo = atributo.type.name;
      if (isPrimitiveType(tipo) || nombresDeClase.has(toPascalCase(tipo))) continue;
      if (!reservar(tocados, clase.id, atributo.name)) continue;

      arreglos.push({
        codigo: 'UNKNOWN_TYPE',
        titulo: `«${clase.name}.${atributo.name}»: cambiar el tipo «${tipo}» por String`,
        detalle:
          `«${tipo}» no está en el catálogo de tipos ni es una clase de este diagrama, así ` +
          'que no hay a qué tipo de Java traducirlo. String acepta cualquier contenido y ' +
          'desbloquea la generación. Merece un repaso: si era un importe o una fecha, ' +
          'guardado como texto no se podrá sumar ni ordenar.',
        operaciones: [
          {
            op: 'updateAttribute',
            classRef: { id: clase.id },
            attributeName: atributo.name,
            changes: { type: 'String' },
          },
        ],
        classId: clase.id,
      });
    }
  }

  return arreglos;
}

/** Los ancestros de una clase por herencia, del padre hacia arriba. */
function ascendencia(diagrama: ClassDiagram, clase: UmlClass): UmlClass[] {
  const cadena: UmlClass[] = [];
  const vistos = new Set<Id>([clase.id]);
  let actual: UmlClass | undefined = clase;

  for (;;) {
    const relacion = listRelations(diagrama).find(
      (r) => r.kind === 'inheritance' && r.source.classId === actual?.id,
    );
    if (!relacion) break;
    const padre = diagrama.classes[relacion.target.classId];
    // El corte por `vistos` no sobra: un ciclo de herencia es un diagrama que
    // el validador rechaza, y esto se ejecuta justo sobre diagramas rechazados.
    if (!padre || vistos.has(padre.id)) break;
    cadena.push(padre);
    vistos.add(padre.id);
    actual = padre;
  }

  return cadena;
}

/** Si algún ancestro declara clave primaria. Equivale a `hasInheritedIdentifier`. */
function heredaIdentidad(diagrama: ClassDiagram, clase: UmlClass): boolean {
  return ascendencia(diagrama, clase).some((a) => a.attributes.some((x) => x.isIdentifier));
}

/**
 * Una subclase que vuelve a declarar la clave primaria que ya hereda.
 *
 * El porqué completo —incluido que el atributo desaparece del Java generado—
 * está en `SUBCLASS_DECLARES_IDENTIFIER`, en el validador. El arreglo es
 * desmarcar: el atributo se queda, deja de ser identidad y pasa a ser lo que
 * siempre fue, un dato de la subclase.
 */
function subclasesQueDeclaranIdentidad(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    if (!isPersistent(clase)) continue;
    if (!heredaIdentidad(diagrama, clase)) continue;

    const padre = ascendencia(diagrama, clase)[0];
    for (const atributo of clase.attributes.filter((a) => a.isIdentifier)) {
      if (!reservar(tocados, clase.id, atributo.name)) continue;

      arreglos.push({
        codigo: 'SUBCLASS_DECLARES_IDENTIFIER',
        titulo: `«${clase.name}»: dejar de usar «${atributo.name}» como clave primaria`,
        detalle:
          `«${clase.name}» ya hereda la clave primaria${padre ? ` de «${padre.name}»` : ''}. ` +
          `Manteniendo «${atributo.name}» marcado, el generador lo convierte en la columna ` +
          'que enlaza con la tabla padre y el campo desaparece de la clase Java: el dato se ' +
          'pierde sin avisar. Desmarcado, sigue siendo un atributo normal.',
        operaciones: [
          {
            op: 'updateAttribute',
            classRef: { id: clase.id },
            attributeName: atributo.name,
            changes: { isIdentifier: false, isNullable: true },
          },
        ],
        classId: clase.id,
      });
    }
  }

  return arreglos;
}

/**
 * Una clave primaria de un tipo que JPA no admite: fecha, importe, booleano.
 *
 * Es el patrón de examen más repetido: `Pedido` con la fecha como clave,
 * `Payment` con el importe. Y no es solo un problema de JPA —que solo acepta
 * `Long`, `Integer`, `UUID` o `String`—: dos pedidos del mismo día serían el
 * mismo pedido.
 *
 * Se desmarca y punto. La clave que falta la pone `entidadesSinIdentificador`
 * en la ronda siguiente, cuando el error ya existe; hacer las dos cosas a la
 * vez aquí sería adelantarse a una comprobación que todavía no se ha hecho.
 *
 * Se pasa a `isNullable: true` porque el validador fuerza `nullable: false` en
 * los identificadores: sin eso, un `NOT NULL` heredado de haber sido clave se
 * quedaría puesto sin que nadie lo hubiera pedido.
 */
function identificadoresDeTipoInvalido(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    if (!isPersistent(clase)) continue;

    for (const atributo of clase.attributes) {
      if (!atributo.isIdentifier) continue;
      // Un tipo que no existe lo arregla `tiposDesconocidos`; si además era
      // clave, la ronda siguiente verá el String y lo dará por bueno.
      if (!isPrimitiveType(atributo.type.name)) continue;
      if (isValidIdentifierType(atributo.type.name)) continue;
      if (!reservar(tocados, clase.id, atributo.name)) continue;

      const canonico = resolveTypeName(atributo.type.name) ?? atributo.type.name;
      arreglos.push({
        codigo: 'INVALID_IDENTIFIER_TYPE',
        titulo: `«${clase.name}»: dejar de usar «${atributo.name}» (${canonico}) como clave primaria`,
        detalle:
          `Una clave primaria de tipo ${canonico} no la admite JPA, que solo genera claves ` +
          `Long, Integer, UUID o String. Y como identidad tampoco se sostiene: dos ` +
          `«${clase.name}» con el mismo ${atributo.name} serían la misma fila. El atributo ` +
          'se conserva como dato; la clave se añade aparte.',
        operaciones: [
          {
            op: 'updateAttribute',
            classRef: { id: clase.id },
            attributeName: atributo.name,
            changes: { isIdentifier: false, isNullable: true },
          },
        ],
        classId: clase.id,
      });
    }
  }

  return arreglos;
}

/** Preferencia entre candidatos a clave, de mejor a peor. */
const PREFERENCIA_CLAVE = ['Long', 'Integer', 'UUID', 'String'];

/**
 * Una clase con más de un atributo marcado como identificador.
 *
 * Las claves compuestas no están soportadas, así que hay que quedarse con una.
 * Se elige por tipo —`Long` antes que `Integer`, y `String` la última— y, a
 * igualdad, la primera declarada. No se elige «la que parezca el id» por el
 * nombre: eso es adivinar, y aquí adivinar cambia qué fila es cuál.
 */
function identificadoresDeMas(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    if (!isPersistent(clase) || clase.kind === 'abstract') continue;

    const claves = clase.attributes.filter((a) => a.isIdentifier);
    if (claves.length < 2) continue;

    const puntuar = (nombreTipo: string): number => {
      const canonico = resolveTypeName(nombreTipo);
      const posicion = canonico ? PREFERENCIA_CLAVE.indexOf(canonico) : -1;
      return posicion === -1 ? PREFERENCIA_CLAVE.length : posicion;
    };

    // `reduce` y no `sort`: hace falta el primero en caso de empate, y ordenar
    // una copia para quedarse con la cabeza dice menos de lo que hace.
    const elegida = claves.reduce((mejor, a) =>
      puntuar(a.type.name) < puntuar(mejor.type.name) ? a : mejor,
    );

    for (const atributo of claves) {
      if (atributo.name === elegida.name) continue;
      if (!reservar(tocados, clase.id, atributo.name)) continue;

      arreglos.push({
        codigo: 'MULTIPLE_IDENTIFIERS',
        titulo: `«${clase.name}»: dejar «${elegida.name}» como única clave y desmarcar «${atributo.name}»`,
        detalle:
          `«${clase.name}» tiene ${String(claves.length)} atributos marcados como clave ` +
          'primaria y las claves compuestas no están soportadas. Se conserva ' +
          `«${elegida.name}» por ser de tipo ${resolveTypeName(elegida.type.name) ?? elegida.type.name}, ` +
          `el más apropiado de los que hay. «${atributo.name}» sigue en la clase como dato.`,
        operaciones: [
          {
            op: 'updateAttribute',
            classRef: { id: clase.id },
            attributeName: atributo.name,
            changes: { isIdentifier: false, isNullable: true },
          },
        ],
        classId: clase.id,
      });
    }
  }

  return arreglos;
}

/**
 * Una entidad sin clave primaria propia ni heredada.
 *
 * Se le añade una: `<clase>Id` de tipo `Long`. Es lo que el propio mensaje del
 * validador sugiere, y es lo que habría escrito a mano quien dibujó el
 * diagrama; un diagrama de análisis rara vez pinta la clave porque se da por
 * supuesta, y aquí hay que escribirla.
 *
 * El nombre lleva el de la clase por delante —`pedidoId`, no `id`— para que la
 * columna sea `pedido_id` y la clave ajena que la referencia se llame igual en
 * las dos tablas. Con `id` a secas, cada tabla tiene una columna `id` y las
 * consultas escritas a mano se vuelven un juego de adivinanzas.
 */
function entidadesSinIdentificador(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const clase of listClasses(diagrama)) {
    if (!isPersistent(clase) || clase.kind === 'abstract') continue;
    if (clase.attributes.some((a) => a.isIdentifier)) continue;
    if (heredaIdentidad(diagrama, clase)) continue;
    if (!reservar(tocados, clase.id)) continue;

    const nuevo = nombreLibre(clase, `${toCamelCase(clase.name)}Id`);
    arreglos.push({
      codigo: 'MISSING_IDENTIFIER',
      titulo: `«${clase.name}»: añadir la clave primaria «${nuevo}» (Long)`,
      detalle:
        `JPA no sabe mapear «${clase.name}» sin clave primaria. Se añade «${nuevo}» de tipo ` +
        'Long, que el backend generado rellena solo con un contador de la base de datos. ' +
        'No sustituye a ningún dato del diagrama: se suma a los que ya hay.',
      operaciones: [
        {
          op: 'addAttribute',
          classRef: { id: clase.id },
          name: nuevo,
          type: 'Long',
          visibility: '-',
          isIdentifier: true,
          isNullable: false,
          isUnique: true,
        },
      ],
      classId: clase.id,
    });
  }

  return arreglos;
}

/**
 * Una composición cuyo lado del todo admite varios.
 *
 * La composición afirma que la parte pertenece a un único todo y muere con él.
 * Con `*` en el lado del todo la afirmación se contradice sola, y el generador
 * no tiene qué emitir.
 *
 * Se corrige la multiplicidad a `1` en vez de degradar la relación a agregación
 * porque es el cambio menor: conserva lo que la flecha quiere decir. Quien
 * quería una agregación tiene el desplegable a mano.
 */
function composicionesConMuchosEnElTodo(diagrama: ClassDiagram, tocados: Set<string>): Arreglo[] {
  const arreglos: Arreglo[] = [];

  for (const relacion of listRelations(diagrama)) {
    if (relacion.kind !== 'composition') continue;

    const { lower, upper } = multiplicidad(relacion.source.multiplicity);
    if (upper !== null && upper <= 1) continue;

    const origen = diagrama.classes[relacion.source.classId];
    const destino = diagrama.classes[relacion.target.classId];
    if (!origen || !destino) continue;
    if (!reservar(tocados, relacion.id)) continue;

    // `0..1` si la parte podía existir sin todo, `1` si no: se respeta la cota
    // inferior que ya estaba en vez de imponer una.
    const nueva = lower === 0 ? '0..1' : '1';
    arreglos.push({
      codigo: 'INVALID_COMPOSITION_MULTIPLICITY',
      titulo: `«${origen.name}» → «${destino.name}»: poner ${nueva} en el lado del todo`,
      detalle:
        `La composición dice que cada «${destino.name}» pertenece a un solo «${origen.name}» ` +
        `y desaparece con él, pero el extremo está en «${relacion.source.multiplicity}». ` +
        `Con ${nueva} la relación afirma lo que la composición significa. Si de verdad ` +
        `un «${destino.name}» puede estar en varios «${origen.name}», lo que hace falta es ` +
        'una agregación, y eso se cambia en el panel de la relación.',
      operaciones: [
        { op: 'updateRelation', id: relacion.id, changes: { sourceMultiplicity: nueva } },
      ],
    });
  }

  return arreglos;
}

/** `parseMultiplicity` sin importar el módulo entero por una línea. */
function multiplicidad(valor: string): { lower: number; upper: number | null } {
  if (valor === '*') return { lower: 0, upper: null };
  if (!valor.includes('..')) {
    const n = Number.parseInt(valor, 10);
    return { lower: n, upper: n };
  }
  const [bajo, alto] = valor.split('..') as [string, string];
  return { lower: Number.parseInt(bajo, 10), upper: alto === '*' ? null : Number.parseInt(alto, 10) };
}
