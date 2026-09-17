import { describe, expect, it } from 'vitest';
import { NOMBRES_ICONO } from './iconos';
import {
  LADO_TACTIL,
  accionesDePulgar,
  type AccionPulgar,
  type EstadoPulgar,
  type IdAccionPulgar,
} from './barra-pulgar';

/**
 * Pruebas de la barra del pulgar, sin navegador.
 *
 * Lo que se comprueba aquí no es el aspecto —de eso se ocupa `estilos.test.ts`,
 * que mide los objetivos táctiles contra la hoja— sino las dos cosas que se
 * rompen en silencio: que la barra siga sin poder destruir nada, y que un botón
 * apagado diga por qué lo está.
 */

const BASE: EstadoPulgar = {
  soloLectura: false,
  herramienta: 'seleccion',
  tipoRelacion: 'association',
  nombreSeleccion: null,
  propiedadesVisibles: false,
};

function con(cambios: Partial<EstadoPulgar>): AccionPulgar[] {
  return accionesDePulgar({ ...BASE, ...cambios });
}

/** Una acción por su identificador, fallando claro si el identificador ya no existe. */
function accion(acciones: AccionPulgar[], id: IdAccionPulgar): AccionPulgar {
  const encontrada = acciones.find((a) => a.id === id);
  expect(encontrada, `no hay ninguna acción «${id}» en la barra`).toBeDefined();
  return encontrada as AccionPulgar;
}

describe('qué hay en la barra', () => {
  /*
    Esta prueba existe para que añadir un botón sea una decisión y no un
    descuido. El candidato evidente es «Eliminar»: es lo que más se busca justo
    después de crear una clase por error, y ponerlo aquí sería poner un borrado
    a un centímetro de donde el pulgar descansa mientras se lee el diagrama.
    Vive en el menú y en el panel de propiedades, que preguntan antes y dicen a
    cuántas relaciones se va a llevar por delante.
  */
  it('son cinco, en el orden del trabajo, y ninguna destruye nada', () => {
    expect(con({}).map((a) => a.id)).toEqual([
      'clase',
      'relacion',
      'deshacer',
      'propiedades',
      'encuadrar',
    ]);
  });

  it('todos los iconos que pide existen en el repertorio', () => {
    // Un `NombreIcono` mal escrito no lo ve TypeScript cuando sale de una tabla
    // indexada por `RelationKind`: lo que se vería en pantalla es un botón sin
    // dibujo, con su rótulo debajo, y nadie sabría que falta algo.
    for (const a of con({ tipoRelacion: 'composition' })) {
      expect(NOMBRES_ICONO, `el icono «${a.icono}» de ${a.id} no existe`).toContain(a.icono);
    }
  });

  it('cada botón tiene rótulo corto y descripción larga, y no son lo mismo', () => {
    for (const a of con({ nombreSeleccion: 'Cliente' })) {
      expect(a.etiqueta.length, `«${a.etiqueta}» no cabe debajo de un icono`).toBeLessThanOrEqual(12);
      expect(a.descripcion.length, `${a.id} no explica qué hace`).toBeGreaterThan(a.etiqueta.length);
    }
  });
});

describe('el botón de relación dice qué va a trazar', () => {
  it('lleva el nombre y el icono del tipo armado, no la palabra «Relación»', () => {
    const composicion = accion(con({ tipoRelacion: 'composition' }), 'relacion');
    expect(composicion.etiqueta).toBe('Composición');
    expect(composicion.icono).toBe('composicion');

    const herencia = accion(con({ tipoRelacion: 'inheritance' }), 'relacion');
    expect(herencia.etiqueta).toBe('Herencia');
    expect(herencia.icono).toBe('herencia');
  });

  it('es un interruptor y se hunde cuando el trazado está armado', () => {
    const suelto = accion(con({ herramienta: 'seleccion' }), 'relacion');
    expect(suelto.interruptor).toBe(true);
    expect(suelto.activa).toBe(false);
    expect(suelto.descripcion).toContain('Armar');

    const armado = accion(con({ herramienta: 'relacion' }), 'relacion');
    expect(armado.activa).toBe(true);
    // Sin esto no hay forma de salir del modo relación en un teléfono: la tecla
    // Escape, que es la salida en el escritorio, ahí no existe.
    expect(armado.descripcion).toContain('desarmar');
  });

  it('solo son interruptores los dos que se quedan puestos', () => {
    const interruptores = con({}).filter((a) => a.interruptor);
    expect(interruptores.map((a) => a.id)).toEqual(['relacion', 'propiedades']);
  });
});

