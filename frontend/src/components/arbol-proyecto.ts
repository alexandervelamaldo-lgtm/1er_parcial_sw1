import {
  RELATION_KIND_LABELS,
  describeCardinality,
  listClasses,
  listRelations,
  type ClassDiagram,
  type ClassKind,
  type UmlClass,
} from '@app/shared';
import { textoAtributo, textoMetodo } from './geometria-lienzo';

/**
 * El árbol del proyecto, aplanado.
 *
 * Un árbol accesible se recorre con las flechas, y recorrer una estructura
 * anidada con las flechas obliga a saber cuál es la fila siguiente *visible*.
 * Aplanarlo primero convierte ese cálculo en un índice de una lista, que es
 * donde deja de haber sitio para equivocarse.
 *
 * Aquí no hay React ni DOM a propósito: lo que decide qué filas hay y en qué
 * orden se puede probar sin navegador, que es lo único que se puede probar en
 * este proyecto mientras no haya jsdom instalado.
 */

/**
 * Lo que el modelo permite representar, y nada más.
 *
 * `ClassDiagramSchema` tiene un diagrama por proyecto y no tiene paquetes, así
 * que el árbol tiene dos grupos fijos y no una jerarquía de carpetas. Inventar
 * aquí carpetas que el modelo no guarda daría un árbol que se reorganiza solo al
 * recargar.
 */
export type TipoFila = 'grupo' | 'clase' | 'miembro' | 'relacion';

export interface FilaArbol {
  /** Identificador estable de la fila; sirve de clave de React y de foco. */
  id: string;
  tipo: TipoFila;
  /** Profundidad desde la raíz, empezando en 1, tal y como lo cuenta `aria-level`. */
  nivel: number;
  etiqueta: string;
  /** Segunda línea corta: el tipo de la relación, cuántos elementos tiene un grupo. */
  detalle?: string;
  /** Distintivo de una letra: C de clase, I de interfaz, E de enumeración, A de abstracta. */
  marca?: string;
  /** La clase que queda seleccionada al activar la fila, si alguna. */
  clase?: string;
  /** Qué hay que encuadrar en el lienzo al pulsar Enter sobre la fila. */
  centrar: string[];
  expandible: boolean;
  expandida: boolean;
}

export const MARCA_CLASE: Record<ClassKind, string> = {
  class: 'C',
  interface: 'I',
  enum: 'E',
  abstract: 'A',
};

export const GRUPO_CLASES = 'g:clases';
export const GRUPO_RELACIONES = 'g:relaciones';

/** Los dos grupos empiezan abiertos; las clases, cerradas. */
export function expandidosIniciales(): Set<string> {
  return new Set([GRUPO_CLASES, GRUPO_RELACIONES]);
}

/**
 * Se ordena por nombre y no por orden de creación.
 *
 * El diagrama guarda las clases en un objeto, cuyo orden es el de inserción y
 * cambia según quién las creara y en qué orden llegaran por el canal
 * colaborativo. Un árbol que se reordena solo cuando otra persona crea algo es
 * un árbol en el que no se puede buscar nada.
 */
function porNombre(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'es');
}

function miembrosDe(cls: UmlClass): { id: string; etiqueta: string }[] {
  return [
    ...cls.attributes.map((atributo) => ({
      id: `a:${cls.id}:${atributo.id}`,
      etiqueta: textoAtributo(atributo),
    })),
    ...cls.methods.map((metodo) => ({
      id: `m:${cls.id}:${metodo.id}`,
      etiqueta: textoMetodo(metodo),
    })),
    ...cls.literals.map((literal, i) => ({
      id: `l:${cls.id}:${String(i)}`,
      etiqueta: literal,
    })),
  ];
}

