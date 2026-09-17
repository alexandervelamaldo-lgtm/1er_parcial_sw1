import { describe, expect, it } from 'vitest';
import {
  createAttribute,
  createClass,
  createDiagram,
  createRelation,
} from '../model/factory.js';
import type { ClassDiagram, UmlClass, UmlRelation } from '../model/uml.js';
import { resumirRevision, revisarDiagrama, type CodigoRevision } from './revision.js';

/**
 * El revisor de modelado, comprobado regla a regla y sobre un diagrama de
 * verdad.
 *
 * Las pruebas de aquí abajo tienen dos mitades con intención distinta. La
 * primera aísla cada regla: un diagrama mínimo que la dispara y, junto a él, el
 * caso vecino que **no** debe dispararla. Esa segunda mitad de cada par es la
 * que importa, porque el peligro de un revisor no es callarse, es hablar de más:
 * un aviso que no corresponde a un problema enseña a ignorar los avisos, y el
 * día que uno sea de verdad también se ignorará.
 *
 * La segunda mitad monta el diagrama de biblioteca que trajo esta funcionalidad
 * —el de la captura, con `LibraryManagementSystem`, `LibraryDatabase`, `User` y
 * sus subclases— y comprueba qué encuentra el revisor en él. No afirma que sean
 * «los dos errores» que busca el profesor: eso no está en ningún fichero. Afirma
 * que las reglas se disparan donde tienen que dispararse.
 */

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function diagrama(clases: UmlClass[], relaciones: UmlRelation[] = []): ClassDiagram {
  return createDiagram({
    name: 'Prueba',
    classes: Object.fromEntries(clases.map((c) => [c.id, c])),
    relations: Object.fromEntries(relaciones.map((r) => [r.id, r])),
  });
}

/** Los códigos encontrados, para afirmar sobre el conjunto y no sobre el orden. */
function codigos(d: ClassDiagram): CodigoRevision[] {
  return revisarDiagrama(d).map((h) => h.codigo);
}

// ---------------------------------------------------------------------------
// Regla a regla
// ---------------------------------------------------------------------------

