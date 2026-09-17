import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ALTURA_ASIDERO,
  alturaArrastrada,
  alturaDe,
  campoVisible,
  desplazamientoPorTeclado,
  destinoAlSoltar,
  tecladoAbierto,
  type ArrastreHoja,
  type PosicionHoja,
} from './movil-hoja';
import type { Pantalla } from './movil-reparto';
import { Icono } from './iconos';

/**
 * La hoja que sube desde abajo.
 *
 * Sustituye a la columna acoplada del escritorio, y no por falta de sitio: en un
 * teléfono la ficha de propiedades **tiene que poder desaparecer**, porque el
 * diagrama es lo que se está mirando y la ficha solo hace falta a ratos. Una
 * columna fija de 360 px sobre 390 px de pantalla no es una columna estrecha, es
 * una pantalla sin diagrama.
 *
 * Todo lo que decide cuánto sube, dónde se queda al soltar y cómo se esquiva el
 * teclado está en `movil-hoja.ts`, que no toca el DOM y tiene 34 pruebas. Aquí solo
 * quedan los eventos y los estilos.
 *
 * ## El teclado
 *
 * Es el fallo clásico del formulario en un móvil y el encargo pedía comprobarlo de
 * verdad, así que está resuelto en dos mitades:
 *
 * 1. La hoja se ancla a `altoVisible` —lo que se ve— y no al fondo de la ventana.
 *    Anclada al fondo, la hoja entera se va **debajo** del teclado.
 * 2. Al enfocar un campo se desplaza el contenido de la hoja lo justo para que ese
 *    campo quede sobre el teclado. El cálculo es `desplazamientoPorTeclado`, y hay
 *    una prueba que barre todas las posiciones posibles del campo comprobando que
 *    acaba visible.
 */
