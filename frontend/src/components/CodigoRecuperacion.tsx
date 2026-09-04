import { useState } from 'react';
import { Icono } from './iconos';

/**
 * Enseña un código de recuperación recién emitido.
 *
 * Se usa en dos sitios —al crear la cuenta y al pedir uno nuevo desde dentro—,
 * y en los dos el código aparece una única vez: el servidor guarda solo su hash
 * y no puede devolverlo aunque se lo pidan. De ahí la casilla: no es burocracia,
 * es el único momento en que copiarlo todavía es posible.
 */
export function CodigoRecuperacion({
  codigo,
  alConfirmar,
  textoConfirmar,
}: {
  codigo: string;
  alConfirmar: () => void;
  textoConfirmar: string;
}): JSX.Element {
  const [guardado, setGuardado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  // `navigator.clipboard` no existe fuera de un contexto seguro. Servido por
  // `localhost` lo hay, pero abriendo la aplicación por la IP de la red local
  // —que es como se prueba entre varios ordenadores— no, y ahí el botón sería
  // uno que no hace nada. Se comprueba en vez de suponerlo.
  const hayPortapapeles = typeof navigator !== 'undefined' && Boolean(navigator.clipboard);

  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      // Un fallo al copiar no es un problema que haya que resolver aquí: el
      // código sigue en pantalla y se puede seleccionar a mano.
      setCopiado(false);
    }
  };

  return (
    <div className="codigo-recuperacion">
      <p className="aviso aviso--fuerte" role="status">
        Conserve este código. Es el único medio de acceso si se olvida la contraseña, y no se puede
        volver a consultar: aquí solo se guarda cifrado.
      </p>

      <code className="codigo-recuperacion__valor">{codigo}</code>

      {hayPortapapeles && (
        <button type="button" className="boton" onClick={() => void copiar()}>
          {copiado && <Icono nombre="comprobado" />}
          {copiado ? 'Copiado' : 'Copiar el código'}
        </button>
      )}

      <p className="codigo-recuperacion__consejo">
        Anótelo en papel o guárdelo en un gestor de contraseñas. El portapapeles del teléfono no
        sirve como copia: se vacía.
      </p>

      <label className="codigo-recuperacion__casilla">
        <input
          type="checkbox"
          checked={guardado}
          onChange={(e) => setGuardado(e.target.checked)}
        />
        <span>Lo he guardado en un sitio del que no se va a borrar</span>
      </label>

      <button
        type="button"
        className="boton boton--primario"
        disabled={!guardado}
        onClick={alConfirmar}
      >
        {textoConfirmar}
      </button>
    </div>
  );
}
