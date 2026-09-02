import { z } from 'zod';
import type { ClassDiagram } from '../model/uml.js';
import type { Operation } from './operations.js';
import { isValidJavaIdentifier, toCamelCase, toPascalCase } from '../model/naming.js';
import { listSupportedTypes, resolveTypeName } from '../model/type-catalog.js';
import {
  ClassKindSchema,
  MULTIPLICITY_PATTERN,
  RelationKindSchema,
  type ClassKind,
  type RelationKind,
} from '../model/uml.js';

/**
 * Lectura de un diagrama de clases entero desde una imagen (RF-VIS-01).
 *
 * La diferencia con `import-table.ts` es de alcance, no de técnica: allí se lee
 * *una* tabla —cabeceras, tipos y filas— y aquí se lee el diagrama completo, con
 * varias clases y las relaciones que las unen. Este módulo absorbe al otro: una
 * clase puede traer sus filas de datos, así que fotografiar una tabla con
 * contenido sigue funcionando y sigue cargando los datos.
 *
 * Y se mantiene lo esencial del otro: **esto no escribe nada**. Devuelve las
 * mismas `Operation` que produce el ratón, revisables una a una, aplicables en
 * un solo lote que `Ctrl+Z` deshace entero (decisión D6).
 *
 * Por qué importa aquí más que en una tabla suelta. Un diagrama fotografiado de
 * una pizarra trae dos cosas que el modelo lee mal con facilidad y que no son
 * un detalle estético:
 *
 * 1. **Las cardinalidades.** Un «0..*» y un «0..1» se diferencian en un carácter
 *    escrito a mano junto a una línea. Y esa diferencia decide si el generador
 *    emite `@OneToMany` con clave foránea o `@ManyToMany` con tabla de unión, o
 *    sea, decide el esquema de la base de datos. Cuando el modelo declara no
 *    haberla leído, aquí NO se descarta la relación —perderla en silencio sería
 *    peor— sino que se propone `1→*` y se marca como dudosa en los avisos, para
 *    que quien revisa la confirme mirando la foto.
 * 2. **El sentido de la flecha.** En una composición, quién es el «todo» cambia
 *    dónde va la clave foránea. Si el modelo no lo dice, se respeta el orden en
 *    que nombró las clases y se avisa.
 *
 * Nada de lo que devuelve el modelo se toma por bueno: los nombres pasan por la
 * misma lista blanca que el resto (RNF-SEG-06) y se **rechazan**, nunca se
 * limpian quitando caracteres.
 */

/** Tope de clases en una sola imagen. Una pizarra legible no da para más. */
const MAX_CLASES = 40;
const MAX_ATRIBUTOS = 40;
const MAX_RELACIONES = 80;

/**
 * Cardinalidad que se propone cuando el modelo dice no haberla leído.
 *
 * `1→*` y no `1→1`: en un diagrama de clases dibujado a mano la asociación más
 * frecuente con diferencia es «uno tiene muchos», y acertar en el caso común
 * deja menos correcciones que hacer. Se avisa siempre, así que no es una
 * suposición escondida.
 */
const CARDINALIDAD_POR_DEFECTO = { origen: '1', destino: '*' } as const;

const CardinalidadSchema = z
  .string()
  .trim()
  .max(12)
  // Vacío significa «no la he podido leer», que es una respuesta legítima y
  // distinta de inventarse un valor. Se traduce a la de por defecto más abajo.
  .default('');

const ClaseExtraidaSchema = z.object({
  nombre: z.string().trim().min(1).max(64),
  // Se reutiliza el enum del modelo en lugar de repetir la lista: si mañana se
  // añade un tipo de clase, el lector de imágenes lo admite sin tocarlo.
  estereotipo: ClassKindSchema.default('class'),
  atributos: z
    .array(
      z.object({
        nombre: z.string().trim().min(1).max(64),
        tipo: z.string().trim().max(64).default('String'),
        esClave: z.boolean().default(false),
      }),
    )
    .max(MAX_ATRIBUTOS)
    .default([]),
  /**
   * Filas de datos, si la imagen las trae. Es lo que permite que este lector
   * sustituya al de tablas sin perder la migración de contenido.
   */
  filas: z.array(z.array(z.string().max(2000))).max(500).default([]),
});

