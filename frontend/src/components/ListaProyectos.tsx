import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Miembro, type Proyecto } from '../services/api';
import { useSesion } from '../services/sesion';

/**
 * Lista de proyectos y gestión de sus miembros (RF-COL-02).
 *
 * Es lo primero que se ve tras entrar y también el único sitio desde donde se
 * invita a alguien, porque compartir es una decisión sobre el proyecto y no
 * sobre el diagrama que se está editando.
 */
export function ListaProyectos({ onAbrir }: { onAbrir: (proyecto: Proyecto) => void }): JSX.Element {
  const { usuario, salir } = useSesion();
  const [proyectos, setProyectos] = useState<Proyecto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', descripcion: '', paquete: '' });
  const [compartiendo, setCompartiendo] = useState<Proyecto | null>(null);

  const recargar = useCallback(async (): Promise<void> => {
    setCargando(true);
    try {
      const { proyectos: lista } = await api.listarProyectos();
      setProyectos(lista);
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
      setProyectos((antes) => [proyecto, ...antes]);
      onAbrir(proyecto);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el proyecto');
    }
  };

  return (
    <div className="proyectos">
      <header className="barra">
        <h1 className="barra__titulo">Tus proyectos</h1>
        <div className="barra__herramientas">
          <span className="barra__usuario">{usuario?.displayName || usuario?.email}</span>
          <button type="button" className="boton boton--discreto" onClick={salir}>
            Salir
          </button>
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

        {cargando ? (
          <p className="panel__vacio">Cargando…</p>
        ) : proyectos.length === 0 ? (
          <p className="panel__vacio">Todavía no tienes ningún proyecto.</p>
        ) : (
          <ul className="rejilla">
            {proyectos.map((proyecto) => (
              <li key={proyecto.id} className="tarjeta">
                <button
                  type="button"
                  className="tarjeta__principal"
                  onClick={() => onAbrir(proyecto)}
                >
                  <h2>{proyecto.name}</h2>
                  <p>{proyecto.description || 'Sin descripción'}</p>
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
    </div>
  );
}

function DialogoCompartir({
  proyecto,
  onCerrar,
}: {
  proyecto: Proyecto;
  onCerrar: () => void;
}): JSX.Element {
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<'editor' | 'viewer'>('editor');
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(() => {
    void api
      .listarMiembros(proyecto.id)
      .then(({ miembros: lista }) => setMiembros(lista))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo consultar'));
  }, [proyecto.id]);

  useEffect(recargar, [recargar]);

  return (
    <div className="modal" onClick={onCerrar} role="presentation">
      <div className="modal__caja" onClick={(e) => e.stopPropagation()} role="dialog">
        <h2>Compartir «{proyecto.name}»</h2>
        {error && <p className="panel__error">{error}</p>}

        <ul className="lista">
          {miembros.map((miembro) => (
            <li key={miembro.usuarioId} className="lista__fila">
              <span className="lista__nombre">{miembro.nombre || miembro.email}</span>
              <span className={`etiqueta etiqueta--${miembro.rol}`}>{miembro.rol}</span>
              {miembro.rol !== 'owner' && (
                <button
                  type="button"
                  className="marca marca--borrar"
                  title="Quitar del proyecto"
                  onClick={() => {
                    setError(null);
                    void api
                      .expulsar(proyecto.id, miembro.usuarioId)
                      .then(recargar)
                      .catch((e: unknown) =>
                        setError(e instanceof Error ? e.message : 'No se pudo quitar'),
                      );
                  }}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>

        <form
          className="fila-formulario"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            void api
              .invitar(proyecto.id, email.trim(), rol)
              .then(() => {
                setEmail('');
                recargar();
              })
              .catch((err: unknown) =>
                setError(err instanceof Error ? err.message : 'No se pudo invitar'),
              );
          }}
        >
          <input
            type="email"
            required
            placeholder="correo@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select value={rol} onChange={(e) => setRol(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">Editor</option>
            <option value="viewer">Solo lectura</option>
          </select>
          <button type="submit">Invitar</button>
        </form>

        <p className="modal__nota">
          Solo puedes invitar a personas que ya tengan cuenta. Quien pierde el acceso deja de ver el
          diagrama al instante, aunque lo tenga abierto.
        </p>

        <button type="button" className="boton" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
