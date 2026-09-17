import {
  clavePar,
  enlacesEfectivos,
  etiquetaDeParticipante,
  type ClaseDeMensaje,
  type DiagramaComunicacionUml,
  type MensajeUml,
} from '@app/shared';

/**
 * Dónde va cada caja y cada flecha de un diagrama de comunicación **importado**.
 *
 * POR QUÉ NO VALE `comunicacion.ts`. Aquel coloca con una tabla fija:
 * `POSICIONES` tiene seis entradas —cliente, controlador, servicio, mapeador,
 * repositorio, entidad— y `trazar` lanza `Sin posición para el participante` en
 * cuanto le llega otra cosa. Hizo bien: los participantes de un backend
 * generado son siempre esos seis y un algoritmo de colocación habría sido
 * complejidad para un problema que no existía. Pero un diagrama importado trae
 * los objetos que trae, con los nombres que le puso quien lo dibujó, y ahí la
 * tabla fija no es una simplificación sino un fallo garantizado.
 *
 * QUÉ COLOCACIÓN Y POR QUÉ ESTA. Un anillo, con la excepción de la estrella.
 *
 * - **Anillo.** Es la forma canónica de un diagrama de comunicación y la que
 *   dibuja cualquiera a mano: los objetos alrededor y los enlaces cruzando el
 *   centro. Funciona con cualquier grafo, incluido uno desconectado, y no deja
 *   nunca dos cajas encima.
 * - **Estrella.** Cuando hay un objeto que habla con todos los demás —el caso
 *   más común de todos: una clase de control rodeada de sus colaboradores— se
 *   le pone en el centro y el resto en el anillo. Así no se cruza ni una línea.
 *
 * El orden dentro del anillo sale de un recorrido en anchura desde el objeto
 * más conectado, para que los que se hablan queden cerca. No es óptimo —reducir
 * cruces de verdad es NP-difícil— pero es determinista, que es lo que de verdad
 * importa aquí: una colocación por fuerzas daría un dibujo distinto en cada
 * pintada y otro más en el ordenador de al lado, y en un editor colaborativo
 * eso se lee como que el diagrama ha cambiado.
 *
 * POR QUÉ LOS ANCHOS SE ESTIMAN Y NO SE MIDEN. Las cajas crecen con su
 * etiqueta, porque `identidades:RepositorioDeIdentidades` no cabe en los 140
 * píxeles fijos del otro visor. Medir el texto de verdad exige un DOM, y este
 * módulo está separado del `.tsx` precisamente para poder probarlo sin
 * navegador —`jsdom` sigue sin estar instalado, tarea #15—. Se estima por
 * número de caracteres y se deja holgura; una caja un poco ancha se ve bien y
 * una medición exacta que no se puede probar, no.
 *
 * LO QUE NO HACE: quejarse. Un mensaje cuyo emisor no está entre los objetos no
 * se puede dibujar, pero tampoco tumba el trazado: sale en `omitidos` para que
 * la pantalla lo diga. Reventar con una excepción, que es lo que hacía el visor
 * anterior ante un participante desconocido, deja al usuario sin diagrama y sin
 * explicación.
 */

export interface Punto {
  x: number;
  y: number;
}

/** Alto de todas las cajas. El ancho lo decide la etiqueta. */
export const ALTO_CAJA = 46;
const ANCHO_MINIMO = 104;
const ANCHO_MAXIMO = 260;
/** Ancho aproximado de un carácter en la tipografía del lienzo, a 13 px. */
const ANCHO_CARACTER = 7.1;
const RELLENO_CAJA = 22;

/** Hueco mínimo entre dos cajas contiguas del anillo. */
const HUECO = 34;
/**
 * Aire que se exige entre los bordes de dos cajas cualesquiera. Dos cajas que
 * se rozan se leen como una sola, así que no basta con que no se solapen.
 */
