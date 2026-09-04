import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * La foto que se está revisando, con zoom y arrastre.
 *
 * Existe por un motivo muy concreto. La pantalla de importar un diagrama marca
 * en rojo las cardinalidades que el modelo no supo leer y pide que se comparen
 * con la imagen antes de aceptar. Pero la imagen se enseñaba encajada en una
 * columna de 240 px: un «0..1» escrito con rotulador en una pizarra, fotografiado
 * de lejos y reducido a esa anchura, no se lee. Se estaba pidiendo una
 * comprobación sin dar con qué hacerla, y una comprobación imposible se acaba
 * despachando con un clic.
 *
 * De ahí las decisiones de dentro:
 *
 * - El zoom va al punto que se señala (rueda o doble clic), no al centro. Al
 *   revisar se mira un extremo de flecha concreto; centrar obligaría a arrastrar
 *   después, cada vez.
 * - La imagen no puede salirse de su marco. Perderla de vista y no saber hacia
 *   dónde volver es el fallo más común de estos visores, y se evita sujetando el
 *   desplazamiento en cada cambio en vez de dejarlo libre.
 * - Todo lo que se hace con el ratón se puede hacer con el teclado, porque esta
 *   es la pantalla donde se aprueba lo que va a entrar al diagrama y no puede
 *   depender de un dispositivo señalador.
 */

const ESCALA_MINIMA = 1;
const ESCALA_MAXIMA = 8;
/** Un paso de botón o de tecla. Multiplicativo: al 400 % un +0,25 no se nota. */
const PASO = 1.4;

interface Vista {
  escala: number;
  x: number;
  y: number;
}

const VISTA_INICIAL: Vista = { escala: 1, x: 0, y: 0 };

const acotar = (valor: number, minimo: number, maximo: number): number =>
  Math.min(Math.max(valor, minimo), maximo);

export interface FotoConLupaProps {
  src: string;
  alt: string;
}

