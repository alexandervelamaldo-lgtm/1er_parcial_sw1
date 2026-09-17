import { describe, expect, it } from 'vitest';
import type { MensajePublico } from '@app/shared';
import {
  ESPERA_DORMIDA_MS,
  ESPERA_MAXIMA_MS,
  ESPERA_OCULTA_MS,
  ESPERA_TIBIA_MS,
  ESPERA_VIVA_MS,
  agrupar,
  avanzarCursor,
  duracionLegible,
  etiquetaDeDia,
  fusionar,
  horaCorta,
  puedeRetirar,
  siguienteEspera,
} from './tablon';

/**
 * Lo que decide el tablón antes de dibujarse.
 *
 * Todo lo de aquí es una función pura, así que las pruebas son de entrada y
 * salida. Lo que se comprueba no es que el código haga lo que hace, sino los
 * tres casos que se rompen solos al tocarlo: la respuesta tardía que repone un
 * mensaje ya retirado, el bloque que se parte donde no debe y el sondeo que no
 * se calma nunca.
 */

/** Fecha base de las pruebas. La hora concreta no importa; el orden sí. */
const BASE = new Date('2026-09-15T10:00:00.000Z').getTime();

function mensaje(parcial: Partial<MensajePublico> & { secuencia: number }): MensajePublico {
  const { secuencia } = parcial;
  return {
    id: `m${String(secuencia)}`,
    proyectoId: 'p1',
    autorId: 'ana',
    autorNombre: 'Ana',
    version: secuencia,
    creadoEn: new Date(BASE + secuencia * 1000).toISOString(),
    tipo: 'texto',
    texto: `mensaje ${String(secuencia)}`,
    audio: null,
    retirado: false,
    ...parcial,
  };
}

describe('fusionar', () => {
  it('añade lo nuevo y deja el hilo ordenado por secuencia', () => {
    const hilo = fusionar([mensaje({ secuencia: 1 })], [mensaje({ secuencia: 3 }), mensaje({ secuencia: 2 })]);
    expect(hilo.map((m) => m.secuencia)).toEqual([1, 2, 3]);
  });

  it('no duplica un mensaje que llega dos veces', () => {
    // Pasa siempre: se publica, se pinta con la respuesta del POST, y el sondeo
    // que ya estaba en vuelo lo trae otra vez.
    const uno = mensaje({ secuencia: 1 });
    expect(fusionar([uno], [uno])).toHaveLength(1);
  });

  it('una respuesta tardía no resucita un mensaje ya retirado', () => {
    // El caso que justifica comparar versiones en vez de quedarse con lo
    // último que llega. Sin esto, la nota de voz retirada vuelve a la pantalla
    // —y con su botón de reproducir— porque una petición lenta contestó
    // después con la copia de antes.
    const vivo = mensaje({ secuencia: 4, version: 4 });
    const lapida = { ...vivo, version: 9, retirado: true, texto: '', audio: null };

    const hilo = fusionar([lapida], [vivo]);
    expect(hilo[0]?.retirado).toBe(true);
    expect(hilo[0]?.version).toBe(9);
  });

  it('la retirada sí sustituye al mensaje que ya estaba', () => {
    const vivo = mensaje({ secuencia: 4, version: 4 });
    const lapida = { ...vivo, version: 9, retirado: true, texto: '' };
    expect(fusionar([vivo], [lapida])[0]?.retirado).toBe(true);
  });

  it('el mensaje retirado se queda donde estaba en el hilo', () => {
    // Si el orden saliera de la versión, la lápida saltaría al final delante de
    // quien estuviera leyendo.
    const hilo = fusionar(
      [mensaje({ secuencia: 1 }), mensaje({ secuencia: 2 }), mensaje({ secuencia: 3 })],
      [{ ...mensaje({ secuencia: 1 }), version: 50, retirado: true, texto: '' }],
    );
    expect(hilo.map((m) => m.secuencia)).toEqual([1, 2, 3]);
    expect(hilo[0]?.retirado).toBe(true);
  });

  it('recorta por arriba para que una pestaña abierta todo el día no crezca sin fin', () => {
    const muchos = Array.from({ length: 10 }, (_, i) => mensaje({ secuencia: i + 1 }));
    const hilo = fusionar([], muchos, 4);
    expect(hilo.map((m) => m.secuencia)).toEqual([7, 8, 9, 10]);
  });
});

describe('avanzarCursor', () => {
  it('avanza con lo recibido', () => {
    expect(avanzarCursor(3, 7)).toBe(7);
  });

  it('nunca retrocede', () => {
    // Con dos peticiones en vuelo la vieja puede contestar la última; aceptar
    // su cursor obligaría a releer un tramo que ya estaba en pantalla.
    expect(avanzarCursor(7, 3)).toBe(7);
  });
});

