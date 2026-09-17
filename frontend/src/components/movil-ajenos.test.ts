import { describe, expect, it } from 'vitest';
import type { EntradaLeida } from '@app/shared';
import {
  DESDE_EL_PRINCIPIO,
  autoresDe,
  cambiosDeOtros,
  nombrarAutores,
  resumirCambios,
  suerteDeLaAbierta,
  textoDeLaSuerte,
} from './movil-ajenos';

/*
  Las entradas se fabrican con lo mínimo que leen las funciones y el resto por
  defecto. Escribirlas enteras a mano —catorce campos, la mayoría irrelevantes—
  escondería cuál es el dato que cada prueba está probando de verdad.
*/
function entrada(parcial: Partial<EntradaLeida> & { id: string }): EntradaLeida {
  return {
    autorId: 'u-ana',
    autorNombre: 'Ana',
    momento: '2026-01-01T10:00:00.000Z',
    origen: 'manual',
    resumen: 'Hizo algo',
    detalles: [],
    clases: [],
    relaciones: [],
    creadas: [],
    relojDudoso: false,
    ...parcial,
  };
}

const YO = 'u-yo';

describe('qué han hecho los demás', () => {
  it('la primera vez no anuncia el historial entero', () => {
    /*
      Abrir un proyecto con trabajo acumulado no es una novedad. Si esto
      devolviera las entradas, lo primero que se vería al entrar sería un cartel
      de «doscientos cambios» tapando el diagrama.
    */
    const historial = [entrada({ id: 'a' }), entrada({ id: 'b' }), entrada({ id: 'c' })];
    expect(cambiosDeOtros(historial, YO, null).entradas).toEqual([]);
  });

  it('la marca avanza hasta el final aunque no haya nada que anunciar', () => {
    const historial = [entrada({ id: 'a' }), entrada({ id: 'b' })];
    expect(cambiosDeOtros(historial, YO, null).ultima).toBe('b');
  });

  it('devuelve solo lo posterior a la marca', () => {
    const historial = [entrada({ id: 'a' }), entrada({ id: 'b' }), entrada({ id: 'c' })];
    const { entradas } = cambiosDeOtros(historial, YO, 'a');
    expect(entradas.map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('no me cuenta mis propios cambios', () => {
    /*
      El motivo de que esto no se resuelva comparando diagramas. Una comparación
      no distingue quién, y anunciarle a alguien lo que acaba de escribir es la
      forma más rápida de que deje de leer los avisos.
    */
    const historial = [
      entrada({ id: 'a' }),
      entrada({ id: 'b', autorId: YO, autorNombre: 'Yo' }),
      entrada({ id: 'c' }),
    ];
    const { entradas } = cambiosDeOtros(historial, YO, 'a');
    expect(entradas.map((e) => e.id)).toEqual(['c']);
  });

  it('un cambio mío al final avanza la marca aunque no se anuncie nada', () => {
    /*
      Si la marca se sacara de las entradas devueltas se quedaría en 'a', y la
      entrada ajena 'b' volvería a contarse como nueva en la siguiente vuelta:
      el mismo aviso, una y otra vez, sin que nadie haya tocado nada.
    */
    const historial = [
      entrada({ id: 'a' }),
      entrada({ id: 'b' }),
      entrada({ id: 'c', autorId: YO, autorNombre: 'Yo' }),
    ];
    const novedades = cambiosDeOtros(historial, YO, 'a');
    expect(novedades.entradas.map((e) => e.id)).toEqual(['b']);
    expect(novedades.ultima).toBe('c');
  });

  it('una marca que ya no está en el historial se trata como la primera vez', () => {
    // La entrada se cayó por el tope de MAXIMO_ENTRADAS. Callar es mejor que
    // anunciar de golpe todo lo que quedaba.
    const historial = [entrada({ id: 'b' }), entrada({ id: 'c' })];
    expect(cambiosDeOtros(historial, YO, 'a-que-ya-no-existe').entradas).toEqual([]);
  });

  it('un historial vacío no tiene marca ni novedades', () => {
    expect(cambiosDeOtros([], YO, null)).toEqual({ entradas: [], ultima: null });
  });

  it('empezar con el historial vacío hace que el primer cambio sí sea novedad', () => {
    /*
      El caso de dos personas empezando un diagrama juntas, que es cuando más se
      mira quién hace qué. Con la marca en `null` este aviso no saldría nunca:
      no había última entrada que marcar. Por eso `null` y «vacío» son dos cosas.
    */
    const historial = [entrada({ id: 'a', resumen: 'Creó la clase Pedido' })];
    const { entradas } = cambiosDeOtros(historial, YO, DESDE_EL_PRINCIPIO);
    expect(entradas.map((e) => e.id)).toEqual(['a']);
  });

  it('desde el principio también se descarta lo mío', () => {
    const historial = [
      entrada({ id: 'a', autorId: YO, autorNombre: 'Yo' }),
      entrada({ id: 'b' }),
    ];
    const { entradas } = cambiosDeOtros(historial, YO, DESDE_EL_PRINCIPIO);
    expect(entradas.map((e) => e.id)).toEqual(['b']);
  });

  it('la cadena vacía no puede chocar con un identificador real', () => {
    // Si algún día los ids pudieran ser '', esta prueba lo delata antes de que
    // un proyecto entero se anuncie de golpe.
    const historial = [entrada({ id: 'a' }), entrada({ id: 'b' })];
    expect(historial.every((e) => e.id !== DESDE_EL_PRINCIPIO)).toBe(true);
  });

  it('no se salta entradas con la fecha desordenada', () => {
    /*
      El motivo de marcar por identificador y no por hora. La entrada 'c' la
      escribió alguien que estuvo editando sin conexión, y su fecha es anterior
      a la de 'b'. Con un corte por hora no se anunciaría nunca; con el orden del
      CRDT se anuncia como lo que es, lo último que ha llegado.
    */
    const historial = [
      entrada({ id: 'a', momento: '2026-01-02T10:00:00.000Z' }),
      entrada({ id: 'b', momento: '2026-01-02T11:00:00.000Z' }),
      entrada({ id: 'c', momento: '2025-12-30T09:00:00.000Z', relojDudoso: true }),
    ];
    const { entradas } = cambiosDeOtros(historial, YO, 'a');
    expect(entradas.map((e) => e.id)).toEqual(['b', 'c']);
  });
});

describe('cómo se nombra a quien lo hizo', () => {
  it('no repite a quien firma varias entradas', () => {
    const entradas = [
      entrada({ id: 'a', autorNombre: 'Ana' }),
      entrada({ id: 'b', autorNombre: 'Ana' }),
      entrada({ id: 'c', autorNombre: 'Luis' }),
    ];
    expect(autoresDe(entradas)).toEqual(['Ana', 'Luis']);
  });

  it('respeta el orden del historial y no el alfabético', () => {
    // Quien acaba de tocar algo va primero: es a quien se le va a preguntar.
    const entradas = [entrada({ id: 'a', autorNombre: 'Luis' }), entrada({ id: 'b' })];
    expect(autoresDe(entradas)).toEqual(['Luis', 'Ana']);
  });

  it('uno, dos y muchos', () => {
    expect(nombrarAutores(['Ana'])).toBe('Ana');
    expect(nombrarAutores(['Ana', 'Luis'])).toBe('Ana y Luis');
    expect(nombrarAutores(['Ana', 'Luis', 'Marta'])).toBe('Ana, Luis y 1 más');
    expect(nombrarAutores(['Ana', 'Luis', 'Marta', 'Diego'])).toBe('Ana, Luis y 2 más');
  });

  it('la lista vacía no revienta', () => {
    expect(nombrarAutores([])).toBe('');
  });
});

describe('la línea del aviso', () => {
  it('sin novedades no hay franja, y eso es null y no una cadena vacía', () => {
    // Con cadena vacía el componente pintaría la franja en blanco sobre el
    // diagrama, que ocupa el mismo sitio y no dice nada.
    expect(resumirCambios([])).toBeNull();
  });

  it('un solo cambio reutiliza el resumen del historial', () => {
    /*
      No se redacta una frase nueva aquí. Al pulsar el aviso se abre la lista y
      ahí está esta misma línea: que coincidan es lo que hace entender que son la
      misma cosa y no dos sucesos distintos.
    */
    const entradas = [entrada({ id: 'a', resumen: 'Creó la clase Pedido' })];
    expect(resumirCambios(entradas)).toBe('Ana: Creó la clase Pedido');
  });

  it('a partir de dos se cuenta en vez de enumerar', () => {
    const entradas = [
      entrada({ id: 'a', resumen: 'Creó la clase Pedido' }),
      entrada({ id: 'b', resumen: 'Añadió el atributo total' }),
    ];
    expect(resumirCambios(entradas)).toBe('2 cambios de Ana');
  });

  it('cuenta las personas y no solo los cambios', () => {
    const entradas = [
      entrada({ id: 'a' }),
      entrada({ id: 'b', autorNombre: 'Luis' }),
      entrada({ id: 'c' }),
    ];
    expect(resumirCambios(entradas)).toBe('3 cambios de Ana y Luis');
  });
});

describe('la clase que hay abierta en la hoja', () => {
  it('sin ficha abierta no pasa nada, que es el estado normal', () => {
    expect(suerteDeLaAbierta(null, true, false, [entrada({ id: 'a', clases: ['c1'] })])).toEqual({
      suerte: 'intacta',
      porQuien: '',
    });
  });

  it('borrada es el peor caso y gana a los demás', () => {
    /*
      El fallo que justifica el módulo: la hoja sigue abierta aceptando texto
      sobre una clase que ya no existe. Se pinta un solo cartel, así que tiene
      que ser este aunque además la hayan movido y tocado.
    */
    const entradas = [entrada({ id: 'a', clases: ['c1'] })];
    expect(suerteDeLaAbierta('c1', false, true, entradas)).toEqual({
      suerte: 'borrada',
      porQuien: 'Ana',
    });
  });

  it('cambiada cuando la tocaron pero sigue viva', () => {
    const entradas = [entrada({ id: 'a', clases: ['c1'] })];
    expect(suerteDeLaAbierta('c1', true, false, entradas).suerte).toBe('cambiada');
  });

  it('un cambio en otra clase no toca la ficha abierta', () => {
    const entradas = [entrada({ id: 'a', clases: ['c2'] })];
    expect(suerteDeLaAbierta('c1', true, false, entradas).suerte).toBe('intacta');
  });

  it('movida cuando solo ha cambiado de sitio', () => {
    /*
      El historial no registra `moveClass` —lo excluye a propósito en su
      SIN_INTERES—, así que este caso llega por la posición y no por las
      entradas. Sin este camino, mover sería invisible.
    */
    expect(suerteDeLaAbierta('c1', true, true, []).suerte).toBe('movida');
  });

  it('un movimiento ajeno no se atribuye a nadie porque no consta quién', () => {
    // Decir «Ana» aquí sería inventárselo: no hay entrada de historial detrás.
    expect(suerteDeLaAbierta('c1', true, true, []).porQuien).toBe('');
  });

  it('cambiada gana a movida', () => {
    const entradas = [entrada({ id: 'a', clases: ['c1'] })];
    expect(suerteDeLaAbierta('c1', true, true, entradas).suerte).toBe('cambiada');
  });

  it('nombra a los dos si la tocaron dos', () => {
    const entradas = [
      entrada({ id: 'a', clases: ['c1'] }),
      entrada({ id: 'b', clases: ['c1'], autorNombre: 'Luis' }),
    ];
    expect(suerteDeLaAbierta('c1', true, false, entradas).porQuien).toBe('Ana y Luis');
  });
});

describe('cómo se cuenta', () => {
  it('intacta no dice nada', () => {
    expect(textoDeLaSuerte({ suerte: 'intacta', porQuien: '' })).toBeNull();
  });

  it('lleva el nombre entre paréntesis cuando se sabe', () => {
    expect(textoDeLaSuerte({ suerte: 'borrada', porQuien: 'Ana' })).toBe(
      'Esta clase se ha borrado mientras estaba abierta (Ana).',
    );
  });

  it('sin nombre queda en impersonal en vez de decir «alguien»', () => {
    // «Alguien» afirma que hay una persona detrás; lo único que consta es que la
    // caja está en otro sitio.
    expect(textoDeLaSuerte({ suerte: 'cambiada', porQuien: '' })).toBe(
      'Esta clase ha cambiado mientras estaba abierta.',
    );
  });

  it('el movimiento no menciona la ficha porque no la afecta', () => {
    expect(textoDeLaSuerte({ suerte: 'movida', porQuien: '' })).toBe(
      'Esta clase ha cambiado de sitio en el lienzo.',
    );
  });
});
