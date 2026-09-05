import { describe, expect, it } from 'vitest';
import {
  OPERACIONES_REST,
  clasesConApi,
  comunicacionDe,
  type ClassDiagram,
  type DiagramaComunicacion,
  type UmlClass,
  type UmlModule,
} from '@app/shared';
import { CORPUS, tiendaDiagram } from './fixtures/corpus.js';
import { normalize } from './ir/normalize.js';
import { generateProject } from './render/generate.js';
import type { GeneratedFile } from './ir/types.js';

/**
 * El diagrama de comunicación no se dibuja: se deriva del backend que se genera.
 *
 * Un diagrama de clases no tiene mensajes, así que cualquier «diagrama de
 * comunicación» sacado de sus relaciones sería inventado. Lo que sí tiene
 * mensajes es el proyecto Spring Boot que sale del generador, y sus llamadas
 * están fijadas por las plantillas de `generator/templates/`.
 *
 * Esta prueba es la que impide que el visor se convierta en un dibujo bonito y
 * desfasado: genera el proyecto de verdad y, para cada mensaje del diagrama,
 * busca su evidencia —el fragmento literal de Java del que sale— dentro del
 * fichero del participante que lo emite. Si alguien cambia `service-impl.java.hbs`
 * y no cambia `shared/src/model/capas.ts`, esto se cae.
 *
 * Comprobado por mutación, dos veces:
 *
 *  1. En `service-impl.java.hbs`, `repository.deleteById(id)` →
 *     `repository.delete(repository.getReferenceById(id))`. Falla:
 *     «Categoria/borrar 1.1.2: «repository.deleteById(id)» no aparece en
 *     CategoriaServiceImpl.java». Revertido.
 *  2. En `capas.ts`, hacer que `crear 1.1.1` lo emita el repositorio en vez del
 *     servicio. Falla: «mapper.toEntity(request)» no aparece en
 *     CategoriaRepository.java». Revertido.
 */

const VENTAS: UmlModule = {
  id: 'M0001',
  name: 'Ventas',
  packageSegment: 'ventas',
  description: 'Pedidos y sus líneas',
};

/** La tienda con la mitad del dominio en un módulo: los paquetes dejan de ser uno solo. */
function tiendaModular(): ClassDiagram {
  const base = tiendaDiagram();
  const dentro = new Set(['Pedido', 'LineaPedido', 'EstadoPedido']);
  return {
    ...base,
    modules: { [VENTAS.id]: VENTAS },
    classes: Object.fromEntries(
      Object.entries(base.classes).map(([id, cls]) => [
        id,
        { ...cls, moduleId: dentro.has(cls.name) ? VENTAS.id : null },
      ]),
    ),
  };
}

function indexar(files: GeneratedFile[]): Map<string, string> {
  const porRuta = new Map<string, string>();
  for (const file of files) porRuta.set(file.path, file.content);
  return porRuta;
}

function rutaDe(paquete: string, clase: string): string {
  return `src/main/java/${paquete.replace(/\./g, '/')}/${clase}.java`;
}

/**
 * El fichero donde tiene que estar la llamada.
 *
 * El emisor, salvo cuando el emisor es el cliente HTTP: ese no es código
 * nuestro, y lo que se puede comprobar de él es la anotación del controlador que
 * declara la ruta a la que llama.
 */
function ficheroEmisor(comunicacion: DiagramaComunicacion, alias: string): string {
  const efectivo = alias === 'cliente' ? 'controlador' : alias;
  const participante = comunicacion.participantes.find((p) => p.alias === efectivo);
  if (!participante) throw new Error(`El diagrama no incluye al participante «${efectivo}»`);
  return rutaDe(participante.paquete, participante.clase);
}

function comprobar(diagrama: ClassDiagram): number {
  const porRuta = indexar(generateProject(normalize(diagrama)));
  let mensajesComprobados = 0;

  for (const cls of clasesConApi(diagrama)) {
    for (const operacion of OPERACIONES_REST) {
      const comunicacion = comunicacionDe(diagrama, cls, operacion);

      // Todo participante que no sea el cliente es una clase que el generador
      // escribe, en el paquete que el diagrama dice. Es aquí donde el módulo
      // deja de ser una etiqueta también para esta pantalla.
      for (const p of comunicacion.participantes) {
        if (p.capa === 'cliente') continue;
        const ruta = rutaDe(p.paquete, p.clase);
        expect(porRuta.has(ruta), `${cls.name}/${operacion}: no se genera ${ruta}`).toBe(true);
      }

      for (const m of comunicacion.mensajes) {
        if (m.evidencia === undefined) {
          expect(m.retorno, `${cls.name}/${operacion} ${m.numero}: llamada sin evidencia`).toBe(
            true,
          );
          continue;
        }
        const ruta = ficheroEmisor(comunicacion, m.de);
        const contenido = porRuta.get(ruta);
        expect(contenido, `${cls.name}/${operacion} ${m.numero}: falta ${ruta}`).toBeDefined();
        expect(
          contenido!.includes(m.evidencia),
          `${cls.name}/${operacion} ${m.numero}: «${m.evidencia}» no aparece en ${ruta}`,
        ).toBe(true);
        mensajesComprobados += 1;
      }
    }
  }

  return mensajesComprobados;
}