describe('agrupar', () => {
  it('junta lo que una persona escribe seguido', () => {
    const bloques = agrupar([
      mensaje({ secuencia: 1 }),
      mensaje({ secuencia: 2 }),
      mensaje({ secuencia: 3 }),
    ]);
    expect(bloques).toHaveLength(1);
    expect(bloques[0]?.mensajes).toHaveLength(3);
  });

  it('corta al cambiar de autor', () => {
    const bloques = agrupar([
      mensaje({ secuencia: 1 }),
      mensaje({ secuencia: 2, autorId: 'beto', autorNombre: 'Beto' }),
    ]);
    expect(bloques.map((b) => b.autorId)).toEqual(['ana', 'beto']);
  });

  it('corta cuando pasan más de cinco minutos', () => {
    const bloques = agrupar([
      mensaje({ secuencia: 1 }),
      mensaje({ secuencia: 2, creadoEn: new Date(BASE + 10 * 60 * 1000).toISOString() }),
    ]);
    expect(bloques).toHaveLength(2);
  });

  it('corta al cambiar de día aunque hayan pasado dos minutos', () => {
    // Un mensaje a las 23:59 y otro a las 00:01 son de días distintos y el
    // separador de fecha tiene que caer entre ellos, no dentro de un bloque.
    const bloques = agrupar([
      mensaje({ secuencia: 1, creadoEn: new Date(2026, 8, 15, 23, 59).toISOString() }),
      mensaje({ secuencia: 2, creadoEn: new Date(2026, 8, 16, 0, 1).toISOString() }),
    ]);
    expect(bloques).toHaveLength(2);
    expect(bloques.map((b) => b.dia)).toEqual(['2026-09-15', '2026-09-16']);
  });

  it('un mensaje retirado no parte el bloque de quien lo escribió', () => {
    // Romper por él dejaría el nombre repetido a los dos lados de la lápida.
    const bloques = agrupar([
      mensaje({ secuencia: 1 }),
      { ...mensaje({ secuencia: 2 }), retirado: true, texto: '' },
      mensaje({ secuencia: 3 }),
    ]);
    expect(bloques).toHaveLength(1);
  });

  it('la clave del bloque es estable: sale del primer mensaje', () => {
    const bloques = agrupar([mensaje({ secuencia: 7 })]);
    expect(bloques[0]?.clave).toBe('m7');
  });

  it('un hilo vacío no produce bloques', () => {
    expect(agrupar([])).toEqual([]);
  });
});

describe('cadencia del sondeo', () => {
  it('con conversación en marcha pregunta cada pocos segundos', () => {
    expect(siguienteEspera({ vacios: 0, fallos: 0, visible: true })).toBe(ESPERA_VIVA_MS);
  });

  it('se va calmando cuando no pasa nada', () => {
    expect(siguienteEspera({ vacios: 10, fallos: 0, visible: true })).toBe(ESPERA_TIBIA_MS);
    expect(siguienteEspera({ vacios: 100, fallos: 0, visible: true })).toBe(ESPERA_DORMIDA_MS);
  });

  it('en segundo plano sondea de lejos, pero sondea', () => {
    // No se para del todo a propósito: al volver a la pestaña conviene que el
    // hilo esté casi al día en vez de cargando.
    expect(siguienteEspera({ vacios: 0, fallos: 0, visible: false })).toBe(ESPERA_OCULTA_MS);
  });

  it('con el servidor caído retrocede en vez de insistir', () => {
    const uno = siguienteEspera({ vacios: 0, fallos: 1, visible: true });
    const dos = siguienteEspera({ vacios: 0, fallos: 2, visible: true });
    expect(dos).toBeGreaterThan(uno);
    expect(siguienteEspera({ vacios: 0, fallos: 20, visible: true })).toBe(ESPERA_MAXIMA_MS);
  });

  it('un fallo no hace que una pestaña oculta pregunte más que visible', () => {
    expect(siguienteEspera({ vacios: 0, fallos: 3, visible: false })).toBeGreaterThanOrEqual(
      ESPERA_OCULTA_MS,
    );
  });
});

describe('lo que se lee en pantalla', () => {
  it('la duración se escribe como un reproductor', () => {
    expect(duracionLegible(0)).toBe('0:00');
    expect(duracionLegible(7_400)).toBe('0:07');
    expect(duracionLegible(83_000)).toBe('1:23');
  });

  it('una duración negativa no pinta un menos', () => {
    expect(duracionLegible(-5)).toBe('0:00');
  });

  it('la hora va con dos cifras', () => {
    expect(horaCorta(new Date(2026, 8, 15, 9, 4).toISOString())).toBe('09:04');
  });

  it('una fecha ilegible no rompe la fila', () => {
    // Llega del servidor, pero una fila que lanza deja la pantalla en blanco
    // entera: es preferible un hueco.
    expect(horaCorta('vaya')).toBe('');
  });

  it('los días recientes se nombran, no se fechan', () => {
    const hoy = new Date(2026, 8, 15);
    expect(etiquetaDeDia('2026-09-15', hoy)).toBe('Hoy');
    expect(etiquetaDeDia('2026-09-14', hoy)).toBe('Ayer');
    expect(etiquetaDeDia('2026-09-10', hoy)).toBe('10 de septiembre');
  });

  it('el año aparece solo cuando no es el de hoy', () => {
    const hoy = new Date(2026, 8, 15);
    expect(etiquetaDeDia('2025-12-30', hoy)).toBe('30 de diciembre de 2025');
  });
});

describe('puedeRetirar', () => {
  it('el autor puede', () => {
    expect(puedeRetirar(mensaje({ secuencia: 1 }), 'ana', 'viewer')).toBe(true);
  });

  it('un compañero no', () => {
    expect(puedeRetirar(mensaje({ secuencia: 1 }), 'beto', 'editor')).toBe(false);
  });

  it('el propietario sí, porque responde del proyecto', () => {
    expect(puedeRetirar(mensaje({ secuencia: 1 }), 'beto', 'owner')).toBe(true);
  });

  it('lo ya retirado no se retira otra vez', () => {
    const lapida = { ...mensaje({ secuencia: 1 }), retirado: true };
    expect(puedeRetirar(lapida, 'ana', 'owner')).toBe(false);
  });
});
