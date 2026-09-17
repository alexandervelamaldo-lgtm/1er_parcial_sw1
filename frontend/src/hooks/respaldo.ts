import type { EstadoConexion } from '@app/shared';

/**
 * Cuándo hay que sacar el documento del IndexedDB del WebView y dejarlo a salvo
 * en el disco de la app.
 *
 * ## Qué se averiguó, antes de decidir nada
 *
 * La pregunta era si Android borra el IndexedDB de un WebView. La respuesta
 * corta es **no por su cuenta**, y la larga es que aun así se pierde, por tres
 * caminos distintos y todos reales:
 *
 * 1. **No lo borra en lo cotidiano.** El almacén vive en el directorio de datos
 *    de la aplicación (`app_webview/Default/IndexedDB`), no en la caché.
 *    Sobrevive al bloqueo de pantalla, al segundo plano, a que el sistema mate
 *    el proceso, al reinicio del teléfono y a actualizar el APK. Nada de eso lo
 *    toca, y por eso no hay que respaldar en cada pausa.
 * 2. **Pero es almacenamiento desechable, y aquí no se puede dejar de serlo.**
 *    Chromium reparte cuota y, cuando al aparato le falta sitio, desaloja
 *    orígenes por antigüedad de uso. La salida normal es pedir
 *    `navigator.storage.persist()`, y aquí no sirve: Chromium **no pregunta**
 *    por ese permiso, lo concede solo cuando detecta uso asentado —la página
 *    marcada en favoritos, permiso de notificaciones dado, instalada como
 *    PWA—, y **ninguna de esas señales puede existir dentro de un WebView**,
 *    que no tiene favoritos ni instalación. Así que la promesa se resuelve a
 *    `false` siempre y el documento se queda en la categoría que el sistema
 *    puede tirar. No es que no se haya pedido: es que no se puede conceder.
 * 3. **Y el origen puede cambiar sin que nadie borre nada.** El IndexedDB está
 *    indexado por origen, y el WebView carga lo que diga `APP_URL`. Hoy es
 *    `http://localhost:3001` por `adb reverse`; el día que el APK apunte al
 *    despliegue, es **otro origen y por tanto otro almacén, vacío**. Lo que se
 *    hubiera editado sin conexión no está borrado: está en un cajón al que ya no
 *    se entra. Es el camino menos aparatoso de los tres y el más probable.
 *
 * ## Qué se arriesga de verdad
 *
 * Casi nada del documento está en peligro, porque casi siempre hay una copia en
 * el servidor. Lo único que se pierde para siempre es **lo que se editó sin
 * llegar a sincronizar**: dibujar cuatro clases en el autobús, bloquear el
 * teléfono y que el almacén desaparezca antes de volver a tener cobertura. No
 * hay aviso, no hay error, y el diagrama vuelve a abrirse como estaba ayer.
 *
 * De ahí la regla de abajo, que es más estrecha de lo que parecería: se respalda
 * **solo cuando el servidor no lo tiene**, y en cuanto lo tiene se tira la
 * copia. Un respaldo que se conserva de más no es gratis: es una versión vieja
 * esperando la ocasión de volver.
 *
 * La otra mitad está en `mobile/lib/respaldo_nativo.dart`. Este fichero no toca
 * el puente ni el documento: solo decide, para poder probarlo sin navegador.
 */

/* -------------------------------------------------------------------------- */
/* Topes y esperas                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cuánto base64 se acepta mandar de una vez.
 *
 * A diferencia de la descarga, esto **no se trocea**, y la decisión merece
 * explicación porque la maquinaria de trocear ya existe al lado. El respaldo
 * tiene que viajar en los dos sentidos: subir por el canal —que sí sabría ir a
 * trozos— y **bajar por `runJavaScript`**, que es donde está el techo de
 * aproximadamente 1 MB del Binder y donde un mensaje que no cabe se pierde en
 * silencio. Trocear la bajada significaría inventar un reensamblado en la
 * página, con sus estados a medias, para un dato que en la práctica ocupa
 * kilobytes: el documento Yjs de un diagrama de cien clases no llega a 50 KiB.
 *
 * Así que hay tope en vez de troceo, y lo que pase de aquí **se dice**, no se
 * recorta. Un respaldo truncado es peor que ninguno: parece que hay copia.
 */
