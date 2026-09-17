import { describe, expect, it } from 'vitest';
import type { EstadoConexion } from '@app/shared';
import { aBase64 } from '../services/descarga';
import {
  ESPERA_RESPALDO_MS,
  LIMITE_RESPALDO_B64,
  convieneRestaurar,
  leerBase64,
  decidirRespaldo,
  type SituacionRespaldo,
} from './respaldo';

/**
 * Pruebas de cuándo se saca el documento del IndexedDB del WebView.
 *
 * Lo que se vigila no es que se respalde, sino **que no se respalde de más ni
 * en el momento equivocado**. Las dos formas de estropear esto son escribir
 * encima del respaldo bueno cuando el documento todavía no ha cargado, y dejar
 * una copia vieja a mano para que algún arranque futuro la mezcle.
 */

const BASE: SituacionRespaldo = {
  conexion: 'desconectado',
  sincronizado: false,
  listoLocal: true,
  caracteresB64: 4096,
};

const CONEXIONES: readonly EstadoConexion[] = [
  'conectando',
  'conectado',
  'desconectado',
  'sin-permiso',
];

describe('lo que se pierde de verdad: lo editado sin conexión', () => {
  it('sin conexión se guarda, que es el caso que esto existe para cubrir', () => {
    const decision = decidirRespaldo(BASE);
    expect(decision.accion).toBe('guardar');
  });

  it('mientras se conecta también, porque todavía no ha subido nada', () => {
    /*
      El hueco entre que el socket abre y que llega el paso 2 de la
      sincronización es corto, pero es un hueco en el que el servidor no tiene
      nada de este cliente. Tratarlo como «ya está a salvo» sería fiarse de que
      la conexión va a terminar de establecerse.
    */
    const decision = decidirRespaldo({ ...BASE, conexion: 'conectando' });
    expect(decision.accion).toBe('guardar');
  });

  it('sin permiso es cuando más falta hace, no cuando menos', () => {
    // Es tentador leer «sin-permiso» como «esto ya no es asunto nuestro». Al
    // revés: el servidor rechazó al cliente, así que lo que haya dibujado no va
    // a subir nunca solo, y el IndexedDB es lo único que lo sostiene.
    const decision = decidirRespaldo({ ...BASE, conexion: 'sin-permiso' });
    expect(decision.accion).toBe('guardar');
  });

  it('conectado pero sin terminar de sincronizar todavía se guarda', () => {
    const decision = decidirRespaldo({
      ...BASE,
      conexion: 'conectado',
      sincronizado: false,
    });
    expect(decision.accion).toBe('guardar');
  });
});

describe('la copia se tira en cuanto sobra', () => {
  it('con el servidor al día se olvida, en vez de dejarla por si acaso', () => {
    const decision = decidirRespaldo({
      ...BASE,
      conexion: 'conectado',
      sincronizado: true,
    });
    expect(decision.accion).toBe('olvidar');
  });

  it('el motivo dice que el servidor lo tiene, no que no haya nada que guardar', () => {
    const decision = decidirRespaldo({
      ...BASE,
      conexion: 'conectado',
      sincronizado: true,
    });
    expect(decision.porque).toMatch(/servidor/i);
  });

  it('«sincronizado» a secas no basta: hace falta estar conectado', () => {
    /*
      `sincronizado` se queda a `true` de la conexión anterior hasta que el
      `close` lo baja, y hay un instante —y con `reconectarYa`, un instante
      provocado a mano— en que la bandera dice que sí y el socket ya no está.
      Olvidar el respaldo ahí sería tirarlo justo al empezar a hacer falta.
    */
    const decision = decidirRespaldo({
      ...BASE,
      conexion: 'desconectado',
      sincronizado: true,
    });
    expect(decision.accion).toBe('guardar');
  });
});

describe('el arranque, que es donde esto se rompería solo', () => {
  it('antes de cargar el IndexedDB no se toca nada', () => {
    /*
      El fallo que evita, dicho entero: al montar la pantalla el documento está
      vacío y la conexión no está sincronizada. Sin el guardián, la primera
      decisión de la vida de la pantalla es «guardar» y lo que se guarda es el
      vacío, encima de la copia buena. Y solo se nota el día que se necesita la
      copia, que es el único día que nadie está mirando.
    */
    const decision = decidirRespaldo({ ...BASE, listoLocal: false });
    expect(decision.accion).toBe('nada');
  });

  it('gana a cualquier estado de conexión', () => {
    for (const conexion of CONEXIONES) {
      for (const sincronizado of [false, true]) {
        const decision = decidirRespaldo({ ...BASE, conexion, sincronizado, listoLocal: false });
        expect(decision.accion, `${conexion}/${String(sincronizado)}`).toBe('nada');
      }
    }
  });

  it('tampoco se olvida el respaldo antes de tiempo', () => {
    // El caso concreto: se arranca con cobertura, el socket sincroniza rápido y
    // el IndexedDB todavía está leyendo. Si «olvidar» pasara por delante, se
    // borraría la copia sin haber comprobado que el documento local está
    // entero; y lo que el servidor tiene puede no incluir lo de anoche.
    const decision = decidirRespaldo({
      ...BASE,
      conexion: 'conectado',
      sincronizado: true,
      listoLocal: false,
    });
    expect(decision.accion).toBe('nada');
  });
});

