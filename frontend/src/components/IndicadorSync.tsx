import type { EstadoConexion } from '@app/shared';
import type { Participante } from '../hooks/usePresencia';

/**
 * Estado del canal, siempre visible (RF-OFF-05).
 *
 * En una aplicación que sigue funcionando sin conexión, el usuario pierde la
 * señal más obvia de que algo va mal: la aplicación no se rompe. Por eso el
 * estado se muestra siempre y en palabras, no con un punto de color que hay que
 * aprenderse. Lo importante que debe transmitir cada texto es si lo que está
 * escribiendo se está guardando en algún sitio y si los demás lo ven.
 */

const TEXTOS: Record<EstadoConexion, { etiqueta: string; explicacion: string; clase: string }> = {
  conectando: {
    etiqueta: 'Conectando…',
    explicacion: 'Buscando el servidor. Puedes seguir editando.',
    clase: 'indicador--esperando',
  },
  conectado: {
    etiqueta: 'En directo',
    explicacion: 'Tus cambios se ven al momento y se guardan en el servidor.',
    clase: 'indicador--bien',
  },
  desconectado: {
    etiqueta: 'Sin conexión',
    explicacion:
      'Se guarda todo en este dispositivo y se enviará solo en cuanto vuelva la conexión.',
    clase: 'indicador--offline',
  },
  'sin-permiso': {
    etiqueta: 'Sin acceso',
    explicacion: 'Ya no tienes permiso sobre este proyecto.',
    clase: 'indicador--error',
  },
};

export function IndicadorSync({
  estado,
  detalle,
  sincronizado,
  participantes,
}: {
  estado: EstadoConexion;
  detalle: string | undefined;
  sincronizado: boolean;
  participantes: Participante[];
}): JSX.Element {
  const texto = TEXTOS[estado];
  // Conectado pero sin haber recibido todavía el documento es un estado real y
  // dura lo justo para que se note en un diagrama grande. Decir «en directo»
  // ahí sería afirmar que se está viendo lo último, que es justo lo que aún no.
  const etiqueta = estado === 'conectado' && !sincronizado ? 'Poniéndose al día…' : texto.etiqueta;

  return (
    <div className="indicador-grupo">
      <span className={`indicador ${texto.clase}`} title={detalle ?? texto.explicacion}>
        <span className="indicador__punto" />
        {etiqueta}
      </span>

      {participantes.length > 0 && (
        <span className="presentes" title={participantes.map((p) => p.nombre).join(', ')}>
          {participantes.map((p) => (
            <span
              key={p.clientId}
              className="presentes__ficha"
              style={{ background: p.color }}
              title={p.nombre}
            >
              {p.nombre.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
