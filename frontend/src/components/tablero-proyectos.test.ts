import { describe, expect, it } from 'vitest';
import { viasDeEntrada } from '@app/shared';
import {
  type FilaPanel,
  type ResumenProyecto,
  comoResumenOrigenes,
  conProblemas,
  contenidoDelTablero,
  haceCuanto,
  porcentaje,
  totales,
} from './tablero-proyectos';

/**
 * El tablero se prueba sin navegador.
 *
 * Todo lo que decide qué número sale por pantalla vive en el módulo puro, así que
 * estas pruebas cubren la parte que puede equivocarse. Lo que queda en el
 * componente es colocar cadenas ya calculadas dentro de etiquetas.
 */

const AHORA = new Date('2026-09-03T12:00:00.000Z');

function resumen(parcial: Partial<ResumenProyecto> = {}): ResumenProyecto {
  return {
    clases: 0,
    relaciones: 0,
    miembros: 1,
    problemas: 0,
    avisos: 0,
    cambios: 0,
    porOrigen: { manual: 0, asistente: 0, foto: 0, xmi: 0, deshacer: 0, rehacer: 0 },
    fechasDudosas: 0,
    ...parcial,
  };
}

function fila(nombre: string, actualizado: string, r: ResumenProyecto | null): FilaPanel {
  return {
    proyecto: {
      id: nombre.toLowerCase(),
      name: nombre,
      description: '',
      ownerId: 'u1',
      createdAt: actualizado,
      updatedAt: actualizado,
      role: 'owner',
    },
    resumen: r,
  };
}

describe('cuándo se tocó por última vez', () => {
  it('lo dice en palabras, no en ISO', () => {
    expect(haceCuanto('2026-09-03T11:59:30.000Z', AHORA)).toBe('hace un momento');
    expect(haceCuanto('2026-09-03T11:45:00.000Z', AHORA)).toBe('hace 15 minutos');
    expect(haceCuanto('2026-09-03T09:00:00.000Z', AHORA)).toBe('hace 3 horas');
    expect(haceCuanto('2026-09-02T10:00:00.000Z', AHORA)).toBe('ayer');
    expect(haceCuanto('2026-08-31T10:00:00.000Z', AHORA)).toBe('hace 3 días');
  });

  it('singulariza en vez de escribir «1 minutos»', () => {
    expect(haceCuanto('2026-09-03T11:58:30.000Z', AHORA)).toBe('hace 1 minuto');
    expect(haceCuanto('2026-09-03T10:59:00.000Z', AHORA)).toBe('hace 1 hora');
  });

  it('pasada una semana vuelve a la fecha, que informa más que el conteo', () => {
    // «hace 23 días» obliga a contar hacia atrás; una fecha se lee y ya.
    expect(haceCuanto('2026-07-15T10:00:00.000Z', AHORA)).toMatch(/2026/);
  });

  /*
   * Un reloj adelantado produce una fecha futura, y esto es una lista de cosas
   * que ya pasaron. Es el mismo desajuste que `historial.ts` marca como
   * `relojDudoso`: aquí no se puede marcar nada, así que al menos no se enseña
   * «dentro de tres horas», que parece un error del programa.
   */
  it('una fecha del futuro no se anuncia como futuro', () => {
    expect(haceCuanto('2026-09-03T15:00:00.000Z', AHORA)).toBe('hace un momento');
  });

  it('una fecha ilegible se dice, no se convierte en «hace 56 años»', () => {
    expect(haceCuanto('no es una fecha', AHORA)).toBe('sin fecha');
    expect(haceCuanto('', AHORA)).toBe('sin fecha');
  });
});

