import type { Participante } from '../hooks/usePresencia';
import { nombrarAutores } from './movil-ajenos';

/**
 * Quién más está dentro, contado para una barra de 320 px.
 *
 * ## Los dos fallos que arregla
 *
 * El primero es de sitio. `IndicadorSync` pinta **una ficha por participante sin
 * tope**, y en un escritorio eso está bien porque la barra de estado es tan ancha
 * como la ventana. En la barra del móvil comparten 320 px con el botón del cajón,
 * el nombre del proyecto y el estado de la conexión: con cinco personas dentro,
 * las fichas empujan y lo que se recorta es el nombre del proyecto hasta dejarlo
 * en dos letras. La cuenta se rompe justo cuando hay mucha gente, que es cuando
 * más importa saber quién.
 *
 * El segundo es de fondo, y es el que de verdad pedía el encargo. Una ficha es un
 * círculo de color con una inicial, y el nombre completo está en un `title`. En un
 * teléfono **no hay `hover`**: ese `title` no se abre nunca. O sea que la
 * presencia en el móvil no era ilegible por estrecha, era ilegible por diseño —un
 * disco azul con una «A» no dice quién es— y ensancharla no lo habría arreglado.
 * Por eso el grupo pasa a ser un botón que abre la lista con los nombres.
 *
 * ## Lo que no se toca
 *
 * El estado de la conexión sigue en palabras y no se reduce a un punto de color
 * para ganar sitio, aunque el sitio hace falta. Está decidido y escrito en
 * `IndicadorSync`: en una aplicación que sigue funcionando sin red, el punto de
 * color es algo que hay que aprenderse y la palabra no. Cambiarlo aquí daría una
 * interfaz donde el estado se lee en el portátil y se adivina en el teléfono, que
 * es al revés de donde se pierde la cobertura.
 *
 * ## Por qué el número de fichas es una constante y no una cuenta de píxeles
 *
 * Se podría medir el ancho disponible y ver cuántas caben. Sería más ajustado y
 * bastante peor: el número cambiaría al escribir en el nombre del proyecto o al
 * pasar de «En directo» a «Poniéndose al día…», y las fichas bailarían de sitio
 * mientras se trabaja. Un tope fijo deja la barra quieta, y lo que sobra se dice
 * con un número, que ocupa lo mismo con seis personas que con sesenta.
 */

/**
 * Cuántas fichas se pintan antes de resumir el resto en un número.
 *
 * Tres, no cinco. Con el botón del cajón (44 px), el estado de la conexión en su
 * peor caso («Poniéndose al día…») y el margen, tres fichas dejan sitio para que
 * el nombre del proyecto siga siendo reconocible, que es lo único para lo que
 * sirve estando ahí.
 */
export const FICHAS_VISIBLES = 3;

export interface Presencia {
  /** Las que se dibujan, en el orden en que llegaron. */
  fichas: Participante[];
  /** Cuántas no caben. Cero cuando caben todas. */
  sobran: number;
  /** El rótulo accesible del grupo, que es también lo que anuncia el lector. */
  rotulo: string;
}

/**
 * La inicial de una ficha.
 *
 * El nombre sale de `displayName` o del correo de quien se registró, así que es
 * texto libre de verdad: puede venir vacío, puede empezar por un espacio y puede
 * ser un correo entero. `slice(0, 1)` a secas daba una ficha con un hueco blanco
 * dentro, indistinguible de un error de pintado.
 *
 * El interrogante no es un pictograma decorativo: es lo que se pone cuando no hay
 * nada que poner, y es preferible a un círculo vacío porque un círculo vacío
 * parece que la aplicación se ha dejado algo a medias.
 */
export function inicialDe(nombre: string): string {
  const limpio = nombre.trim();
  return limpio.length === 0 ? '?' : limpio.slice(0, 1).toUpperCase();
}

/**
 * El nombre que se lee en la lista.
 *
 * Un nombre vacío se sustituye por algo pronunciable. «Alguien sin nombre» no es
 * un relleno simpático: es información, dice que esa sesión no tiene nombre de
 * usuario puesto, que es un caso real en un proyecto compartido por enlace.
 */
export function nombreLegible(nombre: string): string {
  const limpio = nombre.trim();
  return limpio.length === 0 ? 'Alguien sin nombre' : limpio;
}

/**
 * Cuántas fichas se pintan, cuántas sobran y qué se anuncia.
 *
 * El rótulo se construye aquí y no en el componente porque es la frase que oye
 * quien no ve los colores, y es la única versión de esta información que existe
 * para esa persona. Dejarla en el `.tsx` la convierte en una cadena que nadie
 * prueba.
 */
export function resumirPresencia(participantes: readonly Participante[]): Presencia {
  const fichas = participantes.slice(0, FICHAS_VISIBLES);
  const sobran = Math.max(0, participantes.length - FICHAS_VISIBLES);
  return { fichas: [...fichas], sobran, rotulo: rotuloDePresencia(participantes) };
}

/**
 * La frase del grupo de presencia.
 *
 * Dice el número y luego los nombres, en ese orden y no al revés: el número es lo
 * que se quiere saber de un vistazo —«¿hay alguien más?»— y los nombres son el
 * detalle. Un lector de pantalla lee de principio a fin, así que lo que va
 * primero es lo que se oye antes de decidir si merece la pena seguir escuchando.
 */
export function rotuloDePresencia(participantes: readonly Participante[]): string {
  if (participantes.length === 0) return 'Nadie más en el proyecto ahora mismo';
  const nombres = nombrarAutores(participantes.map((p) => nombreLegible(p.nombre)));
  const cuantos =
    participantes.length === 1 ? 'Otra persona' : `Otras ${String(participantes.length)} personas`;
  return `${cuantos} en el proyecto: ${nombres}. Se abre la lista`;
}

/**
 * Qué se lee de cada participante en la lista.
 *
 * Va el nombre y, si tiene una clase abierta, cuál. Eso es lo que sustituye a la
 * visión periférica: en un portátil se ve el contorno de color alrededor de la
 * caja que otro tiene seleccionada, y en un teléfono esa caja está fuera de la
 * pantalla la mayor parte del tiempo. Saber que alguien está *en `Pedido`* es lo
 * que evita ponerse a editar `Pedido` a la vez.
 *
 * El nombre de la clase se recibe resuelto en lugar de recibir el diagrama
 * entero: este módulo no debe saber cómo está guardado un diagrama, y una clase
 * que ya no existe —porque la acaban de borrar— tiene que poder quedarse sin
 * nombre sin que aquí haya que decidir qué hacer con eso.
 */
export interface Presente {
  clientId: number;
  nombre: string;
  color: string;
  /** La clase que tiene abierta, ya resuelta a su nombre, o `null`. */
  en: string | null;
  /** La línea entera, para el lector de pantalla. */
  linea: string;
}

export function listarPresentes(
  participantes: readonly Participante[],
  nombreDeClase: (id: string) => string | null,
): Presente[] {
  return participantes.map((p) => {
    const nombre = nombreLegible(p.nombre);
    const en = p.seleccion === null ? null : nombreDeClase(p.seleccion);
    return {
      clientId: p.clientId,
      nombre,
      color: p.color,
      en,
      linea: en === null ? nombre : `${nombre}, en ${en}`,
    };
  });
}
