import { useEffect, useRef } from 'react';
import { cajonDeAcciones, type EstadoAcciones, type IdAccionMovil } from './movil-acciones';
import { Icono } from './iconos';

/**
 * El cajón lateral: el catálogo entero, agrupado por tarea.
 *
 * Es lo que sustituye a la barra de menú de cinco desplegables y al árbol de
 * proyecto, y ninguno de los dos se porta tal cual: una barra de menú necesita un
 * puntero que pueda recorrerla sin taparla, y un árbol necesita una columna que en
 * 320 px no existe.
 *
 * Los grupos responden a «¿qué estoy intentando hacer?» —dibujar, traer y llevar
 * ficheros, generar el backend, mirar el proyecto— y no a «¿en qué menú del
 * escritorio estaría esto?». Quién va en qué grupo lo decide `movil-acciones.ts`.
 *
 * Se abre desde la barra superior y no con un gesto de deslizar desde el borde: ese
 * borde es del sistema —ahí está el «atrás» de Android— y competir con él acaba en
 * que a veces sale el cajón y a veces se sale del proyecto.
 */
export function CajonMovil({
  estado,
  onAccion,
  onCerrar,
}: {
  estado: EstadoAcciones;
  onAccion: (id: IdAccionMovil) => void;
  onCerrar: () => void;
}): JSX.Element {
  const panel = useRef<HTMLDivElement | null>(null);

  /*
    El foco entra en el cajón al abrirse y Escape lo cierra. En el teléfono esto no
    se nota, pero el mismo componente sale en la tablet y en apaisado, donde puede
    haber teclado: sin esto, tabular desde el cajón se va a los botones del lienzo
    que hay detrás, que están tapados.
  */
  useEffect(() => {
    panel.current?.focus();
    const alPulsar = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  return (
    <div className="cajon">
      <div className="cajon__fondo" onClick={onCerrar} aria-hidden="true" />

      <div
        className="cajon__panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Acciones del proyecto"
      >
        <div className="cajon__cabecera">
          <h2 className="cajon__titulo">Acciones</h2>
          <button
            type="button"
            className="cajon__cerrar"
            onClick={onCerrar}
            aria-label="Cerrar las acciones"
          >
            <Icono nombre="cerrar" />
          </button>
        </div>

        <nav className="cajon__grupos">
          {cajonDeAcciones(estado).map((grupo) => (
            <section key={grupo.id} className="cajon__grupo">
              <h3 className="cajon__encabezado">{grupo.titulo}</h3>
              <ul className="cajon__acciones">
                {grupo.acciones.map((accion) => (
                  <li key={accion.id}>
                    <button
                      type="button"
                      className="cajon__accion"
                      disabled={accion.deshabilitada}
                      // La descripción entera va al rótulo accesible, y el motivo
                      // detrás cuando está apagada: es el único sitio donde un
                      // lector de pantalla puede enterarse de por qué no responde.
                      aria-label={
                        accion.motivo
                          ? `${accion.descripcion}. ${accion.motivo}`
                          : accion.descripcion
                      }
                      onClick={() => {
                        onCerrar();
                        onAccion(accion.id);
                      }}
                    >
                      <Icono nombre={accion.icono} className="cajon__simbolo" />
                      <span className="cajon__texto">
                        <span className="cajon__etiqueta">{accion.etiqueta}</span>
                        <span className="cajon__detalle">{accion.motivo ?? accion.descripcion}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </div>
    </div>
  );
}
