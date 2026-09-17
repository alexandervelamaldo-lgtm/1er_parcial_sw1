/**
 * Mantener pulsado una clase para abrir su menú.
 *
 * ## Por qué aquí solo hay un gesto y no cinco
 *
 * El editor móvil necesita cinco gestos: pellizcar para el zoom, un dedo para
 * desplazar, tocar para seleccionar, arrastrar desde el borde de una caja para
 * crear una relación, y mantener pulsado para el menú de la clase.
 *
 * Cuatro de los cinco **ya existen** y no los escribe este fichero. El lienzo
 * está montado sobre React Flow, que trae el pellizco y el desplazamiento de
 * serie sobre eventos de puntero, la selección por `onNodeClick`/`onPaneClick`,
 * y el tirón desde las asas de la caja por `onConnect` —eso último se arregló al
 * poner `ConnectionMode.Loose`, y está contado en `LienzoFlow.tsx`—. Volver a
 * implementarlos aquí no sería reutilizar menos código: sería tener **dos**
 * motores de gestos compitiendo por los mismos eventos de puntero sobre el mismo
 * elemento, que es la receta conocida para que el zoom se pelee con el arrastre
 * y el resultado dependa de cuál escuchó primero.
 *
 * El que falta es el quinto. React Flow no tiene noción de «mantener pulsado»
 * —en un escritorio eso es el botón derecho— y es justo el gesto con más formas
 * de salir mal, así que es el que merece un módulo probado.
 *
 * ## Las cuatro formas de equivocarse
 *
 * Un «mantener pulsado» mal hecho no falla: hace algo distinto de lo que se le
 * pidió, que es peor porque parece que la aplicación tiene voluntad propia.
 *
 * 1. **Que salte después de levantar el dedo.** Es el fallo de no cancelar el
 *    temporizador. El usuario toca una clase, la selecciona, sigue a lo suyo, y
 *    medio segundo después le aparece un menú encima de lo que estaba mirando.
 * 2. **Que no salte nunca, porque el dedo se mueve.** Un dedo apoyado en el
 *    cristal no está quieto: tiembla y rueda sobre la yema. Con tolerancia cero
 *    el gesto no se consigue ni queriendo.
 * 3. **Que salte a media pinza.** Se posa un dedo sobre una clase, se posa el
 *    segundo para hacer zoom, y como el primero no se ha movido, salta el menú
 *    en mitad del pellizco.
 * 4. **Que salte al arrastrar la caja.** Mover una clase empieza exactamente
 *    igual que mantenerla pulsada: un dedo encima y quieto durante un instante.
 *    Lo que los separa es si llega a moverse antes de que se cumpla el plazo.
 *
 * Las cuatro están puestas como prueba. Ninguna necesita navegador, porque el
 * tiempo entra como un número en vez de leerse del reloj.
 */

/**
 * Cuánto hay que aguantar, en milisegundos.
 *
 * Medio segundo es lo que usan Android y iOS para su propio menú contextual, y
 * conviene no apartarse: el usuario ya tiene calibrado ese plazo con el resto
 * del teléfono. Más corto y salta al seleccionar; más largo y da la sensación de
 * que no responde, porque a los 500 ms uno ya está esperando algo.
 */
export const MS_MANTENIDO = 500;

/**
 * Cuánto se le permite temblar al dedo, en píxeles CSS.
 *
 * Diez es algo menos que el umbral con el que un navegador decide que un toque
 * pasó a ser un arrastre, y eso es a propósito: si aquí se admitiera más
 * movimiento que allí, habría un margen en el que React Flow ya está moviendo la
 * caja y este módulo todavía cree que el dedo está quieto. Saldrían las dos
 * cosas a la vez —la clase desplazada y el menú abierto encima—.
 */
export const TOLERANCIA_MANTENIDO = 10;

export type EstadoMantenido =
  /** No hay ningún dedo que pueda acabar en menú. */
  | { fase: 'quieto' }
  /** Hay un dedo posado sobre una clase, contando. */
  | {
      fase: 'esperando';
      puntero: number;
      x: number;
      y: number;
      desde: number;
      clase: string;
    }
  /** El plazo se cumplió: el menú de esta clase está pedido. */
  | { fase: 'disparado'; clase: string };

export const QUIETO: EstadoMantenido = { fase: 'quieto' };

export type SucesoGesto =
  | {
      tipo: 'posar';
      puntero: number;
      x: number;
      y: number;
      /** La clase que hay debajo del dedo, o `null` si es el fondo del lienzo. */
      clase: string | null;
      ahora: number;
    }
  | { tipo: 'mover'; puntero: number; x: number; y: number }
  | { tipo: 'levantar'; puntero: number }
  /** El navegador se llevó el puntero: una llamada entrante, un gesto del sistema. */
  | { tipo: 'cancelar' }
  /** El temporizador del `.tsx` comprobando si ya toca. */
  | { tipo: 'tictac'; ahora: number };

