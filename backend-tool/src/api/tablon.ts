import { Router } from 'express';
import { z } from 'zod';
import {
  MAXIMA_DURACION_MS,
  MAXIMO_AUDIO_BYTES,
  MENSAJES_POR_PAGINA,
  extensionDeAudio,
  normalizarTexto,
  normalizarTipoAudio,
  type Mensaje,
  type MensajePublico,
} from '@app/shared';
import type { IdentityProvider } from '../auth/identity.js';
import type { ProjectStore } from '../storage/store.js';
import type { PaginaTablon, TablonStore } from '../storage/tablon.js';
import { badRequest, forbidden, handler, notFound, parseBody, requireRole } from './http.js';
import { limiteDeTasa } from './proteccion.js';

/**
 * El tablón del proyecto: comunicación interna por texto y por voz.
 *
 * Cinco rutas, todas colgando de `/api/proyectos/:proyectoId/tablon`, que es
 * donde `requireAuth` ya está puesto para todo el subárbol. El permiso lo
 * resuelve `requireRole` contra el mismo `ProjectStore` que gobierna el
 * diagrama: no hay una segunda lista de quién puede hablar que pueda
 * desincronizarse de la de quién puede entrar.
 *
 * ## Quién puede escribir
 *
 * Basta con ser miembro, incluso `viewer`. Es deliberado y va en contra del
 * reflejo de pedir `editor`: a un `viewer` se le invita precisamente para que
 * revise el diagrama, y un revisor que no puede decir «esta cardinalidad está
 * al revés» no está revisando nada. El permiso de edición gobierna el modelo,
 * que es lo que se genera y se despliega; el tablón es la conversación sobre el
 * modelo, y silenciar a media sala convierte el módulo en decorado.
 *
 * ## El sondeo
 *
 * Una sola ruta de lectura con tres comportamientos según la consulta, porque
 * para el cliente es una sola pregunta —«dame lo que me toca»— hecha desde tres
 * situaciones:
 *
 * - sin parámetros: abre la pantalla, devuelve el final del hilo;
 * - `?desde=N`: sondea, devuelve lo que ha cambiado desde la versión N;
 * - `?antesDe=N`: sube por el hilo desde la secuencia N.
 *
 * `desde` y `antesDe` son numeraciones distintas y no se pueden mezclar: ver la
 * cabecera de `shared/src/tablon/mensaje.ts`. Si llegan las dos manda `desde`,
 * porque el sondeo es lo que no se puede dejar de contestar.
 *
 * La lectura **no** lleva límite de tasa. Sondear cada tres segundos son veinte
 * peticiones por minuto y persona, y un tope pensado para frenar un script
 * echaría abajo el uso normal. La publicación sí lo lleva.
 */

/**
 * Cuota de publicación.
 *
 * Vive aquí y no junto a las demás en `app.ts` porque las de allí se montan por
 * camino, y este camino incluye el sondeo: montarlo arriba gastaría cuota con
 * cada vuelta del temporizador y el tablón se apagaría solo a los tres minutos
 * de tenerlo abierto. Se aplica ruta a ruta, solo a lo que escribe.
 *
 * Treinta por minuto es más de lo que teclea nadie —un mensaje cada dos
 * segundos durante un minuto entero— y muy poco para un bucle que quiera llenar
 * el disco a base de notas de voz de un megabyte.
 */
const LIMITE_PUBLICACION = { ventanaMs: 60_000, maximo: 30, nombre: 'al tablón' };

const PublicarTextoSchema = z.object({
  texto: z.string().max(10_000),
});

/**
 * La nota de voz llega en base64 dentro del JSON.
 *
 * Mismo trato que la foto de `import.ts` y por el mismo motivo: añadir
 * `multipart` al servicio por una sola ruta cuesta más que el tercio de más que
 * abulta base64. El tipo llega tal cual lo declara `MediaRecorder`
 * —`audio/webm;codecs=opus`— y por eso aquí es `string` y no el enum: la
 * reducción a uno de los tres literales la hace `normalizarTipoAudio`, que
 * rechaza lo que no reconoce en vez de arreglarlo.
 */
const PublicarVozSchema = z.object({
  audio: z.string().min(1),
  tipo: z.string().min(1).max(100),
  duracionMs: z.number().int().nonnegative().max(MAXIMA_DURACION_MS),
});

