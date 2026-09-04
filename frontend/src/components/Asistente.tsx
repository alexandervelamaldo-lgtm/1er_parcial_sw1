import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type Aplicar,
  describeBatchImpact,
  describeOperation,
  interpretCommand,
  type ClassDiagram,
  type Operation,
} from '@app/shared';
import { ApiError, api } from '../services/api';
import { dictadoDisponible, dictar, motivoSinVoz, type SesionDictado } from '../services/voz';
import { nombreDeshacer, useTecladoFisico } from '../hooks/useDispositivo';
import { Icono } from './iconos';

/**
 * Asistente por voz y texto (RF-IA-01, RF-IA-04).
 *
 * Nunca escribe en el diagrama. Propone, enseña lo que haría en castellano y
 * espera a que el usuario acepte (decisión D6). Esa separación es lo que hace
 * que un modelo equivocado sea un incordio y no una pérdida de trabajo, y es
 * también lo que permite que la vía offline y la del servidor sean
 * intercambiables: las dos producen la misma lista de operaciones.
 *
 * Se intenta primero el servidor, que puede tener un modelo de lenguaje
 * detrás, y se recurre a la gramática local si no contesta. El orden importa:
 * al revés, la gramática —que solo entiende un repertorio cerrado— se comería
 * las órdenes que el modelo sí sabría interpretar.
 */

interface Propuesta {
  operacion: Operation;
  descripcion: string;
}

export interface AsistenteProps {
  proyectoId: string;
  soloLectura: boolean;
  /** Se necesita para calcular qué se pierde antes de confirmar un borrado. */
  diagrama: ClassDiagram;
  aplicar: Aplicar;
}

