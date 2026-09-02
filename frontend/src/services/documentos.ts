/**
 * El manual, empaquetado dentro de la aplicación.
 *
 * `import.meta.glob` con `?raw` y `eager` mete el texto de `docs/` en el paquete
 * de JavaScript en tiempo de compilación. No es una petición HTTP: cuando el
 * navegador ha cargado la aplicación, ya tiene el manual entero, y la ayuda
 * responde igual en un avión que en la facultad. Ese es todo el motivo de
 * hacerlo así y no con un `fetch('/docs/…')`, que dejaría la ayuda sin conexión
 * dependiendo de que el service worker hubiera cacheado siete ficheros más.
 *
 * El coste es que el paquete crece con el manual (unos 190 kB de Markdown, que
 * comprimidos son bastante menos). Se acepta a sabiendas: es lo que se paga por
 * que la función que existe para funcionar sin red no dependa de la red.
 *
 * El índice se construye una sola vez y de forma perezosa. Recorrer doscientos
 * fragmentos en cada pulsación de tecla es exactamente lo que haría que la caja
 * de búsqueda se sintiera lenta en un móvil.
 */

import { construirCorpus, indexar, type Documento, type Indice } from '@app/shared';

const CRUDOS = import.meta.glob('../../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/**
 * El nombre legible de un documento: su primer encabezado `#`.
 *
 * Se saca del propio fichero en lugar de mantener aquí una tabla de nombres.
 * Una tabla es una segunda copia del título que se queda desfasada en cuanto
 * alguien renombra una sección, y entonces la guía cita un documento que ya no
 * se llama así.
 */
function nombreDe(ruta: string, markdown: string): string {
  const titulo = /^#\s+(.+)$/m.exec(markdown);
  if (titulo?.[1] !== undefined) return titulo[1].trim();
  return (ruta.split('/').pop() ?? ruta).replace(/^\d+-/, '').replace(/\.md$/, '');
}

/** Los documentos del manual, en el orden en que están numerados. */
export function documentos(): Documento[] {
  return Object.entries(CRUDOS)
    .map(([ruta, markdown]) => ({
      nombre: nombreDe(ruta, markdown),
      // La ruta relativa al repositorio, que es la que sirve para enlazar.
      ruta: `docs/${ruta.split('/').pop() ?? ruta}`,
      markdown,
    }))
    .sort((a, b) => a.ruta.localeCompare(b.ruta));
}

let cache: Indice | null = null;

/** El índice de búsqueda, construido la primera vez que hace falta. */
export function indiceDeLaGuia(): Indice {
  cache ??= indexar(construirCorpus(documentos()));
  return cache;
}
