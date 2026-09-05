import { useMemo } from 'react';
import type { FilaPanel } from '../services/api';
import { Icono } from './iconos';
import { contenidoDelTablero, porcentaje } from './tablero-proyectos';
import {
  ROTULO_ESTADO,
  cambiosDeModelo,
  componerInforme,
  estadoDe,
  fechaLarga,
  type EstadoProyecto,
} from './informe-ejecutivo';

/**
 * El informe de una página, para quien pregunta por el estado sin abrir el editor.
 *
 * Existe porque la pregunta «¿cómo va esto?» la hace alguien que no va a mirar
 * un diagrama, y hasta ahora la única respuesta era enseñarle el tablero, que
 * está pensado para trabajar y no para leerse de una vez.
 *
 * Se imprime. Eso es lo que condiciona todo lo demás: en cuanto una cifra sale
 * en papel deja de tener al lado la interfaz que la matiza, así que cada número
 * de aquí va con su alcance escrito y no hay ninguno que no salga de
 * `/api/panel`. La maqueta de la que viene esta pantalla enseñaba además sellos
 * de «TOGAF 10» y «SOC 2 Type II»; están deliberadamente fuera, y el porqué
 * está en `informe-ejecutivo.ts`.
 */

const CLASE_ESTADO: Record<EstadoProyecto, string> = {
  'sin-datos': 'informe__estado--neutro',
  'con-errores': 'informe__estado--error',
  'con-avisos': 'informe__estado--aviso',
  listo: 'informe__estado--exito',
};

interface Props {
  filas: FilaPanel[];
  onCerrar: () => void;
}

export function InformeEjecutivo({ filas, onCerrar }: Props) {
  /*
    La fecha se congela al abrir. Si se recalculara en cada render, el papel y
    la pantalla podrían llevar minutos distintos.
  */
  const informe = useMemo(() => componerInforme(filas, new Date()), [filas]);
  /*
    El reparto por vía se reutiliza del tablero en vez de recalcularse. Es el
    mismo dato contado igual; dos aritméticas paralelas para la misma barra
    acaban discrepando en el parche que solo toca una de las dos.
  */
  const { vias } = useMemo(() => contenidoDelTablero(filas), [filas]);
  const entraron = cambiosDeModelo(vias);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Informe de estado">
      <div className="modal__caja informe">
        <header className="informe__cabecera">
          <div>
            <h2>Informe de estado</h2>
            <p className="informe__emitido">Emitido el {fechaLarga(informe.emitido)}</p>
          </div>
          <div className="informe__acciones">
            <button type="button" className="boton" onClick={() => window.print()}>
              Imprimir
            </button>
            <button
              type="button"
              className="boton boton--icono"
              aria-label="Cerrar"
              onClick={onCerrar}
            >
              <Icono nombre="cerrar" />
            </button>
          </div>
        </header>

        {/*
          El alcance va arriba y no en una nota al pie. Es la diferencia entre un
          informe correcto y uno que miente: el servidor solo resume los N
          proyectos más recientes, y quien lea «40 clases» tiene que saber si
          son todas antes de leer el número, no después.
        */}
        {!informe.alcanceCompleto && (
          <p className="informe__alcance">
            <Icono nombre="alerta" /> Las cifras cubren {informe.total.resumidos} de los{' '}
            {informe.total.proyectos} proyectos. El resto aparece en la tabla sin resumir.
          </p>
        )}

        <section className="informe__cifras">
          <Cifra valor={informe.total.proyectos} rotulo="Proyectos" />
          <Cifra valor={informe.total.clases} rotulo="Clases" />
          <Cifra valor={informe.total.relaciones} rotulo="Relaciones" />
          <Cifra
            valor={informe.listos}
            rotulo="Listos para generar"
            nota={
              informe.total.conProblemas > 0
                ? `${informe.total.conProblemas} con errores`
                : undefined
            }
          />
        </section>

        <section className="informe__seccion">
          <h3 className="informe__titulo">Cómo entró el modelo</h3>
          {vias.length === 0 ? (
            <p className="informe__vacio">Todavía no hay cambios registrados.</p>
          ) : (
            <>
              {/*
                La barra se reparte con `flex-grow` sobre los recuentos crudos,
                igual que en el tablero: repartirla con los porcentajes
                redondeados metería el error de redondeo en el dibujo. El color
                no lleva información por sí solo, cada tramo tiene su rótulo
                debajo con nombre y número, y por eso la barra se oculta a los
                lectores de pantalla en vez de repetirles la leyenda.
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
                      {via.cambios} ({porcentaje(via.cambios, entraron)}%)
                    </span>
                  </li>
                ))}
              </ul>
              {informe.total.cambios > entraron && (
                <p className="informe__nota">
                  El reparto cubre los {entraron} cambios que aportaron modelo. Los{' '}
                  {informe.total.cambios - entraron} restantes son deshacer y rehacer, que no
                  añaden nada al diagrama.
                </p>
              )}
            </>
          )}
        </section>

        <section className="informe__seccion">
          <h3 className="informe__titulo">Proyecto por proyecto</h3>
          <table className="informe__tabla">
            <thead>
              <tr>
                <th scope="col">Proyecto</th>
                <th scope="col">Clases</th>
                <th scope="col">Relaciones</th>
                <th scope="col">Personas</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {informe.filas.map((fila) => {
                const estado = estadoDe(fila);
                return (
                  <tr key={fila.proyecto.id}>
                    <th scope="row">{fila.proyecto.name}</th>
                    <td>{fila.resumen?.clases ?? '—'}</td>
                    <td>{fila.resumen?.relaciones ?? '—'}</td>
                    <td>{fila.resumen?.miembros ?? '—'}</td>
                    <td>
                      <span className={`informe__estado ${CLASE_ESTADO[estado]}`}>
                        {ROTULO_ESTADO[estado]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {informe.filas.length === 0 && (
            <p className="informe__vacio">No hay proyectos que informar todavía.</p>
          )}
        </section>

        {/*
          El pie dice de dónde salen los números. En un papel que circula sin la
          aplicación al lado, eso es lo que permite comprobarlos.
        */}
        <footer className="informe__pie">
          Cifras contadas sobre los documentos del servidor en el momento de emitir. «Listo para
          generar» significa que la validación no encuentra errores, no que se haya desplegado ni
          auditado nada.
        </footer>
      </div>
    </div>
  );
}

function Cifra({ valor, rotulo, nota }: { valor: number; rotulo: string; nota?: string }) {
  return (
    <div className="informe__cifra">
      <span className="informe__cifra-valor">{valor}</span>
      <span className="informe__cifra-rotulo">{rotulo}</span>
      {nota !== undefined && <span className="informe__cifra-nota">{nota}</span>}
    </div>
  );
}