export const LIMITE_RESPALDO_B64 = 256 * 1024;

/**
 * Cuánto se espera desde el último cambio antes de escribir.
 *
 * Arrastrar una caja por la pantalla produce un `update` por fotograma. Sin
 * espera, eso son sesenta escrituras por segundo en la memoria flash del
 * teléfono, y lo que se guarda son cincuenta y nueve estados intermedios que no
 * le importan a nadie.
 *
 * Dos segundos porque el reloj que cuenta es el de la mano que suelta: lo que
 * no puede pasar es que alguien acabe de dibujar, bloquee la pantalla y se
 * quede sin respaldo. Un gesto completo —arrastrar, soltar, mirar— dura más que
 * esto, así que al apartar el dedo el respaldo ya está en camino.
 */
export const ESPERA_RESPALDO_MS = 2000;

/* -------------------------------------------------------------------------- */
/* Qué hacer con el respaldo                                                   */
/* -------------------------------------------------------------------------- */

/** Lo que se sabe en el momento de decidir. */
export interface SituacionRespaldo {
  conexion: EstadoConexion;
  /** ¿Llegó ya lo que el servidor tenía? Ver `CollabProvider.estaSincronizado`. */
  sincronizado: boolean;
  /** ¿Terminó de cargar el IndexedDB? Antes de eso el documento está vacío. */
  listoLocal: boolean;
  /** Tamaño del documento ya codificado, en caracteres base64. */
  caracteresB64: number;
}

export type AccionRespaldo = 'guardar' | 'olvidar' | 'nada';

export interface DecisionRespaldo {
  accion: AccionRespaldo;
  porque: string;
}

/**
 * Qué hacer ahora mismo con la copia nativa del documento.
 *
 * El orden de las reglas es lo único delicado que hay aquí, y cada salto de una
 * a la siguiente es un fallo que se evita.
 */
export function decidirRespaldo({
  conexion,
  sincronizado,
  listoLocal,
  caracteresB64,
}: SituacionRespaldo): DecisionRespaldo {
  /*
    Lo primero, y no por orden de importancia sino porque las demás reglas serían
    activamente dañinas antes de esta. Entre que la pantalla monta y que
    `IndexeddbPersistence` termina de leer, el documento **está vacío**, y en ese
    hueco la conexión todavía no está sincronizada: sin este guardián, la primera
    decisión de la vida de la pantalla sería «guardar», y lo que se guardaría es
    el vacío encima del respaldo bueno. El fallo se comería exactamente lo que
    esto existe para salvar, y solo en el arranque siguiente a haber perdido el
    IndexedDB, que es cuando nadie está mirando.
  */
  if (!listoLocal) {
    return {
      accion: 'nada',
      porque: 'el documento local aún no ha cargado: lo que hay en memoria no es el documento',
    };
  }

  /*
    El servidor lo tiene. No hace falta copia, y conservarla no es neutral: es
    dejar una versión vieja a mano para que algún arranque futuro la mezcle. Se
    tira en cuanto sobra, que es la única forma de que un respaldo no se
    convierta con el tiempo en una fuente de resurrecciones.

    Hacen falta las dos condiciones. `conectado` sin `sincronizado` es el rato
    entre que el socket abre y que llega el paso 2, y ahí el servidor todavía no
    ha recibido nada de este cliente.
  */
  if (conexion === 'conectado' && sincronizado) {
    return { accion: 'olvidar', porque: 'el servidor ya tiene lo que hay: la copia local sobra' };
  }

  /*
    Demasiado grande para el puente. Se dice en vez de mandar un trozo: media
    copia no es media garantía, es una copia que parece buena hasta el día que se
    usa. Ver `LIMITE_RESPALDO_B64`.
  */
  if (caracteresB64 > LIMITE_RESPALDO_B64) {
    return {
      accion: 'nada',
      porque: 'el documento no cabe en un mensaje del puente y no se manda a medias',
    };
  }

  // Queda todo lo demás: desconectado, conectando, o sin permiso. En los tres
  // hay trabajo que el servidor no tiene, y `sin-permiso` es el peor de todos
  // —no va a poder subir— así que es justo cuando más falta hace la copia.
  return { accion: 'guardar', porque: 'hay cambios que el servidor no tiene' };
}

