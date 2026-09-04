import { describe, expect, it } from 'vitest';
import { createDiagram } from '../model/factory.js';
import type { ClassDiagram } from '../model/uml.js';
import { nombreDelMensaje, operacionesPorClase, revisarModelo } from './analisis.js';
import { casoPorId, modeloDeCasosDeUso } from './casos-de-uso.js';
import { documentarCasosDeUso } from './catalogo-md.js';
import { exportarComunicacionEa, nombreDeFichero } from './ea-comunicacion.js';
import { leerXmi } from './import.js';

/**
 * El catálogo de casos de uso, comprobado de dos maneras distintas.
 *
 * La primera es la revisión estática: `revisarModelo` mira los catorce casos y
 * dice qué está mal sin dibujar nada. La segunda es la vuelta entera: se genera
 * el `.xmi` de cada caso y se vuelve a leer con nuestro propio importador, que es
 * el mismo que lee los ficheros de Enterprise Architect. Si un participante o un
 * mensaje se pierde por el camino, aquí se ve.
 *
 * Lo que **no** se comprueba aquí es que la herramienta lo dibuje bien. Eso vive
 * en `ea-comunicacion.test.ts`, que mira el bloque de extensión —la geometría,
 * los `message_link`, los rótulos— porque es lo único que hace que EA pinte el
 * diagrama en vez de dejar los elementos sueltos en el árbol del proyecto.
 */

const vacio = (): ClassDiagram => createDiagram({ name: 'Proyecto' });

describe('el catálogo de los catorce casos de uso', () => {
  it('pasa la revisión entera sin un solo problema', () => {
    // Se compara contra la lista completa y no contra su longitud: cuando esto
    // falle, el mensaje del fallo tiene que decir *qué* está mal, no cuántas
    // cosas.
    expect(revisarModelo(modeloDeCasosDeUso)).toEqual([]);
  });

  it('y la revisión no está pasando de largo: rompiendo un caso, salta', () => {
    /*
     * Un validador que siempre devuelve la lista vacía pasa la prueba de arriba
     * sin comprobar nada, y es un fallo que no se ve nunca porque su síntoma es
     * el éxito. Así que se le da algo roto a propósito y se exige que lo diga.
     *
     * Los tres desperfectos son de familias distintas —uno de participantes, uno
     * de pasos y uno de actividad— para que la prueba siga valiendo si mañana
     * alguien toca una sola de las tres ramas de `revisarModelo`.
     */
    const [caso, ...resto] = modeloDeCasosDeUso.casos;
    const roto = {
      ...modeloDeCasosDeUso,
      casos: [
        {
          ...caso!,
          paquete: 'Un paquete que no existe',
          pasos: [...caso!.pasos, { numero: '99', de: 'nadie', a: 'tampoco', mensaje: 'sin firma' }],
          actividad: { ...caso!.actividad, nodos: caso!.actividad.nodos.slice(1) },
        },
        ...resto,
      ],
    };

    const problemas = revisarModelo(roto).map((p) => p.mensaje).join('\n');
    expect(problemas).toContain('no está declarado');
    expect(problemas).toContain('no tiene forma de llamada');
    expect(problemas).toContain('exactamente un nodo de inicio');
  });

  it('son catorce, numerados del CU1 al CU14', () => {
    const ids = modeloDeCasosDeUso.casos.map((c) => c.id);
    expect(ids).toEqual(Array.from({ length: 14 }, (_, i) => `CU${i + 1}`));
  });

  it('cada caso pertenece a un paquete declarado y ninguno se queda vacío', () => {
    const usados = new Set(modeloDeCasosDeUso.casos.map((c) => c.paquete));
    for (const paquete of modeloDeCasosDeUso.paquetes) {
      expect(usados, `el paquete «${paquete.nombre}» no tiene ningún caso`).toContain(
        paquete.nombre,
      );
    }
  });

  it('todo participante que no sea un actor dice de qué fichero sale', () => {
    /*
     * Es la comprobación que separa el análisis de una redacción paralela al
     * sistema. Un `GestorDeCosas` sin `origen` es un participante inventado: se
     * dibuja bien, se defiende mal y nadie encuentra el código detrás.
     *
     * Los actores quedan fuera porque son personas y no salen de ningún fichero,
     * salvo el operador del servidor, que sí lo tiene porque su interfaz es una
     * orden de consola concreta.
     */
    const huerfanos: string[] = [];
    for (const caso of modeloDeCasosDeUso.casos) {
      for (const p of caso.participantes) {
        if (p.estereotipo === 'actor') continue;
        if (p.origen === undefined) huerfanos.push(`${caso.id}: ${p.clase}`);
      }
    }
    expect(huerfanos).toEqual([]);
  });

  it('cada caso tiene al menos un flujo alternativo escrito', () => {
    // Un caso de uso con solo el camino feliz no se ha pensado: se ha copiado de
    // la pantalla.
    for (const caso of modeloDeCasosDeUso.casos) {
      expect(caso.alternativos.length, `${caso.id} no tiene alternativos`).toBeGreaterThan(0);
    }
  });

  it('la actividad de cada caso se bifurca en algún sitio', () => {
    for (const caso of modeloDeCasosDeUso.casos) {
      const decisiones = caso.actividad.nodos.filter((n) => n.tipo === 'decision');
      expect(decisiones.length, `${caso.id} no decide nada`).toBeGreaterThan(0);
    }
  });

  it('las calles de la actividad son dos: el actor y el sistema', () => {
    for (const caso of modeloDeCasosDeUso.casos) {
      const calles = new Set(caso.actividad.nodos.map((n) => n.calle));
      expect([...calles].sort(), `${caso.id}`).toHaveLength(2);
      expect(calles, `${caso.id} no tiene calle de sistema`).toContain('Sistema');
    }
  });

  it('`casoPorId` encuentra los que existen y no inventa los que no', () => {
    expect(casoPorId('CU9')?.nombre).toBe('Importar un diagrama desde una foto');
    expect(casoPorId('CU99')).toBeUndefined();
  });
});

