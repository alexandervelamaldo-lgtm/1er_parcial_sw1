import { alturaDe, type PosicionHoja, type Ventana } from './movil-hoja';

/**
 * Cómo se reparte la pantalla entre el diagrama y lo que se está editando.
 *
 * ## La hoja se superpone, el panel reparte
 *
 * Es la distinción de la que sale todo lo demás, y no es de estilo:
 *
 * - Una **hoja inferior** flota sobre el lienzo. El lienzo sigue midiendo lo
 *   mismo; lo que cambia es cuánto de él se ve. Cuesta **altura visible**.
 * - Un **panel lateral** se pone al lado. El lienzo mide menos de verdad y React
 *   Flow tiene que enterarse. Cuesta **anchura real**.
 *
 * Por eso la elección entre los dos no es una preferencia estética sino una
 * cuenta: en un teléfono vertical la anchura es el recurso escaso —quitarle 360
 * px a 390 no deja diagrama— y en apaisado lo escaso es la altura, donde una hoja
 * al 45 % de un alto de 360 px deja una franja de lienzo de 200 px con el teclado
 * a punto de comerse la mitad. La misma hoja que es la solución en un caso es el
 * problema en el otro.
 *
 * ## Por qué el corte no es el de `estilos.css`
 *
 * `ANCHO_ESTRECHO` vale 820 px en `useDispositivo.ts` y aquí no se usa. No es un
 * despiste: esa cifra contesta a «¿caben las tres columnas del escritorio?», y la
 * pregunta de aquí es otra, «¿caben un panel y un lienzo que todavía se pueda
 * leer?». Son preguntas distintas y tienen respuestas distintas. Reutilizar el
 * número por ahorrarse uno nuevo ataría dos decisiones que no tienen por qué
 * moverse juntas, y el día que alguien ajuste el layout de escritorio cambiaría
 * de sitio el panel del móvil sin pretenderlo.
 *
 * ## Se decide por lo que mide la ventana, no por qué aparato es
 *
 * Aquí no se pregunta si esto es un teléfono. Se pregunta cuánto sitio hay, que
 * es lo único que importa y lo único que no miente: un plegable abierto, una
 * tablet en pantalla partida y un teléfono en apaisado dan combinaciones que
 * ninguna lista de modelos acierta. Es la misma regla que ya sigue
 * `useDispositivo.ts` —capacidad, nunca modelo—.
 *
 * Consecuencia buscada: **apaisado y tablet salen exactamente iguales**. No hay
 * una rama para cada uno porque no hay ninguna decisión en la que difieran, y
 * tener dos caminos que hacen lo mismo garantiza que un día uno se quede atrás.
 */

/**
 * Lo que ocupa el panel lateral cuando lo hay, en píxeles CSS.
 *
 * Es el ancho de la ficha de propiedades del escritorio. Más estrecho obliga a
 * partir en dos líneas los nombres de tipo —«List&lt;Pedido&gt;» y compañía— y más
 * ancho empieza a robarle al diagrama sin que la ficha lo aproveche.
 */
export const ANCHO_PANEL_LATERAL = 360;

/**
 * Lo mínimo que se le deja al diagrama para considerarlo utilizable.
 *
 * 320 px es el ancho del teléfono más estrecho que esta aplicación soporta, y la
 * idea es literal: si al poner el panel el lienzo se queda con menos de lo que
 * tendría un móvil pequeño, el panel no cabe. Sin este suelo, un apaisado de 640
 * px daría un lienzo de 280 px —peor que la hoja, que al cerrarse devuelve la
 * anchura entera— y encima de forma permanente, porque un panel no se cierra al
 * soltar.
 */
export const ANCHO_MINIMO_LIENZO = 320;

/**
 * La barra superior: proyecto, sincronización y quién más está dentro.
 *
 * Se descuenta del alto del lienzo porque es lo único que está fijo arriba. Es
 * deliberadamente una sola fila de 48 px —el objetivo táctil mínimo— y no dos:
 * cada fila de barra se paga en diagrama durante todo el tiempo, no solo mientras
 * se mira.
 */
export const ALTO_BARRA_SUPERIOR = 48;

/** Dónde acaba lo que se está editando. */
export type SitioDelDetalle = 'hoja' | 'panel';

/** La ventana, con su anchura además de las dos alturas que usa la hoja. */
export interface Pantalla extends Ventana {
  ancho: number;
}

