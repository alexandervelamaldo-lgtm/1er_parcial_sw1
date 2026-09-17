/**
 * Sacar un fichero de la aplicación: el ZIP generado y el XMI exportado.
 *
 * En un navegador esto no necesitaría un módulo: se hace un `Blob`, se le pone
 * una URL, se pincha un `<a download>` invisible y ya está. Ese era el código, y
 * está repetido en `api.ts` y en `EditorDiagrama.tsx`.
 *
 * **Dentro de la app Android ese código no hace absolutamente nada.** Y conviene
 * ser preciso con el porqué, porque hay tres capas y arreglar la equivocada no
 * sirve de nada:
 *
 * 1. Un WebView no descarga por su cuenta. Hay que registrarle un
 *    `DownloadListener`; sin él, pinchar un enlace con `download` es un clic que
 *    no dispara nada. No lanza error, no avisa: no pasa nada.
 * 2. Aunque se registre, lo que recibe es una **URL**, y se la pasa al
 *    `DownloadManager` del sistema. Una `blob:` no es una URL que el
 *    `DownloadManager` sepa resolver —vive dentro del proceso del navegador— así
 *    que el segundo intento falla igual, solo que más tarde.
 * 3. Y aunque fuese una URL de verdad, el ZIP sale de un **POST** a
 *    `/api/proyectos/:id/generacion` con un cuerpo de opciones y una cabecera de
 *    autorización. El `DownloadManager` hace GET anónimos. No hay forma de
 *    pedirle ese fichero por URL.
 *
 * De ahí que la salida sea un puente, igual que con la voz: los bytes ya los
 * tiene la página, así que se los pasa a la parte nativa y es ella quien los
 * escribe y abre el diálogo de compartir del sistema. El XMI además se arma en
 * el navegador sin pasar por el servidor, así que sigue funcionando sin
 * conexión; una solución que dejase el fichero en el servidor para bajarlo luego
 * por URL rompería justo eso.
 *
 * La otra mitad está en `mobile/lib/descarga_nativa.dart`. Los dos nombres de
 * abajo son el contrato entre las mitades: si se cambia uno hay que cambiar el
 * otro, y no hay compilador que lo compruebe.
 */

/* -------------------------------------------------------------------------- */
/* El contrato con Flutter                                                     */
/* -------------------------------------------------------------------------- */

/** Canal que la página usa para mandar los bytes (web → Flutter). */
const NOMBRE_CANAL = 'DescargaNativa';

/** Función global que Flutter llama para contestar (Flutter → web). */
const NOMBRE_RECEPTOR = '__descargaNativa';

/**
 * Lo que `webview_flutter` inyecta al registrar un `JavaScriptChannel`: un
 * objeto con un único método que acepta una cadena. No devuelve nada, así que
 * la respuesta llega por el otro lado.
 */
interface PuenteNativo {
  postMessage(mensaje: string): void;
}

interface VentanaConDescarga {
  [NOMBRE_CANAL]?: PuenteNativo;
  [NOMBRE_RECEPTOR]?: (crudo: string) => void;
}

function ventana(): VentanaConDescarga | null {
  return typeof window === 'undefined' ? null : (window as unknown as VentanaConDescarga);
}

/* -------------------------------------------------------------------------- */
/* Lógica pura: nombres, base64 y troceado                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cuánto base64 cabe en un mensaje del canal.
 *
 * El canal de `webview_flutter` no es una llamada de función: la cadena cruza
 * de un proceso a otro por una transacción Binder de Android, y ahí hay un techo
 * de aproximadamente 1 MB **compartido por todas las transacciones en vuelo**.
 * Un ZIP de cuatro megas se convierte en cinco y pico de base64 y no pasa por
 * ese agujero. El modo de fallo es el peor posible: la transacción se cae y el
 * mensaje sencillamente no llega, sin excepción en Dart ni error en JavaScript,
 * así que desde fuera la descarga «se queda pensando» para siempre.
 *
 * 256 KiB deja margen de sobra por debajo del techo aun con otra cosa en vuelo.
 * Es múltiplo de 4, de modo que cada trozo es base64 completo por sí mismo: no
 * hace falta, porque el receptor concatena antes de decodificar, pero significa
 * que un trozo suelto se puede inspeccionar en un log sin que parezca corrupto.
 */
