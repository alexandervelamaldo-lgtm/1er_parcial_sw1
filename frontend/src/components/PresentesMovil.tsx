import type { Participante } from '../hooks/usePresencia';
import { inicialDe, listarPresentes } from './movil-presencia';

/**
 * Quién está dentro, con nombre y con lo que tiene abierto.
 *
 * Esto es lo que en el escritorio hace la visión periférica. Allí la caja que otro
 * tiene seleccionada lleva su contorno de color, y basta mirar el lienzo para
 * saber que alguien anda por `Pedido`. En un teléfono el lienzo cabe entero muy
 * pocas veces: la caja de la que hay que apartarse está fuera de la pantalla la
 * mayor parte del tiempo, y el contorno de color no sirve de nada si no se ve.
 *
 * Así que la información se da en texto y bajo demanda. No es un panel siempre
 * abierto —eso gastaría en presencia el sitio que hace falta para el diagrama—
 * sino la hoja que sale al tocar las fichas de la barra, que es el único gesto que
 * un dedo puede hacer sobre ellas.
 *
 * Solo dibuja. Quién sale, en qué orden, qué se lee de cada uno y qué pasa con una
 * clase que se acaba de borrar lo decide `movil-presencia.ts`, que se prueba sin
 * navegador.
 */
export function PresentesMovil({
  participantes,
  nombreDeClase,
  onIr,
}: {
  participantes: Participante[];
  /** Traduce el identificador de la clase que alguien tiene abierta a su nombre. */
  nombreDeClase: (id: string) => string | null;
  /** Llevar el lienzo a una clase. Recibe el identificador, no el nombre. */
  onIr: (claseId: string) => void;
}): JSX.Element {
  const presentes = listarPresentes(participantes, nombreDeClase);

  if (presentes.length === 0) {
    return (
      <p className="presentes-movil__nadie">
        Nadie más está en el proyecto ahora mismo. Los cambios se siguen guardando y compartiendo.
      </p>
    );
  }

  return (
    <ul className="presentes-movil">
      {presentes.map((p) => {
        const seleccion = participantes.find((x) => x.clientId === p.clientId)?.seleccion ?? null;
        /*
          La fila solo es pulsable si lleva a algún sitio. Una fila que parece un
          botón y no hace nada enseña a no pulsar las que sí hacen algo, y aquí la
          mitad de las filas son de gente que no tiene nada abierto.
        */
        const puedeIr = p.en !== null && seleccion !== null;

        return (
          <li key={p.clientId} className="presentes-movil__fila">
            <span
              className="presentes-movil__ficha"
              style={{ background: p.color }}
              aria-hidden="true"
            >
              {inicialDe(p.nombre)}
            </span>

            <span className="presentes-movil__quien">
              <span className="presentes-movil__nombre">{p.nombre}</span>
              {p.en !== null && <span className="presentes-movil__donde">en {p.en}</span>}
            </span>

            {puedeIr && (
              <button
                type="button"
                className="presentes-movil__ir"
                onClick={() => onIr(seleccion)}
                aria-label={`Ir a ${p.en ?? ''} en el lienzo`}
              >
                Ir
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
