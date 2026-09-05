import { describe, expect, it } from 'vitest';
import type { ClassDiagram, UmlModule } from '@app/shared';
import { CORPUS, tiendaDiagram } from './fixtures/corpus.js';
import { normalize } from './ir/normalize.js';
import { generateProject } from './render/generate.js';
import { validateDiagram } from './validation/validate.js';
import type { GeneratedFile } from './ir/types.js';

/**
 * Lo que aquí se comprueba no es que los módulos se vean, sino que cambien lo
 * que el generador escribe. Sin compilador de Java a mano, la comprobación
 * equivalente es estructural: que la línea `package …;` de cada fichero
 * coincida con la carpeta en la que está, y que cada import interno apunte a un
 * fichero que existe en el proyecto generado. Un proyecto que pasa esas dos y
 * no compila tendría que fallar por otra cosa.
 */

const VENTAS: UmlModule = {
  id: 'M0001',
  name: 'Ventas',
  packageSegment: 'ventas',
  description: 'Pedidos y sus líneas',
};

const CATALOGO: UmlModule = {
  id: 'M0002',
  name: 'Catálogo',
  packageSegment: 'catalogo',
  description: 'Productos y categorías',
};

/**
 * La tienda repartida en dos módulos, dejando `Cliente` fuera de los dos.
 *
 * El reparto está elegido para que cruce los tres tipos de referencia entre
 * módulos: `Pedido` (ventas) apunta a `Cliente` (paquete base), `LineaPedido`
 * (ventas) apunta a `Producto` (catálogo), y `Pedido` usa el enumerado
 * `EstadoPedido`, que se queda en ventas con él.
 */
function tiendaModular(): ClassDiagram {
  const base = tiendaDiagram();
  const destino: Record<string, string> = {
    Pedido: VENTAS.id,
    LineaPedido: VENTAS.id,
    EstadoPedido: VENTAS.id,
    Producto: CATALOGO.id,
    Categoria: CATALOGO.id,
  };

  return {
    ...base,
    modules: { [VENTAS.id]: VENTAS, [CATALOGO.id]: CATALOGO },
    classes: Object.fromEntries(
      Object.entries(base.classes).map(([id, cls]) => [
        id,
        { ...cls, moduleId: destino[cls.name] ?? null },
      ]),
    ),
  };
}

function javaFiles(files: GeneratedFile[]): GeneratedFile[] {
  return files.filter((f) => f.path.endsWith('.java'));
}

/** `src/main/java/com/x/ventas/domain/Pedido.java` → `com.x.ventas.domain`. */
function packageFromPath(path: string): string {
  const sinRaiz = path.slice('src/main/java/'.length);
  const partes = sinRaiz.split('/');
  partes.pop();
  return partes.join('.');
}

function declaredPackage(content: string): string {
  const match = /^package ([\w.]+);/m.exec(content);
  if (!match) throw new Error('El fichero generado no declara paquete');
  return match[1]!;
}

/** Todos los tipos que el propio proyecto define, por nombre completo. */
function tiposGenerados(files: GeneratedFile[]): Set<string> {
  const fqn = new Set<string>();
  for (const file of javaFiles(files)) {
    const nombre = file.path.slice(file.path.lastIndexOf('/') + 1, -'.java'.length);
    fqn.add(`${packageFromPath(file.path)}.${nombre}`);
  }
  return fqn;
}

function importsInternos(content: string, basePackage: string): string[] {
  const encontrados: string[] = [];
  const patron = /^import (?:static )?([\w.]+);/gm;
  let match: RegExpExecArray | null;
  while ((match = patron.exec(content)) !== null) {
    const referido = match[1]!;
    if (referido.startsWith(`${basePackage}.`)) encontrados.push(referido);
  }
  return encontrados;
}

function comprobarEstructura(diagram: ClassDiagram): GeneratedFile[] {
  const files = generateProject(normalize(diagram));
  const definidos = tiposGenerados(files);

  for (const file of javaFiles(files)) {
    expect(declaredPackage(file.content), `paquete de ${file.path}`).toBe(
      packageFromPath(file.path),
    );

    for (const referido of importsInternos(file.content, diagram.meta.basePackage)) {
      expect(definidos.has(referido), `${file.path} importa ${referido}, que no se genera`).toBe(
        true,
      );
    }
  }

  return files;
}

describe('coherencia estructural del proyecto generado', () => {
  it('en todo el corpus, el paquete declarado coincide con la carpeta', () => {
    for (const entry of CORPUS) {
      comprobarEstructura(entry.diagram());
    }
  });

  it('con la tienda repartida en módulos, también', () => {
    comprobarEstructura(tiendaModular());
  });
});

