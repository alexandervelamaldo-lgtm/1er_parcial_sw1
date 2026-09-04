import type { NombreIcono } from './iconos';

/**
 * La barra de menú, sin React.
 *
 * Es lo que faltaba para que esto se pareciera a una herramienta de modelado y
 * no a una página con botones: Archivo, Edición, Ver, Proyecto, Ayuda, con el
 * atajo escrito a la derecha de cada orden. Un menú enseña de golpe todo lo que
 * el programa sabe hacer y dónde vive cada cosa; una fila de botones solo enseña
 * lo que cupo.
 *
 * Igual que con el árbol, las reglas del teclado viven aquí y no en el
 * componente. Un menú accesible tiene bastantes más reglas de las que parece
 * —abrir con la flecha de abajo dejando el foco en el primer comando, cerrar con
 * Escape devolviendo el foco al rótulo, saltarse los comandos deshabilitados,
 * dar la vuelta al llegar al final— y todas se pueden equivocar en silencio.
 * Separadas en una función pura se comprueban sin navegador.
 */

export interface ComandoMenu {
  id: string;
  etiqueta: string;
  /** El atajo, tal y como se escribe a la derecha: «Ctrl+Z». */
  atajo?: string;
  icono?: NombreIcono;
  /** Traza una línea encima; agrupa órdenes que se parecen. */
  separadorAntes?: boolean;
  deshabilitado?: boolean;
  /**
   * Para las órdenes que se marcan en vez de ejecutarse —mostrar un panel,
   * cambiar el tema—. Sale con la casilla puesta y se anuncia con
   * `aria-checked`, que es lo que distingue «Ver ▸ Propiedades» de «Archivo ▸
   * Exportar»: la primera dice un estado, la segunda hace algo.
   */
  marcado?: boolean;
}

export interface MenuDesplegable {
  id: string;
  etiqueta: string;
  comandos: ComandoMenu[];
}

export interface EstadoMenu {
  /** Identificador del menú desplegado, o `null` si la barra está cerrada. */
  abierto: string | null;
  /** Menú de la barra que tiene el foco. Siempre válido. */
  menu: number;
  /** Comando enfocado dentro del desplegable; -1 cuando el foco está en la barra. */
  comando: number;
}

export interface ResultadoMenu {
  estado: EstadoMenu;
  /** Identificador del comando que hay que ejecutar, si la tecla lo activa. */
  activar?: string;
  /** Escape con la barra ya cerrada: el foco se va de la barra al lienzo. */
  salir?: boolean;
}

export function estadoInicial(): EstadoMenu {
  return { abierto: null, menu: 0, comando: -1 };
}

/** Los separadores y los deshabilitados no reciben foco. */
function utilizable(comando: ComandoMenu | undefined): boolean {
  return comando !== undefined && comando.deshabilitado !== true;
}

/**
 * Busca el siguiente comando que se pueda enfocar, dando la vuelta.
 *
 * Un menú sí da la vuelta, al revés que el árbol. No es una incoherencia: en una
 * lista larga envolver desorienta porque no se sabe cuánto queda, pero un
 * desplegable de seis órdenes se abarca de un vistazo y llegar al final y
 * reaparecer arriba es lo que hacen todos los menús desde hace treinta años.
 */
function siguienteUtil(comandos: ComandoMenu[], desde: number, paso: number): number {
  const total = comandos.length;
  if (total === 0) return -1;
  // Sin foco dentro (-1), bajar entra por el primero y subir por el último.
  const inicio = desde >= 0 ? desde : paso > 0 ? -1 : 0;
  for (let i = 1; i <= total; i += 1) {
    const indice = (((inicio + paso * i) % total) + total) % total;
    if (utilizable(comandos[indice])) return indice;
  }
  return -1;
}

function primeroUtil(comandos: ComandoMenu[]): number {
  return comandos.findIndex(utilizable);
}

function ultimoUtil(comandos: ComandoMenu[]): number {
  for (let i = comandos.length - 1; i >= 0; i -= 1) if (utilizable(comandos[i])) return i;
  return -1;
}

/** Abre el menú `indice` con el foco en su primer o último comando. */
function abrir(menus: MenuDesplegable[], indice: number, extremo: 'primero' | 'ultimo'): EstadoMenu {
  const menu = menus[indice];
  if (!menu) return estadoInicial();
  const comandos = menu.comandos;
  return {
    abierto: menu.id,
    menu: indice,
    comando: extremo === 'primero' ? primeroUtil(comandos) : ultimoUtil(comandos),
  };
}

