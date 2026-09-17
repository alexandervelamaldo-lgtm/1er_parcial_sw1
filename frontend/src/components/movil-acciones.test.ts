import { describe, expect, it } from 'vitest';
import { NOMBRES_ICONO } from './iconos';
import {
  accionMovil,
  accionesFlotantes,
  cajonDeAcciones,
  type AccionMovil,
  type EstadoAcciones,
  type IdAccionMovil,
} from './movil-acciones';

/**
 * Pruebas del botón flotante y del cajón, sin navegador.
 *
 * Lo que se comprueba no es el aspecto sino las reglas que se rompen en
 * silencio: que nada destructivo se cuele donde cae el pulgar, que ninguna
 * acción se apague sin decir por qué, y que la distinción entre «esto lo hace
 * el servidor» y «esto lo hace el teléfono» siga siendo la de verdad.
 */

/** Un proyecto normal: es de quien mira, se puede escribir, hay clases y hay red. */
const BASE: EstadoAcciones = {
  soloLectura: false,
  clases: 4,
  conectado: true,
  tieneComunicacion: false,
  propietario: true,
};

/** Todas las acciones que se pueden alcanzar desde el cajón, en una lista. */
function delCajon(estado: EstadoAcciones): AccionMovil[] {
  return cajonDeAcciones(estado).flatMap((g) => g.acciones);
}

function buscar(estado: EstadoAcciones, id: IdAccionMovil): AccionMovil {
  const encontrada = delCajon(estado).find((a) => a.id === id);
  if (!encontrada) throw new Error(`el cajón no ofrece «${id}»`);
  return encontrada;
}

/**
 * Los estados que de verdad se dan, combinados.
 *
 * Las cinco variables se recorren enteras aunque dos combinaciones no puedan
 * ocurrir juntas —nadie es propietario y lector a la vez— porque la prueba que
 * más vale de todo este fichero es la que exige un motivo en *cualquier* estado,
 * y recortar la lista a los casos que hoy sabemos posibles es dejar sin vigilar
 * justo los que aparecerán cuando cambien los roles.
 */
function todosLosEstados(): EstadoAcciones[] {
  const estados: EstadoAcciones[] = [];
  for (const soloLectura of [false, true]) {
    for (const clases of [0, 4]) {
      for (const conectado of [false, true]) {
        for (const tieneComunicacion of [false, true]) {
          for (const propietario of [false, true]) {
            estados.push({ soloLectura, clases, conectado, tieneComunicacion, propietario });
          }
        }
      }
    }
  }
  return estados;
}

describe('el botón flotante', () => {
  it('lleva exactamente lo que se hace mientras se dibuja', () => {
    expect(accionesFlotantes(BASE).map((a) => a.id)).toEqual([
      'clase',
      'desde-imagen',
      'generar',
    ]);
  });

  it('nunca lleva nada que destruya, en ningún estado', () => {
    /*
      La regla que hace aceptable poner botones justo donde el pulgar descansa
      mientras se lee el diagrama. Se comprueba contra la marca `destructiva` y
      no contra una lista de identificadores escrita aquí, que envejecería en
      cuanto alguien añada una acción nueva.
    */
    for (const estado of todosLosEstados()) {
      for (const accion of accionesFlotantes(estado)) {
        expect(accion.destructiva, `«${accion.id}» está en el botón flotante`).toBe(false);
      }
    }
  });

  it('son pocas: cada fila de más tapa el diagrama que hay que mirar', () => {
    expect(accionesFlotantes(BASE).length).toBeLessThanOrEqual(3);
  });

  it('todo lo que ofrece está también en el cajón', () => {
    /*
      El botón es un atajo, nunca el único camino. Un atajo que además es el
      único camino se convierte en una función que nadie encuentra el día que
      el atajo no aplica.
    */
    for (const estado of todosLosEstados()) {
      const enElCajon = new Set(delCajon(estado).map((a) => a.id));
      for (const accion of accionesFlotantes(estado)) {
        expect(enElCajon.has(accion.id), `«${accion.id}» solo está en el botón`).toBe(true);
      }
    }
  });

  it('dice lo mismo que el cajón sobre la misma acción', () => {
    // Con dos descripciones, la de menos uso se queda vieja y nadie se entera
    // hasta que alguien la pulsa.
    const sinRed = { ...BASE, conectado: false };
    const flotante = accionesFlotantes(sinRed).find((a) => a.id === 'generar');
    expect(flotante).toEqual(buscar(sinRed, 'generar'));
  });
});

