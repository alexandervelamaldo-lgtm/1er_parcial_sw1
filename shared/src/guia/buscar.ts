/**
 * Buscar en el manual sin modelo, sin red y sin base de datos vectorial.
 *
 * Este módulo hace dos trabajos que parecen uno solo:
 *
 *   1. **Es la respuesta cuando no hay conexión.** Sin red no hay modelo al que
 *      preguntar —ni remoto ni local, porque un móvil no ejecuta Ollama—, así
 *      que la ayuda degrada de «guía que conversa» a «manual que se busca». La
 *      pregunta sigue entrando en lenguaje natural; lo que cambia es que la
 *      respuesta es la sección del manual en vez de un párrafo redactado.
 *   2. **Es la mitad de recuperación del RAG.** Cuando sí hay modelo, lo que se
 *      le pasa como contexto son estos mismos fragmentos. Por eso construir esto
 *      primero no es trabajo aparte: es la pieza que las dos rutas comparten.
 *
 * Se busca por palabras, no por vectores. Un índice vectorial obligaría a
 * calcular embeddings —un modelo más, en algún sitio, con red— y eso rompe justo
 * el caso que este módulo existe para cubrir. Con un corpus de siete documentos
 * y unos doscientos fragmentos, BM25 sobre términos normalizados encuentra la
 * sección correcta y cabe de sobra en el navegador de un móvil.
 */

import type { Fragmento } from './corpus.js';

/** Un fragmento con su puntuación y por qué palabras salió. */
export interface Resultado {
  readonly fragmento: Fragmento;
  readonly puntuacion: number;
  /** Los términos de la pregunta que aparecen en él, para poder resaltarlos. */
  readonly coincidencias: readonly string[];
}

/**
 * Palabras que aparecen en casi toda frase en español y no distinguen nada.
 *
 * La lista es corta a propósito. Una lista larga acaba comiéndose palabras que
 * en este manual sí significan algo: «clase», «estado» o «tabla» son ruido en un
 * corpus general y son justo el tema aquí.
 */
const VACIAS = new Set([
  'a', 'al', 'algo', 'ante', 'aqui', 'asi', 'aunque', 'cada', 'como', 'con',
  'cual', 'cuando', 'de', 'del', 'desde', 'donde', 'dos', 'el', 'ella', 'ellos',
  'en', 'entre', 'era', 'es', 'esa', 'ese', 'eso', 'esta', 'este', 'esto',
  'estos', 'ha', 'hace', 'hacer', 'hasta', 'hay', 'la', 'las', 'le', 'les',
  'lo', 'los', 'mas', 'me', 'mi', 'muy', 'ni', 'no', 'nos', 'o', 'para', 'pero',
  'por', 'porque', 'que', 'se', 'sea', 'ser', 'si', 'sin', 'sobre', 'son', 'su',
  'sus', 'tambien', 'te', 'tiene', 'todo', 'un', 'una', 'uno', 'unos', 'y', 'ya',
]);

/**
 * Quita tildes y pasa a minúsculas.
 *
 * Nadie dicta con tildes. La transcripción de voz devuelve «como importo un
 * xmi» tal cual, y sin plegar los acentos esa pregunta no encontraría la sección
 * «Cómo importar». Es también lo que hace que «importación» e «importacion»
 * sean la misma palabra.
 */
export function plegar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const SUFIJOS = [
  'amientos', 'imientos', 'amiento', 'imiento', 'aciones', 'adores',
  'idades', 'ieron', 'arian', 'antes', 'ancia', 'acion', 'adora', 'iendo',
  'ador', 'idad', 'ados', 'idos', 'adas', 'idas', 'ando', 'aron', 'eron',
  'aban', 'aria', 'amos', 'emos', 'imos', 'ivos', 'ivas',
  'ado', 'ido', 'ada', 'ida', 'ais', 'eis', 'ivo', 'iva',
  'an', 'en', 'ar', 'er', 'ir', 'es', 's',
  // La primera persona del presente, que es como se hacen las preguntas:
  // «¿cómo exporto un XMI?», «¿dónde genero el backend?». Sin ella la pregunta
  // más natural del manual es la única que no encuentra su sección.
  'o', 'a', 'e',
].sort((a, b) => b.length - a.length);

