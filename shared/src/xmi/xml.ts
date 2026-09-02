/**
 * Lector de XML mínimo, suficiente para XMI y sin dependencias.
 *
 * POR QUÉ ESTÁ ESCRITO A MANO. El navegador trae `DOMParser` y Node no; añadir
 * una librería de XML tampoco era una opción en este árbol. Un lector propio en
 * `shared` resuelve las dos cosas a la vez: el mismo código analiza el fichero
 * en el navegador —donde se revisa la importación, incluso sin conexión— y en
 * las pruebas de Node, sin que haya dos analizadores que puedan discrepar.
 *
 * SEGURIDAD. Un fichero XMI es un adjunto que llega de fuera, y los analizadores
 * de XML tienen dos agujeros clásicos:
 *
 * - **Entidades externas (XXE)**: `<!ENTITY x SYSTEM "file:///etc/passwd">`
 *   convierte al analizador en un lector de ficheros del servidor. Aquí no hay
 *   nada que desactivar, porque **el `DOCTYPE` se salta entero y no se declara
 *   ninguna entidad**. Solo se traducen las cinco entidades del estándar y las
 *   numéricas. Una entidad desconocida se deja tal cual, literal y visible, en
 *   vez de resolverse o de romper el análisis.
 * - **Expansión exponencial («billion laughs»)**: por lo mismo, no existe. No
 *   hay entidades definidas por el documento, así que no hay nada que expandir.
 *
 * Contra el agotamiento de memoria por un fichero simplemente enorme o muy
 * anidado están los tres límites de abajo, que abortan con un error legible en
 * lugar de tumbar la pestaña.
 *
 * LO QUE NO HACE, dicho para que nadie lo confunda con un analizador completo:
 * no resuelve espacios de nombres (guarda el prefijo tal cual se escribió), no
 * valida contra esquema, no conserva instrucciones de proceso ni comentarios, y
 * no distingue el espacio en blanco significativo. Para XMI ninguna de esas
 * cosas hace falta.
 */

/** 8 MiB. Un XMI de un diagrama de clases realista no llega a 1. */
const MAX_ENTRADA = 8 * 1024 * 1024;
const MAX_NODOS = 200_000;
const MAX_PROFUNDIDAD = 200;

export interface XmlNode {
  /** Nombre sin prefijo: `packagedElement`, `Class`, `ownedAttribute`. */
  readonly name: string;
  /** Prefijo del espacio de nombres tal cual venía: `uml`, `xmi`, o `''`. */
  readonly prefix: string;
  /** Atributos con la clave literal del fichero, incluido el prefijo. */
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlNode[];
  /** Texto directo del elemento, ya con las entidades traducidas. */
  text: string;
}

export type ResultadoXml =
  | { readonly ok: true; readonly root: XmlNode }
  | { readonly ok: false; readonly error: string };

// ---------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------

const ENTIDADES: Record<string, string> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