describe('totales del panel', () => {
  it('con cero proyectos no inventa nada', () => {
    const total = totales([]);
    expect(total).toMatchObject({
      proyectos: 0,
      resumidos: 0,
      clases: 0,
      cambios: 0,
      conProblemas: 0,
      fechasDudosas: 0,
    });
    // Sin cambios no hay barra que pintar, y la leyenda queda vacía en vez de
    // enseñar seis vías a cero.
    expect(viasDeEntrada(comoResumenOrigenes(total))).toEqual([]);
  });

  it('un proyecto recién creado, sin historial, suma cero sin romperse', () => {
    const total = totales([fila('Tienda', '2026-09-03T11:00:00.000Z', resumen())]);
    expect(total.proyectos).toBe(1);
    expect(total.resumidos).toBe(1);
    expect(total.cambios).toBe(0);
    expect(viasDeEntrada(comoResumenOrigenes(total))).toEqual([]);
  });

  /*
   * El servidor solo resume los proyectos más recientes hasta su tope. Los
   * demás llegan con `resumen: null` y tienen que seguir contando como
   * proyectos: si `proyectos` y `resumidos` fueran el mismo número, el panel
   * diría «104 clases en 24 proyectos» a quien tiene treinta.
   */
  it('distingue cuántos proyectos hay de sobre cuántos ha podido sumar', () => {
    const total = totales([
      fila('A', '2026-09-03T11:00:00.000Z', resumen({ clases: 4 })),
      fila('B', '2026-09-02T11:00:00.000Z', null),
      fila('C', '2026-09-01T11:00:00.000Z', null),
    ]);
    expect(total.proyectos).toBe(3);
    expect(total.resumidos).toBe(1);
    expect(total.clases).toBe(4);
  });

  it('acumula las vías de entrada entre proyectos', () => {
    const total = totales([
      fila(
        'A',
        '2026-09-03T11:00:00.000Z',
        resumen({
          cambios: 10,
          porOrigen: { manual: 6, asistente: 2, foto: 2, xmi: 0, deshacer: 0, rehacer: 0 },
        }),
      ),
      fila(
        'B',
        '2026-09-02T11:00:00.000Z',
        resumen({
          cambios: 5,
          porOrigen: { manual: 1, asistente: 0, foto: 0, xmi: 4, deshacer: 0, rehacer: 0 },
        }),
      ),
    ]);

    expect(total.cambios).toBe(15);
    expect(total.porOrigen.manual).toBe(7);
    expect(total.porOrigen.foto).toBe(2);
    expect(total.porOrigen.xmi).toBe(4);

    // Ordenadas de más a menos y sin las vías a cero.
    expect(viasDeEntrada(comoResumenOrigenes(total)).map((v) => [v.origen, v.cambios])).toEqual([
      ['manual', 7],
      ['xmi', 4],
      ['asistente', 2],
      ['foto', 2],
    ]);
  });

  /*
   * Deshacer y rehacer no son formas de meter modelo: son actos sobre el
   * historial. Cuentan en el total de cambios pero no aparecen en el reparto,
   * porque sumarlos a «a mano» presentaría como trabajo hecho algo que en
   * realidad se estaba retirando.
   */
  it('deshacer y rehacer no se reparten como si fueran modelo', () => {
    const total = totales([
      fila(
        'A',
        '2026-09-03T11:00:00.000Z',
        resumen({
          cambios: 9,
          porOrigen: { manual: 5, asistente: 0, foto: 0, xmi: 0, deshacer: 3, rehacer: 1 },
        }),
      ),
    ]);

    expect(total.cambios).toBe(9);
    expect(viasDeEntrada(comoResumenOrigenes(total)).map((v) => v.origen)).toEqual(['manual']);
  });

  it('cuenta las fechas dudosas en vez de descartarlas en silencio', () => {
    const total = totales([
      fila('A', '2026-09-03T11:00:00.000Z', resumen({ cambios: 40, fechasDudosas: 3 })),
      fila('B', '2026-09-02T11:00:00.000Z', resumen({ cambios: 10, fechasDudosas: 1 })),
    ]);
    expect(total.fechasDudosas).toBe(4);
  });
});

describe('qué proyectos no pueden generar backend', () => {
  it('solo los que tienen errores, del más roto al menos', () => {
    const filas = [
      fila('Sano', '2026-09-03T11:00:00.000Z', resumen({ problemas: 0 })),
      fila('Roto', '2026-09-02T11:00:00.000Z', resumen({ problemas: 2 })),
      fila('Peor', '2026-09-01T11:00:00.000Z', resumen({ problemas: 7 })),
    ];
    expect(conProblemas(filas).map((f) => f.proyecto.name)).toEqual(['Peor', 'Roto']);
  });

  /*
   * Un aviso no impide generar. Meterlo aquí enseñaría a ignorar la lista, que
   * es justo lo que no puede pasar con la única sección que pide una acción.
   */
  it('los avisos no cuentan como problemas', () => {
    const filas = [fila('Con avisos', '2026-09-03T11:00:00.000Z', resumen({ avisos: 5 }))];
    expect(conProblemas(filas)).toEqual([]);
  });

  it('un proyecto sin resumir no se declara sano ni roto', () => {
    expect(conProblemas([fila('Fuera del tope', '2026-01-01T11:00:00.000Z', null)])).toEqual([]);
  });
});

