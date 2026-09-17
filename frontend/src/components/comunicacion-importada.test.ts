import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodificarXml, leerDiagramasComunicacion, parseXml } from '@app/shared';
import type {
  DiagramaComunicacionUml,
  EnlaceUml,
  MensajeUml,
  ParticipanteUml,
} from '@app/shared';
import {
  ALTO_CAJA,
  rotuloDeMensaje,
  trazarImportado,
  type CajaImportada,
} from './comunicacion-importada';

/**
 * La colocación de un diagrama de comunicación importado.
 *
 * Se prueba aquí y no en el componente por lo de siempre: `jsdom` sigue sin
 * estar instalado (tarea #15) y la geometría es justo lo que conviene
 * comprobar. Lo que se mira no es que las coordenadas sean unas concretas
 * —cambiar un margen no debería romper una prueba— sino las propiedades que
 * tienen que cumplirse siempre: que ninguna caja se salga del lienzo, que no se
 * solapen, que nada quede en negativo, que dos ejecuciones den lo mismo y que
 * un mensaje que no se puede dibujar salga en la lista en vez de reventar.
 */

const objeto = (
  id: string,
  alias: string,
  clase: string | undefined = 'Clase',
): ParticipanteUml => ({ id, alias, clase, actor: false, multiple: false });

const mensaje = (
  id: string,
  numero: string,
  de: string,
  a: string,
  extra: Partial<MensajeUml> = {},
): MensajeUml => ({
  id,
  numero,
  ordenDe: 'fichero',
  etiqueta: `${numero}: hacer()`,
  nombre: 'hacer',
  argumentos: [],
  de,
  a,
  clase: 'llamada',
  guarda: undefined,
  iteracion: false,
  asignacion: undefined,
  ...extra,
});

const enlace = (a: string, b: string): EnlaceUml => ({
  id: `e-${a}-${b}`,
  a,
  b,
  nombre: undefined,
});

const diagrama = (
  participantes: ParticipanteUml[],
  mensajes: MensajeUml[] = [],
  enlaces: EnlaceUml[] = [],
): DiagramaComunicacionUml => ({
  id: 'd1',
  nombre: 'Prueba',
  fuente: 'prueba.xmi',
  participantes,
  mensajes,
  enlaces,
});

/** ¿Se pisan dos cajas? Con un poco de holgura: tocarse ya es demasiado. */
function seSolapan(a: CajaImportada, b: CajaImportada, holgura = 6): boolean {
  return (
    a.x < b.x + b.ancho + holgura &&
    b.x < a.x + a.ancho + holgura &&
    a.y < b.y + b.alto + holgura &&
    b.y < a.y + a.alto + holgura
  );
}

function ningunSolape(trazado: ReturnType<typeof trazarImportado>): void {
  for (let i = 0; i < trazado.cajas.length; i += 1) {
    for (let j = i + 1; j < trazado.cajas.length; j += 1) {
      const a = trazado.cajas[i]!;
      const b = trazado.cajas[j]!;
      expect(seSolapan(a, b), `«${a.etiqueta}» se pisa con «${b.etiqueta}»`).toBe(false);
    }
  }
}

function dentroDelLienzo(trazado: ReturnType<typeof trazarImportado>): void {
  for (const caja of trazado.cajas) {
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.y).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.ancho).toBeLessThanOrEqual(trazado.ancho);
    expect(caja.y + caja.alto).toBeLessThanOrEqual(trazado.alto);
  }
}

// ---------------------------------------------------------------------------