const HOLGURA = 12;
/**
 * Lo más plana que se deja la elipse: `ry` nunca baja de `rx * ACHATAMIENTO`.
 * Con muchos participantes el perímetro crece a lo ancho y la elipse tiende a
 * aplastarse; pasado cierto punto deja de ser un anillo, porque las vecinas de
 * la zona de arriba quedan casi a la misma altura y se pisan aunque el
 * perímetro dé de sobra: el reparto es por longitud de arco, pero los
 * rectángulos chocan en X y en Y por separado.
 */
const ACHATAMIENTO = 0.45;
/** Aunque quepa todo, un anillo más pequeño que esto queda apretado. */
const RADIO_MINIMO = 120;
/** Margen del lienzo. Arriba va más: ahí caben los bucles de los automensajes. */
const MARGEN = 46;
const MARGEN_ARRIBA = 74;

/** Los mensajes de un mismo enlace se separan esto, en perpendicular a la línea. */
const SEPARACION = 26;
/** Longitud del trazo de cada flecha. */
const LARGO = 36;
/** Distancia del rótulo a su flecha. */
const ROTULO = 12;

export interface CajaImportada {
  /** El `xmi:id` del participante. Sirve de clave de React y de ancla. */
  id: string;
  alias: string;
  clase: string | undefined;
  /** `p1:Pedido`, `:Pedido` o `p1`. Lo que se escribe dentro de la caja. */
  etiqueta: string;
  actor: boolean;
  multiple: boolean;
  /** Esquina superior izquierda, que es lo que quiere un `<rect>`. */
  x: number;
  y: number;
  ancho: number;
  alto: number;
  /** El centro, que es de donde salen las líneas. */
  cx: number;
  cy: number;
}

export interface LineaImportada {
  clave: string;
  /** Nombre del enlace, si el fichero lo traía. */
  nombre: string | undefined;
  /** `true` si no venía como conector y se ha deducido de los mensajes. */
  deducido: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FlechaImportada {
  clave: string;
  id: string;
  numero: string;
  /** El rótulo entero, con guarda, iteración y asignación. */
  rotulo: string;
  clase: ClaseDeMensaje;
  /** El número no venía en el fichero: se dedujo del orden. */
  numeroDeducido: boolean;
  /** El trazo, ya orientado en el sentido del mensaje. */
  d: string;
  /** Dónde va el rótulo. */
  tx: number;
  ty: number;
}

export interface MensajeOmitido {
  id: string;
  numero: string;
  motivo: string;
}

export interface TrazadoImportado {
  /** Del `viewBox`, calculado para que quepa lo que hay. */
  ancho: number;
  alto: number;
  cajas: CajaImportada[];
  lineas: LineaImportada[];
  flechas: FlechaImportada[];
  omitidos: MensajeOmitido[];
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

/**
 * El rótulo de una flecha, recompuesto pieza a pieza.
 *
 * No se usa `mensaje.etiqueta`, que es lo que venía en el fichero, porque a los
 * mensajes cuyo número se dedujo del orden del documento les falta justo el
 * número —el fichero no lo traía— y saldrían sin él. Recomponiendo, todos se
 * rotulan igual vengan de donde vengan.
 */
export function rotuloDeMensaje(m: MensajeUml): string {
  const adornos = `${m.iteracion ? '*' : ''}${m.guarda === undefined ? '' : `[${m.guarda}] `}`;
  const recoge = m.asignacion === undefined ? '' : `${m.asignacion} := `;
  const llamada = m.nombre === '' ? '' : `${m.nombre}(${m.argumentos.join(', ')})`;
  return `${m.numero}: ${adornos}${recoge}${llamada}`.trimEnd();
}

function anchoDe(etiqueta: string): number {
  const estimado = Math.ceil(etiqueta.length * ANCHO_CARACTER) + RELLENO_CAJA * 2;
  return Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, estimado));
}

// ---------------------------------------------------------------------------
// Orden alrededor del anillo
// ---------------------------------------------------------------------------

/**
 * Los objetos ordenados para que los que se hablan queden contiguos.
 *
 * Recorrido en anchura desde el más conectado. A igualdad de grado manda el
 * orden en que venían en el fichero, que es lo que hace la salida determinista:
 * sin ese desempate, dos ejecuciones sobre el mismo diagrama podrían dar
 * anillos distintos según cómo iterase el mapa.
 */