/**
 * Descodifica el audio recibido y comprueba que cabe.
 *
 * `Buffer.from(…, 'base64')` ignora en silencio los caracteres que no son del
 * alfabeto: una cadena basura no da error, da un buffer corto, y el fallo
 * reaparecería mucho después como «la nota no suena». Se comprueba antes.
 *
 * No hay comprobación de firma como la que hace `import.ts` con las imágenes, y
 * la diferencia está en el destino: una foto se reenvía al proveedor de modelo
 * con cargo a nuestra clave, así que interesa saber que es una foto antes de
 * pagarla. Estos bytes se guardan y se devuelven a los miembros del mismo
 * proyecto con un `Content-Type` que es una constante nuestra y con `nosniff`
 * puesto; lo peor que consigue quien suba basura es gastarse su propio
 * megabyte.
 */
function descodificarAudio(base64: string): Buffer {
  const limpia = base64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(limpia)) {
    throw badRequest('La nota de voz no está correctamente codificada en base64');
  }

  const datos = Buffer.from(limpia, 'base64');
  if (datos.byteLength === 0) {
    throw badRequest('La nota de voz está vacía', 'AUDIO_VACIO');
  }
  if (datos.byteLength > MAXIMO_AUDIO_BYTES) {
    const kb = Math.round(MAXIMO_AUDIO_BYTES / 1024);
    throw badRequest(
      `La nota de voz ocupa ${Math.round(datos.byteLength / 1024)} kB y el máximo son ${kb} kB.`,
      'AUDIO_DEMASIADO_GRANDE',
    );
  }
  return datos;
}

/** Lee un número de la consulta, o `null` si no viene o no lo es. */
function numeroDeConsulta(valor: unknown): number | null {
  if (typeof valor !== 'string' || valor.trim() === '') return null;
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < 0) return null;
  return numero;
}

/**
 * Añade a cada mensaje el nombre de quien lo escribió.
 *
 * Se resuelve aquí y no en el cliente a partir de la lista de miembros porque
 * quien escribió hace dos semanas puede haber sido expulsado desde entonces, y
 * sus mensajes pasarían a aparecer firmados por nadie justo en la conversación
 * que explica por qué se fue.
 *
 * El mapa no es una optimización menor: una página son cincuenta mensajes y en
 * un hilo los escriben tres o cuatro personas. Sin él serían cincuenta
 * consultas al proveedor de identidad por cada vuelta del sondeo, de cada
 * cliente conectado.
 */
async function conNombres(
  mensajes: Mensaje[],
  identity: IdentityProvider,
): Promise<MensajePublico[]> {
  const nombres = new Map<string, string | null>();

  for (const mensaje of mensajes) {
    if (nombres.has(mensaje.autorId)) continue;
    const perfil = await identity.findById(mensaje.autorId);
    nombres.set(mensaje.autorId, perfil?.displayName ?? null);
  }

  return mensajes.map((mensaje) => ({
    ...mensaje,
    autorNombre: nombres.get(mensaje.autorId) ?? null,
  }));
}

async function responderPagina(
  pagina: PaginaTablon,
  identity: IdentityProvider,
): Promise<{ mensajes: MensajePublico[]; cursor: number; hayMas: boolean }> {
  return {
    mensajes: await conNombres(pagina.mensajes, identity),
    cursor: pagina.cursor,
    hayMas: pagina.hayMas,
  };
}

