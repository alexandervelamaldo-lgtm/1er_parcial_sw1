import type { EstadoConexion } from '@app/shared';
import type { Participante } from '../hooks/usePresencia';
import { IndicadorSync } from './IndicadorSync';
import { Icono } from './iconos';
import { ALTO_BARRA_SUPERIOR } from './movil-reparto';
import { inicialDe, resumirPresencia } from './movil-presencia';

/**
 * La barra de arriba: dónde estoy, si está subido, quién más está dentro.
 *
 * Es deliberadamente **una sola fila de 48 px** y no dos. Cada fila de barra se
 * paga en diagrama durante todo el tiempo que la pantalla está abierta, no solo
 * mientras se mira; en el escritorio esto ocupaba una barra de menú, una barra de
 * herramientas y una barra de estado, tres filas que aquí no caben ni tendrían
 * sentido.
 *
 * Lo que se quedó dentro y por qué:
 *
 * - **El nombre del proyecto.** En el móvil no hay pestañas ni título de ventana:
 *   si no está aquí, no hay ningún sitio donde leer en qué proyecto se está
 *   escribiendo, y con dos proyectos parecidos abiertos en dos ratos distintos eso
 *   se confunde.
 * - **El estado de sincronización**, con `IndicadorSync`, el mismo componente que
 *   el escritorio. Es el único aviso de que lo que se está dibujando todavía no ha
 *   subido, y en un teléfono —que pierde la red al entrar en el metro— es más
 *   necesario que en un portátil, no menos.
 * - **El botón del cajón**, arriba a la izquierda, donde Android pone el suyo.
 *
 * Lo que se quedó fuera: el zoom y el encuadre, que en el móvil son gestos
 * —pellizcar y el botón de encuadrar de la barra del pulgar— y tenerlos también
 * aquí sería gastar la fila en algo que el dedo ya hace mejor.
 *
 * ## La presencia se pinta aquí y se cuenta en `movil-presencia.ts`
 *
 * `IndicadorSync` recibe la lista vacía a propósito. Sabe pintar fichas de
 * participante y lo hace bien en el escritorio, pero sin tope y con el nombre
 * completo en un `title`, y ninguna de las dos cosas sirve en un teléfono: sin
 * tope las fichas se comen el nombre del proyecto, y un `title` necesita un ratón
 * encima. Lo que se reutiliza de él es lo que sí vale en las dos pantallas —el
 * estado de la conexión en palabras—, y la presencia se pinta al lado con su
 * propio tope y como botón, porque aquí el nombre de quien está dentro solo se
 * puede leer tocando.
 */
export function BarraMovil({
  nombreProyecto,
  conexion,
  detalleConexion,
  sincronizado,
  participantes,
  onCajon,
  onPresentes,
}: {
  nombreProyecto: string;
  conexion: EstadoConexion;
  detalleConexion: string | undefined;
  sincronizado: boolean;
  participantes: Participante[];
  onCajon: () => void;
  onPresentes: () => void;
}): JSX.Element {
  const presencia = resumirPresencia(participantes);

  return (
    <header className="barra-movil" style={{ height: `${String(ALTO_BARRA_SUPERIOR)}px` }}>
      <button
        type="button"
        className="barra-movil__cajon"
        onClick={onCajon}
        aria-label="Abrir las acciones del proyecto"
      >
        <Icono nombre="desplegar" />
      </button>

      {/*
        `title` además del texto: el nombre se recorta con puntos suspensivos
        cuando no cabe, y sin esto un proyecto con nombre largo no habría forma de
        leerlo entero.
      */}
      <h1 className="barra-movil__nombre" title={nombreProyecto}>
        {nombreProyecto}
      </h1>

      <IndicadorSync
        estado={conexion}
        detalle={detalleConexion}
        sincronizado={sincronizado}
        participantes={[]}
      />

      {participantes.length > 0 && (
        <button
          type="button"
          className="barra-movil__presentes"
          onClick={onPresentes}
          aria-label={presencia.rotulo}
        >
          {presencia.fichas.map((p) => (
            <span
              key={p.clientId}
              className="barra-movil__ficha"
              style={{ background: p.color }}
              aria-hidden="true"
            >
              {inicialDe(p.nombre)}
            </span>
          ))}
          {/*
            El número de los que no caben va sin color: los colores identifican a
            una persona concreta en el lienzo, y darle uno a «los otros cuatro»
            sería inventar un participante que no existe.
          */}
          {presencia.sobran > 0 && (
            <span className="barra-movil__sobran" aria-hidden="true">
              +{presencia.sobran}
            </span>
          )}
        </button>
      )}
    </header>
  );
}
