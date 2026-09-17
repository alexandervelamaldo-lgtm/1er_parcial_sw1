import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError, alNoAutorizado, api, setToken, type Usuario } from './api';
import {
  ESPERA_SESION_NATIVA_MS,
  RECEPTOR_SESION,
  avisarAlNativo,
  haySesionNativa,
  leerMensajeDeSesion,
  origenDelToken,
  ventanaConSesion,
} from './sesion-nativa';

/**
 * Sesión del usuario.
 *
 * En el navegador el token se guarda en `localStorage` y no en una cookie
 * `HttpOnly`, que sería lo más seguro frente a XSS. El motivo es concreto: el
 * mismo token hay que ponerlo en la URL del WebSocket, y una cookie `HttpOnly`
 * no es legible desde el código que construye esa URL. La alternativa —un
 * segundo mecanismo de autenticación solo para el socket— sería más superficie
 * que proteger, no menos. La defensa contra XSS queda, pues, en no inyectar
 * nunca HTML sin escapar, que es lo que React hace por omisión.
 *
 * **Dentro de la app de Android eso no vale**, y no porque el razonamiento
 * cambie sino porque cambia dónde acaba el `localStorage`: en un fichero del
 * directorio de datos de la aplicación, que viaja en las copias de seguridad
 * del sistema y se lee entero con root. Allí el token lo custodia la carcasa
 * nativa en el Keystore y esta página lo recibe prestado en memoria, sin
 * escribirlo. La decisión y sus motivos están en `sesion-nativa.ts`; aquí solo
 * se obedece, y la regla es que **con puente no se toca `localStorage`**.
 */

const CLAVE = 'sesion.token';

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  /** Por qué se ha vuelto a la pantalla de acceso, si no fue a propósito. */
  aviso: string | null;
  acceder: (email: string, password: string) => Promise<void>;
  registrar: (email: string, password: string, nombre: string) => Promise<RegistroPendiente>;
  /** Contraseña nueva con el código de recuperación; deja la sesión ya iniciada. */
  recuperar: (email: string, codigo: string, password: string) => Promise<void>;
  salir: () => void;
}

/**
 * Registro hecho, sesión todavía sin activar.
 *
 * Existe por un detalle de orden: en cuanto la sesión se activa, la aplicación
 * cambia la pantalla de acceso por la lista de proyectos. Si el registro
 * iniciara sesión de inmediato, el código de recuperación se iría con la
 * pantalla, y ese código no se puede volver a pedir —el servidor solo guarda su
 * hash—. Así que se devuelve junto con la llave para entrar, y entra quien haya
 * dicho que ya lo tiene guardado.
 */