describe('rótulo de un mensaje', () => {
  it('recompone el número aunque el fichero no lo trajera', () => {
    // La razón de recomponer en vez de usar `etiqueta`: a este mensaje se le
    // dedujo el número del orden del documento, así que la etiqueta original
    // no lo tiene y la flecha saldría sin numerar.
    const m = mensaje('m1', '3', 'a', 'b', { ordenDe: 'documento', etiqueta: 'guardar()' });

    expect(rotuloDeMensaje(m)).toBe('3: hacer()');
  });

  it('pone los adornos en el orden en que se escriben', () => {
    const m = mensaje('m1', '2.3', 'a', 'b', {
      nombre: 'calcular',
      argumentos: ['iva', 'base'],
      guarda: 'i := 1..n',
      iteracion: true,
      asignacion: 'total',
    });

    expect(rotuloDeMensaje(m)).toBe('2.3: *[i := 1..n] total := calcular(iva, base)');
  });

  it('un mensaje sin nombre se queda en su número, sin paréntesis huérfanos', () => {
    expect(rotuloDeMensaje(mensaje('m1', '1', 'a', 'b', { nombre: '' }))).toBe('1:');
  });
});

describe('colocación', () => {
  it('un diagrama vacío no revienta ni devuelve un lienzo de tamaño cero', () => {
    const trazado = trazarImportado(diagrama([]));

    expect(trazado.cajas).toEqual([]);
    expect(trazado.ancho).toBeGreaterThan(0);
    expect(trazado.alto).toBeGreaterThan(0);
  });

  it('con dos objetos los pone en horizontal, que es como se dibuja una conversación', () => {
    const trazado = trazarImportado(
      diagrama([objeto('a', 'a'), objeto('b', 'b')], [mensaje('m1', '1', 'a', 'b')]),
    );
    const [uno, otro] = trazado.cajas as [CajaImportada, CajaImportada];

    expect(Math.abs(uno.cy - otro.cy)).toBeLessThan(1);
    expect(Math.abs(uno.cx - otro.cx)).toBeGreaterThan(100);
    ningunSolape(trazado);
  });

  it('pone en el centro al que habla con todos los demás', () => {
    // El caso más común: una clase de control rodeada de sus colaboradores.
    // Con el control en medio no se cruza ni una línea.
    const trazado = trazarImportado(
      diagrama(
        [objeto('c', 'control'), objeto('a', 'a'), objeto('b', 'b'), objeto('d', 'd')],
        [],
        [enlace('c', 'a'), enlace('c', 'b'), enlace('c', 'd')],
      ),
    );
    const control = trazado.cajas.find((x) => x.id === 'c')!;
    const resto = trazado.cajas.filter((x) => x.id !== 'c');
    const distancia = (x: CajaImportada): number => Math.hypot(x.cx - control.cx, x.cy - control.cy);

    // Está en medio: todos los demás quedan alrededor y a distancia parecida.
    const distancias = resto.map(distancia);
    expect(Math.min(...distancias)).toBeGreaterThan(0);
    expect(Math.max(...distancias) - Math.min(...distancias)).toBeLessThan(60);
    ningunSolape(trazado);
  });

  it('no pone a nadie en el centro cuando hay dos candidatos', () => {
    // Con dos objetos conectados a todo, elegir uno sería arbitrario: el
    // anillo trata a los dos igual.
    const todos = [objeto('a', 'a'), objeto('b', 'b'), objeto('c', 'c'), objeto('d', 'd')];
    const trazado = trazarImportado(
      diagrama(todos, [], [
        enlace('a', 'b'),
        enlace('a', 'c'),
        enlace('a', 'd'),
        enlace('b', 'c'),
        enlace('b', 'd'),
      ]),
    );
    const centroLienzo = { x: trazado.ancho / 2, y: trazado.alto / 2 };
    const enMedio = trazado.cajas.filter(
      (c) => Math.hypot(c.cx - centroLienzo.x, c.cy - centroLienzo.y) < 20,
    );

    expect(enMedio).toEqual([]);
    ningunSolape(trazado);
  });

  it('con tres objetos tampoco hay centro: un triángulo no mejora con un vértice en medio', () => {
    const trazado = trazarImportado(
      diagrama(
        [objeto('a', 'a'), objeto('b', 'b'), objeto('c', 'c')],
        [],
        [enlace('a', 'b'), enlace('a', 'c'), enlace('b', 'c')],
      ),
    );

    expect(trazado.cajas).toHaveLength(3);
    ningunSolape(trazado);
  });

  it('las cajas crecen con su etiqueta y no se salen del lienzo', () => {
    const trazado = trazarImportado(
      diagrama([
        objeto('a', 'p', 'P'),
        objeto('b', 'identidades', 'RepositorioDeIdentidadesMuyLargo'),
      ]),
    );
    const corta = trazado.cajas.find((c) => c.id === 'a')!;
    const larga = trazado.cajas.find((c) => c.id === 'b')!;

    expect(larga.ancho).toBeGreaterThan(corta.ancho);
    dentroDelLienzo(trazado);
  });

  it('una etiqueta interminable se acota en vez de estirar el lienzo sin fin', () => {
    const trazado = trazarImportado(
      diagrama([objeto('a', 'x'.repeat(400), 'Y'.repeat(400)), objeto('b', 'b')]),
    );

    expect(trazado.cajas[0]!.ancho).toBeLessThanOrEqual(260);
  });

  it('ninguna caja se sale ni queda en negativo, con los tamaños que sean', () => {
    for (const cuantos of [1, 2, 3, 4, 5, 8, 13]) {
      const objetos = Array.from({ length: cuantos }, (_, i) =>
        objeto(`o${String(i)}`, `alias${String(i)}`, `ClaseNumero${String(i)}`),
      );
      const trazado = trazarImportado(diagrama(objetos));

      expect(trazado.cajas).toHaveLength(cuantos);
      dentroDelLienzo(trazado);
      ningunSolape(trazado);
    }
  });

  it('es determinista: dos trazados del mismo diagrama son idénticos', () => {
    // Una colocación por fuerzas daría un dibujo distinto en cada pintada, y en
    // un editor colaborativo eso se lee como que el diagrama ha cambiado.
    const d = diagrama(
      [objeto('a', 'a'), objeto('b', 'b'), objeto('c', 'c'), objeto('d', 'd'), objeto('e', 'e')],
      [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '2', 'b', 'c')],
      [enlace('a', 'b'), enlace('b', 'c'), enlace('c', 'd')],
    );

    expect(trazarImportado(d)).toEqual(trazarImportado(d));
  });

  it('todas las cajas tienen el mismo alto: lo que varía es el ancho', () => {
    const trazado = trazarImportado(
      diagrama([objeto('a', 'a'), objeto('b', 'unNombreBastanteMasLargo', 'YSuClase')]),
    );

    for (const caja of trazado.cajas) expect(caja.alto).toBe(ALTO_CAJA);
  });
});

