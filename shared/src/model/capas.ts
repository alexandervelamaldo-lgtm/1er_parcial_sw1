import { lookupType } from './type-catalog.js';
import { pluralize, toKebabCase } from './naming.js';
import {
  isPersistent,
  listClasses,
  listRelations,
  packageForClass,
  type ClassDiagram,
  type UmlClass,
} from './uml.js';

/**
 * De qué habla cada clase con cuál, en el backend que se va a generar.
 *
 * Un diagrama de clases no tiene mensajes: tiene cajas y líneas. Derivar de él
 * un diagrama de comunicación inventando llamadas sería dibujar algo que no
 * existe en ninguna parte. Lo que sí existe, y está fijado byte a byte por las
 * plantillas de `generator/templates/`, es la cadena de llamadas de las cuatro
 * capas del backend generado: el controlador llama al servicio, el servicio al
 * repositorio y al mapeador, el mapeador construye la entidad. Ese es el origen
 * honesto, y es el que se usa aquí.
 *
 * De ahí que cada mensaje de este módulo corresponda a una sentencia literal de
 * una plantilla, y que `generator/src/comunicacion.test.ts` lo compruebe
 * generando un proyecto de verdad y buscando la llamada en el `.java` que sale.
 * Si alguien cambia una plantilla y no cambia esto, la prueba se cae: es lo que
 * impide que el visor se convierta en un dibujo bonito y desactualizado.
 *
 * Lo que este módulo **no** modela, a propósito: las asociaciones a-uno que el
 * mapeador resuelve contra el repositorio de *otra* entidad
 * (`clienteRepository.findById(...)` dentro de `PedidoMapper.update`). Esas
 * dependen del cálculo de asociaciones de `generator/src/ir/normalize.ts`, y
 * duplicar aquí esa lógica es garantizar que las dos versiones se separen. El
 * esqueleto de cuatro capas es idéntico para toda entidad; el cableado de
 * asociaciones es asunto del generador.
 */

/** Las capas del backend generado, más el llamante externo. */
export type CapaBackend =
  | 'cliente'
  | 'controller'
  | 'service'
  | 'mapper'
  | 'repository'
  | 'domain';

/** Las cinco operaciones que `controller.java.hbs` emite para toda entidad concreta. */
export type OperacionRest = 'listar' | 'obtener' | 'crear' | 'actualizar' | 'borrar';

export const OPERACIONES_REST: readonly OperacionRest[] = [
  'listar',
  'obtener',
  'crear',
  'actualizar',
  'borrar',
];

export interface ParticipanteComunicacion {
  /** Identificador corto, el que usan `de` y `a` de cada mensaje. */
  alias: string;
  /** Nombre de la clase Java, tal cual sale generada. */
  clase: string;
  capa: CapaBackend;
  /** Paquete de la clase. Vacío para el llamante externo, que no es Java. */
  paquete: string;
}

export interface MensajeComunicacion {
  /** Numeración jerárquica UML: `1`, `1.1`, `1.1.2`. */
  numero: string;
  de: string;
  a: string;
  mensaje: string;
  /** Respuesta a la llamada con ese mismo número, no una llamada nueva. */
  retorno?: boolean;
  /**
   * El fragmento literal del `.java` generado del que sale este mensaje.
   *
   * No es decoración: es lo que hace comprobable el diagrama. La prueba
   * `generator/src/comunicacion.test.ts` genera el proyecto y busca este texto
   * dentro del fichero del participante que emite el mensaje —o del controlador,
   * si el emisor es el cliente, que no es código nuestro—. Un retorno no lleva
   * evidencia porque no es una llamada.
   */
  evidencia?: string;
}

export interface EnlaceComunicacion {
  de: string;
  a: string;
}

export interface DiagramaComunicacion {
  operacion: OperacionRest;
  titulo: string;
  metodo: 'GET' | 'POST' | 'PUT' | 'DELETE';
  ruta: string;
  participantes: ParticipanteComunicacion[];
  mensajes: MensajeComunicacion[];
  /** Un enlace por par que se habla, sin repetir ni contar los auto-mensajes. */
  enlaces: EnlaceComunicacion[];
}

