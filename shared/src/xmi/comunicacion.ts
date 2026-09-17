import { isValidJavaIdentifier, toCamelCase, toPascalCase } from '../model/naming.js';
import { resolveTypeName } from '../model/type-catalog.js';
import type { Operation } from '../ops/operations.js';
import { idDe, indexarPorId, refDe, tipoUml, type AvisoXmi } from './comun.js';
import { analizarEtiqueta } from './etiqueta-mensaje.js';
import { attr, descendientes, hijos, type XmlNode } from './xml.js';

/**
 * Lectura de un diagrama de comunicación (o de colaboración) desde XMI.
 *
 * POR QUÉ NO SE GUARDA COMO TAL. Esta aplicación tiene un único documento: un
 * diagrama de clases. Un diagrama de comunicación no tiene dónde vivir, así que
 * o se traduce a lo que el modelo sí sabe representar o no se importa. Se
 * traduce, porque la información que aporta es real y encaja: quién llama a
 * quién es una dependencia, y un mensaje recibido es una operación de la clase
 * que lo recibe.
 *
 *   objeto «p1:Pedido»       → la clase Pedido
 *   mensaje «1.2: pagar()»   → método `pagar()` en la clase que lo RECIBE
 *   enlace entre dos objetos → dependencia entre sus clases
 *
 * LO QUE SE PIERDE, Y SE DICE. El orden de los mensajes (1, 1.1, 2…) es la
 * esencia del diagrama y un diagrama de clases no tiene dónde ponerlo. No se
 * inventa un sitio ni se mete en el nombre del método: se avisa de que la
 * secuencia no viaja. Prefiero una importación que declare lo que deja fuera a
 * una que parezca completa y no lo sea.
 *
 * SECUENCIA Y COMUNICACIÓN SON LO MISMO AQUÍ. En XMI ambos son una
 * `uml:Interaction` con líneas de vida y mensajes; lo que cambia es cómo los
 * dibuja la herramienta, y eso vive en su bloque de extensión. Así que este
 * lector acepta los dos sin distinguirlos, porque distinguirlos obligaría a
 * fiarse de la extensión de cada herramienta para acabar haciendo lo mismo.
 *
 * FUSIONA, NO OMITE. El lector de diagramas de clases omite una clase cuyo
 * nombre ya existe, y hace bien: viene a crear. Aquí sería inservible, porque
 * los objetos de un diagrama de comunicación casi siempre son clases que ya
 * están en el diagrama, y lo que se quiere es añadirles los métodos. Por eso
 * este lector escribe sobre lo que ya hay en vez de saltárselo, y por eso
 * deduplica con cuidado: `addMethod` sobre un método que ya existe falla, y un
 * fallo tumba el lote entero.
 *
 * SEGURIDAD (RNF-SEG-06). El nombre de un mensaje acaba siendo un método Java
 * en el proyecto generado. Vale la misma regla que en el resto: lista blanca
 * después de convertir a la convención del modelo, y lo que no pasa se rechaza
 * diciendo por qué. Nunca se «limpia» quitando caracteres.
 *
 * NO VERIFICADO CONTRA UN FICHERO REAL. Como el lector de clases, esto está
 * escrito contra la especificación de UML 2.5 y contra las formas que sé que
 * emiten las herramientas, sin un `.xmi` de Enterprise Architect delante con el
 * que contrastarlo. De ahí que cada salto —mensaje, ocurrencia, línea de vida,
 * rol, clasificador— tenga alternativas en vez de dar por buena una sola forma.
 */

const MAX_MENSAJES = 500;
const MAX_CLASES_NUEVAS = 100;

/**
 * Clases de mensaje que no producen método.
 *
 * Un `reply` es la vuelta de una llamada que ya generó el suyo; contarlo otra
 * vez inventaría un método con el nombre del valor devuelto. `createMessage` y
 * `deleteMessage` no son operaciones de negocio: son el constructor y el fin de
 * vida del objeto. De los tres sí se conserva la dependencia, porque quien crea
 * o destruye a otro depende de él igual que quien lo llama.
 */
const SIN_METODO = new Set(['reply', 'createmessage', 'deletemessage']);

