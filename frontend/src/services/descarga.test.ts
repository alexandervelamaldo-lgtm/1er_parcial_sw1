import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LIMITE_BYTES,
  aBase64,
  avisoDeDescarga,
  descargaNativaDisponible,
  descargar,
  mensajesDeDescarga,
  nombreDeFichero,
  trocear,
} from './descarga';

/**
 * Sacar un fichero de la aplicación, comprobado sin navegador y sin teléfono.
 *
 * Lo que se vigila aquí no es «se descarga»: eso lo decide el sistema operativo
 * y no hay forma de comprobarlo en Node. Lo que se vigila es el tramo donde
 * estaba el fallo y donde se pueden meter otros nuevos:
 *
 * 1. **El troceado.** Los bytes cruzan al lado nativo partidos porque enteros no
 *    caben en una transacción de Android. Un trozo que se pierde, uno que se
 *    numera mal o un fichero vacío que no manda ningún trozo producen el mismo
 *    síntoma desde fuera —un ZIP corrupto o una descarga que nunca termina— y
 *    ninguno de los tres da error.
 * 2. **El base64 por bloques.** Se codifica de 32760 en 32760 bytes para no
 *    reventar la pila, y si ese bloque no fuese múltiplo de 3 aparecería relleno
 *    `=` en mitad de la cadena. El fichero llegaría, y estaría roto.
 * 3. **Los nombres.** Acaban siendo una ruta en el sistema de ficheros del
 *    teléfono, así que una barra dentro es un directorio.
 * 4. **Que se pueda fallar.** El código viejo no tenía forma de hacerlo: pinchar
 *    un `<a download>` no devuelve nada, así que en el móvil se enseñaba
 *    «exportado» sin haber exportado nada.
 *
 * No hace falta jsdom. `descarga.ts` solo mira `window` para saber si hay
 * puente, así que un `window` de mentira con lo justo basta.
 */

/* -------------------------------------------------------------------------- */
/* El navegador y el puente, de mentira                                        */
/* -------------------------------------------------------------------------- */

interface Enlace {
  href: string;
  download: string;
  click: () => void;
}

interface Ventana {
  DescargaNativa?: { postMessage: (m: string) => void };
  __descargaNativa?: (crudo: string) => void;
}

/**
 * El mismo objeto `window` durante todo el fichero, a propósito.
 *
 * `descarga.ts` instala el receptor una sola vez y se lo anota en una variable
 * de módulo. Si cada prueba montase un `window` nuevo, el módulo creería que ya
 * lo instaló y las respuestas de Flutter caerían en un objeto que ya nadie mira:
 * la segunda prueba se quedaría colgada y el motivo no se vería por ningún lado.
 */
const ventana: Ventana = {};

let enviados: string[];
let creados: Enlace[];
let revocadas: string[];

beforeEach(() => {
  enviados = [];
  creados = [];
  revocadas = [];
  delete ventana.DescargaNativa;

  Object.assign(globalThis, {
    window: ventana,
    document: {
      createElement: (): Enlace => {
        const enlace: Enlace = { href: '', download: '', click: () => {} };
        creados.push(enlace);
        return enlace;
      },
    },
    URL: Object.assign(URL, {
      createObjectURL: (): string => 'blob:falsa',
      revokeObjectURL: (url: string): void => void revocadas.push(url),
    }),
  });
});

afterEach(() => {
  delete ventana.DescargaNativa;
});

/** Enchufa el canal de Flutter y recoge lo que la página le manda. */
function conPuente(): void {
  ventana.DescargaNativa = { postMessage: (m) => void enviados.push(m) };
}

/** Lo que se ha mandado por el canal, ya parseado. */
function mensajes(): Array<Record<string, unknown>> {
  return enviados.map((m) => JSON.parse(m) as Record<string, unknown>);
}

/** Contesta como lo haría la parte nativa. */
function responder(mensaje: Record<string, unknown>): void {
  ventana.__descargaNativa?.(JSON.stringify(mensaje));
}

