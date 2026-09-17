import { describe, expect, it } from 'vitest';
import {
  CLAVE_VISTO,
  PASOS,
  TOTAL_PASOS,
  VERSION_DEL_RECORRIDO,
  acotar,
  anterior,
  debeAbrirse,
  esUltimo,
  irA,
  marcarVisto,
  moverEnAsistente,
  progreso,
  siguiente,
  type AlmacenDeVisitas,
} from './asistente-dps';
import { NOMBRES_ICONO } from './iconos';

/**
 * Pruebas del recorrido de primer acceso.
 *
 * Dos mitades, y las dos existen por fallos que no se ven mirando la pantalla.
 *
 * La primera es la navegación: que «Siguiente» termine en vez de dar la vuelta,
 * que «Anterior» no se salga por abajo y que Escape cuente como visto. Con el
 * ratón y seis láminas todo eso parece correcto siempre; se rompe en el borde,
 * que es justo donde nadie hace clic dos veces seguidas.
 *
 * La segunda es el contenido, y es la que de verdad protege algo. Un recorrido
 * de bienvenida es la primera pantalla que alguien ve de la herramienta, así que
 * una lámina sin puntos, un índice que no coincide con lo que se enseña o un
 * icono con un nombre que no existe no son detalles: son la primera impresión.
 * Y ninguno de los tres rompe la compilación.
 */

/** Un `localStorage` de mentira, que además apunta lo que se le escribe. */
function almacenFalso(inicial: Record<string, string> = {}): AlmacenDeVisitas & {
  datos: Record<string, string>;
} {
  const datos = { ...inicial };
  return {
    datos,
    leer: (clave) => datos[clave] ?? null,
    escribir: (clave, valor) => {
      datos[clave] = valor;
    },
  };
}

/* --------------------------------------------------------------------------
   Navegación
   -------------------------------------------------------------------------- */

describe('acotar', () => {
  it('deja pasar lo que está dentro del rango', () => {
    expect(acotar(0)).toBe(0);
    expect(acotar(2)).toBe(2);
    expect(acotar(TOTAL_PASOS - 1)).toBe(TOTAL_PASOS - 1);
  });

  it('recorta por los dos extremos', () => {
    expect(acotar(-5)).toBe(0);
    expect(acotar(TOTAL_PASOS + 10)).toBe(TOTAL_PASOS - 1);
  });

  /*
    `NaN` llega de verdad: el paso se puede recuperar de un parámetro de la URL o
    de un `parseInt` de algo guardado. Sin esta rama, `Math.min(Math.max(NaN))`
    devuelve `NaN`, `PASOS[NaN]` es `undefined` y la lámina se pinta vacía sin
    que nada falle.
  */
  it('un índice que no es número cae en la portada', () => {
    expect(acotar(Number.NaN)).toBe(0);
    expect(acotar(Number.POSITIVE_INFINITY)).toBe(TOTAL_PASOS - 1);
  });

  it('trunca los decimales en vez de redondear', () => {
    expect(acotar(1.9)).toBe(1);
  });
});

describe('siguiente', () => {
  it('avanza una lámina', () => {
    expect(siguiente(0)).toEqual({ paso: 1 });
    expect(siguiente(3)).toEqual({ paso: 4 });
  });

  it('en la última no da la vuelta: termina', () => {
    expect(siguiente(TOTAL_PASOS - 1)).toEqual({
      paso: TOTAL_PASOS - 1,
      salir: 'terminado',
    });
  });

  it('terminar y saltar no son lo mismo', () => {
    expect(siguiente(TOTAL_PASOS - 1).salir).toBe('terminado');
    expect(moverEnAsistente(TOTAL_PASOS - 1, 'Escape')?.salir).toBe('saltado');
  });
});

describe('anterior', () => {
  it('retrocede una lámina', () => {
    expect(anterior(2)).toEqual({ paso: 1 });
  });

  it('en la portada se queda quieto y no sale del recorrido', () => {
    expect(anterior(0)).toEqual({ paso: 0 });
    expect(anterior(0).salir).toBeUndefined();
  });
});

describe('irA', () => {
  it('salta a la sección pedida', () => {
    expect(irA(4)).toEqual({ paso: 4 });
  });

  it('un destino imposible no rompe nada', () => {
    expect(irA(99)).toEqual({ paso: TOTAL_PASOS - 1 });
    expect(irA(-1)).toEqual({ paso: 0 });
  });
});

describe('esUltimo', () => {
  it('solo la última lo es', () => {
    expect(esUltimo(TOTAL_PASOS - 1)).toBe(true);
    expect(esUltimo(0)).toBe(false);
    expect(esUltimo(TOTAL_PASOS - 2)).toBe(false);
  });
});

