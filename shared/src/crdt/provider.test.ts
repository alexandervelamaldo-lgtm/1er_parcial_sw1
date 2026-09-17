import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  CollabProvider,
  type CierreEntrante,
  type MensajeEntrante,
  type SocketLike,
} from '../index.js';

/**
 * Pruebas de la reconexión, con un socket de mentira.
 *
 * ## Qué se está vigilando
 *
 * El fallo que motivó `reconectarYa` no es que la conexión se caiga: eso ya lo
 * cubría la espera creciente. Es que **no se caiga del todo**. Cuando Android
 * congela el WebView al bloquear la pantalla, o cuando el teléfono salta de
 * wifi a datos, la conexión TCP muere sin que llegue ningún `close`, y
 * `readyState` se queda en `OPEN` para siempre. El proveedor sigue enviando, el
 * indicador sigue diciendo «Al día», y nada de lo que se dibuja sale del
 * aparato.
 *
 * Tirar ese socket obliga a abandonar uno que todavía puede emitir eventos, y
 * ahí está la parte peligrosa: el `close` del abandonado llega cuando el
 * sustituto ya está puesto. Atenderlo pondría `this.socket = null` —dejando
 * mudo al nuevo— y programaría un reintento, con lo que acabarían corriendo dos
 * conexiones contra el mismo proyecto. El síntoma de eso es un diagrama que
 * duplica lo que se escribe, y no hay forma de deducirlo mirando la pantalla.
 *
 * De ahí que el socket falso de abajo emita el cierre **de forma síncrona**
 * dentro de `close()`, que es el caso más agresivo y el que rompía la versión
 * anterior.
 */

/** Un WebSocket de mentira que hace exactamente lo que se le manda y nada más. */
class SocketFalso implements SocketLike {
  /** Todos los que se han construido, en orden. Es la cuenta de reconexiones. */
  static creados: SocketFalso[] = [];

  binaryType = '';
  readyState = 0;
  readonly enviados: Uint8Array[] = [];
  cerrado = false;

  private readonly escuchas = new Map<string, ((evento: never) => void)[]>();

  constructor(readonly url: string) {
    SocketFalso.creados.push(this);
  }

  send(data: Uint8Array): void {
    this.enviados.push(data);
  }

  close(): void {
    if (this.cerrado) return;
    this.cerrado = true;
    this.readyState = 3;
    this.emitir('close', { code: 1006, reason: '' });
  }

  addEventListener(tipo: string, escucha: (evento: never) => void): void {
    const lista = this.escuchas.get(tipo) ?? [];
    lista.push(escucha);
    this.escuchas.set(tipo, lista);
  }

  /** Lo que haría el servidor al aceptar la conexión. */
  abrir(): void {
    this.readyState = 1;
    this.emitir('open', undefined as never);
  }

  /** Una caída de red de las que sí avisan. */
  caerse(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.cerrado = true;
    this.emitir('close', { code, reason } as never);
  }

  private emitir(tipo: string, evento: unknown): void {
    for (const escucha of this.escuchas.get(tipo) ?? []) escucha(evento as never);
  }
}

/** El tipo de `SocketFalso` visto como la fábrica que pide el proveedor. */
const Fabrica = SocketFalso as unknown as new (url: string) => SocketLike;

/** El socket que el proveedor está usando ahora mismo. */
function ultimo(): SocketFalso {
  const s = SocketFalso.creados[SocketFalso.creados.length - 1];
  if (!s) throw new Error('el proveedor no ha abierto ningún socket');
  return s;
}

function crear(doc: Y.Doc, opciones: { reintentoMs?: number } = {}): CollabProvider {
  return new CollabProvider({
    url: 'ws://prueba/proyecto',
    doc,
    WebSocketImpl: Fabrica,
    ...opciones,
  });
}

let doc: Y.Doc;
let proveedor: CollabProvider | null = null;