/**
 * Recorta la terminación de una palabra para que las variantes coincidan.
 *
 * Es una raíz tosca, no un lematizador: «importar», «importas», «importando» e
 * «importación» tienen que caer en el mismo cubo para que la pregunta encuentre
 * el encabezado, y para eso basta con cortar por la cola. A veces se pasa
 * —«casa» y «casar» acaban igual— y da lo mismo: el error hace que aparezca un
 * fragmento de más, nunca que desaparezca el bueno, y ese es el lado por el que
 * conviene equivocarse cuando la alternativa es no responder.
 *
 * Las palabras de cinco letras o menos se dejan intactas: recortarlas las
 * convierte en muñones que colisionan con todo.
 *
 * Se recorta **hasta que ya no se pueda recortar más**, y no una vez ni dos.
 * Con un número fijo de pasadas la función deja de ser consistente consigo
 * misma: en dos pasadas «ficheros» llega a «ficher» y «fichero» llega a «fich»,
 * y una palabra deja de encontrar su propio plural. Repetir hasta el punto fijo
 * hace que todas las variantes desemboquen en el mismo sitio, que es lo único
 * que se le pide a una raíz.
 */
export function raiz(palabra: string): string {
  let actual = palabra;

  // De la terminación más larga a la más corta: si se probara al revés, la «s»
  // de «importaciones» se llevaría el primer recorte y las demás no llegarían a
  // mirarse, dejando «importacione» como raíz de nada.
  for (;;) {
    if (actual.length <= 5) return actual;
    const fin = SUFIJOS.find((f) => actual.endsWith(f) && actual.length - f.length >= 4);
    if (fin === undefined) return actual;
    actual = actual.slice(0, actual.length - fin.length);
  }
}

/**
 * Parte un texto en términos buscables.
 *
 * Se conservan los dígitos y los guiones internos porque el manual está lleno de
 * identificadores que son la respuesta: `RNF-SEG-06`, `V1__esquema_inicial`,
 * `uml:Package`, `PostgreSQL 16`. Partirlos por el guion convertiría un código
 * de requisito en tres palabras inútiles.
 */
export function termino(texto: string): string[] {
  return plegar(texto)
    .split(/[^a-z0-9_:-]+/)
    .map((t) => t.replace(/^[-:_]+|[-:_]+$/g, ''))
    .filter((t) => t.length > 1 && !VACIAS.has(t))
    .map((t) => raiz(t));
}

/** Cuántas veces aparece cada término, y el total. */
interface Bolsa {
  readonly cuentas: ReadonlyMap<string, number>;
  readonly largo: number;
}

function embolsar(terminos: readonly string[]): Bolsa {
  const cuentas = new Map<string, number>();
  for (const t of terminos) cuentas.set(t, (cuentas.get(t) ?? 0) + 1);
  return { cuentas, largo: terminos.length };
}

/**
 * El corpus preparado para buscar: se calcula una vez y se consulta muchas.
 *
 * Separarlo de `buscar` no es ceremonia. En el navegador esto se construye al
 * abrir el panel de ayuda y sobrevive a toda la sesión; recorrer doscientos
 * fragmentos en cada tecla pulsada sería lo que hiciera que la caja de búsqueda
 * se sintiera lenta.
 */
export interface Indice {
  readonly fragmentos: readonly Fragmento[];
  readonly bolsas: readonly Bolsa[];
  /** Términos del encabezado y su camino, que pesan más que los del cuerpo. */
  readonly titulos: readonly ReadonlySet<string>[];
  /** En cuántos fragmentos aparece cada término. */
  readonly documentosPorTermino: ReadonlyMap<string, number>;
  readonly largoMedio: number;
}

export function indexar(fragmentos: readonly Fragmento[]): Indice {
  const bolsas: Bolsa[] = [];
  const titulos: ReadonlySet<string>[] = [];
  const documentosPorTermino = new Map<string, number>();

  for (const fragmento of fragmentos) {
    const delTitulo = termino([...fragmento.ruta, fragmento.titulo].join(' '));
    // El encabezado entra también en el cuerpo: una sección titulada «Exportar»
    // habla de exportar aunque la palabra no vuelva a aparecer en su texto.
    const bolsa = embolsar([...delTitulo, ...termino(fragmento.texto)]);
    bolsas.push(bolsa);
    titulos.push(new Set(delTitulo));
    for (const t of bolsa.cuentas.keys()) {
      documentosPorTermino.set(t, (documentosPorTermino.get(t) ?? 0) + 1);
    }
  }

  const total = bolsas.reduce((suma, b) => suma + b.largo, 0);
  return {
    fragmentos,
    bolsas,
    titulos,
    documentosPorTermino,
    largoMedio: bolsas.length === 0 ? 1 : total / bolsas.length,
  };
}

