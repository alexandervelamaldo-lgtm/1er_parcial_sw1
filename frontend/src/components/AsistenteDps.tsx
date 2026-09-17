import { useCallback, useEffect, useRef, useState } from 'react';
import { Icono } from './iconos';
import {
  PASOS,
  TOTAL_PASOS,
  anterior,
  esUltimo,
  irA,
  moverEnAsistente,
  progreso,
  siguiente,
  type SalidaDelRecorrido,
} from './asistente-dps';

/**
 * El recorrido de primer acceso.
 *
 * Aquí solo hay dibujo y foco. Qué se cuenta, en qué orden, qué hace cada tecla
 * y cuándo se considera visto está en `asistente-dps.ts`, que no toca el DOM y
 * por eso tiene pruebas —las de este fichero esperan a jsdom, tarea 15—.
 *
 * Dos decisiones de forma que no son estéticas:
 *
 * El índice está **siempre** a la vista, en su propia columna, y no escondido
 * tras un botón. Un recorrido de seis láminas sin índice se vive como una
 * secuencia de la que no se sabe cuánto queda, y lo primero que se busca
 * entonces es la aspa. Con el índice delante se ve el total, se ve dónde se
 * está y se puede ir directamente a la sección que interesa, que es lo que hace
 * la gente que ya conoce la herramienta y solo quiere una cosa.
 *
 * Y el recorrido no señala partes de la pantalla con un agujero en el velo.
 * Ese patrón —el foco recortado sobre el botón de turno— exige que los
 * elementos existan y estén donde se prometió, y aquí la mitad no existe hasta
 * que hay un proyecto abierto: se rompería el día que alguien mueva un botón de
 * sitio, en silencio y solo para quien entra por primera vez.
 */

export interface AsistenteDpsProps {
  /**
   * Se llama al cerrar, diga cómo se cerró. Las dos salidas se distinguen
   * porque quien mide el uso del recorrido necesita saber cuántos lo terminan,
   * aunque las dos marquen «visto» igual.
   */
  onCerrar: (salida: SalidaDelRecorrido) => void;
}

/** Los elementos que pueden recibir el foco dentro de la caja, en orden. */
function enfocables(raiz: HTMLElement): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
}

