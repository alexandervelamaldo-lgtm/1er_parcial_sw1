import { describe, expect, it } from 'vitest';
import { anclaDe, construirCorpus, trocearMarkdown, type Documento } from './corpus.js';
import { buscar, comoContexto, indexar, plegar, raiz, termino } from './buscar.js';
import { NO_CUBIERTO, SISTEMA_GUIA } from './prompt.js';

/**
 * La guía sin conexión: trocear el manual y encontrar la sección correcta.
 *
 * Estas pruebas no usan los documentos reales de `docs/`. Se buscan fragmentos
 * escritos aquí, con el contenido que hace falta para poder afirmar cuál tiene
 * que ganar. Atar la prueba a los documentos de verdad la volvería frágil por la
 * razón equivocada: el manual se reescribe a menudo, y una prueba que falla
 * porque alguien añadió un párrafo no está midiendo la búsqueda.
 */

const MANUAL: Documento = {
  nombre: 'Guía de voz y OCR',
  ruta: 'docs/05-guia-voz-y-ocr.md',
  markdown: [
    '# Guía de voz y OCR',
    '',
    'Cómo se usan las dos funciones que entienden lenguaje natural.',
    '',
    '## Control por voz',
    '',
    'Se dicta una orden y el asistente propone una operación sobre el diagrama.',
    '',
    '### Revisión obligatoria',
    '',
    'Nada entra en el diagrama hasta que la persona lo confirma.',
    '',
    '## Importar y exportar XMI',
    '',
    '### Importar',
    '',
    'Se elige un fichero y se revisan los avisos antes de aplicar nada.',
    '',
    '### Exportar',
    '',
    'El fichero que sale se abre en Enterprise Architect.',
    'Las clases van dentro de un paquete.',
    '',
    '```bash',
    '# esto es un comentario, no un encabezado',
    'npm run build',
    '```',
    '',
    'El bloque de arriba sigue perteneciendo a Exportar.',
  ].join('\n'),
};

const DESPLIEGUE: Documento = {
  nombre: 'Despliegue',
  ruta: 'docs/06-despliegue.md',
  markdown: [
    '# Despliegue',
    '',
    '## Base de datos',
    '',
    'El proyecto usa PostgreSQL 16 en el puerto 5432.',
    'La migración inicial se llama V1__esquema_inicial.sql y la aplica Flyway.',
    '',
    '## Requisitos de seguridad',
    '',
    'RNF-SEG-06 obliga a validar con lista blanca todo identificador.',
  ].join('\n'),
};

const indice = indexar(construirCorpus([MANUAL, DESPLIEGUE]));

/** El título de la sección mejor puntuada para una pregunta. */
const mejor = (pregunta: string): string | undefined =>
  buscar(indice, pregunta)[0]?.fragmento.titulo;

describe('trocear el manual por sus encabezados', () => {
  it('hace un fragmento por sección y le pone el camino que la contiene', () => {
    const fragmentos = trocearMarkdown(MANUAL);
    const exportar = fragmentos.find((f) => f.titulo === 'Exportar');

    expect(exportar).toBeDefined();
    expect(exportar!.ruta).toEqual(['Guía de voz y OCR', 'Importar y exportar XMI', 'Exportar']);
    expect(exportar!.documento).toBe('Guía de voz y OCR');
    expect(exportar!.texto).toContain('Enterprise Architect');
  });

  it('no confunde un comentario de shell con un encabezado', () => {
    // Sin mirar las vallas, el `# esto es un comentario` de un ejemplo de bash
    // abriría una sección fantasma y partiría «Exportar» en dos: la mitad de
    // abajo del texto se perdería para la búsqueda.
    const fragmentos = trocearMarkdown(MANUAL);

    expect(fragmentos.map((f) => f.titulo)).not.toContain('esto es un comentario');
    const exportar = fragmentos.find((f) => f.titulo === 'Exportar')!;
    expect(exportar.texto).toContain('sigue perteneciendo a Exportar');
  });

  it('descarta la sección que solo contiene otros encabezados', () => {
    // «Importar y exportar XMI» no tiene texto propio: todo lo suyo está en las
    // subsecciones, que ya son fragmentos. Emitirlo vacío sería un resultado de
    // búsqueda que al abrirlo no dice nada.
    const fragmentos = trocearMarkdown(MANUAL);
    const vacio = fragmentos.find((f) => f.titulo === 'Importar y exportar XMI');

    expect(vacio).toBeUndefined();
    expect(fragmentos.every((f) => f.texto.trim() !== '')).toBe(true);
  });

  it('el ancla es la que genera un renderizador de Markdown', () => {
    expect(anclaDe('Importar y exportar XMI')).toBe('importar-y-exportar-xmi');
    expect(anclaDe('¿Cómo se configura?')).toBe('como-se-configura');
  });

  it('junta los documentos sin mezclarlos', () => {
    const corpus = construirCorpus([MANUAL, DESPLIEGUE]);
    const nombres = new Set(corpus.map((f) => f.documento));

    expect(nombres).toEqual(new Set(['Guía de voz y OCR', 'Despliegue']));
    for (const fragmento of corpus) expect(fragmento.ruta[0]).toBe(fragmento.documento);
  });
});

