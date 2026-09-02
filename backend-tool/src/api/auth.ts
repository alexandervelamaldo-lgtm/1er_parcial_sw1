import { Router } from 'express';
import { z } from 'zod';
import type { IdentityProvider } from '../auth/identity.js';
import { handler, parseBody, requireAuth, unauthorized } from './http.js';

/**
 * Rutas de autenticación (RF-COL-01).
 *
 * Devuelven el token en el cuerpo en lugar de una cookie porque el cliente lo
 * necesita también para abrir el WebSocket, y una cookie `HttpOnly` no es
 * legible desde el código que construye esa URL.
 */

const RegistroSchema = z.object({
  email: z.string().min(3),
  password: z.string(),
  nombre: z.string().default(''),
});

const AccesoSchema = z.object({
  email: z.string().min(3),
  password: z.string(),
});

export function authRouter(identity: IdentityProvider): Router {
  const router = Router();

  router.post(
    '/registro',
    handler(async (request, response) => {
      const body = parseBody(RegistroSchema, request.body);
      const user = await identity.register(body.email, body.password, body.nombre);
      const session = await identity.authenticate(body.email, body.password);
      if (!session) throw unauthorized('No se pudo iniciar sesión tras el registro');
      response.status(201).json({ usuario: user, token: session.token, expira: session.expiresAt });
    }),
  );

  router.post(
    '/acceso',
    handler(async (request, response) => {
      const body = parseBody(AccesoSchema, request.body);
      const session = await identity.authenticate(body.email, body.password);
      // Un solo mensaje para correo inexistente y contraseña incorrecta: la
      // diferencia permitiría enumerar qué cuentas existen.
      if (!session) throw unauthorized('Credenciales incorrectas');
      response.json({ usuario: session.user, token: session.token, expira: session.expiresAt });
    }),
  );

  router.get(
    '/yo',
    requireAuth(identity),
    handler((request, response) => {
      response.json({ usuario: request.user });
    }),
  );

  return router;
}
