import type { CapaBackend, DiagramaComunicacion } from '@app/shared';

/**
 * Dónde va cada caja y cada flecha del diagrama de comunicación.
 *
 * Está separado de `VisorComunicacion.tsx` por lo de siempre en este proyecto:
 * las pruebas de componente siguen sin poder ejecutarse —falta `jsdom`— y la
 * geometría es justo lo que conviene comprobar. Un `.ts` al lado del `.tsx` se
 * prueba hoy; el mismo código dentro del componente, no.
 *
 * El reparto no se calcula: es fijo. Los participantes de un backend generado
 * son siempre los mismos seis y hablan siempre por los mismos cinco enlaces, así
 * que un algoritmo de colocación sería complejidad para resolver un problema que
 * no existe. Lo que sí varía —cuántos participantes aparecen y cuántos mensajes
 * lleva cada enlace— se resuelve filtrando y apilando.
 */

export interface Punto {
  x: number;
  y: number;
}

export const VISTA = { ancho: 990, alto: 380 } as const;
export const CAJA = { ancho: 140, alto: 44 } as const;

/**
 * El sitio de cada participante.
 *
 * En fila el camino de la petición —cliente, controlador, servicio— y colgando
 * del servicio sus dos colaboradores, con la entidad al lado del mapeador, que
 * es el único que la construye. Dibujado así, ningún enlace cruza a otro.
 */
export const POSICIONES: Record<string, Punto> = {
  cliente: { x: 76, y: 196 },
  controlador: { x: 258, y: 196 },
  servicio: { x: 456, y: 196 },
  mapeador: { x: 672, y: 82 },
  entidad: { x: 886, y: 82 },
  repositorio: { x: 672, y: 310 },
};

export const ROTULO_CAPA: Record<CapaBackend, string> = {
  cliente: 'Fuera del backend',
  controller: 'Capa 4 · controlador',
  service: 'Capa 3 · servicio',
  mapper: 'DTO · mapeador',
  repository: 'Capa 2 · repositorio',
  domain: 'Capa 1 · dominio',
};

export interface CajaDibujada {
  alias: string;
  clase: string;
  capa: CapaBackend;
  rotulo: string;
  paquete: string;
  /** Esquina superior izquierda, que es lo que quiere un `<rect>`. */
  x: number;
  y: number;
}

export interface LineaDibujada {
  clave: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FlechaDibujada {
  clave: string;
  numero: string;
  mensaje: string;
  retorno: boolean;
  /** El trazo de la flecha, ya orientado en el sentido del mensaje. */
  d: string;
  /** Dónde va el número. */
  tx: number;
  ty: number;
}

export interface Trazado {
  cajas: CajaDibujada[];
  lineas: LineaDibujada[];
  flechas: FlechaDibujada[];
}

/** Los mensajes de un mismo enlace se separan esto, en perpendicular a la línea. */
const SEPARACION = 30;
/** Longitud del trazo de cada flecha. */
const LARGO = 34;
/** Distancia del número a su flecha. */
const ROTULO = 13;

function claveDeEnlace(a: string, b: string): string {
  return [a, b].sort().join('~');
}

export function trazar(comunicacion: DiagramaComunicacion): Trazado {
  const cajas: CajaDibujada[] = comunicacion.participantes.map((p) => {
    const centro = POSICIONES[p.alias];
    if (!centro) throw new Error(`Sin posición para el participante «${p.alias}»`);
    return {
      alias: p.alias,
      clase: p.clase,
      capa: p.capa,
      rotulo: ROTULO_CAPA[p.capa],
      paquete: p.paquete,
      x: centro.x - CAJA.ancho / 2,
      y: centro.y - CAJA.alto / 2,
    };
  });

  const lineas: LineaDibujada[] = comunicacion.enlaces.map((e) => {
    const a = POSICIONES[e.de]!;
    const b = POSICIONES[e.a]!;
    return { clave: claveDeEnlace(e.de, e.a), x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });

  // Cuántos mensajes lleva cada enlace y en qué orden, para apilarlos centrados
  // en su línea en vez de amontonarlos todos en el punto medio.
  const porEnlace = new Map<string, number>();
  for (const m of comunicacion.mensajes) {
    if (m.de === m.a) continue;
    const clave = claveDeEnlace(m.de, m.a);
    porEnlace.set(clave, (porEnlace.get(clave) ?? 0) + 1);
  }
  const colocados = new Map<string, number>();

  const flechas: FlechaDibujada[] = comunicacion.mensajes.map((m, indice) => {
    const base = {
      clave: `${m.numero}-${indice}`,
      numero: m.numero,
      mensaje: m.mensaje,
      retorno: m.retorno === true,
    };

    if (m.de === m.a) {
      // Auto-mensaje: un bucle sobre la propia caja. El mapeador llamándose a sí
      // mismo (`update(entity, request)` dentro de `toEntity`) es real y sale en
      // la plantilla; dibujarlo como una flecha a otro sitio sería mentir.
      const c = POSICIONES[m.de]!;
      const arriba = c.y - CAJA.alto / 2;
      return {
        ...base,
        d: `M ${c.x - 18} ${arriba} A 20 18 0 1 1 ${c.x + 18} ${arriba}`,
        tx: c.x,
        ty: arriba - 30,
      };
    }

    const clave = claveDeEnlace(m.de, m.a);
    const total = porEnlace.get(clave) ?? 1;
    const puesto = colocados.get(clave) ?? 0;
    colocados.set(clave, puesto + 1);

    const desde = POSICIONES[m.de]!;
    const hasta = POSICIONES[m.a]!;

    // La perpendicular sale del enlace, no del mensaje. Si se tomase del
    // mensaje, una llamada y su respuesta —que recorren la misma línea en
    // sentidos opuestos— tendrían perpendiculares opuestas, sus dos
    // desplazamientos se anularían y las dos flechas acabarían encima una de
    // otra. Fijándola con los extremos ordenados, todos los mensajes de un
    // enlace se apilan en el mismo eje vayan en el sentido que vayan.
    const [pa, pb] = m.de < m.a ? [desde, hasta] : [hasta, desde];
    const largoEnlace = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const nx = -(pb.y - pa.y) / largoEnlace;
    const ny = (pb.x - pa.x) / largoEnlace;

    const salto = (puesto - (total - 1) / 2) * SEPARACION;
    const cx = (desde.x + hasta.x) / 2 + nx * salto;
    const cy = (desde.y + hasta.y) / 2 + ny * salto;

    // La flecha sí apunta en el sentido del mensaje: es lo único que distingue
    // «el servicio llama al repositorio» de lo contrario.
    const ux = (hasta.x - desde.x) / largoEnlace;
    const uy = (hasta.y - desde.y) / largoEnlace;
    // El número, por la cara de fuera de su propia flecha, para no caer sobre
    // la de al lado.
    const lado = salto < 0 ? -1 : 1;

    return {
      ...base,
      d: `M ${redondear(cx - (ux * LARGO) / 2)} ${redondear(cy - (uy * LARGO) / 2)} L ${redondear(
        cx + (ux * LARGO) / 2,
      )} ${redondear(cy + (uy * LARGO) / 2)}`,
      tx: redondear(cx + nx * ROTULO * lado),
      ty: redondear(cy + ny * ROTULO * lado),
    };
  });

  return { cajas, lineas, flechas };
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
