import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los criterios de aspecto, comprobados en vez de prometidos.
 *
 * Un rediseño se deshace solo. No de golpe: se deshace en el parche de dentro de
 * tres semanas que añade un `border-radius: 8px` porque el elemento nuevo «queda
 * mejor así», y en el de dentro de dos meses que mete un emoji en un botón
 * porque era más rápido que dibujar el icono. Nadie lo nota hasta que la
 * interfaz vuelve a tener el aspecto de la que se quiso cambiar.
 *
 * Aquí están escritas las reglas que definen el aspecto —radio, sombras, color
 * del acento, contraste, ausencia de pictogramas— como aserciones sobre los
 * ficheros. No sustituyen a mirar la pantalla; impiden que lo que se mira hoy se
 * pierda sin que nadie se entere.
 *
 * El contraste se calcula, no se estima. La fórmula es la de WCAG 2.1: se
 * linealiza cada canal y se pesan según la sensibilidad del ojo. Escribir «este
 * gris parece suficiente» es exactamente como se acabó con un `--texto-2` de
 * 2.6:1 en el tema claro, que era ilegible y llevaba semanas ahí.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(AQUI, 'estilos.css'), 'utf8');

/**
 * La hoja sin sus comentarios.
 *
 * Mismo motivo que en los `.tsx`: la única forma de explicar por qué `#2a1620`
 * no vale es escribirlo, y una prueba que castiga la explicación empuja a
 * borrar el porqué y dejar solo el qué. Aquí es más necesario todavía, porque
 * media hoja son comentarios que citan los colores que se retiraron.
 */
function sinComentariosCss(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '');
}

/* --------------------------------------------------------------------------
   Contraste
   -------------------------------------------------------------------------- */