describe('el cajón', () => {
  it('agrupa por tarea y ningún grupo se queda vacío', () => {
    for (const grupo of cajonDeAcciones(BASE)) {
      expect(grupo.acciones.length, `el grupo «${grupo.titulo}» está vacío`).toBeGreaterThan(0);
      expect(grupo.titulo).not.toHaveLength(0);
    }
  });

  it('no repite ninguna acción en dos grupos', () => {
    for (const estado of todosLosEstados()) {
      const ids = delCajon(estado).map((a) => a.id);
      expect(new Set(ids).size, 'hay una acción repetida').toBe(ids.length);
    }
  });

  it('conserva las funciones del escritorio que tenían que seguir estando', () => {
    // Importar desde foto, XMI en los dos sentidos, revisar, módulos,
    // historial y previsualizar la generación.
    const ids = new Set(delCajon(BASE).map((a) => a.id));
    for (const id of [
      'desde-imagen',
      'importar-xmi',
      'exportar-xmi',
      'revisar',
      'modulos',
      'historial',
      'previsualizar',
    ] as const) {
      expect(ids.has(id), `falta «${id}»`).toBe(true);
    }
  });

  it('todos los iconos existen', () => {
    // Un icono inventado no rompe la compilación, pinta un hueco.
    for (const accion of delCajon(BASE)) {
      expect(NOMBRES_ICONO).toContain(accion.icono);
    }
  });
});

describe('ninguna acción se apaga en silencio', () => {
  it('apagada implica motivo, y encendida implica ninguno', () => {
    /*
      En un teléfono no hay `hover`: no existe forma de preguntarle a un control
      por qué no responde. El motivo en texto es el único sitio donde se puede
      leer, así que no puede faltar en ningún estado.
    */
    for (const estado of todosLosEstados()) {
      for (const accion of [...delCajon(estado), ...accionesFlotantes(estado)]) {
        if (accion.deshabilitada) {
          expect(accion.motivo, `«${accion.id}» apagada sin motivo`).not.toBeNull();
          expect(accion.motivo).not.toHaveLength(0);
        } else {
          expect(accion.motivo, `«${accion.id}» encendida con motivo`).toBeNull();
        }
      }
    }
  });

  it('los motivos dicen qué pasa, no solo que no se puede', () => {
    const sinRed = buscar({ ...BASE, conectado: false }, 'generar');
    expect(sinRed.motivo).toMatch(/conexión/i);
    // Y además tranquiliza sobre lo que se está dibujando ahora mismo, que es
    // la pregunta que se hace quien ve el botón gris en el metro.
    expect(sinRed.motivo).toMatch(/se guarda|sube al volver/i);
  });
});

describe('permiso de solo lectura', () => {
  const lector: EstadoAcciones = { ...BASE, soloLectura: true };

  it('lo que escribe está apagado antes de intentarlo', () => {
    // El encargo pide que se sepa antes, no después de que el servidor lo
    // rechace.
    for (const id of ['clase', 'desde-imagen', 'importar-xmi', 'modulos', 'generar'] as const) {
      const accion = buscar(lector, id);
      expect(accion.deshabilitada, `«${id}» debería estar apagada para un lector`).toBe(true);
      expect(accion.motivo).toMatch(/solo lectura/i);
    }
  });

  it('lo que solo mira sigue encendido', () => {
    /*
      Un lector no es un invitado con la aplicación rota: puede revisar el
      modelo, exportarlo, leer el historial y salir. Apagar esas cuatro sería
      confundir «no puede cambiarlo» con «no puede usarlo».
    */
    for (const id of ['revisar', 'exportar-xmi', 'historial', 'salir'] as const) {
      expect(buscar(lector, id).deshabilitada, `«${id}» no debería apagarse`).toBe(false);
    }
  });

  it('a un lector sin red se le dice lo del permiso, no lo de la red', () => {
    // Conectarse no le va a servir de nada, así que ofrecerle esa esperanza es
    // mandarle a perder el tiempo.
    const accion = buscar({ ...lector, conectado: false }, 'generar');
    expect(accion.motivo).toMatch(/solo lectura/i);
  });
});