export function FotoConLupa({ src, alt }: FotoConLupaProps): JSX.Element {
  const marco = useRef<HTMLDivElement | null>(null);
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 });
  const [natural, setNatural] = useState<{ ancho: number; alto: number } | null>(null);
  const [vista, setVista] = useState<Vista>(VISTA_INICIAL);
  const arrastre = useRef<{ x: number; y: number; desdeX: number; desdeY: number } | null>(null);

  // El marco cambia de tamaño al plegarse la rejilla en pantallas estrechas, y
  // el encaje depende de su medida. Sin observarlo, al pasar de dos columnas a
  // una la imagen queda descolocada hasta que alguien la toca.
  useLayoutEffect(() => {
    const nodo = marco.current;
    if (!nodo) return;
    const medir = (): void => {
      setCaja({ ancho: nodo.clientWidth, alto: nodo.clientHeight });
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  // Otra foto es otra revisión: se vuelve a empezar encajada.
  useEffect(() => {
    setVista(VISTA_INICIAL);
    setNatural(null);
  }, [src]);

  /** Tamaño de la imagen encajada en el marco, antes de aplicar el zoom. */
  const base =
    natural && caja.ancho > 0 && caja.alto > 0
      ? Math.min(caja.ancho / natural.ancho, caja.alto / natural.alto)
      : 0;
  const anchoBase = natural ? natural.ancho * base : 0;
  const altoBase = natural ? natural.alto * base : 0;

  /**
   * Sujeta el desplazamiento para que la imagen no se pueda perder de vista.
   *
   * Cuando cabe entera en un eje se centra en él; cuando no cabe, se permite
   * mover hasta el borde y ni un píxel más.
   */
  const encajar = useCallback(
    (v: Vista): Vista => {
      const ancho = anchoBase * v.escala;
      const alto = altoBase * v.escala;
      return {
        escala: v.escala,
        x: ancho <= caja.ancho ? (caja.ancho - ancho) / 2 : acotar(v.x, caja.ancho - ancho, 0),
        y: alto <= caja.alto ? (caja.alto - alto) / 2 : acotar(v.y, caja.alto - alto, 0),
      };
    },
    [anchoBase, altoBase, caja.ancho, caja.alto],
  );

  // Al conocerse el tamaño real de la imagen o al cambiar el del marco hay que
  // recentrar: hasta ese momento el encaje se calculó con medidas a cero.
  useEffect(() => {
    setVista((actual) => encajar(actual));
  }, [encajar]);

  /**
   * Cambia el zoom dejando quieto el punto señalado.
   *
   * `haciaX`/`haciaY` van en coordenadas del marco. Sin pasarlas se usa el
   * centro, que es lo que quieren los botones y las teclas.
   */
  const ampliar = useCallback(
    (factor: number, haciaX?: number, haciaY?: number): void => {
      setVista((actual) => {
        const nueva = acotar(actual.escala * factor, ESCALA_MINIMA, ESCALA_MAXIMA);
        if (nueva === actual.escala) return actual;
        const px = haciaX ?? caja.ancho / 2;
        const py = haciaY ?? caja.alto / 2;
        const proporcion = nueva / actual.escala;
        return encajar({
          escala: nueva,
          x: px - (px - actual.x) * proporcion,
          y: py - (py - actual.y) * proporcion,
        });
      });
    },
    [caja.ancho, caja.alto, encajar],
  );

  // La rueda se escucha a mano y no con `onWheel` porque React registra ese
  // evento como pasivo: desde el manejador de React, `preventDefault` no hace
  // nada y la página entera se desplaza mientras se intenta acercar la foto.
  useEffect(() => {
    const nodo = marco.current;
    if (!nodo) return;
    const alGirar = (evento: WheelEvent): void => {
      evento.preventDefault();
      const rect = nodo.getBoundingClientRect();
      ampliar(
        evento.deltaY < 0 ? PASO : 1 / PASO,
        evento.clientX - rect.left,
        evento.clientY - rect.top,
      );
    };
    nodo.addEventListener('wheel', alGirar, { passive: false });
    return () => nodo.removeEventListener('wheel', alGirar);
  }, [ampliar]);

  const alPulsar = (evento: React.PointerEvent<HTMLDivElement>): void => {
    if (vista.escala <= ESCALA_MINIMA) return;
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrastre.current = {
      x: evento.clientX,
      y: evento.clientY,
      desdeX: vista.x,
      desdeY: vista.y,
    };
  };

  const alMover = (evento: React.PointerEvent<HTMLDivElement>): void => {
    const desde = arrastre.current;
    if (!desde) return;
    setVista((actual) =>
      encajar({
        escala: actual.escala,
        x: desde.desdeX + (evento.clientX - desde.x),
        y: desde.desdeY + (evento.clientY - desde.y),
      }),
    );
  };

  const alSoltar = (evento: React.PointerEvent<HTMLDivElement>): void => {
    if (arrastre.current) evento.currentTarget.releasePointerCapture(evento.pointerId);
    arrastre.current = null;
  };

  const desplazar = (dx: number, dy: number): void => {
    setVista((actual) => encajar({ ...actual, x: actual.x + dx, y: actual.y + dy }));
  };

  const alTeclear = (evento: React.KeyboardEvent<HTMLDivElement>): void => {
    // Un salto proporcional al zoom: al 800 % una flecha debe recorrer lo mismo
    // en la foto, no en la pantalla, o cruzarla cuesta cincuenta pulsaciones.
    const salto = 40;
    const teclas: Record<string, () => void> = {
      ArrowLeft: () => desplazar(salto, 0),
      ArrowRight: () => desplazar(-salto, 0),
      ArrowUp: () => desplazar(0, salto),
      ArrowDown: () => desplazar(0, -salto),
      '+': () => ampliar(PASO),
      '=': () => ampliar(PASO),
      '-': () => ampliar(1 / PASO),
      '0': () => setVista(encajar(VISTA_INICIAL)),
    };
    const accion = teclas[evento.key];
    if (!accion) return;
    evento.preventDefault();
    accion();
  };

  const ampliada = vista.escala > ESCALA_MINIMA;

  return (
    <div className="lupa">
      <div
        ref={marco}
        className={ampliada ? 'lupa__marco lupa__marco--ampliada' : 'lupa__marco'}
        tabIndex={0}
        role="group"
        aria-label={`${alt}. Acercar con + y −, mover con las flechas, 0 para encajarla`}
        onPointerDown={alPulsar}
        onPointerMove={alMover}
        onPointerUp={alSoltar}
        onPointerCancel={alSoltar}
        onKeyDown={alTeclear}
        onDoubleClick={(evento) => {
          const rect = evento.currentTarget.getBoundingClientRect();
          ampliar(PASO * PASO, evento.clientX - rect.left, evento.clientY - rect.top);
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={{
            width: anchoBase > 0 ? `${anchoBase}px` : '100%',
            height: altoBase > 0 ? `${altoBase}px` : 'auto',
            transform: `translate(${vista.x}px, ${vista.y}px) scale(${vista.escala})`,
            // Interpolar al reducir es lo correcto; al ampliar por encima del
            // tamaño real de la foto, no: el suavizado convierte un «0..1»
            // escrito a rotulador en una mancha justo cuando hay que leerlo.
            imageRendering: base * vista.escala >= 1 ? 'pixelated' : 'auto',
          }}
          onLoad={(evento) =>
            setNatural({
              ancho: evento.currentTarget.naturalWidth,
              alto: evento.currentTarget.naturalHeight,
            })
          }
        />
      </div>

      <div className="lupa__mandos">
        <button
          type="button"
          className="boton boton--discreto"
          aria-label="Alejar la imagen"
          disabled={vista.escala <= ESCALA_MINIMA}
          onClick={() => ampliar(1 / PASO)}
        >
          −
        </button>
        <span className="lupa__nivel" aria-live="polite">
          {Math.round(vista.escala * 100)}%
        </span>
        <button
          type="button"
          className="boton boton--discreto"
          aria-label="Acercar la imagen"
          disabled={vista.escala >= ESCALA_MAXIMA}
          onClick={() => ampliar(PASO)}
        >
          +
        </button>
        <button
          type="button"
          className="boton boton--discreto"
          disabled={!ampliada}
          onClick={() => setVista(encajar(VISTA_INICIAL))}
        >
          Encajar
        </button>
        <span className="lupa__pista">
          {ampliada ? 'Arrastrar para desplazar la foto' : 'Rueda o doble clic para acercar'}
        </span>
      </div>
    </div>
  );
}
