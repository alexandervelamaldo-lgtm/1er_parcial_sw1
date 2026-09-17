import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileTablonStore, esIdSeguroDeFichero } from './tablon.js';

/**
 * Pruebas del almacén del tablón contra el disco de verdad.
 *
 * Se usa un directorio temporal y no un doble porque la mitad de lo que hay
 * que comprobar es precisamente lo que pasa con los ficheros: que el audio se
 * escribe, que al retirar un mensaje se borra, y que un identificador con
 * `../` dentro no consigue escribir fuera del directorio de datos.
 */

let dataDir: string;
let almacen: FileTablonStore;

const P = 'proyecto-1';
const AUTOR = 'usuario-1';

/** Bytes cualesquiera: al almacén le da igual el contenido. */
function audio(tamano = 64): Uint8Array {
  return new Uint8Array(tamano).fill(7);
}

async function ficherosDeAudio(): Promise<string[]> {
  try {
    return await readdir(join(dataDir, 'tablones', 'audio'));
  } catch {
    return [];
  }
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-tablon-'));
  almacen = new FileTablonStore(dataDir);
});

afterEach(async () => {
  await almacen.flush();
  await rm(dataDir, { recursive: true, force: true });
});

describe('publicar', () => {
  it('numera el primer mensaje con un uno en las dos numeraciones', async () => {
    const mensaje = await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'hola' });
    expect(mensaje.secuencia).toBe(1);
    expect(mensaje.version).toBe(1);
    expect(mensaje.retirado).toBe(false);
  });

  it('cada mensaje se lleva un número distinto', async () => {
    for (let i = 0; i < 5; i += 1) {
      await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: `m${i}` });
    }
    const { mensajes } = await almacen.ultimos(P, 10);
    expect(mensajes.map((m) => m.secuencia)).toEqual([1, 2, 3, 4, 5]);
  });

  it('los contadores de dos proyectos no se mezclan', async () => {
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'uno' });
    const otro = await almacen.publicarTexto({
      proyectoId: 'proyecto-2',
      autorId: AUTOR,
      texto: 'uno',
    });
    expect(otro.secuencia).toBe(1);
  });

  it('una nota de voz guarda sus bytes y sus metadatos', async () => {
    const mensaje = await almacen.publicarVoz({
      proyectoId: P,
      autorId: AUTOR,
      audio: audio(128),
      tipo: 'audio/webm',
      duracionMs: 3200,
    });

    expect(mensaje.tipo).toBe('voz');
    expect(mensaje.texto).toBe('');
    expect(mensaje.audio).toEqual({ tipo: 'audio/webm', bytes: 128, duracionMs: 3200 });

    const leido = await almacen.leerAudio(P, mensaje.id);
    expect(leido).toEqual(audio(128));
  });
});

describe('ultimos', () => {
  it('abre por el final del hilo, no por el principio', async () => {
    // Es la diferencia entre abrir un chat y abrir un archivo histórico.
    for (let i = 1; i <= 10; i += 1) {
      await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: `m${i}` });
    }
    const pagina = await almacen.ultimos(P, 3);
    expect(pagina.mensajes.map((m) => m.texto)).toEqual(['m8', 'm9', 'm10']);
    expect(pagina.hayMas).toBe(true);
  });

  it('un proyecto sin mensajes devuelve el cursor en cero', async () => {
    const pagina = await almacen.ultimos(P, 50);
    expect(pagina).toEqual({ mensajes: [], cursor: 0, hayMas: false });
  });

  it('un límite de cero no descarga el hilo entero', async () => {
    // `slice(-0)` devuelve todo el arreglo. Sin el cerrojo del límite, pedir
    // una página vacía traería la conversación completa.
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'uno' });
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'dos' });
    const pagina = await almacen.ultimos(P, 0);
    expect(pagina.mensajes).toHaveLength(1);
  });
});

describe('cambiosDesde', () => {
  it('con el cursor al día no devuelve nada', async () => {
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'uno' });
    const { cursor } = await almacen.ultimos(P, 50);

    const sondeo = await almacen.cambiosDesde(P, cursor, 50);
    expect(sondeo.mensajes).toEqual([]);
    expect(sondeo.cursor).toBe(cursor);
  });

  it('devuelve lo publicado después del cursor', async () => {
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'viejo' });
    const { cursor } = await almacen.ultimos(P, 50);
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'nuevo' });

    const sondeo = await almacen.cambiosDesde(P, cursor, 50);
    expect(sondeo.mensajes.map((m) => m.texto)).toEqual(['nuevo']);
  });

  it('al truncar deja el cursor donde se cortó, sin saltarse nada', async () => {
    for (let i = 1; i <= 5; i += 1) {
      await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: `m${i}` });
    }

    const primera = await almacen.cambiosDesde(P, 0, 2);
    expect(primera.hayMas).toBe(true);
    expect(primera.mensajes.map((m) => m.texto)).toEqual(['m1', 'm2']);

    const segunda = await almacen.cambiosDesde(P, primera.cursor, 2);
    expect(segunda.mensajes.map((m) => m.texto)).toEqual(['m3', 'm4']);
  });

  it('entrega la retirada de un mensaje que el cliente ya había visto', async () => {
    // El caso que justifica que existan dos numeraciones. Sin `version`, quien
    // ya tuviera el mensaje nunca se enteraría de que se ha ido.
    const mensaje = await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'ups' });
    const { cursor } = await almacen.ultimos(P, 50);
    await almacen.retirar(P, mensaje.id);

    const sondeo = await almacen.cambiosDesde(P, cursor, 50);
    expect(sondeo.mensajes).toHaveLength(1);
    expect(sondeo.mensajes[0]).toMatchObject({ id: mensaje.id, retirado: true, texto: '' });
  });
});

