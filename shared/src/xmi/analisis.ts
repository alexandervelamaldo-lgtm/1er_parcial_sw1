/**
 * El vocabulario con el que se describe un caso de uso.
 *
 * ## Por qué existe este fichero y no cuatro ficheros de dibujo
 *
 * De cada caso de uso salen cuatro diagramas —comunicación, secuencia, análisis
 * de clases y actividad— y los cuatro cuentan lo mismo con distinta forma. El de
 * secuencia y el de comunicación son literalmente la misma información: UML los
 * llama a los dos «interacción» y solo cambia cómo se dibujan. El de análisis de
 * clases son los participantes con los mensajes que reciben convertidos en
 * operaciones.
 *
 * Mantenerlos a mano es mantener cuatro copias de una verdad. Se desincronizan
 * siempre, y el sitio donde se nota es la defensa: alguien pregunta por qué el
 * diagrama de secuencia tiene un paso que el de comunicación no, y no hay
 * respuesta buena. Así que aquí se describe el caso de uso **una vez** y los
 * cuatro diagramas se derivan.
 *
 * ## Clases de análisis, no clases del código
 *
 * Los participantes son clases de análisis al estilo de Jacobson —«boundary»,
 * «control», «entity»—, no las clases reales del proyecto. `PantallaAcceso` y no
 * `PantallaAcceso.tsx`; `GestorAcceso` y no `LocalIdentityProvider`. Es lo que
 * pide el método y lo que se corrige.
 *
 * Ahora bien, cada participante lleva un campo `origen` que apunta al fichero
 * real del que sale. No se dibuja: está para que el análisis no se convierta en
 * una redacción paralela al sistema. Un participante que no sepa decir de dónde
 * viene es un participante inventado.
 *
 * ## Seguridad (RNF-SEG-06)
 *
 * Estos nombres acaban dentro de un fichero XMI y, si alguien importa ese XMI en
 * la herramienta, dentro de un identificador Java. Vale la regla de siempre:
 * lista blanca, y lo que no pasa se rechaza diciendo por qué. Aquí los nombres
 * los escribimos nosotros y no un OCR, pero la comprobación cuesta poco y evita
 * que una errata con un `<` se cuele en el XML de salida.
 */

/** Los tres estereotipos del análisis de robustez, más el actor. */
export type Estereotipo = 'actor' | 'boundary' | 'control' | 'entity';

export interface Participante {
  /** Nombre de la instancia tal como se rotula: `pantalla`, `gestor`. */
  readonly alias: string;
  /** Clase de análisis de la que es instancia: `PantallaAcceso`. */
  readonly clase: string;
  readonly estereotipo: Estereotipo;
  /**
   * Fichero real del que sale este participante.
   *
   * No aparece en ningún diagrama. Es la atadura entre el análisis y el sistema:
   * si no se puede rellenar, el participante sobra.
   */
  readonly origen?: string;
}

export interface Paso {
  /** Número de secuencia tal como se dibuja: `1`, `1.1`, `2.3`. */
  readonly numero: string;
  /** Alias del que envía. */
  readonly de: string;
  /** Alias del que recibe. */
  readonly a: string;
  /** Firma del mensaje: `autenticar(correo, contrasena)`. */
  readonly mensaje: string;
  /**
   * La vuelta de una llamada anterior.
   *
   * Se dibuja con línea discontinua y **no** genera operación en el diagrama de
   * análisis de clases: la operación ya la creó la llamada de ida. Contarla dos
   * veces inventaría un método con el nombre del valor devuelto.
   */
  readonly retorno?: boolean;
}

export type TipoDeNodo = 'inicio' | 'accion' | 'decision' | 'fin';

export interface NodoActividad {
  readonly id: string;
  readonly tipo: TipoDeNodo;
  /** Calle en la que se dibuja. Con dos basta: el actor y el sistema. */
  readonly calle: string;
  /** Rótulo. Los nodos de inicio y fin no lo necesitan. */
  readonly texto?: string;
}

