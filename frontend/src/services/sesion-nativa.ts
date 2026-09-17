/**
 * De dónde sale el token cuando la página corre dentro de la app.
 *
 * ## Qué cambia respecto al navegador
 *
 * En un navegador la sesión se guarda en `localStorage`, con el motivo escrito
 * en `sesion.tsx`: el token hace falta también para construir la URL del
 * WebSocket, y una cookie `HttpOnly` no es legible desde ahí. Esa decisión es
 * correcta en un navegador y no se toca.
 *
 * Dentro del WebView de Android, sin embargo, `localStorage` es un fichero
 * dentro del directorio de datos de la aplicación. Un token con semanas de
 * vigencia guardado ahí viaja en cualquier copia de seguridad del sistema y se
 * lee entero en un teléfono con root. El teléfono tiene un sitio mejor —el
 * Keystore— y la carcasa nativa sabe usarlo, así que dentro de la app **el
 * dueño del token es Flutter** y la página lo recibe prestado para la vida de
 * la pestaña.
 *
 * De ahí la regla que gobierna este fichero, y que es lo único que hay que
 * recordar al leerlo: **si hay puente, la página no escribe el token en ningún
 * sitio.** Ni al entrar, ni al recibirlo, ni al renovarlo.
 *
 * ## La otra mitad
 *
 * `mobile/lib/sesion_nativa.dart`. Los dos nombres de abajo son el contrato
 * entre las mitades y no hay compilador que lo compruebe, así que están
 * afirmados en las pruebas de los dos lados.
 *
 * Este fichero no toca el DOM ni el estado de React: solo decide y traduce,
 * para poder probarlo sin navegador. El cableado está en `sesion.tsx`.
 */

/** Canal por el que la página pregunta y avisa (web → Flutter). */
export const CANAL_SESION = 'SesionNativa';

/** Función global que Flutter llama para contestar (Flutter → web). */
export const RECEPTOR_SESION = '__sesionNativa';

interface PuenteNativo {
  postMessage(mensaje: string): void;
}

interface VentanaConSesion {
  [CANAL_SESION]?: PuenteNativo;
  [RECEPTOR_SESION]?: (crudo: string) => void;
}

/**
 * La ventana, si la hay, vista como algo que puede tener el puente.
 *
 * Devuelve `null` durante el renderizado en servidor y en las pruebas, que es
 * lo que permite que el resto del módulo no tenga que preguntarse si existe
 * `window`.
 */
export function ventanaConSesion(): VentanaConSesion | null {
  return typeof window === 'undefined' ? null : (window as unknown as VentanaConSesion);
}

/**
 * ¿Manda la carcasa nativa sobre la sesión?
 *
 * Se comprueba por la presencia del canal y no por el `userAgent`. El
 * `userAgent` de un WebView se puede parecer al de Chrome tanto como se quiera
 * —y de hecho se parece—, mientras que el canal existe exactamente cuando hay
 * alguien nativo escuchando al otro lado. Preguntar por lo que se va a usar, y
 * no por quién se dice ser, es la diferencia entre esto y una heurística.
 */
export function haySesionNativa(): boolean {
  return Boolean(ventanaConSesion()?.[CANAL_SESION]);
}

/** El usuario tal y como lo manda el lado nativo. */
export interface UsuarioNativo {
  id: string;
  email: string;
  nombre: string;
}

/** Lo que llega por el receptor cuando se pide la sesión. */
export interface SesionNativa {
  /** El token, o `null` si la carcasa no tiene ninguna sesión guardada. */
  token: string | null;
  usuario: UsuarioNativo | null;
}

/**
 * Lee el mensaje que manda Flutter, o devuelve `null` si no es de los nuestros.
 *
 * No lanza en ningún caso, y la razón es la misma que en `respaldo.ts`: quien
 * llama a esto está dentro de la función global que invoca Flutter por
 * `runJavaScript`, y una excepción ahí no la recoge nadie —sube hasta el puente
 * y se pierde—. El síntoma de dejarla escapar sería una aplicación parada para
 * siempre en «comprobando la sesión», sin nada en la consola.
 *
 * Se distingue el mensaje mal formado (`null`) de la respuesta legítima sin
 * sesión (`token: null`), y la distinción no es cosmética: la segunda significa
 * «hay que entrar» y la primera no significa nada, así que tratarlas igual
 * mandaría a la pantalla de acceso por un mensaje que ni siquiera era para
 * nosotros.
 */
