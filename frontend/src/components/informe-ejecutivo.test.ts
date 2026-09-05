import { describe, expect, it } from 'vitest';
import { type FilaPanel, type ResumenProyecto } from './tablero-proyectos';
import { viasDeEntrada } from '@app/shared';
import {
  ROTULO_ESTADO,
  cambiosDeModelo,
  componerInforme,
  estadoDe,
  fechaLarga,
  ordenarPorUrgencia,
} from './informe-ejecutivo';

/**
 * El informe se prueba sin navegador, como el tablero.
 *
 * Lo que se comprueba aquí no es que salga bonito: es que los números que se
 * imprimen y se entregan digan la verdad, incluido el caso incómodo en el que
 * el servidor solo ha resumido una parte de los proyectos.
 */

const AHORA = new Date('2026-09-05T17:30:00.000Z');

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

function fila(nombre: string, r: ResumenProyecto | null): FilaPanel {
  return {
    proyecto: {
      id: nombre.toLowerCase(),
      name: nombre,
      description: '',
      ownerId: 'u1',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      role: 'owner',
    },
    resumen: r,
  };
}

describe('el estado de un proyecto sale de la validación, no de una etiqueta', () => {
  it('distingue los cuatro casos que el sistema sabe distinguir', () => {
    expect(estadoDe(fila('A', resumen({ problemas: 2, avisos: 1 })))).toBe('con-errores');
    expect(estadoDe(fila('B', resumen({ avisos: 3 })))).toBe('con-avisos');
    expect(estadoDe(fila('C', resumen()))).toBe('listo');
    expect(estadoDe(fila('D', null))).toBe('sin-datos');
  });

  /*
    Un error manda sobre un aviso. Si un proyecto tiene las dos cosas, lo que
    hay que decir es que no se puede generar, no que genera con avisos.
  */
  it('un error tapa a los avisos', () => {
    expect(estadoDe(fila('A', resumen({ problemas: 1, avisos: 9 })))).toBe('con-errores');
  });

  /*
    Los rótulos que traía la maqueta —«Producción», «Certificado»— afirman cosas
    que esta herramienta no puede saber: no despliega nada y no conoce ningún
    proceso de certificación. Se comprueban con límites de palabra porque el
    primer intento, sin ellos, rechazaba «Genera con avisos»: «av-iso-s»
    contiene «ISO».
  */
  it('ningún rótulo promete lo que la herramienta no sabe', () => {
    for (const rotulo of Object.values(ROTULO_ESTADO)) {
      expect(rotulo, `el rótulo «${rotulo}» afirma algo que nadie ha verificado`).not.toMatch(
        /\b(producci[óo]n|certificad[oa]|TOGAF|ISO|SOC)\b/i,
      );
    }
  });
});

describe('el orden pone delante lo que está roto', () => {
  it('primero los errores, luego los avisos, luego alfabético', () => {
    const filas = [
      fila('Zeta', resumen()),
      fila('Alfa', resumen({ avisos: 1 })),
      fila('Beta', resumen({ problemas: 1 })),
      fila('Gamma', resumen()),
    ];
    expect(ordenarPorUrgencia(filas).map((f) => f.proyecto.name)).toEqual([
      'Beta',
      'Alfa',
      'Gamma',
      'Zeta',
    ]);
  });

  it('no altera la lista que recibe', () => {
    const filas = [fila('Zeta', resumen()), fila('Beta', resumen({ problemas: 1 }))];
    ordenarPorUrgencia(filas);
    expect(filas.map((f) => f.proyecto.name)).toEqual(['Zeta', 'Beta']);
  });
});

describe('el informe no exagera su alcance', () => {
  it('suma lo que hay y cuenta los que están listos', () => {
    const informe = componerInforme(
      [
        fila('A', resumen({ clases: 4, relaciones: 3 })),
        fila('B', resumen({ clases: 6, relaciones: 2, problemas: 1 })),
      ],
      AHORA,
    );
    expect(informe.total.clases).toBe(10);
    expect(informe.total.relaciones).toBe(5);
    expect(informe.total.conProblemas).toBe(1);
    expect(informe.listos).toBe(1);
    expect(informe.alcanceCompleto).toBe(true);
  });

  /*
    Este es el caso que justifica que exista `alcanceCompleto`. El servidor
    resume solo los N proyectos más recientes; un informe impreso que dijera
    «10 clases» sobre dos de tres proyectos estaría mintiendo en papel.
  */
  it('avisa cuando el servidor no ha resumido todos los proyectos', () => {
    const informe = componerInforme(
      [fila('A', resumen({ clases: 4 })), fila('B', resumen({ clases: 6 })), fila('C', null)],
      AHORA,
    );
    expect(informe.total.proyectos).toBe(3);
    expect(informe.total.resumidos).toBe(2);
    expect(informe.alcanceCompleto).toBe(false);
  });

  it('un proyecto sin resumir no cuenta como listo', () => {
    const informe = componerInforme([fila('A', null)], AHORA);
    expect(informe.listos).toBe(0);
  });

  it('sin proyectos no divide por cero ni inventa un porcentaje', () => {
    const informe = componerInforme([], AHORA);
    expect(informe.total.clases).toBe(0);
    expect(informe.listos).toBe(0);
    expect(informe.alcanceCompleto).toBe(true);
  });
});

describe('el reparto por vía se calcula sobre lo que la barra reparte', () => {
  /*
    El caso que justifica que `cambiosDeModelo` exista. Aquí hay 10 cambios,
    pero 4 son deshacer y rehacer y `viasDeEntrada` los deja fuera. Sobre el
    total, los tramos sumarían 60 %; sobre lo que se reparte, cien.
  */
  it('los porcentajes impresos suman cien aunque haya deshacer y rehacer', () => {
    const vias = viasDeEntrada({
      porOrigen: { manual: 3, asistente: 3, foto: 0, xmi: 0, deshacer: 3, rehacer: 1 },
      total: 10,
      fechasDudosas: 0,
    });
    expect(cambiosDeModelo(vias)).toBe(6);
    const suma = vias.reduce((acc, via) => acc + Math.round((via.cambios / 6) * 100), 0);
    expect(suma).toBe(100);
  });

  it('sin vías no hay denominador que inventar', () => {
    expect(cambiosDeModelo([])).toBe(0);
  });
});

describe('la fecha impresa no depende de la configuración del navegador', () => {
  it('escribe el mes con letras', () => {
    expect(fechaLarga(new Date(2026, 3, 3, 9, 5))).toBe('3 de abril de 2026, 09:05');
    expect(fechaLarga(new Date(2026, 0, 31, 23, 59))).toBe('31 de enero de 2026, 23:59');
  });
});