describe('enlaces', () => {
  it('dibuja los declarados y los que se deducen de los mensajes, y los distingue', () => {
    const trazado = trazarImportado(
      diagrama(
        [objeto('a', 'a'), objeto('b', 'b'), objeto('c', 'c')],
        [mensaje('m1', '1', 'b', 'c')],
        [enlace('a', 'b')],
      ),
    );

    expect(trazado.lineas).toHaveLength(2);
    expect(trazado.lineas.filter((l) => l.deducido)).toHaveLength(1);
  });

  it('no dibuja un enlace de un objeto consigo mismo', () => {
    const trazado = trazarImportado(
      diagrama([objeto('a', 'a'), objeto('b', 'b')], [], [enlace('a', 'a'), enlace('a', 'b')]),
    );

    expect(trazado.lineas).toHaveLength(1);
  });

  it('cada línea va de centro a centro de sus dos cajas', () => {
    const trazado = trazarImportado(
      diagrama([objeto('a', 'a'), objeto('b', 'b')], [], [enlace('a', 'b')]),
    );
    const linea = trazado.lineas[0]!;
    const centros = trazado.cajas.map((c) => `${String(c.cx)},${String(c.cy)}`).sort();

    expect([`${String(linea.x1)},${String(linea.y1)}`, `${String(linea.x2)},${String(linea.y2)}`].sort()).toEqual(
      centros,
    );
  });
});