export function leerMensajeDeSesion(crudo: string): SesionNativa | null {
  let mensaje: unknown;
  try {
    mensaje = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (typeof mensaje !== 'object' || mensaje === null) return null;
  const cuerpo = mensaje as Record<string, unknown>;
  if (cuerpo['tipo'] !== 'sesion') return null;

  const token = cuerpo['token'];
  if (token === null || token === undefined || token === '') {
    return { token: null, usuario: null };
  }
  if (typeof token !== 'string') return null;

  return { token, usuario: leerUsuario(cuerpo['usuario']) };
}

/**
 * El perfil que acompaña al token, con lo que falte puesto en blanco.
 *
 * Un token sin perfil legible sigue siendo un token bueno: la página puede
 * pedir `GET /api/auth/yo` y enterarse. Así que un perfil incompleto no invalida
 * la sesión, solo deja campos vacíos que se rellenarán al hablar con el
 * servidor. Rechazar la sesión entera por un nombre ausente sería pedir la
 * contraseña por no saber cómo llamar a quien ya está dentro.
 */
function leerUsuario(valor: unknown): UsuarioNativo | null {
  if (typeof valor !== 'object' || valor === null) return null;
  const u = valor as Record<string, unknown>;
  const id = u['id'];
  if (typeof id !== 'string' || id === '') return null;
  return {
    id,
    email: typeof u['email'] === 'string' ? u['email'] : '',
    nombre: typeof u['nombre'] === 'string' ? u['nombre'] : '',
  };
}

/* -------------------------------------------------------------------------- */
/* Lo que se le dice al lado nativo                                            */
/* -------------------------------------------------------------------------- */

export type AvisoNativo = 'pedir' | 'caducada' | 'salir';

/**
 * Manda un aviso por el canal. No hace nada fuera de la app.
 *
 * Que no haga nada es lo correcto y no una omisión: en un navegador de
 * escritorio la sesión la lleva `localStorage` y no hay nadie a quien avisar.
 */
export function avisarAlNativo(aviso: AvisoNativo): void {
  ventanaConSesion()?.[CANAL_SESION]?.postMessage(JSON.stringify({ tipo: aviso }));
}

/**
 * Cuánto se espera la respuesta del lado nativo antes de seguir sin ella.
 *
 * Hace falta un tope porque el canal no garantiza respuesta. `postMessage`
 * entrega y devuelve; si el lado de Flutter se cae, o el mensaje de vuelta pasa
 * del tope del Binder, o sencillamente el APK es más viejo que esta página y no
 * conoce el tipo «pedir», aquí no llega nada y **tampoco llega ningún error**.
 * Sin tope, el síntoma sería la aplicación detenida para siempre en la pantalla
 * de carga, que es el peor fallo posible: no se puede ni entrar ni leer lo que
 * ya estaba guardado en el teléfono.
 *
 * Cuatro segundos porque lo que hay al otro lado es una lectura del almacén
 * cifrado ya hecha —la carcasa tiene el token en memoria antes de abrir el
 * WebView— y eso son milisegundos. El margen es para el arranque en frío de un
 * teléfono lento, no para una operación lenta.
 */
export const ESPERA_SESION_NATIVA_MS = 4000;

/* -------------------------------------------------------------------------- */
/* La decisión que ordena el arranque                                          */
/* -------------------------------------------------------------------------- */

/** Lo que se sabe al arrancar, antes de enseñar nada. */
export interface SituacionArranque {
  /** ¿Existe el canal? */
  hayPuente: boolean;
  /** Lo que hubiera en `localStorage`, si es que se llegó a mirar. */
  tokenGuardado: string | null;
}

export type OrigenDelToken = 'nativo' | 'navegador' | 'ninguno';

/**
 * De dónde hay que sacar el token en este arranque.
 *
 * Hay una regla y tiene una consecuencia que conviene ver escrita: **con puente,
 * lo que hubiera en `localStorage` se ignora**, aunque haya algo.
 *
 * Podría parecer una reserva útil —«si el nativo no contesta, al menos
 * tenemos esto»— y es justo lo contrario. Ese resto solo puede venir de una
 * versión anterior del APK, la que guardaba el token en el WebView; darle uso
 * sería resucitar precisamente el almacenamiento del que se está huyendo, y
 * hacerlo en silencio, de modo que nadie notaría que la sesión volvió a estar
 * en claro en el disco. Por eso `sesion.tsx` no solo lo ignora: lo borra.
 */
export function origenDelToken({ hayPuente, tokenGuardado }: SituacionArranque): OrigenDelToken {
  if (hayPuente) return 'nativo';
  return tokenGuardado ? 'navegador' : 'ninguno';
}
