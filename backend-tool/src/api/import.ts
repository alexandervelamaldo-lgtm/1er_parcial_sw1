import { Router } from 'express';
import { z } from 'zod';
import {
  describeOperation,
  interpretarDiagramaExtraido,
  interpretarTablaExtraida,
  parseDiagramaExtraido,
  parseTablaExtraida,
  readDiagram,
} from '@app/shared';
import type { VisionEngine } from '../ai/vision.js';
import { ErrorDeModelo } from '../ai/transporte.js';
import type { ProjectStore } from '../storage/store.js';
import type { RoomManager } from '../collab/rooms.js';
import { badRequest, handler, parseBody, requireRole } from './http.js';

/**
 * Importación de una tabla fotografiada (RF-OCR-01 … RF-OCR-04).
 *
 * Dos rutas, y la separación entre ellas es el diseño entero:
 *
 * - `POST …/importar-tabla/leer` manda la foto al modelo y devuelve lo que ha
 *   leído. No toca el diagrama.
 * - `POST …/importar-tabla/proponer` recibe la tabla *ya revisada por la
 *   persona* y devuelve las operaciones que la materializarían. Tampoco toca el
 *   diagrama: aplicarlas es una tercera llamada explícita a
 *   `/diagrama/operaciones`.
 *
 * Podrían ser una sola ruta que leyera y aplicara de un tirón, y el enunciado
 * original pedía justamente eso —«extraiga toda la información de forma
 * automática y la copie íntegramente»—. No se ha hecho, y el motivo es medible:
 * el modelo de visión leyó `ana@rrhh.com` como `ana@rrrh.com` declarando
 * confianza 1.0 sobre una imagen limpia. Un camino automático habría escrito ese
 * correo en el diagrama, de ahí al `data.sql` y de ahí a la base de datos del
 * proyecto generado, sin que nadie mirase la foto en ningún momento. La revisión
 * intermedia no es fricción: es el único punto del recorrido donde alguien
 * compara lo escrito con lo fotografiado.
 *
 * Ambas exigen permiso de edición. La primera no escribe, pero sube una imagen
 * al proveedor de modelo con cargo a la clave de esta instalación, y el resumen
 * del diagrama que devuelve es información del proyecto.
 */

/**
 * La imagen llega en base64 dentro del JSON.
 *
 * Es un tercio más grande que el binario y a cambio evita añadir `multipart` al
 * servicio para una sola ruta. El límite se comprueba sobre los bytes ya
 * descodificados, que es la magnitud que el usuario reconoce cuando se le dice
 * «tu foto pesa 6 MB».
 */
const LeerSchema = z.object({
  imagen: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).default('image/png'),
});

const ProponerSchema = z.object({
  tabla: z.unknown(),
});

const ProponerDiagramaSchema = z.object({
  diagrama: z.unknown(),
});

/** Firmas de los formatos admitidos, en hexadecimal. */
const FIRMAS: { mime: string; bytes: number[] }[] = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  // WebP es RIFF....WEBP; se comprueban los cuatro primeros y los cuatro de la
  // posición 8, que es donde va la etiqueta de formato.
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
];

/**
 * Comprueba que los bytes son de verdad una imagen del tipo declarado.
 *
 * El `mimeType` lo dice el cliente, y un cliente puede decir cualquier cosa.
 * Sin esta comprobación, la ruta acepta cualquier base64 —un ZIP, un ejecutable,
 * cuatro megas de ceros— y lo reenvía al proveedor de modelo a costa de la clave
 * de esta instalación. Es una lista blanca de firmas, no una detección: lo que
 * no reconoce, lo rechaza.
 */
function pareceImagen(datos: Buffer, mimeDeclarado: string): boolean {
  const firma = FIRMAS.find((f) => f.mime === mimeDeclarado);
  if (!firma) return false;
  if (datos.length < 16) return false;
  if (!firma.bytes.every((byte, i) => datos[i] === byte)) return false;
  if (mimeDeclarado === 'image/webp') {
    return datos.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  return true;
}

/**
 * Comprueba la imagen recibida y devuelve el base64 limpio, listo para el modelo.
 *
 * Está aparte porque ahora hay dos lecturas —tabla y diagrama— y las dos suben
 * una imagen al proveedor con cargo a la clave de esta instalación. Duplicar las
 * comprobaciones garantizaba que tarde o temprano una de las dos se quedase sin
 * alguna: la de la firma es justo la que impide que la ruta acepte cualquier
 * base64 y lo reenvíe.
 */
function comprobarImagen(
  imagen: string,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
  maxImageBytes: number,
): string {
  // `base64` en Node ignora en silencio los caracteres que no pertenecen al
  // alfabeto, así que se comprueba antes: una cadena basura descodificaría a un
  // buffer corto en lugar de dar error, y el fallo aparecería mucho más tarde
  // como «el modelo no ve ninguna tabla».
  const limpia = imagen.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpia)) {
    throw badRequest('La imagen no está correctamente codificada en base64');
  }

  const datos = Buffer.from(limpia, 'base64');
  if (datos.byteLength > maxImageBytes) {
    const mb = (maxImageBytes / (1024 * 1024)).toFixed(1);
    throw badRequest(
      `La imagen pesa ${(datos.byteLength / (1024 * 1024)).toFixed(1)} MB y el máximo son ${mb} MB. ` +
        'Recorta la foto para dejar solo lo que hay que leer: además de entrar, se lee mejor.',
      'IMAGEN_DEMASIADO_GRANDE',
    );
  }
  if (!pareceImagen(datos, mimeType)) {
    throw badRequest(`El contenido no es una imagen ${mimeType} válida`, 'IMAGEN_NO_VALIDA');
  }

  return limpia;
}

