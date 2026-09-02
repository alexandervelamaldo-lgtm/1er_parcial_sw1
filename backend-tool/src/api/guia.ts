import { Router } from 'express';
import { z } from 'zod';
import type { GuiaDelManual } from '../ai/guia.js';
import { handler, parseBody } from './http.js';

/**
 * La guía de la herramienta: «¿cómo se hace esto?».
 *
 * No cuelga de ningún proyecto porque no habla de ninguno: habla de la
 * herramienta. La pregunta que más se hace —«¿por dónde empiezo?»— se hace
 * justamente antes de tener un proyecto abierto.
 *
 * Sí exige sesión, aunque no toque datos de nadie. El motivo es económico y no
 * de privacidad: cada pregunta contestada por el modelo cuesta dinero de una
 * clave nuestra, y una ruta abierta es una factura abierta.
 *
 * Nunca devuelve un error cuando el modelo falla: `GuiaDelManual` degrada a las
 * secciones del manual, que responden igual aunque peor redactadas, y dice con
 * qué motor ha contestado. Un 500 aquí sería tirar a la basura una respuesta
 * que ya teníamos en la mano.
 */

const PeticionSchema = z.object({
  texto: z.string().trim().min(1).max(500),
});

export function guiaRouter(guia: GuiaDelManual): Router {
  const router = Router();

  router.post(
    '/',
    handler(async (request, response) => {
      const body = parseBody(PeticionSchema, request.body);
      const resultado = await guia.responder(body.texto);

      response.json({
        motor: resultado.motor,
        texto: resultado.texto,
        aviso: resultado.aviso ?? null,
        fuentes: resultado.fuentes.map(({ fragmento }) => ({
          documento: fragmento.documento,
          titulo: fragmento.titulo,
          ruta: fragmento.ruta,
          ancla: fragmento.ancla,
          texto: fragmento.texto,
        })),
      });
    }),
  );

  return router;
}
