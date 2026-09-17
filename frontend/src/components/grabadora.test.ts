import { describe, expect, it } from 'vitest';
import { MAXIMA_DURACION_MS, TIPOS_AUDIO } from '@app/shared';
import {
  AVISO_FINAL_MS,
  GRABADORA_INACTIVA,
  MINIMA_DURACION_MS,
  comprobarGrabacion,
  explicarFalloDeMicrofono,
  reducir,
  restanteMs,
  seAcabaElTiempo,
  tipoPreferido,
} from './grabadora';

/**
 * La grabadora, sin micrófono.
 *
 * Lo que se prueba aquí son las transiciones que no se ven en una demo pero se
 * pagan en uso real: la que corta sola a los noventa segundos —sin ella la
 * grabación se sube entera para que el servidor la rechace—, la que descarta el
 * toque accidental y la que impide que dos grabaciones se peleen por el único
 * micrófono que hay.
 */

/** Un estado de grabación en marcha, para no repetirlo en cada prueba. */
function grabando(transcurridoMs: number) {
  return reducir({ ...GRABADORA_INACTIVA, fase: 'grabando' as const }, {
    tipo: 'tictac',
    transcurridoMs,
  });
}

describe('reducir', () => {
  it('empezar arranca de cero y borra el error anterior', () => {
    const conError = reducir(GRABADORA_INACTIVA, { tipo: 'fallo', motivo: 'vaya' });
    const nuevo = reducir(conError, { tipo: 'empezar' });
    expect(nuevo.fase).toBe('grabando');
    expect(nuevo.transcurridoMs).toBe(0);
    expect(nuevo.error).toBeNull();
  });

  it('empezar mientras se envía no hace nada', () => {
    // El micrófono es uno. Dos grabaciones a la vez dejarían una sin dueño.
    const enviando = reducir(grabando(2_000), { tipo: 'soltar' });
    expect(enviando.fase).toBe('enviando');
    expect(reducir(enviando, { tipo: 'empezar' })).toBe(enviando);
  });

  it('el reloj solo corre mientras se graba', () => {
    const quieto = reducir(GRABADORA_INACTIVA, { tipo: 'tictac', transcurridoMs: 3_000 });
    expect(quieto).toBe(GRABADORA_INACTIVA);
  });

  it('pasado el tope corta sola y manda enviar lo grabado', () => {
    // El caso que justifica la máquina de estados entera: el servidor rechaza
    // lo que pase del tope, así que sin este corte se habla minuto y medio
    // para nada.
    const cortada = grabando(MAXIMA_DURACION_MS + 500);
    expect(cortada.fase).toBe('enviando');
    expect(cortada.transcurridoMs).toBe(MAXIMA_DURACION_MS);
    expect(cortada.hayQueEnviar).toBe(true);
  });

  it('soltar antes del mínimo avisa y no envía nada', () => {
    const corta = reducir(grabando(MINIMA_DURACION_MS - 1), { tipo: 'soltar' });
    expect(corta.fase).toBe('inactiva');
    expect(corta.hayQueEnviar).toBe(false);
    expect(corta.error).toBe('La nota de voz es demasiado corta.');
  });

  it('soltar pasado el mínimo envía', () => {
    const buena = reducir(grabando(MINIMA_DURACION_MS), { tipo: 'soltar' });
    expect(buena.fase).toBe('enviando');
    expect(buena.hayQueEnviar).toBe(true);
    expect(buena.error).toBeNull();
  });

  it('el aviso de enviar no sobrevive a la acción siguiente', () => {
    // Es un aviso de una sola vez: si durase, el componente subiría dos veces
    // la misma nota.
    const enviando = reducir(grabando(2_000), { tipo: 'soltar' });
    expect(reducir(enviando, { tipo: 'enviada' }).hayQueEnviar).toBe(false);
  });

  it('soltar dos veces no envía dos veces', () => {
    const enviando = reducir(grabando(2_000), { tipo: 'soltar' });
    expect(reducir(enviando, { tipo: 'soltar' })).toBe(enviando);
  });

  it('cancelar vuelve al principio también desde el error', () => {
    // Es lo que hace el botón de cerrar: un estado del que no se sale es un
    // panel bloqueado.
    const roto = reducir(GRABADORA_INACTIVA, { tipo: 'fallo', motivo: 'sin micrófono' });
    expect(roto.fase).toBe('error');
    expect(reducir(roto, { tipo: 'cancelar' })).toEqual(GRABADORA_INACTIVA);
  });

  it('cancelar a media grabación no deja nada que enviar', () => {
    expect(reducir(grabando(20_000), { tipo: 'cancelar' })).toEqual(GRABADORA_INACTIVA);
  });

  it('el fallo se cuenta con su motivo a la vista', () => {
    const roto = reducir(grabando(5_000), { tipo: 'fallo', motivo: 'se cayó la red' });
    expect(roto.error).toBe('se cayó la red');
    expect(roto.hayQueEnviar).toBe(false);
  });
});

