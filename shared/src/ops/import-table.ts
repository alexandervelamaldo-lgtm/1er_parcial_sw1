import { z } from 'zod';
import { isValidJavaIdentifier, toCamelCase, toPascalCase } from '../model/naming.js';
import { resolveTypeName } from '../model/type-catalog.js';
import type { ClassDiagram } from '../model/uml.js';
import type { Operation } from './operations.js';

/**
 * Importación de una tabla leída de una fotografía (RF-OCR-01 … RF-OCR-04).
 *
 * Esta capa está en `shared` y no en el backend por la misma razón que la
 * gramática: el navegador tiene que poder mostrar y editar la tabla extraída
 * —incluso sin conexión, sobre una extracción anterior— y el servidor tiene que
 * validar exactamente lo mismo antes de proponerla. Dos validaciones distintas
 * darían un cuadro de revisión que acepta lo que el servidor rechaza.
 *
 * SEGURIDAD (RNF-SEG-06). Todo lo que hay aquí viene de un modelo de lenguaje
 * mirando una foto, que es la entrada menos confiable del sistema: ni siquiera
 * es texto que alguien haya escrito. Un nombre de columna leído de una pizarra
 * acaba siendo un identificador Java, un nombre de columna SQL y parte de una
 * ruta de fichero dentro del ZIP. Por eso:
 *
 * - Los nombres se validan contra lista blanca *después* de convertirlos a la
 *   convención del modelo, y lo que no pasa se rechaza con su motivo. No se
 *   «limpia» quitando caracteres: eso deja huecos y además cambia el nombre a
 *   espaldas de quien revisa.
 * - Los tipos se resuelven contra el catálogo. Un tipo inventado por el modelo
 *   se degrada a `String`, que siempre funciona, y se anota como aviso.
 * - Los valores de las celdas se admiten tal cual, porque no son
 *   identificadores; el escapado para SQL lo hace el generador, en un solo
 *   sitio y con pruebas propias.
 *
 * Y una limitación que no es un detalle. Un modelo de visión puede leer mal una
 * celda y declarar confianza 1.0 al hacerlo: en la prueba que motivó este
 * diseño, `ana@rrhh.com` se leyó como `ana@rrrh.com` con `"confianza":1.0` y
 * `"ilegible":[]`. La confianza que el modelo declara sobre sí mismo no vale
 * como garantía de nada. Por eso `interpretarTablaExtraida` devuelve una
 * *propuesta* y nunca escribe: la revisión humana no es un paso opcional que se
 * pueda saltar cuando la confianza es alta, porque la confianza alta es
 * precisamente el caso en que el modelo se equivocó sin avisar.
 */

export const ColumnaExtraidaSchema = z.object({
  nombre: z.string().trim().min(1).max(64),
  tipo: z.string().trim().min(1).max(40),
  esClave: z.boolean().default(false),
});

export const TablaExtraidaSchema = z.object({
  tabla: z.string().trim().min(1).max(64),
  columnas: z.array(ColumnaExtraidaSchema).min(1).max(40),
  /** Cada fila, en el mismo orden que `columnas`. */
  filas: z.array(z.array(z.string().max(2000))).max(500).default([]),
  /** Lo que el modelo dice de sí mismo. Se muestra; no se usa para decidir. */
  confianza: z.number().min(0).max(1).default(0),
  /** Zonas que el modelo declara no haber podido leer. */
  ilegible: z.array(z.string().max(300)).max(50).default([]),
});

export type ColumnaExtraida = z.infer<typeof ColumnaExtraidaSchema>;
export type TablaExtraida = z.infer<typeof TablaExtraidaSchema>;

