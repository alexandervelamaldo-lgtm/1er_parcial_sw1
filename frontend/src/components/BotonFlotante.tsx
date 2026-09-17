import { useEffect, useRef, useState } from 'react';
import { accionesFlotantes, type EstadoAcciones, type IdAccionMovil } from './movil-acciones';
import { Icono } from './iconos';

/**
 * El botón flotante y las tres acciones que despliega.
 *
 * Qué acciones son y cuándo están apagadas lo decide `movil-acciones.ts`, que es
 * también quien garantiza —con una prueba que recorre los dieciséis estados
 * posibles— que aquí no aparezca nunca nada destructivo. Esa regla es la que hace
 * aceptable poner botones justo donde el pulgar descansa mientras se lee el
 * diagrama.
 *
 * ## Por qué el motivo va en el propio botón
 *
 * En un teléfono no hay `hover`, así que no hay forma de preguntarle a un control
 * apagado por qué no responde. El motivo se pinta debajo de la etiqueta y además va
 * al `aria-label`, que es lo que lee el lector de pantalla. Un botón gris y mudo es
 * indistinguible de una aplicación estropeada.
 */
export function BotonFlotante({
  estado,
  onAccion,
}: {
  estado: EstadoAcciones;
  onAccion: (id: IdAccionMovil) => void;
}): JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement | null>(null);

  // Un toque fuera cierra. Se escucha en la fase de captura para que el toque que
  // cierra no active además lo que haya debajo: pulsar el lienzo con el botón
  // desplegado debe cerrarlo, no cerrarlo y encima deseleccionar una clase.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (evento: PointerEvent): void => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(false);
    };
    document.addEventListener('pointerdown', fuera, true);
    return () => document.removeEventListener('pointerdown', fuera, true);
  }, [abierto]);

  const acciones = accionesFlotantes(estado);

  return (
    <div className="fab" ref={contenedor}>
      {abierto && (
        <ul className="fab__lista">
          {acciones.map((accion) => (
            <li key={accion.id}>
              <button
                type="button"
                className="fab__accion"
                disabled={accion.deshabilitada}
                aria-label={accion.motivo ? `${accion.etiqueta}. ${accion.motivo}` : accion.etiqueta}
                onClick={() => {
                  setAbierto(false);
                  onAccion(accion.id);
                }}
              >
                <Icono nombre={accion.icono} className="fab__simbolo" />
                <span className="fab__texto">
                  <span className="fab__etiqueta">{accion.etiqueta}</span>
                  {accion.motivo && <span className="fab__motivo">{accion.motivo}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="fab__principal"
        aria-expanded={abierto}
        aria-label={abierto ? 'Cerrar las acciones' : 'Acciones rápidas'}
        onClick={() => setAbierto((a) => !a)}
      >
        <Icono nombre={abierto ? 'cerrar' : 'mas'} />
      </button>
    </div>
  );
}
