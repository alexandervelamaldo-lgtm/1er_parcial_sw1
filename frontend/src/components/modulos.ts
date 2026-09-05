import {
  type ClassDiagram,
  type UmlClass,
  type UmlModule,
  isValidJavaPackageSegment,
  listClasses,
  listModules,
  packageForClass,
  resolveModuleId,
  toPascalCase,
  toSnakeCase,
} from '@app/shared';

/**
 * Las reglas del catálogo de módulos, sin React.
 *
 * Un módulo reparte el dominio en subpaquetes: `Pedido` en el módulo «Ventas»
 * se genera en `com.tienda.ventas.domain` con su repositorio, su servicio y su
 * controlador al lado. La pantalla que lo maneja es un formulario y una lista,
 * pero debajo hay tres decisiones que se pueden equivocar en silencio —qué
 * segmento se propone a partir del nombre, cuándo un segmento no vale, y qué
 * clases quedan sin repartir— y las tres se prueban aquí sin montar un
 * navegador.
 *
 * El módulo no toca la base de datos: las tablas salen igual estén las clases
 * repartidas o no. Organiza el código, que es de lo que trata un contexto
 * acotado.
 */

/** Una fila del catálogo: el módulo y lo que hay dentro. */
export interface FilaModulo {
  /** `null` en la fila de las clases que no están en ningún módulo. */
  modulo: UmlModule | null;
  /** El paquete completo de esas clases en el proyecto generado. */
  paquete: string;
  clases: UmlClass[];
}

/**
 * El reparto entero, con la fila de los huérfanos al final.
 *
 * La fila sin módulo se devuelve siempre que tenga alguien, incluso cuando no
 * hay ningún módulo definido: es la respuesta a «¿y dónde está el resto?», que
 * es la primera pregunta al ver una lista de módulos que no suma el total de
 * clases del diagrama.
 */
export function repartoDeModulos(diagrama: ClassDiagram): FilaModulo[] {
  const clases = listClasses(diagrama);
  const porModulo = new Map<string, UmlClass[]>();
  const sueltas: UmlClass[] = [];

  for (const cls of clases) {
    const moduleId = resolveModuleId(diagrama, cls);
    if (moduleId === null) {
      sueltas.push(cls);
      continue;
    }
    const lista = porModulo.get(moduleId) ?? [];
    lista.push(cls);
    porModulo.set(moduleId, lista);
  }

  const filas: FilaModulo[] = listModules(diagrama)
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((modulo) => ({
      modulo,
      paquete: `${diagrama.meta.basePackage}.${modulo.packageSegment}`,
      clases: ordenadas(porModulo.get(modulo.id) ?? []),
    }));

  if (sueltas.length > 0) {
    filas.push({
      modulo: null,
      paquete: diagrama.meta.basePackage,
      clases: ordenadas(sueltas),
    });
  }

  return filas;
}

function ordenadas(clases: UmlClass[]): UmlClass[] {
  return [...clases].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * El segmento que se propone al escribir el nombre del módulo.
 *
 * Es una propuesta, no una conversión obligatoria: el campo queda editable y
 * lo que se genera es lo que quede escrito. Por eso aquí sí se transliteran las
 * tildes y se juntan las palabras —«Recursos Humanos» → `recursos_humanos`—,
 * mientras que un nombre de clase se rechaza en vez de arreglarse: el nombre de
 * clase lo escribe alguien sabiendo que es un identificador, y el del módulo es
 * prosa.
 *
 * Devuelve la cadena vacía cuando de ahí no sale nada válido —«2020», «class»—
 * en vez de inventar un sufijo. Un segmento inventado es peor que un campo
 * vacío: el campo vacío se ve, y `class2` acaba en el `package` sin que nadie
 * haya decidido llamarlo así.
 */
export function sugerirSegmento(nombre: string): string {
  const candidato = toSnakeCase(nombre);
  return isValidJavaPackageSegment(candidato) ? candidato : '';
}

/**
 * Por qué no vale este segmento, o `null` si vale.
 *
 * Se comprueba lo mismo que el generador comprobará después —lista blanca y
 * unicidad— porque el sitio donde hay que decirlo es el formulario, no un
 * mensaje de error al pulsar «Generar» diez minutos más tarde. Que esté
 * duplicado no es duplicidad ociosa: la validación del generador es la que
 * manda y no se puede quitar, y esta es la que hace que no haga falta.
 */
export function errorDeSegmento(
  segmento: string,
  modulos: UmlModule[],
  exceptoId: string | null = null,
): string | null {
  if (segmento.length === 0) return 'Escriba el paquete del módulo.';

  if (!isValidJavaPackageSegment(segmento)) {
    return segmento.includes('.')
      ? 'El paquete del módulo es un único tramo: escriba «ventas», no «com.ventas».'
      : 'Use minúsculas, dígitos y guion bajo, sin empezar por dígito ni usar palabras reservadas de Java.';
  }

  const ocupado = modulos.find((m) => m.id !== exceptoId && m.packageSegment === segmento);
  if (ocupado) {
    return `«${ocupado.name}» ya usa el paquete «${segmento}»: sus clases acabarían mezcladas en la misma carpeta.`;
  }

  return null;
}

/** Por qué no vale este nombre, o `null` si vale. */
export function errorDeNombre(
  nombre: string,
  modulos: UmlModule[],
  exceptoId: string | null = null,
): string | null {
  const limpio = nombre.trim();
  if (limpio.length === 0) return 'Escriba el nombre del módulo.';

  const repetido = modulos.find(
    (m) => m.id !== exceptoId && m.name.toLowerCase() === limpio.toLowerCase(),
  );
  return repetido ? 'Ya hay un módulo con ese nombre.' : null;
}

/**
 * Dónde acabará el fichero de esta clase, para enseñarlo junto a su nombre.
 *
 * Es la frase que convierte el módulo en algo comprobable: quien mueve `Pedido`
 * a «Ventas» ve cambiar la ruta antes de generar nada, y al descomprimir el ZIP
 * encuentra el fichero exactamente ahí.
 */
export function rutaDeClase(diagrama: ClassDiagram, cls: UmlClass): string {
  const paquete = packageForClass(diagrama, cls);
  return `${paquete.split('.').join('/')}/domain/${toPascalCase(cls.name)}.java`;
}