export function parseTablaExtraida(
  raw: unknown,
): { ok: true; value: TablaExtraida } | { ok: false; error: string } {
  const result = TablaExtraidaSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues
      .map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`)
      .join('; '),
  };
}

// ---------------------------------------------------------------------------

export interface AvisoImportacion {
  /** `error` bloquea la importación; `aviso` solo se muestra. */
  severidad: 'error' | 'aviso';
  mensaje: string;
}

export interface ResultadoImportacion {
  /** Nombre de clase ya en PascalCase y validado. */
  clase: string;
  /** Operaciones que materializan la importación. Vacío si hay errores. */
  operaciones: Operation[];
  avisos: AvisoImportacion[];
  /** Si es `false`, la propuesta no debe ofrecerse para aplicar. */
  aplicable: boolean;
}

/**
 * Convierte una tabla revisada en operaciones de dominio.
 *
 * No escribe nada: devuelve las mismas `Operation` que produce el ratón o la
 * voz, y pasan por el mismo camino de aplicación (decisión D6). Eso es lo que
 * hace que deshacer una importación entera sea un solo «deshacer» y no una
 * limpieza manual de veinte filas.
 */
export function interpretarTablaExtraida(
  tabla: TablaExtraida,
  diagrama: ClassDiagram,
): ResultadoImportacion {
  const avisos: AvisoImportacion[] = [];

  const clase = toPascalCase(tabla.tabla);
  if (!clase || !isValidJavaIdentifier(clase)) {
    return {
      clase,
      operaciones: [],
      avisos: [
        {
          severidad: 'error',
          mensaje:
            `«${tabla.tabla}» no sirve como nombre de clase. Corrígelo en la ` +
            'revisión: debe empezar por letra y llevar solo letras y números.',
        },
      ],
      aplicable: false,
    };
  }

  const yaExiste = Object.values(diagrama.classes).some(
    (c) => c.name.toLowerCase() === clase.toLowerCase(),
  );
  if (yaExiste) {
    return {
      clase,
      operaciones: [],
      avisos: [
        {
          severidad: 'error',
          mensaje:
            `Ya hay una clase «${clase}» en el diagrama. Cambia el nombre de la ` +
            'tabla antes de importar, o borra la clase existente si querías reemplazarla.',
        },
      ],
      aplicable: false,
    };
  }

  // ---- columnas -----------------------------------------------------------

  const columnas: { atributo: string; tipo: string; esClave: boolean }[] = [];
  const vistos = new Set<string>();

  for (const columna of tabla.columnas) {
    const atributo = toCamelCase(columna.nombre);
    if (!atributo || !isValidJavaIdentifier(atributo)) {
      avisos.push({
        severidad: 'error',
        mensaje: `La columna «${columna.nombre}» no da un nombre de atributo válido.`,
      });
      continue;
    }
    if (vistos.has(atributo.toLowerCase())) {
      // Pasa de verdad: «Fecha alta» y «fecha_alta» en la misma pizarra colapsan
      // en `fechaAlta`. Silenciarlo perdería una columna sin decirlo.
      avisos.push({
        severidad: 'error',
        mensaje: `Dos columnas se llamarían «${atributo}». Renombra una de ellas.`,
      });
      continue;
    }
    vistos.add(atributo.toLowerCase());

    const tipo = resolveTypeName(columna.tipo);
    if (!tipo) {
      avisos.push({
        severidad: 'aviso',
        mensaje: `Tipo «${columna.tipo}» desconocido en «${atributo}»: se usa String.`,
      });
    }
    columnas.push({ atributo, tipo: tipo ?? 'String', esClave: columna.esClave });
  }

  if (columnas.length === 0) {
    avisos.push({ severidad: 'error', mensaje: 'No queda ninguna columna utilizable.' });
  }

  // Una entidad persistente sin clave primaria no genera (RF-GEN-11), y el
  // fallo aparecería mucho después, al descargar el proyecto. Se marca aquí la
  // primera columna, que en una tabla leída de una pizarra es casi siempre el
  // `id`, y se dice que se ha hecho para que quien revisa pueda cambiarlo.
  if (columnas.length > 0 && !columnas.some((c) => c.esClave)) {
    const primera = columnas[0]!;
    primera.esClave = true;
    avisos.push({
      severidad: 'aviso',
      mensaje:
        `Ninguna columna venía marcada como clave; se marca «${primera.atributo}». ` +
        'Cámbialo si no es la correcta.',
    });
  }

  // ---- filas --------------------------------------------------------------

  const filas: Record<string, string>[] = [];
  for (const [indice, valores] of tabla.filas.entries()) {
    if (valores.length !== tabla.columnas.length) {
      // Una fila con más o menos celdas que cabeceras significa que el modelo
      // perdió el alineamiento. Colocar los valores que sí hay sería peor que
      // descartar la fila: quedarían en la columna equivocada, con el tipo
      // correcto, y nadie lo notaría al revisar por encima.
      avisos.push({
        severidad: 'aviso',
        mensaje:
          `La fila ${indice + 1} trae ${valores.length} celdas y hay ` +
          `${tabla.columnas.length} columnas: se descarta.`,
      });
      continue;
    }

    const fila: Record<string, string> = {};
    for (const [posicion, original] of tabla.columnas.entries()) {
      const atributo = toCamelCase(original.nombre);
      // Las columnas descartadas arriba no están en `columnas`; sus valores se
      // van con ellas.
      if (!columnas.some((c) => c.atributo === atributo)) continue;
      const valor = valores[posicion];
      if (valor === undefined) continue;
      // Una celda vacía es NULL, no cadena vacía: en una pizarra, un hueco es un
      // hueco. Quien quiera la cadena vacía puede escribirla en la revisión.
      if (valor.trim() === '') continue;
      fila[atributo] = valor;
    }
    filas.push(fila);
  }

  for (const zona of tabla.ilegible) {
    avisos.push({ severidad: 'aviso', mensaje: `El modelo no pudo leer: ${zona}` });
  }

  const aplicable = !avisos.some((a) => a.severidad === 'error');
  if (!aplicable) return { clase, operaciones: [], avisos, aplicable: false };

  const operaciones: Operation[] = [
    { op: 'addClass', name: clase, kind: 'class' },
    ...columnas.map(
      (columna): Operation => ({
        op: 'addAttribute',
        classRef: { name: clase },
        name: columna.atributo,
        type: columna.tipo,
        visibility: '-',
        isIdentifier: columna.esClave,
        isNullable: !columna.esClave,
        isUnique: columna.esClave,
      }),
    ),
  ];

  // Las filas van en una sola operación al final: si se aplicaran antes que los
  // atributos, `setSeedRows` rechazaría columnas que aún no existen.
  if (filas.length > 0) {
    operaciones.push({ op: 'setSeedRows', classRef: { name: clase }, rows: filas });
  }

  return { clase, operaciones, avisos, aplicable: true };
}
