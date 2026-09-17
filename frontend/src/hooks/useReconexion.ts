import { useEffect, useRef } from 'react';
import type { CollabProvider } from '@app/shared';
import { alDespertar, type MotivoDespertar } from './reconexion';

/**
 * Volver a conectar cuando el teléfono vuelve en sí.
 *
 * Las reglas —cuándo merece la pena tirar el socket y cuándo no— están en
 * `reconexion.ts` y se prueban sin navegador. Aquí solo quedan las tres fuentes
 * de aviso y la aritmética de cuánto tiempo estuvo la aplicación parada, que es
 * lo que no se puede probar sin un navegador de verdad.
 *
 * ## Por qué tres fuentes y no una
 *
 * Ninguna las cubre todas:
 *
 * - `visibilitychange` es la buena en un navegador de escritorio y en Chrome de
 *   Android al cambiar de aplicación. Pero **no siempre llega al bloquear la
 *   pantalla**: hay versiones de Android en las que el WebView de una app en
 *   primer plano nunca se marca como oculto, y entonces el aviso no existe.
 * - `online` es la única que se entera del salto de wifi a datos con la
 *   pantalla encendida, que es el caso en que la aplicación no estuvo ausente
 *   ni un milisegundo y aun así la conexión murió.
 * - El puente nativo es el que tapa el agujero del primero. Flutter sí recibe
 *   `AppLifecycleState.paused` y `resumed` en todos los casos, incluido el
 *   bloqueo de pantalla, y además sabe **exactamente** cuánto duró la pausa.
 *
 * Que las tres se solapen no es un problema: `alDespertar` decide, y dos avisos
 * seguidos del mismo despertar dan la misma respuesta —la segunda con el canal
 * ya en «conectando», que también reconecta, pero sobre un socket recién
 * abierto y sin nada que perder—.
 */

/** El nombre que la carcasa Flutter usa para avisar. Contrato con `ciclo_de_vida.dart`. */
const RECEPTOR_NATIVO = '__cicloDeVida';

/**
 * Lo que el puente nativo entrega a la página.
 *
 * Se declara aquí y no en un `.d.ts` global porque el contrato es de dos
 * ficheros y conviene poder leerlos juntos: si alguien cambia el nombre en
 * Dart, esto sigue compilando y el síntoma es que la reconexión deja de
 * ocurrir en el caso que solo el puente cubre. No hay compilador que lo
 * impida, así que al menos que esté escrito al lado.
 */
interface VentanaConPuente {
  [RECEPTOR_NATIVO]?: (pausaMs: number) => void;
}

export function useReconexion(proveedor: CollabProvider | null): void {
  /*
    Cuándo se fue. `null` mientras la aplicación está a la vista.

    Es una `ref` y no un estado porque cambiarlo no tiene que repintar nada, y
    porque un estado aquí recrearía el efecto en cada ida y venida, que es
    justamente cuando no se pueden perder las escuchas.
  */
  const desde = useRef<number | null>(null);

  useEffect(() => {
    if (!proveedor) return;

    const despertar = (motivo: MotivoDespertar, ausenteMs: number): void => {
      if (alDespertar({ motivo, estado: proveedor.estado, ausenteMs }).reconectar) {
        proveedor.reconectarYa();
      }
    };

    const alCambiarVisibilidad = (): void => {
      if (document.visibilityState === 'hidden') {
        desde.current = Date.now();
        return;
      }
      /*
        Sin marca de salida no se supone una ausencia larga: la primera
        `visibilitychange` de la vida de la página puede ser un «visible» suelto
        —al restaurar desde la caché de atrás/adelante, por ejemplo— y tratarlo
        como media hora fuera tiraría una conexión recién hecha.
      */
      const ausenteMs = desde.current === null ? 0 : Date.now() - desde.current;
      desde.current = null;
      despertar('visible', ausenteMs);
    };

    /*
      Flutter manda la pausa medida por él, que es el dato bueno: sabe cuándo
      llegó `paused` aunque el WebView no se enterase de nada. Se valida el tipo
      igual que en el puente de voz, porque esto entra desde fuera del
      TypeScript y un `undefined` aquí haría `NaN >= 10000`, que es `false` —o
      sea, no reconectar justo en el caso que este puente existe para cubrir—.
      */
    const alVolverNativo = (pausaMs: number): void => {
      despertar('nativo', typeof pausaMs === 'number' && pausaMs > 0 ? pausaMs : 0);
    };

    const alRecuperarRed = (): void => {
      despertar('red', 0);
    };

    document.addEventListener('visibilitychange', alCambiarVisibilidad);
    window.addEventListener('online', alRecuperarRed);
    (window as unknown as VentanaConPuente)[RECEPTOR_NATIVO] = alVolverNativo;

    return () => {
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
      window.removeEventListener('online', alRecuperarRed);
      // Se borra el receptor al salir del diagrama. Dejarlo puesto haría que un
      // «volví del segundo plano» resucitase la conexión de un proyecto
      // cerrado, contra un proveedor ya destruido.
      delete (window as unknown as VentanaConPuente)[RECEPTOR_NATIVO];
    };
  }, [proveedor]);
}
