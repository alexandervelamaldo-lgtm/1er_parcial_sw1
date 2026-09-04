import type { Proyecto } from '../services/api';
import { type FilaPanel, contenidoDelTablero, porcentaje } from './tablero-proyectos';

/**
 * El resumen que abre la pantalla de proyectos.
 *
 * Responde a tres preguntas, y solo a esas tres, porque son las que se hacen al
 * abrir la aplicación y no se podían contestar sin entrar proyecto por proyecto:
 *
 *   1. ¿Dónde estaba trabajando?  → la lista de abajo, ordenada por fecha, con
 *      la fecha dicha en palabras. No se repite aquí.
 *   2. ¿Cuál está roto?           → los proyectos que hoy no generarían backend.
 *   3. ¿De dónde salió el modelo? → el reparto de cambios por vía de entrada.
 *
 * Lo que no hace: no dibuja evolución en el tiempo. El historial marca entradas
 * como `relojDudoso` cuando la fecha de quien escribió contradice el orden del
 * CRDT, así que una serie temporal sería una línea trazada sobre datos que el
 * propio módulo declara poco fiables. Se enseña cuántas son y se deja ahí.
 *
 * Toda la aritmética vive en `tablero-proyectos.ts` y se prueba sin navegador;
 * aquí solo se colocan cadenas ya calculadas dentro de etiquetas.
 */
export function TableroProyectos({
  filas,
  tope,
  onAbrir,
}: {
  filas: FilaPanel[];
  tope: number;
  onAbrir: (proyecto: Proyecto) => void;
}): JSX.Element | null {
  const { mostrar, total, rotos, vias, parcial } = contenidoDelTablero(filas);

  // Sin nada que resumir —cuenta nueva o carga fallida por falta de red— no se
  // pinta. La lista de abajo ya dice «Sin proyectos» y el aviso de red, si lo
  // hubo, está arriba; el porqué está junto a `mostrar`.
  if (!mostrar) return null;

  return (
    <section className="tablero" aria-label="Resumen de los proyectos">
      <dl className="tablero__cifras">
        <div className="tablero__cifra">
          <dt>Proyectos</dt>
          <dd>{total.proyectos}</dd>
        </div>
        <div className="tablero__cifra">
          <dt>Clases</dt>
          <dd>{total.clases}</dd>
        </div>
        <div className="tablero__cifra">
          <dt>Relaciones</dt>
          <dd>{total.relaciones}</dd>
        </div>
        <div className="tablero__cifra">
          <dt>Cambios</dt>
          <dd>{total.cambios}</dd>
        </div>
      </dl>

      {/*
        Un total que no dice su alcance es un total equivocado. El servidor
        resume los `tope` más recientes; con treinta proyectos, «104 clases»
        serían las de veinticuatro, y nadie lo sabría.
      */}
      {parcial && (
        <p className="tablero__nota">
          Las cifras corresponden a los {total.resumidos} proyectos más recientes de{' '}
          {total.proyectos}. El servidor resume {tope} como máximo.
        </p>
      )}

      <div className="tablero__secciones">
        <div className="tablero__seccion">
          <h2 className="tablero__titulo">Sin generar</h2>
          {rotos.length > 0 ? (
            <>
              <ul className="tablero__rotos">
                {rotos.map((fila) => (
                  <li key={fila.proyecto.id}>
                    <button
                      type="button"
                      className="tablero__roto"
                      onClick={() => onAbrir(fila.proyecto)}
                    >
                      {/* Nombre puesto por una persona: va como texto de React y
                          nunca dentro de un `dangerouslySetInnerHTML`, de una URL
                          ni de un selector (RNF-SEG-06). */}
                      <span className="tablero__roto-nombre">{fila.proyecto.name}</span>
                      <span className="tablero__roto-cuenta">
                        {fila.resumen?.problemas} {fila.resumen?.problemas === 1 ? 'error' : 'errores'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="tablero__nota">
                Un error de validación impide generar el backend. Los avisos no cuentan aquí.
              </p>
            </>
          ) : (
            <p className="tablero__nota">
              Ningún proyecto tiene errores de validación
              {parcial ? ' entre los resumidos' : ''}.
            </p>
          )}
        </div>

        <div className="tablero__seccion">
          <h2 className="tablero__titulo">De dónde salió el modelo</h2>
          {vias.length > 0 ? (
            <>
              {/*
                La barra se reparte con `flex-grow` sobre los recuentos crudos, no
                sobre los porcentajes: el dibujo queda exacto aunque los rótulos
                redondeados no sumen cien. El color no lleva información por sí
                solo; cada tramo tiene su rótulo con nombre y número debajo.
              */}
              <div className="tablero__barra" aria-hidden="true">
                {vias.map((via) => (
                  <span
                    key={via.origen}
                    className={`tablero__via tablero__via--${via.origen}`}
                    style={{ flexGrow: via.cambios }}
                  />
                ))}
              </div>
              <ul className="tablero__leyenda">
                {vias.map((via) => (
                  <li key={via.origen}>
                    <span className={`tablero__marca tablero__via--${via.origen}`} />
                    <span className="tablero__leyenda-nombre">{via.etiqueta}</span>
                    <span className="tablero__leyenda-cuenta">
                      {via.cambios} ({porcentaje(via.cambios, total.cambios)}%)
                    </span>
                  </li>
                ))}
              </ul>
              {/*
                Deshacer y rehacer cuentan en el total y no en el reparto: son
                actos sobre el historial, no formas de meter modelo. Sumarlos a
                «a mano» presentaría como trabajo hecho algo que se retiraba.
              */}
              {total.fechasDudosas > 0 && (
                <p className="tablero__nota">
                  {total.fechasDudosas}{' '}
                  {total.fechasDudosas === 1 ? 'cambio tiene' : 'cambios tienen'} una fecha que
                  contradice el orden real de edición, casi siempre por un reloj mal puesto. El
                  reparto no depende de las fechas, así que no le afecta.
                </p>
              )}
            </>
          ) : (
            <p className="tablero__nota">Todavía no hay cambios registrados.</p>
          )}
        </div>
      </div>
    </section>
  );
}
