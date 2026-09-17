import { RELATION_KIND_LABELS, type RelationKind } from '@app/shared';
import { ICONO_RELACION, type NombreIcono } from './iconos';

/**
 * Qué botones lleva la barra del pulgar, y cuáles están apagados.
 *
 * La barra existe porque en un teléfono el editor tenía todas sus acciones
 * arriba. La barra de menú, el título y los cuatro iconos de herramientas viven
 * en la cabecera, y la cabecera es la franja más difícil de alcanzar con el
 * pulgar de la mano que sujeta el aparato: hay que recolocar el teléfono en la
 * mano para pulsar «Deshacer». En un escritorio esa esquina es la más cómoda
 * —el ratón llega igual de rápido a cualquier sitio y la memoria muscular la
 * sitúa por descarte contra el borde—, así que la misma disposición que está
 * bien con ratón está mal con pulgar. No es un ajuste de tamaño: es que la zona
 * buena está en el lado contrario de la pantalla.
 *
 * Aquí abajo no está *todo* lo que se puede hacer, solo lo que se repite
 * mientras se dibuja. El catálogo completo sigue en el menú, y sigue siendo el
 * mismo menú en el teléfono y en el escritorio: dos organizaciones distintas
 * según el aparato es lo que se quitó cuando se retiró el botón «Más».
 *
 * **Ninguna de estas cinco destruye nada.** Es la propiedad que hace aceptable
 * poner botones justo donde el pulgar descansa mientras se lee el diagrama:
 * crear una clase se deshace, armar la herramienta de relación no toca el
 * modelo, y encuadrar solo mueve la vista. «Eliminar» no está aquí y no debe
 * estarlo —vive en el menú y en el panel, que preguntan y calculan el impacto—.
 * Hay una prueba que lo comprueba, porque la tentación de añadirla es real: es
 * la acción que más se busca después de crear una clase por error.
 *
 * Esto está separado del `.tsx` por lo de siempre: son reglas —cuándo se apaga
 * un botón, qué dice cuando está apagado, qué icono lleva el de relación— y las
 * reglas se prueban sin montar un navegador.
 */

/**
 * El lado menor de un objetivo táctil, en píxeles CSS.
 *
 * Cuarenta y cuatro es la cifra de las dos guías que existen —Apple da 44 pt y
 * Android 48 dp, que con su densidad son unos 48 px—, y se toma la menor de las
 * dos porque es la que hay que cumplir siempre: un botón de 48 cumple las dos,
 * uno de 44 cumple una, y uno de 26 —lo que medían los controles de React Flow
 * y lo que miden los botones de la barra de estado— no cumple ninguna.
 *
 * No es un número decorativo: la yema de un dedo adulto cubre entre 8 y 10 mm,
 * y en un teléfono corriente eso son unos 40 px CSS. Un objetivo más pequeño
 * que la propia yema no se puede apuntar mirando, porque el dedo lo tapa antes
 * de tocarlo.
 *
 * Vive aquí y se comprueba desde `estilos.test.ts` contra la hoja, que es la
 * única forma de que el número y el CSS no se separen.
 */
export const LADO_TACTIL = 44;

export type IdAccionPulgar = 'clase' | 'relacion' | 'deshacer' | 'propiedades' | 'encuadrar';

export interface AccionPulgar {
  id: IdAccionPulgar;
  /** El rótulo corto de debajo del icono. Cabe en la quinta parte de un móvil. */
  etiqueta: string;
  /** La frase entera, para el lector de pantalla y para el `title`. */
  descripcion: string;
  icono: NombreIcono;
  /**
   * Si el botón es un interruptor —y por tanto lleva `aria-pressed`— o una
   * orden que se ejecuta y ya está. La distinción importa para quien no ve la
   * pantalla: sin `aria-pressed` no hay forma de saber que la herramienta de
   * relación se quedó armada, y armada cambia lo que hace arrastrar una caja.
   */
  interruptor: boolean;
  activa: boolean;
  deshabilitada: boolean;
  /**
   * Por qué está apagado, si lo está.
   *
   * Un botón gris sin explicación es la forma más rápida de que alguien crea
   * que la aplicación se ha colgado. En un teléfono además no hay `hover`, así
   * que este texto va al `title` **y** a la descripción accesible: es el único
   * sitio donde se puede leer.
   */
  motivo: string | null;
}

export interface EstadoPulgar {
  soloLectura: boolean;
  herramienta: 'seleccion' | 'relacion';
  tipoRelacion: RelationKind;
  /** El nombre de la clase seleccionada, o `null` si no hay ninguna. */
  nombreSeleccion: string | null;
  /** Si la columna de propiedades está a la vista ahora mismo. */
  propiedadesVisibles: boolean;
}