describe('porcentajes de la leyenda', () => {
  it('redondea al entero', () => {
    expect(porcentaje(1, 3)).toBe(33);
    expect(porcentaje(2, 3)).toBe(67);
  });

  it('sin cambios no divide por cero', () => {
    expect(porcentaje(0, 0)).toBe(0);
  });

  /*
   * Tres tercios redondeados suman 99, y no se corrige: la barra se reparte con
   * `flex-grow` sobre los recuentos crudos, así que el dibujo es exacto aunque
   * los rótulos no cuadren. Forzar que sumaran cien obligaría a mentir en uno.
   */
  it('los rótulos pueden no sumar cien, y es correcto que así sea', () => {
    const tercio = porcentaje(1, 3);
    expect(tercio * 3).toBe(99);
  });
});

/*
 * Los tres estados que el componente puede pintar.
 *
 * Se prueban aquí y no montando el componente porque no hay jsdom instalado,
 * pero sobre todo porque esta es la decisión que importa: si vivieran dentro del
 * JSX serían la parte que ninguna prueba mira, y son las que deciden qué se ve
 * en un arranque en frío, que es exactamente lo que ve quien lo evalúa.
 */
describe('los estados del tablero', () => {
  it('una cuenta recién creada no enseña un tablero de ceros', () => {
    const contenido = contenidoDelTablero([]);
    expect(contenido.mostrar).toBe(false);
    expect(contenido.total.proyectos).toBe(0);
  });

  /*
   * Sin conexión la petición falla y la lista se queda vacía. Es el mismo camino
   * que la cuenta nueva y merece la misma respuesta: no pintar. Lo que no puede
   * pasar es quedarse en «Cargando…», que promete algo que ya no va a llegar; de
   * eso se ocupa el `finally` de `ListaProyectos`, y el aviso de red se enseña
   * aparte porque «no hay proyectos» y «no se han podido pedir» no son lo mismo.
   */
  it('sin conexión no se distingue de vacío para el tablero, y así debe ser', () => {
    expect(contenidoDelTablero([]).mostrar).toBe(false);
  });

  it('con proyectos se pinta y trae las tres respuestas', () => {
    const contenido = contenidoDelTablero([
      fila(
        'A',
        '2026-09-03T11:00:00.000Z',
        resumen({
          clases: 3,
          problemas: 2,
          cambios: 4,
          porOrigen: { manual: 4, asistente: 0, foto: 0, xmi: 0, deshacer: 0, rehacer: 0 },
        }),
      ),
    ]);
    expect(contenido.mostrar).toBe(true);
    expect(contenido.total.clases).toBe(3);
    expect(contenido.rotos.map((f) => f.proyecto.name)).toEqual(['A']);
    expect(contenido.vias.map((v) => v.origen)).toEqual(['manual']);
  });

  it('avisa cuando las cifras no cubren todos los proyectos', () => {
    expect(
      contenidoDelTablero([
        fila('A', '2026-09-03T11:00:00.000Z', resumen()),
        fila('B', '2026-09-02T11:00:00.000Z', null),
      ]).parcial,
    ).toBe(true);

    expect(
      contenidoDelTablero([fila('A', '2026-09-03T11:00:00.000Z', resumen())]).parcial,
    ).toBe(false);
  });

  /*
   * Relojes desordenados: el caso que descarta la gráfica temporal.
   *
   * `historial.ts` marca una entrada como dudosa cuando la fecha de quien
   * escribió contradice el orden que fija el CRDT. Aquí eso se cuenta y se dice,
   * y no toca el reparto por vía de entrada, que no depende de ninguna fecha.
   * Una serie temporal sí dependería, y sería una línea dibujada sobre datos que
   * el propio módulo declara poco fiables.
   */
  it('los relojes desordenados se cuentan y no falsean el reparto', () => {
    const contenido = contenidoDelTablero([
      fila(
        'Reloj adelantado',
        // La fecha del proyecto es del futuro: el reloj de quien guardó iba mal.
        '2026-09-04T11:00:00.000Z',
        resumen({
          cambios: 6,
          fechasDudosas: 5,
          porOrigen: { manual: 4, asistente: 2, foto: 0, xmi: 0, deshacer: 0, rehacer: 0 },
        }),
      ),
    ]);

    expect(contenido.total.fechasDudosas).toBe(5);
    expect(contenido.vias.map((v) => [v.origen, v.cambios])).toEqual([
      ['manual', 4],
      ['asistente', 2],
    ]);
    // Y la fila de arriba no anuncia un proyecto tocado mañana.
    expect(haceCuanto('2026-09-04T11:00:00.000Z', AHORA)).toBe('hace un momento');
  });
});