describe('lo que no cabe por el puente', () => {
  it('pasarse del tope no manda nada', () => {
    const decision = decidirRespaldo({ ...BASE, caracteresB64: LIMITE_RESPALDO_B64 + 1 });
    expect(decision.accion).toBe('nada');
  });

  it('justo en el tope sí se manda', () => {
    const decision = decidirRespaldo({ ...BASE, caracteresB64: LIMITE_RESPALDO_B64 });
    expect(decision.accion).toBe('guardar');
  });

  it('el motivo distingue «no cabe» de «no hacía falta»', () => {
    // Los dos son «nada», y quien lea un registro tiene que poder distinguir un
    // diagrama demasiado grande de un arranque normal.
    const grande = decidirRespaldo({ ...BASE, caracteresB64: LIMITE_RESPALDO_B64 * 2 });
    const pronto = decidirRespaldo({ ...BASE, listoLocal: false });
    expect(grande.porque).not.toBe(pronto.porque);
    expect(grande.porque).toMatch(/cabe|medias/i);
  });

  it('el tamaño no impide olvidar: para tirar la copia no hay que mandarla', () => {
    const decision = decidirRespaldo({
      ...BASE,
      conexion: 'conectado',
      sincronizado: true,
      caracteresB64: LIMITE_RESPALDO_B64 * 10,
    });
    expect(decision.accion).toBe('olvidar');
  });
});

describe('la decisión siempre se explica', () => {
  it('ningún estado se queda sin motivo', () => {
    for (const conexion of CONEXIONES) {
      for (const sincronizado of [false, true]) {
        for (const listoLocal of [false, true]) {
          for (const caracteresB64 of [0, 4096, LIMITE_RESPALDO_B64 + 1]) {
            const decision = decidirRespaldo({
              conexion,
              sincronizado,
              listoLocal,
              caracteresB64,
            });
            expect(decision.porque.length, JSON.stringify({ conexion, listoLocal })).toBeGreaterThan(
              10,
            );
          }
        }
      }
    }
  });
});

describe('la espera antes de escribir', () => {
  it('es más larga que un fotograma y más corta que un gesto', () => {
    /*
      No es un número redondo por gusto: por debajo de ~100 ms se escribe una
      vez por fotograma mientras se arrastra una caja, y por encima de unos
      pocos segundos alguien puede dibujar y bloquear la pantalla sin que dé
      tiempo. La prueba fija los dos lados para que cambiarlo sea deliberado.
    */
    expect(ESPERA_RESPALDO_MS).toBeGreaterThan(500);
    expect(ESPERA_RESPALDO_MS).toBeLessThanOrEqual(5000);
  });
});

describe('lo que vuelve del puente', () => {
  it('una copia del proyecto que se está mirando se mezcla', () => {
    const veredicto = convieneRestaurar('p1', { proyecto: 'p1', datos: 'AQID' });
    expect(veredicto.restaurar).toBe(true);
  });

  it('no haber copia es lo normal, no un fallo', () => {
    const veredicto = convieneRestaurar('p1', { proyecto: 'p1', datos: null });
    expect(veredicto.restaurar).toBe(false);
    expect(veredicto.porque).toMatch(/normal/i);
  });

  it('la copia de otro proyecto no se mezcla aunque traiga datos', () => {
    /*
      El fallo que evita es el más caro de todo el fichero, porque no da ningún
      error. Se sale de un diagrama y se entra en otro mientras la respuesta del
      puente viaja; mezclar en Yjs nunca falla, así que las clases del proyecto
      anterior aparecen en este, y desde ahí suben al servidor y se reparten
      entre todos los colaboradores. A partir de ese momento ya no hay nada que
      deshacer: están en el documento de verdad.
    */
    const veredicto = convieneRestaurar('p2', { proyecto: 'p1', datos: 'AQID' });
    expect(veredicto.restaurar).toBe(false);
    expect(veredicto.porque).toMatch(/otro proyecto/i);
  });

  it('el proyecto se comprueba antes que el contenido', () => {
    // Si se mirase primero si hay datos, una respuesta vacía de otro proyecto
    // se explicaría como «no había copia», y el registro escondería que las
    // respuestas están llegando cruzadas.
    const veredicto = convieneRestaurar('p2', { proyecto: 'p1', datos: null });
    expect(veredicto.porque).toMatch(/otro proyecto/i);
  });

  it('una cadena vacía cuenta como no tener copia', () => {
    // El lado nativo devuelve `null` cuando no hay fichero, pero un fichero
    // truncado a cero bytes es indistinguible desde aquí y no se puede
    // decodificar: se trata igual en vez de intentar mezclar la nada.
    const veredicto = convieneRestaurar('p1', { proyecto: 'p1', datos: '' });
    expect(veredicto.restaurar).toBe(false);
  });
});

describe('decodificar lo que llega', () => {
  it('un documento cualquiera va y vuelve igual', () => {
    // Bytes con ceros, con 0xFF y con valores altos: un documento Yjs es
    // binario de verdad, y un codificador que pase por UTF-8 por el camino lo
    // estropearía sin dar ningún error.
    const original = new Uint8Array([0, 1, 127, 128, 200, 255, 0, 42]);
    expect(leerBase64(aBase64(original))).toEqual(original);
  });

  it('un respaldo escrito a medias devuelve null en vez de reventar', () => {
    /*
      Pasa si el sistema mata la app mientras escribe el fichero. Lo importante
      no es el `null` sino dónde se lanzaría la excepción sin él: dentro del
      receptor que llama Flutter por `runJavaScript`, donde no la recoge nadie
      y la pantalla se queda a medio restaurar en silencio.
    */
    expect(leerBase64('no es base64 !!!')).toBeNull();
  });

  it('lo vacío decodifica a nada, no a null', () => {
    // Se distingue de lo corrupto a propósito: son dos salidas distintas —una
    // es «no había», la otra «había y está roto»— y confundirlas escondería un
    // fichero corrupto detrás de un caso normal.
    expect(leerBase64('')).toEqual(new Uint8Array(0));
  });
});