describe('moverEnAsistente', () => {
  it('la flecha derecha avanza y la izquierda retrocede', () => {
    expect(moverEnAsistente(1, 'ArrowRight')).toEqual({ paso: 2 });
    expect(moverEnAsistente(3, 'ArrowLeft')).toEqual({ paso: 2 });
  });

  /*
    Esta prueba es la que quedó del arreglo, y por eso está escrita al revés que
    las demás: no comprueba lo que las teclas hacen, sino lo que tienen prohibido
    hacer.

    Las seis desplazan. La lámina de las ocho funcionalidades no cabe en la caja
    y hay que bajar dentro de ella; mientras estas teclas cambiaban de lámina,
    bajar era imposible sin ratón y el final de la lista quedaba fuera del
    alcance de quien usa el teclado. Que devuelvan `null` es lo que hace que el
    navegador las vea y desplace.
  */
  it('deja libres las teclas que desplazan la lámina', () => {
    for (const tecla of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
      expect(moverEnAsistente(2, tecla), tecla).toBeNull();
    }
  });

  it('Escape sale, y sale como saltado', () => {
    expect(moverEnAsistente(2, 'Escape')).toEqual({ paso: 2, salir: 'saltado' });
  });

  /*
    Esta es la que sostiene el resto. Si devolviera algo distinto de `null` para
    una tecla ajena, el componente llamaría a `preventDefault` sobre ella y se
    llevaría por delante el tabulador —o sea, la única forma de recorrer el
    diálogo sin ratón—.
  */
  it('devuelve null para lo que no es asunto suyo', () => {
    for (const tecla of ['Tab', 'a', 'Enter', ' ', 'F5', 'Shift', 'Control']) {
      expect(moverEnAsistente(0, tecla), tecla).toBeNull();
    }
  });

  it('no se sale por los bordes con el teclado', () => {
    expect(moverEnAsistente(0, 'ArrowLeft')).toEqual({ paso: 0 });
    expect(moverEnAsistente(TOTAL_PASOS - 1, 'ArrowRight')?.salir).toBe('terminado');
  });
});

describe('progreso', () => {
  it('cuenta desde uno, como lo cuenta quien mira', () => {
    expect(progreso(0)).toBe(`Lámina 1 de ${String(TOTAL_PASOS)}`);
    expect(progreso(TOTAL_PASOS - 1)).toBe(`Lámina ${String(TOTAL_PASOS)} de ${String(TOTAL_PASOS)}`);
  });
});

/* --------------------------------------------------------------------------
   Persistencia
   -------------------------------------------------------------------------- */

describe('debeAbrirse', () => {
  it('en el primer acceso, sí', () => {
    expect(debeAbrirse(almacenFalso())).toBe(true);
  });

  it('si ya se vio esta versión, no', () => {
    expect(debeAbrirse(almacenFalso({ [CLAVE_VISTO]: String(VERSION_DEL_RECORRIDO) }))).toBe(false);
  });

  it('si lo visto es de una versión anterior, se vuelve a enseñar', () => {
    expect(debeAbrirse(almacenFalso({ [CLAVE_VISTO]: '0' }))).toBe(true);
  });

  it('una versión del futuro no lo reabre', () => {
    const futura = String(VERSION_DEL_RECORRIDO + 1);
    expect(debeAbrirse(almacenFalso({ [CLAVE_VISTO]: futura }))).toBe(false);
  });

  /*
    Basura en la clave —de una versión vieja que guardaba `'true'`, o de alguien
    editando el almacenamiento— se lee como «no visto». Es la única lectura que
    no deja a nadie sin la explicación; la contraria escondería el recorrido para
    siempre y en silencio.
  */
  it('un valor ilegible cuenta como no visto', () => {
    for (const basura of ['true', '', 'sí', '{}']) {
      expect(debeAbrirse(almacenFalso({ [CLAVE_VISTO]: basura })), basura).toBe(true);
    }
  });

  it('un almacén que no guarda nada no rompe: solo vuelve a salir', () => {
    const roto: AlmacenDeVisitas = { leer: () => null, escribir: () => undefined };
    marcarVisto(roto);
    expect(debeAbrirse(roto)).toBe(true);
  });
});

describe('marcarVisto', () => {
  it('guarda la versión, no un booleano', () => {
    const almacen = almacenFalso();
    marcarVisto(almacen);
    expect(almacen.datos[CLAVE_VISTO]).toBe(String(VERSION_DEL_RECORRIDO));
  });

  it('después de marcarlo ya no se abre solo', () => {
    const almacen = almacenFalso();
    expect(debeAbrirse(almacen)).toBe(true);
    marcarVisto(almacen);
    expect(debeAbrirse(almacen)).toBe(false);
  });
});

/* --------------------------------------------------------------------------
   El contenido
   -------------------------------------------------------------------------- */

