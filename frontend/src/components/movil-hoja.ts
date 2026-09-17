/**
 * La hoja que sube desde abajo, y el teclado que intenta taparla.
 *
 * En el escritorio las propiedades de una clase viven en una columna acoplada a
 * la derecha: está siempre ahí, no tapa el lienzo y nadie tiene que decidir
 * cuánto ocupa. En un teléfono esa columna no cabe —son 320 px de ancho en
 * total— así que lo que en el escritorio es una columna aquí es una hoja que
 * sube desde el canto inferior, que es además donde está el pulgar.
 *
 * Eso trae dos problemas que en el escritorio no existen, y los dos se resuelven
 * aquí en vez de en el `.tsx`, porque son aritmética y la aritmética se prueba
 * sin navegador.
 *
 * ## El primero: cuánto sube
 *
 * Una hoja que se queda donde la soltaron es una hoja que casi siempre está en
 * un sitio inútil: tapando tres cuartos del diagrama, o enseñando dos líneas y
 * media de una lista de atributos. Por eso hay tres posiciones de reposo y el
 * arrastre siempre acaba en una de ellas. Cuál, lo decide `destinoAlSoltar`, y
 * no lo decide solo por la altura: un empujón rápido hacia abajo cierra la hoja
 * aunque el dedo la haya soltado arriba del todo, porque esa es la intención que
 * expresa el gesto y exigir que además la baje entera convierte «cerrar» en un
 * arrastre largo.
 *
 * ## El segundo: el teclado
 *
 * Este es **el fallo clásico de los formularios en un móvil** y merece que quede
 * escrito con detalle, porque no se ve nunca en un navegador de escritorio y se
 * ve siempre en un teléfono.
 *
 * Al tocar un campo de texto, Android levanta el teclado sobre la mitad inferior
 * de la pantalla. La ventana —`window.innerHeight`— **no cambia**: lo que cambia
 * es el *viewport visual*, la parte que de verdad se está viendo. Una hoja
 * anclada al canto inferior de la ventana se queda, por tanto, debajo del
 * teclado, y con ella el campo en el que se acaba de tocar. El usuario ve
 * aparecer el teclado y desaparecer aquello que iba a escribir.
 *
 * Las dos piezas que lo arreglan son `alturaMaximaConTeclado` —la hoja deja de
 * medirse contra la ventana y pasa a medirse contra lo que se ve— y
 * `desplazamientoPorTeclado`, que dice cuánto hay que subir el contenido para
 * que el campo enfocado quede por encima del teclado y no justo pegado a él.
 *
 * Nada de esto toca el DOM. El `.tsx` lee `visualViewport` y le pasa los números
 * a estas funciones.
 */

/** Dónde puede descansar la hoja. */
export type PosicionHoja = 'oculta' | 'media' | 'completa';

/**
 * La franja de agarre de arriba de la hoja, en píxeles CSS.
 *
 * Es lo único que queda a la vista cuando la hoja está «oculta», y por eso no
 * puede ser un adorno de 4 px: es un objetivo táctil, y el sitio por el que se
 * vuelve a abrir la ficha sin tener que buscar el botón de la barra.
 */
export const ALTURA_ASIDERO = 28;

/**
 * Las dos alturas de reposo, en fracción del alto disponible.
 *
 * «Media» es 0,45 y no 0,5 a propósito: con la mitad justa, la hoja y el trozo
 * de lienzo que queda arriba miden lo mismo, y entonces no se lee cuál de los
 * dos manda. Dejando el lienzo algo mayor se entiende que la hoja está *sobre*
 * el diagrama y que el diagrama sigue siendo lo principal.
 *
 * «Completa» es 0,92 y no 1: la rendija de lienzo que queda arriba es la que
 * dice que hay algo detrás y que se puede volver. Una hoja a pantalla completa
 * es una pantalla nueva, y entonces habría que darle un botón de «atrás» propio
 * y explicar por qué el botón atrás del sistema no hace lo mismo.
 */
export const FRACCION_MEDIA = 0.45;
export const FRACCION_COMPLETA = 0.92;

