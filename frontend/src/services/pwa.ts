/**
 * Registro del service worker (RF-OFF-01).
 *
 * Solo en producción. En desarrollo un service worker sirve la versión cacheada
 * del código y entonces los cambios no se ven al recargar, que es una hora de
 * depuración por delante buscando un fallo que no existe.
 */
export function registrarServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      // Que falle no impide usar la aplicación: solo se pierde el arranque sin
      // conexión. Se avisa por consola y se sigue.
      console.warn('No se pudo registrar el service worker:', error);
    });
  });
}
