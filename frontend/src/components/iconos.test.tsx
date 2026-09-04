import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Icono, NOMBRES_ICONO, type NombreIcono } from './iconos';

/**
 * Pruebas del repertorio de iconos.
 *
 * No hace falta un navegador para esto. Un elemento de React es un objeto
 * corriente hasta que alguien lo pinta, así que se puede llamar a `Icono` como a
 * cualquier función y mirar lo que devuelve. Eso permite comprobar aquí lo único
 * que un icono puede romper en silencio: que se cuele un color fijo —y entonces
 * el icono se queda azul dentro de un botón deshabilitado gris—, que alguien
 * cambie el `viewBox` y todos los trazos dejen de encajar, o que un icono se
 * anuncie solo a un lector de pantalla.
 */

/** Recorre el árbol de un elemento y devuelve todos los nodos que dibujan algo. */
function trazos(nodo: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(nodo)) return nodo.flatMap(trazos);
  if (!isValidElement(nodo)) return [];
  const elemento = nodo as ReactElement<{ children?: ReactNode }>;
  const hijos = trazos(elemento.props.children);
  // Un fragmento agrupa, no pinta: se recorre pero no cuenta como trazo.
  if (typeof elemento.type !== 'string') return hijos;
  return [elemento as ReactElement<Record<string, unknown>>, ...hijos];
}

const svgDe = (nombre: NombreIcono) => Icono({ nombre });

describe('Icono', () => {
  it('dibuja los treinta y dos del repertorio y ninguno repetido', () => {
    expect(new Set(NOMBRES_ICONO).size).toBe(NOMBRES_ICONO.length);
    expect(NOMBRES_ICONO.length).toBeGreaterThanOrEqual(32);
  });

  it.each(NOMBRES_ICONO)('«%s» sale en la rejilla de 16 y con al menos un trazo', (nombre) => {
    const svg = svgDe(nombre);
    const props = svg.props as Record<string, unknown>;
    // El viewBox es el contrato: todas las coordenadas de `iconos.tsx` están
    // escritas para esta rejilla. Cambiarlo en un icono suelto lo descuadra
    // frente a los otros treinta y uno.
    expect(props.viewBox).toBe('0 0 16 16');
    expect(props.width).toBe('16');
    expect(props.height).toBe('16');
    expect(trazos(props.children as ReactNode).length).toBeGreaterThan(0);
  });

  it.each(NOMBRES_ICONO)('«%s» no lleva ningún color fijo', (nombre) => {
    // El icono hereda el color del botón que lo contiene. Un `#5b9cff` escrito a
    // mano sobrevive al tema claro, al estado deshabilitado y al botón de
    // acento, y en los tres se ve mal. Solo se admite `currentColor` y `none`.
    const admitidos = new Set([undefined, 'none', 'currentColor']);
    for (const trazo of trazos((svgDe(nombre).props as { children: ReactNode }).children)) {
      expect(admitidos.has(trazo.props.fill as string | undefined)).toBe(true);
      expect(admitidos.has(trazo.props.stroke as string | undefined)).toBe(true);
    }
  });

  it.each(NOMBRES_ICONO)('«%s» no se anuncia por su cuenta', (nombre) => {
    // Sin esto un lector de pantalla lee «gráfico» delante de cada botón. Lo que
    // informa es el texto o el `aria-label` del botón, no el dibujo.
    const props = svgDe(nombre).props as Record<string, unknown>;
    expect(props['aria-hidden']).toBe('true');
    expect(props.focusable).toBe('false');
  });

  it('la clase base está siempre y la extra se añade sin pisarla', () => {
    // `.icono` es la que trae el trazo y el color; si una clase extra la
    // sustituyera, el icono saldría en negro relleno sobre fondo oscuro.
    expect((svgDe('clase').props as { className: string }).className).toBe('icono');
    expect(
      (Icono({ nombre: 'clase', className: 'paleta__icono' }).props as { className: string })
        .className,
    ).toBe('icono paleta__icono');
  });

  it('los seis tipos de relación tienen icono', () => {
    // La paleta los recorre por su `kind`; si falta uno, el botón sale vacío.
    for (const kind of [
      'asociacion',
      'agregacion',
      'composicion',
      'herencia',
      'realizacion',
      'dependencia',
    ] as const) {
      expect(NOMBRES_ICONO).toContain(kind);
    }
  });

  it('las relaciones discontinuas de UML se dibujan discontinuas', () => {
    // Realización y dependencia van con línea de puntos en UML. Si se dibujan
    // continuas, el icono dice «herencia» y «asociación», que es justo lo que el
    // usuario tiene que poder distinguir de un vistazo.
    for (const nombre of ['realizacion', 'dependencia'] as const) {
      const punteados = trazos((svgDe(nombre).props as { children: ReactNode }).children).filter(
        (t) => typeof t.props.strokeDasharray === 'string',
      );
      expect(punteados.length).toBeGreaterThan(0);
    }
    expect(
      trazos((svgDe('herencia').props as { children: ReactNode }).children).some(
        (t) => typeof t.props.strokeDasharray === 'string',
      ),
    ).toBe(false);
  });

  it('el rombo de la composición va relleno y el de la agregación hueco', () => {
    // Es la única diferencia entre las dos en la notación, y significan cosas
    // distintas: si la parte muere con el todo o no.
    const relleno = (nombre: NombreIcono) =>
      trazos((svgDe(nombre).props as { children: ReactNode }).children).some(
        (t) => t.props.fill === 'currentColor',
      );
    expect(relleno('composicion')).toBe(true);
    expect(relleno('agregacion')).toBe(false);
  });
});
