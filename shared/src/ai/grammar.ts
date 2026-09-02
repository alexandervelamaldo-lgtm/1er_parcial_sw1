import type { AssistantResponse } from '../ops/operations.js';
import type { Operation } from '../ops/operations.js';
import { toCamelCase, toPascalCase } from '../model/naming.js';
import { resolveTypeName } from '../model/type-catalog.js';

/**
 * Gramática de órdenes en castellano.
 *
 * Es el intérprete que funciona sin red (decisión D5, RF-OFF-03). No pretende
 * entender lenguaje natural: reconoce un repertorio cerrado de construcciones y
 * dice claramente cuándo no ha entendido. Esa es justamente la propiedad que se
 * busca offline —una respuesta predecible— frente a un modelo que, sin poder
 * consultarse, tendría que adivinar.
 *
 * Produce las mismas `Operation` que el modelo del servidor, así que el resto de
 * la aplicación no distingue de dónde vino una propuesta.
 */

const ACCENTS: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
};

/**
 * Normaliza para comparar sin depender de cómo se dicte o se teclee.
 *
 * Sustituye carácter a carácter en vez de usar `normalize('NFD')` a propósito:
 * la descomposición cambia la longitud del texto y entonces las posiciones que
 * devuelve la expresión regular ya no sirven para recortar el original, que es
 * de donde hay que sacar los nombres para no perder las tildes.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[áéíóúüñ]/g, (character) => ACCENTS[character] ?? character);
}

/** Deja el texto en una sola línea y sin signos que estorben al reconocimiento. */
function tidy(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[¿?¡!]/g, '');
}

interface Rule {
  pattern: RegExp;
  build(groups: Record<string, string>): Operation[] | null;
  confidence: number;
}

const CLASS_KIND: Record<string, 'class' | 'interface' | 'enum' | 'abstract'> = {
  clase: 'class',
  entidad: 'class',
  interfaz: 'interface',
  interface: 'interface',
  enum: 'enum',
  enumeracion: 'enum',
  'clase abstracta': 'abstract',
  abstracta: 'abstract',
};

/**
 * Ordinales dictados, en su forma ya plegada (sin tildes): quien dicta dice «la
 * séptima fila» y el reconocimiento de voz lo transcribe como palabra, no como
 * número. Se corta en el décimo a propósito: más allá nadie cuenta filas de
 * cabeza, y quien lo necesite dicta el número.
 */
const ORDINALES: Record<string, number> = {
  primera: 1,
  segunda: 2,
  tercera: 3,
  cuarta: 4,
  quinta: 5,
  sexta: 6,
  septima: 7,
  octava: 8,
  novena: 9,
  decima: 10,
};

/**
 * Los nombres se toman del texto original, no de la versión sin acentos: el
 * usuario puede querer una clase «Créditos» y perder la tilde cambiaría el
 * nombre que ve en el lienzo.
 */
function className(raw: string): string {
  return toPascalCase(raw.trim());
}

function attributeName(raw: string): string {
  return toCamelCase(raw.trim());
}

/** Traduce el tipo dicho en castellano al del catálogo («texto» → `String`). */
function typeName(raw: string): string {
  return resolveTypeName(raw.trim()) ?? toPascalCase(raw.trim());
}

/** «total de tipo Double», dentro de una enumeración de atributos. */
const FIELD_ITEM =
  /^(?<field>[\w áéíóúñ]+?)\s+(?:de\s+tipo|del\s+tipo|tipo|:)\s+(?<type>[\w áéíóúñ]+)$/d;

/**
 * Lee la cola de «…con el atributo total de tipo Double y el descuento…».
 *
 * Devuelve `null` en cuanto un elemento no encaja, y no una lista a medias: si
 * de tres atributos dictados solo se entienden dos, aplicar esos dos deja al
 * usuario con una clase que parece terminada y no lo está. Prefiere no entender
 * la orden y decirlo.
 */
function parseFieldList(raw: string): { name: string; type: string }[] | null {
  const items = raw
    .split(/\s*,\s*|\s+y\s+/i)
    .map((item) => item.trim())
    // «el atributo x y el atributo y» repite el sustantivo en cada elemento.
    .map((item) => item.replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/i, ''))
    .map((item) => item.replace(/^(?:atributos?|campos?|propiedad(?:es)?)\s+/i, ''))
    .filter(Boolean);
  if (items.length === 0) return null;

  const fields: { name: string; type: string }[] = [];
  for (const item of items) {
    const match = FIELD_ITEM.exec(fold(item));
    const spans = match?.indices?.groups;
    if (!spans) return null;
    const field = spans.field;
    const type = spans.type;
    if (!field || !type) return null;
    const name = attributeName(item.slice(field[0], field[1]));
    if (!name) return null;
    fields.push({ name, type: typeName(item.slice(type[0], type[1])) });
  }
  return fields;
}

