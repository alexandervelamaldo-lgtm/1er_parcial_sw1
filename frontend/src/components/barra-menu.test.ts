import { describe, expect, it } from 'vitest';
import {
  estadoInicial,
  moverEnMenu,
  type EstadoMenu,
  type MenuDesplegable,
} from './barra-menu';

/**
 * Pruebas del teclado de la barra de menú.
 *
 * Un menú que se abre con el ratón parece terminado y sigue estando roto: lo que
 * falla siempre es Escape sin devolver el foco, la flecha que se para en un
 * comando deshabilitado, o la barra que no da la vuelta. Nada de eso lo ve el
 * compilador ni se nota mirando la pantalla, porque con ratón nunca ocurre.
 */

const MENUS: MenuDesplegable[] = [
  {
    id: 'archivo',
    etiqueta: 'Archivo',
    comandos: [
      { id: 'imagen', etiqueta: 'Importar desde imagen…' },
      { id: 'xmi-in', etiqueta: 'Importar XMI…', deshabilitado: true },
      { id: 'xmi-out', etiqueta: 'Exportar XMI' },
      { id: 'salir', etiqueta: 'Volver a proyectos', separadorAntes: true },
    ],
  },
  {
    id: 'edicion',
    etiqueta: 'Edición',
    comandos: [
      { id: 'deshacer', etiqueta: 'Deshacer', atajo: 'Ctrl+Z' },
      { id: 'rehacer', etiqueta: 'Rehacer', atajo: 'Ctrl+Mayús+Z' },
    ],
  },
  {
    id: 'ver',
    etiqueta: 'Ver',
    comandos: [
      { id: 'izquierda', etiqueta: 'Explorador', marcado: true },
      { id: 'derecha', etiqueta: 'Propiedades', marcado: false },
    ],
  },
];

const cerrado = (menu = 0): EstadoMenu => ({ abierto: null, menu, comando: -1 });

describe('estadoInicial', () => {
  it('arranca cerrada y con el foco en el primer rótulo', () => {
    expect(estadoInicial()).toEqual({ abierto: null, menu: 0, comando: -1 });
  });
});

describe('moverEnMenu — con la barra cerrada', () => {
  it('las flechas horizontales recorren los rótulos sin desplegar nada', () => {
    expect(moverEnMenu(MENUS, cerrado(0), 'ArrowRight')?.estado).toEqual(cerrado(1));
    expect(moverEnMenu(MENUS, cerrado(1), 'ArrowLeft')?.estado).toEqual(cerrado(0));
  });

  it('la barra da la vuelta por los dos lados', () => {
    // Al revés que el árbol, donde envolver desorienta. Una barra de cinco
    // rótulos se abarca de un vistazo y esto es lo que hace cualquier menú.
    expect(moverEnMenu(MENUS, cerrado(2), 'ArrowRight')?.estado).toEqual(cerrado(0));
    expect(moverEnMenu(MENUS, cerrado(0), 'ArrowLeft')?.estado).toEqual(cerrado(2));
  });

  it('la flecha abajo despliega y deja el foco en el primer comando', () => {
    expect(moverEnMenu(MENUS, cerrado(1), 'ArrowDown')?.estado).toEqual({
      abierto: 'edicion',
      menu: 1,
      comando: 0,
    });
  });

  it('la flecha arriba despliega por el final', () => {
    expect(moverEnMenu(MENUS, cerrado(1), 'ArrowUp')?.estado).toEqual({
      abierto: 'edicion',
      menu: 1,
      comando: 1,
    });
  });

  it('Entrar y espacio despliegan en vez de activar', () => {
    // El rótulo «Archivo» no es una orden: no hay nada que ejecutar todavía.
    for (const tecla of ['Enter', ' ']) {
      const resultado = moverEnMenu(MENUS, cerrado(0), tecla);
      expect(resultado?.activar).toBeUndefined();
      expect(resultado?.estado.abierto).toBe('archivo');
    }
  });

  it('Escape saca el foco de la barra', () => {
    // Es lo que devuelve el teclado al lienzo sin tener que tabular hasta el
    // final de la cabecera.
    expect(moverEnMenu(MENUS, cerrado(0), 'Escape')).toEqual({ estado: cerrado(0), salir: true });
  });

  it('Inicio y Fin saltan al primer y al último rótulo', () => {
    expect(moverEnMenu(MENUS, cerrado(1), 'Home')?.estado).toEqual(cerrado(0));
    expect(moverEnMenu(MENUS, cerrado(1), 'End')?.estado).toEqual(cerrado(2));
  });

  it('una letra despliega el menú que empieza por ella', () => {
    expect(moverEnMenu(MENUS, cerrado(0), 'v')?.estado).toEqual({
      abierto: 'ver',
      menu: 2,
      comando: 0,
    });
  });
});