beforeEach(() => {
  SocketFalso.creados = [];
  doc = new Y.Doc();
  proveedor = null;
});

afterEach(() => {
  proveedor?.destroy();
  vi.useRealTimers();
});

describe('el socket que dice estar vivo y no lo está', () => {
  it('se tira sin preguntarle cómo está', () => {
    /*
      Preguntar por `readyState` antes de cerrar sería fiarse de la única
      fuente que no puede saber la respuesta: el WebView congelado no se
      enteró de que la conexión murió.
    */
    proveedor = crear(doc);
    const viejo = ultimo();
    viejo.abrir();
    expect(viejo.readyState).toBe(1);

    proveedor.reconectarYa();

    expect(viejo.cerrado).toBe(true);
    expect(SocketFalso.creados).toHaveLength(2);
  });

  it('el adiós tardío del abandonado no deja mudo al que lo sustituye', () => {
    /*
      La regresión que justifica el contador de generación, y hay que montarla
      con cuidado para que pruebe algo. El `close` de un WebSocket de verdad
      **no es síncrono**: `close()` vuelve en el acto y el evento llega después,
      con el sustituto ya abierto y asignado. Es entonces cuando la escucha
      vieja, si se le hace caso, pone `this.socket = null` y deja al nuevo sin
      nadie que le escriba. A partir de ahí todo lo que se dibuja se queda en el
      aparato mientras la pantalla dice que hay conexión.

      Provocar el cierre dentro de `reconectarYa` —que es lo que hacía la
      primera versión de esta prueba— no vale: en ese instante `this.socket` ya
      está a `null` de todos modos, así que el daño queda tapado y la prueba
      pasa en verde con el fallo puesto. Se comprobó quitando el guardián.
    */
    proveedor = crear(doc);
    const viejo = ultimo();
    viejo.abrir();

    proveedor.reconectarYa();
    const nuevo = ultimo();
    nuevo.abrir();

    viejo.caerse();

    const antes = nuevo.enviados.length;
    doc.getMap('clases').set('c1', 'Pedido');
    expect(nuevo.enviados.length, 'el cierre tardío dejó mudo al socket bueno').toBeGreaterThan(
      antes,
    );
  });

  it('ese adiós tardío tampoco desmiente al indicador', () => {
    // El otro daño del mismo evento: pintar «desconectado» encima de una
    // conexión que está abierta y sincronizando.
    const estados: string[] = [];
    proveedor = new CollabProvider({
      url: 'ws://prueba/proyecto',
      doc,
      WebSocketImpl: Fabrica,
      onEstado: (estado) => estados.push(estado),
    });
    const viejo = ultimo();
    viejo.abrir();
    proveedor.reconectarYa();
    ultimo().abrir();

    viejo.caerse();

    expect(estados[estados.length - 1]).toBe('conectado');
    expect(proveedor.estado).toBe('conectado');
  });

  it('no deja dos conexiones corriendo a la vez', () => {
    /*
      La otra mitad del mismo fallo: la escucha del abandonado programaría su
      propio reintento, y el proveedor acabaría con dos sockets hablando con el
      mismo proyecto.
    */
    vi.useFakeTimers();
    proveedor = crear(doc, { reintentoMs: 100 });
    const viejo = ultimo();
    viejo.abrir();

    proveedor.reconectarYa();
    ultimo().abrir();
    expect(SocketFalso.creados).toHaveLength(2);

    // Y llegando tarde, que es como llega de verdad.
    viejo.caerse();

    vi.advanceTimersByTime(60_000);
    expect(SocketFalso.creados, 'alguien programó un reintento de más').toHaveLength(2);
  });

  it('el indicador deja de mentir en cuanto se decide reconectar', () => {
    // Pasa de «Al día» a «conectando…» en el acto, no cuando el socket nuevo
    // conteste. Es lo único cierto que se puede decir en ese instante.
    const estados: string[] = [];
    proveedor = new CollabProvider({
      url: 'ws://prueba/proyecto',
      doc,
      WebSocketImpl: Fabrica,
      onEstado: (estado) => estados.push(estado),
    });
    ultimo().abrir();
    expect(estados[estados.length - 1]).toBe('conectado');

    proveedor.reconectarYa();
    expect(estados[estados.length - 1]).toBe('conectando');
  });
});

