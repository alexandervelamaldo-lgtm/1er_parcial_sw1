import { describe, expect, it } from 'vitest';
import {
  MAXIMO_TEXTO,
  MensajeSchema,
  TIPOS_AUDIO,
  extensionDeAudio,
  normalizarTexto,
  normalizarTipoAudio,
  ordenarHilo,
  retirar,
  type Mensaje,
} from './mensaje.js';

function mensaje(parcial: Partial<Mensaje> = {}): Mensaje {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    proyectoId: 'p1',
    autorId: 'u1',
    secuencia: 1,
    version: 1,
    creadoEn: '2026-09-15T10:00:00.000Z',
    tipo: 'texto',
    texto: 'hola',
    audio: null,
    retirado: false,
    ...parcial,
  };
}

describe('normalizarTipoAudio', () => {
  it('acepta lo que manda un navegador real, con su parámetro de códec', () => {
    // Es el caso que importa: comparar con igualdad estricta rechazaría todas
    // las grabaciones, porque ningún navegador manda el tipo base a secas.
    expect(normalizarTipoAudio('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizarTipoAudio('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(normalizarTipoAudio('audio/mp4')).toBe('audio/mp4');
  });

  it('no distingue mayúsculas ni espacios de más', () => {
    expect(normalizarTipoAudio('  AUDIO/WebM ; codecs=opus')).toBe('audio/webm');
  });

  it('devuelve un literal nuestro, no la cadena del cliente', () => {
    const resultado = normalizarTipoAudio('audio/webm;codecs=opus');
    expect(TIPOS_AUDIO).toContain(resultado);
  });

  it('rechaza lo que no es audio', () => {
    expect(normalizarTipoAudio('text/html')).toBeNull();
    expect(normalizarTipoAudio('application/javascript')).toBeNull();
    expect(normalizarTipoAudio('')).toBeNull();
  });

  it('rechaza un intento de inyectar una cabecera', () => {
    // El valor acaba en `Content-Type`. Con un salto de línea dentro, guardarlo
    // tal cual permitiría añadir cabeceras a la respuesta de la descarga.
    expect(normalizarTipoAudio('audio/webm\r\nX-Inyectada: si')).toBeNull();
    expect(normalizarTipoAudio('audio/webm\nSet-Cookie: a=b')).toBeNull();
  });

  it('todos los tipos aceptados tienen extensión', () => {
    for (const tipo of TIPOS_AUDIO) {
      expect(extensionDeAudio(tipo)).toMatch(/^[a-z0-9]+$/);
    }
  });
});

describe('normalizarTexto', () => {
  it('recorta los extremos y unifica los finales de línea', () => {
    expect(normalizarTexto('  hola\r\nmundo  ')).toEqual({ ok: true, texto: 'hola\nmundo' });
  });

  it('conserva los saltos de línea interiores', () => {
    const resultado = normalizarTexto('uno\ndos\ntres');
    expect(resultado).toEqual({ ok: true, texto: 'uno\ndos\ntres' });
  });

  it('rechaza el mensaje vacío y el que solo tiene espacios', () => {
    expect(normalizarTexto('').ok).toBe(false);
    expect(normalizarTexto('   \n\t  ').ok).toBe(false);
  });

  it('mide el límite sobre el texto ya recortado', () => {
    // Justo en el tope, con relleno alrededor: si se midiera antes de recortar,
    // este mensaje legítimo se rechazaría.
    const justo = '  ' + 'a'.repeat(MAXIMO_TEXTO) + '  ';
    expect(normalizarTexto(justo).ok).toBe(true);
    expect(normalizarTexto('a'.repeat(MAXIMO_TEXTO + 1)).ok).toBe(false);
  });
});

describe('ordenarHilo', () => {
  it('ordena por secuencia, no por fecha', () => {
    // Dos mensajes con la misma marca de tiempo: la fecha empata y el contador
    // no. Es el caso que hace que ordenar por `creadoEn` sea indeterminista.
    const a = mensaje({ id: '1', secuencia: 2, creadoEn: '2026-09-15T10:00:00.000Z' });
    const b = mensaje({ id: '2', secuencia: 1, creadoEn: '2026-09-15T10:00:00.000Z' });

    expect(ordenarHilo([a, b]).map((m) => m.secuencia)).toEqual([1, 2]);
  });

  it('no modifica el arreglo recibido', () => {
    const entrada = [mensaje({ secuencia: 2 }), mensaje({ secuencia: 1 })];
    ordenarHilo(entrada);
    expect(entrada.map((m) => m.secuencia)).toEqual([2, 1]);
  });
});

describe('retirar', () => {
  const original = mensaje({
    secuencia: 7,
    version: 7,
    tipo: 'voz',
    texto: '',
    audio: { tipo: 'audio/webm', bytes: 4096, duracionMs: 3000 },
  });
  const lapida = retirar(original, 12);

  it('deja el mensaje donde estaba en el hilo', () => {
    // Si `retirar` tocara `secuencia`, el mensaje saltaría al final del hilo
    // delante de quien lo estuviera leyendo.
    expect(lapida.secuencia).toBe(7);
  });

  it('avanza la versión para que el sondeo se entere', () => {
    // Sin esto, quien ya hubiera pasado del 7 nunca recibiría la retirada y
    // seguiría con la nota de voz reproducible en pantalla.
    expect(lapida.version).toBe(12);
    expect(lapida.version).toBeGreaterThan(original.version);
  });

  it('se lleva el contenido y los metadatos del audio', () => {
    expect(lapida.texto).toBe('');
    expect(lapida.audio).toBeNull();
    expect(lapida.retirado).toBe(true);
  });
});

describe('MensajeSchema', () => {
  it('acepta un mensaje de texto bien formado', () => {
    expect(MensajeSchema.safeParse(mensaje()).success).toBe(true);
  });

  it('rechaza un audio que supera el tope de bytes', () => {
    const gordo = mensaje({
      tipo: 'voz',
      texto: '',
      audio: { tipo: 'audio/webm', bytes: 10 * 1024 * 1024, duracionMs: 1000 },
    });
    expect(MensajeSchema.safeParse(gordo).success).toBe(false);
  });

  it('rechaza una secuencia de cero, que rompería el cursor del sondeo', () => {
    // El cursor arranca en 0 y pide «lo mayor que 0»: un mensaje con secuencia
    // 0 sería invisible para siempre.
    expect(MensajeSchema.safeParse(mensaje({ secuencia: 0 })).success).toBe(false);
  });

  it('admite un identificador de autor que no sea UUID', () => {
    // El proveedor de identidad externo numerará a su manera (decisión D8).
    expect(MensajeSchema.safeParse(mensaje({ autorId: 'architech|4821' })).success).toBe(true);
  });
});
