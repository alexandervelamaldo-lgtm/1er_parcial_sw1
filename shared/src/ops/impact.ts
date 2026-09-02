import type { ClassDiagram, UmlClass } from '../model/uml.js';
import type { Operation } from './operations.js';
import { isDestructiveOperation } from './operations.js';

/**
 * Qué se pierde exactamente al aplicar una operación.
 *
 * Existe porque «¿Seguro que quieres continuar?» no es una confirmación: no
 * dice qué se pierde, así que quien lo lee no puede decidir nada y acaba
 * pulsando «Sí» por costumbre. Peor aún con voz, donde el usuario no eligió la
 * operación de un menú sino que dictó una frase que el modelo interpretó, y bien
 * puede haberla interpretado mal.
 *
 * El caso que lo justifica: «elimina la clase Pedido» borra también todas sus
 * relaciones —lo hace `applyOperation`, en cascada— y con ellas las claves
 * ajenas del esquema generado. Quien dicta esa frase está pensando en una caja
 * del lienzo, no en las tres flechas que salen de ella.
 *
 * Se calcula sobre el diagrama, no sobre la operación sola, porque la misma
 * operación destruye cosas distintas según lo que haya: `setSeedRows` sobre una
 * clase vacía no borra nada.
 */

export interface ImpactoOperacion {
  /** Descripción corta de lo que se pierde, ya en castellano. */
  perdidas: string[];
  /** Si es `false`, la operación no destruye nada y no hace falta confirmar. */
  destructiva: boolean;
  /** El nombre de la clase afectada, cuando se puede resolver. */
  clase?: string;
}

function buscarClase(
  diagram: ClassDiagram,
  ref: { id: string } | { name: string },
): UmlClass | undefined {
  if ('id' in ref) return diagram.classes[ref.id];
  const wanted = ref.name.trim().toLowerCase();
  const coincidencias = Object.values(diagram.classes).filter(
    (c) => c.name.toLowerCase() === wanted,
  );
  // Con dos clases del mismo nombre, `applyOperation` se niega a elegir. Aquí se
  // hace lo mismo: describir el impacto de una de las dos sería describir algo
  // que quizá no va a ocurrir.
  return coincidencias.length === 1 ? coincidencias[0] : undefined;
}

function plural(n: number, singular: string, plural_: string): string {
  return `${n} ${n === 1 ? singular : plural_}`;
}

export function describeImpact(diagram: ClassDiagram, op: Operation): ImpactoOperacion {
  if (!isDestructiveOperation(op)) return { perdidas: [], destructiva: false };

  switch (op.op) {
    case 'removeClass': {
      const cls = buscarClase(diagram, op.ref);
      if (!cls) return { perdidas: [], destructiva: true };

      const relaciones = Object.values(diagram.relations).filter(
        (r) => r.source.classId === cls.id || r.target.classId === cls.id,
      );

      const perdidas = [`la clase «${cls.name}»`];
      if (cls.attributes.length > 0) {
        perdidas.push(plural(cls.attributes.length, 'atributo', 'atributos'));
      }
      if (cls.methods.length > 0) {
        perdidas.push(plural(cls.methods.length, 'método', 'métodos'));
      }
      if (cls.seedRows.length > 0) {
        perdidas.push(plural(cls.seedRows.length, 'fila de datos', 'filas de datos'));
      }
      if (relaciones.length > 0) {
        // Se nombran las clases del otro extremo: es lo que permite darse cuenta
        // de que se está a punto de desconectar algo que no se quería tocar.
        const otros = relaciones
          .map((r) => (r.source.classId === cls.id ? r.target.classId : r.source.classId))
          .map((id) => diagram.classes[id]?.name)
          .filter((n): n is string => Boolean(n));
        const lista = [...new Set(otros)].join(', ');
        perdidas.push(
          `${plural(relaciones.length, 'relación', 'relaciones')}${lista ? ` (con ${lista})` : ''}`,
        );
      }
      return { perdidas, destructiva: true, clase: cls.name };
    }

    case 'removeAttribute': {
      const cls = buscarClase(diagram, op.classRef);
      const perdidas = [`el atributo «${op.attributeName}»`];
      const conDatos = cls?.seedRows.filter((row) => op.attributeName in row).length ?? 0;
      if (conDatos > 0) {
        perdidas.push(`su valor en ${plural(conDatos, 'fila', 'filas')} de datos`);
      }
      return { perdidas, destructiva: true, clase: cls?.name };
    }

    case 'removeMethod':
      return {
        perdidas: [`el método «${op.methodName}»`],
        destructiva: true,
        clase: buscarClase(diagram, op.classRef)?.name,
      };

    case 'removeRelation': {
      const relacion = diagram.relations[op.id];
      if (!relacion) return { perdidas: ['una relación'], destructiva: true };
      const origen = diagram.classes[relacion.source.classId]?.name ?? '?';
      const destino = diagram.classes[relacion.target.classId]?.name ?? '?';
      return {
        perdidas: [`la relación ${relacion.kind} entre «${origen}» y «${destino}»`],
        destructiva: true,
      };
    }

    case 'removeSeedRow': {
      const cls = buscarClase(diagram, op.classRef);
      return {
        perdidas: [`la fila ${op.index} de datos de «${cls?.name ?? '?'}»`],
        destructiva: true,
        clase: cls?.name,
      };
    }

    case 'setSeedRows': {
      const cls = buscarClase(diagram, op.classRef);
      const previas = cls?.seedRows.length ?? 0;
      // Aquí se afina lo que `isDestructiveOperation` no puede saber sin el
      // diagrama: rellenar una tabla vacía no pierde nada.
      if (previas === 0) return { perdidas: [], destructiva: false, clase: cls?.name };
      return {
        perdidas: [
          `${plural(previas, 'fila de datos', 'filas de datos')} de «${cls?.name ?? '?'}»` +
            (op.rows.length > 0 ? `, que se sustituyen por ${op.rows.length}` : ''),
        ],
        destructiva: true,
        clase: cls?.name,
      };
    }

    default:
      return { perdidas: [], destructiva: false };
  }
}

/** Impacto conjunto de una propuesta entera, para confirmarla de una vez. */
export function describeBatchImpact(
  diagram: ClassDiagram,
  operations: Operation[],
): { destructiva: boolean; perdidas: string[] } {
  const perdidas: string[] = [];
  for (const op of operations) {
    const impacto = describeImpact(diagram, op);
    if (impacto.destructiva) perdidas.push(...impacto.perdidas);
  }
  return { destructiva: perdidas.length > 0, perdidas };
}
