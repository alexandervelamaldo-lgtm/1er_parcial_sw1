import { useCallback, useEffect, useState } from 'react';

/**
 * Claro u oscuro.
 *
 * La aplicación nació solo oscura porque se dibuja un diagrama y el contraste
 * cansa menos. Pero el diagrama acaba proyectado en un aula: en un cañón con
 * poca luz, el fondo oscuro se come las líneas finas y las cajas se vuelven
 * manchas. El tema claro existe para eso, no como preferencia estética.
 *
 * Se guarda la elección, no se adivina. `prefers-color-scheme` diría qué tiene
 * puesto el sistema operativo, que no es la pregunta: quien proyecta quiere el
 * tema claro un rato y el suyo de vuelta después.
 */

export type Tema = 'oscuro' | 'claro';

const CLAVE = 'tema:v1';

function leerGuardado(): Tema {
  try {
    return window.localStorage.getItem(CLAVE) === 'claro' ? 'claro' : 'oscuro';
  } catch {
    return 'oscuro';
  }
}

export function useTema(): { tema: Tema; alternar: () => void } {
  const [tema, setTema] = useState<Tema>(() =>
    typeof window === 'undefined' ? 'oscuro' : leerGuardado(),
  );

  useEffect(() => {
    const raiz = document.documentElement;
    raiz.dataset['tema'] = tema;
    // Sin esto, los controles que pinta el navegador —barras de scroll, menús
    // desplegables, el calendario de un campo de fecha— se quedan en oscuro
    // sobre el fondo claro. `color-scheme` es lo único que los alcanza.
    raiz.style.colorScheme = tema === 'claro' ? 'light' : 'dark';
    try {
      window.localStorage.setItem(CLAVE, tema);
    } catch {
      /* Sin sitio o sin permiso: el tema vale para esta sesión. */
    }
  }, [tema]);

  const alternar = useCallback(() => {
    setTema((actual) => (actual === 'oscuro' ? 'claro' : 'oscuro'));
  }, []);

  return { tema, alternar };
}
