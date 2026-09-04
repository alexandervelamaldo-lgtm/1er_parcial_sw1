import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buscar, type Resultado } from '@app/shared';
import { ApiError, api } from '../services/api';
import { indiceDeLaGuia } from '../services/documentos';
import { modelosDisponibles, preguntar } from '../services/ollama';
import {
  callar,
  dictadoDisponible,
  dictar,
  hablar,
  motivoSinVoz,
  sintesisDisponible,
  type SesionDictado,
} from '../services/voz';
import { Icono } from './iconos';

/**
 * La guía: preguntar cómo se hace algo y que el manual conteste.
 *
 * Tiene tres caminos, y no los elige el usuario sino lo que haya disponible:
 *
 *   1. **Ollama en esta máquina.** Redacta la respuesta sin salir del equipo y
 *      sin gastar nada. Es lo que se enseña en la defensa.
 *   2. **El servidor, si hay red.** Mismo manual, mismo fragmento recuperado, y
 *      un modelo remoto que redacta. Es el camino del móvil, donde Ollama no
 *      existe.
 *   3. **La búsqueda, aquí mismo.** Sin red, sin modelo y sin servidor. Enseña
 *      las secciones del manual que responden a la pregunta.
 *
 * El tercero no es un mensaje de error disfrazado: es una respuesta útil, y de
 * hecho la más fiable de las tres, porque es texto que alguien escribió a
 * propósito en vez de una paráfrasis. Por eso la búsqueda se hace **siempre y
 * primero**, aunque haya modelo: hay algo que leer mientras el modelo escribe,
 * y si el modelo falla a media frase no se pierde nada.
 */

interface Estado {
  readonly pregunta: string;
  readonly respuesta: string | null;
  readonly fuentes: readonly Resultado[];
  readonly pensando: boolean;
  readonly error: string | null;
}

const VACIO: Estado = {
  pregunta: '',
  respuesta: null,
  fuentes: [],
  pensando: false,
  error: null,
};

const EJEMPLOS = [
  '¿cómo exporto a Enterprise Architect?',
  '¿qué órdenes entiende la voz?',
  '¿cómo leo un diagrama de una foto?',
  '¿qué base de datos genera el backend?',
];

