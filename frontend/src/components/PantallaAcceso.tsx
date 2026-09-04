import { useState } from 'react';
import { useSesion, type RegistroPendiente } from '../services/sesion';
import { CodigoRecuperacion } from './CodigoRecuperacion';

/**
 * Acceso, registro y recuperación (RF-COL-01).
 *
 * Los tres van en la misma pantalla con un interruptor porque son el mismo
 * formulario cambiando un campo, y separarlos obliga a navegar para descubrir
 * que uno estaba en el sitio equivocado.
 *
 * La recuperación pide un código en lugar de mandar un enlace por correo. El
 * motivo está en `backend-tool/src/auth/identity.ts`: no hay servidor de correo,
 * y montarlo dejaría la recuperación sin funcionar justo en el escenario para el
 * que está pensado el resto del sistema, que es sin conexión a internet.
 */

type Modo = 'acceso' | 'registro' | 'recuperar';

const TITULO_BOTON: Record<Modo, string> = {
  acceso: 'Entrar',
  registro: 'Crear cuenta',
  recuperar: 'Cambiar la contraseña',
};

export function PantallaAcceso(): JSX.Element {
  const { acceder, registrar, recuperar, aviso } = useSesion();
  const [modo, setModo] = useState<Modo>('acceso');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pendiente, setPendiente] = useState<RegistroPendiente | null>(null);

  const cambiarA = (siguiente: Modo): void => {
    setModo(siguiente);
    setError(null);
  };

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      if (modo === 'acceso') await acceder(email, password);
      else if (modo === 'recuperar') await recuperar(email, codigo, password);
      else setPendiente(await registrar(email, password, nombre || email.split('@')[0] || 'Usuario'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  };

  // La cuenta ya existe y la sesión está a un clic; falta que se lleve el código.
  if (pendiente) {
    return (
      <div className="acceso">
        <div className="acceso__tarjeta">
          <h1>Cuenta creada</h1>
          <CodigoRecuperacion
            codigo={pendiente.codigoRecuperacion}
            alConfirmar={pendiente.entrar}
            textoConfirmar="Ya lo he guardado, entrar"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="acceso">
      <form className="acceso__tarjeta" onSubmit={(e) => void enviar(e)}>
        <h1>Diagramas UML colaborativos</h1>
        {/* Lo que hace la herramienta, no lo que se anima a hacer a quien entra.
            «Diseña el modelo entre varios» es el eslogan de una página de
            producto; en la pantalla de acceso de una herramienta interna sobra
            el imperativo, porque quien está aquí ya ha decidido entrar. */}
        <p className="acceso__lema">
          Modelado UML colaborativo con generación de backend Spring Boot.
        </p>

        {aviso && (
          <p className="aviso aviso--sesion" role="status">
            {aviso}
          </p>
        )}

        {modo === 'recuperar' && (
          <p className="acceso__explicacion">
            Introduzca el correo y el código de recuperación emitido al crear la cuenta. Si no se
            conserva, la administración del servidor puede emitir uno nuevo.
          </p>
        )}

        {modo === 'registro' && (
          <label className="campo">
            <span>Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoComplete="name" />
          </label>
        )}

        <label className="campo">
          <span>Correo</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </label>

        {modo === 'recuperar' && (
          <label className="campo">
            <span>Código de recuperación</span>
            <input
              required
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              // Sin corrector ni mayúscula automática: el código no es una
              // palabra, y en el móvil el teclado lo «arreglaría» solo.
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className="campo__codigo"
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            />
          </label>
        )}

        <label className="campo">
          <span>{modo === 'recuperar' ? 'Contraseña nueva' : 'Contraseña'}</span>
          <input
            type="password"
            required
            // Diez, que es lo que exige `validarRegistro` en el servidor. Con
            // ocho, el navegador dejaba enviar y el servidor rechazaba: el peor
            // de los dos mundos, porque el aviso llegaba tarde y en otro sitio.
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={modo === 'acceso' ? 'current-password' : 'new-password'}
          />
        </label>

        {error && <p className="panel__error">{error}</p>}

        <button type="submit" className="boton boton--primario" disabled={enviando}>
          {enviando ? 'Un momento…' : TITULO_BOTON[modo]}
        </button>

        {modo === 'acceso' ? (
          <>
            <button
              type="button"
              className="boton boton--enlace"
              onClick={() => cambiarA('registro')}
            >
              Crear una cuenta
            </button>
            <button
              type="button"
              className="boton boton--enlace"
              onClick={() => cambiarA('recuperar')}
            >
              Recuperar el acceso
            </button>
          </>
        ) : (
          <button type="button" className="boton boton--enlace" onClick={() => cambiarA('acceso')}>
            Ya tengo cuenta
          </button>
        )}
      </form>
    </div>
  );
}
