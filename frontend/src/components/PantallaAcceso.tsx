import { useState } from 'react';
import { useSesion } from '../services/sesion';

/**
 * Acceso y registro (RF-COL-01).
 *
 * Los dos van en la misma pantalla con un interruptor porque son el mismo
 * formulario más un campo, y separarlos obliga a navegar para descubrir que uno
 * estaba en el sitio equivocado.
 */
export function PantallaAcceso(): JSX.Element {
  const { acceder, registrar, aviso } = useSesion();
  const [modo, setModo] = useState<'acceso' | 'registro'>('acceso');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      if (modo === 'acceso') await acceder(email, password);
      else await registrar(email, password, nombre || email.split('@')[0] || 'Usuario');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo iniciar sesión');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="acceso">
      <form className="acceso__tarjeta" onSubmit={(e) => void enviar(e)}>
        <h1>Diagramas UML colaborativos</h1>
        <p className="acceso__lema">
          Diseña el modelo entre varios y descarga el backend Spring Boot.
        </p>

        {aviso && (
          <p className="aviso aviso--sesion" role="status">
            {aviso}
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

        <label className="campo">
          <span>Contraseña</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={modo === 'acceso' ? 'current-password' : 'new-password'}
          />
        </label>

        {error && <p className="panel__error">{error}</p>}

        <button type="submit" className="boton boton--primario" disabled={enviando}>
          {enviando ? 'Un momento…' : modo === 'acceso' ? 'Entrar' : 'Crear cuenta'}
        </button>

        <button
          type="button"
          className="boton boton--enlace"
          onClick={() => {
            setModo(modo === 'acceso' ? 'registro' : 'acceso');
            setError(null);
          }}
        >
          {modo === 'acceso' ? '¿No tienes cuenta? Crea una' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  );
}