export function HojaMovil({
  titulo,
  pantalla,
  posicion,
  onPosicion,
  onCerrar,
  cuerpoFijo = false,
  children,
}: {
  titulo: string;
  pantalla: Pantalla;
  posicion: PosicionHoja;
  onPosicion: (posicion: PosicionHoja) => void;
  onCerrar: () => void;
  /**
   * El contenido se encarga él mismo de desplazarse y la hoja no debe añadir
   * un segundo desplazamiento por fuera.
   *
   * Lo pide el tablón, que es el único contenido con algo anclado abajo: el
   * cuadro de escribir. Con la hoja desplazándose también, ese cuadro se va
   * hacia abajo al leer mensajes viejos y hay que volver a bajar para
   * escribir. Con dos barras de desplazamiento superpuestas, además, el dedo
   * mueve una u otra según dónde empiece el gesto, que es la clase de detalle
   * que parece un fallo aunque esté haciendo justo lo que se le pidió.
   */
  cuerpoFijo?: boolean;
  children: ReactNode;
}): JSX.Element | null {
  /*
    Mientras el dedo está encima, la altura la manda el dedo y no la posición de
    reposo. Son dos fuentes distintas a propósito: si el arrastre escribiera en
    `posicion`, cada píxel recorrido sería un cambio de estado en el componente
    padre y el lienzo se repintaría con él.
  */
  const [arrastre, setArrastre] = useState<ArrastreHoja | null>(null);
  const [alturaViva, setAlturaViva] = useState<number | null>(null);
  const ultimo = useRef({ y: 0, ms: 0, velocidad: 0 });

  const cuerpo = useRef<HTMLDivElement | null>(null);
  const [desplazamiento, setDesplazamiento] = useState(0);

  const altura = alturaViva ?? alturaDe(posicion, pantalla);

  /*
    El teclado se cierra y el desplazamiento se queda puesto: el contenido aparece
    subido y con un hueco abajo. Se devuelve a cero en cuanto el teclado se va.
  */
  useEffect(() => {
    if (!tecladoAbierto(pantalla)) setDesplazamiento(0);
  }, [pantalla]);

  const alEnfocar = useCallback(
    (evento: React.FocusEvent<HTMLDivElement>) => {
      const destino = evento.target as HTMLElement;
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(destino.tagName)) return;
      if (!tecladoAbierto(pantalla)) return;

      const caja = destino.getBoundingClientRect();
      const campo = { arriba: caja.top, alto: caja.height };
      if (campoVisible(campo, pantalla, 0)) return;
      setDesplazamiento(desplazamientoPorTeclado(campo, pantalla));
    },
    [pantalla],
  );

  const alPosar = (evento: React.PointerEvent<HTMLDivElement>): void => {
    // `setPointerCapture` y no un listener en `window`: si el dedo sale del
    // asidero a media bajada —que es lo normal, porque el asidero se mueve con
    // él— los eventos siguen llegando aquí.
    evento.currentTarget.setPointerCapture(evento.pointerId);
    setArrastre({ alturaInicial: altura, yInicial: evento.clientY });
    ultimo.current = { y: evento.clientY, ms: evento.timeStamp, velocidad: 0 };
  };

  const alMover = (evento: React.PointerEvent<HTMLDivElement>): void => {
    if (!arrastre) return;
    const transcurrido = evento.timeStamp - ultimo.current.ms;
    if (transcurrido > 0) {
      // Píxeles por segundo, con el signo de la pantalla: hacia abajo es
      // positivo. `destinoAlSoltar` espera ese convenio.
      const velocidad = ((evento.clientY - ultimo.current.y) / transcurrido) * 1000;
      ultimo.current = { y: evento.clientY, ms: evento.timeStamp, velocidad };
    }
    setAlturaViva(alturaArrastrada(arrastre, evento.clientY, pantalla));
  };

  const alLevantar = (): void => {
    if (!arrastre) return;
    const destino = destinoAlSoltar(altura, ultimo.current.velocidad, pantalla);
    setArrastre(null);
    setAlturaViva(null);
    if (destino === 'oculta') onCerrar();
    else onPosicion(destino);
  };

  return (
    <div
      className="hoja-movil"
      style={{
        height: `${String(altura)}px`,
        // Anclada a lo que se ve, no al fondo de la ventana: con el teclado
        // abierto son cosas distintas y la diferencia es la hoja entera debajo
        // del teclado.
        top: `${String(pantalla.altoVisible - altura)}px`,
        // Sin transición mientras el dedo manda: una animación de 200 ms sobre
        // una altura que cambia cada 16 ms va siempre un paso por detrás del
        // dedo y se siente como si la hoja pesara.
        transition: arrastre ? 'none' : 'top 180ms ease, height 180ms ease',
      }}
      role="dialog"
      aria-modal="false"
      aria-label={titulo}
    >
      <div
        className="hoja-movil__asidero"
        style={{
          height: `${String(ALTURA_ASIDERO)}px`,
          // `none` para que el navegador no intente desplazar la página con el
          // mismo gesto: sin esto, arrastrar el asidero hacia abajo hace las dos
          // cosas a la vez en Android —baja la hoja y rebota la página—.
          touchAction: 'none',
        }}
        onPointerDown={alPosar}
        onPointerMove={alMover}
        onPointerUp={alLevantar}
        onPointerCancel={alLevantar}
      >
        <span className="hoja-movil__tirador" aria-hidden="true" />
      </div>

      <div className="hoja-movil__cabecera">
        <h2 className="hoja-movil__titulo">{titulo}</h2>
        <button
          type="button"
          className="hoja-movil__cerrar"
          onClick={onCerrar}
          aria-label={`Cerrar ${titulo}`}
        >
          <Icono nombre="cerrar" />
        </button>
      </div>

      <div
        className={`hoja-movil__cuerpo${cuerpoFijo ? ' hoja-movil__cuerpo--fijo' : ''}`}
        ref={cuerpo}
        onFocus={alEnfocar}
        style={{ transform: `translateY(${String(-desplazamiento)}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