/**
 * A partir de cuántos píxeles perdidos se considera que hay un teclado.
 *
 * El viewport visual encoge por más motivos que el teclado: en Chrome de Android
 * la barra de direcciones se repliega al desplazar y eso son unos 56 px. Si el
 * umbral fuera cero, ese repliegue se interpretaría como un teclado abriéndose y
 * la hoja daría un salto cada vez que alguien desplaza la lista de atributos.
 *
 * Ciento veinte píxeles está cómodamente por encima de cualquier barra del
 * navegador y cómodamente por debajo del teclado más bajo que se ve en la
 * práctica —un teclado numérico apaisado ronda los 200—.
 */
export const REDUCCION_MINIMA_TECLADO = 120;

/**
 * Velocidad a partir de la cual manda el impulso y no la posición, en px/s.
 *
 * Seiscientos es aproximadamente el arrastre deliberado más rápido que alguien
 * hace sin querer lanzar nada. Por debajo se entiende «colócala aquí» y se busca
 * la posición más cercana; por encima, «mándala en esta dirección».
 */
export const VELOCIDAD_DE_IMPULSO = 600;

export interface Ventana {
  /** `window.innerHeight`: no cambia cuando se abre el teclado. */
  alto: number;
  /** `visualViewport.height`: lo que de verdad se está viendo. */
  altoVisible: number;
}

/** ¿Hay un teclado levantado ahora mismo? */
export function tecladoAbierto(ventana: Ventana): boolean {
  return ventana.alto - ventana.altoVisible >= REDUCCION_MINIMA_TECLADO;
}

/**
 * Lo que la hoja puede ocupar como máximo.
 *
 * Sin teclado es el alto de la ventana. Con teclado es lo que se ve, y esa
 * diferencia es justo la que evita que la hoja se extienda por debajo de las
 * teclas. Nótese que no se resta el teclado «por si acaso»: se usa la medida
 * real que da el navegador, porque la altura del teclado depende del idioma, de
 * si hay barra de sugerencias y de si el usuario lo ha redimensionado.
 */
export function alturaMaximaConTeclado(ventana: Ventana): number {
  return tecladoAbierto(ventana) ? ventana.altoVisible : ventana.alto;
}

/** A cuántos píxeles de alto corresponde cada posición de reposo. */
export function alturaDe(posicion: PosicionHoja, ventana: Ventana): number {
  const disponible = alturaMaximaConTeclado(ventana);
  if (posicion === 'oculta') return ALTURA_ASIDERO;
  if (posicion === 'media') return Math.round(disponible * FRACCION_MEDIA);
  return Math.round(disponible * FRACCION_COMPLETA);
}

/**
 * Un arrastre de la hoja en curso.
 *
 * Se guarda la altura de partida y el punto donde se agarró, y no un acumulado
 * de incrementos. Es la misma decisión que en las asas del recorte de la cámara
 * y por el mismo motivo: acumulando incrementos, un arrastre que llega al tope y
 * vuelve deja la hoja desplazada respecto al dedo para siempre, porque los
 * píxeles que se recortaron contra el tope no se devuelven al volver.
 */
export interface ArrastreHoja {
  alturaInicial: number;
  /** La `y` de pantalla donde se posó el dedo. */
  yInicial: number;
}

/**
 * Qué altura tiene la hoja mientras el dedo la lleva.
 *
 * La `y` crece hacia abajo y la altura crece hacia arriba, de ahí el signo.
 */
export function alturaArrastrada(
  arrastre: ArrastreHoja,
  yActual: number,
  ventana: Ventana,
): number {
  const bruta = arrastre.alturaInicial + (arrastre.yInicial - yActual);
  const techo = alturaDe('completa', ventana);
  return Math.min(Math.max(bruta, 0), techo);
}

/**
 * Dónde se queda la hoja al levantar el dedo.
 *
 * @param velocidad px/s; **positiva hacia abajo**, que es como vienen las `y` de
 * pantalla. Un valor positivo grande es un manotazo para cerrar.
 */
