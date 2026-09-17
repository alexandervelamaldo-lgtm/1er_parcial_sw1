import { useEffect, useState } from 'react';
import type { Pantalla } from '../components/movil-reparto';

/**
 * Cuánto sitio hay, ahora mismo.
 *
 * Existe porque para la interfaz de móvil **no basta con `window.innerHeight`**, y
 * la diferencia es justo la que produce el fallo más clásico del formulario en un
 * teléfono:
 *
 * - `window.innerHeight` es el hueco del navegador, y **no cambia** cuando se abre
 *   el teclado. El teclado se pinta encima.
 * - `visualViewport.height` es lo que de verdad se ve. Al abrirse el teclado baja
 *   varios cientos de píxeles.
 *
 * Una hoja anclada al fondo de `innerHeight` se queda **debajo del teclado**, con
 * el campo que se está rellenando dentro. Por eso se siguen las dos medidas: el
 * reparto de la pantalla necesita saber las dos cosas, y quién decide qué hacer
 * con ellas es `movil-reparto.ts` y `movil-hoja.ts`, que no tocan el DOM y por eso
 * están probados.
 *
 * `visualViewport` existe en todos los navegadores que nos importan —incluido el
 * WebView de Android— pero se comprueba antes de usarlo: en Node, donde corren las
 * pruebas, no hay ni `window`.
 */
export function usePantalla(): Pantalla {
  const [pantalla, setPantalla] = useState<Pantalla>(() => medir());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const alCambiar = (): void => setPantalla(medir());
    // Se mide otra vez al suscribirse: entre el primer render y este efecto la
    // ventana puede haber cambiado, y ese hueco es donde se cuelan los fallos que
    // solo pasan «a veces al abrir».
    alCambiar();

    window.addEventListener('resize', alCambiar);
    window.addEventListener('orientationchange', alCambiar);
    const vv = window.visualViewport;
    // `scroll` además de `resize`: en iOS el teclado no siempre cambia el alto del
    // viewport visual, a veces lo desplaza. Sin escuchar los dos, la hoja se queda
    // donde estaba mientras el campo se va debajo del teclado.
    vv?.addEventListener('resize', alCambiar);
    vv?.addEventListener('scroll', alCambiar);

    return () => {
      window.removeEventListener('resize', alCambiar);
      window.removeEventListener('orientationchange', alCambiar);
      vv?.removeEventListener('resize', alCambiar);
      vv?.removeEventListener('scroll', alCambiar);
    };
  }, []);

  return pantalla;
}

function medir(): Pantalla {
  if (typeof window === 'undefined') {
    // Un tamaño cualquiera con forma de teléfono. No se usa en el navegador; está
    // para que importar este módulo desde una prueba no reviente.
    return { ancho: 390, alto: 844, altoVisible: 844 };
  }
  const alto = window.innerHeight;
  return {
    ancho: window.visualViewport?.width ?? window.innerWidth,
    alto,
    // Si no hay `visualViewport`, lo visible es todo: es la respuesta prudente
    // —equivale a «no hay teclado»— y deja la interfaz como estaba antes en vez
    // de encogerla por una medida que no tenemos.
    altoVisible: window.visualViewport?.height ?? alto,
  };
}