export interface RegistroPendiente {
  codigoRecuperacion: string;
  entrar: () => void;
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
      /*
        Dentro de la app, además, hay que decírselo a la carcasa. Es el único
        aviso que puede darle: el 401 lo ve esta página y nadie más. Sin él, el
        Keystore seguiría custodiando con todo cuidado una llave que ya no abre
        nada, y el arranque siguiente entraría «directo» —sin pedir contraseña,
        porque la sesión parece estar— a una pantalla que falla en la primera
        petición y no sabe explicar por qué.
      */
      avisarAlNativo('caducada');
      setAviso(
        'Tu sesión ha caducado y el servidor ha dejado de aceptarla. Vuelve a entrar: ' +
          'lo que hayas editado sigue guardado en este navegador y se enviará al reconectar.',
      );
    });
    return () => alNoAutorizado(null);
  }, []);

  /*
    Al arrancar hay que averiguar con qué sesión se entra, y de dónde sale
    depende de dónde corra esto. La decisión está en `origenDelToken`, que es
    puro y tiene sus pruebas; aquí queda el trabajo que necesita un navegador.

    Sin esta comprobación, una sesión caducada se manifestaría como una lista de
    proyectos vacía en lugar de como una pantalla de acceso.
  */
  useEffect(() => {
    /** Da por buena una sesión y la contrasta con el servidor. */
    const estrenar = (token: string, perfil: Usuario | null): void => {
      setToken(token);
      /*
        El perfil que ya venía se usa sin esperar al servidor, y no es un
        adorno: es lo que permite entrar sin cobertura. `api.yo()` va a fallar
        con un error de red, la rama de abajo lo deja pasar a propósito, y sin
        este `setUsuario` la aplicación se quedaría sin usuario y por tanto en
        la pantalla de acceso, justo cuando lo que hace falta es llegar a lo
        que está guardado en local.
      */
      if (perfil) setUsuario(perfil);
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
          setUsuario(null);
        })
        .finally(() => setCargando(false));
    };

    const origen = origenDelToken({
      hayPuente: haySesionNativa(),
      tokenGuardado: localStorage.getItem(CLAVE),
    });

    if (origen === 'ninguno') {
      setCargando(false);
      return;
    }

    if (origen === 'navegador') {
      estrenar(localStorage.getItem(CLAVE) ?? '', null);
      return;
    }

    /*
      Queda el caso de la app. Lo primero es borrar lo que hubiera en
      `localStorage`, y conviene decir por qué no se aprovecha: lo único que
      puede haber ahí es el resto de una versión anterior del APK, la que
      guardaba el token dentro del WebView. Usarlo como reserva sería resucitar
      en silencio el almacenamiento del que se está huyendo. Borrarlo, además,
      es lo que hace que actualizar la app limpie de verdad lo que dejó la
      anterior, en lugar de dejarlo ahí para siempre.
    */
    localStorage.removeItem(CLAVE);

    const w = ventanaConSesion();
    if (!w) {
      setCargando(false);
      return;
    }

    /*
      Una sola respuesta, venga de donde venga. El temporizador y el receptor
      compiten, y sin esta guarda el que llegue segundo pisaría el trabajo del
      primero: el caso feo es la respuesta que llega tarde, después de haberse
      rendido, y que instalaría una sesión cuando la pantalla de acceso ya está
      delante del usuario.
    */
    let contestado = false;
    const rendirse = setTimeout(() => {
      if (contestado) return;
      contestado = true;
      // No hay a quién enseñarle esto y tampoco lo arreglaría: queda en la
      // consola del WebView, que es donde se mira cuando la app pide la
      // contraseña dos veces.
      console.warn('La carcasa nativa no contestó a la petición de sesión.');
      setCargando(false);
    }, ESPERA_SESION_NATIVA_MS);

    w[RECEPTOR_SESION] = (crudo: string): void => {
      const leido = leerMensajeDeSesion(crudo);
      if (leido === null || contestado) return;
      contestado = true;
      clearTimeout(rendirse);

      if (leido.token === null) {
        setCargando(false);
        return;
      }
      estrenar(
        leido.token,
        leido.usuario
          ? {
              id: leido.usuario.id,
              email: leido.usuario.email,
              displayName: leido.usuario.nombre,
            }
          : null,
      );
    };

    avisarAlNativo('pedir');

    return () => {
      clearTimeout(rendirse);
      delete w[RECEPTOR_SESION];
    };
  }, []);

  const guardar = useCallback((token: string, u: Usuario) => {
    /*
      Dentro de la app no se escribe, y es la regla entera de `sesion-nativa.ts`
      aplicada al único sitio donde podría romperse. Se llega aquí cuando
      alguien entra o se registra desde el formulario **de la página** estando
      dentro del WebView, que es un camino que la carcasa normalmente evita
      —pide la contraseña ella, antes de abrirlo— pero que sigue existiendo si
      la carcasa no tenía sesión que dar.

      La sesión así obtenida vale para esta pestaña y no sobrevive a cerrarla:
      la carcasa no se ha enterado y no la ha guardado en el Keystore. Es una
      degradación aceptable y se prefiere a la alternativa, que sería dejar el
      token en claro en el disco del WebView justo en la app que existe para
      que eso no pase.
    */
    if (!haySesionNativa()) localStorage.setItem(CLAVE, token);
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
      return {
        codigoRecuperacion: r.codigoRecuperacion,
        entrar: () => guardar(r.token, r.usuario),
      };
    },
    [guardar],
  );

  const recuperar = useCallback(
    async (email: string, codigo: string, password: string) => {
      const r = await api.recuperar(email, codigo, password);
      guardar(r.token, r.usuario);
    },
    [guardar],
  );

  const salir = useCallback(() => {
    localStorage.removeItem(CLAVE);
    setToken(null);
    setUsuario(null);
    setAviso(null);
    // Y que la carcasa lo olvide también. Salir y que el teléfono siga
    // guardando la llave sería lo contrario de lo que se acaba de pedir: la
    // app volvería a entrar sola en el arranque siguiente.
    avisarAlNativo('salir');
  }, []);

  const valor = useMemo(
    () => ({ usuario, cargando, aviso, acceder, registrar, recuperar, salir }),
    [usuario, cargando, aviso, acceder, registrar, recuperar, salir],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): Sesion {
  const sesion = useContext(Contexto);
  if (!sesion) throw new Error('useSesion se ha usado fuera de ProveedorSesion');
  return sesion;
}
