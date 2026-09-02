import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PoolFalso } from './pool-falso.js';
import {
  describirResumen,
  leerDatosDeFichero,
  migrar,
  type DatosDeFichero,
} from './migracion.js';

/**
 * El traslado de los datos de fichero a PostgreSQL.
 *
 * Lo que estas pruebas vigilan es lo que haría irreversible un error: que los
 * identificadores y los hashes de contraseña lleguen **tal cual**. Un traslado
 * que genere identificadores nuevos deja a cada usuario sin sus proyectos, y
 * uno que vuelva a derivar la contraseña es directamente imposible, porque del
 * hash no se vuelve. Ninguna de las dos cosas da error al ejecutarse: se
 * descubren cuando alguien intenta entrar.
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-migracion-'));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const ANA = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ana@ejemplo.com',
  displayName: 'Ana',
  salt: 'la-sal-de-ana',
  hash: 'el-hash-de-ana',
};

const PROYECTO = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Tienda en línea',
  description: 'Diagrama de la tienda',
  ownerId: ANA.id,
  createdAt: '2026-01-15T09:00:00.000Z',
  updatedAt: '2026-02-20T18:30:00.000Z',
};

async function escribirDatos(opciones: { documentos?: Record<string, number[]> } = {}) {
  await writeFile(join(dataDir, 'usuarios.json'), JSON.stringify([ANA]), 'utf8');
  await writeFile(
    join(dataDir, 'proyectos.json'),
    JSON.stringify({
      projects: [PROYECTO],
      memberships: [{ projectId: PROYECTO.id, userId: ANA.id, role: 'owner' }],
    }),
    'utf8',
  );

  const documentos = opciones.documentos ?? { [PROYECTO.id]: [1, 2, 3] };
  await mkdir(join(dataDir, 'documentos'), { recursive: true });
  for (const [id, bytes] of Object.entries(documentos)) {
    await writeFile(join(dataDir, 'documentos', `${id}.bin`), Buffer.from(bytes));
  }
}

describe('lectura de lo que hay en el disco', () => {
  it('lee usuarios, proyectos, permisos y diagramas', async () => {
    await escribirDatos();
    const datos = await leerDatosDeFichero(dataDir);

    expect(datos.usuarios).toHaveLength(1);
    expect(datos.proyectos).toHaveLength(1);
    expect(datos.pertenencias).toHaveLength(1);
    expect(datos.documentos).toEqual([
      { salaId: PROYECTO.id, estado: Buffer.from([1, 2, 3]) },
    ]);
  });

  it('un directorio vacío no es un error, es que no hay nada', async () => {
    // Es el caso de quien nunca ha arrancado el servicio. Reventar aquí
    // obligaría a explicar un fallo donde no hay ningún problema.
    const datos = await leerDatosDeFichero(dataDir);
    expect(datos).toEqual({ usuarios: [], proyectos: [], pertenencias: [], documentos: [] });
  });

  it('ignora lo que no sea un .bin dentro de documentos', async () => {
    await escribirDatos();
    await writeFile(join(dataDir, 'documentos', 'notas.txt'), 'nada que ver', 'utf8');

    const datos = await leerDatosDeFichero(dataDir);
    expect(datos.documentos).toHaveLength(1);
  });
});

describe('escritura en PostgreSQL', () => {
  async function migrarDesdeDisco(pool: PoolFalso) {
    return migrar(pool, await leerDatosDeFichero(dataDir));
  }

  it('conserva el identificador y el hash del usuario, sin volver a derivarlos', async () => {
    // Si generase un identificador nuevo, las pertenencias seguirían apuntando
    // al viejo y cada uno entraría sin ver ninguno de sus proyectos.
    await escribirDatos();
    const pool = new PoolFalso(() => [{ id: 'x' }]);

    await migrarDesdeDisco(pool);

    expect(pool.valoresEnviados).toContain(ANA.id);
    expect(pool.valoresEnviados).toContain(ANA.hash);
    expect(pool.valoresEnviados).toContain(ANA.salt);
  });

  it('conserva las fechas del proyecto en vez de ponerlas todas hoy', async () => {
    // La lista de proyectos se ordena por `actualizado_en`. Con `default now()`
    // saldría en un orden arbitrario que no se parece al que el usuario recuerda.
    await escribirDatos();
    const pool = new PoolFalso(() => [{ id: 'x' }]);

    await migrarDesdeDisco(pool);

    expect(pool.valoresEnviados).toContain('2026-01-15T09:00:00.000Z');
    expect(pool.valoresEnviados).toContain('2026-02-20T18:30:00.000Z');
  });

  it('va todo en una sola transacción', async () => {
    // A medias sería peor que nada: usuarios sin proyectos, o permisos que
    // apuntan a quien todavía no está.
    await escribirDatos();
    const pool = new PoolFalso(() => [{ id: 'x' }]);

    await migrarDesdeDisco(pool);

    expect(pool.verbos[0]).toBe('begin');
    expect(pool.verbos.at(-1)).toBe('commit');
    expect(pool.prestadas).toBe(0);
  });

  it('si algo falla no deja nada escrito', async () => {
    await escribirDatos();
    const pool = new PoolFalso((texto) => {
      if (texto.includes('into proyectos')) throw new Error('foránea rota');
      return [{ id: 'x' }];
    });

    await expect(migrarDesdeDisco(pool)).rejects.toThrow('foránea rota');
    expect(pool.verbos.at(-1)).toBe('rollback');
    expect(pool.prestadas).toBe(0);
  });

  it('ejecutarla dos veces no duplica ni pisa lo que ya hay', async () => {
    await escribirDatos();
    const pool = new PoolFalso(() => [{ id: 'x' }]);

    await migrarDesdeDisco(pool);

    // `on conflict do nothing` sin columna cubre el choque por id y el choque
    // por correo, que son dos formas distintas de decir «esa persona ya está».
    const inserciones = pool.llamadas.filter((l) => l.texto.includes('insert into'));
    expect(inserciones.length).toBeGreaterThan(0);
    for (const insercion of inserciones) {
      expect(insercion.texto).toContain('on conflict do nothing');
    }
  });

  it('cuenta como omitido lo que la base ya tenía', async () => {
    await escribirDatos();
    // Ninguna fila devuelta = ninguna insertada, porque ya existían.
    const pool = new PoolFalso(() => []);

    const resumen = await migrarDesdeDisco(pool);

    expect(resumen.usuarios).toBe(0);
    expect(resumen.usuariosOmitidos).toBe(1);
    expect(resumen.proyectosOmitidos).toBe(1);
  });

  it('no migra un diagrama cuyo proyecto ya no existe, y lo dice', async () => {
    // Una sala sin proyecto es inalcanzable desde la aplicación: no hay
    // pantalla que lleve a ella. Copiarla solo llevaría basura a la base nueva.
    const huerfano = '99999999-9999-4999-8999-999999999999';
    await escribirDatos({ documentos: { [PROYECTO.id]: [1, 2, 3], [huerfano]: [4, 5] } });
    const pool = new PoolFalso(() => [{ id: 'x' }]);

    const resumen = await migrarDesdeDisco(pool);

    expect(resumen.documentos).toBe(1);
    expect(resumen.documentosHuerfanos).toEqual([huerfano]);
    // Y sus bytes no han viajado a la base de datos.
    const enviados = pool.llamadas.filter((l) => l.texto.includes('into documentos'));
    expect(enviados).toHaveLength(1);
  });

  it('descarta un permiso cuyo proyecto no se migró, en vez de tumbar la transacción', async () => {
    // La clave foránea de `miembros` lo rechazaría y se perdería el traslado
    // entero por una fila suelta que sobra.
    const datos: DatosDeFichero = {
      usuarios: [],
      proyectos: [],
      pertenencias: [{ projectId: 'fantasma', userId: ANA.id, role: 'editor' }],
      documentos: [],
    };
    const pool = new PoolFalso(() => [{ id: 'x' }]);

    const resumen = await migrar(pool, datos);

    expect(resumen.pertenencias).toBe(0);
    expect(pool.textoCompleto).not.toContain('into miembros');
  });
});

describe('el resumen que se imprime', () => {
  it('nombra los diagramas huérfanos y aclara que no se ha borrado nada', () => {
    const texto = describirResumen({
      usuarios: 27,
      usuariosOmitidos: 0,
      proyectos: 14,
      proyectosOmitidos: 0,
      pertenencias: 23,
      documentos: 13,
      documentosHuerfanos: ['abc'],
    });

    expect(texto).toContain('Diagramas migrados:    13');
    expect(texto).toContain('abc.bin');
    expect(texto).toContain('no se ha borrado nada');
  });
});
