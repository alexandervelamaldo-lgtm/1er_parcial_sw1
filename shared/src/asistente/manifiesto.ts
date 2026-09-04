import { z } from 'zod';

/**
 * Manifiesto del asistente: el contrato entre el backend generado y la app
 * móvil.
 *
 * El problema que resuelve. El backend que sale del generador es distinto para
 * cada diagrama: hoy tiene `Cita` y `Barbero`, mañana `Pedido` y `Producto`. La
 * app móvil que lo consume por voz no puede conocer esos nombres de antemano, y
 * generar un proyecto Flutter por diagrama significaría recompilar e instalar un
 * APK cada vez que alguien mueve una caja en el lienzo. Eso no es una
 * herramienta colaborativa: es un ciclo de despliegue de veinte minutos metido
 * en medio de una clase de diseño.
 *
 * La salida es invertir la dependencia. La app se compila **una vez** y no sabe
 * nada del dominio; al conectarse pide este manifiesto y de él deriva todo: qué
 * entidades existen, qué campos tiene cada una, de qué tipo son, cuáles son
 * obligatorios, qué acciones se pueden ejecutar y cuáles hay que confirmar en
 * voz alta antes de hacerlas. Los formularios y la gramática de órdenes se
 * construyen en tiempo de ejecución a partir de estos datos.
 *
 * Por qué vive en `shared` y no en el generador. Lo escriben dos partes —el
 * emisor del generador y el lector de la app— y lo validan las pruebas de
 * ambas. Un contrato que solo conoce quien lo emite no es un contrato.
 *
 * Lo que deliberadamente NO lleva:
 *
 * - **Fecha de generación.** Haría que dos ejecuciones del generador sobre el
 *   mismo diagrama produjeran ficheros distintos, y con ello se pierde la
 *   propiedad más útil que tiene un generador: que puedas volver a lanzarlo y
 *   comparar. La versión del esquema y el nombre del proyecto bastan.
 * - **Credenciales ni URLs absolutas.** La app ya sabe a qué servidor se ha
 *   conectado. Meter aquí un host lo congelaría al primero que se usó, que es
 *   justo lo que rompe al pasar de localhost a la nube.
 */

/**
 * Versión del esquema. Se compara con igualdad, no con «mayor o igual»: es
 * preferible que la app diga «este servidor habla una versión que no entiendo»
 * a que dibuje media pantalla con los campos que sí reconoce y silencie los
 * demás. Un formulario al que le falta un campo obligatorio en silencio produce
 * un 400 que el usuario no sabe explicar.
 */
export const VERSION_MANIFIESTO = 1;

/**
 * Tipos de campo tal y como los entiende la app, no como los entiende Java.
 *
 * Es una traducción con pérdida y a propósito. A la app le da igual que algo
 * sea `Integer` o `Long`: lo que necesita saber es qué teclado abrir, cómo
 * validar antes de enviar y cómo leer el valor en voz alta. `BigDecimal` y
 * `Double` colapsan en `decimal` porque el diálogo hablado es el mismo.
 */
export const TipoCampoSchema = z.enum([
  'texto',
  'entero',
  'decimal',
  'booleano',
  'fecha',
  'fechaHora',
  'hora',
  'uuid',
  /** Valor de un conjunto cerrado: el manifiesto trae la lista en `valores`. */
  'enumerado',
  /** Clave ajena a otra entidad del manifiesto, nombrada en `entidad`. */
  'referencia',
]);
export type TipoCampo = z.infer<typeof TipoCampoSchema>;

/**
 * Las cinco operaciones que el controlador generado expone hoy. Se enumeran de
 * forma explícita por entidad en vez de darlas por supuestas: en cuanto una
 * entidad deje de exponer el borrado —una entidad de auditoría, por ejemplo— la
 * app tiene que dejar de ofrecerlo sin que haya que tocarla.
 */
export const AccionSchema = z.enum(['listar', 'ver', 'crear', 'actualizar', 'borrar']);
export type Accion = z.infer<typeof AccionSchema>;

export const CampoManifiestoSchema = z.object({
  /** Nombre de la propiedad JSON tal cual la espera el DTO de entrada. */
  nombre: z.string().min(1).max(64),
  /**
   * El mismo nombre en palabras separadas y en minúsculas: `precioUnitario` se
   * convierte en `precio unitario`. Es lo que se muestra en la etiqueta del
   * formulario y lo que se pronuncia; también es contra lo que se compara la
   * frase dictada, porque nadie dicta en camelCase.
   */
  etiqueta: z.string().min(1).max(128),
  tipo: TipoCampoSchema,
  obligatorio: z.boolean(),
  /** El identificador: se muestra pero no se envía ni se dicta. */
  soloLectura: z.boolean(),
  /** Longitud máxima declarada por el `@Size` del DTO, si la hay. */
  maxLongitud: z.number().int().positive().optional(),
  /** Solo en `enumerado`: el conjunto cerrado de valores admitidos. */
  valores: z.array(z.string().min(1)).optional(),
  /** Solo en `referencia`: el `nombre` de la entidad apuntada. */
  entidad: z.string().min(1).max(64).optional(),
});
export type CampoManifiesto = z.infer<typeof CampoManifiestoSchema>;