const RelacionExtraidaSchema = z.object({
  origen: z.string().trim().min(1).max(64),
  destino: z.string().trim().min(1).max(64),
  tipo: RelationKindSchema.default('association'),
  cardinalidadOrigen: CardinalidadSchema,
  cardinalidadDestino: CardinalidadSchema,
  nombre: z.string().trim().max(64).default(''),
});

export const DiagramaExtraidoSchema = z.object({
  clases: z.array(ClaseExtraidaSchema).max(MAX_CLASES),
  relaciones: z.array(RelacionExtraidaSchema).max(MAX_RELACIONES).default([]),
  /** Lo que el modelo dice de sí mismo. Se muestra; no se usa para decidir. */
  confianza: z.number().min(0).max(1).default(0),
  /** Zonas que el modelo declara no haber podido leer. */
  ilegible: z.array(z.string().max(300)).max(50).default([]),
});

export type ClaseExtraida = z.infer<typeof ClaseExtraidaSchema>;
export type RelacionExtraida = z.infer<typeof RelacionExtraidaSchema>;
export type DiagramaExtraido = z.infer<typeof DiagramaExtraidoSchema>;

export function parseDiagramaExtraido(
  raw: unknown,
): { ok: true; value: DiagramaExtraido } | { ok: false; error: string } {
  const result = DiagramaExtraidoSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues.map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`).join('; '),
  };
}

// ---------------------------------------------------------------------------

export interface AvisoDiagrama {
  readonly severidad: 'error' | 'aviso';
  readonly mensaje: string;
}

export interface ResumenDiagrama {
  readonly clases: number;
  readonly atributos: number;
  readonly relaciones: number;
  readonly filas: number;
  /** Relaciones cuya cardinalidad hubo que suponer. */
  readonly cardinalidadesDudosas: number;
}

export interface ResultadoImportacionDiagrama {
  readonly operaciones: Operation[];
  readonly avisos: AvisoDiagrama[];
  readonly aplicable: boolean;
  readonly resumen: ResumenDiagrama;
  /** Nombres de clase que se van a crear, ya normalizados. */
  readonly clases: string[];
  /** Para enseñar las relaciones en la revisión sin releer las operaciones. */
  readonly relaciones: {
    readonly origen: string;
    readonly destino: string;
    readonly tipo: RelationKind;
    readonly cardinalidadOrigen: string;
    readonly cardinalidadDestino: string;
    readonly dudosa: boolean;
  }[];
}

/**
 * Normaliza lo que escriben las herramientas: `0..*` y `0..n` son `*`.
 *
 * Devuelve `null` cuando la cadena no dice nada legible, y esa distinción es la
 * que usa la pantalla de revisión para marcar el extremo concreto que hay que
 * mirar en la foto, en lugar de marcar la relación entera.
 *
 * Se exporta por eso: para que el navegador decida qué resaltar con la misma
 * regla con la que el servidor decide qué avisar, y no con una copia que se
 * desincronice.
 */
export function canonizarCardinalidad(bruta: string): string | null {
  const limpia = bruta.replace(/\s+/g, '').replace(/n/gi, '*');
  if (limpia === '') return null;
  if (limpia === '0..*' || limpia === '*..*') return '*';
  if (limpia === '1..1') return '1';
  if (limpia === '0..0') return null;
  // `1..1` ya está; el resto se acepta si encaja con lo que el modelo admite.
  return MULTIPLICITY_PATTERN.test(limpia) ? limpia : null;
}

/**
 * Convierte un diagrama leído de una imagen en operaciones de dominio.
 *
 * Se calcula contra el diagrama actual, no contra uno vacío: una clase que ya
 * existe se omite en lugar de duplicarse, y sus relaciones se conservan si el
 * otro extremo también está.
 */
export function interpretarDiagramaExtraido(
  extraido: DiagramaExtraido,
  diagrama: ClassDiagram,
): ResultadoImportacionDiagrama {
  const avisos: AvisoDiagrama[] = [];
  const vacio: ResumenDiagrama = {
    clases: 0,
    atributos: 0,
    relaciones: 0,
    filas: 0,
    cardinalidadesDudosas: 0,
  };

  // ---- clases -------------------------------------------------------------

  interface ClaseLista {
    nombre: string;
    kind: ClassKind;
    atributos: { nombre: string; tipo: string; esClave: boolean }[];
    filas: Record<string, string>[];
  }

  const listas: ClaseLista[] = [];
  const yaEnDiagrama = new Map<string, string>();
  for (const clase of Object.values(diagrama.classes)) {
    yaEnDiagrama.set(clase.name.toLowerCase(), clase.name);
  }
  const nuevos = new Set<string>();

  /**
   * De lo que dijo el modelo al nombre normalizado, para casar las relaciones.
   *
   * Se guardan dos llaves por clase —lo leído tal cual y su forma normalizada—
   * porque el modelo rara vez es consistente consigo mismo: titula el recuadro
   * «Class A» y luego nombra el extremo de la flecha «ClassA». Con una sola
   * llave esa relación se perdía en silencio, que es justo el fallo más caro de
   * todos: el diagrama importado parece correcto y le falta una asociación, así
   * que al generar sale un esquema sin esa clave foránea y nadie lo nota hasta
   * que la aplicación no encuentra los datos.
   */
  const porNombreLeido = new Map<string, string>();
  const recordarNombre = (leido: string, final: string): void => {
    porNombreLeido.set(leido.trim().toLowerCase(), final);
    porNombreLeido.set(final.toLowerCase(), final);
  };

  /** Resuelve un extremo: por lo leído, por su forma normalizada, o ya existente. */
  const resolverExtremo = (leido: string): string | undefined => {
    const limpio = leido.trim();
    return (
      porNombreLeido.get(limpio.toLowerCase()) ??
      porNombreLeido.get(toPascalCase(limpio).toLowerCase()) ??
      // Una relación puede apuntar a una clase que ya está en el proyecto y que
      // el modelo no listó por no salir entera en la foto.
      yaEnDiagrama.get(toPascalCase(limpio).toLowerCase())
    );
  };

  for (const bruta of extraido.clases) {
    const nombre = toPascalCase(bruta.nombre);
    if (!nombre || !isValidJavaIdentifier(nombre)) {
      avisos.push({
        severidad: 'aviso',
        mensaje: `«${bruta.nombre}» no sirve como nombre de clase y se descarta con su contenido.`,
      });
      continue;
    }

    const existente = yaEnDiagrama.get(nombre.toLowerCase());
    if (existente) {
      // No es un error: importar un diagrama que solapa con el actual es normal.
      // Se omite la clase pero se recuerda el nombre, porque sus relaciones con
      // las clases nuevas sí interesan.
      avisos.push({
        severidad: 'aviso',
        mensaje: `«${existente}» ya existe en el diagrama: se deja como está.`,
      });
      recordarNombre(bruta.nombre, existente);
      continue;
    }

    if (nuevos.has(nombre.toLowerCase())) {
      avisos.push({
        severidad: 'aviso',
        mensaje: `La imagen trae dos clases que se llamarían «${nombre}»: se queda la primera.`,
      });
      continue;
    }
    nuevos.add(nombre.toLowerCase());
    recordarNombre(bruta.nombre, nombre);

    // ---- atributos --------------------------------------------------------

    const atributos: { nombre: string; tipo: string; esClave: boolean }[] = [];
    const vistos = new Set<string>();
    for (const attr of bruta.atributos) {
      const atributo = toCamelCase(attr.nombre);
      if (!atributo || !isValidJavaIdentifier(atributo)) {
        avisos.push({
          severidad: 'aviso',
          mensaje: `El atributo «${attr.nombre}» de «${nombre}» no da un nombre válido y se descarta.`,
        });
        continue;
      }
      if (vistos.has(atributo.toLowerCase())) {
        avisos.push({
          severidad: 'aviso',
          mensaje: `«${nombre}» repite el atributo «${atributo}»: se queda el primero.`,
        });
        continue;
      }
      vistos.add(atributo.toLowerCase());

      const tipo = resolveTypeName(attr.tipo);
      if (!tipo) {
        avisos.push({
          severidad: 'aviso',
          mensaje: `Tipo «${attr.tipo}» desconocido en «${nombre}.${atributo}»: se usa String.`,
        });
      }
      atributos.push({ nombre: atributo, tipo: tipo ?? 'String', esClave: attr.esClave });
    }

    // `abstract` es un tipo de clase más, no una marca aparte: `addClass` solo
    // lleva `kind`. Tratarlo como booleano perdía la abstracción en silencio.
    const kind: ClassKind = bruta.estereotipo;

    // Una entidad persistente sin clave primaria no llega a generar (RF-GEN-11),
    // y el fallo aparecería mucho después, al descargar el proyecto. Las
    // interfaces y los enums no la necesitan.
    if (kind === 'class' && atributos.length > 0 && !atributos.some((a) => a.esClave)) {
      const primero = atributos[0]!;
      primero.esClave = true;
      avisos.push({
        severidad: 'aviso',
        mensaje:
          `«${nombre}» no traía clave primaria; se marca «${primero.nombre}». ` +
          'Cámbialo en el panel si no es la correcta.',
      });
    }

    // ---- filas ------------------------------------------------------------

    const filas: Record<string, string>[] = [];
    for (const [indice, valores] of bruta.filas.entries()) {
      if (valores.length !== bruta.atributos.length) {
        // Perder el alineamiento es peor que perder la fila: los valores caerían
        // bajo la columna equivocada, con el tipo correcto, y al revisar por
        // encima nadie lo notaría.
        avisos.push({
          severidad: 'aviso',
          mensaje:
            `La fila ${indice + 1} de «${nombre}» trae ${valores.length} celdas y hay ` +
            `${bruta.atributos.length} atributos: se descarta.`,
        });
        continue;
      }
      const fila: Record<string, string> = {};
      for (const [posicion, original] of bruta.atributos.entries()) {
        const atributo = toCamelCase(original.nombre);
        if (!atributos.some((a) => a.nombre === atributo)) continue;
        const valor = valores[posicion];
        if (valor === undefined || valor.trim() === '') continue;
        fila[atributo] = valor;
      }
      filas.push(fila);
    }

    listas.push({ nombre, kind, atributos, filas });
  }

  if (listas.length === 0) {
    return {
      operaciones: [],
      avisos: [
        ...avisos,
        {
          severidad: 'error',
          mensaje:
            'No se ha reconocido ninguna clase nueva en la imagen. Si el diagrama ya está ' +
            'en el proyecto, no hay nada que importar; si no, prueba con una foto más nítida.',
        },
      ],
      aplicable: false,
      resumen: vacio,
      clases: [],
      relaciones: [],
    };
  }

  // ---- relaciones ---------------------------------------------------------

  const relaciones: ResultadoImportacionDiagrama['relaciones'] = [];
  const conocidas = new Set<string>();

  for (const bruta of extraido.relaciones) {
    const origen = resolverExtremo(bruta.origen);
    const destino = resolverExtremo(bruta.destino);

    if (!origen || !destino) {
      const perdida = !origen ? bruta.origen : bruta.destino;
      avisos.push({
        severidad: 'aviso',
        mensaje: `Se descarta una relación: «${perdida}» no es ninguna de las clases leídas.`,
      });
      continue;
    }
    if (origen === destino) {
      // Una autorrelación es legítima en UML, pero la herencia de una clase de sí
      // misma no, y el generador entraría en recursión infinita.
      if (bruta.tipo === 'inheritance' || bruta.tipo === 'realization') {
        avisos.push({
          severidad: 'aviso',
          mensaje: `Se descarta que «${origen}» herede de sí misma.`,
        });
        continue;
      }
    }

    const clave = `${bruta.tipo}|${origen}|${destino}`;
    if (conocidas.has(clave)) continue;
    conocidas.add(clave);

    const leidaOrigen = canonizarCardinalidad(bruta.cardinalidadOrigen);
    const leidaDestino = canonizarCardinalidad(bruta.cardinalidadDestino);
    // La herencia y la realización no llevan cardinalidad; pedirla sería ruido.
    const llevaCardinalidad = bruta.tipo !== 'inheritance' && bruta.tipo !== 'realization';
    const dudosa = llevaCardinalidad && (leidaOrigen === null || leidaDestino === null);

    const cardinalidadOrigen = leidaOrigen ?? CARDINALIDAD_POR_DEFECTO.origen;
    const cardinalidadDestino = leidaDestino ?? CARDINALIDAD_POR_DEFECTO.destino;

    if (dudosa) {
      const extremo =
        leidaOrigen === null && leidaDestino === null
          ? 'ninguno de los dos extremos'
          : leidaOrigen === null
            ? `el extremo de «${origen}»`
            : `el extremo de «${destino}»`;
      avisos.push({
        severidad: 'aviso',
        mensaje:
          `No se ha podido leer la cardinalidad de ${extremo} en la relación ` +
          `«${origen} → ${destino}». Se propone ${cardinalidadOrigen}→${cardinalidadDestino}: ` +
          'revísala en el panel antes de generar, porque de esto depende si sale una clave ' +
          'foránea o una tabla de unión.',
      });
    }

    relaciones.push({
      origen,
      destino,
      tipo: bruta.tipo,
      cardinalidadOrigen,
      cardinalidadDestino,
      dudosa,
    });
  }

  for (const zona of extraido.ilegible) {
    avisos.push({ severidad: 'aviso', mensaje: `El modelo no pudo leer: ${zona}` });
  }

  // ---- operaciones --------------------------------------------------------

  const operaciones: Operation[] = [];

  for (const clase of listas) {
    operaciones.push({ op: 'addClass', name: clase.nombre, kind: clase.kind });
    for (const atributo of clase.atributos) {
      operaciones.push({
        op: 'addAttribute',
        classRef: { name: clase.nombre },
        name: atributo.nombre,
        type: atributo.tipo,
        visibility: '-',
        isIdentifier: atributo.esClave,
        isNullable: !atributo.esClave,
        isUnique: atributo.esClave,
      });
    }
  }

  // Las relaciones van después de TODAS las clases: una relación entre la
  // primera y la última fallaría si se emitiera junto a la primera.
  for (const relacion of relaciones) {
    operaciones.push({
      op: 'addRelation',
      kind: relacion.tipo,
      source: { name: relacion.origen },
      target: { name: relacion.destino },
      sourceMultiplicity: relacion.cardinalidadOrigen,
      targetMultiplicity: relacion.cardinalidadDestino,
    });
  }

  // Y las filas al final del todo: `setSeedRows` rechaza columnas que aún no
  // existan, así que tienen que ir después de sus atributos.
  let filasTotales = 0;
  for (const clase of listas) {
    if (clase.filas.length === 0) continue;
    filasTotales += clase.filas.length;
    operaciones.push({
      op: 'setSeedRows',
      classRef: { name: clase.nombre },
      rows: clase.filas,
    });
  }

  return {
    operaciones,
    avisos,
    aplicable: true,
    resumen: {
      clases: listas.length,
      atributos: listas.reduce((total, c) => total + c.atributos.length, 0),
      relaciones: relaciones.length,
      filas: filasTotales,
      cardinalidadesDudosas: relaciones.filter((r) => r.dudosa).length,
    },
    clases: listas.map((c) => c.nombre),
    relaciones,
  };
}

/** Los tipos que el modelo puede usar, para inyectarlos en la instrucción. */
export function tiposParaLaInstruccion(): string {
  return listSupportedTypes().join('|');
}
