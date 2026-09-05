import { useEffect, useRef, useState } from 'react';
import type { FilaPanel, Usuario } from '../services/api';
import { Icono } from './iconos';
import { iniciales, resumirCuenta } from './menu-cuenta';

/**
 * Las acciones de la cuenta, recogidas en un solo sitio.
 *
 * La barra de proyectos venía acumulando botones sueltos —el nombre, el código
 * de recuperación, salir— y el informe añadía uno más. Cuatro cosas en fila, de
 * las cuales tres se usan una vez cada varias semanas, empujan a la derecha lo
 * único que se mira siempre, que es de quién es la sesión abierta.
 *
 * De la maqueta se toma el gesto: un disparador con la identidad y un panel que
 * cuelga. No se toman sus cuatro campos —foto, cargo, «Credencial IAM», «Código
 * Empleado»—; el porqué está en `menu-cuenta.ts`, y en resumen es que ninguno
 * existe en `Usuario` y que fingir un control de accesos corporativo en la
 * esquina de la pantalla es peor que no enseñar nada.
 */

interface Props {
  usuario: Usuario | null;
  filas: FilaPanel[];
  onCodigoRecuperacion: () => void;
  onInforme: () => void;
  onSalir: () => void;
}

export function MenuCuenta({ usuario, filas, onCodigoRecuperacion, onInforme, onSalir }: Props) {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const disparador = useRef<HTMLButtonElement>(null);

  /*
    Pulsar fuera cierra. Se escucha `pointerdown` y no `click`, por lo mismo que
    en `BarraMenu`: con `click` el menú sigue abierto durante el gesto, y la
    pulsación que solo pretendía cerrarlo también activa lo que haya debajo.
  */
  useEffect(() => {
    if (!abierto) return;
    const fuera = (evento: PointerEvent) => {
      if (contenedor.current?.contains(evento.target as Node) === true) return;
      setAbierto(false);
    };
    window.addEventListener('pointerdown', fuera);
    return () => {
      window.removeEventListener('pointerdown', fuera);
    };
  }, [abierto]);

  /*
    Escape cierra y devuelve el foco al disparador. Sin lo segundo, el foco se
    queda en un botón que acaba de desaparecer del árbol y el navegador lo manda
    al principio del documento: quien navega con teclado tendría que recorrer la
    barra entera para volver a donde estaba.
  */
  useEffect(() => {
    if (!abierto) return;
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.stopPropagation();
      setAbierto(false);
      disparador.current?.focus();
    };
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  if (!usuario) return null;

  const cuenta = resumirCuenta(filas);
  const nombre = usuario.displayName.trim() === '' ? usuario.email : usuario.displayName;

  const ejecutar = (accion: () => void) => {
    setAbierto(false);
    accion();
  };

  return (
    <div className="cuenta" ref={contenedor}>
      <button
        type="button"
        ref={disparador}
        className="cuenta__disparador"
        aria-haspopup="menu"
        aria-expanded={abierto}
        onClick={() => setAbierto(!abierto)}
      >
        {/*
          Las iniciales, no una foto remota: esta aplicación tiene que funcionar
          sin conexión, y una `<img>` a un servidor de avatares es justo un
          icono roto en el escenario que el proyecto promete soportar.
          `aria-hidden` porque el nombre va escrito al lado y un lector de
          pantalla que dicte «AR Alexander Rojas» solo repite.
        */}
        <span className="cuenta__iniciales" aria-hidden="true">
          {iniciales(usuario)}
        </span>
        <span className="cuenta__nombre">{nombre}</span>
        <Icono nombre={abierto ? 'plegar' : 'desplegar'} />
      </button>

      {abierto && (
        <div role="menu" className="menu__desplegable cuenta__panel" aria-label="Cuenta">
          <div className="cuenta__ficha">
            <p className="cuenta__ficha-nombre">{nombre}</p>
            <p className="cuenta__ficha-correo">{usuario.email}</p>
          </div>

          {/*
            El único dato de permisos que este sistema conoce: el rol por
            proyecto. Se enseñan solo los recuentos que no son cero, porque una
            lista con «Invitado como editor: 0» ocupa una línea para decir que
            no hay nada que decir.
          */}
          <ul className="cuenta__roles">
            <li>
              <span>Proyectos propios</span>
              <span className="cuenta__roles-cuenta">{cuenta.propios}</span>
            </li>
            {cuenta.editor > 0 && (
              <li>
                <span>Invitado como editor</span>
                <span className="cuenta__roles-cuenta">{cuenta.editor}</span>
              </li>
            )}
            {cuenta.lector > 0 && (
              <li>
                <span>Invitado como lector</span>
                <span className="cuenta__roles-cuenta">{cuenta.lector}</span>
              </li>
            )}
          </ul>

          <div className="menu__separador" />

          {filas.length > 0 && (
            <button
              type="button"
              role="menuitem"
              className="menu__orden"
              onClick={() => ejecutar(onInforme)}
            >
              <span className="menu__icono">
                <Icono nombre="exportar" />
              </span>
              <span className="menu__texto">Informe de estado</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className="menu__orden"
            onClick={() => ejecutar(onCodigoRecuperacion)}
          >
            <span className="menu__icono">
              <Icono nombre="llave" />
            </span>
            <span className="menu__texto">Código de recuperación</span>
          </button>

          <div className="menu__separador" />

          <button
            type="button"
            role="menuitem"
            className="menu__orden cuenta__salir"
            onClick={() => ejecutar(onSalir)}
          >
            <span className="menu__icono">
              <Icono nombre="atras" />
            </span>
            <span className="menu__texto">Cerrar la sesión</span>
          </button>
        </div>
      )}
    </div>
  );
}