describe('la cuenta atrás', () => {
  it('el aviso llega antes del corte, no con él', () => {
    expect(seAcabaElTiempo(MAXIMA_DURACION_MS - AVISO_FINAL_MS - 1)).toBe(false);
    expect(seAcabaElTiempo(MAXIMA_DURACION_MS - AVISO_FINAL_MS)).toBe(true);
  });

  it('lo que queda no baja de cero', () => {
    expect(restanteMs(0)).toBe(MAXIMA_DURACION_MS);
    expect(restanteMs(MAXIMA_DURACION_MS + 5_000)).toBe(0);
  });
});

describe('tipoPreferido', () => {
  it('elige Opus con el códec escrito, que es lo que hace que Chrome lo use', () => {
    expect(tipoPreferido(() => true)).toBe('audio/webm;codecs=opus');
  });

  it('cae al formato de Safari cuando es el único', () => {
    expect(tipoPreferido((tipo) => tipo === 'audio/mp4')).toBe('audio/mp4');
  });

  it('sin ninguno admitido devuelve nada en vez de dejar elegir al navegador', () => {
    // `null` significa «no se ofrece grabar». Dejar que MediaRecorder escoja
    // acabaría en un formato que el servidor rechaza cuando ya se habló.
    expect(tipoPreferido(() => false)).toBeNull();
  });

  it('todos los candidatos son formatos que el servidor admite', () => {
    const elegido = tipoPreferido(() => true) ?? '';
    expect(TIPOS_AUDIO).toContain(elegido.split(';')[0]);
  });
});

describe('explicarFalloDeMicrofono', () => {
  function conNombre(nombre: string): Error {
    const error = new Error('vaya');
    error.name = nombre;
    return error;
  }

  it('el permiso denegado manda al candado, no a reintentar', () => {
    expect(explicarFalloDeMicrofono(conNombre('NotAllowedError'))).toContain('candado');
    expect(explicarFalloDeMicrofono(conNombre('SecurityError'))).toContain('candado');
  });

  it('sin micrófono conectado se dice eso y no otra cosa', () => {
    // Distinguirlo importa: cada fallo se arregla en un sitio distinto, y el
    // mensaje genérico manda a mirar donde no es.
    expect(explicarFalloDeMicrofono(conNombre('NotFoundError'))).toContain('micrófono conectado');
    expect(explicarFalloDeMicrofono(conNombre('DevicesNotFoundError'))).toContain(
      'micrófono conectado',
    );
  });

  it('el micrófono ocupado por otra aplicación se nombra', () => {
    expect(explicarFalloDeMicrofono(conNombre('NotReadableError'))).toContain('otra aplicación');
  });

  it('lo que no es un Error tampoco rompe', () => {
    expect(explicarFalloDeMicrofono('vaya')).toBeTruthy();
    expect(explicarFalloDeMicrofono(null)).toBeTruthy();
  });
});

describe('comprobarGrabacion', () => {
  const MAXIMO = 1024 * 1024;

  it('una grabación normal pasa', () => {
    expect(comprobarGrabacion(20_000, 'audio/webm;codecs=opus', MAXIMO)).toEqual({ ok: true });
  });

  it('cero bytes no se sube', () => {
    const resultado = comprobarGrabacion(0, 'audio/webm', MAXIMO);
    expect(resultado.ok).toBe(false);
  });

  it('lo que pasa del máximo se corta aquí, no tras subirlo', () => {
    // Subir un megabyte desde un móvil para que lo rechacen es un minuto
    // perdido con la barra de progreso llena.
    const resultado = comprobarGrabacion(MAXIMO + 1, 'audio/webm', MAXIMO);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain('kB');
  });

  it('un formato que el servidor no admite se detecta antes de subirlo', () => {
    const resultado = comprobarGrabacion(20_000, 'audio/wav', MAXIMO);
    expect(resultado.ok).toBe(false);
  });

  it('el tipo se reduce con la misma regla que el servidor', () => {
    // Con parámetros y mayúsculas, que es como los escriben los navegadores.
    expect(comprobarGrabacion(20_000, 'AUDIO/WEBM; codecs=opus', MAXIMO)).toEqual({ ok: true });
  });
});