export function Asistente({
  proyectoId,
  soloLectura,
  diagrama,
  aplicar,
}: AsistenteProps): JSX.Element {
  const [texto, setTexto] = useState('');
  const [propuestas, setPropuestas] = useState<Propuesta[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [origen, setOrigen] = useState<string | null>(null);
  const [pensando, setPensando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const dictadoRef = useRef<SesionDictado | null>(null);
  const hayTeclado = useTecladoFisico();

  // Se pregunta una vez por render y no dos veces dentro del JSX: son la misma
  // respuesta y separarlas invita a que el botón y su explicación se
  // contradigan el día que una de las dos condiciones cambie.
  const hayDictado = dictadoDisponible();

  const interpretar = useCallback(
    async (orden: string): Promise<void> => {
      const limpia = orden.trim();
      if (!limpia) return;

      setPensando(true);
      setPropuestas([]);
      setConfirmando(false);
      setMensaje(null);

      try {
        const respuesta = await api.interpretar(proyectoId, limpia);
        setOrigen(respuesta.motor);
        setPropuestas(respuesta.propuesta);
        setMensaje(respuesta.aclaracion ?? respuesta.explicacion ?? null);
        if (respuesta.propuesta.length === 0 && !respuesta.aclaracion) {
          setMensaje('Orden no reconocida. Cabe reformularla con otras palabras.');
        }
      } catch (error) {
        // Sin servidor se usa la gramática que viaja en el propio paquete. No es
        // una degradación silenciosa: se dice de dónde viene la propuesta, para
        // que el usuario sepa por qué de pronto solo entiende frases sencillas.
        if (error instanceof ApiError && (error.esDeRed || error.status >= 500)) {
          const local = interpretCommand(limpia);
          setOrigen('gramática local (sin conexión)');
          setPropuestas(
            local.operations.map((operacion) => ({
              operacion,
              descripcion: describeOperation(operacion),
            })),
          );
          setMensaje(
            local.operations.length === 0
              ? (local.clarification ??
                  'Sin conexión solo entiendo órdenes sencillas: «crea la clase Cliente», «añade el atributo nombre de tipo String a Cliente».')
              : local.explanation,
          );
        } else {
          setMensaje(error instanceof Error ? error.message : 'No se pudo interpretar la orden');
        }
      } finally {
        setPensando(false);
      }
    },
    [proyectoId],
  );

  const alternarMicrofono = useCallback((): void => {
    if (escuchando) {
      dictadoRef.current?.detener();
      return;
    }
    setMensaje(null);
    setEscuchando(true);
    dictadoRef.current = dictar({
      onParcial: (parcial) => setTexto(parcial),
      onFinal: (final) => {
        setTexto(final);
        void interpretar(final);
      },
      onError: (error) => {
        setMensaje(error);
        setEscuchando(false);
      },
      // Se sigue escuchando: esto cuenta por dónde va el audio, no que haya
      // fallado algo.
      onAviso: (texto) => setMensaje(texto),
      onFin: () => setEscuchando(false),
    });
    if (!dictadoRef.current) setEscuchando(false);
  }, [escuchando, interpretar]);

  /**
   * Qué se pierde si se acepta la propuesta (RF-IA-05).
   *
   * Se calcula sobre el diagrama de verdad y no sobre la lista de operaciones,
   * porque la misma orden destruye cosas distintas según lo que haya: «elimina
   * la clase Pedido» se lleva por delante sus atributos, sus filas de datos y
   * las relaciones que salían de ella, y quien dictó esa frase estaba pensando
   * en una caja del lienzo, no en las tres flechas que la tocan.
   */
  const impacto = useMemo(
    () => describeBatchImpact(diagrama, propuestas.map((p) => p.operacion)),
    [diagrama, propuestas],
  );

  const ejecutar = (): void => {
    // `origen` es el motor que interpretó la orden —el modelo remoto o la
    // gramática local—. Va al historial como proponente, separado de quien
    // pulsa este botón, que es quien responde del cambio.
    const resultado = aplicar(
      propuestas.map((p) => p.operacion),
      { origen: 'asistente', ...(origen ? { propuestoPor: origen } : {}) },
    );
    setConfirmando(false);
    if (resultado.ok) {
      setPropuestas([]);
      setTexto('');
      setMensaje('Aplicado.');
    } else {
      setMensaje(resultado.error);
    }
  };

  const aceptarTodo = (): void => {
    // Un «¿seguro?» genérico no es una confirmación: no dice qué se pierde, así
    // que quien lo lee acaba pulsando «Sí» por costumbre. Solo se interpone
    // cuando hay algo concreto que enumerar, para que interponerse signifique
    // algo cuando ocurre.
    if (impacto.destructiva && !confirmando) {
      setConfirmando(true);
      return;
    }
    ejecutar();
  };

  const descartar = (): void => {
    setPropuestas([]);
    setConfirmando(false);
  };

  return (
    <section className="asistente">
      <form
        className="asistente__entrada"
        onSubmit={(e) => {
          e.preventDefault();
          void interpretar(texto);
        }}
      >
        <input
          value={texto}
          disabled={soloLectura}
          placeholder="crea la clase Pedido con el atributo total de tipo Double"
          onChange={(e) => setTexto(e.target.value)}
        />
        <button
          type="button"
          className={`boton-microfono${escuchando ? ' boton-microfono--activo' : ''}`}
          disabled={soloLectura || !hayDictado}
          title={hayDictado ? 'Dictar una orden' : motivoSinVoz()}
          aria-label={escuchando ? 'Detener el dictado' : 'Dictar una orden'}
          aria-pressed={escuchando}
          onClick={alternarMicrofono}
        >
          {/* El icono no cambia al grabar: cambia el rótulo. Un micrófono que se
              convierte en otro dibujo obliga a recordar cuál de los dos significa
              «grabando»; la palabra no hay que recordarla. */}
          <Icono nombre="microfono" />
          {escuchando && <span className="boton-microfono__estado">Grabando</span>}
        </button>
        <button type="submit" disabled={soloLectura || pensando || !texto.trim()}>
          {pensando ? '…' : 'Interpretar'}
        </button>
      </form>

      {mensaje && <p className="asistente__mensaje">{mensaje}</p>}

      {propuestas.length > 0 && (
        <div
          className={`asistente__propuesta${
            impacto.destructiva ? ' asistente__propuesta--destructiva' : ''
          }`}
        >
          <p className="asistente__origen">Propuesta de {origen}:</p>
          <ol>
            {propuestas.map((p, indice) => (
              <li key={indice}>{p.descripcion}</li>
            ))}
          </ol>

          {impacto.destructiva && (
            <div className="asistente__impacto">
              <p>
                <strong>Se va a borrar</strong>, y el diagrama no conserva copia:
              </p>
              <ul>
                {impacto.perdidas.map((perdida, indice) => (
                  <li key={indice}>{perdida}</li>
                ))}
              </ul>
              {/* El aparato decide el nombre del gesto: en un teléfono no hay
                  Ctrl, y esta frase se lee justo antes de aceptar un borrado. */}
              <p className="asistente__impacto-nota">
                Se puede deshacer con {nombreDeshacer(hayTeclado)} mientras no cierres el proyecto.
              </p>
            </div>
          )}

          <div className="asistente__acciones">
            <button
              type="button"
              className={`boton ${
                impacto.destructiva && confirmando ? 'boton--peligro' : 'boton--primario'
              }`}
              onClick={aceptarTodo}
            >
              {impacto.destructiva && confirmando
                ? 'Sí, borrar'
                : `Aplicar ${
                    propuestas.length === 1 ? 'el cambio' : `los ${propuestas.length} cambios`
                  }`}
            </button>
            <button type="button" className="boton" onClick={descartar}>
              {confirmando ? 'No, cancelar' : 'Descartar'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