export function tablonRouter(deps: {
  store: ProjectStore;
  identity: IdentityProvider;
  tablon: TablonStore;
}): Router {
  const { store, identity, tablon } = deps;
  const router = Router();
  const cuotaDePublicacion = limiteDeTasa(LIMITE_PUBLICACION);

  router.get(
    '/:proyectoId/tablon',
    requireRole(store, 'viewer'),
    handler(async (request, response) => {
      const proyectoId = request.params.proyectoId ?? '';
      const desde = numeroDeConsulta(request.query.desde);
      const antesDe = numeroDeConsulta(request.query.antesDe);

      const pagina =
        desde !== null
          ? await tablon.cambiosDesde(proyectoId, desde, MENSAJES_POR_PAGINA)
          : antesDe !== null
            ? await tablon.anterioresA(proyectoId, antesDe, MENSAJES_POR_PAGINA)
            : await tablon.ultimos(proyectoId, MENSAJES_POR_PAGINA);

      response.json(await responderPagina(pagina, identity));
    }),
  );

  router.post(
    '/:proyectoId/tablon',
    requireRole(store, 'viewer'),
    cuotaDePublicacion,
    handler(async (request, response) => {
      const body = parseBody(PublicarTextoSchema, request.body);

      // El esquema admite diez mil caracteres y el tope real son dos mil: el
      // margen existe para que quien se pase reciba «supera los 2000
      // caracteres» y no un error de validación genérico sobre un campo. El
      // recorte y el límite los decide `normalizarTexto`, que es la misma
      // función que usará el cliente para desactivar el botón de enviar.
      const texto = normalizarTexto(body.texto);
      if (!texto.ok) throw badRequest(texto.motivo, 'MENSAJE_INVALIDO');

      const mensaje = await tablon.publicarTexto({
        proyectoId: request.params.proyectoId ?? '',
        autorId: request.user.id,
        texto: texto.texto,
      });

      const [publico] = await conNombres([mensaje], identity);
      response.status(201).json({ mensaje: publico });
    }),
  );

  router.post(
    '/:proyectoId/tablon/voz',
    requireRole(store, 'viewer'),
    cuotaDePublicacion,
    handler(async (request, response) => {
      const body = parseBody(PublicarVozSchema, request.body);

      const tipo = normalizarTipoAudio(body.tipo);
      if (!tipo) {
        throw badRequest(
          `Ese formato de audio no se admite. Se aceptan webm, ogg y mp4.`,
          'AUDIO_NO_ADMITIDO',
        );
      }

      const datos = descodificarAudio(body.audio);

      const mensaje = await tablon.publicarVoz({
        proyectoId: request.params.proyectoId ?? '',
        autorId: request.user.id,
        audio: datos,
        tipo,
        duracionMs: body.duracionMs,
      });

      const [publico] = await conNombres([mensaje], identity);
      response.status(201).json({ mensaje: publico });
    }),
  );

  /**
   * Los bytes de una nota de voz.
   *
   * Van por su propia ruta y no dentro del listado para que abrir el tablón no
   * descargue todas las notas del hilo: la mayoría no se reproducen nunca.
   *
   * El `Content-Type` sale de `mensaje.audio.tipo`, que solo puede ser uno de
   * los tres literales de `TIPOS_AUDIO` porque es lo único que el almacén
   * acepta guardar. Nunca es una cadena que haya escrito un cliente, que es lo
   * que convertiría esta línea en una inyección de cabeceras.
   */
  router.get(
    '/:proyectoId/tablon/:mensajeId/audio',
    requireRole(store, 'viewer'),
    handler(async (request, response) => {
      const proyectoId = request.params.proyectoId ?? '';
      const mensajeId = request.params.mensajeId ?? '';

      const mensaje = await tablon.obtener(proyectoId, mensajeId);
      if (!mensaje || mensaje.retirado || !mensaje.audio) {
        throw notFound('Esa nota de voz no está disponible');
      }

      const datos = await tablon.leerAudio(proyectoId, mensajeId);
      if (!datos) throw notFound('Esa nota de voz no está disponible');

      response.setHeader('Content-Type', mensaje.audio.tipo);
      response.setHeader('Content-Length', String(datos.byteLength));
      // `inline` para que el navegador lo reproduzca en el reproductor de la
      // página en vez de ofrecer una descarga, que es lo que hace `attachment`.
      response.setHeader(
        'Content-Disposition',
        `inline; filename="nota-${mensaje.secuencia}.${extensionDeAudio(mensaje.audio.tipo)}"`,
      );
      // Cinco minutos, y privado. El audio no cambia nunca —retirarlo lo borra,
      // no lo sustituye—, así que cachearlo para siempre sería correcto salvo
      // por lo que pasa al retirarlo: quien ya lo hubiera oído podría seguir
      // reproduciéndolo desde su caché mucho después de que dejara de existir
      // en el servidor. Cinco minutos cubren el caso real, que es volver a
      // pulsar play sobre la misma nota, sin convertir una retirada en algo
      // solo nominal.
      response.setHeader('Cache-Control', 'private, max-age=300');
      response.end(Buffer.from(datos));
    }),
  );

  /**
   * Retirar un mensaje.
   *
   * Lo puede hacer quien lo escribió y el propietario del proyecto, nadie más.
   * El autor porque se equivocó; el propietario porque es quien responde del
   * proyecto y alguien tiene que poder quitar lo que no debería estar ahí sin
   * depender de que su autor siga teniendo cuenta.
   *
   * No es un borrado: el mensaje sigue en el hilo marcado como retirado, sin
   * texto y sin audio. Ver la cabecera del contrato para por qué.
   */
  router.delete(
    '/:proyectoId/tablon/:mensajeId',
    requireRole(store, 'viewer'),
    handler(async (request, response) => {
      const proyectoId = request.params.proyectoId ?? '';
      const mensajeId = request.params.mensajeId ?? '';

      const mensaje = await tablon.obtener(proyectoId, mensajeId);
      if (!mensaje) throw notFound('Ese mensaje no existe');

      if (mensaje.autorId !== request.user.id && request.role !== 'owner') {
        throw forbidden('Solo puedes retirar tus propios mensajes');
      }

      const lapida = await tablon.retirar(proyectoId, mensajeId);
      if (!lapida) throw notFound('Ese mensaje no existe');

      const [publico] = await conNombres([lapida], identity);
      response.json({ mensaje: publico });
    }),
  );

  return router;
}