describe('el diagrama de comunicación sale del backend generado', () => {
  it('cada mensaje del corpus corresponde a una llamada real del .java', () => {
    let total = 0;
    for (const entry of CORPUS) total += comprobar(entry.diagram());
    // Cinco operaciones por entidad concreta, entre cuatro y siete llamadas cada
    // una: si esto baja de golpe es que se dejó de recorrer algo.
    expect(total).toBeGreaterThan(100);
  });

  it('con el dominio repartido en módulos, los participantes cambian de paquete', () => {
    const modular = tiendaModular();
    comprobar(modular);

    const pedido = clasesConApi(modular).find((c) => c.name === 'Pedido')!;
    const paquetes = comunicacionDe(modular, pedido, 'crear')
      .participantes.filter((p) => p.capa !== 'cliente')
      .map((p) => p.paquete);
    for (const paquete of paquetes) {
      expect(paquete.startsWith(`${modular.meta.basePackage}.ventas.`)).toBe(true);
    }

    const cliente = clasesConApi(modular).find((c) => c.name === 'Cliente')!;
    const sueltos = comunicacionDe(modular, cliente, 'crear').participantes.filter(
      (p) => p.capa !== 'cliente',
    );
    for (const p of sueltos) {
      expect(p.paquete.startsWith(`${modular.meta.basePackage}.ventas`)).toBe(false);
    }
  });
});

describe('forma del diagrama', () => {
  const diagrama = tiendaDiagram();
  const pedido = clasesConApi(diagrama).find((c) => c.name === 'Pedido')!;

  it('borrar no pasa por el mapeador ni toca la entidad', () => {
    const alias = comunicacionDe(diagrama, pedido, 'borrar').participantes.map((p) => p.alias);
    expect(alias).toEqual(['cliente', 'controlador', 'servicio', 'repositorio']);
  });

  it('crear sí los usa a los seis', () => {
    const alias = comunicacionDe(diagrama, pedido, 'crear').participantes.map((p) => p.alias);
    expect(alias).toEqual([
      'cliente',
      'controlador',
      'servicio',
      'mapeador',
      'repositorio',
      'entidad',
    ]);
  });

  it('hay un enlace por par que se habla, no uno por mensaje', () => {
    const { mensajes, enlaces } = comunicacionDe(diagrama, pedido, 'actualizar');
    // Seis llamadas, pero el servicio habla dos veces con el repositorio y dos
    // con el mapeador: quedan cuatro pares —cliente/controlador,
    // controlador/servicio, servicio/repositorio y servicio/mapeador—.
    expect(mensajes.filter((m) => m.retorno !== true)).toHaveLength(6);
    expect(enlaces).toHaveLength(4);
    const claves = enlaces.map((e) => [e.de, e.a].sort().join('—'));
    expect(new Set(claves).size).toBe(enlaces.length);
  });

  it('el auto-mensaje del mapeador no crea un enlace consigo mismo', () => {
    const { enlaces } = comunicacionDe(diagrama, pedido, 'crear');
    expect(enlaces.some((e) => e.de === e.a)).toBe(false);
  });

  it('la clave primaria del diagrama es la del @PathVariable', () => {
    const porRuta = indexar(generateProject(normalize(diagrama)));
    for (const cls of clasesConApi(diagrama)) {
      const { participantes, mensajes } = comunicacionDe(diagrama, cls, 'obtener');
      const controlador = participantes.find((p) => p.capa === 'controller')!;
      const fuente = porRuta.get(rutaDe(controlador.paquete, controlador.clase))!;
      const tipo = /findById\(@PathVariable (\w+) id\)/.exec(fuente)?.[1];
      expect(mensajes.find((m) => m.numero === '1.1')!.mensaje).toBe(`findById(${tipo})`);
    }
  });

  it('las clases sin API REST no aparecen en la lista', () => {
    const nombres = new Set(clasesConApi(diagrama).map((c) => c.name));
    for (const cls of Object.values(diagrama.classes) as UmlClass[]) {
      if (cls.kind === 'enum' || cls.kind === 'interface' || cls.kind === 'abstract') {
        expect(nombres.has(cls.name), `${cls.name} no genera controlador`).toBe(false);
      }
    }
  });
});