export function Guia({ onCerrar }: { onCerrar: () => void }): JSX.Element {
  const indice = useMemo(() => indiceDeLaGuia(), []);
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState<Estado>(VACIO);
  const [modelo, setModelo] = useState<string | null>(null);
  const [escuchando, setEscuchando] = useState(false);
  const dictadoRef = useRef<SesionDictado | null>(null);
  const abortoRef = useRef<AbortController | null>(null);
  const entradaRef = useRef<HTMLInputElement>(null);

  // Se pregunta una sola vez, al abrir, y con un tiempo de espera corto. Que no
  // haya modelo es el caso normal, no una avería, así que esto no muestra nada
  // rojo: solo decide qué se puede ofrecer.
  useEffect(() => {
    let cancelado = false;
    void modelosDisponibles().then((modelos) => {
      if (!cancelado) setModelo(modelos[0] ?? null);
    });
    entradaRef.current?.focus();
    return () => {
      cancelado = true;
      abortoRef.current?.abort();
      dictadoRef.current?.detener();
      // Cerrar la guía calla la lectura. Sin esto, la respuesta se sigue oyendo
      // sobre el diagrama y no queda ningún botón en pantalla para pararla.
      callar();
    };
  }, []);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [onCerrar]);

  const consultar = useCallback(
    async (pregunta: string): Promise<void> => {
      const limpia = pregunta.trim();
      if (!limpia) return;

      abortoRef.current?.abort();
      const aborto = new AbortController();
      abortoRef.current = aborto;

      // La búsqueda primero y sin esperar a nadie: es instantánea y no necesita
      // red, así que no hay razón para que el usuario mire una pantalla vacía
      // mientras se decide si hay modelo.
      const fuentes = buscar(indice, limpia, 4);
      setEstado({
        pregunta: limpia,
        respuesta: null,
        fuentes,
        pensando: fuentes.length > 0,
        error: null,
      });

      if (fuentes.length === 0) return;

      // Con Ollama delante se usa Ollama: no gasta clave, no sale del equipo y
      // escribe según piensa. El servidor solo entra donde Ollama no puede.
      if (modelo !== null) {
        try {
          const r = await preguntar(indice, limpia, {
            modelo,
            signal: aborto.signal,
            // Se pinta según llega. Un modelo de 3B en un portátil tarda varios
            // segundos en la respuesta entera, pero la primera palabra sale casi
            // enseguida, y eso distingue «está pensando» de «se colgó».
            onTrozo: (trozo) => {
              setEstado((previo) => ({ ...previo, respuesta: (previo.respuesta ?? '') + trozo }));
            },
          });
          if (aborto.signal.aborted) return;
          setEstado((previo) => ({ ...previo, respuesta: r.texto, pensando: false }));
        } catch (error) {
          if (aborto.signal.aborted) return;
          // El fallo del modelo no deja al usuario sin nada: las secciones ya
          // están puestas y siguen respondiendo a la pregunta.
          setEstado((previo) => ({
            ...previo,
            pensando: false,
            respuesta: null,
            error:
              error instanceof Error
                ? `El modelo local falló (${error.message}). Abajo están las secciones del manual.`
                : 'El modelo local falló. Abajo están las secciones del manual.',
          }));
        }
        return;
      }

      // Sin Ollama se prueba el servidor. Es el camino del móvil. Si tampoco
      // hay red, la búsqueda que ya está en pantalla es la respuesta, y no se
      // muestra ningún error: quedarse sin conexión no es una avería de la
      // aplicación y no tiene por qué parecerlo.
      try {
        const r = await api.preguntarGuia(limpia);
        if (aborto.signal.aborted) return;
        setEstado((previo) => ({
          ...previo,
          respuesta: r.texto,
          pensando: false,
          error: r.aviso,
        }));
      } catch (error) {
        if (aborto.signal.aborted) return;
        const sinRed = error instanceof ApiError && error.esDeRed;
        setEstado((previo) => ({
          ...previo,
          pensando: false,
          error: sinRed ? null : error instanceof Error ? error.message : null,
        }));
      }
    },
    [indice, modelo],
  );

  const alternarMicrofono = useCallback((): void => {
    if (escuchando) {
      dictadoRef.current?.detener();
      return;
    }
    setEscuchando(true);
    dictadoRef.current = dictar({
      onParcial: setTexto,
      onFinal: (final) => {
        setTexto(final);
        void consultar(final);
      },
      onError: (mensaje) => {
        setEstado((previo) => ({ ...previo, error: mensaje }));
        setEscuchando(false);
      },
      // Mismo sitio que el error pero sin apagar el micrófono: aquí `error` es
      // la línea donde ya se cuentan los avisos del servidor, no solo las
      // averías.
      onAviso: (aviso) => setEstado((previo) => ({ ...previo, error: aviso })),
      onFin: () => setEscuchando(false),
    });
    if (!dictadoRef.current) setEscuchando(false);
  }, [escuchando, consultar]);

  const respondido = estado.pregunta !== '';

  /*
   * Dictado y lectura se preguntan por separado porque no son la misma
   * capacidad. En un navegador de escritorio la síntesis ocurre en el aparato y
   * funciona sin conexión, mientras que el dictado de Chrome manda el audio a
   * Google; y dentro del WebView de Android no hay ninguna de las dos salvo que
   * exista el puente nativo. Un único `vozDisponible()` obligaba a apagar las
   * dos cuando fallaba una.
   */
  const hayDictado = dictadoDisponible();
  const haySintesis = sintesisDisponible();

  return (
    <div className="guia" role="dialog" aria-modal="true" aria-label="Guía de la herramienta">
      <div className="guia__caja">
        <header className="guia__cabecera">
          <h2>¿Cómo se hace…?</h2>
          {/*
            Se dice con qué se está respondiendo. No es un detalle técnico de
            adorno: las tres respuestas se parecen en pantalla y no se fían
            igual, y quien lee tiene derecho a saber cuál está leyendo.
          */}
          <p className="guia__estado">
            {modelo === null
              ? 'Buscando en el manual, aquí mismo. Sin conexión también funciona.'
              : `Respondiendo con ${modelo}, en este equipo.`}
          </p>
          <button type="button" className="boton guia__cerrar" onClick={onCerrar}>
            Cerrar
          </button>
        </header>

        <form
          className="guia__entrada"
          onSubmit={(e) => {
            e.preventDefault();
            void consultar(texto);
          }}
        >
          <input
            ref={entradaRef}
            value={texto}
            placeholder="¿cómo exporto el diagrama a Enterprise Architect?"
            onChange={(e) => setTexto(e.target.value)}
          />
          <button
            type="button"
            className={`boton-microfono${escuchando ? ' boton-microfono--activo' : ''}`}
            disabled={!hayDictado}
            title={hayDictado ? 'Preguntar hablando' : motivoSinVoz()}
            aria-label={escuchando ? 'Detener el dictado' : 'Preguntar hablando'}
            aria-pressed={escuchando}
            onClick={alternarMicrofono}
          >
            <Icono nombre="microfono" />
            {escuchando && <span className="boton-microfono__estado">Grabando</span>}
          </button>
          <button type="submit" className="boton boton--primario" disabled={!texto.trim()}>
            Preguntar
          </button>
        </form>

        {!respondido && (
          <div className="guia__ejemplos">
            <p>Por ejemplo:</p>
            <ul>
              {EJEMPLOS.map((ejemplo) => (
                <li key={ejemplo}>
                  <button
                    type="button"
                    className="guia__ejemplo"
                    onClick={() => {
                      setTexto(ejemplo);
                      void consultar(ejemplo);
                    }}
                  >
                    {ejemplo}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {estado.error && <p className="guia__error">{estado.error}</p>}

        {(estado.respuesta !== null || estado.pensando) && (
          <div className="guia__respuesta">
            <p>{estado.respuesta ?? 'Pensando…'}</p>
            {/*
              El botón se dibuja siempre que haya algo que leer, y es él quien
              dice si puede o no. Antes se escondía cuando faltaba
              `speechSynthesis` —que es justo lo que pasa dentro del WebView de
              Android—, y desde fuera eso era indistinguible de una función que
              nadie había programado: no había nada que pulsar ni nada que leer.
            */}
            {estado.respuesta !== null &&
              !estado.pensando &&
              (haySintesis ? (
                <button
                  type="button"
                  className="boton guia__leer"
                  title="Leer la respuesta en voz alta"
                  onClick={() => hablar(estado.respuesta ?? '')}
                >
                  <Icono nombre="altavoz" />
                  Escuchar
                </button>
              ) : (
                // El motivo va escrito y no en un `title`: esto se lee sobre
                // todo en el móvil, donde no hay puntero que pueda posarse
                // encima y un botón gris no explica nada por sí solo.
                <p className="guia__leer-nota">
                  <Icono nombre="altavoz-mudo" />
                  {motivoSinVoz()}
                </p>
              ))}
          </div>
        )}

        {respondido && estado.fuentes.length === 0 && (
          // Es la respuesta honesta y hay que darla como tal: un resultado
          // irrelevante presentado como respuesta es peor que un «no está»,
          // porque parece una respuesta.
          <p className="guia__vacio">
            Sin resultados en el manual. Cabe reformular la consulta o consultar los documentos de{' '}
            <code>docs/</code>.
          </p>
        )}

        {estado.fuentes.length > 0 && (
          <div className="guia__fuentes">
            <h3>{estado.respuesta === null ? 'En el manual' : 'De dónde sale'}</h3>
            {estado.fuentes.map((resultado) => (
              <article key={`${resultado.fragmento.documento}/${resultado.fragmento.ancla}`}>
                <h4>{resultado.fragmento.ruta.join(' › ')}</h4>
                <p>{resumir(resultado.fragmento.texto)}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Los primeros párrafos de una sección, sin la sintaxis de Markdown.
 *
 * Se corta por el final de una frase y no por el número de caracteres: un texto
 * que termina a media palabra parece un fallo de la aplicación, y quien lo lee
 * deja de fiarse del resto.
 */
function resumir(texto: string, maximo = 320): string {
  const plano = texto
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^[>\s|-]+$/gm, '')
    .replace(/[*_`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();

  if (plano.length <= maximo) return plano;
  const corte = plano.slice(0, maximo);
  const punto = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('.\n'));
  return punto > maximo / 2 ? corte.slice(0, punto + 1) : `${corte.trimEnd()}…`;
}