function lejos(estado: { x: number; y: number }, x: number, y: number): boolean {
  // Distancia al cuadrado, para no calcular una raíz por cada evento de
  // movimiento. En un arrastre llegan decenas por segundo.
  const dx = x - estado.x;
  const dy = y - estado.y;
  return dx * dx + dy * dy > TOLERANCIA_MANTENIDO * TOLERANCIA_MANTENIDO;
}

/**
 * La máquina entera, en una función pura.
 *
 * Devolver siempre un estado nuevo —y no mutar el que entra— es lo que permite
 * que el `.tsx` la use con `useState` sin pensar, y lo que permite que la prueba
 * encadene sucesos y mire el resultado sin montar nada.
 */
export function siguiente(estado: EstadoMantenido, suceso: SucesoGesto): EstadoMantenido {
  switch (suceso.tipo) {
    case 'posar': {
      /*
        Un segundo dedo cancela. Es el caso 3: el primero lleva un rato quieto
        sobre una clase y el segundo llega para hacer zoom. Si esto no estuviera,
        el menú saltaría en mitad del pellizco, y además sobre la clase que el
        usuario estaba intentando ver más de cerca.

        Se cancela también cuando ya se había disparado: cerrar el menú al
        empezar un pellizco es lo que uno espera, porque el gesto dice
        claramente que ahora se quiere mirar el diagrama.
      */
      if (estado.fase !== 'quieto') return QUIETO;

      // En el fondo del lienzo no hay menú que abrir. Mantener pulsado ahí no
      // hace nada, que es mejor que inventarse un menú de «lienzo» que nadie
      // ha pedido y que aparecería cada vez que alguien apoya el pulgar para
      // sujetar el teléfono.
      if (suceso.clase === null) return QUIETO;

      return {
        fase: 'esperando',
        puntero: suceso.puntero,
        x: suceso.x,
        y: suceso.y,
        desde: suceso.ahora,
        clase: suceso.clase,
      };
    }

    case 'mover': {
      if (estado.fase !== 'esperando') return estado;
      // Los sucesos de otro puntero no son de este gesto. Sin esta guarda, el
      // temblor de un dedo apoyado en otra parte de la pantalla cancelaría un
      // mantenido perfectamente válido.
      if (suceso.puntero !== estado.puntero) return estado;
      // Caso 4: dejó de ser un mantenido y pasó a ser un arrastre de la caja.
      // No se actualizan `x` e `y` al tolerar el temblor: se comparan siempre
      // contra el punto donde se posó. Arrastrándolas se podría recorrer la
      // pantalla entera a pasos de nueve píxeles sin cancelar nunca.
      return lejos(estado, suceso.x, suceso.y) ? QUIETO : estado;
    }

    case 'levantar': {
      /*
        Caso 1, el importante. Levantar el dedo termina el gesto siempre: si el
        plazo no se había cumplido, esto era un toque y ya lo habrá tratado
        React Flow como selección.

        Que esto devuelva `quieto` incluso desde `disparado` es lo que impide
        que el menú se vuelva a pedir al soltar. Cerrar el menú abierto no es
        cosa de aquí: de eso se ocupa quien lo pintó.
      */
      if (estado.fase === 'esperando' && suceso.puntero !== estado.puntero) return estado;
      return QUIETO;
    }

    case 'cancelar':
      return QUIETO;

    case 'tictac': {
      if (estado.fase !== 'esperando') return estado;
      if (suceso.ahora - estado.desde < MS_MANTENIDO) return estado;
      return { fase: 'disparado', clase: estado.clase };
    }
  }
}

/**
 * La clase cuyo menú hay que abrir, si toca abrir alguno.
 *
 * Existe para que el `.tsx` no tenga que mirar dentro de la forma del estado, y
 * para que las pruebas afirmen sobre la consecuencia —«se pide el menú de
 * Cliente»— en vez de sobre el nombre de una fase interna.
 */
export function menuPedido(estado: EstadoMantenido): string | null {
  return estado.fase === 'disparado' ? estado.clase : null;
}

/**
 * ¿Hay un plazo corriendo que merezca un temporizador?
 *
 * El `.tsx` monta el `setTimeout` solo cuando esto es cierto. Es la diferencia
 * entre un temporizador por gesto y uno permanente despertándose cada cien
 * milisegundos para no hacer nada.
 */
export function cuentaAtrasViva(estado: EstadoMantenido): boolean {
  return estado.fase === 'esperando';
}