describe('normalizar lo que se escribe o se dicta', () => {
  it('pliega las tildes, porque nadie dicta con tildes', () => {
    expect(plegar('¿Cómo Importación?')).toBe('¿como importacion?');
    expect(termino('cómo')).toEqual(termino('como'));
  });

  it('deja «importar» e «importaciones» en la misma raíz', () => {
    expect(raiz('importaciones')).toBe(raiz('importar'));
    expect(raiz('exportando')).toBe(raiz('exportado'));
  });

  it('no recorta las palabras cortas hasta dejarlas en un muñón', () => {
    expect(raiz('voz')).toBe('voz');
    expect(raiz('xmi')).toBe('xmi');
    expect(raiz('clase')).toBe('clase');
  });

  it('conserva los identificadores del manual enteros', () => {
    // Partir «RNF-SEG-06» por el guion lo convertiría en tres trozos que no
    // encuentran nada; es justo el término por el que alguien busca literal.
    expect(termino('el requisito RNF-SEG-06')).toContain('rnf-seg-06');
    expect(termino('V1__esquema_inicial.sql')).toContain('v1__esquema_inicial');
    expect(termino('PostgreSQL 16 en el 5432')).toContain('5432');
  });

  it('tira las palabras que aparecen en cualquier frase', () => {
    expect(termino('de la que se y por para')).toEqual([]);
  });
});

describe('encontrar la sección que responde a la pregunta', () => {
  it('lleva una pregunta dictada a la sección cuyo título habla de eso', () => {
    // Sin plegar acentos ni pesar el encabezado, esta pregunta —tal y como sale
    // del dictado, sin tildes— no llegaría a «Exportar».
    expect(mejor('como exporto un xmi')).toBe('Exportar');
    expect(mejor('quiero importar un fichero')).toBe('Importar');
  });

  it('prefiere el encabezado al párrafo que menciona la palabra de pasada', () => {
    const resultados = buscar(indice, 'control por voz');
    expect(resultados[0]!.fragmento.titulo).toBe('Control por voz');
  });

  it('responde sobre la base de datos desde el documento que le toca', () => {
    const primero = buscar(indice, 'que base de datos usa el proyecto')[0]!;
    expect(primero.fragmento.documento).toBe('Despliegue');
    expect(primero.fragmento.texto).toContain('PostgreSQL 16');
  });

  it('encuentra un código de requisito buscado literal', () => {
    expect(mejor('RNF-SEG-06')).toBe('Requisitos de seguridad');
  });

  it('devuelve qué palabras hicieron que saliera', () => {
    // La interfaz las resalta; si no se dijera cuáles son, el usuario vería un
    // párrafo largo sin saber por qué se lo han mostrado.
    const [primero] = buscar(indice, 'exportar enterprise architect');
    expect(primero!.coincidencias.length).toBeGreaterThan(0);
    expect(primero!.coincidencias).toContain(raiz('architect'));
  });

  it('ordena de más a menos y respeta el límite', () => {
    const resultados = buscar(indice, 'diagrama xmi voz postgresql', 2);

    expect(resultados).toHaveLength(2);
    expect(resultados[0]!.puntuacion).toBeGreaterThanOrEqual(resultados[1]!.puntuacion);
  });

  it('no inventa resultados cuando la pregunta no toca el manual', () => {
    // Es la diferencia entre un buscador y un modelo: si no está, no está. Un
    // resultado irrelevante presentado como respuesta es peor que un «no lo
    // encuentro», porque parece una respuesta.
    expect(buscar(indice, 'receta de albóndigas suecas')).toEqual([]);
    expect(buscar(indice, 'de la que')).toEqual([]);
  });

  it('aguanta un corpus vacío sin romperse', () => {
    // Pasa de verdad: el móvil abre la ayuda antes de que el service worker haya
    // cacheado los documentos.
    expect(buscar(indexar([]), 'lo que sea')).toEqual([]);
  });
});