export interface FlujoActividad {
  readonly de: string;
  readonly a: string;
  /** Condición de la rama, sin corchetes: `Válido`, `No`. */
  readonly guarda?: string;
}

export interface FlujoAlternativo {
  readonly nombre: string;
  readonly texto: string;
}

export interface CasoDeUso {
  /** `CU1`. Es el que numera los ficheros y tiene que coincidir con el documento. */
  readonly id: string;
  readonly nombre: string;
  /** Paquete al que pertenece, para el diagrama que los relaciona. */
  readonly paquete: string;
  /** Actor principal. Tiene que ser uno de los declarados en el modelo general. */
  readonly actor: string;
  /** Actores secundarios, si los hay. */
  readonly otrosActores?: readonly string[];
  readonly descripcion: string;
  readonly precondicion: string;
  readonly postcondicion: string;
  readonly participantes: readonly Participante[];
  /** Flujo principal, en orden. */
  readonly pasos: readonly Paso[];
  readonly alternativos: readonly FlujoAlternativo[];
  readonly actividad: {
    readonly nodos: readonly NodoActividad[];
    readonly flujos: readonly FlujoActividad[];
  };
}

export interface Actor {
  readonly nombre: string;
  /** Actor del que hereda, si hereda de alguno. */
  readonly hereda?: string;
  readonly descripcion: string;
}

export interface ModeloDeCasosDeUso {
  readonly sistema: string;
  readonly actores: readonly Actor[];
  readonly paquetes: readonly { readonly nombre: string; readonly descripcion: string }[];
  readonly casos: readonly CasoDeUso[];
}

// ---------------------------------------------------------------------------
// Comprobaciones
// ---------------------------------------------------------------------------

/** Nombre de clase de análisis: como un identificador, sin espacios. */
const NOMBRE_DE_CLASE = /^[A-Za-z][A-Za-z0-9]*$/;
/** Alias de instancia: minúscula inicial. */
const ALIAS = /^[a-z][A-Za-z0-9]*$/;
/** `1`, `1.1`, `2.3.1`. */
const NUMERO = /^\d+(?:\.\d+)*$/;
/**
 * Firma de un mensaje.
 *
 * Se permite el paréntesis y la coma porque son la firma; se permite el espacio
 * porque hay rótulos de dos palabras. No se permite nada más, y en particular
 * nada que tenga sentido en XML o en SQL. La comprobación va sobre el texto tal
 * cual se escribió, nunca sobre una versión ya limpiada: limpiar quitando
 * caracteres es exactamente lo que RNF-SEG-06 prohíbe, porque convierte
 * `borrar(); DROP TABLE x` en un inocente `borrar`.
 */
const MENSAJE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ _-]*\([^()]*\)$/;

export interface ProblemaDeAnalisis {
  readonly caso: string;
  readonly mensaje: string;
}

/**
 * Revisa el catálogo entero antes de dibujar nada.
 *
 * Se comprueba todo y se devuelve la lista completa en vez de parar en el primer
 * fallo. Con catorce casos de uso, arreglarlos de uno en uno —regenerar, ver el
 * siguiente error, regenerar— es media tarde; verlos todos juntos es un rato.
 */
