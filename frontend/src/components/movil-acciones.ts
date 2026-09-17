import type { NombreIcono } from './iconos';

/**
 * Qué se puede hacer desde el teléfono, y desde dónde.
 *
 * ## Qué sustituye a qué
 *
 * En el escritorio las acciones están repartidas entre una barra de menú de
 * cinco desplegables, una paleta, un árbol de proyecto y una barra de estado.
 * Nada de eso se porta: una barra de menú necesita un puntero que pueda
 * recorrerla sin taparla, y un árbol de proyecto necesita una columna que en 320
 * px no existe.
 *
 * En su lugar hay dos sitios, y la diferencia entre ellos no es de importancia
 * sino de **frecuencia**:
 *
 * - El **botón flotante** lleva las tres cosas que se hacen constantemente
 *   mientras se dibuja. Está donde cae el pulgar y por eso tiene una regla dura,
 *   la misma que la barra del pulgar del escritorio estrecho: **nada de lo que
 *   hay ahí destruye nada**. Hay una prueba que lo comprueba, porque la
 *   tentación de añadir «eliminar» es real.
 * - El **cajón** lleva el catálogo entero, agrupado por tarea y no por tipo de
 *   objeto. Los grupos responden a «¿qué estoy intentando hacer?» —dibujar,
 *   traer y llevar ficheros, generar el backend, mirar el proyecto— porque esa
 *   es la pregunta que se hace quien abre un cajón, y no «¿en qué menú estaría
 *   esto en un escritorio?».
 *
 * Todo lo que está en el botón flotante está **también** en el cajón. El botón
 * es un atajo, nunca el único camino: un atajo que además es el único camino se
 * convierte en una función que nadie encuentra cuando el atajo no aplica.
 *
 * ## Por qué los motivos importan tanto aquí
 *
 * Un botón apagado sin explicación es malo en un escritorio y peor en un
 * teléfono, donde **no hay `hover`**: no existe forma de preguntarle a un
 * control por qué no responde. Por eso cada acción apagada trae su motivo en
 * texto, el motivo va al rótulo accesible, y hay una prueba que recorre todos
 * los estados posibles comprobando que ninguna se apaga en silencio.
 *
 * Esto vale doble para el permiso de lector. El encargo pide que la interfaz lo
 * deje claro **antes** de que alguien lo intente, no después de que el servidor
 * lo rechace, y esa es la diferencia entre una aplicación que se entiende y una
 * que parece estropeada.
 */

export type IdAccionMovil =
  | 'clase'
  | 'asistente'
  | 'desde-imagen'
  | 'generar'
  | 'revisar'
  | 'importar-xmi'
  | 'exportar-xmi'
  | 'comunicacion'
  | 'previsualizar'
  | 'modulos'
  | 'historial'
  | 'tablon'
  | 'compartir'
  | 'salir';

export interface AccionMovil {
  id: IdAccionMovil;
  /** Lo que se lee en el cajón. Cabe en una línea de 320 px. */
  etiqueta: string;
  /** La frase entera, para el lector de pantalla y para el rótulo accesible. */
  descripcion: string;
  icono: NombreIcono;
  deshabilitada: boolean;
  /** Por qué está apagada. Nunca es `null` si `deshabilitada` es cierto. */
  motivo: string | null;
  /**
   * Si puede quitar trabajo de en medio.
   *
   * Hoy ninguna de estas lo es —eliminar sigue viviendo en la ficha, que
   * pregunta y dice a cuántas relaciones se lleva por delante—, y la prueba que
   * vigila el botón flotante se apoya en esta marca en lugar de en una lista de
   * identificadores escrita a mano, que envejecería en cuanto alguien añada una
   * acción nueva.
   */
  destructiva: boolean;
}

export interface GrupoAcciones {
  id: string;
  /** El encabezado del grupo. Es una tarea, no una categoría de objeto. */
  titulo: string;
  acciones: AccionMovil[];
}

