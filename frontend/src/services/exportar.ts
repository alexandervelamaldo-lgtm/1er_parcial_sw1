import { diagramaAXmi, type ClassDiagram } from '@app/shared';
import { avisoDeDescarga, descargar, nombreDeFichero } from './descarga';

/**
 * Sacar el diagrama como XMI (RF-DIAG-12).
 *
 * Son cuatro llamadas seguidas y aun así vive aquí en vez de en cada pantalla,
 * porque desde que hay dos —el editor de escritorio y el de móvil— cada copia es
 * una oportunidad de que una de las dos se quede con la versión vieja. Y las
 * cuatro llamadas no son intercambiables ni son adorno:
 *
 * - `diagramaAXmi` trabaja con el diagrama que ya está en memoria, así que esto
 *   **funciona sin conexión**. Es la diferencia con generar el backend, que lo
 *   compila el servidor, y la que hace que el cajón del móvil apague una cosa y no
 *   la otra cuando no hay red.
 * - `nombreDeFichero` se queda con lo que es seguro en cualquier sistema: el
 *   nombre del proyecto lo escribe una persona y acaba siendo un nombre de
 *   fichero.
 * - `application/xml` y no `text/xml`, para que el navegador lo descargue en vez
 *   de intentar pintarlo en una pestaña.
 * - `descargar` es el puente: en el navegador es un `<a download>` y dentro de la
 *   app Android pasa los bytes a la parte nativa. Aquí estuvo el peor fallo
 *   posible —el enlace no hacía nada en el móvil y aun así se anunciaba «Diagrama
 *   exportado»—, y de ahí que el aviso lo construya `avisoDeDescarga` con el sitio
 *   donde el fichero quedó de verdad.
 *
 * Devuelve la frase para el aviso y **lanza** si algo falla, para que quien llama
 * no pueda confundir «se exportó» con «se intentó».
 *
 * No tiene prueba propia: las cuatro piezas están probadas por separado y lo que
 * queda aquí es el orden en que se llaman, que no se puede comprobar sin un DOM
 * —y en este proyecto no hay jsdom—.
 */
export async function exportarXmiDelDiagrama(
  diagrama: ClassDiagram,
  nombreProyecto: string,
): Promise<string> {
  const xmi = diagramaAXmi(diagrama);
  const nombre = nombreDeFichero(nombreProyecto, '.xmi');
  const donde = await descargar(nombre, 'application/xml;charset=utf-8', xmi);
  return avisoDeDescarga(nombre, donde);
}