describe('retirar', () => {
  it('conserva el sitio en el hilo y avanza la versión', async () => {
    const primero = await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'uno' });
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'dos' });

    const lapida = await almacen.retirar(P, primero.id);
    expect(lapida?.secuencia).toBe(primero.secuencia);
    expect(lapida?.version).toBeGreaterThan(primero.version);

    const { mensajes } = await almacen.ultimos(P, 50);
    expect(mensajes.map((m) => m.id)).toEqual([primero.id, mensajes[1]!.id]);
  });

  it('borra los bytes del audio del disco', async () => {
    const mensaje = await almacen.publicarVoz({
      proyectoId: P,
      autorId: AUTOR,
      audio: audio(),
      tipo: 'audio/webm',
      duracionMs: 1000,
    });
    expect(await ficherosDeAudio()).toHaveLength(1);

    await almacen.retirar(P, mensaje.id);

    expect(await ficherosDeAudio()).toHaveLength(0);
    expect(await almacen.leerAudio(P, mensaje.id)).toBeNull();
  });

  it('retirar dos veces no gasta otra versión', async () => {
    const mensaje = await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'uno' });
    const primera = await almacen.retirar(P, mensaje.id);
    const segunda = await almacen.retirar(P, mensaje.id);
    expect(segunda?.version).toBe(primera?.version);
  });

  it('devuelve null si el mensaje no existe', async () => {
    expect(await almacen.retirar(P, 'no-existe')).toBeNull();
  });
});

describe('recorte del hilo', () => {
  it('poda los más antiguos y se lleva sus audios', async () => {
    const corto = new FileTablonStore(dataDir, 3);
    const primero = await corto.publicarVoz({
      proyectoId: P,
      autorId: AUTOR,
      audio: audio(),
      tipo: 'audio/webm',
      duracionMs: 500,
    });

    for (let i = 0; i < 3; i += 1) {
      await corto.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: `relleno ${i}` });
    }
    await corto.flush();

    const { mensajes } = await corto.ultimos(P, 50);
    expect(mensajes).toHaveLength(3);
    expect(mensajes.some((m) => m.id === primero.id)).toBe(false);
    // Si el audio sobreviviera a la poda, el disco crecería para siempre con
    // ficheros que ya no menciona ningún mensaje.
    expect(await ficherosDeAudio()).toHaveLength(0);
  });
});

describe('anterioresA', () => {
  it('sube por el hilo desde el punto que se le diga', async () => {
    for (let i = 1; i <= 6; i += 1) {
      await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: `m${i}` });
    }
    const pagina = await almacen.anterioresA(P, 4, 2);
    expect(pagina.mensajes.map((m) => m.texto)).toEqual(['m2', 'm3']);
    expect(pagina.hayMas).toBe(true);
  });
});

describe('identificadores que acaban en una ruta', () => {
  it('acepta un UUID y rechaza lo que se sale del directorio', () => {
    expect(esIdSeguroDeFichero('7a4b1c2d-0000-4000-8000-000000000000')).toBe(true);
    expect(esIdSeguroDeFichero('../../etc/passwd')).toBe(false);
    expect(esIdSeguroDeFichero('a/b')).toBe(false);
    expect(esIdSeguroDeFichero('a.json')).toBe(false);
    expect(esIdSeguroDeFichero('')).toBe(false);
  });

  it('publicar con un identificador con travesía falla en vez de escribir fuera', async () => {
    await expect(
      almacen.publicarTexto({ proyectoId: '../fuera', autorId: AUTOR, texto: 'hola' }),
    ).rejects.toThrow(/no admisible/);
  });

  it('una nota de voz con travesía no deja el audio escrito', async () => {
    // Se comprueba el identificador antes de tocar el disco: al revés quedaría
    // un fichero de audio que ningún mensaje menciona.
    await expect(
      almacen.publicarVoz({
        proyectoId: '../fuera',
        autorId: AUTOR,
        audio: audio(),
        tipo: 'audio/webm',
        duracionMs: 100,
      }),
    ).rejects.toThrow(/no admisible/);
    expect(await ficherosDeAudio()).toHaveLength(0);
  });
});

describe('persistencia', () => {
  it('lo publicado sobrevive a reabrir el almacén', async () => {
    await almacen.publicarTexto({ proyectoId: P, autorId: AUTOR, texto: 'persistente' });
    await almacen.flush();

    const reabierto = new FileTablonStore(dataDir);
    const { mensajes, cursor } = await reabierto.ultimos(P, 50);
    expect(mensajes.map((m) => m.texto)).toEqual(['persistente']);
    // El contador también: si se reiniciara a cero, el siguiente mensaje
    // reutilizaría el número 1 y el cliente lo tomaría por uno ya visto.
    expect(cursor).toBe(1);
  });
});