export interface Reparto {
  sitio: SitioDelDetalle;
  /** Lo que mide el lienzo de verdad. Es lo que hay que darle a React Flow. */
  lienzo: { ancho: number; alto: number };
  /** Lo que se lleva el panel. `0` cuando el detalle va en hoja. */
  panel: number;
  /** Lo que tapa la hoja por abajo. `0` cuando el detalle va en panel. */
  hoja: number;
}

/**
 * ¿Cabe un panel al lado sin dejar el diagrama inservible?
 *
 * La suma, y no un ancho inventado: el panel más el suelo del lienzo. Escrito así
 * el umbral se mueve solo si se mueve una de las dos cifras que lo justifican, en
 * vez de quedarse en un 680 mágico que nadie sabría de dónde salió.
 */
export function cabeElPanel(pantalla: Pantalla): boolean {
  return pantalla.ancho - ANCHO_PANEL_LATERAL >= ANCHO_MINIMO_LIENZO;
}

/**
 * Dónde va lo que se está editando.
 *
 * Una sola condición, y a propósito: en cuanto hay sitio para el panel, el panel
 * gana. Un panel es mejor que una hoja siempre que quepa, porque deja ver el
 * diagrama y la ficha al mismo tiempo —que es justo lo que hace falta al corregir
 * una multiplicidad mirando la relación— y porque no hay que volver a abrirlo
 * después de cada gesto sobre el lienzo.
 */
export function sitioDelDetalle(pantalla: Pantalla): SitioDelDetalle {
  return cabeElPanel(pantalla) ? 'panel' : 'hoja';
}

/**
 * El reparto completo, que es lo que consume el `.tsx`.
 *
 * Devuelve las dos medidas del lienzo aunque el detalle esté cerrado, porque el
 * componente necesita el tamaño en los dos casos y calcularlo en dos sitios es la
 * receta para que el lienzo se quede con el tamaño del estado anterior justo
 * durante el repintado en que se abre el panel.
 */
export function repartir(
  pantalla: Pantalla,
  posicion: PosicionHoja,
  detalleAbierto: boolean,
): Reparto {
  const sitio = sitioDelDetalle(pantalla);
  const enPanel = detalleAbierto && sitio === 'panel';

  const panel = enPanel ? ANCHO_PANEL_LATERAL : 0;
  // La hoja no descuenta del lienzo: flota encima. Restarla aquí haría que el
  // diagrama se reencuadrara solo cada vez que la hoja sube o baja, y con un
  // arrastre de hoja en curso eso son decenas de reencuadres por segundo.
  const hoja = detalleAbierto && sitio === 'hoja' ? alturaDe(posicion, pantalla) : 0;

  return {
    sitio,
    lienzo: {
      ancho: Math.max(0, pantalla.ancho - panel),
      alto: Math.max(0, pantalla.altoVisible - ALTO_BARRA_SUPERIOR),
    },
    panel,
    hoja,
  };
}

/**
 * La parte del lienzo que de verdad se está viendo.
 *
 * Sirve para una cosa concreta: decidir dónde centrar la clase que se acaba de
 * tocar. Sin esto pasa el fallo más molesto de una interfaz de hojas —se pulsa
 * una clase, sube la hoja con sus propiedades, y la clase que se está editando se
 * queda detrás de la hoja—, que obliga a bajar la hoja para ver lo que se cambia
 * y volver a subirla para cambiar lo siguiente.
 *
 * Las coordenadas son relativas al lienzo, no a la ventana: quien las usa está ya
 * dentro del lienzo y sumarle la barra superior sería contarla dos veces.
 */
export function zonaVisibleDelLienzo(
  reparto: Reparto,
): { x: number; y: number; ancho: number; alto: number } {
  return {
    x: 0,
    y: 0,
    // El panel no tapa: está al lado, y el lienzo ya mide menos por él.
    ancho: reparto.lienzo.ancho,
    alto: Math.max(0, reparto.lienzo.alto - reparto.hoja),
  };
}

/**
 * Dónde poner la clase que se acaba de seleccionar.
 *
 * En el centro de lo que se ve, que con la hoja subida **no** es el centro del
 * lienzo. Se devuelve en coordenadas del lienzo para poder pasárselo a React Flow
 * sin más cuentas.
 *
 * Cuando la hoja está completa apenas queda franja visible y el centro sale muy
 * arriba. Eso es correcto y es lo que se quiere: significa «lo poco que se ve, que
 * al menos sea esto».
 */
export function centroVisible(reparto: Reparto): { x: number; y: number } {
  const zona = zonaVisibleDelLienzo(reparto);
  return { x: zona.x + zona.ancho / 2, y: zona.y + zona.alto / 2 };
}