export interface EstadoAcciones {
  soloLectura: boolean;
  /** Cuántas clases tiene el diagrama ahora mismo. */
  clases: number;
  /** ¿Está abierto el canal con el servidor? */
  conectado: boolean;
  /** ¿Hay un diagrama de comunicación importado en este proyecto? */
  tieneComunicacion: boolean;
  /**
   * ¿Es de quien mira el proyecto?
   *
   * Es una pregunta distinta de `soloLectura` y hace falta precisamente porque
   * no coinciden: un editor escribe en el diagrama todo lo que quiere y aun así
   * el servidor le rechaza una invitación, porque repartir el acceso es del
   * propietario. Con un solo campo para las dos cosas, la entrada de compartir
   * saldría encendida para los editores —que son la mayoría de quienes usan
   * esto— y el «no» llegaría después de escribir el correo.
   */
  propietario: boolean;
}

/*
  Estos tres textos salen por pantalla, así que van en impersonal como el resto de
  la microcopia. Estuvieron en segunda persona —«Tienes permiso…», «Lo que
  dibujes…»— y el barrido de `estilos.test.ts` no los vio porque solo miraba los
  `.tsx`, que es justo donde no están: en esta interfaz las decisiones y sus
  motivos viven en los `.ts`. La prueba ya cubre también estos ficheros.

  El primero está palabra por palabra igual que en `barra-pulgar.ts`, que dice lo
  mismo en el escritorio estrecho. Dos redacciones distintas del mismo permiso se
  leen como dos permisos distintos.
*/
const SIN_PERMISO = 'Permiso de solo lectura: el diagrama se ve, no se cambia';
const SIN_CLASES = 'El diagrama todavía no tiene ninguna clase';
const SIN_RED =
  'Hace falta conexión: esto lo calcula el servidor. Lo que se dibuje ahora se guarda y sube al volver la red';
const SIN_PROPIEDAD = 'Solo quien creó el proyecto puede repartir el acceso';
const SIN_RED_MIEMBROS =
  'Hace falta conexión: la lista de miembros vive en el servidor, no en el diagrama';
const SIN_RED_TABLON =
  'Hace falta conexión: los mensajes del equipo viven en el servidor, no en el diagrama';

/**
 * El botón flotante: lo que se hace mientras se dibuja.
 *
 * Tres y no cinco. El botón se despliega sobre el lienzo, y cada opción de más
 * es una fila más que tapa el diagrama justo cuando hay que mirarlo para decidir
 * cuál pulsar.
 *
 * «Desde imagen» está aquí y no enterrada en el cajón porque en un teléfono es
 * la forma natural de empezar un diagrama: la cámara está en el mismo aparato
 * que el editor, cosa que en un portátil no pasa. Es la función que más gana al
 * pasar al móvil, así que es la que mejor sitio merece.
 */
export function accionesFlotantes(estado: EstadoAcciones): AccionMovil[] {
  const todas = new Map(catalogo(estado).map((a) => [a.id, a]));
  const elegidas: IdAccionMovil[] = ['clase', 'desde-imagen', 'generar'];
  return elegidas.map((id) => todas.get(id) as AccionMovil);
}

/**
 * El cajón: el catálogo entero, por tarea.
 *
 * «Salir del proyecto» va en el último grupo y sin agrupar con nada: es la única
 * que abandona la pantalla, y mezclarla con «historial» o «módulos» la convierte
 * en un clic accidental de camino a otra cosa.
 */
