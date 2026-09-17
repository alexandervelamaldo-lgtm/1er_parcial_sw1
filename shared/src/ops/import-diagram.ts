import { z } from 'zod';
import type { ClassDiagram } from '../model/uml.js';
import type { Operation } from './operations.js';
import { isValidJavaIdentifier, toCamelCase, toPascalCase } from '../model/naming.js';
import { listSupportedTypes, resolveTypeName } from '../model/type-catalog.js';
import {
  ClassKindSchema,
  llevaCardinalidad,
  MULTIPLICITY_PATTERN,
  RelationKindSchema,
  VisibilitySchema,
  type ClassKind,
  type RelationKind,
  type Visibility,
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
const MAX_METODOS = 40;
const MAX_PARAMETROS = 10;
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
   * El tercer compartimento del recuadro, que hasta ahora se tiraba entero.
   *
   * Un recuadro UML tiene tres pisos: nombre, atributos y **operaciones**. Este
   * lector leía dos. Con una foto de un diagrama de banca —`+deposit()`,
   * `+withdraw()`, `+verifyPassword()`, `+createTransaction()`— el resultado
   * importado salía con las siete clases y las ocho relaciones correctas, y sin
   * una sola operación, que es la mitad de lo que el ingeniero dibujó.
   *
   * Lo llamativo es que no faltaba capacidad en ningún sitio: el modelo tiene
   * `methods`, existe la operación `addMethod`, el lienzo sabe pintarlos con
   * `textoMetodo` y el generador valida sus nombres y sus parámetros antes de
   * llevarlos a la plantilla Java. El único ciego era este lector, y lo era
   * porque la instrucción nunca se los pidió al modelo. No es un fallo de
   * lectura: es una pregunta que no se hacía.
   *
   * `tipoRetorno` vacío significa `void`, que es lo que se dibuja en la práctica
   * cuando nadie escribe el tipo. Se distingue de «no lo leo» a propósito: en un
   * método, a diferencia de una cardinalidad, suponer `void` no cambia el
   * esquema de la base de datos.
   */
  metodos: z
    .array(
      z.object({
        nombre: z.string().trim().min(1).max(64),
        tipoRetorno: z.string().trim().max(64).default(''),
        visibilidad: VisibilitySchema.default('+'),
        parametros: z
          .array(
            z.object({
              nombre: z.string().trim().min(1).max(64),
              tipo: z.string().trim().max(64).default('String'),
            }),
          )
          .max(MAX_PARAMETROS)
          .default([]),
      }),
    )
    .max(MAX_METODOS)
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
  readonly metodos: number;
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
    /** El rótulo de la línea, si el dibujo lo traía. Vacío si no. */
    readonly nombre: string;
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

/** Un extremo que hay que rellenar, con el valor que se propone. */
export interface SugerenciaCardinalidad {
  readonly indice: number;
  readonly cardinalidadOrigen?: string;
  readonly cardinalidadDestino?: string;
}

/**
 * Propone cardinalidad para los extremos que la foto no dejó leer.
 *
 * Tres reglas, y las tres importan:
 *
 * 1. **Solo rellena huecos.** Lo que el modelo sí leyó no se toca nunca, ni
 *    siquiera para «mejorarlo». Si esto pudiera cambiar un `0..1` leído en la
 *    pizarra, dejaría de ser una ayuda y pasaría a ser una fuente de errores
 *    imposible de auditar.
 * 2. **No inventa donde no hay hueco.** Una herencia no tiene cardinalidad, así
 *    que no se le pone ninguna.
 * 3. **Es determinista.** No pregunta a ningún modelo. Podría hacerlo —volver a
 *    mirar la foto ampliada sobre esa línea concreta—, pero para elegir entre
 *    cuatro valores con una convención tan marcada, una llamada de red añade
 *    espera, coste y una forma nueva de fallar justo durante la defensa, a
 *    cambio de nada. Y sobre todo: una suposición del modelo es indistinguible
 *    de una lectura del modelo, mientras que ésta el revisor la puede comprobar
 *    en dos segundos porque la regla cabe en una frase.
 *
 * Quien llame a esto tiene que dejar ver qué ha rellenado. Rellenar en silencio
 * sería exactamente el fallo que esta pantalla existe para evitar.
 */
export function sugerirCardinalidades(
  relaciones: readonly RelacionExtraida[],
): SugerenciaCardinalidad[] {
  const sugerencias: SugerenciaCardinalidad[] = [];
  for (const [indice, relacion] of relaciones.entries()) {
    if (!llevaCardinalidad(relacion.tipo)) continue;
    const origen = canonizarCardinalidad(relacion.cardinalidadOrigen);
    const destino = canonizarCardinalidad(relacion.cardinalidadDestino);
    if (origen !== null && destino !== null) continue;
    sugerencias.push({
      indice,
      ...(origen === null ? { cardinalidadOrigen: CARDINALIDAD_POR_DEFECTO.origen } : {}),
      ...(destino === null ? { cardinalidadDestino: CARDINALIDAD_POR_DEFECTO.destino } : {}),
    });
  }
  return sugerencias;
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
    metodos: 0,
    relaciones: 0,
    filas: 0,
    cardinalidadesDudosas: 0,
  };

  // ---- clases -------------------------------------------------------------

  interface MetodoListo {
    nombre: string;
    tipoRetorno: string | null;
    visibilidad: Visibility;
    parametros: { nombre: string; tipo: string }[];
  }

  interface ClaseLista {
    nombre: string;
    kind: ClassKind;
    atributos: { nombre: string; tipo: string; esClave: boolean }[];
    metodos: MetodoListo[];
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

    // ---- métodos ----------------------------------------------------------

    /*
      Mismo trato que los atributos, y por la misma razón (RNF-SEG-06): lo que
      sale de una foto es entrada externa y acaba siendo un identificador Java en
      un fichero generado. Se rechaza lo que no vale; no se «limpia» quitando
      caracteres, que es como se cuelan nombres que parecen válidos y no lo son.

      Un nombre de método se lee de la foto con el paréntesis pegado —«+deposit()»
      llega a veces como «deposit()»— así que se quitan los paréntesis y lo que
      lleven dentro antes de normalizar. Si dentro había parámetros, el modelo
      los trae aparte en `parametros`; no se intentan sacar de aquí, porque
      partir «(monto: Decimal, fecha)» a mano es justo el tipo de análisis que se
      equivoca en silencio.
    */
    const metodos: MetodoListo[] = [];
    const metodosVistos = new Set<string>();
    for (const met of bruta.metodos) {
      const sinParentesis = met.nombre.replace(/\(.*$/, '');
      const metodo = toCamelCase(sinParentesis);
      if (!metodo || !isValidJavaIdentifier(metodo)) {
        avisos.push({
          severidad: 'aviso',
          mensaje: `El método «${met.nombre}» de «${nombre}» no da un nombre válido y se descarta.`,
        });
        continue;
      }
      if (metodosVistos.has(metodo.toLowerCase())) {
        // Sin sobrecarga: dos métodos con el mismo nombre y distinta firma son
        // legales en Java, pero aquí la única forma de distinguirlos sería
        // fiarse de unos parámetros leídos de una foto. Se queda el primero y se
        // dice, que es mejor que generar dos métodos que no compilan.
        avisos.push({
          severidad: 'aviso',
          mensaje: `«${nombre}» repite el método «${metodo}»: se queda el primero.`,
        });
        continue;
      }
      metodosVistos.add(metodo.toLowerCase());

      // Vacío es `void`, y `void` es `null` en el modelo. Un tipo escrito pero
      // desconocido sí se avisa: ahí el modelo leyó algo y no lo entendimos.
      let tipoRetorno: string | null = null;
      if (met.tipoRetorno.trim() !== '' && met.tipoRetorno.trim().toLowerCase() !== 'void') {
        tipoRetorno = resolveTypeName(met.tipoRetorno) ?? null;
        if (!tipoRetorno) {
          avisos.push({
            severidad: 'aviso',
            mensaje:
              `Tipo de retorno «${met.tipoRetorno}» desconocido en «${nombre}.${metodo}»: ` +
              'se deja sin retorno.',
          });
        }
      }

      const parametros: { nombre: string; tipo: string }[] = [];
      const parametrosVistos = new Set<string>();
      for (const par of met.parametros) {
        const nombreParametro = toCamelCase(par.nombre);
        if (!nombreParametro || !isValidJavaIdentifier(nombreParametro)) {
          avisos.push({
            severidad: 'aviso',
            mensaje:
              `El parámetro «${par.nombre}» de «${nombre}.${metodo}» no da un nombre válido ` +
              'y se descarta.',
          });
          continue;
        }
        // Dos parámetros con el mismo nombre no compilan, y el fallo aparecería
        // al construir el proyecto generado, muy lejos de la foto que lo causó.
        if (parametrosVistos.has(nombreParametro.toLowerCase())) {
          avisos.push({
            severidad: 'aviso',
            mensaje: `«${nombre}.${metodo}» repite el parámetro «${nombreParametro}»: se queda el primero.`,
          });
          continue;
        }
        parametrosVistos.add(nombreParametro.toLowerCase());
        parametros.push({ nombre: nombreParametro, tipo: resolveTypeName(par.tipo) ?? 'String' });
      }

      metodos.push({ nombre: metodo, tipoRetorno, visibilidad: met.visibilidad, parametros });
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

    listas.push({ nombre, kind, atributos, metodos, filas });
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

    /*
      Dos clases SÍ pueden estar unidas por varias relaciones.

      El lienzo lo contempla desde hace tiempo —`desviosPorPar` las abre en
      abanico para que no se pisen— y el modelo también: `relations` es un mapa
      por identificador, no por par de clases. Quien no lo contemplaba era este
      lector, y de la peor manera posible.

      La clave de deduplicación era `tipo|origen|destino`, sin el nombre. Con
      eso, «Cliente —atiende→ Pedido» y «Cliente —cancela→ Pedido» daban la misma
      clave, y la segunda se iba con un `continue` mudo: sin aviso, sin rastro.
      El diagrama importado salía con una relación de menos y con aspecto de
      estar completo, que es exactamente la clase de fallo que nadie encuentra
      revisando —se ve lo que hay, no lo que falta— y que al generar produce un
      esquema al que le sobra o le falta una clave foránea.

      Ahora el nombre entra en la clave, así que dos relaciones con papeles
      distintos conviven. Y cuando el descarte ocurre de verdad —misma pareja,
      mismo tipo y mismo nombre, o sea el modelo repitiéndose— se dice. Un
      duplicado real avisado cuesta una línea de ruido; uno callado cuesta el
      esquema.
    */
    const clave = `${bruta.tipo}|${origen}|${destino}|${bruta.nombre.toLowerCase()}`;
    if (conocidas.has(clave)) {
      avisos.push({
        severidad: 'aviso',
        mensaje:
          `La imagen repite la relación «${origen} → ${destino}» (${bruta.tipo}): ` +
          'se queda una sola. Si en el dibujo hay dos líneas distintas entre esas clases, ' +
          'dales un nombre a cada una y vuelve a importar.',
      });
      continue;
    }
    conocidas.add(clave);

    const leidaOrigen = canonizarCardinalidad(bruta.cardinalidadOrigen);
    const leidaDestino = canonizarCardinalidad(bruta.cardinalidadDestino);
    const dudosa = llevaCardinalidad(bruta.tipo) && (leidaOrigen === null || leidaDestino === null);

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
      // El nombre venía leyéndose del dibujo y tirándose aquí mismo. En el
      // diagrama de banca eran «Has», «Account Transaction» y
      // «Savings-Checking»: precisamente lo que explica *por qué* están unidas
      // dos clases, y lo único que distingue dos líneas entre el mismo par.
      nombre: bruta.nombre,
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
    for (const metodo of clase.metodos) {
      operaciones.push({
        op: 'addMethod',
        classRef: { name: clase.nombre },
        name: metodo.nombre,
        returnType: metodo.tipoRetorno,
        parameters: metodo.parametros.map((p) => ({ name: p.nombre, type: p.tipo })),
        visibility: metodo.visibilidad,
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
      // `undefined` y no `''`: el campo es opcional en el modelo, y una cadena
      // vacía llegaría al lienzo como una etiqueta en blanco colgada de la línea.
      ...(relacion.nombre ? { name: relacion.nombre } : {}),
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
      metodos: listas.reduce((total, c) => total + c.metodos.length, 0),
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
