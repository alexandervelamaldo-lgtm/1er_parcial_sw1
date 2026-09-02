/**
 * Voz: dictado y lectura en voz alta (RF-IA-02).
 *
 * Hay dos implementaciones detrás de esta puerta y la de arriba no es la mejor,
 * es la única que existe en un navegador:
 *
 * 1. **La del navegador.** `SpeechRecognition` para escuchar y `speechSynthesis`
 *    para hablar. No necesita ninguna clave de API. Ojo con la asimetría, que es
 *    la razón de que estas dos cosas no se puedan prometer igual: la síntesis
 *    ocurre en el aparato y funciona sin conexión, mientras que el dictado de
 *    Chrome manda el audio a Google. «Voz sin internet» es cierto para una mitad
 *    y falso para la otra.
 *
 * 2. **El puente nativo.** Existe solo dentro de la app Android, donde hace
 *    falta porque el WebView de Android **no implementa la Web Speech API** —ni
 *    escuchar ni hablar—. No es una versión vieja de Chrome: es otro componente,
 *    y aunque comparte motor de render, deja fuera esta API a propósito. Sin
 *    puente, en el móvil el micrófono está muerto y el botón de escuchar ni
 *    siquiera se dibuja, que es exactamente el fallo del que salió esto: la
 *    función desaparecía sin decir nada y desde fuera era indistinguible de algo
 *    que nadie había programado.
 *
 * La elección es automática y el orden es «nativo primero»: si estamos dentro de
 * la app, lo nativo es lo único que funciona; si estamos en un navegador, el
 * puente no existe y no hay nada que elegir.
 */

/* -------------------------------------------------------------------------- */
/* El puente con Flutter                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lo que `webview_flutter` inyecta al registrar un `JavaScriptChannel`.
 *
 * Un canal es un objeto con un único método `postMessage(String)`. No hay
 * valores de retorno ni promesas: todo lo que venga de vuelta llega por otro
 * lado, llamando a una función global que instalamos nosotros.
 */
interface PuenteNativo {
  postMessage(mensaje: string): void;
}

const NOMBRE_CANAL = 'VozNativa';

/** La función que Flutter llama con `runJavaScript` para contestar. */
const NOMBRE_RECEPTOR = '__vozNativa';

interface VentanaConVoz {
  [NOMBRE_CANAL]?: PuenteNativo;
  [NOMBRE_RECEPTOR]?: (crudo: string) => void;
  SpeechRecognition?: ConstructorReconocedor;
  webkitSpeechRecognition?: ConstructorReconocedor;
}

function ventana(): VentanaConVoz | null {
  return typeof window === 'undefined' ? null : (window as unknown as VentanaConVoz);
}

/**
 * El canal está registrado antes de cargar la página, así que si estamos dentro
 * de la app ya existe en el primer render y no hace falta que la interfaz esté
 * pendiente de que aparezca más tarde. Esa decisión —registrarlo siempre, aunque
 * los plugins de voz fallen luego— es lo que evita un saludo asíncrono entre las
 * dos partes y todos los estados intermedios que trae.
 *
 * A cambio, que el puente exista no garantiza que el micrófono funcione. Eso se
 * sabe al usarlo, y por eso los errores llegan con el motivo que da el sistema
 * en vez de con un «no disponible» genérico.
 */
function puente(): PuenteNativo | null {
  return ventana()?.[NOMBRE_CANAL] ?? null;
}

function enviarAlPuente(p: PuenteNativo, mensaje: Record<string, unknown>): void {
  p.postMessage(JSON.stringify(mensaje));
}

/* -------------------------------------------------------------------------- */
/* La API del navegador                                                        */
/* -------------------------------------------------------------------------- */

interface ResultadoReconocimiento {
  isFinal: boolean;
  0: { transcript: string };
}

interface EventoReconocimiento {
  resultIndex: number;
  results: { length: number; [indice: number]: ResultadoReconocimiento };
}

