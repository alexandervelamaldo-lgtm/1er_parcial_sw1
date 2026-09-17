import { useMemo, useState } from 'react';
import {
  comprobarIntegridad,
  etiquetaDeParticipante,
  readComunicaciones,
  deleteComunicacion,
  type ComunicacionGuardada,
} from '@app/shared';
import type * as Y from 'yjs';
import { Icono } from './iconos';
import { ALTO_CAJA, trazarImportado } from './comunicacion-importada';

/**
 * Los diagramas de comunicación que se han importado a este proyecto.
 *
 * EN QUÉ SE DIFERENCIA DE `VisorComunicacion`. Aquel dibuja algo que esta
 * herramienta *deduce*: las seis capas del backend Spring Boot que sale del
 * generador, con sus llamadas fijadas por las plantillas. Es siempre el mismo
 * diagrama con distintos nombres, y por eso puede permitirse una tabla de
 * posiciones fija y una columna «en el código generado» que respalda cada
 * flecha. Este dibuja algo que viene de fuera: un fichero XMI que alguien
 * exportó de Enterprise Architect o escribió contra el estándar, con los
 * objetos que quiso y hablándose como quiso. Aquí no hay código que respalde
 * nada, así que la columna que sustituye a aquella es el `xmi:id`: lo que
 * permite coger el fichero original, buscar la cadena y ver de dónde salió la
 * flecha.
 *
 * LO QUE ESTA PANTALLA SE NIEGA A ESCONDER. Un diagrama importado puede estar
 * mal —mensajes que salen de objetos que el fichero no declara, respuestas que
 * no contestan a nada, numeración con huecos—, y `comprobarIntegridad` sabe
 * decir exactamente qué. Dibujar solo lo que encaja y callar el resto daría un
 * diagrama bonito y falso; quien lo mire lo dará por bueno y el error volverá
 * más tarde, ya sin el fichero delante. Por eso van juntos y a la vista: el
 * dibujo, los mensajes que no se han podido dibujar (`omitidos`) y la lista de
 * problemas de integridad.
 *
 * POR QUÉ SE LEE DEL DOCUMENTO Y NO DE UNA PROPIEDAD. Los diagramas importados
 * viven en el documento compartido, como las clases: son parte del proyecto y
 * no una vista pasajera. Se leen aquí, en cada pintada, contra el `Y.Doc` que
 * ya provoca un repintado al cambiar, de modo que si otro colaborador importa
 * un fichero mientras esto está abierto, aparece solo.
 */

interface Props {
  doc: Y.Doc;
  /** Cambia en cada actualización del documento; obliga a releer. */
  version: number;
  soloLectura: boolean;
  onCerrar: () => void;
}

/** El texto que se lee en voz alta describiendo el diagrama entero. */
function narrar(diagrama: ComunicacionGuardada): string {
  const nombre = new Map(diagrama.participantes.map((p) => [p.id, etiquetaDeParticipante(p)]));
  const de = (id: string): string => nombre.get(id) ?? id;
  const mensajes = diagrama.mensajes
    .map((m) => `${m.numero}, ${de(m.de)} a ${de(m.a)}, ${m.nombre}`)
    .join('; ');
  return `${diagrama.nombre}: ${diagrama.participantes.length} objetos. ${mensajes}`;
}

const CLASE_DE_MENSAJE: Record<string, string> = {
  llamada: 'llamada',
  asincrono: 'asíncrono',
  respuesta: 'respuesta',
  creacion: 'creación',
  destruccion: 'destrucción',
};