export function filasDelArbol(
  diagrama: ClassDiagram,
  expandidos: ReadonlySet<string>,
): FilaArbol[] {
  const clases = [...listClasses(diagrama)].sort(porNombre);
  const relaciones = listRelations(diagrama);
  const filas: FilaArbol[] = [];

  const clasesAbierto = expandidos.has(GRUPO_CLASES);
  filas.push({
    id: GRUPO_CLASES,
    tipo: 'grupo',
    nivel: 1,
    etiqueta: 'Clases',
    detalle: String(clases.length),
    centrar: [],
    expandible: true,
    expandida: clasesAbierto,
  });

  if (clasesAbierto) {
    for (const cls of clases) {
      const miembros = miembrosDe(cls);
      const abierta = expandidos.has(`c:${cls.id}`);
      filas.push({
        id: `c:${cls.id}`,
        tipo: 'clase',
        nivel: 2,
        etiqueta: cls.name,
        marca: MARCA_CLASE[cls.kind],
        clase: cls.id,
        centrar: [cls.id],
        expandible: miembros.length > 0,
        expandida: abierta && miembros.length > 0,
      });

      if (abierta) {
        for (const miembro of miembros) {
          filas.push({
            id: miembro.id,
            tipo: 'miembro',
            nivel: 3,
            etiqueta: miembro.etiqueta,
            // Un atributo no se selecciona por su cuenta: se selecciona su clase
            // y el panel de propiedades lo muestra dentro. Así el árbol y el
            // lienzo nunca discrepan sobre qué está seleccionado.
            clase: cls.id,
            centrar: [cls.id],
            expandible: false,
            expandida: false,
          });
        }
      }
    }
  }

  const relacionesAbierto = expandidos.has(GRUPO_RELACIONES);
  filas.push({
    id: GRUPO_RELACIONES,
    tipo: 'grupo',
    nivel: 1,
    etiqueta: 'Relaciones',
    detalle: String(relaciones.length),
    centrar: [],
    expandible: true,
    expandida: relacionesAbierto,
  });

  if (relacionesAbierto) {
    const conNombre = relaciones.map((relacion) => {
      const origen = diagrama.classes[relacion.source.classId];
      const destino = diagrama.classes[relacion.target.classId];
      return { relacion, origen, destino };
    });
    // Se ordenan por el nombre del origen para que una relación esté siempre en
    // el mismo sitio de la lista, igual que las clases.
    conNombre.sort((a, b) =>
      (a.origen?.name ?? '').localeCompare(b.origen?.name ?? '', 'es'),
    );

    for (const { relacion, origen, destino } of conNombre) {
      const cardinalidad =
        relacion.kind === 'inheritance' || relacion.kind === 'realization'
          ? null
          : describeCardinality(relacion.source.multiplicity, relacion.target.multiplicity);
      filas.push({
        id: `r:${relacion.id}`,
        tipo: 'relacion',
        nivel: 2,
        // Una relación a una clase que ya no existe no debería poder ocurrir
        // —al borrar una clase se borran sus relaciones—, pero un documento
        // colaborativo puede llegar de cualquier versión anterior. Mejor decir
        // «(sin clase)» que dejar la fila vacía y que parezca un fallo de pintado.
        etiqueta: `${origen?.name ?? '(sin clase)'} → ${destino?.name ?? '(sin clase)'}`,
        detalle: cardinalidad
          ? `${RELATION_KIND_LABELS[relacion.kind]} · ${cardinalidad}`
          : RELATION_KIND_LABELS[relacion.kind],
        centrar: [relacion.source.classId, relacion.target.classId],
        expandible: false,
        expandida: false,
      });
    }
  }

  return filas;
}

/**
 * A dónde va el foco al pulsar una tecla.
 *
 * Devuelve el índice de la fila que debe quedar enfocada y, si la tecla despliega
 * o pliega, qué identificador hay que alternar. Se separa del componente porque
 * es donde están las reglas raras del árbol accesible: la flecha derecha sobre
 * una fila ya abierta entra en el primer hijo, la izquierda sobre una fila
 * cerrada sube al padre.
 */
export interface Movimiento {
  indice: number;
  alternar?: string;
  activar?: boolean;
}

export function moverEnArbol(
  filas: readonly FilaArbol[],
  indice: number,
  tecla: string,
): Movimiento | null {
  const fila = filas[indice];
  if (!fila) return null;

  switch (tecla) {
    case 'ArrowDown':
      return { indice: Math.min(filas.length - 1, indice + 1) };
    case 'ArrowUp':
      return { indice: Math.max(0, indice - 1) };
    case 'Home':
      return { indice: 0 };
    case 'End':
      return { indice: filas.length - 1 };
    case 'ArrowRight':
      if (fila.expandible && !fila.expandida) return { indice, alternar: fila.id };
      if (fila.expandida) return { indice: Math.min(filas.length - 1, indice + 1) };
      return null;
    case 'ArrowLeft': {
      if (fila.expandida) return { indice, alternar: fila.id };
      // Subir al padre es retroceder hasta la primera fila de nivel menor.
      for (let i = indice - 1; i >= 0; i -= 1) {
        const candidata = filas[i];
        if (candidata && candidata.nivel < fila.nivel) return { indice: i };
      }
      return null;
    }
    case 'Enter':
    case ' ':
      return { indice, activar: true };
    default:
      return null;
  }
}