export interface ContextoComunicacion {
  /** Clasificadores del fichero, por `xmi:id`, con el nombre que van a tener. */
  readonly clasificadores: ReadonlyMap<string, string>;
  /** Toda clase disponible tras importar: nombre en minúsculas → nombre real. */
  readonly clases: ReadonlyMap<string, string>;
  /** Las que ya estaban en el diagrama, en minúsculas. */
  readonly enElDiagrama: ReadonlySet<string>;
  /** Métodos ya presentes o ya propuestos: clase en minúsculas → nombres en minúsculas. */
  readonly metodos: ReadonlyMap<string, ReadonlySet<string>>;
  /** Pares de clases que ya tienen alguna relación: «a|b» en minúsculas y ordenado. */
  readonly relacionadas: ReadonlySet<string>;
}

export interface ResultadoComunicacion {
  readonly operaciones: Operation[];
  readonly avisos: AvisoXmi[];
  /** Si el fichero traía una interacción o una colaboración, aunque no diera nada. */
  readonly hayInteraccion: boolean;
  /** Clases que hubo que crear porque el fichero solo las mencionaba. */
  readonly clasesNuevas: string[];
  /** Clases que ya estaban en el diagrama y reciben algo. */
  readonly ampliadas: string[];
  /** Mensajes convertidos en método. */
  readonly mensajes: number;
  /** Dependencias deducidas de mensajes y enlaces. */
  readonly enlaces: number;
}

// ---------------------------------------------------------------------------
// Nombres de mensaje
// ---------------------------------------------------------------------------

/**
 * Separa el nombre real de la llamada de todo lo que lo adorna.
 *
 * La etiqueta de un mensaje en un diagrama de comunicación no es un nombre: es
 * `*[i:=1..n] 2.3: total := calcular(iva)`, con el número de secuencia, la
 * iteración, la guarda y la asignación pegados delante. Todo eso se quita aquí
 * y no en el nombre del método, porque `2.3: calcular` no es un identificador
 * Java y, si lo fuera, sería peor: nadie querría ver `_23_calcular` en la clase
 * generada.
 *
 * El despiece de verdad está en `etiqueta-mensaje.ts`, que devuelve también el
 * número y la guarda. Este lector no los usa —traduce a un diagrama de clases,
 * donde no hay dónde ponerlos— pero el lector de `diagrama-comunicacion.ts` sí,
 * y las expresiones regulares tenían que quedarse en un solo sitio: son
 * exactamente la clase de código que se corrige aquí y se olvida allí.
 */
function partirMensaje(
  bruto: string,
): { nombre: string; argumentos: readonly string[]; sobra: boolean } | null {
  const piezas = analizarEtiqueta(bruto);
  if (piezas === null) return null;
  return { nombre: piezas.nombre, argumentos: piezas.argumentos, sobra: piezas.sobra };
}

/**
 * Lo que se acepta como nombre de un mensaje **antes** de normalizarlo.
 *
 * La comprobación va sobre el texto crudo y no sobre el resultado de
 * `toCamelCase` a propósito. `toCamelCase('borrar; DROP TABLE pedidos')`
 * devuelve `borrarDropTablePedidos`, que es un identificador Java
 * perfectamente válido: validar después de normalizar sería sanear quitando
 * caracteres, que es exactamente lo que RNF-SEG-06 prohíbe. Se permiten
 * espacios y guiones porque hay quien escribe «hacer pedido» en la etiqueta y
 * `toCamelCase` sabe unirlo; no se permite nada más.
 */
const NOMBRE_DE_MENSAJE = /^[A-Za-z_$][A-Za-z0-9_$ -]*$/;

/** `p1:Pedido` → `Pedido`; `p1` → nada, porque no dice de qué clase es. */
function trasLosDosPuntos(valor: string | undefined): string | undefined {
  if (valor === undefined) return undefined;
  const corte = valor.indexOf(':');
  if (corte === -1) return undefined;
  const cola = valor.slice(corte + 1).trim();
  return cola === '' ? undefined : cola;
}

// ---------------------------------------------------------------------------