export function revisarModelo(modelo: ModeloDeCasosDeUso): ProblemaDeAnalisis[] {
  const problemas: ProblemaDeAnalisis[] = [];
  const anota = (caso: string, mensaje: string): void => {
    problemas.push({ caso, mensaje });
  };

  const actores = new Set(modelo.actores.map((a) => a.nombre));
  for (const actor of modelo.actores) {
    if (actor.hereda !== undefined && !actores.has(actor.hereda)) {
      anota('actores', `«${actor.nombre}» hereda de «${actor.hereda}», que no existe.`);
    }
    if (actor.hereda === actor.nombre) {
      anota('actores', `«${actor.nombre}» hereda de sí mismo.`);
    }
  }

  const paquetes = new Set(modelo.paquetes.map((p) => p.nombre));
  const identificadores = new Set<string>();

  for (const caso of modelo.casos) {
    if (identificadores.has(caso.id)) anota(caso.id, 'El identificador está repetido.');
    identificadores.add(caso.id);

    if (!paquetes.has(caso.paquete)) {
      anota(caso.id, `El paquete «${caso.paquete}» no está declarado.`);
    }
    for (const nombre of [caso.actor, ...(caso.otrosActores ?? [])]) {
      if (!actores.has(nombre)) anota(caso.id, `El actor «${nombre}» no está declarado.`);
    }

    const alias = new Map<string, Participante>();
    for (const participante of caso.participantes) {
      if (alias.has(participante.alias)) {
        anota(caso.id, `El alias «${participante.alias}» está repetido.`);
      }
      if (!ALIAS.test(participante.alias)) {
        anota(caso.id, `«${participante.alias}» no sirve como alias de instancia.`);
      }
      if (!NOMBRE_DE_CLASE.test(participante.clase)) {
        anota(caso.id, `«${participante.clase}» no sirve como nombre de clase.`);
      }
      alias.set(participante.alias, participante);
    }

    if (caso.pasos.length === 0) anota(caso.id, 'No tiene ni un paso.');

    for (const paso of caso.pasos) {
      const donde = `el paso ${paso.numero}`;
      if (!NUMERO.test(paso.numero)) {
        anota(caso.id, `«${paso.numero}» no es un número de secuencia.`);
      }
      if (!MENSAJE.test(paso.mensaje)) {
        anota(caso.id, `El mensaje de ${donde} no tiene forma de llamada: «${paso.mensaje}».`);
      }
      if (!alias.has(paso.de)) anota(caso.id, `${donde} sale de «${paso.de}», que no participa.`);
      if (!alias.has(paso.a)) anota(caso.id, `${donde} va a «${paso.a}», que no participa.`);
      if (paso.de === paso.a) {
        // Un mensaje a uno mismo es legítimo en UML, pero en un diagrama de
        // comunicación se dibuja como un lazo sobre el objeto y en EA hay que
        // colocarlo a mano. Se avisa para que sea una decisión y no un descuido.
        anota(caso.id, `${donde} es un mensaje de «${paso.de}» a sí mismo: se dibuja como lazo.`);
      }
    }

    const participaEnAlgo = new Set(caso.pasos.flatMap((p) => [p.de, p.a]));
    for (const participante of caso.participantes) {
      if (!participaEnAlgo.has(participante.alias)) {
        anota(caso.id, `«${participante.alias}» no manda ni recibe nada: sobra en el diagrama.`);
      }
    }

    problemas.push(...revisarActividad(caso));
  }

  return problemas;
}

function revisarActividad(caso: CasoDeUso): ProblemaDeAnalisis[] {
  const problemas: ProblemaDeAnalisis[] = [];
  const anota = (mensaje: string): void => {
    problemas.push({ caso: caso.id, mensaje });
  };

  const { nodos, flujos } = caso.actividad;
  const porId = new Map(nodos.map((n) => [n.id, n]));

  if (nodos.filter((n) => n.tipo === 'inicio').length !== 1) {
    anota('El diagrama de actividad necesita exactamente un nodo de inicio.');
  }
  if (!nodos.some((n) => n.tipo === 'fin')) {
    anota('El diagrama de actividad no termina en ningún sitio.');
  }

  for (const flujo of flujos) {
    if (!porId.has(flujo.de)) anota(`Hay un flujo que sale de «${flujo.de}», que no existe.`);
    if (!porId.has(flujo.a)) anota(`Hay un flujo que llega a «${flujo.a}», que no existe.`);
  }

  const salidas = new Map<string, number>();
  const entradas = new Set<string>();
  for (const flujo of flujos) {
    salidas.set(flujo.de, (salidas.get(flujo.de) ?? 0) + 1);
    entradas.add(flujo.a);
  }

  for (const nodo of nodos) {
    const cuantas = salidas.get(nodo.id) ?? 0;
    if (nodo.tipo === 'fin') {
      if (cuantas > 0) anota(`El nodo final «${nodo.id}» tiene salida.`);
    } else if (cuantas === 0) {
      anota(`«${nodo.id}» no lleva a ninguna parte.`);
    }

    if (nodo.tipo === 'decision' && cuantas < 2) {
      anota(`La decisión «${nodo.id}» tiene ${cuantas} salida(s): una decisión se bifurca.`);
    }
    if (nodo.tipo === 'inicio' && entradas.has(nodo.id)) {
      anota('Al nodo de inicio le llega un flujo.');
    }
    if (nodo.tipo !== 'inicio' && !entradas.has(nodo.id)) {
      anota(`A «${nodo.id}» no llega nada: queda suelto.`);
    }
    if (nodo.tipo === 'decision') {
      const sinGuarda = flujos.filter((f) => f.de === nodo.id && f.guarda === undefined);
      if (sinGuarda.length > 0) {
        anota(`La decisión «${nodo.id}» tiene ramas sin condición.`);
      }
    }
  }

  return problemas;
}

