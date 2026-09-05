import { useMemo, useState } from 'react';
import {
  OPERACIONES_REST,
  clasesConApi,
  comunicacionDe,
  rutaRest,
  type ClassDiagram,
  type OperacionRest,
} from '@app/shared';
import { Icono } from './iconos';
import { CAJA, VISTA, trazar } from './comunicacion';

/**
 * El diagrama de comunicación de una operación del backend generado.
 *
 * Un diagrama de clases no tiene mensajes: tiene cajas y líneas. Sacar de sus
 * relaciones un «diagrama de comunicación» —`Pedido` le manda algo a `Cliente`
 * porque hay una asociación entre los dos— es inventarse una conversación que no
 * ocurre en ninguna parte, y es exactamente el tipo de adorno que se ha ido
 * quitando de esta interfaz.
 *
 * Lo que sí tiene mensajes es el backend Spring Boot que sale del generador, y
 * sus llamadas están fijadas por las plantillas: el controlador llama al
 * servicio, el servicio al repositorio y al mapeador, el mapeador construye la
 * entidad. Eso es lo que se dibuja aquí, y por eso cada flecha trae debajo la
 * línea de Java de la que sale. La columna «en el código» de la tabla no es una
 * explicación: es la cadena que `generator/src/comunicacion.test.ts` busca
 * dentro del `.java` generado, así que si alguien cambia una plantilla y no
 * cambia la derivación, las pruebas se caen antes de que este visor mienta.
 *
 * Lo que no se dibuja, dicho aquí y en el pie: las asociaciones a-uno que el
 * mapeador resuelve contra el repositorio de otra entidad. Dependen del cálculo
 * de asociaciones del generador y duplicarlo sería garantizar que las dos
 * versiones se separen.
 */

interface Props {
  diagrama: ClassDiagram;
  onCerrar: () => void;
}

const ROTULO_OPERACION: Record<OperacionRest, string> = {
  listar: 'Listar',
  obtener: 'Obtener',
  crear: 'Crear',
  actualizar: 'Actualizar',
  borrar: 'Borrar',
};

