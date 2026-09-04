import type { ReactNode } from 'react';
import {
  ANCHO_MAXIMO,
  ANCHO_MINIMO,
  TITULOS,
  type Acoplado,
  type Lado,
} from './paneles';
import { PASO_TECLADO, type ControlDePaneles } from '../hooks/usePaneles';
import { Icono } from './iconos';

/**
 * Los paneles acoplados y sus canaletas.
 *
 * Un panel plegado no se esconde con `display:none`: deja de renderizarse. Un
 * botón invisible sigue estando en el árbol, lo encuentra el tabulador y lo lee
 * un lector de pantalla, así que «no se ve» y «no está» tienen que ser lo mismo
 * o la interfaz miente a quien no la mira.
 */

const NOMBRE_LADO: Record<Lado, string> = {
  izquierda: 'izquierda',
  derecha: 'derecha',
};

export function PanelAcoplado({
  titulo,
  plegado,
  onAlternar,
  acciones,
  children,
}: {
  titulo: string;
  plegado: boolean;
  onAlternar: () => void;
  /** Botones propios del panel, a la derecha de su título. */
  acciones?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className={`acoplado${plegado ? ' acoplado--plegado' : ''}`}>
      <div className="acoplado__cabecera">
        <h2 className="acoplado__titulo">
          <button
            type="button"
            className="acoplado__interruptor"
            aria-expanded={!plegado}
            onClick={onAlternar}
          >
            <Icono nombre={plegado ? 'desplegar' : 'plegar'} className="acoplado__flecha" />
            {titulo}
          </button>
        </h2>
        {acciones && <div className="acoplado__acciones">{acciones}</div>}
      </div>

      {!plegado && <div className="acoplado__cuerpo">{children}</div>}
    </section>
  );
}

/**
 * La canaleta que separa una columna del lienzo.
 *
 * Es un `separator` enfocable —lo que ARIA llama un divisor de ventana— y no un
 * `div` con `onPointerDown`. Sin eso, el ancho de los paneles sería lo único de
 * la aplicación que solo se puede cambiar con un ratón, y quien trabaje con el
 * teclado se quedaría con el reparto que le tocara.
 */
function Canaleta({ lado, control }: { lado: Lado; control: ControlDePaneles }): JSX.Element {
  const columna = control.disposicion[lado];
  // La flecha que ensancha apunta hacia el lienzo: en la columna izquierda es la
  // derecha y en la derecha es la izquierda. Al revés se sentiría como si el
  // panel se moviera en dirección contraria al dedo.
  const haciaFuera = lado === 'izquierda' ? 'ArrowRight' : 'ArrowLeft';
  const haciaDentro = lado === 'izquierda' ? 'ArrowLeft' : 'ArrowRight';

  return (
    <div
      className={`canaleta canaleta--${lado}${
        control.ladoArrastrado === lado ? ' canaleta--activa' : ''
      }`}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={`Ancho de la columna ${NOMBRE_LADO[lado]}`}
      aria-valuenow={columna.ancho}
      aria-valuemin={ANCHO_MINIMO}
      aria-valuemax={ANCHO_MAXIMO}
      title="Arrastrar para cambiar el ancho; doble clic para plegar la columna"
      onPointerDown={(evento) => control.iniciarArrastre(lado, evento)}
      onDoubleClick={() => control.alternarLado(lado)}
      onKeyDown={(evento) => {
        if (evento.key === haciaFuera) control.empujar(lado, PASO_TECLADO);
        else if (evento.key === haciaDentro) control.empujar(lado, -PASO_TECLADO);
        else if (evento.key === 'Enter' || evento.key === ' ') control.alternarLado(lado);
        else return;
        // Solo se consume la tecla que se ha usado: las demás siguen su camino
        // hasta los atajos del editor.
        evento.preventDefault();
      }}
    />
  );
}

export interface PanelDeColumna {
  acoplado: Acoplado;
  contenido: ReactNode;
  acciones?: ReactNode;
}

/**
 * Una columna entera: sus paneles y su canaleta, o el riel si está plegada.
 *
 * Plegada ocupa una pestaña estrecha con el título en vertical, no un icono. Un
 * riel de iconos obliga a aprender cuál es cuál —y a equivocarse dos veces antes
 * de aprenderlo—; el título girado se lee de un vistazo y cuesta los mismos
 * píxeles de ancho.
 */
export function ColumnaAcoplada({
  lado,
  control,
  paneles,
}: {
  lado: Lado;
  control: ControlDePaneles;
  paneles: PanelDeColumna[];
}): JSX.Element {
  const columna = control.disposicion[lado];

  if (columna.plegada) {
    return (
      <div className={`riel riel--${lado}`}>
        {paneles.map(({ acoplado }) => (
          <button
            key={acoplado}
            type="button"
            className="riel__pestana"
            aria-expanded={false}
            onClick={() => control.alternar(acoplado)}
          >
            {TITULOS[acoplado]}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`columna columna--${lado}`}>
      {paneles.map(({ acoplado, contenido, acciones }) => (
        <PanelAcoplado
          key={acoplado}
          titulo={TITULOS[acoplado]}
          plegado={!control.disposicion.abiertos[acoplado]}
          onAlternar={() => control.alternar(acoplado)}
          {...(acciones ? { acciones } : {})}
        >
          {contenido}
        </PanelAcoplado>
      ))}
      {/* En un teléfono la columna flota sobre el lienzo y no le quita ancho a
          nadie: una canaleta ahí no movería nada. */}
      {!control.estrecha && <Canaleta lado={lado} control={control} />}
    </div>
  );
}