describe('atributos que la subclase vuelve a declarar', () => {
  it('señala el atributo que ya está en el padre', () => {
    const usuario = createClass({
      id: 'C1',
      name: 'Usuario',
      attributes: [createAttribute({ id: 'A1', name: 'nombre', type: 'String' })],
    });
    const socio = createClass({
      id: 'C2',
      name: 'Socio',
      attributes: [createAttribute({ id: 'A2', name: 'nombre', type: 'String' })],
    });
    const herencia = createRelation({
      id: 'R1',
      kind: 'inheritance',
      sourceId: 'C2',
      targetId: 'C1',
    });

    const hallazgos = revisarDiagrama(diagrama([usuario, socio], [herencia]));
    const repetido = hallazgos.filter((h) => h.codigo === 'ATRIBUTO_HEREDADO_REPETIDO');
    expect(repetido).toHaveLength(1);
    expect(repetido[0]?.gravedad).toBe('error');
    expect(repetido[0]?.classId).toBe('C2');
    // El mensaje nombra las dos clases y el atributo: sin eso hay que ir a
    // buscar a mano de dónde venía la duplicidad.
    expect(repetido[0]?.titulo).toContain('Socio');
    expect(repetido[0]?.titulo).toContain('Usuario');
    expect(repetido[0]?.titulo).toContain('nombre');
  });

  it('lo encuentra también dos niveles más arriba', () => {
    const a = createClass({
      id: 'C1',
      name: 'Persona',
      attributes: [createAttribute({ id: 'A1', name: 'id', type: 'Long' })],
    });
    const b = createClass({ id: 'C2', name: 'Usuario' });
    const c = createClass({
      id: 'C3',
      name: 'Bibliotecario',
      attributes: [createAttribute({ id: 'A2', name: 'id', type: 'Long' })],
    });

    const d = diagrama(
      [a, b, c],
      [
        createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' }),
        createRelation({ id: 'R2', kind: 'inheritance', sourceId: 'C3', targetId: 'C2' }),
      ],
    );
    expect(codigos(d)).toContain('ATRIBUTO_HEREDADO_REPETIDO');
  });

  /*
    Dos clases hermanas con el mismo nombre de atributo no tienen nada que ver
    entre sí. Si esto se disparara, cualquier diagrama con dos `nombre` sueltos
    saldría en rojo.
  */
  it('no dice nada si las clases no están emparentadas', () => {
    const a = createClass({
      id: 'C1',
      name: 'Libro',
      attributes: [createAttribute({ id: 'A1', name: 'titulo', type: 'String' })],
    });
    const b = createClass({
      id: 'C2',
      name: 'Revista',
      attributes: [createAttribute({ id: 'A2', name: 'titulo', type: 'String' })],
    });
    expect(codigos(diagrama([a, b]))).not.toContain('ATRIBUTO_HEREDADO_REPETIDO');
  });

  /*
    Un ciclo de herencia es un diagrama que el generador rechaza, pero existe a
    medio dibujar y esto se ejecuta mientras se dibuja. Si el recorrido de
    ancestros no cortara, colgaría la pestaña.
  */
  it('no se queda dando vueltas en un ciclo de herencia', () => {
    const a = createClass({ id: 'C1', name: 'A' });
    const b = createClass({ id: 'C2', name: 'B' });
    const d = diagrama(
      [a, b],
      [
        createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C1', targetId: 'C2' }),
        createRelation({ id: 'R2', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' }),
      ],
    );
    expect(() => revisarDiagrama(d)).not.toThrow();
  });
});

describe('clases vacías', () => {
  it('una clase suelta y sin nada dentro es un error', () => {
    const vacia = createClass({ id: 'C1', name: 'Cuenta' });
    const otra = createClass({
      id: 'C2',
      name: 'Libro',
      attributes: [createAttribute({ id: 'A1', name: 'titulo', type: 'String' })],
    });
    const d = diagrama(
      [vacia, otra],
      [createRelation({ id: 'R1', kind: 'association', sourceId: 'C1', targetId: 'C2' })],
    );
    const hallazgo = revisarDiagrama(d).find((h) => h.codigo === 'CLASE_SIN_CONTENIDO');
    expect(hallazgo?.gravedad).toBe('error');
    expect(hallazgo?.classId).toBe('C1');
  });

  /*
    Una subclase vacía puede ser legítima: marca un tipo dentro de la jerarquía.
    Baja a aviso, no desaparece, porque casi siempre es la caja que se dibujó y
    se olvidó rellenar.
  */
  it('si hereda, baja a aviso', () => {
    const padre = createClass({
      id: 'C1',
      name: 'Usuario',
      attributes: [createAttribute({ id: 'A1', name: 'nombre', type: 'String' })],
    });
    const hija = createClass({ id: 'C2', name: 'Estudiante' });
    const d = diagrama(
      [padre, hija],
      [createRelation({ id: 'R1', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' })],
    );
    const hallazgo = revisarDiagrama(d).find((h) => h.codigo === 'CLASE_SIN_CONTENIDO');
    expect(hallazgo?.gravedad).toBe('aviso');
  });

  it('una clase con solo métodos no está vacía', () => {
    const a = createClass({ id: 'C1', name: 'Calculadora', methods: [] });
    expect(codigos(diagrama([a]))).toContain('CLASE_SIN_CONTENIDO');
  });

  /*
    Una interfaz sin atributos es lo normal, no un hallazgo. Lo mismo un enum:
    lo que lleva dentro son literales.
  */
  it('las interfaces y los enums no cuentan', () => {
    const interfaz = createClass({ id: 'C1', name: 'Prestable', kind: 'interface' });
    const enumerado = createClass({
      id: 'C2',
      name: 'Estado',
      kind: 'enum',
      literals: ['LIBRE', 'PRESTADO'],
    });
    expect(codigos(diagrama([interfaz, enumerado]))).not.toContain('CLASE_SIN_CONTENIDO');
  });
});

describe('composición compartida', () => {
  it('una parte con dos dueños es un error', () => {
    const pedido = createClass({ id: 'C1', name: 'Pedido' });
    const factura = createClass({ id: 'C2', name: 'Factura' });
    const linea = createClass({
      id: 'C3',
      name: 'Linea',
      attributes: [createAttribute({ id: 'A1', name: 'cantidad', type: 'Integer' })],
    });
    const d = diagrama(
      [pedido, factura, linea],
      [
        createRelation({ id: 'R1', kind: 'composition', sourceId: 'C1', targetId: 'C3' }),
        createRelation({ id: 'R2', kind: 'composition', sourceId: 'C2', targetId: 'C3' }),
      ],
    );
    const hallazgo = revisarDiagrama(d).find((h) => h.codigo === 'COMPOSICION_COMPARTIDA');
    expect(hallazgo?.gravedad).toBe('error');
    expect(hallazgo?.classId).toBe('C3');
    expect(hallazgo?.detalle).toContain('Pedido');
    expect(hallazgo?.detalle).toContain('Factura');
  });

  /*
    Un todo con varias partes distintas es lo normal: un pedido compuesto de
    líneas y de una dirección de envío.
  */
  it('un dueño con varias partes distintas está bien', () => {
    const pedido = createClass({ id: 'C1', name: 'Pedido' });
    const linea = createClass({ id: 'C2', name: 'Linea' });
    const envio = createClass({ id: 'C3', name: 'Envio' });
    const d = diagrama(
      [pedido, linea, envio],
      [
        createRelation({ id: 'R1', kind: 'composition', sourceId: 'C1', targetId: 'C2' }),
        createRelation({ id: 'R2', kind: 'composition', sourceId: 'C1', targetId: 'C3' }),
      ],
    );
    expect(codigos(d)).not.toContain('COMPOSICION_COMPARTIDA');
  });

  it('una agregación además de la composición no cuenta como segundo dueño', () => {
    const pedido = createClass({ id: 'C1', name: 'Pedido' });
    const catalogo = createClass({ id: 'C2', name: 'Catalogo' });
    const linea = createClass({ id: 'C3', name: 'Linea' });
    const d = diagrama(
      [pedido, catalogo, linea],
      [
        createRelation({ id: 'R1', kind: 'composition', sourceId: 'C1', targetId: 'C3' }),
        createRelation({ id: 'R2', kind: 'aggregation', sourceId: 'C2', targetId: 'C3' }),
      ],
    );
    expect(codigos(d)).not.toContain('COMPOSICION_COMPARTIDA');
  });
});

describe('atributos que en realidad son relaciones', () => {
  it('un texto que menciona otra clase del diagrama', () => {
    const biblioteca = createClass({
      id: 'C1',
      name: 'Biblioteca',
      attributes: [createAttribute({ id: 'A1', name: 'listOfBooks', type: 'String' })],
    });
    const libro = createClass({
      id: 'C2',
      name: 'Book',
      attributes: [createAttribute({ id: 'A2', name: 'title', type: 'String' })],
    });
    const hallazgo = revisarDiagrama(diagrama([biblioteca, libro])).find(
      (h) => h.codigo === 'ATRIBUTO_QUE_ES_RELACION',
    );
    expect(hallazgo?.classId).toBe('C1');
    expect(hallazgo?.titulo).toContain('Book');
  });

  it('un solo aviso aunque el nombre mencione la clase dos veces', () => {
    const a = createClass({
      id: 'C1',
      name: 'Biblioteca',
      attributes: [createAttribute({ id: 'A1', name: 'bookToBookMap', type: 'String' })],
    });
    const b = createClass({ id: 'C2', name: 'Book' });
    const hallazgos = revisarDiagrama(diagrama([a, b])).filter(
      (h) => h.codigo === 'ATRIBUTO_QUE_ES_RELACION',
    );
    expect(hallazgos).toHaveLength(1);
  });

  /*
    Si el atributo ya está tipado con la clase, está bien puesto. Este es el
    caso vecino más peligroso: sin la condición sobre el tipo, la regla
    denunciaría precisamente los modelos correctos.
  */
  it('no dice nada si el tipo ya es la clase', () => {
    const a = createClass({
      id: 'C1',
      name: 'Prestamo',
      attributes: [createAttribute({ id: 'A1', name: 'book', type: 'Book' })],
    });
    const b = createClass({ id: 'C2', name: 'Book' });
    expect(codigos(diagrama([a, b]))).not.toContain('ATRIBUTO_QUE_ES_RELACION');
  });

  /*
    «Cuántos libros» menciona a `Book` y no es un enlace con `Book`: es un
    contador, un valor derivado de la asociación. Sin este freno, cualquier
    `numeroDePedidos` saldría marcado como relación mal puesta, que es el falso
    positivo que más rápido enseña a ignorar la pantalla entera. Lo que sí le
    pasa —estar guardado como texto— lo dice la otra regla.
  */
  it('una cuenta de algo no es una relación con ese algo', () => {
    const a = createClass({
      id: 'C1',
      name: 'Account',
      attributes: [createAttribute({ id: 'A1', name: 'noOfBooksIssued', type: 'String' })],
    });
    const b = createClass({ id: 'C2', name: 'Book' });
    const encontrados = codigos(diagrama([a, b]));
    expect(encontrados).not.toContain('ATRIBUTO_QUE_ES_RELACION');
    expect(encontrados).toContain('TIPO_SOSPECHOSO');
  });

  it('un atributo que menciona su propia clase no es una relación consigo mismo', () => {
    const a = createClass({
      id: 'C1',
      name: 'Book',
      attributes: [createAttribute({ id: 'A1', name: 'bookTitle', type: 'String' })],
    });
    expect(codigos(diagrama([a]))).not.toContain('ATRIBUTO_QUE_ES_RELACION');
  });
});

describe('tipos que el nombre desmiente', () => {
  it('un importe guardado como texto', () => {
    const a = createClass({
      id: 'C1',
      name: 'Multa',
      attributes: [createAttribute({ id: 'A1', name: 'fineAmount', type: 'String' })],
    });
    const hallazgo = revisarDiagrama(diagrama([a])).find((h) => h.codigo === 'TIPO_SOSPECHOSO');
    expect(hallazgo?.titulo).toContain('Decimal');
  });

  it('una fecha guardada como texto', () => {
    const a = createClass({
      id: 'C1',
      name: 'Prestamo',
      attributes: [createAttribute({ id: 'A1', name: 'dueDate', type: 'String' })],
    });
    const hallazgo = revisarDiagrama(diagrama([a])).find((h) => h.codigo === 'TIPO_SOSPECHOSO');
    expect(hallazgo?.titulo).toContain('Date');
  });

  it('un contador guardado como texto', () => {
    const a = createClass({
      id: 'C1',
      name: 'Socio',
      attributes: [createAttribute({ id: 'A1', name: 'noOfBooks', type: 'String' })],
    });
    const hallazgo = revisarDiagrama(diagrama([a])).find((h) => h.codigo === 'TIPO_SOSPECHOSO');
    expect(hallazgo?.titulo).toContain('Integer');
  });

  /*
    `no` a secas es una negación tan a menudo como un número. La familia de los
    enteros exige nombre compuesto justo por esto.
  */
  it('un «no» suelto no se toma por un contador', () => {
    const a = createClass({
      id: 'C1',
      name: 'Socio',
      attributes: [createAttribute({ id: 'A1', name: 'no', type: 'String' })],
    });
    expect(codigos(diagrama([a]))).not.toContain('TIPO_SOSPECHOSO');
  });

  it('el tipo correcto no se denuncia', () => {
    const a = createClass({
      id: 'C1',
      name: 'Multa',
      attributes: [
        createAttribute({ id: 'A1', name: 'fineAmount', type: 'Decimal' }),
        createAttribute({ id: 'A2', name: 'dueDate', type: 'Date' }),
        createAttribute({ id: 'A3', name: 'noOfBooks', type: 'Integer' }),
        createAttribute({ id: 'A4', name: 'activo', type: 'Boolean' }),
      ],
    });
    expect(codigos(diagrama([a]))).not.toContain('TIPO_SOSPECHOSO');
  });

  /*
    Un entero guardado como `Long` en vez de `Integer` no es un problema; lo
    que se denuncia es guardarlo como texto. La lista de aceptados existe para
    esto.
  */
  it('un contador en Long tampoco se denuncia', () => {
    const a = createClass({
      id: 'C1',
      name: 'Socio',
      attributes: [createAttribute({ id: 'A1', name: 'noOfBooks', type: 'Long' })],
    });
    expect(codigos(diagrama([a]))).not.toContain('TIPO_SOSPECHOSO');
  });

  it('un nombre corriente no dispara nada', () => {
    const a = createClass({
      id: 'C1',
      name: 'Libro',
      attributes: [
        createAttribute({ id: 'A1', name: 'titulo', type: 'String' }),
        createAttribute({ id: 'A2', name: 'autor', type: 'String' }),
        createAttribute({ id: 'A3', name: 'isbn', type: 'String' }),
      ],
    });
    expect(codigos(diagrama([a]))).not.toContain('TIPO_SOSPECHOSO');
  });
});

describe('clases aisladas', () => {
  it('una clase sin ninguna relación', () => {
    const a = createClass({
      id: 'C1',
      name: 'Libro',
      attributes: [createAttribute({ id: 'A1', name: 'titulo', type: 'String' })],
    });
    const b = createClass({
      id: 'C2',
      name: 'Sobrante',
      attributes: [createAttribute({ id: 'A2', name: 'campo', type: 'String' })],
    });
    const c = createClass({
      id: 'C3',
      name: 'Autor',
      attributes: [createAttribute({ id: 'A3', name: 'apellido', type: 'String' })],
    });
    const d = diagrama(
      [a, b, c],
      [createRelation({ id: 'R1', kind: 'association', sourceId: 'C1', targetId: 'C3' })],
    );
    const hallazgo = revisarDiagrama(d).find((h) => h.codigo === 'CLASE_AISLADA');
    expect(hallazgo?.classId).toBe('C2');
  });

  /*
    Un diagrama de una sola clase no tiene con qué relacionarse. Avisar ahí
    sería regañar a quien acaba de empezar.
  */
  it('con una sola clase no hay nada que decir', () => {
    const a = createClass({
      id: 'C1',
      name: 'Libro',
      attributes: [createAttribute({ id: 'A1', name: 'titulo', type: 'String' })],
    });
    expect(codigos(diagrama([a]))).not.toContain('CLASE_AISLADA');
  });
});

describe('clases que son el programa y no el negocio', () => {
  it.each([
    ['LibraryManagementSystem', 'system'],
    ['LibraryDatabase', 'database'],
    ['PedidoService', 'service'],
    ['PantallaPrincipal', 'pantalla'],
  ])('%s se señala por «%s»', (nombre) => {
    const a = createClass({
      id: 'C1',
      name: nombre,
      attributes: [createAttribute({ id: 'A1', name: 'campo', type: 'String' })],
    });
    expect(codigos(diagrama([a]))).toContain('CLASE_NO_ES_DEL_DOMINIO');
  });

  it('una entidad corriente no se señala', () => {
    const a = createClass({
      id: 'C1',
      name: 'Libro',
      attributes: [createAttribute({ id: 'A1', name: 'titulo', type: 'String' })],
    });
    expect(codigos(diagrama([a]))).not.toContain('CLASE_NO_ES_DEL_DOMINIO');
  });
});

describe('relaciones repetidas', () => {
  it('dos asociaciones iguales y sin rol', () => {
    const a = createClass({ id: 'C1', name: 'Persona' });
    const b = createClass({ id: 'C2', name: 'Libro' });
    const d = diagrama(
      [a, b],
      [
        createRelation({ id: 'R1', kind: 'association', sourceId: 'C1', targetId: 'C2' }),
        createRelation({ id: 'R2', kind: 'association', sourceId: 'C1', targetId: 'C2' }),
      ],
    );
    const hallazgos = revisarDiagrama(d).filter((h) => h.codigo === 'RELACION_DUPLICADA');
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]?.relationId).toBe('R2');
  });

  it('da igual en qué sentido se dibujaran', () => {
    const a = createClass({ id: 'C1', name: 'Persona' });
    const b = createClass({ id: 'C2', name: 'Libro' });
    const d = diagrama(
      [a, b],
      [
        createRelation({ id: 'R1', kind: 'association', sourceId: 'C1', targetId: 'C2' }),
        createRelation({ id: 'R2', kind: 'association', sourceId: 'C2', targetId: 'C1' }),
      ],
    );
    expect(codigos(d)).toContain('RELACION_DUPLICADA');
  });

  /*
    Dos asociaciones entre las mismas clases son correctas si dicen cosas
    distintas: `autor` y `revisor` son dos hechos, no una línea repetida. El rol
    es lo que las distingue, y es la condición que evita el falso positivo.
  */
  it('con rol son dos hechos distintos y se respetan', () => {
    const a = createClass({ id: 'C1', name: 'Persona' });
    const b = createClass({ id: 'C2', name: 'Libro' });
    const d = diagrama(
      [a, b],
      [
        createRelation({
          id: 'R1',
          kind: 'association',
          sourceId: 'C1',
          targetId: 'C2',
          sourceRole: 'autor',
        }),
        createRelation({
          id: 'R2',
          kind: 'association',
          sourceId: 'C1',
          targetId: 'C2',
          sourceRole: 'revisor',
        }),
      ],
    );
    expect(codigos(d)).not.toContain('RELACION_DUPLICADA');
  });

  it('una asociación y una herencia entre el mismo par no son la misma línea', () => {
    const a = createClass({ id: 'C1', name: 'Persona' });
    const b = createClass({ id: 'C2', name: 'Empleado' });
    const d = diagrama(
      [a, b],
      [
        createRelation({ id: 'R1', kind: 'association', sourceId: 'C1', targetId: 'C2' }),
        createRelation({ id: 'R2', kind: 'inheritance', sourceId: 'C2', targetId: 'C1' }),
      ],
    );
    expect(codigos(d)).not.toContain('RELACION_DUPLICADA');
  });
});

describe('muchos a muchos', () => {
  it('se sugiere la clase intermedia, sin exigirla', () => {
    const a = createClass({ id: 'C1', name: 'Socio' });
    const b = createClass({ id: 'C2', name: 'Libro' });
    const d = diagrama(
      [a, b],
      [
        createRelation({
          id: 'R1',
          kind: 'association',
          sourceId: 'C1',
          targetId: 'C2',
          sourceMultiplicity: '*',
          targetMultiplicity: '*',
        }),
      ],
    );
    const hallazgo = revisarDiagrama(d).find((h) => h.codigo === 'MUCHOS_A_MUCHOS_SIN_CLASE');
    expect(hallazgo?.gravedad).toBe('sugerencia');
    expect(hallazgo?.relationId).toBe('R1');
  });

  it('un uno a muchos no se toca', () => {
    const a = createClass({ id: 'C1', name: 'Socio' });
    const b = createClass({ id: 'C2', name: 'Libro' });
    const d = diagrama(
      [a, b],
      [
        createRelation({
          id: 'R1',
          kind: 'association',
          sourceId: 'C1',
          targetId: 'C2',
          sourceMultiplicity: '1',
          targetMultiplicity: '*',
        }),
      ],
    );
    expect(codigos(d)).not.toContain('MUCHOS_A_MUCHOS_SIN_CLASE');
  });
});

// ---------------------------------------------------------------------------
// El orden y el resumen
// ---------------------------------------------------------------------------

describe('la lista', () => {
  it('pone los errores delante y las sugerencias al final', () => {
    const a = createClass({ id: 'C1', name: 'Socio' });
    const b = createClass({ id: 'C2', name: 'Libro' });
    const d = diagrama(
      [a, b],
      [
        createRelation({
          id: 'R1',
          kind: 'association',
          sourceId: 'C1',
          targetId: 'C2',
          sourceMultiplicity: '*',
          targetMultiplicity: '*',
        }),
      ],
    );
    const gravedades = revisarDiagrama(d).map((h) => h.gravedad);
    expect(gravedades[0]).toBe('error');
    expect(gravedades.at(-1)).toBe('sugerencia');
  });

  it('el mismo diagrama da la misma lista en el mismo orden', () => {
    const d = biblioteca();
    expect(revisarDiagrama(d)).toEqual(revisarDiagrama(d));
  });

  it('un diagrama vacío no encuentra nada', () => {
    expect(revisarDiagrama(createDiagram({ name: 'Vacio' }))).toEqual([]);
  });

  it('el resumen cuenta por gravedad', () => {
    const cuenta = resumirRevision(revisarDiagrama(biblioteca()));
    expect(cuenta.error + cuenta.aviso + cuenta.sugerencia).toBe(
      revisarDiagrama(biblioteca()).length,
    );
  });
});

// ---------------------------------------------------------------------------
// El diagrama de biblioteca que motivó todo esto
// ---------------------------------------------------------------------------

/**
 * Reconstrucción del «Library Management System» de la captura.
 *
 * Es el diagrama de biblioteca que circula por medio internet y que aparece en
 * casi todos los enunciados: un `LibraryManagementSystem` en el centro con
 * asociaciones a todo, una `LibraryDatabase` colgando, `User` con tres
 * subclases y los importes y contadores guardados como texto.
 */
function biblioteca(): ClassDiagram {
  const clases = [
    createClass({
      id: 'B1',
      name: 'LibraryManagementSystem',
      attributes: [createAttribute({ id: 'BA1', name: 'name', type: 'String' })],
    }),
    createClass({
      id: 'B2',
      name: 'LibraryDatabase',
      attributes: [createAttribute({ id: 'BA2', name: 'listOfBooks', type: 'String' })],
    }),
    createClass({
      id: 'B3',
      name: 'Book',
      attributes: [
        createAttribute({ id: 'BA3', name: 'title', type: 'String' }),
        createAttribute({ id: 'BA4', name: 'author', type: 'String' }),
        createAttribute({ id: 'BA5', name: 'isbn', type: 'String' }),
      ],
    }),
    createClass({
      id: 'B4',
      name: 'User',
      attributes: [
        createAttribute({ id: 'BA6', name: 'name', type: 'String' }),
        createAttribute({ id: 'BA7', name: 'id', type: 'String', isIdentifier: true }),
      ],
    }),
    // Las tres subclases de `User`. `Librarian` vuelve a declarar lo que ya
    // hereda; `Student` no declara nada.
    createClass({
      id: 'B5',
      name: 'Librarian',
      attributes: [
        createAttribute({ id: 'BA8', name: 'name', type: 'String' }),
        createAttribute({ id: 'BA9', name: 'salary', type: 'String' }),
      ],
    }),
    createClass({ id: 'B6', name: 'Student' }),
    createClass({
      id: 'B7',
      name: 'Staff',
      attributes: [createAttribute({ id: 'BA10', name: 'department', type: 'String' })],
    }),
    createClass({
      id: 'B8',
      name: 'Account',
      attributes: [
        createAttribute({ id: 'BA11', name: 'noOfBooksIssued', type: 'String' }),
        createAttribute({ id: 'BA12', name: 'fineAmount', type: 'String' }),
      ],
    }),
  ];

  const relaciones = [
    createRelation({ id: 'BR1', kind: 'association', sourceId: 'B1', targetId: 'B2' }),
    createRelation({
      id: 'BR2',
      kind: 'association',
      sourceId: 'B1',
      targetId: 'B4',
      targetMultiplicity: '*',
    }),
    createRelation({
      id: 'BR3',
      kind: 'association',
      sourceId: 'B2',
      targetId: 'B3',
      targetMultiplicity: '*',
    }),
    createRelation({ id: 'BR4', kind: 'inheritance', sourceId: 'B5', targetId: 'B4' }),
    createRelation({ id: 'BR5', kind: 'inheritance', sourceId: 'B6', targetId: 'B4' }),
    createRelation({ id: 'BR6', kind: 'inheritance', sourceId: 'B7', targetId: 'B4' }),
    createRelation({ id: 'BR7', kind: 'association', sourceId: 'B4', targetId: 'B8' }),
    createRelation({
      id: 'BR8',
      kind: 'association',
      sourceId: 'B4',
      targetId: 'B3',
      sourceMultiplicity: '*',
      targetMultiplicity: '*',
    }),
  ];

  return diagrama(clases, relaciones);
}

describe('el diagrama de biblioteca de la captura', () => {
  const hallazgos = revisarDiagrama(biblioteca());
  const encontrados = new Set(hallazgos.map((h) => h.codigo));

  it('ve que Librarian repite el «name» que ya hereda de User', () => {
    const h = hallazgos.find((x) => x.codigo === 'ATRIBUTO_HEREDADO_REPETIDO');
    expect(h?.classId).toBe('B5');
    expect(h?.titulo).toContain('name');
  });

  it('ve que Student no aporta nada', () => {
    const h = hallazgos.find((x) => x.codigo === 'CLASE_SIN_CONTENIDO');
    expect(h?.classId).toBe('B6');
    expect(h?.gravedad).toBe('aviso');
  });

  it('ve que el sistema y la base de datos no son clases del dominio', () => {
    const señaladas = hallazgos
      .filter((x) => x.codigo === 'CLASE_NO_ES_DEL_DOMINIO')
      .map((x) => x.classId);
    expect(señaladas).toEqual(expect.arrayContaining(['B1', 'B2']));
  });

  it('ve que «listOfBooks» es la asociación con Book escrita dentro de la caja', () => {
    const cuales = hallazgos.filter((x) => x.codigo === 'ATRIBUTO_QUE_ES_RELACION');
    // Solo ese. `Account.noOfBooksIssued` también menciona a `Book` y no es
    // una relación: es un contador.
    expect(cuales).toHaveLength(1);
    expect(cuales[0]?.classId).toBe('B2');
    expect(cuales[0]?.titulo).toContain('Book');
  });

  it('ve el importe y el contador guardados como texto', () => {
    const cuales = hallazgos
      .filter((x) => x.codigo === 'TIPO_SOSPECHOSO')
      .map((x) => x.titulo)
      .join(' ');
    expect(cuales).toContain('fineAmount');
    expect(cuales).toContain('noOfBooksIssued');
    expect(cuales).toContain('salary');
  });

  it('sugiere la clase de préstamo tras el muchos a muchos entre User y Book', () => {
    const h = hallazgos.find((x) => x.codigo === 'MUCHOS_A_MUCHOS_SIN_CLASE');
    expect(h?.relationId).toBe('BR8');
  });

  /*
    Todas las clases están conectadas y ninguna relación está repetida. Que
    estas dos reglas se callen aquí es parte de la comprobación: un revisor que
    encontrara de todo en cualquier diagrama no estaría revisando nada.
  */
  it('no se inventa clases sueltas ni líneas repetidas', () => {
    expect(encontrados.has('CLASE_AISLADA')).toBe(false);
    expect(encontrados.has('RELACION_DUPLICADA')).toBe(false);
    expect(encontrados.has('COMPOSICION_COMPARTIDA')).toBe(false);
  });
});
