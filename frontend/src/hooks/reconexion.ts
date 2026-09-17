import type { EstadoConexion } from '@app/shared';

/**
 * Cuándo hay que desconfiar del socket y abrir otro.
 *
 * ## El fallo que esto arregla
 *
 * Un WebSocket que se queda a medias **no avisa**. Cuando Android congela el
 * WebView al bloquear la pantalla, o cuando el teléfono salta de wifi a datos y
 * cambia de dirección IP, la conexión TCP muere por debajo sin que llegue
 * ningún evento `close`: el sistema operativo no tiene a quién mandárselo
 * porque el proceso está parado, y el otro extremo tampoco puede avisar porque
 * los paquetes ya no llegan a ninguna parte.
 *
 * El resultado es el peor de los posibles. `readyState` sigue diciendo
 * `OPEN`, así que `CollabProvider.enviar` escribe tan contento, el indicador
 * sigue en «Al día», y todo lo que se dibuja al volver de la pantalla de
 * bloqueo se va a un socket muerto. No se pierde —está en el `Y.Doc` y en
 * IndexedDB— pero no lo ve nadie más, y lo que la pantalla afirma mientras
 * tanto es falso. El encargo pide justamente lo contrario: un estado honesto.
 *
 * Y no se arregla solo. El reintento con espera creciente del proveedor **solo
 * corre cuando hubo un `close`**; aquí no lo hay. Sin esto, la única salida es
 * recargar la página.
 *
 * ## Por qué es una función pura y no cuatro `if` dentro del hook
 *
 * Porque lo difícil no es escuchar los eventos —eso son seis líneas— sino
 * decidir en cuáles hay que tirar la conexión. Equivocarse por un lado deja al
 * usuario escribiendo en el vacío; por el otro, una reconexión en cada vistazo
 * al teléfono, cada una con su sincronización completa y su parpadeo del
 * indicador. Eso se prueba sin navegador; los `addEventListener` no.
 */

/**
 * Qué despertó a la aplicación.
 *
 * - `visible` — la página vuelve a verse: `visibilitychange`, cambiar de
 *   pestaña, salir del cajón de aplicaciones.
 * - `red` — el sistema dice que hay red otra vez, o que cambió de una a otra.
 * - `nativo` — la carcasa Flutter avisa de que la aplicación volvió del segundo
 *   plano. Es distinto de `visible` porque llega **también** cuando el WebView
 *   nunca llegó a marcarse como oculto, que es lo que pasa en algunas versiones
 *   de Android al bloquear la pantalla con la app en primer plano.
 */
export type MotivoDespertar = 'visible' | 'red' | 'nativo';

export interface Despertar {
  motivo: MotivoDespertar;
  /** El estado que el proveedor *cree* tener. Puede ser mentira, y de ahí todo esto. */
  estado: EstadoConexion;
  /**
   * Cuánto tiempo estuvo la aplicación sin correr, en milisegundos.
   *
   * Se mide con el reloj de pared (`Date.now`) y no con `performance.now`, y no
   * es un detalle: el segundo no avanza mientras el aparato duerme en algunas
   * plataformas, que es exactamente el rato que hay que medir. Con el reloj
   * equivocado, una noche entera con el teléfono en la mesilla contaría como
   * cero.
   *
   * Vale `0` cuando no se sabe —el evento de red no tiene ausencia asociada—.
   */
  ausenteMs: number;
}

export interface Decision {
  reconectar: boolean;
  /**
   * Por qué. No sale por pantalla: va a la traza y a las pruebas.
   *
   * Está aquí porque una función que devuelve un booleano suelto obliga a
   * releerla entera cada vez que alguien duda de por qué reconectó, y la duda
   * aparece precisamente cuando el fallo es intermitente y no hay forma de
   * reproducirlo.
   */
  porque: string;
}

/**
 * Cuánta ausencia hace sospechoso un socket que dice estar abierto.
 *
 * Diez segundos, y el número sale de acotarlo por los dos lados. Por abajo:
 * mirar quién llama, bajar la persiana de notificaciones o contestar un mensaje
 * son ausencias de dos o tres segundos, y ninguna mata una conexión —tirarla
 * ahí sería pagar una sincronización completa por cada vistazo—. Por arriba:
 * Android congela el proceso de una aplicación en segundo plano a los pocos
 * segundos, y a partir de ahí la conexión está muerta aunque nadie lo haya
 * dicho todavía.
 *
 * Ante la duda se prefiere reconectar de más. Una reconexión innecesaria cuesta
 * un intercambio de estado y un parpadeo; una que faltó cuesta que el trabajo
 * de los siguientes veinte minutos no lo vea nadie.
 */
export const AUSENCIA_SOSPECHOSA_MS = 10_000;

/**
 * La decisión, con el detalle de por qué.
 */
export function alDespertar({ motivo, estado, ausenteMs }: Despertar): Decision {
  /*
    Lo primero, y es lo único que no se negocia: a un proyecto al que no se
    tiene acceso no se vuelve a llamar. El servidor cerró con 1008 y volverá a
    hacerlo, así que reintentar sería un bucle; pero lo caro no es el bucle, es
    que el indicador pasaría de decir «no tienes acceso a este proyecto» —que es
    cierto y accionable— a decir «conectando…» para siempre.
  */
  if (estado === 'sin-permiso') {
    return { reconectar: false, porque: 'sin acceso al proyecto: reconectar no cambiaría nada' };
  }

  /*
    Si el proveedor ya se sabe caído, se adelanta su reintento sin mirar nada
    más. La espera creciente llega a quince segundos, y esos quince segundos se
    cuentan desde la última caída: quien desbloquea el teléfono y mira la
    pantalla no tiene por qué esperarlos, porque el motivo por el que la
    conexión falló hace un rato —el metro, la pantalla apagada— es
    probablemente el que acaba de dejar de aplicar.
  */
  if (estado === 'desconectado' || estado === 'conectando') {
    return { reconectar: true, porque: 'ya estaba caído: se adelanta el reintento' };
  }

  /*
    Aquí el proveedor dice estar conectado, y la pregunta es si mentirá.

    El cambio de red se trata aparte y sin umbral de tiempo porque es el caso en
    el que el socket miente **con seguridad**: saltar de wifi a datos cambia la
    dirección de origen, y una conexión TCP está atada a la suya. El socket
    seguirá diciendo `OPEN` hasta que algún temporizador del sistema se dé por
    vencido, cosa que puede tardar minutos.
  */
  if (motivo === 'red') {
    return { reconectar: true, porque: 'cambió la red: la conexión anterior era de otra dirección' };
  }

  if (ausenteMs >= AUSENCIA_SOSPECHOSA_MS) {
    return {
      reconectar: true,
      porque: `estuvo ${String(Math.round(ausenteMs / 1000))} s sin correr: el socket puede estar muerto sin saberlo`,
    };
  }

  return { reconectar: false, porque: 'ausencia corta y conexión viva: no hay nada que arreglar' };
}
