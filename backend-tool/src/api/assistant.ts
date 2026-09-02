import { Router } from 'express';
import { z } from 'zod';
import { describeOperation, readDiagram } from '@app/shared';
import type { AssistantEngine } from '../ai/assistant.js';
import type { ProjectStore } from '../storage/store.js';
import type { RoomManager } from '../collab/rooms.js';
import { handler, parseBody, requireRole } from './http.js';

/**
 * Interpretación de órdenes del asistente (RF-IA-01, RF-IA-04).
 *
 * Devuelve una propuesta y no la aplica. Aplicarla es una segunda llamada
 * explícita a `/diagrama/operaciones`, hecha solo si el usuario acepta lo que ha
 * visto (decisión D6).
 *
 * Requiere permiso de edición aunque no escriba: proponer cambios a quien no
 * puede aplicarlos no tiene utilidad, y el resumen del diagrama que se envía al
 * modelo es información del proyecto.
 */

const PeticionSchema = z.object({
  texto: z.string().trim().min(1).max(2000),
});

export function assistantRouter(deps: {
  store: ProjectStore;
  rooms: RoomManager;
  assistant: AssistantEngine;
}): Router {
  const { store, rooms, assistant } = deps;
  const router = Router();

  router.post(
    '/:proyectoId/asistente',
    requireRole(store, 'editor'),
    handler(async (request, response) => {
      const body = parseBody(PeticionSchema, request.body);
      const room = await rooms.open(request.params.proyectoId ?? '');
      const diagram = readDiagram(room.doc);

      const result = await assistant.interpret(body.texto, diagram);

      response.json({
        motor: assistant.name,
        confianza: result.confidence,
        aclaracion: result.clarification,
        explicacion: result.explanation,
        // La descripción legible se calcula aquí y no la escribe el modelo: si
        // la escribiera él, podría describir algo distinto de lo que la
        // operación hace, y el usuario aprobaría lo que leyó, no lo que pasa.
        propuesta: result.operations.map((operation) => ({
          operacion: operation,
          descripcion: describeOperation(operation),
        })),
      });
    }),
  );

  return router;
}