describe('un diagrama sin módulos genera lo mismo que antes de que existieran', () => {
  const sinModulos = generateProject(normalize(tiendaDiagram()));

  it('declarar un módulo al que no pertenece nadie no cambia ni un byte', () => {
    const conModuloVacio = {
      ...tiendaDiagram(),
      modules: { [VENTAS.id]: VENTAS },
    };

    expect(generateProject(normalize(conModuloVacio))).toEqual(sinModulos);
  });

  it('una clase que apunta a un módulo borrado vuelve al paquete base', () => {
    const base = tiendaDiagram();
    const huerfana = {
      ...base,
      classes: Object.fromEntries(
        Object.entries(base.classes).map(([id, cls]) => [id, { ...cls, moduleId: 'M-BORRADO' }]),
      ),
    };

    expect(generateProject(normalize(huerfana))).toEqual(sinModulos);
  });
});

describe('el módulo cambia lo que se escribe', () => {
  const files = generateProject(normalize(tiendaModular()));
  const rutas = files.map((f) => f.path);

  function contenido(sufijo: string): string {
    const found = files.find((f) => f.path.endsWith(sufijo));
    if (!found) throw new Error(`No se generó ningún fichero que termine en ${sufijo}`);
    return found.content;
  }

  it('las siete capas de una entidad caen dentro de la carpeta del módulo', () => {
    for (const sufijo of [
      'ventas/domain/Pedido.java',
      'ventas/repository/PedidoRepository.java',
      'ventas/dto/PedidoRequest.java',
      'ventas/dto/PedidoResponse.java',
      'ventas/dto/mapper/PedidoMapper.java',
      'ventas/service/PedidoService.java',
      'ventas/service/impl/PedidoServiceImpl.java',
      'ventas/controller/PedidoController.java',
    ]) {
      expect(rutas.some((r) => r.endsWith(sufijo)), sufijo).toBe(true);
    }
  });

  it('la clase sin módulo se queda donde estaba', () => {
    expect(rutas).toContain('src/main/java/com/ejemplo/tienda/domain/Cliente.java');
    expect(contenido('domain/Cliente.java')).toContain('package com.ejemplo.tienda.domain;');
  });

  it('el enumerado viaja al módulo de la entidad que lo usa', () => {
    expect(contenido('ventas/domain/EstadoPedido.java')).toContain(
      'package com.ejemplo.tienda.ventas.domain;',
    );
  });

  it('la entidad importa lo que antes tenía al lado en el mismo paquete', () => {
    // Sin módulos, `Pedido` y `Cliente` compartían paquete y Java resolvía la
    // referencia sin import. Repartidos, falta el import y no compila: es el
    // fallo concreto que hace que un módulo no pueda ser una etiqueta.
    expect(contenido('ventas/domain/Pedido.java')).toContain(
      'import com.ejemplo.tienda.domain.Cliente;',
    );
    expect(contenido('ventas/domain/LineaPedido.java')).toContain(
      'import com.ejemplo.tienda.catalogo.domain.Producto;',
    );
  });

  it('el mapeador busca el repositorio del otro módulo en su paquete', () => {
    expect(contenido('ventas/dto/mapper/LineaPedidoMapper.java')).toContain(
      'import com.ejemplo.tienda.catalogo.repository.ProductoRepository;',
    );
  });

  it('la infraestructura compartida no se mete en ningún módulo', () => {
    expect(rutas).toContain('src/main/java/com/ejemplo/tienda/Application.java');
    expect(rutas).toContain(
      'src/main/java/com/ejemplo/tienda/exception/ResourceNotFoundException.java',
    );
    expect(contenido('ventas/service/impl/PedidoServiceImpl.java')).toContain(
      'import com.ejemplo.tienda.exception.ResourceNotFoundException;',
    );
  });

  it('las tablas no cambian: el módulo organiza el código, no la base de datos', () => {
    const sinModulos = generateProject(normalize(tiendaDiagram()));
    const migracion = (fs: GeneratedFile[]) =>
      fs.find((f) => f.path.includes('esquema_inicial'))!.content;

    expect(migracion(files)).toBe(migracion(sinModulos));
  });
});

describe('validación de módulos', () => {
  function conModulos(modules: Record<string, UmlModule>): ClassDiagram {
    return { ...tiendaDiagram(), modules };
  }

  it('acepta el reparto de la tienda', () => {
    const result = validateDiagram(tiendaModular());
    expect(result.errors).toEqual([]);
  });

  it('rechaza dos módulos con el mismo paquete', () => {
    const gemelo: UmlModule = { ...CATALOGO, id: 'M0003', name: 'Inventario' };
    const result = validateDiagram(
      conModulos({ [CATALOGO.id]: CATALOGO, [gemelo.id]: { ...gemelo, packageSegment: 'catalogo' } }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('MODULE_SEGMENT_COLLISION');
  });

  it('rechaza un paquete con punto, que sacaría al módulo del paquete base', () => {
    const result = validateDiagram(
      conModulos({ [VENTAS.id]: { ...VENTAS, packageSegment: '..otro' } }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('INVALID_MODULE_SEGMENT');
  });

  it('rechaza un paquete que es palabra reservada de Java', () => {
    const result = validateDiagram(
      conModulos({ [VENTAS.id]: { ...VENTAS, packageSegment: 'package' } }),
    );

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain('INVALID_MODULE_SEGMENT');
  });
});