describe('la ficha de la clase', () => {
  it('está apagada mientras no haya nada seleccionado, y lo dice', () => {
    const sin = accion(con({ nombreSeleccion: null }), 'propiedades');
    expect(sin.deshabilitada).toBe(true);
    expect(sin.motivo).toBe('Primero hay que tocar una clase del diagrama');
  });

  it('nombra la clase seleccionada en vez de decir «la clase seleccionada»', () => {
    const con1 = accion(con({ nombreSeleccion: 'Cliente' }), 'propiedades');
    expect(con1.deshabilitada).toBe(false);
    expect(con1.motivo).toBeNull();
    expect(con1.descripcion).toContain('Cliente');
  });

  it('se hunde cuando la columna está a la vista', () => {
    expect(accion(con({ nombreSeleccion: 'C', propiedadesVisibles: true }), 'propiedades').activa).toBe(
      true,
    );
    expect(
      accion(con({ nombreSeleccion: 'C', propiedadesVisibles: false }), 'propiedades').activa,
    ).toBe(false);
  });
});

describe('permiso de solo lectura', () => {
  const acciones = con({ soloLectura: true, nombreSeleccion: 'Cliente' });

  it('apaga las tres que escriben', () => {
    for (const id of ['clase', 'relacion', 'deshacer'] as const) {
      expect(accion(acciones, id).deshabilitada, `${id} debería estar apagada`).toBe(true);
    }
  });

  it('deja mirar: la ficha y el encuadre siguen', () => {
    expect(accion(acciones, 'propiedades').deshabilitada).toBe(false);
    expect(accion(acciones, 'encuadrar').deshabilitada).toBe(false);
  });

  /*
    Encuadrar es la salida de emergencia y por eso no se apaga nunca. En una
    pantalla pequeña basta un arrastre torpe para dejar el diagrama fuera de la
    vista, y a partir de ahí los otros cuatro botones dan igual porque no se ve
    nada sobre lo que actuar.
  */
  it('encuadrar no se apaga en ninguna combinación', () => {
    for (const soloLectura of [false, true]) {
      for (const nombreSeleccion of [null, 'Cliente']) {
        for (const herramienta of ['seleccion', 'relacion'] as const) {
          const a = accion(con({ soloLectura, nombreSeleccion, herramienta }), 'encuadrar');
          expect(a.deshabilitada).toBe(false);
          expect(a.motivo).toBeNull();
        }
      }
    }
  });

  it('ningún botón apagado se queda sin explicación, ni ninguno encendido la lleva', () => {
    for (const soloLectura of [false, true]) {
      for (const nombreSeleccion of [null, 'Cliente']) {
        for (const a of con({ soloLectura, nombreSeleccion })) {
          if (a.deshabilitada) {
            expect(a.motivo, `${a.id} está apagada y no dice por qué`).not.toBeNull();
            expect((a.motivo ?? '').length).toBeGreaterThan(10);
          } else {
            expect(a.motivo, `${a.id} está encendida y da un motivo`).toBeNull();
          }
        }
      }
    }
  });
});

describe('el objetivo táctil', () => {
  /*
    El número vive en el código y se comprueba contra la hoja desde
    `estilos.test.ts`. Aquí solo se fija que no baje: 44 es el menor de los dos
    mínimos publicados —44 pt en Apple, 48 dp en Android— y por debajo de eso
    el objetivo es más pequeño que la yema que lo va a tocar.
  */
  it('no baja de 44', () => {
    expect(LADO_TACTIL).toBeGreaterThanOrEqual(44);
  });
});