describe('flechas', () => {
  it('apila los mensajes de un mismo enlace en vez de amontonarlos', () => {
    const trazado = trazarImportado(
      diagrama(
        [objeto('a', 'a'), objeto('b', 'b')],
        [
          mensaje('m1', '1', 'a', 'b'),
          mensaje('m2', '2', 'a', 'b'),
          mensaje('m3', '3', 'b', 'a'),
        ],
        [enlace('a', 'b')],
      ),
    );
    const sitios = trazado.flechas.map((f) => `${String(f.tx)},${String(f.ty)}`);

    expect(new Set(sitios).size).toBe(3);
  });

  it('la llamada y su respuesta no se dibujan una encima de otra', () => {
    // El fallo que esto evita: tomando la perpendicular del mensaje y no del
    // enlace, los desplazamientos de los dos sentidos se anulan.
    const trazado = trazarImportado(
      diagrama(
        [objeto('a', 'a'), objeto('b', 'b')],
        [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '2', 'b', 'a', { clase: 'respuesta' })],
        [enlace('a', 'b')],
      ),
    );
    const [ida, vuelta] = trazado.flechas;

    expect(Math.hypot(ida!.tx - vuelta!.tx, ida!.ty - vuelta!.ty)).toBeGreaterThan(10);
  });

  it('un automensaje se dibuja como un bucle sobre su propia caja', () => {
    const trazado = trazarImportado(
      diagrama([objeto('a', 'a'), objeto('b', 'b')], [mensaje('m1', '1', 'a', 'a')]),
    );
    const caja = trazado.cajas.find((c) => c.id === 'a')!;

    expect(trazado.flechas).toHaveLength(1);
    // Un arco, no un segmento, y por encima de la caja.
    expect(trazado.flechas[0]!.d).toContain('A ');
    expect(trazado.flechas[0]!.ty).toBeLessThan(caja.y);
    // Y no inventa un enlace para él.
    expect(trazado.lineas).toEqual([]);
  });

  it('marca las flechas cuyo número se dedujo del orden del documento', () => {
    const trazado = trazarImportado(
      diagrama(
        [objeto('a', 'a'), objeto('b', 'b')],
        [
          mensaje('m1', '1', 'a', 'b'),
          mensaje('m2', '2', 'a', 'b', { ordenDe: 'documento' }),
        ],
      ),
    );

    expect(trazado.flechas.map((f) => f.numeroDeducido)).toEqual([false, true]);
  });

  it('conserva la clase del mensaje, que es lo que distingue una respuesta', () => {
    const trazado = trazarImportado(
      diagrama(
        [objeto('a', 'a'), objeto('b', 'b')],
        [mensaje('m1', '1', 'b', 'a', { clase: 'respuesta' })],
      ),
    );

    expect(trazado.flechas[0]!.clase).toBe('respuesta');
  });
});