function ordenar(ids: readonly string[], vecinos: ReadonlyMap<string, string[]>): string[] {
  const posicion = new Map(ids.map((id, i) => [id, i]));
  const grado = (id: string): number => vecinos.get(id)?.length ?? 0;
  const antes = (a: string, b: string): number =>
    grado(b) - grado(a) || (posicion.get(a) ?? 0) - (posicion.get(b) ?? 0);

  const pendientes = [...ids].sort(antes);
  const visitados = new Set<string>();
  const salida: string[] = [];

  for (const semilla of pendientes) {
    if (visitados.has(semilla)) continue;
    // Una cola, no una pila: en anchura los vecinos directos salen juntos, y
    // son justo los que interesa tener al lado en el anillo.
    const cola = [semilla];
    visitados.add(semilla);
    while (cola.length > 0) {
      const actual = cola.shift()!;
      salida.push(actual);
      for (const vecino of [...(vecinos.get(actual) ?? [])].sort(antes)) {
        if (visitados.has(vecino)) continue;
        visitados.add(vecino);
        cola.push(vecino);
      }
    }
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Trazado
// ---------------------------------------------------------------------------

export function trazarImportado(diagrama: DiagramaComunicacionUml): TrazadoImportado {
  const objetos = diagrama.participantes;
  if (objetos.length === 0) {
    return { ancho: 320, alto: 160, cajas: [], lineas: [], flechas: [], omitidos: [] };
  }

  const enlaces = enlacesEfectivos(diagrama);
  const conocidos = new Set(objetos.map((p) => p.id));

  const vecinos = new Map<string, string[]>();
  for (const enlace of enlaces) {
    if (!conocidos.has(enlace.a) || !conocidos.has(enlace.b) || enlace.a === enlace.b) continue;
    vecinos.set(enlace.a, [...(vecinos.get(enlace.a) ?? []), enlace.b]);
    vecinos.set(enlace.b, [...(vecinos.get(enlace.b) ?? []), enlace.a]);
  }

  const ids = objetos.map((p) => p.id);
  const anchos = new Map(objetos.map((p) => [p.id, anchoDe(etiquetaDeParticipante(p))]));

  /*
    El del centro, si lo hay: uno solo que hable con todos los demás. Con menos
    de cuatro objetos no se aplica —un triángulo no mejora poniendo un vértice
    en medio— y con dos candidatos tampoco, porque entonces no hay un centro
    sino dos y elegir uno es arbitrario.
  */
  const candidatos =
    objetos.length >= 4
      ? ids.filter((id) => new Set(vecinos.get(id) ?? []).size === objetos.length - 1)
      : [];
  const centro = candidatos.length === 1 ? candidatos[0]! : undefined;

  const enAnillo = ordenar(
    ids.filter((id) => id !== centro),
    vecinos,
  );

  const colocar = (rx: number, ry: number): Map<string, Punto> => {
    const salida = new Map<string, Punto>();
    if (centro !== undefined) salida.set(centro, { x: 0, y: 0 });
    enAnillo.forEach((id, i) => {
      if (enAnillo.length === 1) {
        salida.set(id, { x: 0, y: centro === undefined ? 0 : -ry });
        return;
      }
      // Se empieza por la izquierda para que con dos objetos queden en
      // horizontal, que es como se dibuja una conversación entre dos, y no uno
      // encima del otro.
      const angulo = Math.PI + (2 * Math.PI * i) / enAnillo.length;
      salida.set(id, { x: rx * Math.cos(angulo), y: ry * Math.sin(angulo) });
    });
    return salida;
  };

  /** ¿Se pisan dos cajas, o se quedan tan cerca que lo parece? */
  const seCruzan = (a: string, b: string, donde: ReadonlyMap<string, Punto>): boolean => {
    const pa = donde.get(a)!;
    const pb = donde.get(b)!;
    const ancho = ((anchos.get(a) ?? ANCHO_MINIMO) + (anchos.get(b) ?? ANCHO_MINIMO)) / 2;
    return (
      Math.abs(pa.x - pb.x) < ancho + HOLGURA && Math.abs(pa.y - pb.y) < ALTO_CAJA + HOLGURA
    );
  };

  const hayPisadas = (donde: ReadonlyMap<string, Punto>): boolean => {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        if (seCruzan(ids[i]!, ids[j]!, donde)) return true;
      }
    }
    return false;
  };

  /*
    El anillo tiene que dar de sí para que quepan todas las cajas con su hueco.
    El radio de partida sale del perímetro y no de un número fijo: con tres
    objetos de nombre corto un radio grande deja el dibujo vacío, y con doce de
    nombre largo uno pequeño los solapa.

    Y ese radio no basta. El perímetro reparte por **longitud de arco**, pero
    dos cajas se pisan o no según su distancia en X y en Y por separado: en una
    elipse achatada, dos vecinas de la zona de arriba están muy separadas a lo
    largo del arco y casi a la misma altura, que es justo el caso que falla.
    Por eso hay un suelo para `ry` en proporción a `rx` —una elipse demasiado
    plana no es un anillo— y, después, un crecimiento que para en cuanto nadie
    se pisa. Pocas vueltas en la práctica, y el tope evita que un caso raro
    —cien objetos de nombre larguísimo— se quede dando vueltas.
  */
  const perimetro = enAnillo.reduce(
    (suma, id) => suma + (anchos.get(id) ?? ANCHO_MINIMO) + HUECO,
    0,
  );
  let rx = Math.max(RADIO_MINIMO, perimetro / (2 * Math.PI));
  let ry = Math.max(
    RADIO_MINIMO * 0.72,
    rx * ACHATAMIENTO,
    (enAnillo.length * (ALTO_CAJA + HUECO)) / (2 * Math.PI),
  );
  let puntos = colocar(rx, ry);
  for (let vuelta = 0; vuelta < 40 && hayPisadas(puntos); vuelta += 1) {
    rx *= 1.07;
    ry *= 1.07;
    puntos = colocar(rx, ry);
  }

  // Ahora que están colocados en coordenadas relativas al centro, se traslada
  // todo para que nada quede en negativo y el `viewBox` empiece en 0.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const objeto of objetos) {
    const punto = puntos.get(objeto.id)!;
    const ancho = anchos.get(objeto.id) ?? ANCHO_MINIMO;
    minX = Math.min(minX, punto.x - ancho / 2);
    maxX = Math.max(maxX, punto.x + ancho / 2);
    minY = Math.min(minY, punto.y - ALTO_CAJA / 2);
    maxY = Math.max(maxY, punto.y + ALTO_CAJA / 2);
  }
  const dx = MARGEN - minX;
  const dy = MARGEN_ARRIBA - minY;

  const centroDe = (id: string): Punto => {
    const punto = puntos.get(id)!;
    return { x: redondear(punto.x + dx), y: redondear(punto.y + dy) };
  };

  const cajas: CajaImportada[] = objetos.map((p) => {
    const c = centroDe(p.id);
    const ancho = anchos.get(p.id) ?? ANCHO_MINIMO;
    return {
      id: p.id,
      alias: p.alias,
      clase: p.clase,
      etiqueta: etiquetaDeParticipante(p),
      actor: p.actor,
      multiple: p.multiple,
      x: redondear(c.x - ancho / 2),
      y: redondear(c.y - ALTO_CAJA / 2),
      ancho,
      alto: ALTO_CAJA,
      cx: c.x,
      cy: c.y,
    };
  });

  const lineas: LineaImportada[] = [];
  for (const enlace of enlaces) {
    if (!conocidos.has(enlace.a) || !conocidos.has(enlace.b) || enlace.a === enlace.b) continue;
    const a = centroDe(enlace.a);
    const b = centroDe(enlace.b);
    lineas.push({
      clave: clavePar(enlace.a, enlace.b),
      nombre: enlace.nombre,
      deducido: enlace.id.startsWith('deducido:'),
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    });
  }

  // ---- flechas ------------------------------------------------------------

  const omitidos: MensajeOmitido[] = [];
  const dibujables: MensajeUml[] = [];
  for (const m of diagrama.mensajes) {
    if (conocidos.has(m.de) && conocidos.has(m.a)) {
      dibujables.push(m);
      continue;
    }
    omitidos.push({
      id: m.id,
      numero: m.numero,
      motivo: conocidos.has(m.de)
        ? 'el objeto que lo recibe no está en el diagrama'
        : 'el objeto que lo envía no está en el diagrama',
    });
  }

  const porEnlace = new Map<string, number>();
  for (const m of dibujables) {
    if (m.de === m.a) continue;
    const clave = clavePar(m.de, m.a);
    porEnlace.set(clave, (porEnlace.get(clave) ?? 0) + 1);
  }
  const colocados = new Map<string, number>();

  const flechas: FlechaImportada[] = dibujables.map((m, indice) => {
    const base = {
      clave: `${m.id}-${String(indice)}`,
      id: m.id,
      numero: m.numero,
      rotulo: rotuloDeMensaje(m),
      clase: m.clase,
      numeroDeducido: m.ordenDe === 'documento',
    };

    if (m.de === m.a) {
      // Automensaje: un bucle sobre la propia caja. Dibujarlo como una flecha a
      // otro sitio sería mentir, y no dibujarlo sería perderlo.
      const caja = cajas.find((c) => c.id === m.de)!;
      const arriba = caja.y;
      return {
        ...base,
        d: `M ${redondear(caja.cx - 18)} ${arriba} A 20 18 0 1 1 ${redondear(caja.cx + 18)} ${arriba}`,
        tx: caja.cx,
        ty: arriba - 30,
      };
    }

    const clave = clavePar(m.de, m.a);
    const total = porEnlace.get(clave) ?? 1;
    const puesto = colocados.get(clave) ?? 0;
    colocados.set(clave, puesto + 1);

    const desde = centroDe(m.de);
    const hasta = centroDe(m.a);

    /*
      La perpendicular se toma del enlace, no del mensaje. Si se tomase del
      mensaje, una llamada y su respuesta —que recorren la misma línea en
      sentidos opuestos— tendrían perpendiculares opuestas, sus dos
      desplazamientos se anularían y las dos flechas acabarían una encima de
      otra. Fijándola con los extremos ordenados, todos los mensajes de un
      enlace se apilan en el mismo eje vayan en el sentido que vayan. Es el
      mismo razonamiento que en `comunicacion.ts`, y está repetido a propósito:
      allí las posiciones son fijas y aquí calculadas, y unir los dos trazados
      obligaría a que el de seis cajas cargara con un algoritmo que no necesita.
    */
    const [pa, pb] = m.de < m.a ? [desde, hasta] : [hasta, desde];
    const largo = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const nx = -(pb.y - pa.y) / largo;
    const ny = (pb.x - pa.x) / largo;

    const salto = (puesto - (total - 1) / 2) * SEPARACION;
    const cx = (desde.x + hasta.x) / 2 + nx * salto;
    const cy = (desde.y + hasta.y) / 2 + ny * salto;

    const ux = (hasta.x - desde.x) / largo;
    const uy = (hasta.y - desde.y) / largo;
    // El rótulo, por la cara de fuera de su propia flecha, para no caer sobre
    // la de al lado.
    const lado = salto < 0 ? -1 : 1;

    return {
      ...base,
      d:
        `M ${redondear(cx - (ux * LARGO) / 2)} ${redondear(cy - (uy * LARGO) / 2)} ` +
        `L ${redondear(cx + (ux * LARGO) / 2)} ${redondear(cy + (uy * LARGO) / 2)}`,
      tx: redondear(cx + nx * ROTULO * lado),
      ty: redondear(cy + ny * ROTULO * lado),
    };
  });

  return {
    ancho: Math.ceil(maxX - minX + MARGEN * 2),
    alto: Math.ceil(maxY - minY + MARGEN_ARRIBA + MARGEN),
    cajas,
    lineas,
    flechas,
    omitidos,
  };
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
