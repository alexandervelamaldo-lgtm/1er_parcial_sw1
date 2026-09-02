import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, alNoAutorizado, api, setToken, type Usuario } from './api';

/**
 * Sesión del usuario.
 *
 * El token se guarda en `localStorage` y no en una cookie `HttpOnly`, que sería
 * lo más seguro frente a XSS. El motivo es concreto: el mismo token hay que
 * ponerlo en la URL del WebSocket, y una cookie `HttpOnly` no es legible desde
 * el código que construye esa URL. La alternativa —un segundo mecanismo de
 * autenticación solo para el socket— sería más superficie que proteger, no
 * menos. La defensa contra XSS queda, pues, en no inyectar nunca HTML sin
 * escapar, que es lo que React hace por omisión.
 */

const CLAVE = 'sesion.token';

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  /** Por qué se ha vuelto a la pantalla de acceso, si no fue a propósito. */
  aviso: string | null;
  acceder: (email: string, password: string) => Promise<void>;
  registrar: (email: string, password: string, nombre: string) => Promise<void>;
  salir: () => void;
}

const Contexto = createContext<Sesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }): JSX.Element {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);

  /*
   * Sesión caducada con la aplicación ya abierta.
   *
   * Se llega aquí cuando el servidor contesta 401 a una petición que llevaba
   * token: el servidor está vivo y nos ha reconocido como desconocidos. Es el
   * único punto del sistema que puede distinguir eso de estar sin cobertura, y
   * la distinción importa mucho —seguir editando sin conexión está previsto y
   * funciona; seguir editando con la sesión caducada es trabajar para nada,
   * porque no hay a dónde enviarlo—.
   *
   * Lo editado no se pierde al echar al usuario: el documento vive en IndexedDB
   * bajo el identificador del proyecto y sigue ahí cuando vuelva a entrar.
   */
  useEffect(() => {
    alNoAutorizado(() => {
      localStorage.removeItem(CLAVE);
      setToken(null);
      setUsuario(null);
      setAviso(
        'Tu sesión ha caducado y el servidor ha dejado de aceptarla. Vuelve a entrar: ' +
          'lo que hayas editado sigue guardado en este navegador y se enviará al reconectar.',
      );
    });
    return () => alNoAutorizado(null);
  }, []);

  // Al arrancar se comprueba si el token guardado sigue valiendo. Sin esta
  // comprobación, una sesión caducada se manifestaría como una lista de
  // proyectos vacía en lugar de como una pantalla de acceso.
  useEffect(() => {
    const guardado = localStorage.getItem(CLAVE);
    if (!guardado) {
      setCargando(false);
      return;
    }

    setToken(guardado);
    api
      .yo()
      .then(({ usuario: u }) => setUsuario(u))
      .catch((error: unknown) => {
        // Un fallo de red no invalida la sesión: puede ser el arranque sin
        // conexión de una PWA instalada, y echar al usuario en ese momento le
        // impediría llegar a lo que tiene guardado en local.
        if (error instanceof ApiError && error.esDeRed) return;
        localStorage.removeItem(CLAVE);
        setToken(null);
      })
      .finally(() => setCargando(false));
  }, []);

  const guardar = useCallback((token: string, u: Usuario) => {
    localStorage.setItem(CLAVE, token);
    setToken(token);
    setUsuario(u);
    setAviso(null);
  }, []);

  const acceder = useCallback(
    async (email: string, password: string) => {
      const r = await api.acceso(email, password);
      guardar(r.token, r.usuario);
    },
    [guardar],
  );

  const registrar = useCallback(
    async (email: string, password: string, nombre: string) => {
      const r = await api.registro(email, password, nombre);
      guardar(r.token, r.usuario);
    },
    [guardar],
  );

  const salir = useCallback(() => {
    localStorage.removeItem(CLAVE);
    setToken(null);
    setUsuario(null);
    setAviso(null);
  }, []);

  const valor = useMemo(
    () => ({ usuario, cargando, aviso, acceder, registrar, salir }),
    [usuario, cargando, aviso, acceder, registrar, salir],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): Sesion {
  const sesion = useContext(Contexto);
  if (!sesion) throw new Error('useSesion se ha usado fuera de ProveedorSesion');
  return sesion;
}