export const EntidadManifiestoSchema = z.object({
  /** Nombre de la clase del diagrama, en PascalCase. */
  nombre: z.string().min(1).max(64),
  /**
   * Segmento de ruta que se concatena a `baseUrl`, ya en plural y kebab-case,
   * con la barra inicial: `/linea-pedidos`.
   *
   * El patrón es restrictivo a propósito. Este valor acaba formando una URL, y
   * viene de un nombre que ha escrito una persona dibujando un diagrama
   * (RNF-SEG-06). Una entidad llamada `../admin` no debe poder convertirse en
   * una petición a otro sitio.
   */
  ruta: z
    .string()
    .regex(/^\/[a-z0-9]+(-[a-z0-9]+)*$/, 'la ruta debe ser kebab-case con barra inicial'),
  /**
   * Cómo se nombra la entidad al hablar. Se emiten las formas que pueden
   * derivarse del diagrama —singular y plural, sin tildes y en minúsculas— y
   * nada más: inventar sinónimos que el usuario no ha escrito llevaría a que la
   * app reconociera «turno» en un proyecto donde ese nombre significa otra
   * cosa. Los sinónimos propios del dominio son una extensión posterior, y su
   * sitio natural es el diagrama, no el generador.
   */
  etiquetaHablada: z.array(z.string().min(1)).min(1),
  identificador: z.object({
    nombre: z.string().min(1).max(64),
    tipo: TipoCampoSchema,
  }),
  /**
   * Campo que representa al registro cuando hay que nombrarlo: el primer campo
   * de texto obligatorio. Permite decir «la cita de Juan» en lugar de «la cita
   * número 47», y ofrecer una lista legible al elegir una referencia.
   * Ausente si la entidad no tiene ningún campo de texto.
   */
  campoEtiqueta: z.string().min(1).max(64).optional(),
  campos: z.array(CampoManifiestoSchema),
  acciones: z.array(AccionSchema),
  /**
   * Acciones que exigen confirmación hablada antes de ejecutarse (RF-VOZ-04).
   * Una orden mal reconocida que crea un registro de más es un incordio; una
   * que borra uno es una pérdida de datos.
   */
  criticas: z.array(AccionSchema),
  /**
   * Entidades que desaparecen si se borra esta, por ser partes de una
   * composición con cascada.
   *
   * Está aquí porque el aviso hablado tiene que ser honesto: «borrar este
   * pedido eliminará también sus líneas» es una advertencia distinta de «¿borro
   * este pedido?», y la diferencia solo puede saberla quien ha visto el rombo
   * relleno en el diagrama. La app no puede deducirlo de la API REST.
   */
  borradoEnCascada: z.array(z.string().min(1)),
});
export type EntidadManifiesto = z.infer<typeof EntidadManifiestoSchema>;

export const EnumeradoManifiestoSchema = z.object({
  nombre: z.string().min(1).max(64),
  valores: z.array(z.string().min(1)),
});
export type EnumeradoManifiesto = z.infer<typeof EnumeradoManifiestoSchema>;

export const ManifiestoSchema = z.object({
  version: z.literal(VERSION_MANIFIESTO),
  /** Nombre legible del proyecto; se usa al presentarse por voz. */
  proyecto: z.string().min(1).max(128),
  /** Prefijo común de todos los controladores generados. */
  baseUrl: z.string().regex(/^\/[a-z0-9/-]*$/),
  /**
   * Idioma de las etiquetas y de la gramática. Hoy solo hay castellano; el
   * campo existe para que la app pueda rechazar un manifiesto que no sabe
   * pronunciar en vez de leerlo con la voz equivocada.
   */
  idioma: z.literal('es'),
  /**
   * Nombre de la cabecera de idempotencia que acepta este backend. Va en el
   * manifiesto y no está fijado en la app porque es el servidor quien decide si
   * la implementa: si el campo falta, la app sabe que reenviar es peligroso y
   * debe pedir confirmación en vez de reintentar sola.
   */
  cabeceraIdempotencia: z.string().min(1).max(64).optional(),
  entidades: z.array(EntidadManifiestoSchema),
  enumerados: z.array(EnumeradoManifiestoSchema),
});
export type Manifiesto = z.infer<typeof ManifiestoSchema>;

/** Cabecera que emiten el generador y la app. Un solo sitio donde cambiarla. */
export const CABECERA_IDEMPOTENCIA = 'Idempotency-Key';

/**
 * Busca una entidad por cualquiera de sus formas habladas.
 *
 * Vive aquí, junto al esquema, porque lo necesitan las dos orillas: el
 * intérprete de órdenes del móvil y las pruebas del generador que comprueban
 * que las frases del corpus encuentran a quién se refieren. Duplicarlo sería
 * garantizar que las dos copias se separen.
 */
export function buscarEntidadHablada(
  manifiesto: Manifiesto,
  termino: string,
): EntidadManifiesto | undefined {
  const buscado = plegar(termino);
  return manifiesto.entidades.find((entidad) =>
    entidad.etiquetaHablada.some((etiqueta) => plegar(etiqueta) === buscado),
  );
}

/** Igual que `buscarEntidadHablada`, para un campo dentro de una entidad. */
export function buscarCampoHablado(
  entidad: EntidadManifiesto,
  termino: string,
): CampoManifiesto | undefined {
  const buscado = plegar(termino);
  return entidad.campos.find(
    (campo) => plegar(campo.etiqueta) === buscado || plegar(campo.nombre) === buscado,
  );
}

/**
 * Normaliza para comparar lo dictado con lo escrito: minúsculas, sin tildes y
 * con los espacios colapsados. Es la misma regla que aplica la gramática de
 * `ai/grammar.ts`; se repite en cuatro líneas en vez de exportarla desde allí
 * para no acoplar el contrato del manifiesto al intérprete del lienzo, que
 * evoluciona por otros motivos.
 */
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function plegar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .trim()
    .replace(/\s+/g, ' ');
}