describe('la espera creciente', () => {
  it('vuelve a cero al reconectar a mano', () => {
    /*
      La espera llega a quince segundos y existe para que cien pestañas no
      tumben al servidor recién levantado. No existe para hacer esperar a una
      persona que acaba de desbloquear el teléfono, así que el contador se
      reinicia: si la conexión nueva también falla, el siguiente intento vuelve
      a ser el corto.
    */
    vi.useFakeTimers();
    proveedor = crear(doc, { reintentoMs: 1_000 });

    // Cuatro caídas seguidas: la espera ya está en el orden de los segundos.
    for (let i = 0; i < 4; i += 1) {
      ultimo().caerse();
      vi.advanceTimersByTime(30_000);
    }
    const trasLasCaidas = SocketFalso.creados.length;

    proveedor.reconectarYa();
    ultimo().caerse();

    // Con el contador reiniciado, el reintento cae dentro del primer segundo.
    // Sin reiniciarlo habría que esperar bastante más.
    vi.advanceTimersByTime(1_000);
    expect(SocketFalso.creados.length).toBeGreaterThan(trasLasCaidas + 1);
  });

  it('cancela el reintento pendiente en vez de sumarle otro', () => {
    vi.useFakeTimers();
    proveedor = crear(doc, { reintentoMs: 5_000 });
    ultimo().caerse();

    // Hay un reintento en cola. Reconectar a mano tiene que quedárselo, no
    // dejar que dispare después y abra un socket de más.
    proveedor.reconectarYa();
    const tras = SocketFalso.creados.length;

    vi.advanceTimersByTime(60_000);
    expect(SocketFalso.creados).toHaveLength(tras);
  });
});

describe('el socket que llega tarde', () => {
  it('si se abre después de haber sido abandonado, se cierra solo', () => {
    /*
      Pasa de verdad: se pierde la red mientras el socket está negociando, se
      desbloquea el teléfono y se fuerza la reconexión, y el primero termina de
      abrirse un segundo después. Dejarlo vivo sería una conexión huérfana
      ocupando sitio en el servidor durante el resto de la sesión, sin que nadie
      la lea.
    */
    proveedor = crear(doc);
    const rezagado = SocketFalso.creados[0];

    proveedor.reconectarYa();
    rezagado?.abrir();

    expect(rezagado?.cerrado).toBe(true);
  });

  it('y no se lleva por delante el estado del que sí vale', () => {
    proveedor = crear(doc);
    const rezagado = SocketFalso.creados[0];
    proveedor.reconectarYa();
    const bueno = ultimo();
    bueno.abrir();

    rezagado?.abrir();

    expect(proveedor.estado).toBe('conectado');
    doc.getMap('clases').set('c1', 'Pedido');
    expect(bueno.enviados.length).toBeGreaterThan(0);
  });
});

describe('cerrar del todo', () => {
  it('reconectar después de `destroy` no abre nada', () => {
    /*
      `destroy` es lo que corre al salir del diagrama. Un aviso de «la
      aplicación volvió del segundo plano» puede llegar justo después —el
      puente nativo no sabe qué pantalla hay dentro— y resucitar la conexión de
      un proyecto que ya se cerró sería una fuga silenciosa.
    */
    proveedor = crear(doc);
    ultimo().abrir();
    const antes = SocketFalso.creados.length;

    proveedor.destroy();
    proveedor.reconectarYa();

    expect(SocketFalso.creados).toHaveLength(antes);
  });
});