export const TAMANO_TROZO = 256 * 1024;

/**
 * Tope de lo que se acepta mandar por el puente, en bytes.
 *
 * No es una limitación técnica sino un fusible: los bytes se acumulan enteros en
 * memoria en los dos lados —aquí como base64, que ocupa un tercio más, y allí
 * como lista de trozos antes de unirlos—, y un teléfono con poca RAM muere sin
 * decir por qué. 64 MiB son varias veces el mayor ZIP que este generador ha
 * producido nunca; pasarse de ahí es señal de que algo va mal, no de que haga
 * falta más sitio.
 */
export const LIMITE_BYTES = 64 * 1024 * 1024;

/**
 * Caracteres que no pueden acabar en un nombre de fichero.
 *
 * Dos familias, por dos motivos distintos. Los de control —de `U+0000` a
 * `U+001F`, más el `U+007F`— porque un nombre con un salto de línea o un NUL
 * dentro rompe cualquier ruta y en algunos sistemas es directamente inválido. Y
 * los que en algún sistema de ficheros significan otra cosa: la barra y la
 * contrabarra son separadores de directorio, los dos puntos abren un flujo
 * alternativo en NTFS, y los comodines y las comillas los interpreta la consola.
 *
 * El guion y el subrayado **no** están: son caracteres perfectamente normales en
 * el nombre de un proyecto y quitarlos convertiría «Punto-de-venta» en
 * «Puntodeventa», que es peor que lo que se estaba arreglando.
 */
const PROHIBIDOS = new RegExp('[\\u0000-\\u001f\\u007f/\\\\:*?"<>|]', 'g');

/**
 * El nombre del fichero, limpio y con su extensión.
 *
 * Aquí se **limpia** y no se rechaza, al contrario que con los nombres que
 * acaban siendo identificadores Java (RNF-SEG-06). La diferencia es a qué se
 * parece el fallo: un identificador mal formado rompe la compilación del
 * proyecto generado y hay que enterarse, mientras que esto es el nombre de un
 * fichero que va a ver una persona. Negarse a exportar «Tienda de Álex» porque
 * lleva una tilde sería una tontería, y la tilde además sobrevive: lo que se
 * quita es lo que rompe rutas, no lo que no es ASCII.
 */
export function nombreDeFichero(base: string, extension: string): string {
  const limpio = base
    .replace(PROHIBIDOS, '')
    .replace(/\s+/g, ' ')
    // Un nombre que empieza por punto se esconde en cualquier sistema unix, y
    // uno que acaba en punto o en espacio lo rechaza Windows al copiarlo.
    .replace(/^\.+/, '')
    .trim();
  const sufijo = extension.startsWith('.') ? extension : `.${extension}`;
  // Recortado por si alguien llama al proyecto con un párrafo: 120 caracteres
  // más la extensión caben en los 255 bytes que aceptan ext4 y FAT, incluso
  // contando que un carácter acentuado ocupa dos en UTF-8.
  const recortado = limpio.slice(0, 120).replace(/[.\s]+$/, '').trim();
  return (recortado || 'diagrama') + sufijo;
}

/**
 * Bytes a base64, por bloques.
 *
 * `btoa` quiere una cadena de caracteres de un byte, y construirla con
 * `String.fromCharCode(...bytes)` de una vez revienta la pila en cuanto el
 * fichero pasa del centenar de kilobytes: son tantos argumentos como bytes. Se
 * hace por bloques, y el bloque es múltiplo de 3 a propósito —tres bytes son
 * exactamente cuatro caracteres de base64— para que los trozos se puedan
 * concatenar sin que aparezca relleno `=` en mitad de la cadena.
 */
export function aBase64(bytes: Uint8Array): string {
  const BLOQUE = 32760; // 10920 × 3
  let salida = '';
  for (let i = 0; i < bytes.length; i += BLOQUE) {
    const parte = bytes.subarray(i, i + BLOQUE);
    let binario = '';
    for (const byte of parte) binario += String.fromCharCode(byte);
    salida += btoa(binario);
  }
  return salida;
}