describe('sin conexión', () => {
  const metro: EstadoAcciones = { ...BASE, conectado: false };

  it('generar y previsualizar se apagan: los calcula el servidor', () => {
    expect(buscar(metro, 'generar').deshabilitada).toBe(true);
    expect(buscar(metro, 'previsualizar').deshabilitada).toBe(true);
  });

  it('exportar XMI sigue encendido: lo escribe el teléfono', () => {
    /*
      La distinción que hay que mantener. El XMI se arma con el documento que ya
      está en el aparato; el backend lo compila el servidor. Apagar las dos
      cosas por igual enseñaría que sin red la aplicación no sirve, que es
      falso y es justo lo contrario de lo que este proyecto quiere demostrar.
    */
    expect(buscar(metro, 'exportar-xmi').deshabilitada).toBe(false);
  });

  it('dibujar y revisar siguen encendidos', () => {
    expect(buscar(metro, 'clase').deshabilitada).toBe(false);
    expect(buscar(metro, 'revisar').deshabilitada).toBe(false);
    expect(buscar(metro, 'historial').deshabilitada).toBe(false);
  });
});

describe('un diagrama vacío', () => {
  const vacio: EstadoAcciones = { ...BASE, clases: 0 };

  it('no se puede exportar ni generar lo que no existe', () => {
    for (const id of ['exportar-xmi', 'generar', 'previsualizar', 'revisar'] as const) {
      const accion = buscar(vacio, id);
      expect(accion.deshabilitada, `«${id}» con el diagrama vacío`).toBe(true);
      expect(accion.motivo).toMatch(/ninguna clase/i);
    }
  });

  it('pero sí se puede empezar uno', () => {
    expect(buscar(vacio, 'clase').deshabilitada).toBe(false);
    expect(buscar(vacio, 'desde-imagen').deshabilitada).toBe(false);
    expect(buscar(vacio, 'importar-xmi').deshabilitada).toBe(false);
  });
});

describe('el diagrama de comunicación importado', () => {
  it('no se ofrece si no hay ninguno', () => {
    // Una entrada permanentemente apagada ocupa una fila del cajón para no
    // decir nada; mejor que no esté.
    expect(delCajon(BASE).some((a) => a.id === 'comunicacion')).toBe(false);
  });

  it('se ofrece, y encendida, cuando lo hay', () => {
    const con = { ...BASE, tieneComunicacion: true };
    expect(buscar(con, 'comunicacion').deshabilitada).toBe(false);
  });

  it('un lector sin red también puede verlo', () => {
    const con = { ...BASE, tieneComunicacion: true, soloLectura: true, conectado: false };
    expect(buscar(con, 'comunicacion').deshabilitada).toBe(false);
  });
});