export function VisorComunicacionImportada({
  doc,
  version,
  soloLectura,
  onCerrar,
}: Props): JSX.Element {
  // `version` no se usa dentro: está en las dependencias para que releer sea lo
  // que ocurre cuando el documento cambia. Sin él, importar un diagrama con
  // esta pantalla abierta no se vería hasta cerrarla y volverla a abrir.
  const diagramas = useMemo(() => readComunicaciones(doc), [doc, version]);
  const [elegido, setElegido] = useState<string | null>(null);

  // Igual que en el otro visor: la selección se resuelve contra la lista viva,
  // así que borrar el diagrama que se está mirando cae en el siguiente en vez
  // de dejar la pantalla en blanco con un identificador que ya no existe.
  const diagrama = diagramas.find((d) => d.id === elegido) ?? diagramas[0] ?? null;

  const trazado = useMemo(
    () => (diagrama === null ? null : trazarImportado(diagrama)),
    [diagrama],
  );
  const integridad = useMemo(
    () => (diagrama === null ? null : comprobarIntegridad(diagrama)),
    [diagrama],
  );

  const etiquetas = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of diagrama?.participantes ?? []) mapa.set(p.id, etiquetaDeParticipante(p));
    return mapa;
  }, [diagrama]);
  const quien = (id: string): string => etiquetas.get(id) ?? id;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Diagramas de comunicación importados"
    >
      {/* `comunicacion` para heredar el modal, el lienzo y la tabla del otro
          visor; `--importada` para lo poco que se aparta. */}
      <div className="modal__caja comunicacion comunicacion--importada">
        <header className="comunicacion__cabecera">
          <div>
            <h2>Comunicación importada</h2>
            <p className="comunicacion__resumen">
              Los diagramas que han entrado desde un fichero XMI, tal y como venían: los mismos
              objetos, los mismos mensajes y la misma numeración. No se han deducido de nada.
            </p>
          </div>
          <button
            type="button"
            className="boton boton--icono"
            aria-label="Cerrar"
            onClick={onCerrar}
          >
            <Icono nombre="cerrar" />
          </button>
        </header>

        {diagrama === null || trazado === null || integridad === null ? (
          <p className="panel__vacio">
            Todavía no se ha importado ningún diagrama de comunicación. Se recogen al importar un
            fichero XMI que traiga una interacción: una <code>uml:Interaction</code> con sus líneas
            de vida y sus mensajes.
          </p>
        ) : (
          <>
            <div className="comunicacion__mandos">
              <label className="comunicacion__campo">
                <span>Diagrama</span>
                <select value={diagrama.id} onChange={(e) => setElegido(e.target.value)}>
                  {diagramas.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <span className="comunicacion__ruta">
                {diagrama.participantes.length} objetos · {diagrama.mensajes.length} mensajes ·{' '}
                {diagrama.enlaces.length} enlaces
              </span>

              <button
                type="button"
                className="boton boton--discreto"
                disabled={soloLectura}
                onClick={() => deleteComunicacion(doc, diagrama.id)}
              >
                Quitar del proyecto
              </button>
            </div>

            <p className="comunicacion__fuente">
              De <code>{diagrama.fuente === '' ? 'origen desconocido' : diagrama.fuente}</code>
              {diagrama.importadoEl !== '' && (
                <> · importado el {new Date(diagrama.importadoEl).toLocaleString('es')}</>
              )}
            </p>

            <div className="comunicacion__lienzo">
              <svg
                viewBox={`0 0 ${trazado.ancho} ${trazado.alto}`}
                role="img"
                aria-label={narrar(diagrama)}
              >
                <defs>
                  {/*
                    Las mismas dos puntas que el otro visor y por el mismo
                    motivo: un `<marker>` no hereda el `currentColor` de la
                    flecha que lo usa, así que hacen falta dos definiciones
                    iguales para tener dos colores.
                  */}
                  <marker
                    id="punta-llamada"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M0 0 8 4 0 8z" className="comunicacion__punta" />
                  </marker>
                  <marker
                    id="punta-retorno"
                    viewBox="0 0 8 8"
                    refX="7"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M0 0 8 4 0 8z"
                      className="comunicacion__punta comunicacion__punta--retorno"
                    />
                  </marker>
                </defs>

                {/* Los enlaces primero: las cajas van encima y los tapan por dentro. */}
                {trazado.lineas.map((l) => (
                  <g key={l.clave}>
                    <line
                      className={`comunicacion__enlace${
                        l.deducido ? ' comunicacion__enlace--deducido' : ''
                      }`}
                      x1={l.x1}
                      y1={l.y1}
                      x2={l.x2}
                      y2={l.y2}
                    />
                    {l.nombre !== undefined && (
                      <text
                        className="comunicacion__enlace-nombre"
                        x={(l.x1 + l.x2) / 2}
                        y={(l.y1 + l.y2) / 2 - 4}
                        textAnchor="middle"
                      >
                        {l.nombre}
                      </text>
                    )}
                  </g>
                ))}

                {trazado.cajas.map((caja) => (
                  <g
                    key={caja.id}
                    className={`comunicacion__caja${
                      caja.actor ? ' comunicacion__caja--actor' : ''
                    }`}
                  >
                    {/* Un objeto múltiple se dibuja con la caja de detrás
                        asomando, que es la notación de UML para «varios». */}
                    {caja.multiple && (
                      <rect
                        x={caja.x + 6}
                        y={caja.y - 6}
                        width={caja.ancho}
                        height={ALTO_CAJA}
                        rx="4"
                        className="comunicacion__caja-sombra"
                      />
                    )}
                    <rect
                      x={caja.x}
                      y={caja.y}
                      width={caja.ancho}
                      height={caja.alto}
                      rx="4"
                    />
                    <text x={caja.cx} y={caja.cy + 5} textAnchor="middle">
                      {caja.etiqueta}
                    </text>
                  </g>
                ))}

                {trazado.flechas.map((f) => (
                  <g
                    key={f.clave}
                    className={`comunicacion__flecha${
                      f.clase === 'respuesta' ? ' comunicacion__flecha--retorno' : ''
                    }`}
                  >
                    <path
                      d={f.d}
                      markerEnd={`url(#${f.clase === 'respuesta' ? 'punta-retorno' : 'punta-llamada'})`}
                    />
                    <text x={f.tx} y={f.ty} textAnchor="middle">
                      {f.rotulo}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            {/* Lo que no se ha podido dibujar, dicho antes que la tabla: es lo
                que explica que falte una flecha que el fichero sí traía. */}
            {trazado.omitidos.length > 0 && (
              <ul className="importar__avisos">
                {trazado.omitidos.map((o) => (
                  <li key={o.id}>
                    El mensaje <strong>{o.numero}</strong> no se dibuja: {o.motivo}.
                  </li>
                ))}
              </ul>
            )}

            <table className="comunicacion__tabla">
              <caption>{diagrama.nombre}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">De</th>
                  <th scope="col">A</th>
                  <th scope="col">Mensaje</th>
                  <th scope="col">Clase</th>
                  <th scope="col">xmi:id</th>
                </tr>
              </thead>
              <tbody>
                {diagrama.mensajes.map((m) => (
                  <tr
                    key={m.id}
                    className={m.clase === 'respuesta' ? 'comunicacion__fila--retorno' : undefined}
                  >
                    <td>
                      {m.numero}
                      {/* Un número deducido no es un dato del fichero: es una
                          suposición de este programa, y hay que poder verla. */}
                      {m.ordenDe === 'documento' && (
                        <abbr title="El fichero no traía número: se ha deducido del orden en que aparecen los mensajes">
                          {' '}
                          *
                        </abbr>
                      )}
                    </td>
                    <td>{quien(m.de)}</td>
                    <td>{quien(m.a)}</td>
                    <td>{m.etiqueta}</td>
                    <td>{CLASE_DE_MENSAJE[m.clase] ?? m.clase}</td>
                    <td>
                      <code>{m.id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {integridad.problemas.length > 0 && (
              <details className="importar-xmi__detalle" open={!integridad.integro}>
                <summary>
                  {integridad.problemas.length} cosa
                  {integridad.problemas.length === 1 ? '' : 's'} que revisar en lo importado
                </summary>
                <ul
                  className={`importar__avisos${
                    integridad.integro ? '' : ' importar__avisos--error'
                  }`}
                >
                  {integridad.problemas.map((p, indice) => (
                    <li key={`${p.codigo}-${indice}`}>
                      {p.mensaje}
                      {p.elementos.length > 0 && (
                        <>
                          {' '}
                          <code>{p.elementos.join(', ')}</code>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <p className="comunicacion__nota">
              La colocación la decide esta herramienta, no el fichero: los ficheros XMI llevan las
              coordenadas en un bloque propio de cada programa que las escribe, y aprovecharlas
              sería atarse a uno. Lo que sí es del fichero es todo lo demás —quién habla con quién,
              con qué mensaje y en qué orden—, y eso no se toca. Los enlaces punteados no venían
              como <code>uml:Connector</code>: se han deducido de que hay un mensaje viajando por
              ahí.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
