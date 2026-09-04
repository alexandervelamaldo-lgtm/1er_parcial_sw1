import type { EstadoConexion, UmlClass } from '@app/shared';
import { ESCALA_MAXIMA, ESCALA_MINIMA } from './geometria-lienzo';
import { IndicadorSync } from './IndicadorSync';
import type { Participante } from '../hooks/usePresencia';

/**
 * La barra de estado.
 *
 * Reúne abajo lo que se consulta de reojo y nunca se busca: cuánto se está
 * ampliando, si los cambios están llegando al servidor, quién más está dentro y
 * qué hay seleccionado. Todo eso estaba antes o en la cabecera —compitiendo por
 * sitio con las acciones— o en ningún lado: el aumento no se veía en ninguna
 * parte, así que después de un pellizco no había forma de saber si el diagrama
 * estaba al 40 % o al 300 %, ni de volver al 100 % más que a base de rueda.
 */

export interface BarraEstadoProps {
  escala: number;
  onAcercar: () => void;
  onAlejar: () => void;
  onAjustar: () => void;
  estado: EstadoConexion;
  detalle: string | undefined;
  sincronizado: boolean;
  participantes: Participante[];
  clase: UmlClass | null;
  clases: number;
  relaciones: number;
}

export function BarraEstado({
  escala,
  onAcercar,
  onAlejar,
  onAjustar,
  estado,
  detalle,
  sincronizado,
  participantes,
  clase,
  clases,
  relaciones,
}: BarraEstadoProps): JSX.Element {
  const porcentaje = Math.round(escala * 100);

  return (
    <footer className="barra-estado">
      <div className="barra-estado__zoom" role="group" aria-label="Aumento del diagrama">
        <button
          type="button"
          className="barra-estado__boton"
          onClick={onAlejar}
          disabled={escala <= ESCALA_MINIMA}
          aria-label="Alejar"
          title="Alejar"
        >
          −
        </button>
        {/*
          El porcentaje se anuncia por su cuenta: para quien no ve la pantalla,
          el resultado de pulsar «Acercar» es este número y nada más.
        */}
        <span className="barra-estado__valor" role="status" aria-label={`Aumento ${String(porcentaje)} por ciento`}>
          {porcentaje}%
        </span>
        <button
          type="button"
          className="barra-estado__boton"
          onClick={onAcercar}
          disabled={escala >= ESCALA_MAXIMA}
          aria-label="Acercar"
          title="Acercar"
        >
          +
        </button>
        <button
          type="button"
          className="barra-estado__boton barra-estado__boton--ancho"
          onClick={onAjustar}
          title="Encuadrar el diagrama entero"
        >
          Ajustar
        </button>
      </div>

      <span className="barra-estado__dato">
        {clases} {clases === 1 ? 'clase' : 'clases'} · {relaciones}{' '}
        {relaciones === 1 ? 'relación' : 'relaciones'}
      </span>

      {/*
        Qué hay seleccionado. Con los paneles plegados, el panel de propiedades
        no está a la vista y la única señal de que una clase está seleccionada es
        el borde de la caja, que puede haber quedado fuera de la pantalla.
      */}
      <span className="barra-estado__dato barra-estado__seleccion">
        {clase ? `Seleccionado: ${clase.name}` : 'Sin selección'}
      </span>

      <IndicadorSync
        estado={estado}
        detalle={detalle}
        sincronizado={sincronizado}
        participantes={participantes}
      />
    </footer>
  );
}