describe('los catorce, generados y vueltos a leer', () => {
  it('cada caso produce un XMI que nuestro importador entiende', () => {
    for (const caso of modeloDeCasosDeUso.casos) {
      const resultado = leerXmi(exportarComunicacionEa(caso), vacio());

      expect(resultado.aplicable, `${caso.id} no se pudo importar`).toBe(true);
      expect(resultado.comunicacion, `${caso.id} no se reconoce como comunicación`).toBe(true);
      expect(
        resultado.avisos.filter((a) => a.severidad === 'error'),
        `${caso.id} dio errores al releerse`,
      ).toEqual([]);
    }
  });

  it('no se pierde ningún participante por el camino', () => {
    for (const caso of modeloDeCasosDeUso.casos) {
      const resultado = leerXmi(exportarComunicacionEa(caso), vacio());
      for (const participante of caso.participantes) {
        expect(resultado.clases, `${caso.id}: falta ${participante.clase}`).toContain(
          participante.clase,
        );
      }
    }
  });

  it('cada mensaje de ida llega como operación de la clase que lo recibe', () => {
    /*
     * Esta es la comprobación que de verdad importa, porque es la que se rompería
     * en silencio: un XMI al que le faltan mensajes se importa igual, se dibuja
     * igual de bonito y solo se nota leyendo los rótulos uno a uno.
     *
     * Los retornos no cuentan: la operación la creó la llamada de ida, y
     * contarlos dos veces inventaría un método con el nombre del valor devuelto.
     */
    for (const caso of modeloDeCasosDeUso.casos) {
      const resultado = leerXmi(exportarComunicacionEa(caso), vacio());
      const importadas = new Set(
        resultado.operaciones
          .filter((o) => o.op === 'addMethod')
          .map((o) => (o.op === 'addMethod' ? o.name : '')),
      );

      for (const [, operaciones] of operacionesPorClase(caso)) {
        for (const operacion of operaciones) {
          expect(importadas, `${caso.id}: se perdió ${operacion.nombre}`).toContain(
            operacion.nombre,
          );
        }
      }
    }
  });

  it('el rótulo de cada paso viaja con su número de secuencia', () => {
    for (const caso of modeloDeCasosDeUso.casos) {
      const xmi = exportarComunicacionEa(caso);
      for (const paso of caso.pasos) {
        expect(xmi, `${caso.id}: falta el rótulo del paso ${paso.numero}`).toContain(
          `${paso.numero}: ${paso.mensaje}`,
        );
      }
    }
  });

  it('los catorce ficheros se llaman distinto', () => {
    const nombres = modeloDeCasosDeUso.casos.map((c) => nombreDeFichero(c, 'comunicacion'));
    expect(new Set(nombres).size).toBe(nombres.length);
    expect(nombres[0]).toBe('CU1-comunicacion.xmi');
  });

  it('dos casos distintos no comparten ni un identificador propio', () => {
    /*
     * Si dos ficheros repitieran un `EAID_`, importarlos los dos en el mismo
     * proyecto de EA haría que el segundo pisara al primero: la herramienta cree
     * que es el mismo elemento. Se filtran los `EA…` constantes —los tipos
     * primitivos y su paquete— porque esos los comparte a propósito el propio EA.
     */
    const propios = (caso: (typeof modeloDeCasosDeUso.casos)[number]): Set<string> => {
      const xmi = exportarComunicacionEa(caso);
      return new Set([...xmi.matchAll(/"(EA(?:ID|PK)_[0-9A-F_]+)"/g)].map((m) => m[1] ?? ''));
    };

    const primero = propios(modeloDeCasosDeUso.casos[0]!);
    const segundo = propios(modeloDeCasosDeUso.casos[1]!);
    const compartidos = [...primero].filter((id) => segundo.has(id));

    expect(compartidos).toEqual([]);
  });

  it('el mismo caso genera dos veces exactamente el mismo fichero', () => {
    // Sin esto, cada regeneración sería un diff entero en el repositorio y
    // dejaría de poder verse qué cambió de verdad.
    const caso = casoPorId('CU8')!;
    expect(exportarComunicacionEa(caso)).toBe(exportarComunicacionEa(caso));
  });

  it('el documento generado dice lo mismo que los diagramas', () => {
    /*
     * `docs/08-casos-de-uso.md` sale del mismo catálogo que los `.xmi`, y esta
     * prueba es lo que hace que eso siga siendo verdad: si alguien renumerase un
     * paso solo en el documento —o el documento dejara de renderizar una parte
     * del caso— aquí se ve.
     *
     * Se comprueba el contenido y no una copia guardada del fichero: una prueba
     * de instantánea sobre un documento de mil líneas se actualiza a ciegas con
     * `-u` y deja de comprobar nada.
     */
    const documento = documentarCasosDeUso(modeloDeCasosDeUso);

    for (const caso of modeloDeCasosDeUso.casos) {
      expect(documento).toContain(`## ${caso.id} — ${caso.nombre}`);
      expect(documento, `${caso.id}: falta la precondición`).toContain(caso.precondicion);

      for (const paso of caso.pasos) {
        expect(documento, `${caso.id}: falta el paso ${paso.numero}`).toContain(paso.mensaje);
      }
      for (const alternativo of caso.alternativos) {
        expect(documento, `${caso.id}: falta «${alternativo.nombre}»`).toContain(
          alternativo.nombre,
        );
      }
      for (const participante of caso.participantes) {
        if (participante.origen === undefined) continue;
        expect(documento, `${caso.id}: falta el origen de ${participante.clase}`).toContain(
          participante.origen,
        );
      }
    }

    // Y avisa de que no se edita a mano, que es la parte que se olvida.
    expect(documento).toContain('npm run diagramas');
  });

  it('las guardas de las decisiones llegan al documento con su condición', () => {
    // Una rama sin condición escrita es un diagrama de actividad que no se puede
    // seguir. `revisarModelo` ya lo impide en los datos; esto comprueba que
    // tampoco se pierde al escribirlo.
    const documento = documentarCasosDeUso(modeloDeCasosDeUso);
    const guardas = modeloDeCasosDeUso.casos.flatMap((c) =>
      c.actividad.flujos.map((f) => f.guarda).filter((g): g is string => g !== undefined),
    );

    expect(guardas.length).toBeGreaterThan(0);
    for (const guarda of new Set(guardas)) {
      expect(documento).toContain(`**[${guarda}]**`);
    }
  });

  it('ningún nombre de mensaje se cuela con caracteres que rompan el XML', () => {
    // RNF-SEG-06 en su forma más sencilla: los nombres los escribimos nosotros,
    // pero la comprobación cuesta poco y una errata con un `<` saldría del
    // fichero como XML roto en vez de como un nombre raro.
    for (const caso of modeloDeCasosDeUso.casos) {
      for (const paso of caso.pasos) {
        expect(nombreDelMensaje(paso.mensaje), `${caso.id} paso ${paso.numero}`).toMatch(
          /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ _-]*$/,
        );
      }
    }
  });
});