/** Parte una cadena en trozos de como mucho `tamano`. Nunca devuelve vacío. */
export function trocear(texto: string, tamano: number = TAMANO_TROZO): string[] {
  if (tamano <= 0) throw new Error('El tamaño de trozo tiene que ser positivo');
  const trozos: string[] = [];
  for (let i = 0; i < texto.length; i += tamano) trozos.push(texto.slice(i, i + tamano));
  // Un fichero vacío sigue siendo un fichero, y sin esto no se mandaría ningún
  // mensaje: el puente se quedaría esperando trozos que no llegan nunca.
  return trozos.length > 0 ? trozos : [''];
}

/** Los mensajes que hay que mandar por el canal para entregar un fichero. */
export type MensajeDescarga =
  | { tipo: 'inicio'; id: string; nombre: string; mime: string; trozos: number }
  | { tipo: 'trozo'; id: string; indice: number; datos: string };

/**
 * La conversación completa, como datos.
 *
 * Se devuelve una lista en vez de mandarla desde aquí para que esto siga siendo
 * una función pura: el troceado y la numeración —donde está el fallo de verdad,
 * el trozo que se pierde o el que se cuenta dos veces— se prueban sin WebView,
 * sin `window` y sin teléfono.
 *
 * No hay mensaje de «fin». El `inicio` ya dice cuántos trozos vienen, y el otro
 * lado termina cuando los tiene todos; un cierre explícito sería un tercer
 * estado que puede perderse y dejar el fichero a medio escribir sin que nadie
 * lo sepa.
 */
export function mensajesDeDescarga(
  id: string,
  nombre: string,
  mime: string,
  base64: string,
  tamano: number = TAMANO_TROZO,
): MensajeDescarga[] {
  const trozos = trocear(base64, tamano);
  return [
    { tipo: 'inicio', id, nombre, mime, trozos: trozos.length },
    ...trozos.map((datos, indice): MensajeDescarga => ({ tipo: 'trozo', id, indice, datos })),
  ];
}

/* -------------------------------------------------------------------------- */
/* El puente                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Si estamos dentro de la app y hay quien escriba el fichero.
 *
 * El canal se registra antes de cargar la página, así que si existe, existe ya
 * en el primer render: no hace falta que la interfaz espere a que aparezca. Es
 * la misma decisión que en `voz.ts` y por el mismo motivo —evitar un saludo
 * asíncrono entre las dos mitades y todos los estados intermedios que trae—.
 */
export function descargaNativaDisponible(): boolean {
  return (ventana()?.[NOMBRE_CANAL] ?? null) !== null;
}

/** Lo que espera una descarga que ya se mandó y todavía no ha contestado. */
interface EnEspera {
  resolver: (donde: string) => void;
  rechazar: (error: Error) => void;
}

const enEspera = new Map<string, EnEspera>();
let receptorInstalado = false;
let contador = 0;

/**
 * Instala la función que Flutter llama para contestar.
 *
 * Al primer uso y no al importar el módulo: montar una global como efecto de un
 * `import` hace que el orden de los imports pase a importar, y eso es una
 * dependencia invisible que se rompe el día que alguien reordena una línea.
 */
function instalarReceptor(): void {
  const w = ventana();
  if (receptorInstalado || !w) return;
  receptorInstalado = true;

  w[NOMBRE_RECEPTOR] = (crudo: string): void => {
    // Viene de nuestro propio código Dart, pero se valida igual: un `JSON.parse`
    // que lanza dentro de una llamada que nadie envuelve es una excepción sin
    // dueño, y el síntoma sería que las descargas dejan de contestar sin que
    // aparezca ningún error.
    let mensaje: unknown;
    try {
      mensaje = JSON.parse(crudo);
    } catch {
      return;
    }
    if (typeof mensaje !== 'object' || mensaje === null) return;

    const { tipo, id, donde, motivo } = mensaje as {
      tipo?: unknown;
      id?: unknown;
      donde?: unknown;
      motivo?: unknown;
    };
    if (typeof id !== 'string') return;
    const espera = enEspera.get(id);
    if (!espera) return;
    enEspera.delete(id);

    if (tipo === 'listo') {
      espera.resolver(typeof donde === 'string' ? donde : '');
    } else {
      espera.rechazar(
        new Error(typeof motivo === 'string' ? motivo : 'No se pudo guardar el fichero'),
      );
    }
  };
}