describe('las láminas están completas', () => {
  it('son seis: la portada y las cinco secciones pedidas', () => {
    expect(PASOS.map((p) => p.id)).toEqual([
      'portada',
      'proposito',
      'funcionalidades',
      'implementacion',
      'requisitos',
      'criterios',
    ]);
  });

  it('la portada lleva el título tal cual', () => {
    expect(PASOS[0]?.titulo).toBe('Asistente de DPS');
  });

  it('ninguna se queda sin rótulo, título, entradilla ni puntos', () => {
    for (const paso of PASOS) {
      expect(paso.rotulo.trim(), paso.id).not.toBe('');
      expect(paso.titulo.trim(), paso.id).not.toBe('');
      expect(paso.entradilla.trim(), paso.id).not.toBe('');
      expect(paso.puntos.length, `${paso.id} no tiene puntos`).toBeGreaterThanOrEqual(3);
    }
  });

  it('los identificadores no se repiten', () => {
    expect(new Set(PASOS.map((p) => p.id)).size).toBe(PASOS.length);
  });

  /*
    El índice no se escribe aparte: se deriva de esta misma lista. La prueba lo
    fija para que nadie «arregle» el índice copiándolo a mano en el `.tsx`, que
    es como los dos empiezan a decir cosas distintas.
  */
  it('cada punto tiene rótulo, texto e icono que existe', () => {
    for (const paso of PASOS) {
      for (const punto of paso.puntos) {
        expect(punto.titulo.trim(), `${paso.id}: punto sin título`).not.toBe('');
        expect(punto.texto.trim(), `${paso.id}/${punto.titulo}`).not.toBe('');
        expect(
          NOMBRES_ICONO,
          `${paso.id}/${punto.titulo} pide el icono «${punto.icono}», que no está dibujado`,
        ).toContain(punto.icono);
      }
    }
  });

  /*
    Un rótulo de índice largo parte la columna en dos líneas y desalinea los
    números. Treinta caracteres es lo que cabe; el más largo de ahora tiene
    veintidós.
  */
  it('los rótulos del índice caben en la columna', () => {
    for (const paso of PASOS) {
      expect(paso.rotulo.length, `«${paso.rotulo}» mide ${String(paso.rotulo.length)}`).toBeLessThanOrEqual(30);
    }
  });

  /*
    Lo que se lee de pie, delante de una pantalla que se acaba de abrir, tiene un
    límite práctico. Doscientos cuarenta caracteres es un párrafo de tres
    líneas; a partir de ahí el punto deja de ser un punto y pasa a ser un texto
    que nadie lee.
  */
  it('ningún punto se convierte en un párrafo', () => {
    for (const paso of PASOS) {
      for (const punto of paso.puntos) {
        expect(
          punto.texto.length,
          `${paso.id}/${punto.titulo} mide ${String(punto.texto.length)} caracteres`,
        ).toBeLessThanOrEqual(240);
      }
    }
  });

  /*
    El recorrido es la primera pantalla de la herramienta, así que la regla de
    microcopia del resto de la interfaz vale aquí igual. `estilos.test.ts` la
    comprueba sobre los `.tsx`, y el texto de estas láminas vive en un `.ts`: sin
    esta prueba, es el único texto de la aplicación que nadie vigila.
  */
  it('la microcopia no tutea', () => {
    const TUTEOS = [
      'Arrastra ', 'Guarda ', 'Diseña ', 'tu proyecto', 'Tus ', 'puedes ', 'tienes ',
      'Abre un ', 'Prueba con ', 'por ti', 'tu equipo', 'tu diagrama',
    ];
    const todo = PASOS.flatMap((p) => [
      p.titulo,
      p.entradilla,
      p.nota ?? '',
      ...p.puntos.flatMap((punto) => [punto.titulo, punto.texto]),
    ]).join('\n');
    const encontrados = TUTEOS.filter((t) => todo.includes(t));
    expect(encontrados, `el recorrido tutea: ${encontrados.join(' | ')}`).toEqual([]);
  });

  /*
    Los mismos pictogramas que `estilos.test.ts` persigue por los componentes. Un
    `✓` escrito en un punto se vería distinto en cada sistema y rompería la
    coherencia con los iconos dibujados que lleva al lado.
  */
  it('ningún punto usa un pictograma de la fuente', () => {
    const PICTOGRAMAS = ['✓', '✔', '✕', '⚠', '▸', '▾', '⋯', '🎤', '🔊', '📋', '📁', '🗑', '🕘'];
    const todo = PASOS.flatMap((p) => [
      p.titulo,
      p.entradilla,
      p.nota ?? '',
      ...p.puntos.flatMap((punto) => [punto.titulo, punto.texto]),
    ]).join('\n');
    const encontrados = PICTOGRAMAS.filter((g) => todo.includes(g));
    expect(encontrados, `el recorrido usa ${encontrados.join(' ')}`).toEqual([]);
  });
});
