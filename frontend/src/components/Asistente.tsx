import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Aplicar,
  describeBatchImpact,
  describeOperation,
  interpretCommand,
  type ClassDiagram,
  type Operation,
} from '@app/shared';
import { ApiError, api } from '../services/api';
import { puntuarPorVocabulario } from '../services/dictado';
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
  /**
   * Empezar a escuchar nada más aparecer.
   *
   * Lo usa el móvil, donde esto no se abre desde un panel que ya estaba en
   * pantalla sino desde un botón de micrófono: quien lo pulsa ya ha dicho que
   * quiere dictar, y hacerle buscar otro micrófono dentro del panel que acaba de
   * abrir con un micrófono es pedirle el mismo gesto dos veces.
   *
   * En el escritorio no se usa: allí el asistente está siempre visible, y un
   * panel que se pone a escuchar solo por estar en pantalla sería un micrófono
   * abierto que nadie pidió.
   */
  dictarAlAbrir?: boolean;
}

export function Asistente({
  proyectoId,
  soloLectura,
  diagrama,
  aplicar,
  dictarAlAbrir = false,
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

  /**
   * De lo que el micrófono creyó oír, qué se parece más a una orden.
   *
   * El motor de voz devuelve varias hipótesis de la misma frase ordenadas por
   * parecido acústico, y «crea la plaza pedido» y «crea la clase pedido» suenan
   * casi igual para él. Aquí hay algo que él no tiene: una gramática que puede
   * intentar interpretar cada una. Que una hipótesis se convierta en operaciones
   * es la mejor prueba posible de que es la que se dijo, así que pesa mucho más
   * que el vocabulario suelto, que es lo único que queda cuando ninguna encaja
   * —el caso de las órdenes que solo entiende el modelo del servidor—.
   *
   * Se interpreta para elegir y se tira el resultado: la propuesta que se enseña
   * sale del camino normal, que empieza por el servidor. Hacerlo aquí sería
   * colarse por delante de él con la gramática, justo lo que el orden de
   * `interpretar` evita.
   */
  const puntuarOrden = useCallback((oida: string): number => {
    const local = interpretCommand(oida);
    if (local.operations.length > 0) return 10 + local.confidence;
    return puntuarPorVocabulario(oida);
  }, []);

  const alternarMicrofono = useCallback((): void => {
    if (escuchando) {
      dictadoRef.current?.detener();
      return;
    }
    setMensaje(null);
    setEscuchando(true);
    dictadoRef.current = dictar({
      puntuar: puntuarOrden,
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
  }, [escuchando, interpretar, puntuarOrden]);

  /*
    Arrancar escuchando, si quien nos puso aquí lo pidió.

    El pestillo es lo que impide que un repintado vuelva a abrir el micrófono
    después de que el usuario lo haya cerrado: `alternarMicrofono` cambia con
    cada render que cambie `interpretar`, y sin el pestillo este efecto se
    volvería a disparar en mitad de la sesión.

    No se hace si no se puede escribir: sería abrir el micrófono para acabar en
    una propuesta que no se puede aplicar.
  */
  const yaArrancado = useRef(false);
  useEffect(() => {
    if (!dictarAlAbrir || yaArrancado.current || soloLectura || !hayDictado) return;
    yaArrancado.current = true;
    alternarMicrofono();
  }, [dictarAlAbrir, soloLectura, hayDictado, alternarMicrofono]);

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

      {escuchando && (
        <div className="asistente__escuchando" role="status">
          <span className="asistente__onda">
            <span className="asistente__onda-barra" />
            <span className="asistente__onda-barra" />
            <span className="asistente__onda-barra" />
            <span className="asistente__onda-barra" />
          </span>
          {/* Se dice que las pausas no cortan, porque antes sí lo hacían y quien
              ya se llevó ese chasco habla deprisa y atropellado para llegar antes
              del corte. Y se dice cómo terminar: con el dictado continuo, el
              botón es lo que cierra la frase. */}
          <span className="asistente__escuchando-texto">
            Escuchando… Se puede pensar a mitad de la frase. Al terminar, pulse el micrófono.
          </span>
        </div>
      )}

      {mensaje && <p className="asistente__mensaje">{mensaje}</p>}

      {propuestas.length > 0 && (
        <div
          className={`asistente__propuesta${
            impacto.destructiva ? ' asistente__propuesta--destructiva' : ''
          }`}
        >
          <p className="asistente__origen">
            Propuesta de <span className="asistente__origen-badge">{origen}</span>:
          </p>
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