/**
 * A dónde va el foco al pulsar una tecla dentro de la barra de menú.
 *
 * Devuelve `null` cuando la tecla no le incumbe, para que Suprimir, F2 y los
 * atajos del editor sigan llegando a quien los espera.
 */
export function moverEnMenu(
  menus: MenuDesplegable[],
  estado: EstadoMenu,
  tecla: string,
): ResultadoMenu | null {
  if (menus.length === 0) return null;
  const indiceMenu = Math.min(Math.max(estado.menu, 0), menus.length - 1);
  const menu = menus[indiceMenu];
  if (!menu) return null;
  const abiertoAqui = estado.abierto === menu.id;

  switch (tecla) {
    /*
      Las flechas horizontales cambian de menú aunque haya uno desplegado, y el
      nuevo se despliega solo. Es lo que hace que se pueda recorrer la barra
      entera leyendo lo que hay dentro de cada menú sin cerrar y abrir a mano.
    */
    case 'ArrowRight':
    case 'ArrowLeft': {
      const paso = tecla === 'ArrowRight' ? 1 : -1;
      const destino = (indiceMenu + paso + menus.length) % menus.length;
      if (estado.abierto === null) return { estado: { ...estado, menu: destino, comando: -1 } };
      return { estado: abrir(menus, destino, 'primero') };
    }

    case 'ArrowDown':
      if (!abiertoAqui) return { estado: abrir(menus, indiceMenu, 'primero') };
      return {
        estado: { ...estado, menu: indiceMenu, comando: siguienteUtil(menu.comandos, estado.comando, 1) },
      };

    case 'ArrowUp':
      if (!abiertoAqui) return { estado: abrir(menus, indiceMenu, 'ultimo') };
      return {
        estado: { ...estado, menu: indiceMenu, comando: siguienteUtil(menu.comandos, estado.comando, -1) },
      };

    case 'Home':
      if (!abiertoAqui) return { estado: { ...estado, menu: 0, comando: -1 } };
      return { estado: { ...estado, comando: primeroUtil(menu.comandos) } };

    case 'End':
      if (!abiertoAqui) return { estado: { ...estado, menu: menus.length - 1, comando: -1 } };
      return { estado: { ...estado, comando: ultimoUtil(menu.comandos) } };

    case 'Enter':
    case ' ': {
      if (!abiertoAqui) return { estado: abrir(menus, indiceMenu, 'primero') };
      const comando = menu.comandos[estado.comando];
      if (!utilizable(comando) || !comando) return { estado };
      // Al ejecutar se cierra: si el menú se quedara abierto taparía el efecto de
      // lo que se acaba de pedir, que es lo único que se quiere ver.
      return { estado: { abierto: null, menu: indiceMenu, comando: -1 }, activar: comando.id };
    }

    case 'Escape':
      // Escape con un menú abierto lo cierra y deja el foco en su rótulo, no en
      // ninguna parte: quien se equivocó de menú abre el de al lado con una
      // flecha. Con la barra ya cerrada, sale de la barra.
      if (estado.abierto !== null) {
        return { estado: { abierto: null, menu: indiceMenu, comando: -1 } };
      }
      return { estado, salir: true };

    default: {
      /*
        Escribir una letra salta a la orden que empieza por ella. Es la forma más
        rápida de usar un menú con el teclado y no cuesta nada: solo se atiende
        una letra suelta, así que Ctrl+Z sigue siendo Ctrl+Z.
      */
      if (tecla.length !== 1 || !/\p{L}/u.test(tecla)) return null;
      const letra = tecla.toLowerCase();
      if (abiertoAqui) {
        const desde = estado.comando;
        for (let i = 1; i <= menu.comandos.length; i += 1) {
          const indice = (desde + i + menu.comandos.length) % menu.comandos.length;
          const candidato = menu.comandos[indice];
          if (utilizable(candidato) && candidato?.etiqueta.toLowerCase().startsWith(letra)) {
            return { estado: { ...estado, comando: indice } };
          }
        }
        return { estado };
      }
      const destino = menus.findIndex((m) => m.etiqueta.toLowerCase().startsWith(letra));
      if (destino < 0) return null;
      return { estado: abrir(menus, destino, 'primero') };
    }
  }
}
