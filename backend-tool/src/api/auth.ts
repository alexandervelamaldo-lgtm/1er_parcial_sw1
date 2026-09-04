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

const RecuperarSchema = z.object({
  email: z.string().min(3),
  // El límite alto no valida nada, corta: sin él, `hashPassword` —que es scrypt,
  // caro a propósito— se ejecutaría sobre lo que quisiera mandar quien llama, y
  // eso es un modo cómodo de tumbar el servidor desde fuera.
  codigo: z.string().max(200),
  password: z.string().max(400),
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

      // El código se entrega aquí y en ningún otro sitio más: es la única vez
      // que existe en claro. Va en la respuesta del registro, y no en una
      // pantalla aparte a la que haya que navegar, porque una pantalla aparte
      // es una pantalla que se puede cerrar antes de leerla.
      const codigoRecuperacion = await identity.emitirCodigoRecuperacion(user.id);

      response.status(201).json({
        usuario: user,
        token: session.token,
        expira: session.expiresAt,
        codigoRecuperacion,
      });
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

  router.post(
    '/recuperar',
    handler(async (request, response) => {
      const body = parseBody(RecuperarSchema, request.body);
      const session = await identity.restablecerConCodigo(body.email, body.codigo, body.password);

      // Un solo mensaje para «ese correo no está», «no hay código pendiente» y
      // «el código no es ese». Distinguirlos convertiría esta ruta en un
      // buscador de cuentas registradas, que es justo lo que `/acceso` evita.
      if (!session) throw unauthorized('El correo o el código de recuperación no son correctos');
      response.json({ usuario: session.user, token: session.token, expira: session.expiresAt });
    }),
  );

  router.post(
    '/codigo-recuperacion',
    requireAuth(identity),
    handler(async (request, response) => {
      // Hace falta la sesión, y con eso basta: quien está dentro ya demostró
      // saber la contraseña. Pedirla otra vez aquí protegería contra el
      // ordenador desatendido, pero ese ataque ya tiene abierto el proyecto
      // entero, que es lo que de verdad se querría robar.
      //
      // Emitir uno nuevo invalida el anterior. Es lo que se quiere: si alguien
      // duda de dónde acabó su código, generar otro lo deja sin valor.
      const codigo = await identity.emitirCodigoRecuperacion(request.user.id);
      response.json({ codigoRecuperacion: codigo });
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