export function AsistenteDps({ onCerrar }: AsistenteDpsProps): JSX.Element {
  const [paso, setPaso] = useState(0);
  const cajaRef = useRef<HTMLDivElement>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  /*
    Quién tenía el foco antes de abrirse. Sin esto, al cerrar el recorrido el
    foco vuelve al `<body>` y la siguiente pulsación de Tab empieza por el
    principio de la página: para quien navega con teclado, cerrar un diálogo
    equivale a perder el sitio.
  */
  const anteriorFoco = useRef<Element | null>(null);

  const cerrar = useCallback(
    (salida: SalidaDelRecorrido) => {
      onCerrar(salida);
    },
    [onCerrar],
  );

  const aplicar = useCallback(
    (resultado: { paso: number; salir?: SalidaDelRecorrido }) => {
      setPaso(resultado.paso);
      if (resultado.salir) cerrar(resultado.salir);
    },
    [cerrar],
  );

  useEffect(() => {
    anteriorFoco.current = document.activeElement;
    return () => {
      if (anteriorFoco.current instanceof HTMLElement) anteriorFoco.current.focus();
    };
  }, []);

  /*
    El foco va al título en cada cambio de lámina, y el título es `tabindex=-1`
    para poder recibirlo. Es lo que hace que un lector de pantalla lea la lámina
    nueva: sin mover el foco, «Siguiente» cambia la pantalla entera y no se
    anuncia nada, porque el foco sigue en un botón que no ha cambiado.
  */
  useEffect(() => {
    tituloRef.current?.focus();
  }, [paso]);

  const alPulsarTecla = (evento: React.KeyboardEvent<HTMLDivElement>): void => {
    /*
      El tabulador se atrapa dentro de la caja. Un diálogo modal que deja salir
      el foco por detrás lleva a rellenar formularios que no se ven, y en este
      caso concreto a modificar el diagrama a ciegas mientras el velo dice que
      no se puede tocar nada.
    */
    if (evento.key === 'Tab' && cajaRef.current) {
      const lista = enfocables(cajaRef.current);
      if (lista.length === 0) return;
      const primero = lista[0] as HTMLElement;
      const ultimo = lista[lista.length - 1] as HTMLElement;
      const activo = document.activeElement;
      if (evento.shiftKey && (activo === primero || !cajaRef.current.contains(activo))) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && activo === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
      return;
    }

    const resultado = moverEnAsistente(paso, evento.key);
    if (!resultado) return;
    evento.preventDefault();
    aplicar(resultado);
  };

  const actual = PASOS[paso] ?? (PASOS[0] as (typeof PASOS)[number]);
  const ultimo = esUltimo(paso);

  return (
    <div
      className="recorrido"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recorrido-titulo"
      onKeyDown={alPulsarTecla}
    >
      <div className="recorrido__caja" ref={cajaRef}>
        {/*
          El índice, en su propia columna. Es una lista numerada de verdad y no
          una fila de botones: el número de cada sección y el total son parte de
          lo que hay que poder leer sin contar nada.
        */}
        <nav className="recorrido__indice" aria-label="Índice del recorrido">
          <p className="recorrido__marca">Asistente de DPS</p>
          <ol>
            {PASOS.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`recorrido__entrada${i === paso ? ' recorrido__entrada--actual' : ''}`}
                  aria-current={i === paso ? 'step' : undefined}
                  onClick={() => aplicar(irA(i))}
                >
                  <span className="recorrido__numero" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="recorrido__rotulo">{p.rotulo}</span>
                </button>

                {/*
                  Los puntos de la sección en curso se despliegan bajo su
                  entrada. Es lo que convierte la lista en un índice detallado
                  sin convertirla en una pared de cuarenta líneas: el detalle
                  está donde se está mirando.
                */}
                {i === paso && (
                  <ul className="recorrido__subindice">
                    {p.puntos.map((punto) => (
                      <li key={punto.titulo}>{punto.titulo}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <section className="recorrido__lamina">
          <header className="recorrido__cabecera">
            <p className="recorrido__paso">{progreso(paso)}</p>
            <h2 id="recorrido-titulo" ref={tituloRef} tabIndex={-1}>
              {actual.titulo}
            </h2>
            <p className="recorrido__entradilla">{actual.entradilla}</p>
          </header>

          <ul className="recorrido__puntos">
            {actual.puntos.map((punto) => (
              <li key={punto.titulo} className="recorrido__punto">
                <span className="recorrido__icono" aria-hidden="true">
                  <Icono nombre={punto.icono} />
                </span>
                <div>
                  <h3>{punto.titulo}</h3>
                  <p>{punto.texto}</p>
                </div>
              </li>
            ))}
          </ul>

          {actual.nota && (
            <p className="recorrido__nota">
              <Icono nombre="alerta" />
              <span>{actual.nota}</span>
            </p>
          )}

          {/*
            El progreso se anuncia por aquí y no desde el rótulo de arriba. Con
            `aria-live` sobre un texto que además se ve, el lector lo repetiría
            dos veces: una al moverse el foco al título y otra al cambiar la
            región. Esta está oculta a la vista y sirve solo para eso.
          */}
          <p className="recorrido__anuncio" role="status" aria-live="polite">
            {`${progreso(paso)}: ${actual.rotulo}`}
          </p>

          <footer className="recorrido__pie">
            <button type="button" className="boton recorrido__saltar" onClick={() => cerrar('saltado')}>
              <Icono nombre="cerrar" />
              <span>Saltar el recorrido</span>
            </button>

            {/*
              Los puntos duplican lo que ya dice el índice, así que no se
              anuncian: quien no ve la pantalla ya tiene la lista numerada y la
              frase de progreso, y una tercera lectura de lo mismo solo alarga.
            */}
            <ol className="recorrido__puntitos" aria-hidden="true">
              {PASOS.map((p, i) => (
                <li
                  key={p.id}
                  className={`recorrido__puntito${i === paso ? ' recorrido__puntito--actual' : ''}`}
                />
              ))}
            </ol>

            <div className="recorrido__botones">
              <button
                type="button"
                className="boton"
                disabled={paso === 0}
                onClick={() => aplicar(anterior(paso))}
              >
                <Icono nombre="atras" />
                <span>Anterior</span>
              </button>
              <button
                type="button"
                className="boton boton--primario"
                onClick={() => aplicar(siguiente(paso))}
              >
                <span>{ultimo ? 'Empezar a modelar' : 'Siguiente'}</span>
                {ultimo ? <Icono nombre="comprobado" /> : <Icono nombre="desplegar" />}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

export { TOTAL_PASOS };
