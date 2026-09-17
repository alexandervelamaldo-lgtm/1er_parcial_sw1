import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  MAXIMO_AUDIO_BYTES,
  MAXIMO_TEXTO,
  type MensajePublico,
  normalizarTipoAudio,
} from '@app/shared';
import { ApiError, api, type Rol } from '../services/api';
import { Icono } from './iconos';
import {
  GRABADORA_INACTIVA,
  comprobarGrabacion,
  explicarFalloDeMicrofono,
  reducir,
  restanteMs,
  seAcabaElTiempo,
  tipoPreferido,
} from './grabadora';
import {
  TABLON_VACIO,
  TEXTO_RETIRADO,
  agrupar,
  avanzarCursor,
  duracionLegible,
  etiquetaDeDia,
  fusionar,
  horaCorta,
  puedeRetirar,
  siguienteEspera,
} from './tablon';

/**
 * El panel de comunicación interna del proyecto.
 *
 * Aquí solo hay pintura, micrófono y el bucle de sondeo. Todo lo que se puede
 * equivocar sin que se vea —qué mensaje gana cuando llega dos veces, dónde se
 * parte un bloque, cada cuánto se vuelve a preguntar, cuándo se corta una
 * grabación— está en `tablon.ts` y `grabadora.ts`, que se prueban sin
 * navegador. Este fichero se limita a llamarlas.
 */

/* --------------------------------------------------------------------------
   La nota de voz
   -------------------------------------------------------------------------- */

/**
 * El reproductor de una nota de voz.
 *
 * El audio no se descarga hasta que alguien le da a reproducir. Un hilo con
 * treinta notas son treinta megabytes, y bajarlos al abrir el panel gastaría
 * los datos del móvil en audio que nadie ha pedido oír.
 *
 * Lo descargado se queda en un `URL.createObjectURL` mientras el mensaje esté
 * en pantalla, así que volver a escuchar no vuelve a bajar nada; al desmontar
 * se revoca, porque un objeto no revocado se queda en memoria hasta que se
 * recargue la página.
 */