/* -------------------------------------------------------------------------- */
/* Qué hacer con lo que vuelve                                                 */
/* -------------------------------------------------------------------------- */

/** Lo que llega del lado nativo cuando se le pide la copia. */
export interface RespuestaRespaldo {
  /** El proyecto que se pidió, tal como lo devuelve el otro lado. */
  proyecto: string;
  /** El documento en base64, o `null` si no había copia guardada. */
  datos: string | null;
}

export interface VeredictoRestaurar {
  restaurar: boolean;
  porque: string;
}

/**
 * Si lo que ha vuelto del puente se puede mezclar en el documento abierto.
 *
 * Mezclar de más es seguro en Yjs y conviene decir por qué, porque es lo que
 * permite que esta función sea tan corta: una actualización es un delta
 * conmutativo e idempotente, los borrados viajan como lápidas, y aplicar una
 * copia vieja sobre un documento nuevo **no resucita** lo que se borró después
 * ni deshace nada. Aplicarla dos veces tampoco hace daño. Por eso no hay aquí
 * ninguna comparación de versiones ni ningún «¿está vacío el documento?»: esa
 * clase de heurística es justo lo que se equivoca.
 *
 * Lo que sí importa, y es lo único que se comprueba:
 *
 * - **Que sea del proyecto que se está mirando.** La petición es asíncrona y
 *   nada impide salir de un diagrama y entrar en otro mientras la respuesta
 *   viaja. Sin esta comprobación, la copia del proyecto A se mezcla en el
 *   documento del B, y como mezclar en Yjs nunca falla, el resultado no es un
 *   error: son las clases de otro proyecto apareciendo en este, ya
 *   sincronizadas con el servidor y con todos los colaboradores.
 * - **Que haya algo.** No tener copia es lo normal, no un fallo.
 */
/**
 * El base64 de vuelta, o `null` si no se puede leer.
 *
 * Existe habiendo ya un `deBase64` en `services/api.ts`, y la diferencia es
 * justo la que importa aquí: **aquel lanza y este no**. Quien llama a este está
 * dentro del receptor que invoca Flutter por `runJavaScript`, y una excepción
 * ahí no la recoge nadie —sube hasta el puente y se pierde—, dejando la
 * pantalla a medio restaurar sin que conste en ningún sitio. Un `null` se
 * puede contar; una excepción en ese hueco, no.
 *
 * Lo que haría saltar a `atob` no es hipotético: es el fichero de respaldo que
 * se quedó a medio escribir porque el sistema mató la app mientras guardaba.
 */
export function leerBase64(texto: string): Uint8Array | null {
  try {
    const binario = atob(texto);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function convieneRestaurar(
  pedidoPara: string,
  respuesta: RespuestaRespaldo,
): VeredictoRestaurar {
  if (respuesta.proyecto !== pedidoPara) {
    return {
      restaurar: false,
      porque: 'la copia es de otro proyecto: llegó tarde, cuando ya se había cambiado de diagrama',
    };
  }
  if (respuesta.datos === null || respuesta.datos === '') {
    return { restaurar: false, porque: 'no había copia guardada, que es lo normal' };
  }
  return { restaurar: true, porque: 'había una copia de este proyecto y mezclarla no puede dañar' };
}