const CLIENTE = 'cliente';
const CONTROLADOR = 'controlador';
const SERVICIO = 'servicio';
const MAPEADOR = 'mapeador';
const REPOSITORIO = 'repositorio';
const ENTIDAD = 'entidad';

/**
 * Las clases que tienen API REST, y por tanto diagrama de comunicación.
 *
 * Mismo filtro que `generator/src/render/generate.ts`: entidad persistente y
 * concreta. Una interfaz, un enum, una clase transitoria o una abstracta no
 * generan controlador, así que no hay conversación que dibujar.
 */
export function clasesConApi(diagrama: ClassDiagram): UmlClass[] {
  return listClasses(diagrama)
    .filter((cls) => isPersistent(cls) && cls.kind === 'class')
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/** El tramo de URL de la entidad: `Pedido` → `pedidos`. Espejo de `normalize.ts`. */
export function rutaRest(cls: UmlClass): string {
  return toKebabCase(pluralize(cls.name));
}

/**
 * El tipo Java de la clave primaria, que es el del `@PathVariable`.
 *
 * Espejo de `resolveIdentifier` del generador: el atributo marcado como
 * identificador; si no lo hay, el del padre por herencia; y si tampoco, el
 * `Long` sintético que la plantilla acaba recibiendo.
 */
export function tipoDeIdentificador(diagrama: ClassDiagram, cls: UmlClass): string {
  const propio = cls.attributes.find((a) => a.isIdentifier);
  if (propio) return lookupType(propio.type.name)?.javaType ?? propio.type.name;

  const herencia = listRelations(diagrama).find(
    (r) => r.kind === 'inheritance' && r.source.classId === cls.id,
  );
  const padre = herencia ? diagrama.classes[herencia.target.classId] : undefined;
  const heredado = padre?.attributes.find((a) => a.isIdentifier);
  if (heredado) return lookupType(heredado.type.name)?.javaType ?? heredado.type.name;

  return 'Long';
}

function participantes(diagrama: ClassDiagram, cls: UmlClass): Map<string, ParticipanteComunicacion> {
  const pkg = packageForClass(diagrama, cls);
  const E = cls.name;
  return new Map<string, ParticipanteComunicacion>([
    [CLIENTE, { alias: CLIENTE, clase: 'Cliente HTTP', capa: 'cliente', paquete: '' }],
    [
      CONTROLADOR,
      { alias: CONTROLADOR, clase: `${E}Controller`, capa: 'controller', paquete: `${pkg}.controller` },
    ],
    [
      SERVICIO,
      { alias: SERVICIO, clase: `${E}ServiceImpl`, capa: 'service', paquete: `${pkg}.service.impl` },
    ],
    [
      MAPEADOR,
      { alias: MAPEADOR, clase: `${E}Mapper`, capa: 'mapper', paquete: `${pkg}.dto.mapper` },
    ],
    [
      REPOSITORIO,
      {
        alias: REPOSITORIO,
        clase: `${E}Repository`,
        capa: 'repository',
        paquete: `${pkg}.repository`,
      },
    ],
    [ENTIDAD, { alias: ENTIDAD, clase: E, capa: 'domain', paquete: `${pkg}.domain` }],
  ]);
}

interface Guion {
  titulo: string;
  metodo: DiagramaComunicacion['metodo'];
  ruta: string;
  mensajes: MensajeComunicacion[];
}

function guion(operacion: OperacionRest, E: string, id: string, ruta: string): Guion {
  const base = `/api/${ruta}`;
  const uno = `${base}/{id}`;

  switch (operacion) {
    // `findAll(Pageable)` → `repository.findAll(pageable).map(mapper::toResponse)`.
    case 'listar':
      return {
        titulo: `Listar ${E}`,
        metodo: 'GET',
        ruta: base,
        mensajes: [
          {
            numero: '1',
            de: CLIENTE,
            a: CONTROLADOR,
            mensaje: `GET ${base}`,
            evidencia: `@RequestMapping("${base}")`,
          },
          {
            numero: '1.1',
            de: CONTROLADOR,
            a: SERVICIO,
            mensaje: 'findAll(Pageable)',
            evidencia: 'service.findAll(pageable)',
          },
          {
            numero: '1.1.1',
            de: SERVICIO,
            a: REPOSITORIO,
            mensaje: 'findAll(Pageable)',
            evidencia: 'repository.findAll(pageable)',
          },
          {
            numero: '1.1.2',
            de: SERVICIO,
            a: MAPEADOR,
            mensaje: `toResponse(${E})`,
            evidencia: 'mapper::toResponse',
          },
          {
            numero: '1',
            de: CONTROLADOR,
            a: CLIENTE,
            mensaje: `200 OK · Page<${E}Response>`,
            retorno: true,
          },
        ],
      };

    // `repository.findById(id).map(mapper::toResponse).orElseThrow(...)`.
    case 'obtener':
      return {
        titulo: `Obtener un ${E}`,
        metodo: 'GET',
        ruta: uno,
        mensajes: [
          {
            numero: '1',
            de: CLIENTE,
            a: CONTROLADOR,
            mensaje: `GET ${uno}`,
            evidencia: '@GetMapping("/{id}")',
          },
          {
            numero: '1.1',
            de: CONTROLADOR,
            a: SERVICIO,
            mensaje: `findById(${id})`,
            evidencia: 'service.findById(id)',
          },
          {
            numero: '1.1.1',
            de: SERVICIO,
            a: REPOSITORIO,
            mensaje: `findById(${id})`,
            evidencia: 'repository.findById(id)',
          },
          {
            numero: '1.1.2',
            de: SERVICIO,
            a: MAPEADOR,
            mensaje: `toResponse(${E})`,
            evidencia: 'mapper::toResponse',
          },
          {
            numero: '1',
            de: CONTROLADOR,
            a: CLIENTE,
            mensaje: `200 OK · ${E}Response — o 404 ResourceNotFoundException`,
            retorno: true,
          },
        ],
      };

    // `mapper.toEntity(request)` → `new E()` + `update(entity, request)`, luego
    // `mapper.toResponse(repository.save(entity))`.
    case 'crear':
      return {
        titulo: `Crear un ${E}`,
        metodo: 'POST',
        ruta: base,
        mensajes: [
          {
            numero: '1',
            de: CLIENTE,
            a: CONTROLADOR,
            mensaje: `POST ${base} · ${E}Request`,
            evidencia: '@PostMapping',
          },
          {
            numero: '1.1',
            de: CONTROLADOR,
            a: SERVICIO,
            mensaje: `create(${E}Request)`,
            evidencia: 'service.create(request)',
          },
          {
            numero: '1.1.1',
            de: SERVICIO,
            a: MAPEADOR,
            mensaje: `toEntity(${E}Request)`,
            evidencia: 'mapper.toEntity(request)',
          },
          {
            numero: '1.1.1.1',
            de: MAPEADOR,
            a: ENTIDAD,
            mensaje: `new ${E}()`,
            evidencia: `new ${E}()`,
          },
          {
            numero: '1.1.1.2',
            de: MAPEADOR,
            a: MAPEADOR,
            mensaje: `update(${E}, ${E}Request)`,
            evidencia: 'update(entity, request)',
          },
          {
            numero: '1.1.2',
            de: SERVICIO,
            a: REPOSITORIO,
            mensaje: `save(${E})`,
            evidencia: 'repository.save(entity)',
          },
          {
            numero: '1.1.3',
            de: SERVICIO,
            a: MAPEADOR,
            mensaje: `toResponse(${E})`,
            evidencia: 'mapper.toResponse(',
          },
          {
            numero: '1',
            de: CONTROLADOR,
            a: CLIENTE,
            mensaje: '201 Created · cabecera Location',
            retorno: true,
          },
        ],
      };

    // `repository.findById(id).orElseThrow(...)`, `mapper.update(entity, request)`,
    // `mapper.toResponse(repository.save(entity))`.
    case 'actualizar':
      return {
        titulo: `Actualizar un ${E}`,
        metodo: 'PUT',
        ruta: uno,
        mensajes: [
          {
            numero: '1',
            de: CLIENTE,
            a: CONTROLADOR,
            mensaje: `PUT ${uno} · ${E}Request`,
            evidencia: '@PutMapping("/{id}")',
          },
          {
            numero: '1.1',
            de: CONTROLADOR,
            a: SERVICIO,
            mensaje: `update(${id}, ${E}Request)`,
            evidencia: 'service.update(id, request)',
          },
          {
            numero: '1.1.1',
            de: SERVICIO,
            a: REPOSITORIO,
            mensaje: `findById(${id})`,
            evidencia: 'repository.findById(id)',
          },
          {
            numero: '1.1.2',
            de: SERVICIO,
            a: MAPEADOR,
            mensaje: `update(${E}, ${E}Request)`,
            evidencia: 'mapper.update(entity, request)',
          },
          {
            numero: '1.1.3',
            de: SERVICIO,
            a: REPOSITORIO,
            mensaje: `save(${E})`,
            evidencia: 'repository.save(entity)',
          },
          {
            numero: '1.1.4',
            de: SERVICIO,
            a: MAPEADOR,
            mensaje: `toResponse(${E})`,
            evidencia: 'mapper.toResponse(',
          },
          {
            numero: '1',
            de: CONTROLADOR,
            a: CLIENTE,
            mensaje: `200 OK · ${E}Response — o 404 ResourceNotFoundException`,
            retorno: true,
          },
        ],
      };

    // `if (!repository.existsById(id)) throw ...` y `repository.deleteById(id)`.
    // No pasa por el mapeador: no hay nada que traducir.
    case 'borrar':
      return {
        titulo: `Borrar un ${E}`,
        metodo: 'DELETE',
        ruta: uno,
        mensajes: [
          {
            numero: '1',
            de: CLIENTE,
            a: CONTROLADOR,
            mensaje: `DELETE ${uno}`,
            evidencia: '@DeleteMapping("/{id}")',
          },
          {
            numero: '1.1',
            de: CONTROLADOR,
            a: SERVICIO,
            mensaje: `delete(${id})`,
            evidencia: 'service.delete(id)',
          },
          {
            numero: '1.1.1',
            de: SERVICIO,
            a: REPOSITORIO,
            mensaje: `existsById(${id})`,
            evidencia: 'repository.existsById(id)',
          },
          {
            numero: '1.1.2',
            de: SERVICIO,
            a: REPOSITORIO,
            mensaje: `deleteById(${id})`,
            evidencia: 'repository.deleteById(id)',
          },
          {
            numero: '1',
            de: CONTROLADOR,
            a: CLIENTE,
            mensaje: '204 No Content — o 404 ResourceNotFoundException',
            retorno: true,
          },
        ],
      };
  }
}

/**
 * El diagrama de comunicación de una operación REST sobre una clase.
 *
 * Solo aparecen los participantes que hablan: `borrar` no pasa por el mapeador
 * ni toca la entidad, y dibujarlos apagados al lado sugeriría una colaboración
 * que no ocurre.
 */
export function comunicacionDe(
  diagrama: ClassDiagram,
  cls: UmlClass,
  operacion: OperacionRest,
): DiagramaComunicacion {
  const todos = participantes(diagrama, cls);
  const { titulo, metodo, ruta, mensajes } = guion(
    operacion,
    cls.name,
    tipoDeIdentificador(diagrama, cls),
    rutaRest(cls),
  );

  const usados = new Set<string>();
  for (const m of mensajes) {
    usados.add(m.de);
    usados.add(m.a);
  }

  // Un enlace por par, sin dirección y sin auto-enlaces: en UML el enlace es la
  // línea, y las flechas numeradas van encima. Dos líneas entre las mismas dos
  // cajas serían dos enlaces, que es otra cosa.
  const enlaces: EnlaceComunicacion[] = [];
  const vistos = new Set<string>();
  for (const m of mensajes) {
    if (m.retorno === true || m.de === m.a) continue;
    const clave = [m.de, m.a].sort().join(' ');
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    enlaces.push({ de: m.de, a: m.a });
  }

  return {
    operacion,
    titulo,
    metodo,
    ruta,
    participantes: [...todos.values()].filter((p) => usados.has(p.alias)),
    mensajes,
    enlaces,
  };
}