const RULES: Rule[] = [
  {
    // «crea la clase Pedido con el atributo total de tipo Double»
    //
    // Va antes que la regla de clase suelta a propósito: es la forma en que la
    // gente describe una clase de viva voz, y sin ella la cola entera acabaría
    // dentro del nombre —una clase llamada «PedidoConElAtributoTotalDeTipoDouble»,
    // que es exactamente lo que hacía—.
    pattern:
      /^(?:crea|crear|anade|anadir|agrega|agregar|nueva|nuevo|define|definir)\s+(?:una?\s+|el\s+|la\s+)?(?<kind>clase abstracta|clase|entidad|interfaz|interface|enumeracion|enum|abstracta)\s+(?:llamada\s+|de\s+nombre\s+)?(?<name>[\w áéíóúñ]+?)\s+(?:con|que\s+tiene|con\s+los?)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|unos\s+|unas\s+)?(?:atributos?|campos?|propiedad(?:es)?)\s+(?<fields>.+)$/d,
    confidence: 0.85,
    build: (g) => {
      const name = className(g.name ?? '');
      const fields = parseFieldList(g.fields ?? '');
      if (!name || !fields) return null;
      return [
        { op: 'addClass', name, kind: CLASS_KIND[fold(g.kind ?? 'clase')] ?? 'class' },
        ...fields.map(
          (field): Operation => ({
            op: 'addAttribute',
            classRef: { name },
            name: field.name,
            type: field.type,
            visibility: '-',
            isIdentifier: false,
            isNullable: true,
            isUnique: false,
          }),
        ),
      ];
    },
  },
  {
    // «crea la clase Cliente», «añade una interfaz Facturable»
    //
    // El nombre no puede tragarse un « con …»: si la orden lleva cola y la regla
    // de arriba no supo leerla, es mejor no entender la orden que inventarse un
    // nombre de clase con media frase dentro.
    pattern:
      /^(?:crea|crear|anade|anadir|agrega|agregar|nueva|nuevo|define|definir)\s+(?:una?\s+|el\s+|la\s+)?(?<kind>clase abstracta|clase|entidad|interfaz|interface|enumeracion|enum|abstracta)\s+(?:llamada\s+|de\s+nombre\s+)?(?<name>(?:(?!\s+(?:con|que)\s)[\w áéíóúñ])+)$/d,
    confidence: 0.9,
    build: (g) => {
      const name = className(g.name ?? '');
      if (!name) return null;
      return [{ op: 'addClass', name, kind: CLASS_KIND[fold(g.kind ?? 'clase')] ?? 'class' }];
    },
  },
  {
    // «añade el campo nombre de tipo texto a Cliente»
    pattern:
      /^(?:anade|anadir|agrega|agregar|crea|crear)\s+(?:el\s+|un\s+|la\s+|una\s+)?(?:atributo|campo|propiedad)\s+(?<field>[\w áéíóúñ]+?)\s+(?:de\s+tipo|tipo|del\s+tipo|:)\s+(?<type>[\w áéíóúñ]+?)\s+(?:a|en|para)\s+(?:la\s+clase\s+|la\s+|el\s+)?(?<target>[\w\sáéíóúñ]+)$/d,
    confidence: 0.85,
    build: (g) => {
      const name = attributeName(g.field ?? '');
      const target = className(g.target ?? '');
      if (!name || !target) return null;
      return [
        {
          op: 'addAttribute',
          classRef: { name: target },
          name,
          type: typeName(g.type ?? 'texto'),
          visibility: '-',
          isIdentifier: false,
          isNullable: true,
          isUnique: false,
        },
      ];
    },
  },
  {
    // «elimina la clase Pedido»
    pattern:
      /^(?:elimina|eliminar|borra|borrar|quita|quitar)\s+(?:la\s+|el\s+)?(?:clase|entidad|interfaz|enumeracion)\s+(?<name>[\w\sáéíóúñ]+)$/d,
    confidence: 0.9,
    build: (g) => {
      const name = className(g.name ?? '');
      if (!name) return null;
      return [{ op: 'removeClass', ref: { name } }];
    },
  },
  {
    // «elimina el campo correo de Cliente»
    //
    // Va antes que la regla de clase suelta porque «elimina el campo X de Y»
    // también encaja parcialmente con ella, y borrar la clase equivocada por un
    // orden de reglas sería el peor fallo posible de este módulo.
    pattern:
      /^(?:elimina|eliminar|borra|borrar|quita|quitar)\s+(?:el\s+|la\s+)?(?:atributo|campo|propiedad)\s+(?<field>[\w áéíóúñ]+?)\s+(?:de|en|a)\s+(?:la\s+clase\s+|la\s+|el\s+)?(?<target>[\w\sáéíóúñ]+)$/d,
    confidence: 0.85,
    build: (g) => {
      const name = attributeName(g.field ?? '');
      const target = className(g.target ?? '');
      if (!name || !target) return null;
      return [{ op: 'removeAttribute', classRef: { name: target }, attributeName: name }];
    },
  },
  {
    // «elimina el método calcularTotal de Pedido»
    pattern:
      /^(?:elimina|eliminar|borra|borrar|quita|quitar)\s+(?:el\s+|la\s+)?(?:metodo|operacion|funcion)\s+(?<method>[\w áéíóúñ]+?)(?:\(\))?\s+(?:de|en)\s+(?:la\s+clase\s+|la\s+|el\s+)?(?<target>[\w\sáéíóúñ]+)$/d,
    confidence: 0.85,
    build: (g) => {
      const name = attributeName(g.method ?? '');
      const target = className(g.target ?? '');
      if (!name || !target) return null;
      return [{ op: 'removeMethod', classRef: { name: target }, methodName: name }];
    },
  },
  {
    // «borra la fila 2 de Empleado», «elimina el registro 3 de Empleado»
    //
    // Es la única orden de la gramática que toca datos y no estructura. Se
    // admite el ordinal escrito («la segunda fila») porque dictando sale antes
    // que el número, y el reconocimiento de voz lo transcribe como palabra.
    pattern:
      /^(?:elimina|eliminar|borra|borrar|quita|quitar)\s+(?:la\s+|el\s+)?(?<ordinal>primera|segunda|tercera|cuarta|quinta|sexta|septima|octava|novena|decima)?\s*(?:fila|registro|dato)\s*(?<numero>\d+)?\s+(?:de|en)\s+(?:la\s+clase\s+|la\s+tabla\s+|la\s+|el\s+)?(?<target>[\w\sáéíóúñ]+)$/d,
    confidence: 0.8,
    build: (g) => {
      const target = className(g.target ?? '');
      const index = g.numero
        ? Number.parseInt(g.numero, 10)
        : ORDINALES[fold(g.ordinal ?? '')];
      if (!target || !index || index < 1) return null;
      return [{ op: 'removeSeedRow', classRef: { name: target }, index }];
    },
  },
  {
    // «renombra Cliente a Persona»
    pattern:
      /^(?:renombra|renombrar|cambia\s+el\s+nombre\s+de)\s+(?:la\s+clase\s+|la\s+|el\s+)?(?<from>[\w áéíóúñ]+?)\s+(?:a|por|como)\s+(?<to>[\w\sáéíóúñ]+)$/d,
    confidence: 0.85,
    build: (g) => {
      const from = className(g.from ?? '');
      const to = className(g.to ?? '');
      if (!from || !to) return null;
      return [{ op: 'renameClass', ref: { name: from }, name: to }];
    },
  },
  {
    // «Empleado hereda de Persona»
    pattern:
      /^(?<child>[\w áéíóúñ]+?)\s+(?:hereda\s+de|extiende\s+(?:de\s+)?|es\s+un[ao]?)\s+(?<parent>[\w\sáéíóúñ]+)$/d,
    confidence: 0.8,
    build: (g) => {
      const child = className(g.child ?? '');
      const parent = className(g.parent ?? '');
      if (!child || !parent || child === parent) return null;
      return [
        {
          op: 'addRelation',
          kind: 'inheritance',
          source: { name: child },
          target: { name: parent },
          sourceMultiplicity: '1',
          targetMultiplicity: '1',
        },
      ];
    },
  },
  {
    // «un Cliente tiene muchos Pedidos», «Pedido tiene un Cliente»,
    // «muchos Productos tienen muchas Categorías»
    //
    // La cantidad del sujeto se captura además de la del complemento porque es
    // lo único que distingue un uno a muchos de un muchos a muchos, y esa
    // diferencia no es cosmética: decide si el generador emite una clave ajena
    // o una tabla de unión entera. Sin ella, «muchos productos tienen muchas
    // categorías» se guardaba como 1→*, que es otra cosa, y quien lo dictó no
    // tenía forma de notarlo hasta abrir el ZIP.
    pattern:
      /^(?<sourceQuantity>un[ao]?\s+|muchos\s+|muchas\s+|varios\s+|varias\s+)?(?<source>[\w áéíóúñ]+?)\s+(?:tienen?|contienen?|poseen?)\s+(?<quantity>muchos|muchas|varios|varias|un|una|uno)\s+(?<target>[\w\sáéíóúñ]+)$/d,
    confidence: 0.75,
    build: (g) => {
      const source = className(g.source ?? '');
      const target = className(g.target ?? '');
      if (!source || !target) return null;
      const esPlural = (valor: string): boolean =>
        /^(muchos|muchas|varios|varias)$/.test(fold(valor).trim());
      return [
        {
          op: 'addRelation',
          kind: 'association',
          source: { name: source },
          target: { name: target },
          // «A tiene muchos B» se lee como: en el extremo A hay 1, en el B hay *.
          sourceMultiplicity: esPlural(g.sourceQuantity ?? '') ? '*' : '1',
          targetMultiplicity: esPlural(g.quantity ?? '') ? '*' : '1',
        },
      ];
    },
  },
  {
    // «añade el método calcularTotal a Pedido»
    pattern:
      /^(?:anade|anadir|agrega|agregar|crea|crear)\s+(?:el\s+|un\s+)?(?:metodo|operacion|funcion)\s+(?<method>[\w áéíóúñ]+?)(?:\(\))?\s+(?:a|en|para)\s+(?:la\s+clase\s+|la\s+|el\s+)?(?<target>[\w\sáéíóúñ]+)$/d,
    confidence: 0.8,
    build: (g) => {
      const name = attributeName(g.method ?? '');
      const target = className(g.target ?? '');
      if (!name || !target) return null;
      return [
        {
          op: 'addMethod',
          classRef: { name: target },
          name,
          returnType: null,
          parameters: [],
          visibility: '+',
        },
      ];
    },
  },
  {
    // «añade el literal PENDIENTE a EstadoPedido»
    pattern:
      /^(?:anade|anadir|agrega|agregar)\s+(?:el\s+)?(?:literal|valor|opcion)\s+(?<literal>[\w áéíóúñ]+?)\s+(?:a|en)\s+(?:la\s+)?(?<target>[\w\sáéíóúñ]+)$/d,
    confidence: 0.8,
    build: (g) => {
      const literal = (g.literal ?? '').trim().toUpperCase().replace(/\s+/g, '_');
      const target = className(g.target ?? '');
      if (!literal || !target) return null;
      return [{ op: 'addEnumLiteral', classRef: { name: target }, literal }];
    },
  },
];