function canal(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex: string): number {
  const n = hex.replace('#', '');
  const largo = n.length === 3 ? n.split('').map((c) => c + c) : [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)];
  const [r, g, b] = largo.map((par) => canal(Number.parseInt(par, 16)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function canales(hex: string): [number, number, number] {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Cuánto se aleja un color del gris: el canal más alto menos el más bajo.
 *
 * Es una medida burda —no es croma de verdad— y se usa a propósito, porque lo
 * que hay que impedir es burdo: que vuelva un amarillo de rotulador o que los
 * grises se tiñan otra vez. Una métrica perceptual exacta aquí solo añadiría
 * discusión sobre el umbral.
 */
function saturacion(hex: string): number {
  const c = canales(hex);
  return Math.max(...c) - Math.min(...c);
}

const NEUTROS = [
  '--fondo',
  '--fondo-2',
  '--fondo-3',
  '--borde',
  '--realce',
  '--borde-fuerte',
  '--texto',
  '--texto-2',
];

/**
 * Lee las variables de un bloque `:root`.
 *
 * Se leen del fichero en lugar de copiarlas aquí a propósito: una prueba que
 * afirma cosas sobre una copia de los colores deja de decir nada en cuanto
 * alguien cambia el original, y encima sigue pasando, que es peor.
 */
function tokens(selector: string): Record<string, string> {
  const inicio = CSS.indexOf(selector);
  expect(inicio, `no se encontró el bloque ${selector}`).toBeGreaterThanOrEqual(0);
  const abre = CSS.indexOf('{', inicio);
  const cierra = CSS.indexOf('}', abre);
  const cuerpo = CSS.slice(abre + 1, cierra);
  const tabla: Record<string, string> = {};
  for (const linea of cuerpo.split('\n')) {
    const m = /^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/.exec(linea);
    if (m?.[1] !== undefined && m[2] !== undefined) tabla[m[1]] = m[2];
  }
  return tabla;
}

const OSCURO = tokens(':root {');
const CLARO = tokens(":root[data-tema='claro']");

/*
  Los pares que de verdad se dan en pantalla. No se comprueba «todo contra
  todo»: eso produce fallos en combinaciones que ningún componente pinta, y las
  pruebas que fallan por casos imposibles se acaban desactivando enteras.

  4.5 es el umbral AA para texto normal. Los rótulos de esta interfaz son de
  11 y 12 px, así que ninguno se acoge al 3:1 de «texto grande».
*/
const PARES: [string, string, string][] = [
  ['--texto', '--fondo', 'texto principal sobre el lienzo'],
  ['--texto', '--fondo-2', 'texto principal sobre barra y paneles'],
  ['--texto', '--fondo-3', 'texto principal sobre un control'],
  ['--texto-2', '--fondo', 'texto secundario sobre el lienzo'],
  ['--texto-2', '--fondo-2', 'texto secundario sobre barra y paneles'],
  ['--texto-2', '--fondo-3', 'texto secundario sobre un control'],
  ['--acento', '--fondo', 'acento como texto sobre el lienzo'],
  ['--acento', '--fondo-2', 'acento como texto sobre barra y paneles'],
  ['--acento', '--fondo-3', 'acento como texto sobre un control'],
  ['--sobre-acento', '--acento', 'texto de un botón primario'],
  ['--sobre-acento', '--acento-2', 'texto de un botón primario señalado'],
  ['--error', '--fondo-2', 'un error en un formulario'],
  ['--exito', '--fondo-2', 'la conexión establecida en la barra de estado'],
  ['--aviso', '--fondo-2', 'un aviso de la revisión'],
];

describe('contraste AA en los dos temas', () => {
  for (const [tema, tabla] of [
    ['oscuro', OSCURO],
    ['claro', CLARO],
  ] as const) {
    describe(`tema ${tema}`, () => {
      for (const [frente, fondo, donde] of PARES) {
        it(`${donde}: ${frente} sobre ${fondo}`, () => {
          /*
            El tema claro solo redefine parte de las variables; las que no
            redefine las hereda del `:root` oscuro. Buscarlas en cascada es lo
            que hace la prueba fiel a lo que pinta el navegador.
          */
          const a = tabla[frente] ?? OSCURO[frente];
          const b = tabla[fondo] ?? OSCURO[fondo];
          expect(a, `${frente} no está definida`).toBeDefined();
          expect(b, `${fondo} no está definida`).toBeDefined();
          const ratio = contraste(a as string, b as string);
          expect(
            ratio,
            `${frente} (${a as string}) sobre ${fondo} (${b as string}) da ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }

  /*
    El acento tiene un techo además de un suelo. Un azul que cumple AA de sobra
    puede seguir siendo un azul de escaparate: lo que se persigue no es que se
    lea, es que no compita con el diagrama. Un color con los tres canales muy
    separados es un color saturado; se mide la distancia entre el canal más alto
    y el más bajo.
  */
  it('el acento está desaturado, no es el azul de plantilla', () => {
    for (const [tema, tabla] of [
      ['oscuro', OSCURO],
      ['claro', CLARO],
    ] as const) {
      const hex = (tabla['--acento'] as string).replace('#', '');
      const canales = [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      const rango = Math.max(...canales) - Math.min(...canales);
      expect(rango, `el acento del tema ${tema} (#${hex}) tiene un rango de ${String(rango)}`).toBeLessThanOrEqual(120);
    }
  });

  /*
    El techo va también para los tres semánticos, que es justo lo que no hacía.
    Mientras solo miraba a `--acento`, `--exito` (#4ecb8f, rango 125), `--aviso`
    (#ffd24a, 181) y `--error` (#ff5b7f, 164) pasaron desapercibidos: cumplían
    AA de sobra y eran menta, amarillo de rotulador y rosa. Una regla que se
    aplica a un solo color no es una regla, es una excepción.
  */
  it('los semánticos están desaturados, no son caramelo', () => {
    for (const [tema, tabla] of [
      ['oscuro', OSCURO],
      ['claro', CLARO],
    ] as const) {
      for (const nombre of ['--exito', '--aviso', '--error']) {
        const rango = saturacion((tabla[nombre] ?? OSCURO[nombre]) as string);
        expect(
          rango,
          `${nombre} del tema ${tema} (${(tabla[nombre] ?? OSCURO[nombre]) as string}) tiene un rango de ${String(rango)}`,
        ).toBeLessThanOrEqual(110);
      }
    }
  });

  /*
    Y los neutros tienen que ser neutros.

    Toda la rampa estaba teñida de azul: `--borde` `#2a3040` llevaba 22 puntos
    más de azul que de rojo, y `--texto-2` y `--borde-fuerte` llevaban 28. No es
    una objeción de gusto. Un acento solo destaca si el entorno es neutro; sobre
    un cromo que ya es azul, un acento azul se lee como una pieza más del fondo,
    y entonces la selección deja de saltar a la vista, que es lo único que tiene
    que hacer.

    Seis puntos dejan sitio a una pizca fría deliberada y cierran la puerta a
    volver a teñirlo entero.
  */
  it('los neutros son neutros', () => {
    for (const [tema, tabla] of [
      ['oscuro', OSCURO],
      ['claro', CLARO],
    ] as const) {
      for (const nombre of NEUTROS) {
        const valor = (tabla[nombre] ?? OSCURO[nombre]) as string;
        expect(valor, `${nombre} no está definida`).toBeDefined();
        const desviacion = saturacion(valor);
        expect(
          desviacion,
          `${nombre} del tema ${tema} (${valor}) se desvía ${String(desviacion)} puntos del gris`,
        ).toBeLessThanOrEqual(6);
      }
    }
  });
});

/* --------------------------------------------------------------------------
   Geometría: esquinas y sombras
   -------------------------------------------------------------------------- */

describe('la geometría es la de una herramienta, no la de una tarjeta', () => {
  it('ningún radio pasa de 3 px, salvo los indicadores redondos', () => {
    const culpables: string[] = [];
    for (const [, valor] of CSS.matchAll(/border-radius:\s*([^;]+);/g)) {
      const v = (valor ?? '').trim();
      // `50%` es un círculo de verdad: el punto de presencia de cada
      // participante y el avatar. No es una esquina redondeada.
      if (v === '50%' || v === '0' || v.includes('var(--radio)')) continue;
      const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
      if (px?.[1] !== undefined && Number.parseFloat(px[1]) <= 3) continue;
      culpables.push(v);
    }
    expect(culpables, `radios sueltos: ${culpables.join(', ')}`).toEqual([]);
  });

  it('la propia variable --radio es discreta', () => {
    const m = /--radio:\s*(\d+)px/.exec(CSS);
    expect(m?.[1]).toBeDefined();
    expect(Number.parseInt(m?.[1] ?? '99', 10)).toBeLessThanOrEqual(3);
  });

  /*
    Las sombras difusas son la firma de la interfaz de tarjetas: un panel que
    levita. Una herramienta de escritorio separa capas con una línea. Se permite
    un desenfoque mínimo por si algún día hace falta un realce de un píxel, pero
    no los 20 y 60 px que había.
  */
  it('no hay sombras difusas', () => {
    const culpables: string[] = [];
    for (const [, valor] of CSS.matchAll(/box-shadow:\s*([^;]+);/g)) {
      const v = (valor ?? '').trim();
      if (v === 'none') continue;
      const desenfoques = [...v.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((m) => Number.parseFloat(m[1] ?? '0'));
      // El tercer número de una sombra es el desenfoque.
      const blur = desenfoques[2] ?? 0;
      if (blur > 4) culpables.push(v);
    }
    expect(culpables, `sombras difusas: ${culpables.join(' | ')}`).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
   Un solo sitio donde se declara un color
   -------------------------------------------------------------------------- */

describe('los colores viven en los tokens, no sueltos por la hoja', () => {
  /*
    Esta es la prueba que habría evitado el tema claro roto.

    Había 29 colores escritos a mano por debajo de los bloques `:root`
    —`#2a1620` de fondo para un error, `#4a2530` para su borde, `#2a2410` para
    un aviso—, y `[data-tema='claro']` solo redefine variables. Resultado: al
    conmutar a claro, los diálogos de error y los avisos se quedaban en granate
    y marrón oscuro sobre blanco. Llevaba ahí desde que existe el tema claro y
    no lo había visto nadie, porque el tema claro se usa para proyectar y lo que
    se proyecta es el lienzo, no los cuadros de error.

    No basta con arreglarlos: cada literal nuevo reabre el agujero, y se cuela
    con toda naturalidad, porque escribir `#2a1620` es más rápido que pensar de
    qué token se deriva. La lista blanca está vacía y debe seguirlo.
  */
  it('ningún color literal fuera de los bloques :root', () => {
    const cuerpo = CSS.slice(CSS.indexOf('}', CSS.indexOf(":root[data-tema='claro']")) + 1);
    const sueltos = [...sinComentariosCss(cuerpo).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect(sueltos, `colores sueltos: ${sueltos.join(', ')}`).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
   Las vías de entrada del tablero
   -------------------------------------------------------------------------- */

/*
  Cuatro categorías pintadas de cuatro colores es exactamente el sitio por donde
  entra una paleta nueva. La tentación es escribir cuatro hexes bonitos y seguir:
  el `#4ecb8f` menta y el `#ffd24a` de rotulador que se retiraron de los
  semánticos llegaron así, un color a la vez y cada uno con su motivo.

  Se comprueban las dos propiedades que importan, no los valores: que salgan de
  tokens que ya existen —y que por tanto ya se recalculan en el tema claro y ya
  pasan por la tabla de contrastes de arriba— y que cada tramo se distinga del
  carril sobre el que se dibuja en los dos temas. Con menos de 3:1 la barra se
  convierte en un rectángulo gris.
*/
describe('la barra de vías de entrada no estrena colores', () => {
  const VIAS = ['manual', 'asistente', 'foto', 'xmi'];

  /** El token que usa de fondo `.tablero__via--<origen>`. */
  function tokenDeVia(origen: string): string | null {
    const regla = new RegExp(`\\.tablero__via--${origen}\\s*\\{([^}]*)\\}`).exec(
      sinComentariosCss(CSS),
    );
    return /background:\s*var\((--[\w-]+)\)/.exec(regla?.[1] ?? '')?.[1] ?? null;
  }

  it('las cuatro vías tienen color', () => {
    for (const via of VIAS) {
      expect(tokenDeVia(via), `.tablero__via--${via} no define un fondo con var()`).not.toBeNull();
    }
  });

  it('ninguna estrena un color: todas salen de tokens ya declarados', () => {
    for (const via of VIAS) {
      const token = tokenDeVia(via) as string;
      expect(OSCURO[token], `${token} no está en :root`).toBeDefined();
    }
  });

  /*
    `--error` queda fuera por significado, no por contraste. En esta hoja el rojo
    quiere decir «algo va mal», y que un modelo llegara por fotografía no es un
    fallo; reutilizarlo aquí enseñaría a no creerse el rojo del resto de la
    interfaz, que es donde sí hace falta.
  */
  it('ninguna vía se pinta con el color de error', () => {
    for (const via of VIAS) {
      expect(tokenDeVia(via), `la vía ${via} usa el rojo de error`).not.toBe('--error');
    }
  });

  it('cada vía se distingue del carril en los dos temas', () => {
    for (const [tema, tabla] of [
      ['oscuro', OSCURO],
      ['claro', CLARO],
    ] as const) {
      const carril = (tabla['--fondo-3'] ?? OSCURO['--fondo-3']) as string;
      for (const via of VIAS) {
        const token = tokenDeVia(via) as string;
        const color = (tabla[token] ?? OSCURO[token]) as string;
        const ratio = contraste(color, carril);
        expect(
          ratio,
          `la vía ${via} (${token}, ${color}) da ${ratio.toFixed(2)}:1 sobre el carril del tema ${tema}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  /*
    Y no vale que dos vías contiguas parezcan la misma. La barra las pone pegadas
    sin separador, así que dos colores cercanos se leen como un solo tramo y el
    reparto que se está enseñando deja de verse.
  */
  it('no hay dos vías que se confundan entre sí', () => {
    for (const [tema, tabla] of [
      ['oscuro', OSCURO],
      ['claro', CLARO],
    ] as const) {
      for (let i = 0; i < VIAS.length; i++) {
        for (let j = i + 1; j < VIAS.length; j++) {
          const de = (via: string): string => {
            const token = tokenDeVia(via) as string;
            return (tabla[token] ?? OSCURO[token]) as string;
          };
          const [a, b] = [canales(de(VIAS[i] as string)), canales(de(VIAS[j] as string))];
          const distancia = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
          expect(
            distancia,
            `${VIAS[i] as string} y ${VIAS[j] as string} distan ${distancia.toFixed(0)} en el tema ${tema}`,
          ).toBeGreaterThanOrEqual(40);
        }
      }
    }
  });
});

/* --------------------------------------------------------------------------
   Colores de participante
   -------------------------------------------------------------------------- */

/*
  Viven en `usePresencia.ts`, y esa es justo la razón por la que sobrevivieron
  intactos a dos rediseños: ningún barrido del CSS los mira. Son, además, los
  colores más saturados que llega a pintar la aplicación —ficha de presencia y
  contorno de selección sobre el diagrama—, así que son los que más delatan.

  Se comprueban las tres propiedades que de verdad importan, no los hexes
  concretos: que no griten, que se pueda leer texto encima y que dos
  participantes no se confundan entre sí.
*/
describe('los colores de participante son un sistema, no ocho rotuladores', () => {
  const FUENTE = readFileSync(join(AQUI, 'hooks', 'usePresencia.ts'), 'utf8');
  const COLORES = [...FUENTE.slice(FUENTE.indexOf('const COLORES')).matchAll(/'(#[0-9a-fA-F]{6})'/g)].map(
    (m) => m[1] as string,
  );

  it('se encontraron los ocho', () => {
    expect(COLORES).toHaveLength(8);
  });

  it('ninguno está saturado por encima del techo de los semánticos', () => {
    for (const c of COLORES) {
      expect(saturacion(c), `${c} tiene un rango de ${String(saturacion(c))}`).toBeLessThanOrEqual(110);
    }
  });

  it('todos admiten la inicial en oscuro encima', () => {
    // La ficha de presencia pinta la inicial con `--sobre-acento` sobre el
    // color del participante; si el color es oscuro, la inicial desaparece.
    for (const c of COLORES) {
      const ratio = contraste(c, OSCURO['--sobre-acento'] as string);
      expect(ratio, `${c} da ${ratio.toFixed(2)}:1 con la inicial`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('se distinguen del lienzo, que es donde marcan la selección', () => {
    for (const c of COLORES) {
      const ratio = contraste(c, OSCURO['--fondo'] as string);
      expect(ratio, `${c} da ${ratio.toFixed(2)}:1 sobre el lienzo`).toBeGreaterThanOrEqual(3);
    }
  });

  it('no hay dos que se confundan entre sí', () => {
    for (let i = 0; i < COLORES.length; i++) {
      for (let j = i + 1; j < COLORES.length; j++) {
        const [a, b] = [canales(COLORES[i] as string), canales(COLORES[j] as string)];
        const distancia = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(
          distancia,
          `${COLORES[i] as string} y ${COLORES[j] as string} distan ${distancia.toFixed(0)}`,
        ).toBeGreaterThanOrEqual(40);
      }
    }
  });
});

/* --------------------------------------------------------------------------
   Pictogramas
   -------------------------------------------------------------------------- */

/*
  Los glifos que se sustituyeron por iconos dibujados, uno por uno.

  Se listan en vez de comprobar rangos Unicode enteros porque un rango entero
  produce falsos positivos en los comentarios en castellano y en los ejemplos de
  cardinalidad (`1 → *`), y una prueba que grita por casos legítimos se acaba
  borrando. Esta lista es la deuda concreta que se saldó; si alguno vuelve, es
  que alguien copió un botón viejo.
*/
const PICTOGRAMAS = [
  '🕘', '◧', '◨', '▭', '◻', '▱', '≡', '✕', '⚠', '✓', '✔',
  '🎤', '🔊', '🔇', '🔑', '🖼', '⤒', '▸', '▾', '⋯', '⏱', '📋', '📁', '🗑',
];

function tsxDeComponentes(): string[] {
  const dir = join(AQUI, 'components');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f) => join(dir, f));
}

/**
 * El fichero sin sus comentarios.
 *
 * Estas dos listas hablan de lo que sale por pantalla, y un comentario no sale
 * por pantalla. La distinción no es un tecnicismo: la única forma de explicar
 * por qué un glifo o un eslogan no valen es nombrarlos, y una prueba que
 * castiga esa explicación empuja a borrar el porqué y dejar solo el qué. Se
 * quitan los bloques `/* … *\/` y las líneas que empiezan por `//`; no se tocan
 * las `//` a media línea, porque ahí suele haber una URL dentro de una cadena y
 * cortarla escondería texto de verdad.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => !linea.trimStart().startsWith('//'))
    .join('\n');
}

describe('ningún pictograma de fuente hace de control', () => {
  for (const ruta of tsxDeComponentes()) {
    const nombre = ruta.split(/[\\/]/).pop() ?? ruta;
    it(nombre, () => {
      const texto = sinComentarios(readFileSync(ruta, 'utf8'));
      const encontrados = PICTOGRAMAS.filter((g) => texto.includes(g));
      expect(encontrados, `${nombre} todavía usa ${encontrados.join(' ')}`).toEqual([]);
    });
  }
});

/* --------------------------------------------------------------------------
   Microcopia
   -------------------------------------------------------------------------- */

/*
  El tuteo imperativo es lo que delata un texto escrito de corrido: «Arrastra»,
  «Guarda esto», «Acércate». Una herramienta se dirige a quien la usa en
  impersonal o en usted, y sobre todo no le dice lo que podría hacer a
  continuación.

  Se buscan formas concretas y no una regla gramatical: detectar el imperativo
  de segunda persona en castellano con una expresión regular es imposible sin
  falsos positivos —«importa» es a la vez verbo y sustantivo—, y aquí interesa
  más que no vuelvan las que ya se corrigieron que atrapar todas las posibles.
*/
const TUTEOS = [
  'Arrastra ', 'Guarda ', 'Acércate', 'Anótalo', 'guárdalo', 'tu gestor',
  'si olvidas', 'lo hiciste', 'tienes el fichero', 'usa «',
  // Segunda tanda: las que salieron de leer `document.body.innerText` en el
  // navegador en vez de rastrear el código. La pantalla de acceso no estaba en
  // ningún barrido estático porque su texto no contenía ninguna de las de
  // arriba, y era justo la primera pantalla que ve el tribunal.
  'Diseña ', 'No tienes cuenta', 'He olvidado', 'Puedes seguir', 'Tus cambios',
  'no tienes permiso', 'Tus proyectos', 'no tienes ningún', 'Tu código',
  'puedes invitar', 'tienes permiso', 'en tu máquina', 'Prueba con ',
  'Abre un ', 'por ti', 'confirmes',
];

describe('la microcopia no tutea', () => {
  for (const ruta of tsxDeComponentes()) {
    const nombre = ruta.split(/[\\/]/).pop() ?? ruta;
    it(nombre, () => {
      const texto = sinComentarios(readFileSync(ruta, 'utf8'));
      const encontrados = TUTEOS.filter((t) => texto.includes(t));
      expect(encontrados, `${nombre} tutea: ${encontrados.join(' | ')}`).toEqual([]);
    });
  }
});
