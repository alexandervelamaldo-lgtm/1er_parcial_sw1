/**
 * El manual, partido en trozos que se pueden buscar.
 *
 * La guía de la herramienta se apoya en los documentos de `docs/`, que ya
 * existen y que se escriben para leerlos. No hay corpus aparte ni copia
 * paralela: si un documento cambia, la guía cambia con él. Esa es la razón de
 * no afinar ningún modelo con este contenido —un modelo afinado se queda con la
 * versión del día que se entrenó— y de recuperar el texto en el momento.
 *
 * Este módulo vive en `shared` por el mismo motivo que la gramática del
 * asistente: **el navegador lo ejecuta sin conexión**. Es lo que permite que la
 * ayuda siga respondiendo en un móvil, donde no hay ningún modelo local que
 * valga, y sin internet, donde no hay ningún modelo remoto al que llamar.
 *
 * Aquí no se lee ningún fichero. Quién trae el texto depende de dónde corra
 * esto —el navegador lo empaqueta en tiempo de compilación, el servidor lo lee
 * del disco— y mezclar ambas cosas ataría este módulo a un entorno concreto.
 */

/** Un trozo del manual: una sección con su encabezado y su camino. */
export interface Fragmento {
  /** Nombre legible del documento del que sale. */
  readonly documento: string;
  /** El encabezado de esta sección. */
  readonly titulo: string;
  /**
   * Los encabezados que la contienen, del más general al más concreto.
   *
   * Es lo que permite citar «Guía de voz y OCR › Importar y exportar XMI ›
   * Exportar» en vez de un «Exportar» suelto que no dice de qué.
   */
  readonly ruta: readonly string[];
  /** El texto de la sección, sin el encabezado. */
  readonly texto: string;
  /** Ancla dentro del documento, para poder enlazarla. */
  readonly ancla: string;
}

/** Un documento de origen, tal cual, antes de trocearlo. */
export interface Documento {
  /** Nombre legible: «Guía de voz y OCR». */
  readonly nombre: string;
  /** Ruta relativa, para poder enlazar al fichero. */
  readonly ruta: string;
  readonly markdown: string;
}

const ENCABEZADO = /^(#{1,6})\s+(.+?)\s*$/;
const VALLA = /^\s*(```|~~~)/;

/**
 * Trocea un documento por sus encabezados.
 *
 * Un fragmento por sección, del encabezado al siguiente, sea cual sea su nivel.
 * No se agrupan secciones pequeñas ni se parten las grandes por tamaño fijo: el
 * autor ya decidió dónde estaban las costuras al escribir los encabezados, y
 * respetarlas hace que la cita salga con un título que significa algo.
 */
export function trocearMarkdown(documento: Documento): Fragmento[] {
  const lineas = documento.markdown.split(/\r?\n/);
  const fragmentos: Fragmento[] = [];

  // El camino de encabezados vigente, indexado por nivel.
  const pila: string[] = [];
  let titulo = documento.nombre;
  let acumulado: string[] = [];
  let nivelActual = 0;
  let dentroDeValla = false;

  const cerrar = (): void => {
    const texto = acumulado.join('\n').trim();
    // Una sección que solo contiene otro encabezado no aporta nada por sí
    // misma: su contenido está en las subsecciones, que ya son fragmentos.
    if (texto === '') return;
    const encabezados = pila.slice(0, nivelActual).filter((t) => t !== '');
    // Casi todo documento empieza con un `#` que repite su propio nombre. Sin
    // esta comprobación la cita saldría «Guía de voz y OCR › Guía de voz y OCR ›
    // Exportar», que además de feo hace dudar de si son dos sitios distintos.
    const raizRepetida = encabezados[0] === documento.nombre;
    fragmentos.push({
      documento: documento.nombre,
      titulo,
      ruta: raizRepetida ? encabezados : [documento.nombre, ...encabezados],
      texto,
      ancla: anclaDe(titulo),
    });
  };

  for (const linea of lineas) {
    // Un `# comentario` dentro de un bloque de código no es un encabezado. Sin
    // esta comprobación, cada `# instalar dependencias` de un ejemplo de shell
    // abriría una sección fantasma y partiría el fragmento por la mitad.
    if (VALLA.test(linea)) {
      dentroDeValla = !dentroDeValla;
      acumulado.push(linea);
      continue;
    }

    const encabezado = dentroDeValla ? null : ENCABEZADO.exec(linea);
    if (encabezado === null) {
      acumulado.push(linea);
      continue;
    }

    cerrar();

    const nivel = encabezado[1]!.length;
    const texto = limpiarTitulo(encabezado[2]!);
    pila.length = Math.max(0, nivel - 1);
    while (pila.length < nivel - 1) pila.push('');
    pila.push(texto);

    titulo = texto;
    nivelActual = nivel;
    acumulado = [];
  }

  cerrar();
  return fragmentos;
}

/** Trocea varios documentos de una vez. */
export function construirCorpus(documentos: readonly Documento[]): Fragmento[] {
  return documentos.flatMap((documento) => trocearMarkdown(documento));
}

/** Quita el formato del encabezado: «**Exportar**» y «`leerXmi`» son títulos. */
function limpiarTitulo(texto: string): string {
  return texto
    .replace(/[*_`]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/** El ancla que genera un renderizador de Markdown para un encabezado. */
export function anclaDe(titulo: string): string {
  return titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}