/**
 * Interpreta una orden. Devuelve la misma forma que el modelo del servidor para
 * que la interfaz de previsualización sea una sola (RF-IA-04).
 */
export function interpretCommand(input: string): AssistantResponse {
  // El texto se parte por «y» y por punto para admitir órdenes encadenadas, que
  // es como habla la gente cuando dicta: «crea Cliente y crea Pedido».
  const segments = input
    .split(
      /\s*(?:\.|;|\by\s+(?=crea|crear|anade|añade|anadir|añadir|agrega|agregar|elimina|eliminar|borra|borrar|quita|quitar|renombra|renombrar)\b)\s*/i,
    )
    .map((segment) => segment.trim())
    .filter(Boolean);

  const operations: Operation[] = [];
  const unmatched: string[] = [];
  let confidence = 1;

  for (const segment of segments) {
    const match = matchSegment(tidy(segment));
    if (!match) {
      unmatched.push(segment);
      continue;
    }
    operations.push(...match.operations);
    confidence = Math.min(confidence, match.confidence);
  }

  if (operations.length === 0) {
    return {
      operations: [],
      confidence: 0,
      clarification:
        'No he entendido la orden. Puedo crear, renombrar y eliminar clases, ' +
        'atributos, métodos, literales y relaciones, y borrar filas de datos de ' +
        'ejemplo; por ejemplo: «crea la clase Cliente», «añade el campo correo ' +
        'de tipo texto a Cliente», «elimina el campo correo de Cliente» o ' +
        '«borra la segunda fila de Empleado».',
      explanation: '',
    };
  }

  return {
    operations,
    // Cada segmento no reconocido rebaja la confianza: la propuesta es
    // incompleta aunque lo que se entendió sea correcto.
    confidence: unmatched.length > 0 ? Math.min(confidence, 0.5) : confidence,
    clarification:
      unmatched.length > 0 ? `No he entendido: «${unmatched.join('», «')}»` : null,
    explanation: `${operations.length} operación(es) reconocida(s) sin conexión.`,
  };
}

/**
 * Prueba las reglas sobre el texto sin acentos y recorta los nombres del texto
 * original usando las posiciones de la coincidencia, para que «Créditos» siga
 * llamándose «Créditos» en el diagrama.
 */
function matchSegment(original: string): { operations: Operation[]; confidence: number } | null {
  const normalized = fold(original);

  for (const rule of RULES) {
    const match = rule.pattern.exec(normalized);
    if (!match?.groups || !match.indices?.groups) continue;

    const groups: Record<string, string> = {};
    for (const [name, value] of Object.entries(match.groups)) {
      const span = match.indices.groups[name];
      groups[name] = span ? original.slice(span[0], span[1]) : (value ?? '');
    }

    const operations = rule.build(groups);
    if (operations && operations.length > 0) {
      return { operations, confidence: rule.confidence };
    }
  }
  return null;
}