/**
 * Cuánto se espera a que el sistema conteste, en milisegundos.
 *
 * Hay diálogo de compartir de por medio, y una persona puede tardar en elegir
 * dónde guardar. El tope no está para apurar sino para que una respuesta que se
 * perdió —la app pasada a segundo plano y matada por el sistema, por ejemplo—
 * no deje el botón girando hasta que alguien recargue la página.
 */
const ESPERA_MAXIMA = 120_000;

function porElPuente(
  p: PuenteNativo,
  nombre: string,
  mime: string,
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.length > LIMITE_BYTES) {
    return Promise.reject(
      new Error(
        `El fichero ocupa ${Math.round(bytes.length / 1024 / 1024)} MB y el máximo ` +
          `que se puede pasar a la app son ${LIMITE_BYTES / 1024 / 1024} MB. ` +
          'Descárgalo desde un navegador de escritorio.',
      ),
    );
  }

  instalarReceptor();
  const id = `d${++contador}`;

  return new Promise<string>((resolver, rechazar) => {
    const reloj = setTimeout(() => {
      enEspera.delete(id);
      rechazar(new Error('La app no ha contestado al guardar el fichero.'));
    }, ESPERA_MAXIMA);

    enEspera.set(id, {
      resolver: (donde) => {
        clearTimeout(reloj);
        resolver(donde);
      },
      rechazar: (error) => {
        clearTimeout(reloj);
        rechazar(error);
      },
    });

    try {
      for (const mensaje of mensajesDeDescarga(id, nombre, mime, aBase64(bytes))) {
        p.postMessage(JSON.stringify(mensaje));
      }
    } catch (error) {
      clearTimeout(reloj);
      enEspera.delete(id);
      rechazar(error instanceof Error ? error : new Error('No se pudo enviar el fichero'));
    }
  });
}

function porElNavegador(nombre: string, mime: string, bytes: Uint8Array): string {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  // Sin revocar, el fichero entero se queda en memoria hasta recargar la página.
  URL.revokeObjectURL(url);
  return '';
}

/**
 * Saca un fichero de la aplicación, esté donde esté ejecutándose.
 *
 * Devuelve dónde ha ido a parar, o la cadena vacía cuando eso no se sabe —que es
 * el caso del navegador: quien decide la carpeta es él y no nos lo cuenta—. Esa
 * cadena es para enseñarla, no para abrirla.
 *
 * Lanza si no se pudo. Y lanzar es la parte importante: el código viejo no tenía
 * forma de fallar porque pinchar un enlace no devuelve nada, así que en el móvil
 * el mensaje que se enseñaba era «Diagrama exportado a XMI» mientras no se había
 * exportado nada.
 *
 * @param contenido texto o bytes ya listos. El texto se codifica en UTF-8, que
 * es lo que declaran tanto el XMI que emitimos como la cabecera del ZIP.
 */
export async function descargar(
  nombre: string,
  mime: string,
  contenido: Uint8Array | string,
): Promise<string> {
  const bytes = typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido;
  const p = ventana()?.[NOMBRE_CANAL] ?? null;
  if (p) return porElPuente(p, nombre, mime, bytes);
  return porElNavegador(nombre, mime, bytes);
}

/**
 * Cómo contarle a alguien que su fichero ya está fuera.
 *
 * Está aquí y no en cada llamante porque la frase cambia según el camino que se
 * haya tomado, y esa es justo la clase de detalle que se copia mal: en el
 * navegador el fichero está en la carpeta de descargas y no hay nada que decir,
 * mientras que en el móvil ha pasado por el diálogo del sistema y conviene decir
 * dónde quedó la copia, porque compartir por WhatsApp no deja rastro en el
 * teléfono y buscarla luego es imposible si no se sabe el nombre.
 */
export function avisoDeDescarga(nombre: string, donde: string): string {
  return donde ? `${nombre} guardado en ${donde}` : `${nombre} descargado.`;
}