/** El `id` de la descarga que está en vuelo. */
function idEnVuelo(): string {
  const inicio = mensajes().find((m) => m.tipo === 'inicio');
  if (!inicio) throw new Error('no se mandó ningún mensaje de inicio');
  return inicio.id as string;
}

/* -------------------------------------------------------------------------- */
/* Nombres                                                                     */
/* -------------------------------------------------------------------------- */

describe('nombreDeFichero', () => {
  it('añade la extensión y respeta el nombre que escribió una persona', () => {
    expect(nombreDeFichero('Tienda de Álex', '.xmi')).toBe('Tienda de Álex.xmi');
    expect(nombreDeFichero('Punto-de_venta', 'zip')).toBe('Punto-de_venta.zip');
  });

  it('quita lo que en una ruta significa otra cosa', () => {
    // Sin esto el fichero se escribiría en `/etc`, o no se escribiría y el
    // error hablaría de un directorio que no existe.
    // Las barras caen con el resto de separadores, y los puntos que quedan
    // delante caen después por la regla del fichero oculto: el resultado no
    // apunta a ningún sitio, que es lo único que importa aquí.
    expect(nombreDeFichero('../../etc/passwd', '.zip')).toBe('etcpasswd.zip');
    expect(nombreDeFichero('C:\\Windows\\algo', '.zip')).toBe('CWindowsalgo.zip');
    expect(nombreDeFichero('informe*final?', '.xmi')).toBe('informefinal.xmi');
  });

  it('quita los caracteres de control', () => {
    const conSalto = ['pedido', 'roto'].join('\n');
    expect(nombreDeFichero(conSalto, '.xmi')).toBe('pedidoroto.xmi');
    expect(nombreDeFichero(`nulo${String.fromCharCode(0)}`, '.xmi')).toBe('nulo.xmi');
  });

  it('no deja un nombre oculto ni uno que Windows rechace', () => {
    expect(nombreDeFichero('.oculto', '.zip')).toBe('oculto.zip');
    expect(nombreDeFichero('acaba en punto...', '.zip')).toBe('acaba en punto.zip');
    expect(nombreDeFichero('  espacios  ', '.zip')).toBe('espacios.zip');
  });

  it('un nombre que se queda en nada tiene un nombre de todas formas', () => {
    // Un proyecto llamado «///» existe, y la alternativa a esto es un fichero
    // que se llama solo `.zip` y que en unix está oculto.
    expect(nombreDeFichero('///', '.zip')).toBe('diagrama.zip');
    expect(nombreDeFichero('', '.xmi')).toBe('diagrama.xmi');
  });

  it('recorta el nombre larguísimo sin dejar la extensión fuera', () => {
    const nombre = nombreDeFichero('x'.repeat(400), '.zip');
    expect(nombre).toHaveLength(124);
    expect(nombre.endsWith('.zip')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Base64 y troceado                                                           */
/* -------------------------------------------------------------------------- */

describe('aBase64', () => {
  it('coincide con la codificación de referencia', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(aBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('cruza varios bloques sin meter relleno en medio', () => {
    // Más de dos bloques de 32760, y con un resto que no cae en el límite: si el
    // bloque no fuese múltiplo de 3 aparecería un `=` a mitad de la cadena y el
    // fichero llegaría corrupto sin que nada avisara.
    const bytes = new Uint8Array(32760 * 2 + 1234);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) % 256;
    const codificado = aBase64(bytes);
    expect(codificado).toBe(Buffer.from(bytes).toString('base64'));
    expect(codificado.slice(0, -2).includes('=')).toBe(false);
  });

  it('un fichero vacío da una cadena vacía', () => {
    expect(aBase64(new Uint8Array(0))).toBe('');
  });
});

describe('trocear', () => {
  it('parte en trozos del tamaño pedido y deja el resto en el último', () => {
    expect(trocear('abcdefg', 3)).toEqual(['abc', 'def', 'g']);
    expect(trocear('abcdef', 3)).toEqual(['abc', 'def']);
  });

  it('un texto vacío sigue siendo un trozo', () => {
    // Sin esto no se mandaría ningún mensaje y el otro lado esperaría para
    // siempre unos trozos que nunca llegan.
    expect(trocear('', 3)).toEqual(['']);
  });

  it('un tamaño imposible se rechaza en vez de colgarse', () => {
    expect(() => trocear('abc', 0)).toThrow(/positivo/);
  });
});

describe('mensajesDeDescarga', () => {
  it('anuncia cuántos trozos vienen y los numera desde cero sin saltos', () => {
    const msgs = mensajesDeDescarga('d1', 'a.zip', 'application/zip', 'abcdefgh', 3);
    expect(msgs[0]).toEqual({
      tipo: 'inicio',
      id: 'd1',
      nombre: 'a.zip',
      mime: 'application/zip',
      trozos: 3,
    });
    expect(msgs.slice(1).map((m) => (m as { indice: number }).indice)).toEqual([0, 1, 2]);
  });

  it('los trozos concatenados reconstruyen exactamente lo que se mandó', () => {
    const base64 = aBase64(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    const msgs = mensajesDeDescarga('d1', 'a.zip', 'application/zip', base64, 4);
    const unido = msgs
      .filter((m) => m.tipo === 'trozo')
      .map((m) => (m as { datos: string }).datos)
      .join('');
    expect(unido).toBe(base64);
  });
});

/* -------------------------------------------------------------------------- */
/* El camino del navegador                                                     */
/* -------------------------------------------------------------------------- */

describe('sin puente: el navegador', () => {
  it('no hay descarga nativa disponible', () => {
    expect(descargaNativaDisponible()).toBe(false);
  });

  it('pincha un enlace con el nombre pedido y revoca la URL', async () => {
    const donde = await descargar('diagrama.xmi', 'application/xml', '<xmi/>');
    expect(creados).toHaveLength(1);
    expect(creados[0]?.download).toBe('diagrama.xmi');
    // Sin revocar, el fichero entero se queda en memoria hasta recargar.
    expect(revocadas).toEqual(['blob:falsa']);
    // El navegador decide la carpeta y no lo cuenta: no hay nada que enseñar.
    expect(donde).toBe('');
  });
});

/* -------------------------------------------------------------------------- */
/* El camino del puente                                                        */
/* -------------------------------------------------------------------------- */

describe('con puente: la app', () => {
  it('se detecta y no se toca el DOM', async () => {
    conPuente();
    expect(descargaNativaDisponible()).toBe(true);

    const promesa = descargar('a.xmi', 'application/xml', '<xmi/>');
    responder({ tipo: 'listo', id: idEnVuelo(), donde: '/almacen/a.xmi' });

    await expect(promesa).resolves.toBe('/almacen/a.xmi');
    // El enlace invisible no llegó a crearse: en el WebView no habría hecho nada
    // y además habría dejado la promesa resuelta dos veces.
    expect(creados).toHaveLength(0);
  });

  it('los bytes llegan enteros al otro lado', async () => {
    conPuente();
    const original = new Uint8Array(5000);
    for (let i = 0; i < original.length; i++) original[i] = (i * 17) % 256;

    const promesa = descargar('p.zip', 'application/zip', original);
    responder({ tipo: 'listo', id: idEnVuelo(), donde: '/tmp/p.zip' });
    await promesa;

    const msgs = mensajes();
    const inicio = msgs[0] as { trozos: number; nombre: string; mime: string };
    const trozos = msgs.slice(1) as Array<{ datos: string }>;
    expect(trozos).toHaveLength(inicio.trozos);
    expect(inicio.nombre).toBe('p.zip');
    expect(inicio.mime).toBe('application/zip');

    const recibido = new Uint8Array(Buffer.from(trozos.map((t) => t.datos).join(''), 'base64'));
    expect(recibido).toEqual(original);
  });

  it('el texto viaja en UTF-8, que es lo que declara el XMI', async () => {
    conPuente();
    const promesa = descargar('a.xmi', 'application/xml', 'Álex');
    responder({ tipo: 'listo', id: idEnVuelo(), donde: '/tmp' });
    await promesa;

    const datos = (mensajes()[1] as { datos: string }).datos;
    expect(Buffer.from(datos, 'base64').toString('utf8')).toBe('Álex');
  });

  it('un fichero vacío manda un trozo, no cero', async () => {
    conPuente();
    const promesa = descargar('vacio.xmi', 'application/xml', '');
    const msgs = mensajes();
    expect((msgs[0] as { trozos: number }).trozos).toBe(1);
    expect(msgs).toHaveLength(2);

    responder({ tipo: 'listo', id: idEnVuelo(), donde: '/tmp' });
    await promesa;
  });

  it('el fallo del sistema llega como excepción y no como silencio', async () => {
    conPuente();
    const promesa = descargar('a.zip', 'application/zip', 'x');
    responder({ tipo: 'error', id: idEnVuelo(), motivo: 'No hay espacio en el teléfono.' });
    await expect(promesa).rejects.toThrow('No hay espacio en el teléfono.');
  });

  it('un error sin motivo sigue siendo un error con algo que leer', async () => {
    conPuente();
    const promesa = descargar('a.zip', 'application/zip', 'x');
    responder({ tipo: 'error', id: idEnVuelo() });
    await expect(promesa).rejects.toThrow(/No se pudo guardar/);
  });

  it('lo que pase del tope se rechaza antes de intentar mandarlo', async () => {
    conPuente();
    // El fusible está para que el teléfono no muera sin decir por qué. Se
    // comprueba con la longitud, no reservando 64 MB de verdad.
    const enorme = { length: LIMITE_BYTES + 1 } as unknown as Uint8Array;
    await expect(descargar('a.zip', 'application/zip', enorme)).rejects.toThrow(/máximo/);
    expect(enviados).toHaveLength(0);
  });

  it('una respuesta a destiempo no rompe nada', async () => {
    conPuente();
    const promesa = descargar('a.zip', 'application/zip', 'x');
    const id = idEnVuelo();
    responder({ tipo: 'listo', id, donde: '/tmp' });
    await promesa;

    // La misma respuesta otra vez, y una de una descarga que ya no existe. En
    // los dos casos la promesa ya se resolvió: volver a tocarla sería resolver
    // dos veces, y una respuesta huérfana no debe lanzar dentro del receptor
    // porque ahí no hay nadie que capture nada.
    expect(() => responder({ tipo: 'listo', id, donde: '/tmp' })).not.toThrow();
    expect(() => responder({ tipo: 'listo', id: 'inventado' })).not.toThrow();
  });

  it('una respuesta mal formada se ignora en vez de tumbar el receptor', async () => {
    conPuente();
    const promesa = descargar('a.zip', 'application/zip', 'x');
    expect(() => ventana.__descargaNativa?.('{esto no es json')).not.toThrow();
    expect(() => ventana.__descargaNativa?.('null')).not.toThrow();
    expect(() => responder({ tipo: 'listo' })).not.toThrow();

    // Y después de todo eso la descarga de verdad sigue pudiendo terminar.
    responder({ tipo: 'listo', id: idEnVuelo(), donde: '/tmp' });
    await expect(promesa).resolves.toBe('/tmp');
  });

  it('dos descargas a la vez no se confunden', async () => {
    conPuente();
    const uno = descargar('uno.zip', 'application/zip', 'a');
    const idUno = idEnVuelo();
    const dos = descargar('dos.zip', 'application/zip', 'b');
    const idDos = mensajes()
      .filter((m) => m.tipo === 'inicio')
      .map((m) => m.id as string)
      .find((id) => id !== idUno);

    expect(idDos).toBeDefined();
    responder({ tipo: 'listo', id: idDos as string, donde: '/dos' });
    responder({ tipo: 'error', id: idUno, motivo: 'cancelado' });

    await expect(dos).resolves.toBe('/dos');
    await expect(uno).rejects.toThrow('cancelado');
  });
});

describe('avisoDeDescarga', () => {
  it('dice dónde quedó cuando se sabe, y no se inventa nada cuando no', () => {
    expect(avisoDeDescarga('a.zip', '/almacen/a.zip')).toBe('a.zip guardado en /almacen/a.zip');
    expect(avisoDeDescarga('a.zip', '')).toBe('a.zip descargado.');
  });
});
