import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icono } from './iconos';
import { estadoInicial, moverEnMenu, type EstadoMenu, type MenuDesplegable } from './barra-menu';

/**
 * La barra de menú.
 *
 * Toda la lógica de teclado está en `barra-menu.ts` y probada aparte. Aquí queda
 * lo que necesita un DOM: mover el foco al sitio que dijo la lógica, cerrar al
 * pulsar fuera y pintar.
 *
 * El foco se mueve a mano, con `focus()`, en lugar de dejar que lo lleve el
 * tabulador. Un menú tiene una sola parada de tabulación —el rótulo activo—, y
 * dentro se recorre con las flechas. Si cada orden fuese tabulable, salir de la
 * barra costaría veinte pulsaciones y quien navega con teclado no volvería a
 * abrirla.
 */

export interface BarraMenuProps {
  menus: MenuDesplegable[];
  onComando: (id: string) => void;
  /** Escape con la barra cerrada: quien la use devuelve el foco al lienzo. */
  onSalir?: () => void;
}

export function BarraMenu({ menus, onComando, onSalir }: BarraMenuProps): JSX.Element {
  const [estado, setEstado] = useState<EstadoMenu>(estadoInicial);
  /*
    Hasta que alguien toca la barra, el foco no se mueve solo.

    Sin esta bandera, el efecto que coloca el foco se dispararía en el primer
    pintado y robaría el foco al lienzo nada más abrir el proyecto. Solo después
    de que el usuario haya entrado en la barra tiene sentido que el foco siga a
    la selección.
  */
  const [enUso, setEnUso] = useState(false);
  const rotulos = useRef<(HTMLButtonElement | null)[]>([]);
  const ordenes = useRef<(HTMLButtonElement | null)[]>([]);
  const contenedor = useRef<HTMLDivElement>(null);

  const menuAbierto = menus.find((m) => m.id === estado.abierto) ?? null;

  // Qué elemento debe tener el foco ahora mismo. Se compara como cadena para no
  // volver a llamar a `focus()` en cada repintado: hacerlo cancelaría la
  // selección de texto y haría saltar el desplazamiento en algunos navegadores.
  const destino =
    menuAbierto && estado.comando >= 0 ? `c:${estado.abierto ?? ''}:${String(estado.comando)}` : `r:${String(estado.menu)}`;
  const ultimoDestino = useRef<string | null>(null);

  useEffect(() => {
    if (!enUso) {
      ultimoDestino.current = null;
      return;
    }
    if (ultimoDestino.current === destino) return;
    ultimoDestino.current = destino;
    const elemento = destino.startsWith('c:')
      ? ordenes.current[estado.comando]
      : rotulos.current[estado.menu];
    elemento?.focus();
  }, [destino, enUso, estado.comando, estado.menu]);

  /*
    Pulsar fuera cierra. Se escucha `pointerdown` y no `click`: con `click` el
    menú sigue abierto durante el gesto y, si debajo hay una clase del lienzo, la
    pulsación que solo pretendía cerrar el menú también la selecciona.
  */
  useEffect(() => {
    if (estado.abierto === null) return undefined;
    const fuera = (evento: PointerEvent): void => {
      if (contenedor.current?.contains(evento.target as Node) === true) return;
      setEstado((actual) => ({ ...actual, abierto: null, comando: -1 }));
      setEnUso(false);
    };
    window.addEventListener('pointerdown', fuera);
    return () => {
      window.removeEventListener('pointerdown', fuera);
    };
  }, [estado.abierto]);

  const aplicar = useCallback(
    (tecla: string, evento: KeyboardEvent<HTMLElement>) => {
      const resultado = moverEnMenu(menus, estado, tecla);
      if (!resultado) return;
      evento.preventDefault();
      evento.stopPropagation();
      setEnUso(!resultado.salir);
      setEstado(resultado.estado);
      if (resultado.salir) {
        (evento.currentTarget as HTMLElement).blur();
        onSalir?.();
      }
      if (resultado.activar !== undefined) onComando(resultado.activar);
    },
    [estado, menus, onComando, onSalir],
  );

  const alPulsarRotulo = (indice: number, id: string): void => {
    setEnUso(true);
    setEstado((actual) =>
      actual.abierto === id
        ? { abierto: null, menu: indice, comando: -1 }
        : { abierto: id, menu: indice, comando: -1 },
    );
  };

  return (
    <div className="menu" ref={contenedor}>
      <div role="menubar" className="menu__barra" aria-label="Menú principal">
        {menus.map((menu, indice) => (
          <button
            key={menu.id}
            type="button"
            role="menuitem"
            ref={(nodo) => {
              rotulos.current[indice] = nodo;
            }}
            className={`menu__rotulo${estado.abierto === menu.id ? ' menu__rotulo--abierto' : ''}`}
            // Una sola parada de tabulación para toda la barra.
            tabIndex={indice === estado.menu ? 0 : -1}
            aria-haspopup="true"
            aria-expanded={estado.abierto === menu.id}
            onKeyDown={(evento) => {
              aplicar(evento.key, evento);
            }}
            onClick={() => {
              alPulsarRotulo(indice, menu.id);
            }}
            /*
              Con un menú ya desplegado, pasar el ratón por otro rótulo lo cambia
              sin pulsar. Es lo que hace un menú de escritorio y es la razón por
              la que se puede buscar una orden recorriendo la barra de un tirón.
              Sin ningún menú abierto no hace nada, para que rozar la cabecera no
              despliegue cosas por su cuenta.
            */
            onPointerEnter={() => {
              if (estado.abierto === null) return;
              setEstado({ abierto: menu.id, menu: indice, comando: -1 });
            }}
          >
            {menu.etiqueta}
          </button>
        ))}
      </div>

      {menuAbierto && (
        <div
          role="menu"
          className="menu__desplegable"
          aria-label={menuAbierto.etiqueta}
          style={{ left: `${String(rotulos.current[estado.menu]?.offsetLeft ?? 0)}px` }}
        >
          {menuAbierto.comandos.map((comando, indice) => (
            <div key={comando.id} className="menu__envoltura">
              {comando.separadorAntes === true && (
                // Decorativo: el hueco entre grupos ya lo dice todo a quien lo
                // ve, y anunciado como «separador» solo alarga el recorrido.
                <div className="menu__separador" role="none" />
              )}
              <button
                type="button"
                role={comando.marcado === undefined ? 'menuitem' : 'menuitemcheckbox'}
                ref={(nodo) => {
                  ordenes.current[indice] = nodo;
                }}
                className="menu__orden"
                tabIndex={-1}
                disabled={comando.deshabilitado}
                aria-checked={comando.marcado}
                onKeyDown={(evento) => {
                  aplicar(evento.key, evento);
                }}
                onPointerEnter={() => {
                  setEstado((actual) => ({ ...actual, comando: indice }));
                }}
                onClick={() => {
                  setEstado({ abierto: null, menu: estado.menu, comando: -1 });
                  setEnUso(false);
                  onComando(comando.id);
                }}
              >
                <span className="menu__icono">
                  {comando.icono ? <Icono nombre={comando.icono} /> : null}
                </span>
                <span className="menu__texto">{comando.etiqueta}</span>
                {/*
                  El atajo se escribe aquí y no en un `title`. Un menú es donde se
                  aprenden los atajos: se viene a buscar la orden con el ratón, se
                  lee «Ctrl+Z» al lado y la próxima vez ya no se abre el menú.
                */}
                <span className="menu__atajo">{comando.atajo ?? ''}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