function NotaDeVoz({
  proyectoId,
  mensaje,
}: {
  proyectoId: string;
  mensaje: MensajePublico;
}): JSX.Element {
  const [fuente, setFuente] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const reproductor = useRef<HTMLAudioElement | null>(null);

  // La URL del objeto se revoca al desmontar y también si el mensaje se
  // retira mientras se escucha: los bytes ya no existen en el servidor y
  // dejar el reproductor cargado sería poder oír algo que se pidió borrar.
  useEffect(() => {
    return () => {
      if (fuente) URL.revokeObjectURL(fuente);
    };
  }, [fuente]);

  const escuchar = useCallback(async () => {
    if (fuente) {
      void reproductor.current?.play();
      return;
    }
    setBajando(true);
    setFallo(null);
    try {
      const blob = await api.descargarAudioDelTablon(proyectoId, mensaje.id);
      setFuente(URL.createObjectURL(blob));
    } catch (error) {
      setFallo(error instanceof ApiError ? error.message : 'No se ha podido cargar el audio.');
    } finally {
      setBajando(false);
    }
  }, [fuente, mensaje.id, proyectoId]);

  const duracion = mensaje.audio ? duracionLegible(mensaje.audio.duracionMs) : '';

  return (
    <div className="tablon__voz">
      {fuente === null ? (
        <button
          type="button"
          className="tablon__reproducir"
          onClick={() => void escuchar()}
          disabled={bajando}
          aria-label={`Reproducir la nota de voz de ${duracion}`}
        >
          <Icono nombre="reproducir" />
        </button>
      ) : (
        // Se deja el reproductor del navegador en cuanto hay algo que oír:
        // trae la barra de avance, el volumen y el control por teclado ya
        // hechos, y reimplementarlos sería peor en todos los dispositivos.
        <audio
          ref={reproductor}
          className="tablon__audio"
          src={fuente}
          controls
          autoPlay
          preload="none"
        />
      )}
      <span className="tablon__duracion">{duracion}</span>
      {bajando && <span className="tablon__cargando-voz">Cargando…</span>}
      {fallo !== null && (
        <span className="tablon__fallo-voz" role="alert">
          {fallo}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Un mensaje
   -------------------------------------------------------------------------- */

function Mensaje({
  proyectoId,
  mensaje,
  usuarioId,
  rol,
  alRetirar,
}: {
  proyectoId: string;
  mensaje: MensajePublico;
  usuarioId: string;
  rol: Rol;
  alRetirar: (mensajeId: string) => void;
}): JSX.Element {
  if (mensaje.retirado) {
    // El hueco se queda con una frase en vez de desaparecer la fila. Quien
    // estaba leyendo vio que había algo ahí, y hacerlo desaparecer en
    // silencio deja respuestas a preguntas que ya no están.
    return (
      <li className="tablon__mensaje tablon__mensaje--retirado">
        <span className="tablon__retirado">{TEXTO_RETIRADO}</span>
        <time className="tablon__hora" dateTime={mensaje.creadoEn}>
          {horaCorta(mensaje.creadoEn)}
        </time>
      </li>
    );
  }

  return (
    <li className="tablon__mensaje">
      <div className="tablon__cuerpo">
        {mensaje.tipo === 'voz' ? (
          <NotaDeVoz proyectoId={proyectoId} mensaje={mensaje} />
        ) : (
          <p className="tablon__texto">{mensaje.texto}</p>
        )}
      </div>
      <time className="tablon__hora" dateTime={mensaje.creadoEn}>
        {horaCorta(mensaje.creadoEn)}
      </time>
      {puedeRetirar(mensaje, usuarioId, rol) && (
        <button
          type="button"
          className="tablon__retirar"
          onClick={() => {
            alRetirar(mensaje.id);
          }}
          aria-label="Retirar este mensaje"
          title="Retirar este mensaje"
        >
          <Icono nombre="papelera" />
        </button>
      )}
    </li>
  );
}

/* --------------------------------------------------------------------------
   El panel
   -------------------------------------------------------------------------- */

export interface PanelTablonProps {
  proyectoId: string;
  usuarioId: string;
  rol: Rol;
}

/*
  Se llama `PanelTablon` y no `Tablon` por una razón tonta pero real: la lógica
  pura vive en `tablon.ts`, y ni Windows ni macOS distinguen mayúsculas en los
  nombres de fichero, así que un `Tablon.tsx` al lado sería el mismo fichero.
  TypeScript lo detecta y se niega a compilar. De paso encaja con
  `PanelPropiedades`, que es el otro panel acoplado de esta columna.
*/
export function PanelTablon({ proyectoId, usuarioId, rol }: PanelTablonProps): JSX.Element {
  const [mensajes, setMensajes] = useState<MensajePublico[]>([]);
  const [borrador, setBorrador] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [grabacion, despachar] = useReducer(reducir, GRABADORA_INACTIVA);

  // El cursor y los contadores viven en referencias y no en estado: los lee el
  // bucle de sondeo, y como estado provocarían un repintado por cada vuelta
  // —también por las vacías, que son casi todas— y reiniciarían el temporizador
  // en cada uno.
  const cursor = useRef(0);
  const vacios = useRef(0);
  const fallos = useRef(0);

  const hilo = useRef<HTMLDivElement | null>(null);
  const pegadoAbajo = useRef(true);

  const bloques = useMemo(() => agrupar(mensajes), [mensajes]);
  const hoy = useMemo(() => new Date(), []);

  /* ---- Sondeo ---------------------------------------------------------- */

  useEffect(() => {
    let vivo = true;
    let temporizador: number | undefined;

    async function preguntar(primera: boolean): Promise<void> {
      try {
        const pagina = primera
          ? await api.leerTablon(proyectoId)
          : await api.sondearTablon(proyectoId, cursor.current);
        if (!vivo) return;

        cursor.current = avanzarCursor(cursor.current, pagina.cursor);
        fallos.current = 0;
        vacios.current = pagina.mensajes.length === 0 ? vacios.current + 1 : 0;

        if (pagina.mensajes.length > 0 || primera) {
          setMensajes((previos) => fusionar(previos, pagina.mensajes));
        }
        setError(null);
      } catch (fallo) {
        if (!vivo) return;
        fallos.current += 1;
        // Un sondeo fallido no borra el hilo ni se anuncia a la primera: la
        // red de un móvil se cae un segundo cada rato y un panel que grita
        // «sin conexión» en cada bache es ruido. A la tercera ya no es un
        // bache.
        if (fallos.current >= 3) {
          setError(
            fallo instanceof ApiError && fallo.esDeRed
              ? 'Sin conexión: los mensajes nuevos aparecerán al volver la red.'
              : 'No se ha podido consultar el tablón.',
          );
        }
      } finally {
        if (vivo) {
          if (primera) setCargando(false);
          temporizador = window.setTimeout(
            () => void preguntar(false),
            siguienteEspera({
              vacios: vacios.current,
              fallos: fallos.current,
              visible: document.visibilityState === 'visible',
            }),
          );
        }
      }
    }

    void preguntar(true);

    // Al volver a la pestaña se pregunta ya, sin esperar al minuto que tocaba
    // en segundo plano: lo primero que hace quien vuelve es mirar si hay algo
    // nuevo, y encontrarse el hilo de hace un minuto parece que está roto.
    function alCambiarVisibilidad(): void {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(temporizador);
      void preguntar(false);
    }
    document.addEventListener('visibilitychange', alCambiarVisibilidad);

    return () => {
      vivo = false;
      window.clearTimeout(temporizador);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
  }, [proyectoId]);

  /* ---- Desplazamiento -------------------------------------------------- */

  // Bajar del todo solo si ya se estaba abajo. Arrastrar a alguien que está
  // leyendo lo de hace media hora hasta el final porque otro acaba de escribir
  // es la forma más rápida de que cierre el panel.
  useEffect(() => {
    if (!pegadoAbajo.current) return;
    const caja = hilo.current;
    if (caja) caja.scrollTop = caja.scrollHeight;
  }, [mensajes]);

  const alDesplazar = useCallback(() => {
    const caja = hilo.current;
    if (!caja) return;
    pegadoAbajo.current = caja.scrollHeight - caja.scrollTop - caja.clientHeight < 40;
  }, []);

  /* ---- Publicar -------------------------------------------------------- */

  const publicar = useCallback(async () => {
    const texto = borrador.trim();
    if (texto === '' || enviando) return;
    setEnviando(true);
    try {
      const { mensaje } = await api.publicarEnTablon(proyectoId, texto);
      // Se pinta con la respuesta del POST en vez de esperar al sondeo. La
      // fusión por versión hace que el sondeo que ya iba en vuelo no lo
      // duplique ni lo devuelva a un estado anterior.
      setMensajes((previos) => fusionar(previos, [mensaje]));
      cursor.current = avanzarCursor(cursor.current, mensaje.version);
      pegadoAbajo.current = true;
      setBorrador('');
      setError(null);
    } catch (fallo) {
      setError(fallo instanceof ApiError ? fallo.message : 'No se ha podido publicar el mensaje.');
    } finally {
      setEnviando(false);
    }
  }, [borrador, enviando, proyectoId]);

  const retirar = useCallback(
    async (mensajeId: string) => {
      try {
        const { mensaje } = await api.retirarDelTablon(proyectoId, mensajeId);
        setMensajes((previos) => fusionar(previos, [mensaje]));
        cursor.current = avanzarCursor(cursor.current, mensaje.version);
      } catch (fallo) {
        setError(fallo instanceof ApiError ? fallo.message : 'No se ha podido retirar el mensaje.');
      }
    },
    [proyectoId],
  );

  /* ---- Grabar ---------------------------------------------------------- */

  const medios = useRef<{ grabadora: MediaRecorder; pista: MediaStream } | null>(null);
  const trozos = useRef<Blob[]>([]);
  const empezadaEn = useRef(0);

  /** Cierra el micrófono. Sin esto el piloto del portátil se queda encendido. */
  const soltarMicrofono = useCallback(() => {
    const abierto = medios.current;
    medios.current = null;
    if (!abierto) return;
    if (abierto.grabadora.state !== 'inactive') abierto.grabadora.stop();
    for (const pista of abierto.pista.getTracks()) pista.stop();
  }, []);

  useEffect(() => soltarMicrofono, [soltarMicrofono]);

  const empezarAGrabar = useCallback(async () => {
    const tipo = tipoPreferido((candidato) =>
      typeof MediaRecorder === 'undefined' ? false : MediaRecorder.isTypeSupported(candidato),
    );
    if (tipo === null) {
      despachar({ tipo: 'fallo', motivo: 'Este navegador no puede grabar notas de voz.' });
      return;
    }

    try {
      const pista = await navigator.mediaDevices.getUserMedia({ audio: true });
      const grabadora = new MediaRecorder(pista, { mimeType: tipo });
      trozos.current = [];
      grabadora.ondataavailable = (evento) => {
        if (evento.data.size > 0) trozos.current.push(evento.data);
      };
      grabadora.start();
      medios.current = { grabadora, pista };
      empezadaEn.current = Date.now();
      despachar({ tipo: 'empezar' });
    } catch (error) {
      despachar({ tipo: 'fallo', motivo: explicarFalloDeMicrofono(error) });
    }
  }, []);

  // El reloj lo lleva el componente y la máquina de estados solo lo recibe: es
  // lo que permite que el corte de los noventa segundos se pruebe sin esperar
  // noventa segundos.
  useEffect(() => {
    if (grabacion.fase !== 'grabando') return;
    const reloj = window.setInterval(() => {
      despachar({ tipo: 'tictac', transcurridoMs: Date.now() - empezadaEn.current });
    }, 100);
    return () => {
      window.clearInterval(reloj);
    };
  }, [grabacion.fase]);

  // `hayQueEnviar` es un aviso de una sola vez: aquí se consume, se cierra el
  // micrófono y se sube lo grabado.
  useEffect(() => {
    if (!grabacion.hayQueEnviar) return;
    const abierto = medios.current;
    if (!abierto) {
      despachar({ tipo: 'enviada' });
      return;
    }

    const duracionMs = grabacion.transcurridoMs;
    abierto.grabadora.onstop = () => {
      const tipo = normalizarTipoAudio(abierto.grabadora.mimeType) ?? 'audio/webm';
      const blob = new Blob(trozos.current, { type: tipo });
      trozos.current = [];
      soltarMicrofono();

      const revision = comprobarGrabacion(blob.size, tipo, MAXIMO_AUDIO_BYTES);
      if (!revision.ok) {
        despachar({ tipo: 'fallo', motivo: revision.motivo });
        return;
      }

      void (async () => {
        try {
          const audio = await aBase64(blob);
          const { mensaje } = await api.publicarVozEnTablon(proyectoId, audio, tipo, duracionMs);
          setMensajes((previos) => fusionar(previos, [mensaje]));
          cursor.current = avanzarCursor(cursor.current, mensaje.version);
          pegadoAbajo.current = true;
          despachar({ tipo: 'enviada' });
        } catch (fallo) {
          despachar({
            tipo: 'fallo',
            motivo:
              fallo instanceof ApiError ? fallo.message : 'No se ha podido enviar la nota de voz.',
          });
        }
      })();
    };

    if (abierto.grabadora.state !== 'inactive') abierto.grabadora.stop();
  }, [grabacion.hayQueEnviar, grabacion.transcurridoMs, proyectoId, soltarMicrofono]);

  const cancelarGrabacion = useCallback(() => {
    trozos.current = [];
    soltarMicrofono();
    despachar({ tipo: 'cancelar' });
  }, [soltarMicrofono]);

  /* ---- Pintura --------------------------------------------------------- */

  const grabando = grabacion.fase === 'grabando';
  const subiendoVoz = grabacion.fase === 'enviando';
  const restantes = MAXIMO_TEXTO - borrador.length;

  return (
    <div className="tablon">
      <div className="tablon__hilo" ref={hilo} onScroll={alDesplazar}>
        {cargando ? (
          <p className="panel__vacio">Cargando la conversación…</p>
        ) : bloques.length === 0 ? (
          <p className="panel__vacio">{TABLON_VACIO}</p>
        ) : (
          bloques.map((bloque, i) => (
            <section className="tablon__bloque" key={bloque.clave}>
              {/* El separador de día solo cuando cambia, no en cada bloque. */}
              {(i === 0 || bloques[i - 1]?.dia !== bloque.dia) && (
                <p className="tablon__dia">{etiquetaDeDia(bloque.dia, hoy)}</p>
              )}
              <p className="tablon__autor">
                {bloque.autorNombre ?? 'Cuenta eliminada'}
                {bloque.autorId === usuarioId && <span className="tablon__yo"> (usted)</span>}
              </p>
              <ul className="tablon__mensajes">
                {bloque.mensajes.map((mensaje) => (
                  <Mensaje
                    key={mensaje.id}
                    proyectoId={proyectoId}
                    mensaje={mensaje}
                    usuarioId={usuarioId}
                    rol={rol}
                    alRetirar={(id) => void retirar(id)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {error !== null && (
        <p className="tablon__error" role="status">
          {error}
        </p>
      )}
      {grabacion.error !== null && (
        <p className="tablon__error" role="alert">
          {grabacion.error}
        </p>
      )}

      {grabando ? (
        <div className="tablon__grabando" role="status">
          <span className="tablon__punto" aria-hidden="true" />
          <span className="tablon__transcurrido">{duracionLegible(grabacion.transcurridoMs)}</span>
          <span
            className={
              seAcabaElTiempo(grabacion.transcurridoMs)
                ? 'tablon__restante tablon__restante--poco'
                : 'tablon__restante'
            }
          >
            quedan {duracionLegible(restanteMs(grabacion.transcurridoMs))}
          </span>
          <button type="button" className="boton boton--sutil" onClick={cancelarGrabacion}>
            Descartar
          </button>
          <button
            type="button"
            className="boton boton--principal"
            onClick={() => {
              despachar({ tipo: 'soltar' });
            }}
          >
            Enviar
          </button>
        </div>
      ) : (
        <form
          className="tablon__redactar"
          onSubmit={(evento) => {
            evento.preventDefault();
            void publicar();
          }}
        >
          <textarea
            className="tablon__entrada"
            value={borrador}
            maxLength={MAXIMO_TEXTO}
            rows={2}
            placeholder="Escribir un mensaje para el equipo"
            aria-label="Mensaje para el equipo"
            disabled={subiendoVoz}
            onChange={(evento) => {
              setBorrador(evento.target.value);
            }}
            onKeyDown={(evento) => {
              // Intro envía y Mayús+Intro hace párrafo, que es lo que espera
              // cualquiera que haya usado un chat. En el móvil no: allí Intro
              // es el salto de línea del teclado del sistema y el envío es el
              // botón, porque no hay forma de hacer Mayús+Intro con el pulgar.
              if (evento.key === 'Enter' && !evento.shiftKey && !('ontouchstart' in window)) {
                evento.preventDefault();
                void publicar();
              }
            }}
          />

          <div className="tablon__acciones">
            {restantes < 200 && (
              <span className="tablon__restantes">{restantes} caracteres</span>
            )}
            <button
              type="button"
              className="boton boton--sutil tablon__microfono"
              onClick={() => void empezarAGrabar()}
              disabled={subiendoVoz}
              aria-label="Grabar una nota de voz"
              title="Grabar una nota de voz"
            >
              <Icono nombre="microfono" />
            </button>
            <button
              type="submit"
              className="boton boton--principal"
              disabled={borrador.trim() === '' || enviando || subiendoVoz}
            >
              <Icono nombre="enviar" />
              {subiendoVoz ? 'Enviando la nota…' : 'Enviar'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/**
 * Los bytes de la grabación en base64, sin el prefijo `data:`.
 *
 * Se usa `FileReader` y no un bucle sobre el `ArrayBuffer` porque un minuto y
 * medio de audio es cerca de un megabyte, y recorrerlo byte a byte en el hilo
 * principal congela la interfaz justo al soltar el botón.
 */
function aBase64(blob: Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onerror = () => {
      rechazar(new Error('No se ha podido leer la grabación.'));
    };
    lector.onload = () => {
      const url = typeof lector.result === 'string' ? lector.result : '';
      resolver(url.slice(url.indexOf(',') + 1));
    };
    lector.readAsDataURL(blob);
  });
}