export function cajonDeAcciones(estado: EstadoAcciones): GrupoAcciones[] {
  const a = new Map(catalogo(estado).map((x) => [x.id, x]));
  const tomar = (...ids: IdAccionMovil[]): AccionMovil[] =>
    ids.map((id) => a.get(id) as AccionMovil).filter(Boolean);

  const grupos: GrupoAcciones[] = [
    {
      id: 'dibujar',
      titulo: 'Dibujar',
      acciones: tomar('clase', 'asistente', 'revisar'),
    },
    {
      id: 'traer',
      titulo: 'Traer y llevar',
      acciones: tomar(
        'desde-imagen',
        'importar-xmi',
        'exportar-xmi',
        ...(estado.tieneComunicacion ? (['comunicacion'] as const) : []),
      ),
    },
    {
      id: 'generar',
      titulo: 'Generar el backend',
      acciones: tomar('previsualizar', 'generar'),
    },
    {
      id: 'proyecto',
      titulo: 'El proyecto',
      acciones: tomar('modulos', 'historial', 'tablon', 'compartir', 'salir'),
    },
  ];

  return grupos;
}

/**
 * Una acción suelta, para los atajos que no salen ni del cajón ni del botón.
 *
 * La pide el micrófono flotante, que está fijo en la pantalla y no pertenece a
 * ninguna de las dos listas. Sin esto tendría que describirse a sí mismo —su
 * rótulo, su icono y el motivo por el que a veces está apagado—, y esa segunda
 * descripción es exactamente la que se queda vieja: la del cajón se ve cada día
 * y la del atajo solo cuando alguien es lector, que es el caso raro.
 */
export function accionMovil(estado: EstadoAcciones, id: IdAccionMovil): AccionMovil {
  return catalogo(estado).find((accion) => accion.id === id) as AccionMovil;
}

/**
 * Una sola definición de cada acción, con su estado ya resuelto.
 *
 * Las dos funciones de arriba eligen de aquí en vez de describir sus botones por
 * su cuenta. Es lo que garantiza que «generar» diga lo mismo y esté apagada por
 * lo mismo tanto si se llega por el botón flotante como si se llega por el
 * cajón: con dos descripciones, la de menos uso se queda vieja y nadie se entera
 * hasta que alguien la pulsa.
 */
