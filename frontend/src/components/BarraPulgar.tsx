import { memo } from 'react';
import { Icono } from './iconos';
import { accionesDePulgar, type EstadoPulgar, type IdAccionPulgar } from './barra-pulgar';

/**
 * La barra del pulgar.
 *
 * Solo se monta en pantalla estrecha, y no se esconde con CSS: en el
 * escritorio estos cinco botones no aportan nada —están todos en la barra de
 * arriba y en el menú, con su atajo— y un `display: none` los dejaría en el
 * árbol, encontrables por tabulador y anunciados por un lector de pantalla como
 * si existieran. Lo que hay que decir es «esta barra no está en este aparato»,
 * no «no se ve».
 *
 * Dibujar y nada más: qué botones hay, cuál está hundido y cuál apagado lo
 * decide `barra-pulgar.ts`, que se prueba sin navegador.
 */

export interface BarraPulgarProps extends EstadoPulgar {
  onAccion: (id: IdAccionPulgar) => void;
}

export const BarraPulgar = memo(function BarraPulgar({
  onAccion,
  ...estado
}: BarraPulgarProps): JSX.Element {
  return (
    <nav className="barra-pulgar" aria-label="Acciones frecuentes del diagrama">
      {accionesDePulgar(estado).map((accion) => (
        <button
          key={accion.id}
          type="button"
          className={`barra-pulgar__boton${accion.activa ? ' barra-pulgar__boton--activo' : ''}`}
          disabled={accion.deshabilitada}
          /*
            `aria-pressed` solo en los interruptores. Ponerlo en «Deshacer»
            —que no se queda hundido— haría que el lector de pantalla lo
            anunciara como una casilla que está sin marcar, y sugeriría que
            existe un estado «deshaciendo» que no existe.
          */
          aria-pressed={accion.interruptor ? accion.activa : undefined}
          /*
            El motivo entra en el nombre accesible cuando el botón está
            apagado. Un `title` no basta: en una pantalla táctil no hay `hover`
            que lo saque, así que sin esto la única explicación de por qué el
            botón no responde es invisible para todo el mundo.
          */
          aria-label={accion.motivo ? `${accion.descripcion}. ${accion.motivo}` : accion.descripcion}
          title={accion.motivo ?? accion.descripcion}
          onClick={() => onAccion(accion.id)}
        >
          <Icono nombre={accion.icono} className="barra-pulgar__simbolo" />
          <span className="barra-pulgar__rotulo">{accion.etiqueta}</span>
        </button>
      ))}
    </nav>
  );
});
