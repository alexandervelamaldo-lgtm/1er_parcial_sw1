import { useEffect, useMemo, useState } from 'react';
import type { CollabProvider } from '@app/shared';

/**
 * Quién más está mirando este diagrama y dónde tiene el ratón (RF-COL-04).
 *
 * La presencia va por un canal distinto del documento y esa separación es
 * intencionada: un cursor moviéndose genera decenas de mensajes por segundo y
 * ninguno de ellos merece guardarse en disco, formar parte del historial ni
 * poder deshacerse. Yjs lo llama «awareness»; es estado efímero, atado a la
 * conexión, y desaparece solo cuando alguien cierra la pestaña.
 */

export interface Participante {
  clientId: number;
  nombre: string;
  color: string;
  cursor: { x: number; y: number } | null;
  /** Clase que tiene seleccionada, para resaltarla con su color. */
  seleccion: string | null;
}

/**
 * Colores de participante.
 *
 * Se eligen de una lista fija en vez de generarse al azar para que sean
 * distinguibles entre sí y legibles sobre el lienzo oscuro; un color aleatorio
 * acaba dando dos azules casi iguales o algo ilegible.
 */
const COLORES = [
  '#5b9cff',
  '#ff8a5b',
  '#4ecb8f',
  '#e15bff',
  '#ffd24a',
  '#ff5b7f',
  '#5bd8ff',
  '#b28dff',
];

/** Color estable para un cliente: el mismo mientras dure su conexión. */
export function colorDe(clientId: number): string {
  return COLORES[clientId % COLORES.length] ?? COLORES[0]!;
}

interface EstadoLocal {
  usuario?: { nombre: string; color: string };
  cursor?: { x: number; y: number } | null;
  seleccion?: string | null;
}

export function usePresencia(
  provider: CollabProvider | null,
  yo: { nombre: string } | null,
): { participantes: Participante[]; anunciar: (parcial: EstadoLocal) => void } {
  const [participantes, setParticipantes] = useState<Participante[]>([]);

  // Anunciarse: nombre y color propios.
  useEffect(() => {
    if (!provider || !yo) return;
    provider.awareness.setLocalStateField('usuario', {
      nombre: yo.nombre,
      color: colorDe(provider.doc.clientID),
    });
  }, [provider, yo]);

  // Escuchar a los demás.
  useEffect(() => {
    if (!provider) {
      setParticipantes([]);
      return;
    }

    const { awareness } = provider;
    const propio = provider.doc.clientID;

    const recalcular = (): void => {
      const otros: Participante[] = [];
      for (const [clientId, estado] of awareness.getStates()) {
        // El estado propio se excluye: uno no necesita ver su propio cursor
        // duplicado sobre el suyo real, con un retraso de ida y vuelta.
        if (clientId === propio) continue;
        const e = estado as EstadoLocal;
        if (!e.usuario) continue;
        otros.push({
          clientId,
          nombre: e.usuario.nombre,
          color: e.usuario.color || colorDe(clientId),
          cursor: e.cursor ?? null,
          seleccion: e.seleccion ?? null,
        });
      }
      otros.sort((a, b) => a.clientId - b.clientId);
      setParticipantes(otros);
    };

    awareness.on('change', recalcular);
    recalcular();
    return () => awareness.off('change', recalcular);
  }, [provider]);

  const anunciar = useMemo(() => {
    if (!provider) return (): void => {};
    return (parcial: EstadoLocal): void => {
      for (const [clave, valor] of Object.entries(parcial)) {
        provider.awareness.setLocalStateField(clave, valor);
      }
    };
  }, [provider]);

  return { participantes, anunciar };
}