describe('el contexto que se le pasa al modelo cuando hay uno', () => {
  it('antepone el camino de encabezados para que pueda citar de dónde sale', () => {
    const contexto = comoContexto(buscar(indice, 'exportar xmi'));

    expect(contexto).toContain('Guía de voz y OCR › Importar y exportar XMI › Exportar');
    expect(contexto).toContain('Enterprise Architect');
  });

  it('corta antes de pasarse del tamaño, sin partir un fragmento por la mitad', () => {
    // Un modelo pequeño tiene una ventana modesta; llenarla de manual no deja
    // sitio para la pregunta. Y medio fragmento cortado a mitad de frase es
    // contexto que confunde más de lo que ayuda.
    const resultados = buscar(indice, 'diagrama xmi voz postgresql seguridad', 10);
    const contexto = comoContexto(resultados, 120);

    expect(contexto.length).toBeLessThanOrEqual(120);
    for (const { fragmento } of resultados) {
      if (contexto.includes(fragmento.texto.slice(0, 20))) {
        expect(contexto).toContain(fragmento.texto);
      }
    }
  });

  it('no devuelve nada cuando no hay nada que devolver', () => {
    expect(comoContexto([])).toBe('');
  });
});

/**
 * El prompt, que es lo único que los dos motores no pueden permitirse variar.
 *
 * Estas afirmaciones parecen triviales —comprobar que un texto contiene unas
 * palabras— y no lo son: cada una ata una decisión que costó una prueba con un
 * modelo de verdad, y sin ellas el prompt se «limpia» en cualquier refactor
 * posterior sin que nada se ponga en rojo. Un prompt es código sin compilador:
 * si nadie lo ata, nadie se entera de que ha cambiado hasta que un usuario ve
 * una respuesta rara.
 */
describe('el prompt de la guía', () => {
  it('exige la explicación antes que la cita, y lo dice con todas las letras', () => {
    // El fallo que esto previene está medido, no imaginado: con la cita como
    // última instrucción, llama3.2:3b contestaba `«Exportar XMI»` —el título
    // solo, sin respuesta—. Lo cazó `ollama.integracion.test.ts` contra un
    // Ollama real, porque el `fetch` falso de la otra prueba no puede opinar
    // sobre lo que un modelo decide contestar.
    const explicar = SISTEMA_GUIA.indexOf('Explica en español');
    const citar = SISTEMA_GUIA.indexOf('Fuente:');

    expect(explicar).toBeGreaterThanOrEqual(0);
    expect(citar).toBeGreaterThan(explicar);
    expect(SISTEMA_GUIA).toContain('NUNCA respondas solo con el título');
  });

  it('le prohíbe salirse del manual', () => {
    // La otra mitad, y la más cara de perder: un modelo pequeño preguntado por
    // una herramienta que no conoce contesta con lo que sabe de herramientas
    // parecidas, en un tono perfectamente seguro. Una guía que inventa botones
    // es peor que una guía que calla, porque quien pregunta no puede notarlo.
    expect(SISTEMA_GUIA).toContain('ÚNICAMENTE');
    expect(SISTEMA_GUIA).toContain('No inventes botones');
    expect(SISTEMA_GUIA).toContain(NO_CUBIERTO);
  });

  it('la negativa es la misma cadena que devuelven los dos motores por su cuenta', () => {
    // Aparece en tres sitios: el prompt se la dicta al modelo, y cada motor la
    // devuelve sin llamar a nadie cuando la búsqueda no encuentra fuentes. Si
    // se separan, la misma situación da dos textos distintos según si había
    // modelo o no, y parece un fallo aunque las dos respuestas sean correctas.
    expect(NO_CUBIERTO).toBe('Eso no lo cubre el manual.');
  });
});