export function leerComunicacion(
  raiz: XmlNode,
  contexto: ContextoComunicacion,
): ResultadoComunicacion {
  const esTipo = (tipo: string) => (nodo: XmlNode): boolean => tipoUml(nodo) === tipo;

  const contenedores = ['packagedElement', 'ownedBehavior', 'ownedMember', 'ownedElement'];
  const interacciones = descendientes(raiz, ...contenedores, 'Interaction').filter(
    esTipo('Interaction'),
  );
  const colaboraciones = descendientes(raiz, ...contenedores, 'Collaboration').filter(
    esTipo('Collaboration'),
  );

  /**
   * Los enlaces del diagrama, se hayan escrito donde se hayan escrito.
   *
   * Antes se buscaban solo dentro de la `Collaboration`, que es donde el
   * estándar los pone y donde nadie los pone. Enterprise Architect deja la
   * colaboración con las líneas de vida y saca los `ownedConnector` al paquete
   * de instancias, un nivel más arriba; el resultado era que los tres enlaces
   * del diagrama no aparecían por ninguna parte. Un `uml:Connector` une dos
   * roles y eso significa lo mismo esté colgado de quien esté, así que se
   * recorre el documento entero.
   */
  const conectores = descendientes(raiz, 'ownedConnector', 'Connector').filter(
    esTipo('Connector'),
  );

  const vacio: ResultadoComunicacion = {
    operaciones: [],
    avisos: [],
    hayInteraccion: false,
    clasesNuevas: [],
    ampliadas: [],
    mensajes: 0,
    enlaces: 0,
  };
  if (interacciones.length === 0 && colaboraciones.length === 0 && conectores.length === 0) {
    return vacio;
  }

  const porId = indexarPorId(raiz);
  const avisos: AvisoXmi[] = [];
  const opsClases: Operation[] = [];
  const opsResto: Operation[] = [];
  const clasesNuevas: string[] = [];
  const ampliadas = new Set<string>();
  let mensajes = 0;
  let enlaces = 0;
  let tiposSupuestos = 0;

  // Copias mutables: lo que se va proponiendo aquí también cuenta para no
  // proponerlo dos veces.
  const clases = new Map(contexto.clases);
  const relacionadas = new Set(contexto.relacionadas);
  const metodos = new Map<string, Set<string>>();
  for (const [clase, nombres] of contexto.metodos) metodos.set(clase, new Set(nombres));

  // ---- resolución de objetos a clases -------------------------------------

  /**
   * `classifier` → nombre del clasificador al que apunta.
   *
   * Es la forma en que un objeto declara de qué clase es, y hay que seguirla
   * hasta el final: el nombre del objeto (`con`, `p1`, `:pedido`) es la etiqueta
   * de la instancia, no el de su clase. Quedarse con él llena el diagrama de
   * clases llamadas «Con» y «P1» que no existen en ninguna parte, y lo hace sin
   * dar ningún error.
   */
  const seguirClasificador = (nodo: XmlNode): string | undefined => {
    const referencia = refDe(nodo, 'classifier');
    if (referencia === undefined) return undefined;
    const conocida = contexto.clasificadores.get(referencia);
    if (conocida !== undefined) return conocida;
    const destino = porId.get(referencia);
    const nombre = destino !== undefined ? attr(destino, 'name') : undefined;
    return nombre !== undefined && nombre.trim() !== '' ? nombre.trim() : undefined;
  };

  const claseDeConectable = (nodo: XmlNode): string | undefined => {
    const porClasificador = seguirClasificador(nodo);
    if (porClasificador !== undefined) return porClasificador;

    const referencia = refDe(nodo, 'type');
    if (referencia !== undefined) {
      const conocida = contexto.clasificadores.get(referencia);
      if (conocida !== undefined) return conocida;
      const apuntado = porId.get(referencia);
      if (apuntado !== undefined) {
        // El tipo puede ser a su vez un objeto —«esta parte es la instancia
        // `con`»—, así que se le vuelve a preguntar en lugar de quedarse con su
        // nombre. Es el camino que recorre un fichero de Enterprise Architect:
        // línea de vida → propiedad → instancia → componente.
        const indirecta = seguirClasificador(apuntado);
        if (indirecta !== undefined) return indirecta;
        // El tipo está en el fichero pero no se importó como clase (nombre
        // inválido, o es un tipo primitivo). Se usa su nombre y se valida abajo.
        const nombre = attr(apuntado, 'name');
        if (nombre !== undefined && nombre.trim() !== '') return nombre.trim();
      }
    }
    const hijoTipo = hijos(nodo, 'type')[0];
    const href = hijoTipo !== undefined ? attr(hijoTipo, 'href') : undefined;
    if (href !== undefined && href.includes('#')) return href.slice(href.lastIndexOf('#') + 1);
    return trasLosDosPuntos(attr(nodo, 'name'));
  };

  /**
   * De un objeto del diagrama a la clase que le corresponde.
   *
   * Se prueban las formas por orden de fiabilidad, no por comodidad: primero la
   * referencia explícita al clasificador, luego el rol que la línea de vida
   * representa, y solo al final el convenio `p1:Pedido` escrito en el nombre.
   * Ese último es el único que puede equivocarse, y por eso va el último.
   */
  const claseDeObjeto = (nodo: XmlNode | undefined): string | undefined => {
    if (nodo === undefined) return undefined;
    const id = idDe(nodo);
    if (id !== undefined) {
      const directa = contexto.clasificadores.get(id);
      if (directa !== undefined) return directa;
    }
    const representa = refDe(nodo, 'represents', 'base_Property');
    if (representa !== undefined) {
      const rol = porId.get(representa);
      if (rol !== undefined) {
        const porRol = claseDeConectable(rol);
        if (porRol !== undefined) return porRol;
      }
    }
    return claseDeConectable(nodo);
  };

  /** El nombre de clase a usar, creándola si el fichero solo la mencionaba. */
  const asegurarClase = (bruto: string): string | undefined => {
    const crudo = bruto.trim();
    if (crudo === '') return undefined;

    const yaEsta = clases.get(crudo.toLowerCase());
    if (yaEsta !== undefined) return yaEsta;

    const nombre = toPascalCase(crudo);
    if (nombre === '' || !isValidJavaIdentifier(nombre)) {
      avisos.push({
        severidad: 'aviso',
        mensaje: `«${crudo}» no sirve como nombre de clase: el objeto y sus mensajes se descartan.`,
      });
      return undefined;
    }
    const normalizada = clases.get(nombre.toLowerCase());
    if (normalizada !== undefined) return normalizada;

    if (clasesNuevas.length >= MAX_CLASES_NUEVAS) {
      avisos.push({
        severidad: 'aviso',
        mensaje: `El diagrama menciona más de ${MAX_CLASES_NUEVAS} clases que no existen: se recorta.`,
      });
      return undefined;
    }
    opsClases.push({ op: 'addClass', name: nombre, kind: 'class' });
    clases.set(nombre.toLowerCase(), nombre);
    clasesNuevas.push(nombre);
    return nombre;
  };

  const anotarAmpliada = (nombre: string): void => {
    if (contexto.enElDiagrama.has(nombre.toLowerCase())) ampliadas.add(nombre);
  };

  const anotarDependencia = (origen: string, destino: string): void => {
    // Un objeto que se manda mensajes a sí mismo no depende de sí mismo.
    if (origen.toLowerCase() === destino.toLowerCase()) return;
    const clave = [origen.toLowerCase(), destino.toLowerCase()].sort().join('|');
    // Si ya hay cualquier relación entre las dos —una asociación del propio
    // fichero, o algo que ya estaba dibujado— añadir encima una dependencia no
    // informa de nada y ensucia el lienzo con dos flechas entre las mismas cajas.
    if (relacionadas.has(clave)) return;
    relacionadas.add(clave);
    opsResto.push({
      op: 'addRelation',
      kind: 'dependency',
      source: { name: origen },
      target: { name: destino },
      sourceMultiplicity: '1',
      targetMultiplicity: '1',
    });
    anotarAmpliada(origen);
    anotarAmpliada(destino);
    enlaces += 1;
  };

  // ---- parámetros ---------------------------------------------------------

  const parametrosDe = (argumentos: readonly string[]): { name: string; type: string }[] => {
    const salida: { name: string; type: string }[] = [];
    const usados = new Set<string>();

    for (const argumento of argumentos) {
      // `nombre: Tipo` (notación UML) o `Tipo nombre` (notación Java).
      const conTipo = /^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/.exec(argumento);
      const aLaJava = /^([A-Za-z_$][\w$]*)\s+([A-Za-z_$][\w$]*)$/.exec(argumento);
      const suelto = /^[A-Za-z_$][\w$]*$/.test(argumento);

      let bruto: string;
      let tipoBruto: string | undefined;
      if (conTipo) {
        bruto = conTipo[1]!;
        tipoBruto = conTipo[2]!;
      } else if (aLaJava) {
        tipoBruto = aLaJava[1]!;
        bruto = aLaJava[2]!;
      } else if (suelto) {
        bruto = argumento;
      } else {
        // Un literal (`"hola"`, `3`, `obj.campo`) no es un parámetro con nombre:
        // es el valor concreto que se pasó en ese mensaje. Inventarle un nombre
        // pondría en la clase generada un parámetro que nadie escribió.
        continue;
      }

      const nombre = toCamelCase(bruto);
      if (nombre === '' || !isValidJavaIdentifier(nombre)) continue;
      if (usados.has(nombre.toLowerCase())) continue;
      usados.add(nombre.toLowerCase());

      let tipo = 'String';
      if (tipoBruto !== undefined) {
        const canonico = resolveTypeName(tipoBruto);
        const comoClase = clases.get(toPascalCase(tipoBruto).toLowerCase());
        tipo = canonico ?? comoClase ?? 'String';
        if (canonico === undefined && comoClase === undefined) tiposSupuestos += 1;
      } else {
        tiposSupuestos += 1;
      }
      salida.push({ name: nombre, type: tipo });
    }
    return salida;
  };

  // ---- mensajes -----------------------------------------------------------

  /**
   * De un mensaje a la línea de vida de uno de sus extremos.
   *
   * El camino del estándar es mensaje → ocurrencia → `covered` → línea de vida,
   * pero hay exportadores que se saltan la ocurrencia y apuntan directamente a
   * la línea. Se admiten las dos: comprobar qué se ha encontrado cuesta menos
   * que decidir de antemano qué herramienta escribió el fichero.
   */
  const extremo = (mensaje: XmlNode, campo: 'sendEvent' | 'receiveEvent'): XmlNode | undefined => {
    const alternativa = campo === 'receiveEvent' ? 'receiver' : 'sender';
    const referencia = refDe(mensaje, campo, alternativa);
    if (referencia === undefined) return undefined;
    const apuntado = porId.get(referencia);
    if (apuntado === undefined) return undefined;
    if (tipoUml(apuntado) === 'Lifeline' || apuntado.name === 'lifeline') return apuntado;
    const cubierta = refDe(apuntado, 'covered');
    return cubierta !== undefined ? porId.get(cubierta) : apuntado;
  };

  let sinDestino = 0;
  let recortados = false;

  for (const interaccion of interacciones) {
    const nodos = descendientes(interaccion, 'message', 'Message', 'ownedMember').filter(
      esTipo('Message'),
    );

    for (const nodo of nodos) {
      if (mensajes + sinDestino >= MAX_MENSAJES) {
        recortados = true;
        break;
      }

      const destinoObjeto = claseDeObjeto(extremo(nodo, 'receiveEvent'));
      const origenObjeto = claseDeObjeto(extremo(nodo, 'sendEvent'));
      const bruto = attr(nodo, 'name') ?? '';

      if (destinoObjeto === undefined) {
        sinDestino += 1;
        avisos.push({
          severidad: 'aviso',
          mensaje:
            bruto.trim() === ''
              ? 'Hay mensajes sin nombre o sin destinatario reconocible: se descartan.'
              : `No se sabe a qué objeto va el mensaje «${bruto.trim()}»: se descarta. ` +
                'Suele pasar cuando el objeto no declara de qué clase es.',
        });
        continue;
      }

      // El emisor primero: así las clases se proponen en el orden en que se
      // leen los mensajes —quien llama antes que a quien llama—, que es el
      // orden en que la pantalla de revisión las va a enseñar.
      const origen = origenObjeto !== undefined ? asegurarClase(origenObjeto) : undefined;
      const destino = asegurarClase(destinoObjeto);
      if (destino === undefined) continue;

      // La dependencia se anota aunque el mensaje no produzca método: que un
      // objeto cree o destruya a otro es exactamente una dependencia.
      if (origen !== undefined) anotarDependencia(origen, destino);

      const sort = (attr(nodo, 'messageSort') ?? '').trim().toLowerCase();
      if (SIN_METODO.has(sort)) continue;

      const partes = partirMensaje(bruto);
      if (partes === null) continue;

      const metodo = toCamelCase(partes.nombre);
      if (partes.sobra || !NOMBRE_DE_MENSAJE.test(partes.nombre) || !isValidJavaIdentifier(metodo)) {
        avisos.push({
          severidad: 'aviso',
          // Se cita la etiqueta entera, no el trozo que sobrevivió al análisis:
          // quien revisa tiene que poder ver qué venía en el fichero.
          mensaje: `El mensaje «${bruto.trim()}» no da un nombre de método válido y se descarta.`,
        });
        continue;
      }

      const clave = destino.toLowerCase();
      const yaTiene = metodos.get(clave) ?? new Set<string>();
      // Que el método ya conste no es un error: es lo normal cuando el mismo
      // fichero trae el diagrama de clases y el de comunicación, o cuando dos
      // objetos llaman a la misma operación. Se salta en silencio; avisar de
      // esto llenaría la pantalla de avisos que no piden nada a nadie.
      if (yaTiene.has(metodo.toLowerCase())) continue;
      yaTiene.add(metodo.toLowerCase());
      metodos.set(clave, yaTiene);

      opsResto.push({
        op: 'addMethod',
        classRef: { name: destino },
        name: metodo,
        // Un mensaje no declara qué devuelve. `void` es lo que dice el
        // diagrama, no una suposición: si devolviera algo habría un mensaje de
        // respuesta, y esos no llegan hasta aquí.
        returnType: null,
        parameters: parametrosDe(partes.argumentos),
        visibility: '+',
      });
      anotarAmpliada(destino);
      mensajes += 1;
    }
    if (recortados) break;
  }

  // ---- enlaces sin mensajes ----------------------------------------------

  for (const conector of conectores) {
    const extremos: string[] = [];
    for (const punta of hijos(conector, 'end', 'ConnectorEnd')) {
      const rol = refDe(punta, 'role', 'partWithPort');
      const nodo = rol !== undefined ? porId.get(rol) : undefined;
      const clase = claseDeObjeto(nodo);
      if (clase !== undefined) extremos.push(clase);
    }
    if (extremos.length !== 2) continue;
    const a = asegurarClase(extremos[0]!);
    const b = asegurarClase(extremos[1]!);
    if (a !== undefined && b !== undefined) anotarDependencia(a, b);
  }

  // ---- avisos de cierre ---------------------------------------------------

  if (recortados) {
    avisos.push({
      severidad: 'aviso',
      mensaje: `El fichero trae más de ${MAX_MENSAJES} mensajes: se importan los primeros.`,
    });
  }

  if (mensajes > 0) {
    avisos.push({
      severidad: 'aviso',
      mensaje:
        'El orden de los mensajes (1, 1.1, 2…) no cabe en un diagrama de clases: se importa ' +
        'su efecto —los métodos y las dependencias— pero la secuencia no se conserva.',
    });
  }

  if (tiposSupuestos > 0) {
    avisos.push({
      severidad: 'aviso',
      mensaje:
        `Los argumentos de los mensajes no declaran tipo: ${String(tiposSupuestos)} ` +
        'parámetro(s) se importan como String. Revísalos antes de generar el proyecto.',
    });
  }

  // Los avisos repetidos vienen de repetir la misma causa —veinte mensajes sin
  // destinatario dan veinte líneas idénticas—, y una lista así deja de leerse.
  const vistos = new Set<string>();
  const unicos = avisos.filter((a) => {
    if (vistos.has(a.mensaje)) return false;
    vistos.add(a.mensaje);
    return true;
  });

  return {
    operaciones: [...opsClases, ...opsResto],
    avisos: unicos,
    // Unos conectores sueltos no son un diagrama de comunicación: pueden venir
    // de una estructura compuesta. La pantalla de revisión usa esta marca para
    // titular lo que enseña, así que decir que sí cuando no lo es sería mentir
    // en la única frase que el usuario lee antes de aceptar.
    hayInteraccion: interacciones.length > 0 || colaboraciones.length > 0,
    clasesNuevas,
    ampliadas: [...ampliadas],
    mensajes,
    enlaces,
  };
}