/**
 * Traduce el fallo del proveedor a algo que se pueda leer y accionar.
 *
 * El cuerpo crudo se sigue adjuntando —es lo único que distingue «clave mala»
 * de «modelo retirado» cuando alguien viene a depurar—, pero delante va una
 * frase que diga qué hacer. Un `503 [{"error":{"code":503,…}}]` en mitad de la
 * pantalla no le dice a un usuario que basta con volver a intentarlo dentro de
 * un minuto, y hace parecer roto lo que solo está ocupado.
 */
function explicarFalloDeLectura(error: ErrorDeModelo): string {
  const causa = ((): string | null => {
    switch (error.status) {
      case 429:
        return 'Se ha agotado la cuota del proveedor por ahora. Espera un minuto y vuelve a intentarlo.';
      case 502:
      case 503:
      case 504:
        return (
          'El modelo de visión está saturado. Ya se ha reintentado varias veces sin suerte: ' +
          'la imagen no tiene nada de malo, vuelve a intentarlo en un momento.'
        );
      case 401:
      case 403:
        return 'El proveedor ha rechazado la clave. Revisa LLM_VISION_API_KEY en el .env del servidor.';
      case 402:
        return 'La cuenta del proveedor se ha quedado sin saldo.';
      case 404:
        return (
          'El proveedor no conoce ese modelo; suele pasar cuando retiran una versión. ' +
          'Revisa LLM_VISION_MODEL en el .env del servidor: el detalle de abajo nombra el sustituto.'
        );
      default:
        return null;
    }
  })();

  return causa ? `${causa} (respuesta del proveedor: ${error.message})` : error.message;
}

/** Mensaje único para cuando la instalación no tiene visión configurada. */
function exigirVision(vision: VisionEngine | undefined): VisionEngine {
  if (!vision) {
    throw badRequest(
      'Esta instalación no tiene configurado un modelo de visión. Define LLM_VISION_MODEL ' +
        'y LLM_VISION_API_KEY en el .env del servidor.',
      'SIN_MODELO_VISION',
    );
  }
  return vision;
}