/** Cuánto pesa que un término aparezca en el encabezado y no solo en el cuerpo. */
const BONO_TITULO = 2.2;
/** Saturación de frecuencia de BM25: repetir una palabra deja de sumar pronto. */
const K1 = 1.2;
/** Cuánto se penaliza a un fragmento por ser largo. */
const B = 0.7;

/**
 * Las secciones del manual que mejor responden a la pregunta, de más a menos.
 *
 * La puntuación es BM25 con un empujón para los términos que salen en el
 * encabezado. Ese empujón es lo que hace que «¿cómo importo un XMI?» aterrice en
 * la sección «Importar y exportar XMI» y no en el párrafo de otro documento que
 * menciona la importación de pasada: el autor puso esa palabra en el título
 * precisamente porque la sección va de eso.
 */
export function buscar(indice: Indice, pregunta: string, limite = 5): Resultado[] {
  const terminos = [...new Set(termino(pregunta))];
  if (terminos.length === 0) return [];

  const n = indice.fragmentos.length;
  const resultados: Resultado[] = [];

  for (let i = 0; i < n; i++) {
    const bolsa = indice.bolsas[i]!;
    const enTitulo = indice.titulos[i]!;
    let puntuacion = 0;
    const coincidencias: string[] = [];

    for (const t of terminos) {
      const frecuencia = bolsa.cuentas.get(t);
      if (frecuencia === undefined) continue;
      coincidencias.push(t);

      const documentos = indice.documentosPorTermino.get(t) ?? 0;
      // IDF de BM25. El `+1` de fuera evita que un término presente en más de la
      // mitad del corpus puntúe en negativo y reste: aquí eso pasa a menudo
      // —«diagrama» sale en casi todos los fragmentos— y un peso negativo
      // hundiría al fragmento que además contiene la palabra que sí discrimina.
      const idf = Math.log(1 + (n - documentos + 0.5) / (documentos + 0.5));
      const norma = 1 - B + (B * bolsa.largo) / indice.largoMedio;
      const tf = (frecuencia * (K1 + 1)) / (frecuencia + K1 * norma);
      puntuacion += idf * tf * (enTitulo.has(t) ? BONO_TITULO : 1);
    }

    if (puntuacion > 0) {
      // Cubrir varias palabras de la pregunta vale más que repetir mucho una
      // sola: quien pregunta «exportar xmi enterprise architect» quiere la
      // sección que habla de las cuatro, no la que repite «xmi» veinte veces.
      const cobertura = coincidencias.length / terminos.length;
      resultados.push({
        fragmento: indice.fragmentos[i]!,
        puntuacion: puntuacion * (0.5 + 0.5 * cobertura),
        coincidencias,
      });
    }
  }

  return resultados.sort((a, b) => b.puntuacion - a.puntuacion).slice(0, limite);
}

/**
 * El contexto que se le pasa al modelo cuando sí hay uno.
 *
 * Va con la ruta de encabezados delante de cada trozo para que el modelo pueda
 * citar «Guía de voz y OCR › Importar y exportar XMI» y el usuario sepa dónde
 * mirar. El límite de caracteres existe porque un modelo pequeño corriendo en
 * una máquina de escritorio tiene una ventana modesta, y llenarla de manual no
 * deja sitio para la pregunta.
 */
export function comoContexto(resultados: readonly Resultado[], maximo = 6000): string {
  const trozos: string[] = [];
  let largo = 0;

  for (const { fragmento } of resultados) {
    const trozo = `## ${fragmento.ruta.join(' › ')}\n\n${fragmento.texto}`;
    if (largo + trozo.length > maximo) break;
    trozos.push(trozo);
    largo += trozo.length;
  }

  return trozos.join('\n\n---\n\n');
}