export function VisorComunicacion({ diagrama, onCerrar }: Props) {
  const clases = useMemo(() => clasesConApi(diagrama), [diagrama]);
  const [claseId, setClaseId] = useState<string | null>(null);
  const [operacion, setOperacion] = useState<OperacionRest>('crear');

  // La selección se resuelve contra la lista viva: si alguien borra la clase
  // elegida mientras esto está abierto, cae en la primera en vez de quedarse en
  // blanco con un identificador que ya no existe.
  const cls = clases.find((c) => c.id === claseId) ?? clases[0] ?? null;

  const comunicacion = useMemo(
    () => (cls === null ? null : comunicacionDe(diagrama, cls, operacion)),
    [diagrama, cls, operacion],
  );
  const trazado = useMemo(() => (comunicacion === null ? null : trazar(comunicacion)), [
    comunicacion,
  ]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Diagrama de comunicación">
      <div className="modal__caja comunicacion">
        <header className="comunicacion__cabecera">
          <div>
            <h2>Diagrama de comunicación</h2>
            <p className="comunicacion__resumen">
              Quién llama a quién en el backend que se genera. No sale de las relaciones del
              diagrama de clases: sale de las plantillas, y cada mensaje trae la línea de Java
              que lo respalda.
            </p>
          </div>
          <button type="button" className="boton boton--icono" aria-label="Cerrar" onClick={onCerrar}>
            <Icono nombre="cerrar" />
          </button>
        </header>

        {cls === null || comunicacion === null || trazado === null ? (
          <p className="panel__vacio">
            Ninguna clase del diagrama genera API REST. Hacen falta clases concretas y
            persistentes: una interfaz, una enumeración, una clase abstracta o una marcada como
            transitoria no llega a tener controlador.
          </p>
        ) : (
          <>
            <div className="comunicacion__mandos">
              <label className="comunicacion__campo">
                <span>Clase</span>
                <select value={cls.id} onChange={(e) => setClaseId(e.target.value)}>
                  {clases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <div
                className="comunicacion__operaciones"
                role="tablist"
                aria-label="Operación REST"
              >
                {OPERACIONES_REST.map((op) => (
                  <button
                    key={op}
                    type="button"
                    role="tab"
                    aria-selected={op === operacion}
                    className={`boton${op === operacion ? ' boton--activo' : ''}`}
                    onClick={() => setOperacion(op)}
                  >
                    {ROTULO_OPERACION[op]}
                  </button>
                ))}
              </div>

              <code className="comunicacion__ruta">
                {comunicacion.metodo} {comunicacion.ruta}
              </code>
            </div>

            <div className="comunicacion__lienzo">
              <svg
                viewBox={`0 0 ${VISTA.ancho} ${VISTA.alto}`}
                role="img"
                aria-label={`${comunicacion.titulo}: ${comunicacion.mensajes
                  .filter((m) => m.retorno !== true)
                  .map((m) => `${m.numero} ${m.de} llama a ${m.a}, ${m.mensaje}`)
                  .join('; ')}`}
              >
                <defs>
                  {/*
                    Dos puntas iguales pero con `id` distinto: una hereda el
                    color de la flecha de llamada y otra el de la de retorno, y
                    un marcador no puede tomar `currentColor` de quien lo usa.
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
                    <path d="M0 0 8 4 0 8z" className="comunicacion__punta comunicacion__punta--retorno" />
                  </marker>
                </defs>

                {/* Los enlaces primero: las cajas van encima y los tapan por dentro. */}
                {trazado.lineas.map((l) => (
                  <line
                    key={l.clave}
                    className="comunicacion__enlace"
                    x1={l.x1}
                    y1={l.y1}
                    x2={l.x2}
                    y2={l.y2}
                  />
                ))}

                {trazado.cajas.map((caja) => (
                  <g key={caja.alias} className={`comunicacion__caja comunicacion__caja--${caja.capa}`}>
                    <rect x={caja.x} y={caja.y} width={CAJA.ancho} height={CAJA.alto} rx="4" />
                    <text x={caja.x + CAJA.ancho / 2} y={caja.y + 19} textAnchor="middle">
                      {caja.clase}
                    </text>
                    <text
                      x={caja.x + CAJA.ancho / 2}
                      y={caja.y + 33}
                      textAnchor="middle"
                      className="comunicacion__capa"
                    >
                      {caja.rotulo}
                    </text>
                  </g>
                ))}

                {trazado.flechas.map((f) => (
                  <g
                    key={f.clave}
                    className={`comunicacion__flecha${f.retorno ? ' comunicacion__flecha--retorno' : ''}`}
                  >
                    <path
                      d={f.d}
                      markerEnd={`url(#${f.retorno ? 'punta-retorno' : 'punta-llamada'})`}
                    />
                    <text x={f.tx} y={f.ty} textAnchor="middle">
                      {f.numero}
                    </text>
                  </g>
                ))}
              </svg>
            </div>

            <table className="comunicacion__tabla">
              <caption>{comunicacion.titulo}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">De</th>
                  <th scope="col">A</th>
                  <th scope="col">Mensaje</th>
                  <th scope="col">En el código generado</th>
                </tr>
              </thead>
              <tbody>
                {comunicacion.mensajes.map((m, indice) => (
                  <tr
                    key={`${m.numero}-${indice}`}
                    className={m.retorno === true ? 'comunicacion__fila--retorno' : undefined}
                  >
                    <td>{m.numero}</td>
                    <td>{m.de}</td>
                    <td>{m.a}</td>
                    <td>{m.mensaje}</td>
                    <td>
                      {m.evidencia === undefined ? (
                        <span className="comunicacion__sin-codigo">respuesta</span>
                      ) : (
                        <code>{m.evidencia}</code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="comunicacion__nota">
              Los paquetes son los que tendrá el proyecto: mover <strong>{cls.name}</strong> a un
              módulo cambia el de las seis cajas. Lo que aquí no se dibuja son las asociaciones
              a-uno que el mapeador resuelve contra el repositorio de otra entidad —lo que hace
              que crear un <code>{cls.name}</code> con un identificador inexistente devuelva 404—:
              eso lo decide el generador al calcular las asociaciones, y repetirlo aquí sería
              tener dos versiones de la misma cuenta. La ruta <code>/api/{rutaRest(cls)}</code> sí
              es la definitiva.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