export function importRouter(deps: {
  store: ProjectStore;
  rooms: RoomManager;
  vision?: VisionEngine;
  maxImageBytes: number;
}): Router {
  const { store, rooms, vision, maxImageBytes } = deps;
  const router = Router();

  router.post(
    '/:proyectoId/importar-tabla/leer',
    requireRole(store, 'editor'),
    handler(async (request, response) => {
      const motor = exigirVision(vision);
      const body = parseBody(LeerSchema, request.body);
      const limpia = comprobarImagen(body.imagen, body.mimeType, maxImageBytes);

      let tabla;
      try {
        tabla = await motor.extraerTabla(limpia, body.mimeType);
      } catch (error) {
        if (error instanceof ErrorDeModelo) {
          // Se propaga el motivo del proveedor: distingue entre «saldo agotado»
          // y «la foto no se entiende», que se arreglan de forma muy distinta.
          throw badRequest(
            `No se pudo leer la imagen: ${explicarFalloDeLectura(error)}`,
            'LECTURA_FALLIDA',
          );
        }
        throw error;
      }

      const room = await rooms.open(request.params.proyectoId ?? '');
      const interpretacion = interpretarTablaExtraida(tabla, readDiagram(room.doc));

      response.json({
        modelo: motor.model,
        tabla,
        // Se manda el aviso ya calculado para que el cuadro de revisión enseñe
        // desde el primer momento lo que va a fallar, sin esperar a que el
        // usuario pulse nada.
        clase: interpretacion.clase,
        avisos: interpretacion.avisos,
        aplicable: interpretacion.aplicable,
        // La confianza se muestra como dato informativo, nunca como permiso. El
        // cliente no debe usarla para saltarse la revisión, y por eso no se
        // manda ningún campo que sugiera que podría.
        confianzaDeclarada: tabla.confianza,
      });
    }),
  );

  router.post(
    '/:proyectoId/importar-tabla/proponer',
    requireRole(store, 'editor'),
    handler(async (request, response) => {
      const body = parseBody(ProponerSchema, request.body);

      // Se revalida entera aunque venga de nuestra propia ruta de lectura: entre
      // una llamada y otra ha pasado por las manos del usuario, que es
      // exactamente el punto, y por el JavaScript del navegador, que no cuenta
      // como frontera de confianza.
      const tabla = parseTablaExtraida(body.tabla);
      if (!tabla.ok) throw badRequest(`La tabla revisada no es válida: ${tabla.error}`);

      const room = await rooms.open(request.params.proyectoId ?? '');
      const resultado = interpretarTablaExtraida(tabla.value, readDiagram(room.doc));

      response.json({
        clase: resultado.clase,
        avisos: resultado.avisos,
        aplicable: resultado.aplicable,
        // Como en el asistente: la descripción legible la calcula el servidor a
        // partir de la operación, para que lo que el usuario lee y lo que se va
        // a aplicar no puedan ser cosas distintas.
        propuesta: resultado.operaciones.map((operacion) => ({
          operacion,
          descripcion: describeOperation(operacion),
        })),
      });
    }),
  );

  /**
   * Lectura de un diagrama de clases entero (RF-VIS-01).
   *
   * Misma pareja de rutas y misma frontera que arriba: `leer` mira la foto y no
   * toca nada, `proponer` recibe lo ya revisado y devuelve operaciones. Lo que
   * cambia es cuánto hay en juego. Al importar una tabla, lo peor que puede
   * pasar es una columna con el nombre mal escrito. Al importar un diagrama, una
   * cardinalidad leída al revés cambia dónde va la clave foránea, y eso no se ve
   * mirando el lienzo: se descubre al generar el proyecto, o más tarde.
   *
   * Por eso la respuesta de `leer` lleva `cardinalidadesDudosas` explícito. La
   * pantalla lo necesita para poder decir «dos relaciones sin cardinalidad
   * legible» antes de que nadie pulse nada, en lugar de esconderlo en una lista
   * de avisos que se pasa por encima.
   */
  router.post(
    '/:proyectoId/importar-diagrama/leer',
    requireRole(store, 'editor'),
    handler(async (request, response) => {
      const motor = exigirVision(vision);
      const body = parseBody(LeerSchema, request.body);
      const limpia = comprobarImagen(body.imagen, body.mimeType, maxImageBytes);

      let diagrama;
      try {
        diagrama = await motor.extraerDiagrama(limpia, body.mimeType);
      } catch (error) {
        if (error instanceof ErrorDeModelo) {
          throw badRequest(
            `No se pudo leer la imagen: ${explicarFalloDeLectura(error)}`,
            'LECTURA_FALLIDA',
          );
        }
        throw error;
      }

      const room = await rooms.open(request.params.proyectoId ?? '');
      const interpretacion = interpretarDiagramaExtraido(diagrama, readDiagram(room.doc));

      response.json({
        modelo: motor.model,
        diagrama,
        clases: interpretacion.clases,
        relaciones: interpretacion.relaciones,
        avisos: interpretacion.avisos,
        aplicable: interpretacion.aplicable,
        resumen: interpretacion.resumen,
        // Informativa, nunca un permiso: el modelo declaró confianza 1.0 sobre
        // una lectura equivocada, así que no se manda nada que sugiera que este
        // número puede ahorrarle a alguien mirar la foto.
        confianzaDeclarada: diagrama.confianza,
      });
    }),
  );

  router.post(
    '/:proyectoId/importar-diagrama/proponer',
    requireRole(store, 'editor'),
    handler(async (request, response) => {
      const body = parseBody(ProponerDiagramaSchema, request.body);

      // Se revalida entero aunque venga de nuestra propia ruta de lectura: entre
      // una llamada y otra ha pasado por las manos del usuario —que es
      // exactamente el punto— y por el JavaScript del navegador, que no cuenta
      // como frontera de confianza.
      const diagrama = parseDiagramaExtraido(body.diagrama);
      if (!diagrama.ok) {
        throw badRequest(`El diagrama revisado no es válido: ${diagrama.error}`);
      }

      const room = await rooms.open(request.params.proyectoId ?? '');
      const resultado = interpretarDiagramaExtraido(diagrama.value, readDiagram(room.doc));

      response.json({
        clases: resultado.clases,
        relaciones: resultado.relaciones,
        avisos: resultado.avisos,
        aplicable: resultado.aplicable,
        resumen: resultado.resumen,
        // La descripción legible la calcula el servidor a partir de la
        // operación, para que lo que el usuario lee y lo que se va a aplicar no
        // puedan ser cosas distintas.
        propuesta: resultado.operaciones.map((operacion) => ({
          operacion,
          descripcion: describeOperation(operacion),
        })),
      });
    }),
  );

  return router;
}
