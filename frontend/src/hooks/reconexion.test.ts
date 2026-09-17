import { describe, expect, it } from 'vitest';
import type { EstadoConexion } from '@app/shared';
import {
  AUSENCIA_SOSPECHOSA_MS,
  alDespertar,
  type Despertar,
  type MotivoDespertar,
} from './reconexion';

/**
 * Cuándo se tira la conexión y se abre otra, sin navegador.
 *
 * Lo que se vigila aquí es un fallo que no se puede reproducir escribiendo
 * pruebas de un WebSocket, porque consiste precisamente en que el WebSocket no
 * dice nada: el socket que Android mató mientras la pantalla estaba bloqueada
 * sigue contestando `OPEN`. La única defensa es la regla de cuándo desconfiar,
 * y eso es lo que se comprueba.
 */

const TODOS_LOS_MOTIVOS: MotivoDespertar[] = ['visible', 'red', 'nativo'];
const TODOS_LOS_ESTADOS: EstadoConexion[] = [
  'conectando',
  'conectado',
  'desconectado',
  'sin-permiso',
];

/** Despertar de una pantalla bloqueada media hora, con la conexión «viva». */
const TRAS_LA_NOCHE: Despertar = {
  motivo: 'visible',
  estado: 'conectado',
  ausenteMs: 30 * 60 * 1000,
};

describe('la pantalla que se bloquea', () => {
  it('tras un rato fuera se reconecta aunque el socket diga que está bien', () => {
    /*
      El caso entero. `readyState` sigue en `OPEN` porque nadie le dijo lo
      contrario al WebView congelado, así que fiarse del estado es fiarse de la
      única fuente que no puede saberlo.
    */
    expect(alDespertar(TRAS_LA_NOCHE).reconectar).toBe(true);
  });

  it('el aviso nativo vale igual que el del navegador', () => {
    /*
      Y hace falta: al bloquear la pantalla con la app delante, algunas
      versiones de Android no marcan el WebView como oculto, así que
      `visibilitychange` no llega nunca. Flutter sí se entera, y por eso hay
      puente.
    */
    expect(alDespertar({ ...TRAS_LA_NOCHE, motivo: 'nativo' }).reconectar).toBe(true);
  });

  it('un vistazo de tres segundos no tira la conexión', () => {
    /*
      La otra mitad del acierto. Reconectar en cada `visibilitychange` costaría
      un intercambio de estado completo y un parpadeo del indicador cada vez que
      alguien baja la persiana de notificaciones, que en un teléfono es muchas
      veces por minuto.
    */
    const vistazo = { ...TRAS_LA_NOCHE, ausenteMs: 3_000 };
    expect(alDespertar(vistazo).reconectar).toBe(false);
  });

  it('el umbral se cumple exactamente, sin quedarse a un milisegundo', () => {
    expect(alDespertar({ ...TRAS_LA_NOCHE, ausenteMs: AUSENCIA_SOSPECHOSA_MS }).reconectar).toBe(
      true,
    );
    expect(
      alDespertar({ ...TRAS_LA_NOCHE, ausenteMs: AUSENCIA_SOSPECHOSA_MS - 1 }).reconectar,
    ).toBe(false);
  });
});

describe('el salto de wifi a datos', () => {
  it('se reconecta sin esperar a ningún umbral de tiempo', () => {
    /*
      Es el caso en que el socket miente con seguridad y no por sospecha: la
      conexión TCP está atada a la dirección de origen, que acaba de cambiar.
      Medir la ausencia aquí no diría nada, porque la aplicación no estuvo
      ausente: el teléfono cambió de red con la pantalla encendida y el usuario
      mirando.
    */
    const sinAusencia: Despertar = { motivo: 'red', estado: 'conectado', ausenteMs: 0 };
    expect(alDespertar(sinAusencia).reconectar).toBe(true);
  });

  it('lo dice por la dirección, no por el tiempo', () => {
    // El motivo importa: es lo que se lee cuando alguien investiga por qué
    // hubo dos reconexiones seguidas.
    expect(alDespertar({ motivo: 'red', estado: 'conectado', ausenteMs: 0 }).porque).toMatch(
      /red|dirección/i,
    );
  });
});

describe('cuando ya se sabía caído', () => {
  it('se adelanta el reintento en vez de esperar la espera creciente', () => {
    /*
      La espera del proveedor llega a quince segundos y se cuenta desde la
      última caída. Quien desbloquea el teléfono no tiene por qué pagarlos:
      justo lo que hacía fallar la conexión —el metro, la pantalla apagada— es
      probablemente lo que acaba de dejar de aplicar.
    */
    for (const estado of ['desconectado', 'conectando'] as const) {
      for (const motivo of TODOS_LOS_MOTIVOS) {
        const decision = alDespertar({ motivo, estado, ausenteMs: 0 });
        expect(decision.reconectar, `«${motivo}» con el canal en «${estado}»`).toBe(true);
      }
    }
  });
});

describe('sin acceso al proyecto', () => {
  it('no se reintenta jamás, venga el despertar de donde venga', () => {
    /*
      Y lo caro de equivocarse aquí no es el bucle contra el servidor sino el
      mensaje: el indicador pasaría de «no tienes acceso a este proyecto»
      —cierto, y con algo que hacer al respecto— a un «conectando…» eterno que
      parece una avería de la aplicación.
    */
    for (const motivo of TODOS_LOS_MOTIVOS) {
      for (const ausenteMs of [0, AUSENCIA_SOSPECHOSA_MS, 60 * 60 * 1000]) {
        const decision = alDespertar({ motivo, estado: 'sin-permiso', ausenteMs });
        expect(decision.reconectar, `«${motivo}» tras ${String(ausenteMs)} ms`).toBe(false);
      }
    }
  });

  it('gana sobre el cambio de red, que es lo que más empuja a reconectar', () => {
    // El orden de las reglas importa y se comprueba, porque invertirlo no
    // rompería ninguna otra prueba de este fichero.
    expect(alDespertar({ motivo: 'red', estado: 'sin-permiso', ausenteMs: 0 }).reconectar).toBe(
      false,
    );
  });
});

describe('la decisión siempre se explica', () => {
  it('ningún estado posible se resuelve en silencio', () => {
    /*
      Recorrer la combinación entera es barato y cubre el caso que de verdad
      duele: que alguien añada un estado de conexión nuevo y esta función caiga
      por una rama que nadie escribió.
    */
    for (const motivo of TODOS_LOS_MOTIVOS) {
      for (const estado of TODOS_LOS_ESTADOS) {
        for (const ausenteMs of [0, 5_000, 10_000, 900_000]) {
          const decision = alDespertar({ motivo, estado, ausenteMs });
          expect(decision.porque, `${motivo}/${estado}/${String(ausenteMs)}`).not.toHaveLength(0);
          expect(typeof decision.reconectar).toBe('boolean');
        }
      }
    }
  });

  it('cuenta los segundos que estuvo fuera, que es el dato que se busca', () => {
    expect(alDespertar({ ...TRAS_LA_NOCHE, ausenteMs: 42_000 }).porque).toContain('42 s');
  });
});