const REFERENCIA = /&(#[Xx]?[0-9A-Fa-f]+|[A-Za-z_][A-Za-z0-9_.-]*);/g;

function decodificar(texto: string): string {
  if (!texto.includes('&')) return texto;
  return texto.replace(REFERENCIA, (completa, cuerpo: string) => {
    if (cuerpo.startsWith('#')) {
      const hex = cuerpo[1] === 'x' || cuerpo[1] === 'X';
      const codigo = Number.parseInt(hex ? cuerpo.slice(2) : cuerpo.slice(1), hex ? 16 : 10);
      if (!Number.isInteger(codigo) || codigo < 0 || codigo > 0x10ffff) return completa;
      // Los sustitutos sueltos producen cadenas mal formadas que luego revientan
      // al serializar; se dejan como venían.
      if (codigo >= 0xd800 && codigo <= 0xdfff) return completa;
      return String.fromCodePoint(codigo);
    }
    // Una entidad no declarada se queda literal a propósito: es la única
    // respuesta que ni inventa contenido ni oculta que el fichero traía algo
    // que este lector no interpreta.
    return ENTIDADES[cuerpo] ?? completa;
  });
}

/** Escapa texto para meterlo en un documento XML. */
export function escaparXml(valor: string): string {
  let salida = '';
  for (const caracter of valor) {
    switch (caracter) {
      case '&':
        salida += '&amp;';
        break;
      case '<':
        salida += '&lt;';
        break;
      case '>':
        salida += '&gt;';
        break;
      case '"':
        salida += '&quot;';
        break;
      case "'":
        salida += '&apos;';
        break;
      default: {
        // Los caracteres de control no son válidos en XML 1.0 ni siquiera
        // escapados; se descartan en vez de producir un fichero que ningún
        // lector acepta.
        const codigo = caracter.codePointAt(0) ?? 0;
        if (codigo < 0x20 && codigo !== 0x09 && codigo !== 0x0a && codigo !== 0x0d) break;
        salida += caracter;
      }
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Codificación
// ---------------------------------------------------------------------------

/** `<?xml version="1.0" encoding="windows-1252"?>` */
const DECLARACION = /^<\?xml[^>]*?encoding\s*=\s*["']([\w.:-]+)["']/i;

/**
 * Convierte los bytes de un fichero XML al texto que declara ser.
 *
 * Hace falta porque `File.text()` decide por su cuenta que todo es UTF-8, y
 * Enterprise Architect exporta en `windows-1252`. Con nombres en inglés no se
 * nota; en cuanto una clase se llama «Artículo» o «Días», el byte 0xED no es
 * UTF-8 válido y el decodificador lo sustituye por el rombo de interrogación.
 * A partir de ahí `toPascalCase` produce `Art culo`, la lista blanca lo rechaza
 * y el fichero se importa a medias con un aviso que culpa al nombre en vez de a
 * la lectura. Es un fallo silencioso y con la pista equivocada, la peor
 * combinación.
 *
 * La declaración se busca en los primeros bytes leídos como latin-1, que para
 * ASCII coincide con todo lo demás: en el prólogo de un XML no puede haber nada
 * que no sea ASCII, precisamente para que se pueda leer antes de saber en qué
 * codificación está el resto.
 *
 * Ante una etiqueta que el entorno no reconoce se cae a UTF-8 en lugar de
 * fallar. Un texto con algún carácter sustituido todavía se puede revisar y
 * corregir; un error de lectura no deja hacer nada.
 */
export function decodificarXml(bytes: ArrayBuffer | Uint8Array): string {
  const datos = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  // Las marcas de orden de bytes mandan sobre la declaración: si están, el
  // fichero es UTF-16 o UTF-8 diga lo que diga el prólogo.
  if (datos[0] === 0xff && datos[1] === 0xfe) return decodificarCon(datos, 'utf-16le');
  if (datos[0] === 0xfe && datos[1] === 0xff) return decodificarCon(datos, 'utf-16be');

  let prologo = '';
  for (let i = 0; i < Math.min(datos.length, 200); i += 1) {
    prologo += String.fromCharCode(datos[i]!);
  }
  const declarada = DECLARACION.exec(prologo)?.[1]?.toLowerCase();
  if (declarada === undefined || declarada === 'utf-8' || declarada === 'utf8') {
    return decodificarCon(datos, 'utf-8');
  }
  return decodificarCon(datos, declarada);
}

function decodificarCon(datos: Uint8Array, etiqueta: string): string {
  try {
    return new TextDecoder(etiqueta).decode(datos);
  } catch {
    return new TextDecoder('utf-8').decode(datos);
  }
}

// ---------------------------------------------------------------------------
// Análisis
// ---------------------------------------------------------------------------

function esEspacio(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function crearNodo(cualificado: string, attributes: Record<string, string>): XmlNode {
  const dosPuntos = cualificado.indexOf(':');
  return {
    name: dosPuntos === -1 ? cualificado : cualificado.slice(dosPuntos + 1),
    prefix: dosPuntos === -1 ? '' : cualificado.slice(0, dosPuntos),
    attributes,
    children: [],
    text: '',
  };
}

export function parseXml(fuente: string): ResultadoXml {
  if (fuente.length > MAX_ENTRADA) {
    return {
      ok: false,
      error: `El fichero ocupa ${Math.round(fuente.length / 1024 / 1024)} MB y el límite son 8 MB.`,
    };
  }

  // La marca de orden de bytes es invisible y, si se cuela, el documento
  // «empieza» por un carácter que no es `<`.
  const src = fuente.charCodeAt(0) === 0xfeff ? fuente.slice(1) : fuente;

  const pila: XmlNode[] = [];
  let raiz: XmlNode | null = null;
  let nodos = 0;
  let i = 0;

  const cima = (): XmlNode | undefined => pila[pila.length - 1];

  while (i < src.length) {
    const menor = src.indexOf('<', i);
    if (menor === -1) break;

    if (menor > i) {
      const actual = cima();
      if (actual) actual.text += decodificar(src.slice(i, menor));
    }

    // ---- comentario ------------------------------------------------------
    if (src.startsWith('<!--', menor)) {
      const fin = src.indexOf('-->', menor + 4);
      if (fin === -1) return { ok: false, error: 'Comentario sin cerrar.' };
      i = fin + 3;
      continue;
    }

    // ---- CDATA -----------------------------------------------------------
    if (src.startsWith('<![CDATA[', menor)) {
      const fin = src.indexOf(']]>', menor + 9);
      if (fin === -1) return { ok: false, error: 'Sección CDATA sin cerrar.' };
      const actual = cima();
      // El contenido de CDATA es literal: no se decodifica.
      if (actual) actual.text += src.slice(menor + 9, fin);
      i = fin + 3;
      continue;
    }

    // ---- declaración e instrucciones de proceso --------------------------
    if (src.startsWith('<?', menor)) {
      const fin = src.indexOf('?>', menor + 2);
      if (fin === -1) return { ok: false, error: 'Declaración XML sin cerrar.' };
      i = fin + 2;
      continue;
    }

    // ---- DOCTYPE: se salta entero (ver la nota de seguridad de arriba) ----
    if (src.startsWith('<!', menor)) {
      let j = menor + 2;
      let subconjunto = false;
      while (j < src.length) {
        const c = src[j];
        if (c === '[') subconjunto = true;
        else if (c === ']') subconjunto = false;
        else if (c === '>' && !subconjunto) break;
        j++;
      }
      if (j >= src.length) return { ok: false, error: 'DOCTYPE sin cerrar.' };
      i = j + 1;
      continue;
    }

    // ---- etiqueta de cierre ----------------------------------------------
    if (src[menor + 1] === '/') {
      const fin = src.indexOf('>', menor + 2);
      if (fin === -1) return { ok: false, error: 'Etiqueta de cierre sin cerrar.' };
      const cualificado = src.slice(menor + 2, fin).trim();
      const abierto = pila.pop();
      if (!abierto) {
        return { ok: false, error: `Cierre sobrante de «${cualificado}».` };
      }
      const esperado = abierto.prefix ? `${abierto.prefix}:${abierto.name}` : abierto.name;
      if (cualificado !== esperado) {
        return {
          ok: false,
          error: `Se cierra «${cualificado}» pero estaba abierto «${esperado}».`,
        };
      }
      i = fin + 1;
      continue;
    }

    // ---- etiqueta de apertura --------------------------------------------
    let j = menor + 1;
    while (j < src.length && !esEspacio(src[j]!) && src[j] !== '>' && src[j] !== '/') j++;
    const cualificado = src.slice(menor + 1, j);
    if (cualificado.length === 0) {
      return { ok: false, error: `Etiqueta sin nombre en la posición ${menor}.` };
    }

    if (++nodos > MAX_NODOS) {
      return { ok: false, error: `El fichero pasa de ${MAX_NODOS} elementos.` };
    }

    const atributos: Record<string, string> = {};

    // ---- atributos --------------------------------------------------------
    let autocierre = false;
    for (;;) {
      while (j < src.length && esEspacio(src[j]!)) j++;
      if (j >= src.length) return { ok: false, error: `«${cualificado}» sin cerrar.` };

      if (src[j] === '>') {
        j++;
        break;
      }
      if (src[j] === '/' && src[j + 1] === '>') {
        autocierre = true;
        j += 2;
        break;
      }

      const inicioNombre = j;
      while (
        j < src.length &&
        !esEspacio(src[j]!) &&
        src[j] !== '=' &&
        src[j] !== '>' &&
        src[j] !== '/'
      ) {
        j++;
      }
      const nombre = src.slice(inicioNombre, j);
      if (nombre.length === 0) {
        return { ok: false, error: `Atributo mal formado en «${cualificado}».` };
      }

      while (j < src.length && esEspacio(src[j]!)) j++;
      if (src[j] !== '=') {
        // Atributo sin valor: no es XML válido, pero aparece en ficheros
        // generados a mano. Se le da la cadena vacía y se sigue.
        atributos[nombre] = '';
        continue;
      }
      j++;
      while (j < src.length && esEspacio(src[j]!)) j++;

      const comilla = src[j];
      if (comilla !== '"' && comilla !== "'") {
        return { ok: false, error: `El atributo «${nombre}» no lleva comillas.` };
      }
      const inicioValor = ++j;
      const finValor = src.indexOf(comilla, inicioValor);
      if (finValor === -1) {
        return { ok: false, error: `El atributo «${nombre}» no cierra las comillas.` };
      }
      atributos[nombre] = decodificar(src.slice(inicioValor, finValor));
      j = finValor + 1;
    }

    const nodo = crearNodo(cualificado, atributos);

    const padre = cima();
    if (padre) padre.children.push(nodo);
    else if (raiz) {
      // Un segundo elemento en la raíz: el documento tiene más de un árbol.
      return { ok: false, error: 'El documento tiene más de un elemento raíz.' };
    } else raiz = nodo;

    if (!autocierre) {
      if (pila.length >= MAX_PROFUNDIDAD) {
        return { ok: false, error: `Anidamiento de más de ${MAX_PROFUNDIDAD} niveles.` };
      }
      pila.push(nodo);
    }
    i = j;
  }

  if (pila.length > 0) {
    const sinCerrar = pila[pila.length - 1]!;
    return { ok: false, error: `«${sinCerrar.name}» se queda sin cerrar.` };
  }
  if (!raiz) return { ok: false, error: 'El fichero no contiene ningún elemento XML.' };
  return { ok: true, root: raiz };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

/**
 * Primer atributo que exista de los indicados, probando también sin prefijo.
 *
 * Los ficheros reales escriben `xmi:id`, `xmi:idref` o `xmi.id` según la
 * versión de XMI y la herramienta, y algunos omiten el prefijo. Pedir el
 * nombre exacto obligaría a repetir la misma lista en cada sitio que lo lee.
 */
export function attr(nodo: XmlNode, ...nombres: string[]): string | undefined {
  for (const nombre of nombres) {
    const directo = nodo.attributes[nombre];
    if (directo !== undefined) return directo;
  }
  const sinPrefijo = new Map<string, string>();
  for (const [clave, valor] of Object.entries(nodo.attributes)) {
    const corte = clave.indexOf(':');
    sinPrefijo.set(corte === -1 ? clave : clave.slice(corte + 1), valor);
  }
  for (const nombre of nombres) {
    const corte = nombre.indexOf(':');
    const local = corte === -1 ? nombre : nombre.slice(corte + 1);
    const valor = sinPrefijo.get(local);
    if (valor !== undefined) return valor;
  }
  return undefined;
}

/** Hijos directos cuyo nombre local coincide. */
export function hijos(nodo: XmlNode, ...nombres: string[]): XmlNode[] {
  return nodo.children.filter((c) => nombres.includes(c.name));
}

/**
 * Todos los descendientes con ese nombre local, incluido el propio nodo, **en
 * orden de documento**.
 *
 * El orden importa: los atributos de una clase se numeran por su posición en el
 * fichero, y devolverlos al revés reordenaría en silencio las columnas de la
 * tabla generada. Por eso la pila se llena en orden inverso, para desapilar en
 * el orden correcto.
 */
export function descendientes(nodo: XmlNode, ...nombres: string[]): XmlNode[] {
  const encontrados: XmlNode[] = [];
  const pendientes: XmlNode[] = [nodo];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    if (nombres.includes(actual.name)) encontrados.push(actual);
    for (let k = actual.children.length - 1; k >= 0; k--) {
      pendientes.push(actual.children[k]!);
    }
  }
  return encontrados;
}