export function destinoAlSoltar(
  altura: number,
  velocidad: number,
  ventana: Ventana,
): PosicionHoja {
  const orden: PosicionHoja[] = ['oculta', 'media', 'completa'];

  if (Math.abs(velocidad) >= VELOCIDAD_DE_IMPULSO) {
    // Con impulso no se busca la más cercana sino la siguiente en la dirección
    // del gesto. Sin esta rama, un manotazo hacia abajo que apenas ha movido la
    // hoja devolvería «la más cercana», que es la posición de la que se venía:
    // la hoja se quedaría clavada y el gesto no habría hecho nada. Cerrar
    // pasaría a exigir un arrastre lento hasta abajo del todo.
    const actual = posicionMasCercana(altura, ventana);
    const indice = orden.indexOf(actual);
    const siguiente = velocidad > 0 ? indice - 1 : indice + 1;
    return orden[Math.min(Math.max(siguiente, 0), orden.length - 1)] as PosicionHoja;
  }

  return posicionMasCercana(altura, ventana);
}

/**
 * La posición de reposo cuya altura se parece más a la dada.
 *
 * Separada y exportada porque es lo que hay que llamar cuando la hoja cambia de
 * tamaño sin que nadie la arrastre: al girar el teléfono, o al abrirse el
 * teclado. En esos dos casos la hoja debe quedarse en la posición *conceptual*
 * en la que estaba —«a media altura»— y no en los píxeles que medía antes, que
 * ya no significan lo mismo.
 */
export function posicionMasCercana(altura: number, ventana: Ventana): PosicionHoja {
  const candidatas: PosicionHoja[] = ['oculta', 'media', 'completa'];
  let mejor: PosicionHoja = 'oculta';
  let distancia = Infinity;
  for (const c of candidatas) {
    const d = Math.abs(alturaDe(c, ventana) - altura);
    if (d < distancia) {
      distancia = d;
      mejor = c;
    }
  }
  return mejor;
}

/** Dónde está un campo de texto respecto al borde de arriba del viewport. */
export interface CampoEnfocado {
  arriba: number;
  alto: number;
}

/**
 * El aire que se deja entre el campo y el borde del teclado, en píxeles.
 *
 * Sin margen el campo queda exactamente pegado a las teclas y *técnicamente*
 * visible, pero no se ve lo que se escribe: el cursor y la línea de texto caen
 * en el último par de píxeles, y en un teléfono sujeto en la mano eso queda
 * tapado por la propia sombra del dedo que está tecleando.
 */
export const MARGEN_SOBRE_TECLADO = 12;

/**
 * Cuánto hay que subir el contenido para que el campo enfocado se vea.
 *
 * Devuelve 0 cuando no hace falta mover nada, que es el caso normal: el campo ya
 * está por encima del teclado. Nunca devuelve un valor negativo, porque esto
 * sube contenido y no lo baja —bajarlo sería apartar de la vista algo que el
 * usuario está mirando para acercar algo que ya veía—.
 *
 * El tope es `campo.arriba`: desplazar más que eso metería el principio del
 * campo por encima del borde de arriba. Con un campo más alto que el hueco que
 * deja el teclado hay que elegir qué mitad se sacrifica, y se sacrifica la de
 * abajo: en un campo de texto lo que importa es la primera línea y la etiqueta
 * que dice de qué campo se trata.
 */
export function desplazamientoPorTeclado(
  campo: CampoEnfocado,
  ventana: Ventana,
  margen: number = MARGEN_SOBRE_TECLADO,
): number {
  if (!tecladoAbierto(ventana)) return 0;
  const abajo = campo.arriba + campo.alto;
  const sobrante = abajo + margen - ventana.altoVisible;
  if (sobrante <= 0) return 0;
  return Math.min(sobrante, Math.max(campo.arriba, 0));
}

/**
 * ¿Queda el campo a la vista después de aplicar el desplazamiento?
 *
 * Existe para que la prueba pueda afirmar la propiedad que de verdad importa
 * —«el teclado no tapa el campo»— en vez de un número concreto de píxeles, que
 * es lo que se rompe al cambiar cualquier constante sin que la prueba diga nada
 * útil. El `.tsx` no la usa.
 */
export function campoVisible(
  campo: CampoEnfocado,
  ventana: Ventana,
  desplazamiento: number,
): boolean {
  const arriba = campo.arriba - desplazamiento;
  const abajo = arriba + campo.alto;
  return arriba >= 0 && abajo <= ventana.altoVisible;
}