describe('moverEnMenu — con un menú desplegado', () => {
  const abierto: EstadoMenu = { abierto: 'archivo', menu: 0, comando: 0 };

  it('la flecha abajo se salta los comandos deshabilitados', () => {
    // «Importar XMI…» está en el índice 1 y deshabilitado. Pararse ahí deja el
    // foco en algo que no responde a Entrar, y quien usa teclado no ve por qué.
    expect(moverEnMenu(MENUS, abierto, 'ArrowDown')?.estado.comando).toBe(2);
  });

  it('el desplegable da la vuelta al llegar al final', () => {
    const ultimo: EstadoMenu = { abierto: 'archivo', menu: 0, comando: 3 };
    expect(moverEnMenu(MENUS, ultimo, 'ArrowDown')?.estado.comando).toBe(0);
    expect(moverEnMenu(MENUS, abierto, 'ArrowUp')?.estado.comando).toBe(3);
  });

  it('Inicio y Fin van al primer y último comando utilizable', () => {
    const medio: EstadoMenu = { abierto: 'archivo', menu: 0, comando: 2 };
    expect(moverEnMenu(MENUS, medio, 'Home')?.estado.comando).toBe(0);
    expect(moverEnMenu(MENUS, medio, 'End')?.estado.comando).toBe(3);
  });

  it('las flechas horizontales cambian de menú y lo dejan desplegado', () => {
    // Así se recorre la barra entera leyendo lo que hay dentro de cada menú, sin
    // cerrar y abrir a mano en cada paso.
    expect(moverEnMenu(MENUS, abierto, 'ArrowRight')?.estado).toEqual({
      abierto: 'edicion',
      menu: 1,
      comando: 0,
    });
  });

  it('Entrar ejecuta el comando y cierra el menú', () => {
    // Si se quedara abierto taparía el efecto de lo que se acaba de pedir.
    const resultado = moverEnMenu(MENUS, abierto, 'Enter');
    expect(resultado?.activar).toBe('imagen');
    expect(resultado?.estado.abierto).toBeNull();
    expect(resultado?.estado.comando).toBe(-1);
  });

  it('el espacio activa igual que Entrar', () => {
    expect(moverEnMenu(MENUS, abierto, ' ')?.activar).toBe('imagen');
  });

  it('Entrar sobre un comando deshabilitado no ejecuta nada ni cierra', () => {
    const sobreDeshabilitado: EstadoMenu = { abierto: 'archivo', menu: 0, comando: 1 };
    const resultado = moverEnMenu(MENUS, sobreDeshabilitado, 'Enter');
    expect(resultado?.activar).toBeUndefined();
    expect(resultado?.estado.abierto).toBe('archivo');
  });

  it('Escape cierra el menú y deja el foco en su rótulo, sin salir de la barra', () => {
    const resultado = moverEnMenu(MENUS, abierto, 'Escape');
    expect(resultado).toEqual({ estado: { abierto: null, menu: 0, comando: -1 } });
    expect(resultado?.salir).toBeUndefined();
  });

  it('una letra salta al comando que empieza por ella', () => {
    const enVer: EstadoMenu = { abierto: 'ver', menu: 2, comando: 0 };
    expect(moverEnMenu(MENUS, enVer, 'p')?.estado.comando).toBe(1);
  });

  it('una letra que no coincide con nada deja el foco donde estaba', () => {
    const enVer: EstadoMenu = { abierto: 'ver', menu: 2, comando: 0 };
    expect(moverEnMenu(MENUS, enVer, 'z')?.estado).toEqual(enVer);
  });
});

describe('moverEnMenu — lo que no le incumbe', () => {
  it('una tecla que el menú no usa no se consume', () => {
    // Devolver null es lo que deja que Suprimir y F2 lleguen a los atajos del
    // editor en vez de morir dentro de la barra.
    expect(moverEnMenu(MENUS, cerrado(), 'Delete')).toBeNull();
    expect(moverEnMenu(MENUS, cerrado(), 'F2')).toBeNull();
    expect(moverEnMenu(MENUS, cerrado(), 'Tab')).toBeNull();
  });

  it('una barra sin menús no rompe nada', () => {
    expect(moverEnMenu([], cerrado(), 'ArrowDown')).toBeNull();
  });

  it('un índice de menú fuera de rango se recoloca en vez de reventar', () => {
    // El número de menús cambia con los permisos: quien solo lee no tiene
    // «Archivo ▸ Importar», y un estado guardado puede apuntar más allá.
    const resultado = moverEnMenu(MENUS, { abierto: null, menu: 99, comando: -1 }, 'ArrowDown');
    expect(resultado?.estado.abierto).toBe('ver');
  });

  it('un menú entero deshabilitado no deja el foco en ninguna parte', () => {
    const soloDeshabilitados: MenuDesplegable[] = [
      {
        id: 'x',
        etiqueta: 'Xxx',
        comandos: [{ id: 'a', etiqueta: 'A', deshabilitado: true }],
      },
    ];
    expect(moverEnMenu(soloDeshabilitados, cerrado(), 'ArrowDown')?.estado.comando).toBe(-1);
  });
});