const SIN_PERMISO = 'Permiso de solo lectura: el diagrama se ve, no se cambia';

/**
 * `RELATION_KIND_LABELS` los da en minúscula porque están escritos para ir
 * dentro de una frase —«Crear asociación entre A y B»—, y ahí es donde se usan
 * casi siempre. Aquí el mismo texto es el rótulo de un botón, al lado de
 * «Clase» y «Deshacer», así que se le pone la mayúscula en el sitio en vez de
 * duplicar la tabla con seis cadenas capitalizadas que se separarían de las
 * originales a la primera corrección.
 */
function capitalizar(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Los cinco botones, en orden de izquierda a derecha.
 *
 * El orden es el del trabajo y no el de la importancia: se crea una clase, se
 * la relaciona, se deshace lo que salió mal, se mira lo que hay dentro y se
 * vuelve a encuadrar. Puestos en ese orden, la mano aprende la posición por la
 * secuencia en vez de por el icono, que a 16 px y de reojo no se distingue.
 *
 * «Encuadrar» va la última y **nunca se apaga**, ni siquiera en solo lectura.
 * Es la salida de emergencia: en una pantalla pequeña basta un arrastre torpe
 * para dejar el diagrama entero fuera de la vista, y entonces da igual lo que
 * hagan los otros cuatro botones porque no se ve nada sobre lo que actuar. Un
 * botón que devuelve el dibujo a la pantalla tiene que estar disponible
 * precisamente cuando todo lo demás no lo está.
 */
export function accionesDePulgar(estado: EstadoPulgar): AccionPulgar[] {
  const { soloLectura, herramienta, tipoRelacion, nombreSeleccion, propiedadesVisibles } = estado;
  const relacionArmada = herramienta === 'relacion';
  const nombreRelacion = RELATION_KIND_LABELS[tipoRelacion];

  return [
    {
      id: 'clase',
      etiqueta: 'Clase',
      descripcion: 'Añadir una clase al diagrama',
      icono: 'clase',
      interruptor: false,
      activa: false,
      deshabilitada: soloLectura,
      motivo: soloLectura ? SIN_PERMISO : null,
    },
    {
      id: 'relacion',
      // El rótulo dice el tipo armado y no la palabra «Relación». En la paleta
      // los seis tipos están a la vista y se ve cuál está hundido; aquí solo
      // cabe un botón, así que si no dijera el tipo, el mismo icono de 16 px
      // sería lo único que distingue trazar una composición de trazar una
      // herencia —y esas dos generan código Java distinto—.
      etiqueta: capitalizar(nombreRelacion),
      descripcion: relacionArmada
        ? `Trazado de ${nombreRelacion} activo: arrastrar de una clase a otra. Pulsar para desarmar`
        : `Armar el trazado de ${nombreRelacion}. El tipo se elige en la paleta`,
      icono: ICONO_RELACION[tipoRelacion],
      interruptor: true,
      activa: relacionArmada,
      deshabilitada: soloLectura,
      motivo: soloLectura ? SIN_PERMISO : null,
    },
    {
      id: 'deshacer',
      etiqueta: 'Deshacer',
      descripcion: 'Deshacer el último cambio',
      icono: 'deshacer',
      interruptor: false,
      activa: false,
      // Se apaga en solo lectura aunque el gestor de deshacer exista: sin
      // permiso no se ha podido escribir nada, así que no hay nada propio que
      // retirar. Lo que hay en el documento lo han puesto los demás, y
      // deshacérselo a otro no es deshacer.
      deshabilitada: soloLectura,
      motivo: soloLectura ? SIN_PERMISO : null,
    },
    {
      id: 'propiedades',
      etiqueta: 'Ficha',
      descripcion: nombreSeleccion
        ? `Atributos y métodos de ${nombreSeleccion}`
        : 'Atributos y métodos de la clase seleccionada',
      icono: 'columna-derecha',
      interruptor: true,
      activa: propiedadesVisibles,
      /*
        Sin selección se apaga, y aquí sí es distinto del escritorio. Allí el
        panel vacío ocupa una columna que ya estaba abierta y no molesta a
        nadie; en un teléfono la columna se despliega **encima** del lienzo y lo
        tapa entero, así que abrirla para no decir nada obliga a cerrarla otra
        vez a ciegas, tapando justo la clase que había que tocar.
      */
      deshabilitada: nombreSeleccion === null,
      motivo: nombreSeleccion === null ? 'Primero hay que tocar una clase del diagrama' : null,
    },
    {
      id: 'encuadrar',
      etiqueta: 'Encuadrar',
      descripcion: 'Encajar el diagrama entero en la pantalla',
      icono: 'encuadrar',
      interruptor: false,
      activa: false,
      deshabilitada: false,
      motivo: null,
    },
  ];
}