interface Reconocedor {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((evento: EventoReconocimiento) => void) | null;
  onerror: ((evento: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type ConstructorReconocedor = new () => Reconocedor;

function constructorDisponible(): ConstructorReconocedor | null {
  const w = ventana();
  if (!w) return null;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function sintesisDelNavegador(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/* -------------------------------------------------------------------------- */
/* Qué se puede hacer aquí                                                     */
/* -------------------------------------------------------------------------- */

/** Si se puede dictar: por el puente nativo o por el navegador. */
export function dictadoDisponible(): boolean {
  return puente() !== null || constructorDisponible() !== null;
}

/** Si se puede leer una respuesta en voz alta. */
export function sintesisDisponible(): boolean {
  return puente() !== null || sintesisDelNavegador();
}

/**
 * Por qué no hay voz, dicho de forma que sirva a quien lo lee.
 *
 * El mensaje viejo era «Prueba con Chrome o Edge», y dentro de la app Android
 * ese consejo es imposible de seguir: no hay ninguna forma de cambiar de
 * navegador porque no se está en un navegador. Aquí se separan los dos casos,
 * porque tienen salidas distintas —una es instalar otro navegador y la otra es
 * actualizar la app— y quien lee necesita saber cuál le toca.
 */
export function motivoSinVoz(): string {
  if (puente() !== null) return '';
  if (typeof window !== 'undefined' && /\bwv\b|; wv\)/.test(navigator.userAgent)) {
    return 'Esta versión de la app no trae el puente de voz del sistema.';
  }
  return 'Este navegador no reconoce voz. Prueba con Chrome o Edge.';
}

/* -------------------------------------------------------------------------- */
/* Dictado                                                                     */
/* -------------------------------------------------------------------------- */

export interface SesionDictado {
  detener: () => void;
}

interface OyentesDictado {
  onParcial: (texto: string) => void;
  onFinal: (texto: string) => void;
  onError: (mensaje: string) => void;
  onFin: () => void;
  /**
   * Algo que hay que saber pero que no ha impedido dictar.
   *
   * Va aparte de `onError` porque un aviso no cancela nada, y llegando por la
   * vía del error la interfaz apagaría el micrófono en mitad de una frase para
   * contar algo que no la impedía. El caso que lo justifica es el dictado que
   * sale a internet por no haber idioma descargado en el aparato: cambia lo que
   * se puede prometer, no lo que se puede hacer.
   */
  onAviso?: (mensaje: string) => void;
}

/**
 * La sesión que está escuchando ahora mismo, si la hay.
 *
 * Hace falta porque las respuestas del puente llegan a una función global y no
 * al sitio que pidió escuchar: el canal de `webview_flutter` no devuelve nada,
 * así que la conversación es de ida por un lado y de vuelta por otro. Solo puede
 * haber una: dos micrófonos a la vez no tendrían sentido y la interfaz tampoco
 * los ofrece.
 */
let sesionNativa: OyentesDictado | null = null;
let receptorInstalado = false;

/**
 * Instala la función que Flutter llama para contestar.
 *
 * Se hace al primer uso y no al cargar el módulo: montar una global como efecto
 * de un `import` hace que el orden de los imports pase a importar, y eso es una
 * dependencia invisible que se rompe el día que alguien reordena una línea.
 */
function instalarReceptor(): void {
  const w = ventana();
  if (receptorInstalado || !w) return;
  receptorInstalado = true;

  w[NOMBRE_RECEPTOR] = (crudo: string): void => {
    // Viene de nuestro propio código Dart, pero se valida igual. Un `JSON.parse`
    // sin comprobar la forma es una excepción no capturada dentro de una llamada
    // que nadie envuelve, y el síntoma sería que el dictado deja de responder
    // sin ningún error visible.
    let mensaje: unknown;
    try {
      mensaje = JSON.parse(crudo);
    } catch {
      return;
    }
    if (typeof mensaje !== 'object' || mensaje === null) return;

    const { tipo, texto, motivo } = mensaje as {
      tipo?: unknown;
      texto?: unknown;
      motivo?: unknown;
    };
    const oyentes = sesionNativa;
    if (!oyentes) return;

    if (tipo === 'parcial' && typeof texto === 'string') {
      oyentes.onParcial(texto);
      return;
    }
    if (tipo === 'final' && typeof texto === 'string') {
      oyentes.onFinal(texto.trim());
      return;
    }
    if (tipo === 'aviso') {
      // Se ignora si nadie escucha avisos, y no se degrada a error: un aviso
      // que nadie muestra es información perdida, pero un aviso disfrazado de
      // error es una sesión de dictado cortada por nada.
      if (typeof motivo === 'string') oyentes.onAviso?.(motivo);
      return;
    }
    if (tipo === 'error') {
      oyentes.onError(typeof motivo === 'string' ? motivo : 'No se pudo usar el micrófono.');
      return;
    }
    if (tipo === 'fin') {
      sesionNativa = null;
      oyentes.onFin();
    }
  };
}

/**
 * Escucha hasta que se llama a `detener` o hasta que la otra parte corta.
 *
 * `onParcial` recibe la transcripción provisional para poder mostrarla mientras
 * se habla: sin esa realimentación no hay forma de saber si el micrófono está
 * captando algo, y el usuario repite la frase entera pensando que falló.
 */
export function dictar(opciones: OyentesDictado): SesionDictado | null {
  const nativo = puente();
  if (nativo) {
    instalarReceptor();
    sesionNativa = opciones;
    enviarAlPuente(nativo, { tipo: 'escuchar' });
    return {
      detener: () => enviarAlPuente(nativo, { tipo: 'parar' }),
    };
  }

  const Constructor = constructorDisponible();
  if (!Constructor) {
    opciones.onError(motivoSinVoz());
    return null;
  }

  const reconocedor = new Constructor();
  reconocedor.lang = 'es-ES';
  reconocedor.continuous = false;
  reconocedor.interimResults = true;

  reconocedor.onresult = (evento) => {
    let parcial = '';
    for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
      const resultado = evento.results[i];
      if (!resultado) continue;
      if (resultado.isFinal) {
        opciones.onFinal(resultado[0].transcript.trim());
        return;
      }
      parcial += resultado[0].transcript;
    }
    opciones.onParcial(parcial);
  };

  reconocedor.onerror = (evento) => {
    const mensajes: Record<string, string> = {
      'not-allowed': 'No has dado permiso para usar el micrófono.',
      'no-speech': 'No se ha oído nada.',
      network: 'El reconocimiento de voz necesita conexión.',
    };
    opciones.onError(mensajes[evento.error] ?? `Error de reconocimiento: ${evento.error}`);
  };

  reconocedor.onend = () => opciones.onFin();

  try {
    reconocedor.start();
  } catch {
    opciones.onError('No se pudo iniciar el micrófono.');
    return null;
  }

  return { detener: () => reconocedor.stop() };
}

/* -------------------------------------------------------------------------- */
/* Lectura en voz alta                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Lee un texto en voz alta, por donde se pueda.
 *
 * Se cancela lo anterior antes de empezar: sin eso, tocar «Escuchar» dos veces
 * encola la segunda lectura detrás de la primera y hay que esperar a que termine
 * un párrafo entero para oír el siguiente, que no es lo que nadie espera de un
 * botón que ya está sonando.
 */
export function hablar(texto: string): void {
  const nativo = puente();
  if (nativo) {
    enviarAlPuente(nativo, { tipo: 'hablar', texto });
    return;
  }
  if (!sintesisDelNavegador()) return;
  speechSynthesis.cancel();
  const locucion = new SpeechSynthesisUtterance(texto);
  locucion.lang = 'es-ES';
  speechSynthesis.speak(locucion);
}

/** Corta la lectura en curso. */
export function callar(): void {
  const nativo = puente();
  if (nativo) {
    enviarAlPuente(nativo, { tipo: 'callar' });
    return;
  }
  if (sintesisDelNavegador()) speechSynthesis.cancel();
}