describe('lo que no se puede dibujar', () => {
  it('un mensaje con un extremo que no existe se omite y se dice, en vez de reventar', () => {
    // El visor anterior lanzaba «Sin posición para el participante» y dejaba al
    // usuario sin diagrama y sin explicación. Un documento compartido puede
    // traer esto en cualquier momento: basta con que alguien borre un objeto.
    const trazado = trazarImportado(
      diagrama(
        [objeto('a', 'a'), objeto('b', 'b')],
        [mensaje('m1', '1', 'a', 'b'), mensaje('m2', '2', 'a', 'fantasma')],
      ),
    );

    expect(trazado.flechas).toHaveLength(1);
    expect(trazado.omitidos).toHaveLength(1);
    expect(trazado.omitidos[0]).toEqual({
      id: 'm2',
      numero: '2',
      motivo: 'el objeto que lo recibe no está en el diagrama',
    });
  });

  it('distingue si el que falta es el que envía o el que recibe', () => {
    const trazado = trazarImportado(
      diagrama([objeto('b', 'b')], [mensaje('m1', '1', 'fantasma', 'b')]),
    );

    expect(trazado.omitidos[0]?.motivo).toContain('lo envía');
  });

  it('un enlace colgante no deja media línea en el aire', () => {
    const trazado = trazarImportado(
      diagrama([objeto('a', 'a'), objeto('b', 'b')], [], [enlace('a', 'b'), enlace('a', 'fantasma')]),
    );

    expect(trazado.lineas).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

/**
 * Los ficheros de verdad, del disco al dibujo.
 *
 * Todo lo de arriba usa diagramas construidos a mano, que es lo que permite
 * provocar el caso raro. Lo que no demuestra es que un fichero real llegue
 * hasta aquí: entre el XMI y `trazarImportado` están el decodificador, el
 * analizador y el lector, y un cambio en cualquiera de los tres podría dejar
 * esta colocación intacta y el visor en blanco. Estos dos casos recorren la
 * cadena entera con los dos dialectos que se admiten, el de Enterprise
 * Architect y el canónico, y comprueban sobre el resultado las mismas
 * propiedades que se exigen a los sintéticos.
 */
describe('los ficheros que se importan de verdad', () => {
  // `readonly` y no `DiagramaComunicacionUml[]`: es lo que devuelve el lector,
  // y copiarlo a un array mutable aquí solo serviría para poder modificar una
  // lista que nadie modifica.
  const leerFixture = (nombre: string): readonly DiagramaComunicacionUml[] => {
    const ruta = fileURLToPath(
      new URL(`../../../shared/src/xmi/fixtures/${nombre}`, import.meta.url),
    );
    const analizado = parseXml(decodificarXml(readFileSync(ruta)));
    if (!analizado.ok) throw new Error(`${nombre}: ${analizado.error}`);
    return leerDiagramasComunicacion(analizado.root, nombre).diagramas;
  };

  it('el de Enterprise Architect: tres objetos, tres enlaces y ni un mensaje', () => {
    const [d] = leerFixture('ea-comunicacion.xmi');
    expect(d).toBeDefined();

    const trazado = trazarImportado(d!);

    // Sin mensajes no hay flechas, pero sí diagrama: los tres objetos y los
    // tres enlaces que el fichero declara. Que este caso no se quede en blanco
    // es justamente lo que hace que la importación de EA sirva de algo.
    expect(trazado.cajas).toHaveLength(3);
    expect(trazado.lineas).toHaveLength(3);
    expect(trazado.flechas).toHaveLength(0);
    expect(trazado.omitidos).toHaveLength(0);
    ningunSolape(trazado);
    dentroDelLienzo(trazado);
  });

  it('el canónico: cuatro objetos y seis mensajes, con el automensaje incluido', () => {
    const [d] = leerFixture('uml-251-comunicacion.xmi');
    expect(d).toBeDefined();

    const trazado = trazarImportado(d!);

    expect(trazado.cajas).toHaveLength(4);
    expect(trazado.flechas).toHaveLength(6);
    expect(trazado.omitidos).toHaveLength(0);
    ningunSolape(trazado);
    dentroDelLienzo(trazado);

    // Los rótulos salen recompuestos, no copiados de la etiqueta: el `2.1`
    // conserva su guarda y el `1.2` su asterisco de iteración, y el sexto
    // —que en el fichero no traía número ni nombre— sale numerado con el `3`
    // que se le dedujo del orden.
    // En orden de secuencia y no de documento, que es lo que el fichero no
    // garantiza y el modelo sí ordena. Los adornos van detrás del número
    // aunque el fichero los escribiera delante —`*[por cada línea] 1.2: …`—:
    // recomponer en una sola forma es lo que hace que los seis se lean igual
    // viniendo de sitios distintos, incluido el último, que no traía ni
    // número ni nombre y sale con el `3` deducido y el nombre de la operación
    // a la que apunta su `signature`.
    expect(trazado.flechas.map((f) => f.rotulo)).toEqual([
      '1: confirmar()',
      '1.1: crearPedido(lineas)',
      '1.2: *[por cada línea] añadirLinea(linea)',
      '2: total := cobrar(importe)',
      '2.1: [hay saldo] autorizar(tarjeta)',
      '3: notificar(correo)',
    ]);

    // El automensaje de la pasarela se dibuja como un bucle sobre su propia
    // caja, no como una línea de longitud cero.
    const pasarela = trazado.cajas.find((c) => c.etiqueta.includes('Pasarela'));
    const bucle = trazado.flechas.find((f) => f.rotulo.startsWith('2.1:'));
    expect(bucle?.ty).toBeLessThan(pasarela!.y);
  });
});
