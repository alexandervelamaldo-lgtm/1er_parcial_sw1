/* eslint-env serviceworker */

/**
 * Service worker: arranque sin conexión (RF-OFF-01).
 *
 * Lo que cachea es solo el armazón de la aplicación —HTML, JavaScript, CSS,
 * iconos—. El diagrama NO se cachea aquí: vive en IndexedDB a través de Yjs,
 * porque una respuesta HTTP guardada es una foto de un instante y lo que hace
 * falta es un documento que se pueda seguir editando y luego fusionar. Confundir
 * las dos cosas es lo que produce aplicaciones que «funcionan offline» pero
 * pierden lo escrito al reconectar.
 *
 * Las peticiones a la API nunca se sirven de la caché. Devolver una lista de
 * proyectos de hace tres días como si fuera actual es peor que un error: el
 * usuario no tiene forma de notarlo.
 */

const VERSION = 'v1';
const CACHE_ARMAZON = `armazon-${VERSION}`;

const ESENCIALES = ['/', '/index.html', '/manifest.webmanifest', '/icono.svg'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE_ARMAZON)
      .then((cache) => cache.addAll(ESENCIALES))
      // `skipWaiting` evita que una versión nueva se quede esperando a que se
      // cierren todas las pestañas: con una aplicación que se tiene abierta
      // durante horas, esa espera puede durar días.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) =>
        Promise.all(claves.filter((c) => c !== CACHE_ARMAZON).map((c) => caches.delete(c))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);
  if (url.origin !== self.location.origin) return;
  // La API y el canal colaborativo van siempre a la red. Un dato del servidor
  // servido desde la caché sería un dato viejo presentado como actual.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/colaboracion')) return;

  // Navegación: se intenta la red y se cae al armazón guardado. Así una URL de
  // proyecto abierta sin conexión carga la aplicación, que a su vez encuentra el
  // diagrama en IndexedDB.
  if (peticion.mode === 'navigate') {
    evento.respondWith(
      fetch(peticion).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }

  evento.respondWith(
    caches.match(peticion).then((cacheada) => {
      if (cacheada) return cacheada;
      return fetch(peticion).then((respuesta) => {
        // Solo se guardan las respuestas completas y correctas: una respuesta
        // parcial (206) o un error cacheado se serviría luego como si fuera
        // buena y rompería la aplicación hasta borrar la caché a mano.
        if (respuesta.ok && respuesta.status === 200) {
          const copia = respuesta.clone();
          void caches.open(CACHE_ARMAZON).then((cache) => cache.put(peticion, copia));
        }
        return respuesta;
      });
    }),
  );
});
