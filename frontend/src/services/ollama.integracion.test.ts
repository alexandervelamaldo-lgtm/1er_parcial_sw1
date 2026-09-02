import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { construirCorpus, indexar, type Documento } from '@app/shared';
import { MODELO_POR_DEFECTO, modelosDisponibles, preguntar } from './ollama.js';

/**
 * La guía contra un Ollama de verdad.
 *
 * Se salta sola si no hay `TEST_OLLAMA_URL`, que es el caso normal —en
 * integración continua no hay 2 GB de modelo ni conviene que los haya—. Para
 * ejecutarla:
 *
 * ```
 * ollama pull llama3.2:3b
 * TEST_OLLAMA_URL=http://localhost:11434 npm test
 * ```
 *
 * Existe porque `ollama.test.ts` no puede sustituirla. Allí el `fetch` es falso
 * y lo escribí yo, así que prueba que el lector de NDJSON hace lo que creo que
 * Ollama manda; si me equivoqué sobre el formato del cable, el doble se
 * equivoca conmigo y las dos pruebas pasan en verde mientras el panel de ayuda
 * sale en blanco. Esto es lo único que puede pillar esa clase de error.
 *
 * Lo que **no** se afirma es el contenido de la respuesta. Un modelo de 3B a
 * temperatura 0.2 sigue siendo un generador de texto: exigirle una frase
 * concreta produce una prueba que falla cuando cambia la versión del modelo sin
 * que nada se haya roto. Se afirma la mecánica —que llega texto, que llega a
 * trozos, que las fuentes citadas son las que la búsqueda eligió— y esa sí es
 * responsabilidad nuestra.
 */

const url = process.env.TEST_OLLAMA_URL;

/** El manual de verdad, el mismo que el navegador carga con `import.meta.glob`. */
function manualDelDisco(): Documento[] {
  const directorio = fileURLToPath(new URL('../../../docs/', import.meta.url));
  return readdirSync(directorio)
    .filter((f) => f.endsWith('.md'))
    .map((fichero) => ({
      nombre: fichero,
      ruta: `docs/${fichero}`,
      markdown: readFileSync(`${directorio}${fichero}`, 'utf8'),
    }));
}

describe.runIf(url)('contra un Ollama de verdad', () => {
  const indice = indexar(construirCorpus(manualDelDisco()));

  it('el modelo por defecto está descargado', async () => {
    const modelos = await modelosDisponibles({ url });

    // Si esto falla no es un fallo del código: falta `ollama pull`. El mensaje
    // lo dice para no perder media hora buscándolo en el sitio equivocado.
    expect(
      modelos,
      `Ollama responde pero no tiene ${MODELO_POR_DEFECTO}. Ejecuta: ollama pull ${MODELO_POR_DEFECTO}`,
    ).toContain(MODELO_POR_DEFECTO);
  });

  it('contesta una pregunta del manual, y va escribiendo mientras piensa', async () => {
    const trozos: string[] = [];
    const respuesta = await preguntar(indice, '¿cómo exporto el diagrama a XMI?', {
      url,
      onTrozo: (t) => trozos.push(t),
    });

    // El mensaje lleva la respuesta y las secciones recuperadas porque cuando
    // esto falla hay dos culpables muy distintos —el modelo se ha ido por las
    // ramas, o la búsqueda le ha dado el contexto equivocado— y sin verlos no
    // se puede saber cuál de los dos es.
    const diagnostico = [
      `Respuesta: ${JSON.stringify(respuesta.texto)}`,
      `Secciones: ${respuesta.fuentes.map((f) => `${f.fragmento.documento} › ${f.fragmento.titulo}`).join(' | ')}`,
    ].join('\n');

    expect(respuesta.texto.length, diagnostico).toBeGreaterThan(20);

    // Más de un trozo es la afirmación que importa: prueba que la respuesta
    // llegó troceada y se recompuso bien. Si Ollama cambiara a devolver un
    // único JSON en vez de NDJSON, esto sería 1 y el fallo se vería aquí en
    // lugar de en una pantalla en blanco.
    expect(trozos.length).toBeGreaterThan(1);
    expect(trozos.join('').trim()).toBe(respuesta.texto);

    // Las fuentes salen de la búsqueda léxica, no del modelo, así que sí se
    // pueden exigir: son deterministas y son lo que permite contrastar la
    // paráfrasis con lo que el manual dice de verdad.
    expect(respuesta.fuentes.length).toBeGreaterThan(0);

    // Y que alguna hable de XMI, que es lo que se preguntó. Recuperar cuatro
    // secciones cualesquiera también daría una respuesta con buena pinta —el
    // modelo redacta igual—, solo que inventada. Esto ata la mitad que sí es
    // comprobable contra el manual de verdad, con sus 1000 y pico líneas, no
    // contra el documento de tres secciones del doble de pruebas.
    const hablaDeXmi = respuesta.fuentes.some(
      (f) => /xmi/i.test(f.fragmento.titulo) || /xmi/i.test(f.fragmento.texto),
    );
    expect(hablaDeXmi).toBe(true);
  }, 120_000);

  it('no molesta al modelo cuando el manual no dice nada', async () => {
    const trozos: string[] = [];
    const respuesta = await preguntar(indice, 'zzqqxx', { url, onTrozo: (t) => trozos.push(t) });

    // Sin contexto el modelo solo puede improvisar, y una guía que improvisa es
    // peor que una guía que calla. Que no haya llegado ningún trozo es la
    // prueba de que ni siquiera se le llamó.
    expect(respuesta.fuentes).toEqual([]);
    expect(trozos).toEqual([]);
    expect(respuesta.texto).toBe('Eso no lo cubre el manual.');
  });
});
