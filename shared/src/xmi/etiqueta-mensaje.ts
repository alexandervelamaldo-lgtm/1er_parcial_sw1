/**
 * La etiqueta de un mensaje, despiezada.
 *
 * En un diagrama de comunicación el nombre de un mensaje no es un nombre: es
 * una línea entera de notación UML con cuatro cosas pegadas delante de la
 * llamada.
 *
 *     *[i := 1..n] 2.3: total := calcular(iva, base)
 *      └iteración┘ └n┘  └asign┘ └nombre┘└argumentos┘
 *        └─guarda─┘
 *
 * Esto estaba dentro de `comunicacion.ts`, que traduce a diagrama de clases y
 * por tanto solo necesitaba el nombre y los argumentos: lo demás lo tiraba
 * según lo quitaba. El lector nuevo sí necesita el número —es lo único que
 * dice qué pasa antes que qué— y la guarda, así que el despiece está aquí,
 * devolviendo todas las piezas, y `partirMensaje` se queda como la vista
 * reducida que el lector viejo ya usaba. Duplicar las expresiones regulares en
 * dos ficheros habría sido peor: son la clase de código que se corrige en un
 * sitio y se olvida en el otro.
 *
 * SEGURIDAD (RNF-SEG-06). Aquí no se valida nada. Este módulo separa; decidir
 * si `nombre` sirve como identificador Java es de quien lo vaya a usar como
 * tal, y lo hace con lista blanca. Lo único que se hace en esa dirección es
 * marcar `sobra` cuando queda texto después del paréntesis de cierre, para que
 * nadie convierta `borrar(); DROP TABLE x` en un inocente `borrar` sin que se
 * vea el resto.
 */

/** `1`, `1.2`, `2.3.1`, `A1`, `1.2a`, seguidos de dos puntos. */
const SECUENCIA = /^([A-Za-z]?\d+(?:\.\d+)*[a-z]?)\s*:/;
/** `[i > 0]`, `*[i := 1..n]`: guardas y marcas de iteración. */
const GUARDA = /^(\*?)\s*\[([^\]]*)\]/;
/** `resultado :=` delante de la llamada. */
const ASIGNACION = /^([A-Za-z_$][\w$]*)\s*:=\s*/;
/** Un `*` suelto, sin guarda detrás: `*2: siguiente()`. */
const ITERACION = /^\*\s*/;

export interface EtiquetaDeMensaje {
  /** `2.3`, sin los dos puntos. `undefined` si la etiqueta no lo traía. */
  readonly numero: string | undefined;
  /** El contenido de los corchetes, sin ellos. */
  readonly guarda: string | undefined;
  /** Había un `*`: el mensaje se repite. */
  readonly iteracion: boolean;
  /** El nombre de la variable a la izquierda de `:=`. */
  readonly asignacion: string | undefined;
  /** El nombre de la operación. Nunca vacío: si lo fuera, esto devuelve `null`. */
  readonly nombre: string;
  /** Lo de dentro del paréntesis, separado por comas y sin espacios sobrantes. */
  readonly argumentos: readonly string[];
  /** Quedaba texto después del paréntesis de cierre. */
  readonly sobra: boolean;
}

/**
 * Separa las piezas de una etiqueta. `null` si no queda ningún nombre.
 *
 * El bucle está porque el orden de los adornos no lo fija nadie: hay
 * herramientas que escriben la guarda antes del número y otras después, y el
 * estándar tampoco es tajante. Cuatro vueltas bastan —hay cuatro adornos— y el
 * bucle corta en cuanto una vuelta no quita nada.
 */
export function analizarEtiqueta(bruto: string): EtiquetaDeMensaje | null {
  let resto = bruto.trim();
  let numero: string | undefined;
  let guarda: string | undefined;
  let asignacion: string | undefined;
  let iteracion = false;

  for (let vuelta = 0; vuelta < 4; vuelta += 1) {
    const antes = resto;

    const conGuarda = GUARDA.exec(resto);
    if (conGuarda !== null) {
      if (conGuarda[1] === '*') iteracion = true;
      const dentro = (conGuarda[2] ?? '').trim();
      if (dentro !== '') guarda ??= dentro;
      resto = resto.slice(conGuarda[0].length).trim();
    } else if (ITERACION.test(resto)) {
      // Solo se consume el `*` cuando NO hay guarda detrás; si la hay, la rama
      // de arriba ya se lo ha llevado junto con los corchetes. Separarlo aquí
      // evita que `*[i]` pierda la guarda por habérsele comido el asterisco en
      // una vuelta anterior.
      iteracion = true;
      resto = resto.replace(ITERACION, '').trim();
    }

    const conNumero = SECUENCIA.exec(resto);
    if (conNumero !== null) {
      numero ??= conNumero[1];
      resto = resto.slice(conNumero[0].length).trim();
    }

    const conAsignacion = ASIGNACION.exec(resto);
    if (conAsignacion !== null) {
      asignacion ??= conAsignacion[1];
      resto = resto.slice(conAsignacion[0].length).trim();
    }

    if (resto === antes) break;
  }

  const abre = resto.indexOf('(');
  const nombre = (abre === -1 ? resto : resto.slice(0, abre)).trim();
  if (nombre === '') return null;

  if (abre === -1) {
    return { numero, guarda, iteracion, asignacion, nombre, argumentos: [], sobra: false };
  }

  const cierra = resto.lastIndexOf(')');
  // Lo que venga detrás del paréntesis de cierre no es parte de la llamada.
  // Ignorarlo en silencio es justo lo que convierte «borrar(); DROP TABLE x»
  // en un inocente método `borrar`: el resto de la línea desaparece del aviso
  // y nadie llega a ver lo que traía el fichero.
  const sobra = cierra !== -1 && resto.slice(cierra + 1).trim() !== '';
  const dentro = resto.slice(abre + 1, cierra === -1 ? resto.length : cierra).trim();
  const argumentos =
    dentro === ''
      ? []
      : dentro
          .split(',')
          .map((a) => a.trim())
          .filter((a) => a !== '');

  return { numero, guarda, iteracion, asignacion, nombre, argumentos, sobra };
}