describe('invitar a alguien desde el teléfono', () => {
  it('se puede llegar a compartir sin salir del proyecto', () => {
    /*
      El motivo entero de que esta acción exista. En el escritorio compartir
      vive en la lista de proyectos y desde el editor hay que cerrar y volver a
      abrir; en un teléfono, donde casi siempre se ha entrado desde un enlace,
      ese viaje es lo que hace que la función no se use nunca.
    */
    expect(buscar(BASE, 'compartir').deshabilitada).toBe(false);
  });

  it('a quien no es dueño se le dice antes de escribir el correo', () => {
    /*
      Y se le dice aunque pueda escribir en el diagrama: un editor cambia clases
      con total normalidad y aun así el servidor le rechaza la invitación. Si la
      entrada se apagara solo con `soloLectura`, los editores —que son la
      mayoría— la verían encendida y el «no» llegaría después de teclear.
    */
    const editor = buscar({ ...BASE, propietario: false }, 'compartir');
    expect(editor.deshabilitada).toBe(true);
    expect(editor.motivo).toMatch(/creó el proyecto/i);
  });

  it('sin red se apaga, y por la razón correcta', () => {
    // La lista de miembros es del servidor, no del documento: no está en el
    // teléfono como sí lo está el historial.
    const metro = buscar({ ...BASE, conectado: false }, 'compartir');
    expect(metro.deshabilitada).toBe(true);
    expect(metro.motivo).toMatch(/conexión/i);
    // Y no promete que lo escrito se subirá luego, que es lo que dice el motivo
    // de «generar» y aquí sería mentira: no hay nada que encolar.
    expect(metro.motivo).not.toMatch(/sube al volver/i);
  });

  it('a un dueño sin red se le habla de la red, no de la propiedad', () => {
    // El espejo de lo que se hace con el lector en «generar»: primero lo que no
    // tiene arreglo. Aquí sí lo tiene, así que se dice lo que sirve.
    const accion = buscar({ ...BASE, conectado: false, propietario: false }, 'compartir');
    expect(accion.motivo).toMatch(/creó el proyecto/i);
  });

  it('va con el proyecto, no con lo que se dibuja', () => {
    // Repartir el acceso no es una operación sobre el diagrama, y ponerla entre
    // «añadir clase» y «revisar» la haría parecer una.
    const grupo = cajonDeAcciones(BASE).find((g) => g.acciones.some((a) => a.id === 'compartir'));
    expect(grupo?.id).toBe('proyecto');
  });

  it('no está en el botón flotante', () => {
    // No se comparte mientras se dibuja: se comparte una vez, al principio.
    expect(accionesFlotantes(BASE).some((a) => a.id === 'compartir')).toBe(false);
  });
});

describe('dictar un cambio', () => {
  it('sigue encendido sin red: sin servidor queda la gramática local', () => {
    /*
      La regla que separa esto de «generar». Generar lo compila el servidor y sin
      él no hay nada que hacer; una orden dictada la interpreta el servidor *si
      está*, y si no, la gramática que viaja en el paquete. Sin cobertura se
      entienden menos frases, no ninguna.

      Apagarlo en el metro quitaría de en medio justo la forma de editar que no
      necesita el teclado, que es la que mejor funciona en un teléfono.
    */
    const metro = buscar({ ...BASE, conectado: false }, 'asistente');
    expect(metro.deshabilitada).toBe(false);
  });

  it('funciona con el diagrama vacío: «crea la clase Pedido» es la primera orden', () => {
    // Al revés que exportar o revisar, que necesitan algo que mirar. Dictar es
    // precisamente por donde se empieza.
    expect(buscar({ ...BASE, clases: 0 }, 'asistente').deshabilitada).toBe(false);
  });

  it('a un lector se le apaga: una propuesta que no puede aplicar no sirve', () => {
    const lector = buscar({ ...BASE, soloLectura: true }, 'asistente');
    expect(lector.deshabilitada).toBe(true);
    expect(lector.motivo).toMatch(/solo lectura/i);
  });

  it('el micrófono flotante dice lo mismo que el cajón', () => {
    /*
      El atajo no se describe a sí mismo. Con dos descripciones, la del atajo
      —que solo se lee cuando alguien es lector, o sea casi nunca— se queda
      vieja sin que nadie se entere.
    */
    for (const estado of todosLosEstados()) {
      expect(accionMovil(estado, 'asistente')).toEqual(buscar(estado, 'asistente'));
    }
  });

  it('va con lo que se dibuja, no con el proyecto', () => {
    // Dictar es una forma de editar el diagrama, no un ajuste del proyecto.
    const grupo = cajonDeAcciones(BASE).find((g) => g.acciones.some((a) => a.id === 'asistente'));
    expect(grupo?.id).toBe('dibujar');
  });
});

describe('salir del proyecto', () => {
  it('nunca se apaga, pase lo que pase', () => {
    /*
      La salida de emergencia, por el mismo motivo que «encuadrar» en la barra
      del pulgar: si se apagara justo cuando todo lo demás está apagado, no
      habría forma de llegar a ningún sitio desde el que arreglarlo.
    */
    for (const estado of todosLosEstados()) {
      expect(buscar(estado, 'salir').deshabilitada).toBe(false);
    }
  });

  it('va sola al final, no mezclada con otra cosa que se pulse de paso', () => {
    const grupos = cajonDeAcciones(BASE);
    const ultimo = grupos[grupos.length - 1];
    expect(ultimo?.acciones[ultimo.acciones.length - 1]?.id).toBe('salir');
  });
});
