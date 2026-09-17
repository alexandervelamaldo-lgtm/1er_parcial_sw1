import { useCallback, useEffect, useState } from 'react';
import { api, type Miembro, type Proyecto } from '../services/api';
import { Icono } from './iconos';

/**
 * Quién entra al proyecto y con qué permiso.
 *
 * ## Por qué vive en su propio fichero
 *
 * Estuvo dentro de `ListaProyectos.tsx` como una función local, y con ello el
 * único sitio desde donde se podía invitar a alguien era la pantalla anterior a
 * abrir el proyecto. En un escritorio eso se nota poco: se cierra el editor, se
 * comparte y se vuelve a entrar. En un teléfono es donde se rompe, porque quien
 * está dibujando en el móvil ha llegado casi siempre desde un enlace o desde la
 * propia app, y salir del proyecto para volver a entrar es exactamente el tipo de
 * viaje que hace que una función no se use nunca.
 *
 * Así que se saca aquí y lo usan los dos: el escritorio como diálogo sobre la
 * lista, y el móvil como pantalla completa desde el cajón. No se escribe una
 * versión táctil aparte a propósito, por el mismo motivo por el que no se
 * reescribieron «importar XMI» ni la previsualización: dos formularios de invitar
 * son dos sitios donde arreglar el día que cambie el contrato de la API, y uno de
 * los dos se quedaría atrás sin que nadie se entere hasta que falle.
 *
 * ## Lo que el componente no decide
 *
 * Si se puede invitar o no. Eso lo resuelve antes quien lo abre —el catálogo de
 * acciones del móvil apaga la entrada con su motivo cuando el permiso es de solo
 * lectura— porque decir que no **antes** del intento es la diferencia entre una
 * interfaz que se entiende y una que parece estropeada. Aquí solo se informa de
 * lo que conteste el servidor, que es la última palabra de todas formas.
 */
export function DialogoCompartir({
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
                  /*
                    El rótulo lleva de quién se habla. Con cuatro miembros hay
                    cuatro botones idénticos, y «Quitar del proyecto» a secas deja
                    a quien navega por voz o con lector eligiendo entre cuatro
                    controles que se anuncian igual.
                  */
                  aria-label={`Quitar del proyecto a ${miembro.nombre || miembro.email}`}
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
                  <Icono nombre="cerrar" />
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
            /*
              Los cuatro atributos son para el teclado del teléfono, y los cuatro
              hacen falta. Sin `inputMode` sale el teclado normal y hay que buscar
              la arroba en la segunda capa de símbolos; con la mayúscula y la
              corrección automática activadas, Android convierte «ana@» en «Ana@»
              y propone palabras del diccionario dentro de un correo. El resultado
              es una invitación que el servidor rechaza por una letra.
            */
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Correo de la persona a la que invitar"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            value={rol}
            aria-label="Permiso con el que entra"
            onChange={(e) => setRol(e.target.value as 'editor' | 'viewer')}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Solo lectura</option>
          </select>
          <button type="submit">Invitar</button>
        </form>

        <p className="modal__nota">
          Solo se puede invitar a personas con cuenta ya creada. Quien pierde el acceso deja de ver
          el diagrama al instante, aunque lo tenga abierto.
        </p>

        <button type="button" className="boton" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
