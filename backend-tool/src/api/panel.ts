import { Router } from 'express';
import { type OrigenCambio, leerHistorial, readDiagram, resumirOrigenes } from '@app/shared';
// La validación vive en el generador y no en `shared` porque lo que comprueba
// son las condiciones para poder generar. Es la misma función que usa
// `generation.ts`, así que el recuento de aquí y el error que sale al intentar
// generar no pueden discrepar.
import { validateDiagram } from '@app/generator';
import type { ProjectStore } from '../storage/store.js';
import type { RoomManager } from '../collab/rooms.js';
import { handler } from './http.js';

/**
 * Resumen de todos los proyectos de quien pregunta, en una sola petición.
 *
 * Por qué agregado en el servidor y no pedido desde el navegador
 * ---------------------------------------------------------------
 * Las cifras que hacen falta viven repartidas en cuatro sitios: los miembros en
 * el almacén, y las clases, los problemas de validación y el historial dentro
 * del documento Yjs de cada proyecto. Montarlo desde el navegador serían tres
 * peticiones por tarjeta —3N en la pantalla de entrada, con N proyectos— y
 * además obligaría a descargar el diagrama entero de cada uno para contar sus
 * clases: kilobytes de modelo para pintar un número.
 *
 * Aquí el trabajo es el mismo pero sin los viajes, y lo que sale por el cable es
 * el recuento, no el modelo.
 *
 * Lo que esto cuesta, dicho sin adornos
 * -------------------------------------
 * Sigue siendo O(N) aperturas de documento, solo que del lado de acá. Cada
 * `rooms.open` carga el documento de disco o de PostgreSQL si nadie lo tenía
 * abierto. Por eso hay un tope (`MAXIMO_RESUMIDOS`) y por eso se cierra lo que
 * se abrió: sin lo segundo, entrar a la pantalla de proyectos dejaría en memoria
 * un `Y.Doc` por proyecto hasta que el proceso se reiniciara.
 *
 * Cuando N deje de ser pequeño, la salida no es subir el tope: es desnormalizar
 * los contadores a la tabla de proyectos y actualizarlos al guardar, con lo que
 * esta ruta pasa a ser una consulta. No se ha hecho ya porque hoy añadiría un
 * camino de escritura que hay que mantener sincronizado a cambio de arreglar un
 * problema que ningún usuario tiene.
 */

/**
 * Cuántos proyectos se resumen.
 *
 * La lista llega ordenada por fecha de modificación descendente desde el
 * almacén, así que el tope se lleva por delante los más viejos, que son
 * exactamente sobre los que nadie está preguntando. Los que quedan fuera siguen
 * apareciendo con sus datos baratos y con `resumen: null`, en vez de
 * desaparecer: un proyecto que no se ve es un proyecto que se da por perdido.
 */
const MAXIMO_RESUMIDOS = 24;

export interface ResumenProyecto {
  clases: number;
  relaciones: number;
  miembros: number;
  /** Errores de validación: mientras haya uno, el backend no se puede generar. */
  problemas: number;
  avisos: number;
  cambios: number;
  porOrigen: Record<OrigenCambio, number>;
  fechasDudosas: number;
}

export function panelRouter(deps: { store: ProjectStore; rooms: RoomManager }): Router {
  const { store, rooms } = deps;
  const router = Router();

  router.get(
    '/',
    handler(async (request, response) => {
      const proyectos = await store.listProjectsForUser(request.user.id);

      const filas = [];
      for (const [indice, proyecto] of proyectos.entries()) {
        if (indice >= MAXIMO_RESUMIDOS) {
          filas.push({ proyecto, resumen: null });
          continue;
        }

        // Secuencial y no en paralelo con `Promise.all`: veinticuatro documentos
        // abriéndose a la vez es un pico de memoria y de entrada/salida que no
        // compra nada, porque quien espera es una sola pantalla.
        const room = await rooms.open(proyecto.id);
        const diagrama = readDiagram(room.doc);
        const validacion = validateDiagram(diagrama);
        const origenes = resumirOrigenes(leerHistorial(room.doc));
        const miembros = await store.listMembers(proyecto.id);

        filas.push({
          proyecto,
          resumen: {
            // `classes` y `relations` son diccionarios indexados por id, no
            // listas: el CRDT necesita poder tocar un elemento sin reescribir
            // el resto. De ahí `Object.keys`.
            clases: Object.keys(diagrama.classes).length,
            relaciones: Object.keys(diagrama.relations).length,
            miembros: miembros.length,
            problemas: validacion.errors.length,
            avisos: validacion.warnings.length,
            cambios: origenes.total,
            porOrigen: origenes.porOrigen,
            fechasDudosas: origenes.fechasDudosas,
          } satisfies ResumenProyecto,
        });

        // Solo cierra si nadie lo tiene abierto de verdad. Si hay alguien
        // editando, la sala se queda como estaba: esto es una consulta y no
        // tiene por qué notarse desde el lienzo de otro.
        await rooms.closeIfEmpty(proyecto.id);
      }

      response.json({ filas, tope: MAXIMO_RESUMIDOS });
    }),
  );

  return router;
}
