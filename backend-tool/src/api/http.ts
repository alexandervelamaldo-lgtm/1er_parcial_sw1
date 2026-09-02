import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodTypeAny } from 'zod';
import type { IdentityProvider, UserProfile } from '../auth/identity.js';
import { roleAllows, type ProjectStore, type Role } from '../storage/store.js';

/**
 * Piezas comunes de la capa HTTP: errores, autenticación y validación.
 *
 * El objetivo es que cada ruta contenga solo su regla de negocio. Todo lo que se
 * repetiría —comprobar el token, comprobar el permiso, validar el cuerpo,
 * traducir un fallo a una respuesta— está aquí una sola vez, porque una
 * comprobación de permiso copiada en quince rutas es una comprobación que
 * antes o después falta en una.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'PETICION_INVALIDA'): HttpError =>
  new HttpError(400, message, code);
export const unauthorized = (message = 'Se requiere autenticación'): HttpError =>
  new HttpError(401, message, 'NO_AUTENTICADO');
export const forbidden = (message = 'No tienes permiso para esta operación'): HttpError =>
  new HttpError(403, message, 'SIN_PERMISO');
export const notFound = (message = 'No encontrado'): HttpError =>
  new HttpError(404, message, 'NO_ENCONTRADO');

/** Petición con el usuario ya resuelto. Solo aparece detrás de `requireAuth`. */
export interface AuthenticatedRequest extends Request {
  user: UserProfile;
  /** Permiso sobre el proyecto de la ruta. Solo lo rellena `requireRole`. */
  role?: Role;
}

/**
 * Envuelve un manejador asíncrono.
 *
 * Express 4 no captura promesas rechazadas: sin esto, un `await` que falla deja
 * la petición colgada hasta que expira el tiempo de espera del cliente, sin
 * respuesta ni traza.
 */
export function handler(
  fn: (request: AuthenticatedRequest, response: Response) => Promise<void> | void,
): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(fn(request as AuthenticatedRequest, response)).catch(next);
  };
}

/**
 * Igual que `handler`, pero continúa la cadena al terminar.
 *
 * La distinción no es cosmética: un middleware que no llama a `next()` deja la
 * petición colgada hasta que el cliente se cansa, sin error ni traza. Se separa
 * de `handler` para que la diferencia esté en el nombre y no en recordar añadir
 * una línea al final.
 */
export function middleware(
  fn: (request: AuthenticatedRequest, response: Response) => Promise<void> | void,
): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(fn(request as AuthenticatedRequest, response))
      .then(() => {
        // Si el middleware ya respondió (por ejemplo, una redirección), seguir
        // provocaría un segundo intento de escribir en la misma respuesta.
        if (!response.headersSent) next();
      })
      .catch(next);
  };
}

/** Extrae el token de `Authorization: Bearer …` o del parámetro `token`. */
export function readToken(request: Request): string {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const query = request.query.token;
  return typeof query === 'string' ? query : '';
}

export function requireAuth(identity: IdentityProvider): RequestHandler {
  return middleware(async (request) => {
    const user = await identity.verify(readToken(request));
    if (!user) throw unauthorized();
    request.user = user;
  });
}

/**
 * Exige un permiso mínimo sobre el proyecto indicado en `:proyectoId`.
 *
 * Se resuelve en cada petición y no se cachea en la sesión: si a alguien se le
 * retira el acceso, debe perderlo en la petición siguiente y no cuando caduque
 * su token.
 */
export function requireRole(store: ProjectStore, required: Role): RequestHandler {
  return middleware(async (request) => {
    const projectId = request.params.proyectoId ?? '';
    const project = await store.getProject(projectId);
    // Se responde 404 tanto si el proyecto no existe como si el usuario no
    // pertenece a él: distinguirlos permitiría averiguar qué proyectos existen.
    if (!project) throw notFound('El proyecto no existe');

    const role = await store.roleOf(projectId, request.user.id);
    if (!roleAllows(role, 'viewer')) throw notFound('El proyecto no existe');
    if (!roleAllows(role, required)) throw forbidden();

    request.role = role ?? undefined;
  });
}

/**
 * Valida el cuerpo con un esquema Zod y devuelve el valor ya tipado.
 *
 * Se infiere del esquema y no de un parámetro suelto para obtener el tipo de
 * *salida*: con `ZodType<T>` los campos con `.default()` seguirían apareciendo
 * como opcionales aunque Zod ya los haya rellenado.
 */
export function parseBody<S extends ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const detail = result.error.issues
    .map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
    .join('; ');
  throw badRequest(detail, 'CUERPO_INVALIDO');
}

export const uuid = z.string().uuid();

/**
 * Manejador de errores final.
 *
 * Un error inesperado se registra completo y se responde sin detalle: el
 * mensaje de una excepción puede contener rutas del servidor o fragmentos de
 * consulta, que no deben salir al cliente.
 */
export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ error: error.message, code: error.code });
    return;
  }

  // `AuthError` del proveedor de identidad tiene la misma forma sin heredar de
  // `HttpError`, para que `auth/identity.ts` no dependa de la capa HTTP.
  if (
    error instanceof Error &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status;
    const code = (error as { code?: string }).code ?? 'ERROR';
    response.status(status).json({ error: error.message, code });
    return;
  }

  console.error('Error no controlado:', error);
  response.status(500).json({ error: 'Error interno del servidor', code: 'ERROR_INTERNO' });
}