// ---------------------------------------------------------------------------
// Derivaciones
// ---------------------------------------------------------------------------

/** `autenticar(correo, contrasena)` → `autenticar`. */
export function nombreDelMensaje(mensaje: string): string {
  const abre = mensaje.indexOf('(');
  return (abre === -1 ? mensaje : mensaje.slice(0, abre)).trim();
}

/** Los argumentos entre paréntesis, ya separados. */
export function argumentosDelMensaje(mensaje: string): string[] {
  const abre = mensaje.indexOf('(');
  const cierra = mensaje.lastIndexOf(')');
  if (abre === -1 || cierra <= abre) return [];
  return mensaje
    .slice(abre + 1, cierra)
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
}

export interface OperacionDeAnalisis {
  readonly nombre: string;
  readonly argumentos: readonly string[];
}

/**
 * Las operaciones que cada clase de análisis expone, deducidas de lo que recibe.
 *
 * Es la regla del análisis de robustez: si a un objeto le llega el mensaje
 * `verificar(contrasena)`, su clase tiene la operación `verificar`. Los retornos
 * no cuentan —ya los generó la llamada de ida— y los duplicados se quedan en uno
 * solo, porque un mensaje repetido en dos pasos es la misma operación llamada dos
 * veces, no dos operaciones.
 */
export function operacionesPorClase(caso: CasoDeUso): Map<string, OperacionDeAnalisis[]> {
  const porAlias = new Map(caso.participantes.map((p) => [p.alias, p]));
  const salida = new Map<string, OperacionDeAnalisis[]>();

  for (const participante of caso.participantes) {
    salida.set(participante.clase, []);
  }

  for (const paso of caso.pasos) {
    if (paso.retorno === true) continue;
    const destino = porAlias.get(paso.a);
    if (destino === undefined) continue;
    // Un actor no tiene operaciones: es una persona, no una clase con interfaz.
    if (destino.estereotipo === 'actor') continue;

    const lista = salida.get(destino.clase);
    if (lista === undefined) continue;
    const nombre = nombreDelMensaje(paso.mensaje);
    if (lista.some((o) => o.nombre === nombre)) continue;
    lista.push({ nombre, argumentos: argumentosDelMensaje(paso.mensaje) });
  }

  return salida;
}

/**
 * Los enlaces del diagrama de comunicación: qué pares de objetos se hablan.
 *
 * Un enlace por pareja, no uno por mensaje. Tres mensajes entre los mismos dos
 * objetos son tres rótulos sobre **una** línea; dibujar tres líneas es el error
 * que convierte un diagrama de cuatro cajas en una maraña.
 */
export function enlacesDe(caso: CasoDeUso): { de: string; a: string }[] {
  const vistos = new Set<string>();
  const enlaces: { de: string; a: string }[] = [];

  for (const paso of caso.pasos) {
    if (paso.de === paso.a) continue;
    const clave = [paso.de, paso.a].sort().join('|');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    // Se conserva la dirección del primer mensaje que los une, que es la que
    // hace que el diagrama se lea de izquierda a derecha.
    enlaces.push({ de: paso.de, a: paso.a });
  }

  return enlaces;
}