function catalogo(estado: EstadoAcciones): AccionMovil[] {
  const { soloLectura, clases, conectado, tieneComunicacion, propietario } = estado;
  const vacio = clases === 0;

  /** Apagada por lo primero que aplique, en orden de lo más general. */
  const motivoDe = (...razones: (string | null)[]): string | null =>
    razones.find((r) => r !== null) ?? null;

  const escritura = soloLectura ? SIN_PERMISO : null;

  const definir = (
    id: IdAccionMovil,
    etiqueta: string,
    descripcion: string,
    icono: NombreIcono,
    motivo: string | null,
    destructiva = false,
  ): AccionMovil => ({
    id,
    etiqueta,
    descripcion,
    icono,
    deshabilitada: motivo !== null,
    motivo,
    destructiva,
  });

  return [
    definir('clase', 'Añadir una clase', 'Añadir una clase al diagrama', 'clase', escritura),

    definir(
      'asistente',
      'Dictar un cambio',
      'Decir en voz alta qué cambiar y revisar la propuesta antes de aplicarla',
      'microfono',
      /*
        **No** se apaga sin red, y esa es la diferencia con «generar». La orden
        se manda al servidor si lo hay, pero si no contesta la interpreta la
        gramática que viaja en el propio paquete: sin cobertura se entienden
        menos frases, no ninguna. Apagarla en el metro sería quitar de en medio
        justo la forma de editar que mejor funciona en un teléfono, que es la
        que no necesita el teclado.

        Solo la para el permiso de lector, y por el motivo de siempre: el
        asistente propone cambios, y quien no puede cambiar nada no tiene qué
        hacer con una propuesta.
      */
      escritura,
    ),

    definir(
      'desde-imagen',
      'Desde imagen',
      'Fotografiar una pizarra y leer el diagrama de la foto',
      'imagen',
      escritura,
    ),

    definir(
      'generar',
      'Generar el backend',
      'Generar el proyecto Spring Boot y descargarlo como ZIP',
      'exportar',
      // El orden importa: a un lector hay que decirle que no tiene permiso
      // aunque además falte la red, porque conectarse no le va a servir de
      // nada.
      motivoDe(escritura, vacio ? SIN_CLASES : null, conectado ? null : SIN_RED),
    ),

    definir(
      'revisar',
      'Revisar el diagrama',
      'Buscar lo que impide generar y lo que está mal modelado',
      'revisar',
      // Revisar no escribe nada: un lector puede y debe poder mirar qué falla.
      vacio ? SIN_CLASES : null,
    ),

    definir(
      'importar-xmi',
      'Importar XMI',
      'Traer un diagrama de otra herramienta y revisar los cambios antes de aplicarlos',
      'importar',
      escritura,
    ),

    definir(
      'exportar-xmi',
      'Exportar XMI',
      'Guardar el diagrama como XMI 2.1 y compartirlo',
      'exportar',
      /*
        Exportar **no** pide conexión, y la diferencia con «generar» es la que
        hay que entender: el XMI se escribe aquí, con el documento que ya está
        en el teléfono, mientras que el backend lo compila el servidor. En el
        metro se puede exportar y no se puede generar, y decirlo con precisión
        evita que alguien concluya que la aplicación entera deja de servir sin
        red.
      */
      vacio ? SIN_CLASES : null,
    ),

    definir(
      'comunicacion',
      'Diagrama de comunicación',
      'Ver el diagrama de comunicación que se importó en este proyecto',
      'comunicacion',
      tieneComunicacion ? null : 'Este proyecto no tiene ningún diagrama de comunicación importado',
    ),

    definir(
      'previsualizar',
      'Previsualizar',
      'Ver qué ficheros Java saldrían, sin descargar nada',
      'comprobado',
      motivoDe(vacio ? SIN_CLASES : null, conectado ? null : SIN_RED),
    ),

    definir(
      'modulos',
      'Módulos',
      'Agrupar las clases en módulos',
      'modulo',
      escritura,
    ),

    definir(
      'historial',
      'Historial de cambios',
      'Quién cambió qué, y cuándo',
      'historial',
      // Se puede consultar sin red: el historial vive en el documento, que está
      // en el teléfono. Y un lector tiene tanto derecho a leerlo como nadie.
      null,
    ),

    definir(
      'tablon',
      'Comunicación interna',
      'Leer y escribir en el tablón del proyecto, por texto o por voz',
      'mensajes',
      /*
        Un lector **sí** entra y sí escribe, y es la única acción del cajón que
        se comporta así. A alguien se le invita como lector precisamente para
        que revise el diagrama, y un revisor que no puede decir «esta
        cardinalidad está al revés» no está revisando nada. El servidor aplica
        la misma regla, así que aquí no se está abriendo nada que allí esté
        cerrado.

        Sin red sí se apaga, y esa es la diferencia con el historial, que está
        justo encima y también se lee. El historial viaja dentro del documento
        y está en el teléfono; el tablón vive en el servidor y en el metro no
        hay nada que enseñar.
      */
      conectado ? null : SIN_RED_TABLON,
    ),

    definir(
      'compartir',
      'Compartir',
      'Ver quién entra al proyecto e invitar a alguien más',
      'personas',
      /*
        Invitar desde el teléfono no es una comodidad, es la única forma de que
        la función se use. En el escritorio compartir vive en la lista de
        proyectos, y llegar hasta allí desde el editor cuesta cerrar el
        proyecto y volver a abrirlo: en un portátil eso son dos clics, pero
        quien dibuja en el móvil ha entrado casi siempre desde un enlace, y
        salir para volver a entrar es el tipo de viaje que hace que nadie
        comparta nunca.

        El orden de los dos motivos dice lo importante primero. A un editor hay
        que decirle que esto no es suyo aunque además esté sin red, porque
        reconectar no le va a cambiar la respuesta; al propietario sin
        cobertura, en cambio, la red sí le sirve, y por eso ve el otro.
      */
      motivoDe(propietario ? null : SIN_PROPIEDAD, conectado ? null : SIN_RED_MIEMBROS),
    ),

    definir('salir', 'Salir del proyecto', 'Volver a la lista de proyectos', 'atras', null),
  ];
}
