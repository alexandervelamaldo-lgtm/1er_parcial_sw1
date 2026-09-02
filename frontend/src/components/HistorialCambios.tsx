import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ETIQUETA_ORIGEN,
  MAXIMO_ENTRADAS,
  autoriaDeClase,
  historialDeClase,
  type EntradaLeida,
} from '@app/shared';

/**
 * Quién cambió qué.
 *
 * Dos accesos, porque son dos preguntas distintas y se hacen en momentos
 * distintos: «¿qué ha pasado en este proyecto?» se pregunta al volver después de
 * unos días, y para eso está el panel completo; «¿quién creó esta tabla?» se
 * pregunta con la clase delante, y para eso está el bloque del panel de
 * propiedades. Un solo listado global obligaría a buscar a ojo entre entradas de
 * otras clases justo cuando ya se sabe cuál interesa.
 */

/**
 * Fecha legible.
 *
 * Relativa para lo reciente —«hace 5 min» se entiende sin restar— y absoluta a
 * partir del día, que es cuando «hace 3 días» deja de situar nada.
 */
function cuando(iso: string, ahora: number): string {
  const momento = Date.parse(iso);
  if (Number.isNaN(momento)) return 'en un momento indeterminado';

  const segundos = Math.round((ahora - momento) / 1000);
  if (segundos < 0) return 'hace un instante';
  if (segundos < 60) return 'hace unos segundos';
  if (segundos < 3600) return `hace ${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `hace ${Math.floor(segundos / 3600)} h`;

  return new Date(momento).toLocaleString('es', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Entrada({ entrada, ahora }: { entrada: EntradaLeida; ahora: number }): JSX.Element {
  return (
    <li className="historial__entrada">
      <p className="historial__resumen">{entrada.resumen}</p>
      <p className="historial__firma">
        <span className="historial__autor">{entrada.autorNombre}</span>
        {' · '}
        <time dateTime={entrada.momento}>{cuando(entrada.momento, ahora)}</time>
        {entrada.origen !== 'manual' && (
          <>
            {' · '}
            <span className="historial__origen">{ETIQUETA_ORIGEN[entrada.origen]}</span>
          </>
        )}
      </p>

      {/*
        La doble autoría. Que doce clases las confirmara Ana es cierto y también
        insuficiente: si las leyó un modelo de una foto de pizarra, quien mire
        esto dentro de un mes necesita saberlo antes de fiarse de un atributo que
        no recuerda haber escrito.
      */}
      {entrada.propuestoPor && (
        <p className="historial__propuesta">Propuesto por {entrada.propuestoPor} y confirmado</p>
      )}

      {entrada.relojDudoso && (
        <p className="historial__dudoso" role="note">
          La hora de este equipo no concuerda con el orden en que llegaron los cambios; la posición
          en la lista es fiable, la hora no.
        </p>
      )}

      {entrada.detalles.length > 0 && (
        <details className="historial__detalles">
          <summary>Ver los {entrada.detalles.length} cambios</summary>
          <ul>
            {entrada.detalles.map((detalle, i) => (
              <li key={`${entrada.id}-${String(i)}`}>{detalle}</li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/** El historial completo del diagrama, en un cajón lateral. */
export function HistorialCambios({
  historial,
  onCerrar,
}: {
  historial: EntradaLeida[];
  onCerrar: () => void;
}): JSX.Element {
  const cierre = useRef<HTMLButtonElement>(null);
  // Se congela al abrir. Si se recalculara en cada repintado, los «hace 5 min»
  // cambiarían mientras se lee, que es justo lo que no debe hacer un registro.
  const [ahora] = useState(() => Date.now());

  useEffect(() => {
    cierre.current?.focus();
    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const recientes = useMemo(() => [...historial].reverse(), [historial]);

  return (
    <div className="modal" onClick={onCerrar} role="presentation">
      <div
        className="modal__caja historial"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Historial de cambios del diagrama"
      >
        <div className="historial__cabecera">
          <h2>Historial de cambios</h2>
          <button
            type="button"
            className="boton boton--discreto"
            ref={cierre}
            onClick={onCerrar}
            aria-label="Cerrar el historial"
          >
            ✕
          </button>
        </div>

        {recientes.length === 0 ? (
          <p className="panel__vacio">
            Todavía no hay cambios registrados. Aparecerán aquí en cuanto alguien cree o modifique
            una clase.
          </p>
        ) : (
          <ul className="historial__lista">
            {recientes.map((entrada) => (
              <Entrada key={entrada.id} entrada={entrada} ahora={ahora} />
            ))}
          </ul>
        )}

        {/*
          Se dice lo que el historial no es. Alguien que lo abra para resolver una
          discusión tiene derecho a saber que esto reconstruye lo que pasó entre
          gente que colabora, y que no está pensado para demostrar nada frente a
          quien quiera falsearlo.
        */}
        <p className="modal__nota">
          Se guardan los últimos {MAXIMO_ENTRADAS} cambios de estructura; mover cajas por el lienzo
          no cuenta como cambio. El registro lo escribe cada participante en su propio navegador:
          sirve para reconstruir qué pasó, no como prueba ante quien pudiera manipularlo.
        </p>
      </div>
    </div>
  );
}

/** El historial de una sola clase, para el panel de propiedades. */
export function HistorialDeClase({
  historial,
  classId,
}: {
  historial: EntradaLeida[];
  classId: string;
}): JSX.Element {
  const [ahora] = useState(() => Date.now());
  const propias = useMemo(() => historialDeClase(historial, classId), [historial, classId]);
  const { creacion, ultima } = useMemo(
    () => autoriaDeClase(historial, classId),
    [historial, classId],
  );

  if (propias.length === 0) {
    return (
      <div className="panel__seccion">
        <h3>Historial</h3>
        {/*
          «Sin datos» y «nadie la tocó» no son lo mismo, y confundirlos aquí
          llevaría a acusar a nadie de nada. Las clases anteriores a esta función,
          y las que se hayan salido del tope, no tienen registro y hay que decirlo
          en vez de mostrar un hueco.
        */}
        <p className="panel__vacio">
          No consta quién creó esta clase. O es anterior al registro de cambios, o su entrada ya se
          ha salido del historial.
        </p>
      </div>
    );
  }

  return (
    <div className="panel__seccion">
      <h3>Historial</h3>

      <p className="historial__autoria">
        {creacion ? (
          <>
            Creada por <strong>{creacion.autorNombre}</strong>{' '}
            {cuando(creacion.momento, ahora)}
          </>
        ) : (
          <>No consta quién la creó</>
        )}
        {ultima && ultima !== creacion && (
          <>
            <br />
            Último cambio, de <strong>{ultima.autorNombre}</strong> {cuando(ultima.momento, ahora)}
          </>
        )}
      </p>

      <ul className="historial__lista historial__lista--compacta">
        {propias.map((entrada) => (
          <Entrada key={entrada.id} entrada={entrada} ahora={ahora} />
        ))}
      </ul>
    </div>
  );
}
