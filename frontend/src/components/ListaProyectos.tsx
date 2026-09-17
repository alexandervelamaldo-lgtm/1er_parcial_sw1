import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type FilaPanel, type Proyecto } from '../services/api';
import { useSesion } from '../services/sesion';
import { CodigoRecuperacion } from './CodigoRecuperacion';
import { DialogoCompartir } from './DialogoCompartir';
import { InformeEjecutivo } from './InformeEjecutivo';
import { MenuCuenta } from './MenuCuenta';
import { TableroProyectos } from './TableroProyectos';
import { haceCuanto } from './tablero-proyectos';

/**
 * Lista de proyectos y gestión de sus miembros (RF-COL-02).
 *
 * Es lo primero que se ve tras entrar y también el único sitio desde donde se
 * invita a alguien, porque compartir es una decisión sobre el proyecto y no
 * sobre el diagrama que se está editando.
 */
export function ListaProyectos({ onAbrir }: { onAbrir: (proyecto: Proyecto) => void }): JSX.Element {
  const { usuario, salir } = useSesion();
  /*
   * Una sola petición para toda la pantalla.
   *
   * `api.panel()` trae la lista entera —cada `fila.proyecto` es un `Proyecto`
   * completo, como el que traía `GET /api/proyectos`— y además las cifras. Montarlo
   * desde aquí habría sido pedir diagrama, miembros y validación por tarjeta:
   * tres peticiones por proyecto, y descargar el modelo entero de cada uno para
   * contar sus clases. El razonamiento largo está en `backend-tool/src/api/panel.ts`.
   */
  const [filas, setFilas] = useState<FilaPanel[]>([]);
  const [tope, setTope] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '', paquete: '' });
  const [compartiendo, setCompartiendo] = useState<Proyecto | null>(null);
  const [informando, setInformando] = useState(false);
  const [codigoNuevo, setCodigoNuevo] = useState<string | null>(null);

  /*
   * Pedir un código de recuperación desde dentro.
   *
   * Hace falta por dos motivos distintos. Uno, las cuentas creadas antes de que
   * los códigos existieran no tienen ninguno, y sin esto seguirían sin poder
   * recuperarse. Dos, quien sospeche que su código anduvo por donde no debía
   * puede emitir otro: el nuevo anula al viejo, así que generar uno es también
   * la forma de invalidar el anterior.
   */
  const pedirCodigo = async (): Promise<void> => {
    try {
      const { codigoRecuperacion } = await api.codigoRecuperacion();
      setCodigoNuevo(codigoRecuperacion);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo emitir el código');
    }
  };

  const recargar = useCallback(async (): Promise<void> => {
    setCargando(true);
    try {
      const { filas: lista, tope: maximo } = await api.panel();
      setFilas(lista);
      setTope(maximo);
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError && e.esDeRed
          ? 'Sin conexión: no se puede consultar la lista de proyectos.'
          : e instanceof Error
            ? e.message
            : 'No se pudieron cargar los proyectos',
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  const crear = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    if (!nuevo.nombre.trim()) return;
    try {
      const { proyecto } = await api.crearProyecto(
        nuevo.nombre.trim(),
        nuevo.descripcion.trim(),
        nuevo.paquete.trim() || undefined,
      );
      setNuevo({ nombre: '', descripcion: '', paquete: '' });
      setCreando(false);
      // Sin resumen: acaba de nacer y no hay nada que contar. `null` no es
      // «cero», es «el servidor no lo ha resumido», y aquí es lo cierto: la
      // fila se recalculará al volver a esta pantalla.
      setFilas((antes) => [{ proyecto, resumen: null }, ...antes]);
      onAbrir(proyecto);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto');
    }
  };

  return (
    <div className="proyectos">
      <header className="barra">
        <h1 className="barra__titulo">Proyectos</h1>
        {/*
          Las tres acciones de cuenta se recogen en un menú en vez de ocupar la
          barra en fila. Dos de ellas —el código de recuperación y salir— se
          usan una vez cada varias semanas, y en fila empujaban a la derecha lo
          único que se mira siempre, que es de quién es la sesión abierta.
        */}
        <div className="barra__herramientas">
          <MenuCuenta
            usuario={usuario}
            filas={filas}
            onInforme={() => setInformando(true)}
            onCodigoRecuperacion={() => void pedirCodigo()}
            onSalir={salir}
          />
        </div>
      </header>

      <main className="proyectos__cuerpo">
        {error && <p className="panel__error">{error}</p>}

        <button
          type="button"
          className="boton boton--primario"
          onClick={() => setCreando(!creando)}
        >
          {creando ? 'Cancelar' : '+ Nuevo proyecto'}
        </button>

        {creando && (
          <form className="tarjeta tarjeta--formulario" onSubmit={(e) => void crear(e)}>
            <label className="campo">
              <span>Nombre</span>
              <input
                autoFocus
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                placeholder="Tienda en línea"
              />
            </label>
            <label className="campo">
              <span>Descripción</span>
              <input
                value={nuevo.descripcion}
                onChange={(e) => setNuevo({ ...nuevo, descripcion: e.target.value })}
              />
            </label>
            <label className="campo">
              <span>Paquete base</span>
              <input
                value={nuevo.paquete}
                onChange={(e) => setNuevo({ ...nuevo, paquete: e.target.value })}
                placeholder="com.ejemplo.tienda"
              />
            </label>
            <button type="submit" className="boton boton--primario">
              Crear y abrir
            </button>
          </form>
        )}

        {!cargando && <TableroProyectos filas={filas} tope={tope} onAbrir={onAbrir} />}

        {cargando ? (
          <p className="panel__vacio">Cargando…</p>
        ) : filas.length === 0 ? (
          /*
           * Sin conexión esta rama también es la que se pinta, y no dice
           * «Cargando…» eternamente: el mensaje de red ya está arriba, y aquí
           * se afirma lo único que se sabe con certeza, que no hay lista.
           */
          <p className="panel__vacio">Sin proyectos.</p>
        ) : (
          <ul className="rejilla">
            {filas.map(({ proyecto, resumen }) => (
              <li key={proyecto.id} className="tarjeta">
                <button
                  type="button"
                  className="tarjeta__principal"
                  onClick={() => onAbrir(proyecto)}
                >
                  <h2>{proyecto.name}</h2>
                  <p>{proyecto.description || 'Sin descripción'}</p>
                  {/*
                    La fecha en palabras y no en ISO: la pregunta que se le hace
                    a esta línea es «¿esto es de esta semana?», y una marca de
                    tiempo obliga a restar mentalmente para contestarla.
                  */}
                  <p className="tarjeta__cifras">
                    <span>{haceCuanto(proyecto.updatedAt, new Date())}</span>
                    {resumen && (
                      <>
                        <span>
                          {resumen.clases} {resumen.clases === 1 ? 'clase' : 'clases'}
                        </span>
                        <span>
                          {resumen.miembros} {resumen.miembros === 1 ? 'miembro' : 'miembros'}
                        </span>
                        {/*
                          «impiden generar» y no «errores» a secas.
                          -----------------------------------------
                          Esta cifra sale de `validateDiagram`, que contesta
                          «¿se puede emitir Java, JPA y SQL de esto?». La
                          pantalla «Revisar el diagrama…» contesta otra muy
                          distinta —«¿está bien modelado?»— y también llama
                          «error» a lo suyo. Con las dos diciendo «error» se
                          da el caso que ya ocurrió: una tarjeta con seis y
                          una revisión sin ninguno, las dos ciertas, y quien
                          mira concluye que una de las dos miente.

                          Nombrar la consecuencia en vez de la categoría
                          desempata sin necesidad de explicar nada: lo que
                          esta cifra significa es que hoy no sale el backend.
                        */}
                        {resumen.problemas > 0 && (
                          <span className="tarjeta__problemas">
                            {resumen.problemas} {resumen.problemas === 1 ? 'impide' : 'impiden'}{' '}
                            generar
                          </span>
                        )}
                      </>
                    )}
                  </p>
                  <span className={`etiqueta etiqueta--${proyecto.role}`}>
                    {proyecto.role === 'owner'
                      ? 'Propietario'
                      : proyecto.role === 'editor'
                        ? 'Editor'
                        : 'Solo lectura'}
                  </span>
                </button>

                {proyecto.role === 'owner' && (
                  <div className="tarjeta__acciones">
                    <button
                      type="button"
                      className="boton boton--discreto"
                      onClick={() => setCompartiendo(proyecto)}
                    >
                      Compartir
                    </button>
                    <button
                      type="button"
                      className="boton boton--discreto"
                      onClick={() => {
                        if (!confirm(`¿Eliminar «${proyecto.name}» para todos los miembros?`)) return;
                        void api
                          .borrarProyecto(proyecto.id)
                          .then(recargar)
                          .catch((e: unknown) =>
                            setError(e instanceof Error ? e.message : 'No se pudo eliminar'),
                          );
                      }}
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      {compartiendo && (
        <DialogoCompartir proyecto={compartiendo} onCerrar={() => setCompartiendo(null)} />
      )}

      {informando && <InformeEjecutivo filas={filas} onCerrar={() => setInformando(false)} />}

      {codigoNuevo !== null && (
        // Sin cierre al pulsar fuera, al revés que el de compartir: aquí un clic
        // despistado en el fondo cerraría lo único que da acceso a la cuenta, y
        // el código ya no se puede volver a pedir. Solo se sale por el botón.
        <div className="modal" role="presentation">
          <div className="modal__caja" role="dialog">
            <h2>Código de recuperación</h2>
            <CodigoRecuperacion
              codigo={codigoNuevo}
              alConfirmar={() => setCodigoNuevo(null)}
              textoConfirmar="Cerrar"
            />
          </div>
        </div>
      )}
    </div>
  );
}

