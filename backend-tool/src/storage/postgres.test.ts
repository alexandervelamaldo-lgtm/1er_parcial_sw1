import { describe, expect, it } from 'vitest';
import { AuthError } from '../auth/identity.js';
import { aIso, enTransaccion, esViolacionDeUnicidad, opcionesSsl } from './postgres.js';
import { PoolFalso } from './pool-falso.js';
import {
  PostgresDocumentStore,
  PostgresIdentityProvider,
  PostgresProjectStore,
} from './postgres-stores.js';

/**
 * Los almacenes de PostgreSQL sin PostgreSQL.
 *
 * Estas pruebas no comprueban que el SQL sea correcto —eso solo lo dice una base
 * de datos de verdad, y para eso está la batería del final, que se salta sola
 * cuando no hay `TEST_DATABASE_URL`—. Comprueban lo que sí se puede comprobar
 * sin servidor y es justo donde se cometen los errores caros:
 *
 * - que ningún dato del usuario acabe concatenado en el texto de la consulta,
 * - que la contraseña en claro no salga nunca hacia la base de datos,
 * - que la creación de un proyecto sea atómica y la conexión se devuelva incluso
 *   cuando algo falla a mitad,
 * - y que el mapeo de fila a modelo no se invente ni pierda campos.
 */

const FECHA = new Date('2026-03-01T10:00:00.000Z');

function filaProyecto(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    nombre: 'Tienda',
    descripcion: 'Diagrama de la tienda',
    propietario_id: '22222222-2222-4222-8222-222222222222',
    creado_en: FECHA,
    actualizado_en: FECHA,
    ...extra,
  };
}

// ---------------------------------------------------------------------------

describe('opciones de TLS según la cadena de conexión', () => {
  it('no cifra contra una base de datos local', () => {
    expect(opcionesSsl('postgresql://u:p@localhost:5432/db')).toBe(false);
  });

  it('cifra contra un host remoto aunque no se diga nada', () => {
    // Sin esto, la conexión a RDS falla sin explicar por qué en el primer
    // despliegue, que es el peor momento para descubrirlo.
    expect(opcionesSsl('postgresql://u:p@algo.rds.amazonaws.com:5432/db')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('respeta sslmode=disable', () => {
    expect(opcionesSsl('postgresql://u:p@host.remoto:5432/db?sslmode=disable')).toBe(false);
  });

  it('verifica el certificado con sslmode=verify-full', () => {
    // `require` cifra pero no comprueba de quién es el certificado: protege del
    // que escucha, no del que suplanta. La diferencia tiene que sobrevivir.
    expect(opcionesSsl('postgresql://u:p@host:5432/db?sslmode=verify-full')).toEqual({
      rejectUnauthorized: true,
    });
    expect(opcionesSsl('postgresql://u:p@host:5432/db?sslmode=require')).toEqual({
      rejectUnauthorized: false,
    });
  });

  it('ante una cadena que no sabe leer, cifra', () => {
    expect(opcionesSsl('host=algo port=5432 dbname=db')).toEqual({ rejectUnauthorized: false });
  });
});

describe('transacciones', () => {
  it('confirma y devuelve la conexión en el camino feliz', async () => {
    const pool = new PoolFalso();
    const resultado = await enTransaccion(pool, async (cliente) => {
      await cliente.query('insert into algo values ($1)', [1]);
      return 'listo';
    });

    expect(resultado).toBe('listo');
    expect(pool.verbos).toEqual(['begin', 'insert', 'commit']);
    expect(pool.prestadas).toBe(0);
  });

  it('deshace y propaga el error, sin quedarse la conexión', async () => {
    // Una conexión no devuelta no rompe la petición que falló —esa ya está
    // rota— sino las siguientes, hasta agotar el pool. El fallo aparecería
    // entonces lejos de su causa.
    const pool = new PoolFalso((texto) => {
      if (texto.startsWith('insert')) throw new Error('la base de datos dijo que no');
      return [];
    });

    await expect(
      enTransaccion(pool, async (cliente) => {
        await cliente.query('insert into algo values ($1)', [1]);
      }),
    ).rejects.toThrow('la base de datos dijo que no');

    expect(pool.verbos).toEqual(['begin', 'insert', 'rollback']);
    expect(pool.prestadas).toBe(0);
  });
});

describe('utilidades', () => {
  it('convierte las fechas de PostgreSQL a ISO', () => {
    expect(aIso(FECHA)).toBe('2026-03-01T10:00:00.000Z');
    expect(aIso('2026-03-01T10:00:00.000Z')).toBe('2026-03-01T10:00:00.000Z');
  });

  it('reconoce la violación de unicidad y no confunde otros errores', () => {
    expect(esViolacionDeUnicidad({ code: '23505' })).toBe(true);
    expect(esViolacionDeUnicidad({ code: '23503' })).toBe(false);
    expect(esViolacionDeUnicidad(new Error('caída de red'))).toBe(false);
    expect(esViolacionDeUnicidad(null)).toBe(false);
  });
});

describe('almacén de proyectos', () => {
  it('crea el proyecto y la pertenencia del dueño en una sola transacción', async () => {
    // Un proyecto sin la pertenencia de su propietario es un proyecto en el que
    // nadie puede entrar y que nadie puede borrar.
    const pool = new PoolFalso((texto) => (texto.includes('into proyectos') ? [filaProyecto()] : []));
    const store = new PostgresProjectStore(pool);

    const proyecto = await store.createProject({
      name: 'Tienda',
      description: 'Diagrama de la tienda',
      ownerId: '22222222-2222-4222-8222-222222222222',
    });

    expect(pool.verbos).toEqual(['begin', 'insert', 'insert', 'commit']);
    expect(pool.textoCompleto).toContain("'owner'");
    expect(proyecto.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(proyecto.createdAt).toBe('2026-03-01T10:00:00.000Z');
  });

  it('no concatena en el SQL nada que haya escrito el usuario (RNF-SEG-06)', async () => {
    const pool = new PoolFalso((texto) => (texto.includes('into proyectos') ? [filaProyecto()] : []));
    const store = new PostgresProjectStore(pool);
    const nombreHostil = "'; drop table proyectos; --";

    await store.createProject({
      name: nombreHostil,
      description: 'x',
      ownerId: '22222222-2222-4222-8222-222222222222',
    });

    expect(pool.textoCompleto).not.toContain('drop table');
    expect(pool.valoresEnviados).toContain(nombreHostil);
  });

  it('devuelve null cuando el proyecto no existe, en vez de fabricar uno vacío', async () => {
    const store = new PostgresProjectStore(new PoolFalso());
    expect(await store.getProject('11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(await store.roleOf('p', 'u')).toBeNull();
    expect(await store.renameProject('p', 'n', 'd')).toBeNull();
  });

  it('borrar un proyecto que no está devuelve false y no miente', async () => {
    const pool = new PoolFalso();
    const store = new PostgresProjectStore(pool);
    expect(await store.deleteProject('11111111-1111-4111-8111-111111111111')).toBe(false);
    expect(await store.removeMember('p', 'u')).toBe(false);
  });

  it('la lista de proyectos trae el papel de cada uno y sale ordenada por la base de datos', async () => {
    const pool = new PoolFalso(() => [filaProyecto({ rol: 'editor' })]);
    const store = new PostgresProjectStore(pool);

    const proyectos = await store.listProjectsForUser('22222222-2222-4222-8222-222222222222');

    expect(proyectos[0]?.role).toBe('editor');
    expect(proyectos[0]?.name).toBe('Tienda');
    expect(pool.textoCompleto).toContain('order by p.actualizado_en desc');
  });

  it('invitar a quien ya está cambia su permiso en lugar de fallar', async () => {
    // Es lo que hace la implementación de fichero, y la interfaz no distingue
    // entre invitar y ascender.
    const pool = new PoolFalso();
    const store = new PostgresProjectStore(pool);

    const miembro = await store.addMember('p', 'u', 'editor');

    expect(pool.textoCompleto).toContain('on conflict (proyecto_id, usuario_id) do update');
    expect(miembro).toEqual({ projectId: 'p', userId: 'u', role: 'editor' });
  });
});

describe('identidad', () => {
  const SECRETO = 'secreto-de-prueba-suficientemente-largo';
  const ID = '33333333-3333-4333-8333-333333333333';

  /** Pool que se comporta como una tabla `usuarios` de una sola fila. */
  function poolConUsuario(): PoolFalso {
    let guardado: Record<string, unknown> | null = null;
    return new PoolFalso((texto, valores) => {
      if (texto.includes('insert into usuarios')) {
        guardado = {
          id: valores[0],
          correo: valores[1],
          nombre: valores[2],
          sal: valores[3],
          hash: valores[4],
        };
        return [guardado];
      }
      if (texto.includes('from usuarios')) return guardado ? [guardado] : [];
      return [];
    });
  }

  it('guarda el hash y la sal, nunca la contraseña', async () => {
    const pool = poolConUsuario();
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);

    await identity.register('  Ana@Ejemplo.COM ', 'contraseña-larguísima', 'Ana');

    expect(pool.valoresEnviados).not.toContain('contraseña-larguísima');
    expect(pool.textoCompleto).not.toContain('contraseña-larguísima');
    // Y el correo se guarda normalizado, o «Ana@…» y «ana@…» serían dos cuentas.
    expect(pool.valoresEnviados).toContain('ana@ejemplo.com');
  });

  it('rechaza una contraseña corta sin llegar a tocar la base de datos', async () => {
    const pool = new PoolFalso();
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);

    await expect(identity.register('ana@ejemplo.com', 'corta', 'Ana')).rejects.toThrow(AuthError);
    expect(pool.llamadas).toHaveLength(0);
  });

  it('traduce el choque de unicidad a un error de correo duplicado', async () => {
    // No se consulta antes si el correo existe: entre la consulta y la
    // inserción caben dos registros simultáneos. La restricción no tiene esa
    // ventana, y su código de error es el que hay que interpretar.
    const pool = new PoolFalso(() => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);

    await expect(
      identity.register('ana@ejemplo.com', 'contraseña-larguísima', 'Ana'),
    ).rejects.toMatchObject({ status: 409, code: 'EMAIL_DUPLICADO' });
  });

  it('deja pasar los errores que no son de unicidad en vez de disfrazarlos', async () => {
    const pool = new PoolFalso(() => {
      throw new Error('la base de datos no responde');
    });
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);

    await expect(
      identity.register('ana@ejemplo.com', 'contraseña-larguísima', 'Ana'),
    ).rejects.toThrow('la base de datos no responde');
  });

  it('el token que emite al autenticar es el que acepta al verificar', async () => {
    const pool = poolConUsuario();
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);
    await identity.register('ana@ejemplo.com', 'contraseña-larguísima', 'Ana');

    const sesion = await identity.authenticate('ANA@ejemplo.com', 'contraseña-larguísima');
    expect(sesion).not.toBeNull();

    const perfil = await identity.verify(sesion!.token);
    expect(perfil?.email).toBe('ana@ejemplo.com');
    // El perfil que sale del proveedor no lleva ni la sal ni el hash.
    expect(perfil).not.toHaveProperty('hash');
  });

  it('no acepta un token con la firma cambiada', async () => {
    const pool = poolConUsuario();
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);
    await identity.register('ana@ejemplo.com', 'contraseña-larguísima', 'Ana');
    const sesion = await identity.authenticate('ana@ejemplo.com', 'contraseña-larguísima');

    const partes = sesion!.token.split('.');
    const falsificado = `${partes[0]}.${partes[1]}.${'0'.repeat(64)}`;

    expect(await identity.verify(falsificado)).toBeNull();
  });

  it('con la contraseña equivocada no emite sesión', async () => {
    const pool = poolConUsuario();
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);
    await identity.register('ana@ejemplo.com', 'contraseña-larguísima', 'Ana');

    expect(await identity.authenticate('ana@ejemplo.com', 'otra-cosa-larguísima')).toBeNull();
  });

  it('un usuario que no existe no autentica y tampoco revienta', async () => {
    const identity = new PostgresIdentityProvider(new PoolFalso(), SECRETO, 3600);
    expect(await identity.authenticate('nadie@ejemplo.com', 'contraseña-larguísima')).toBeNull();
  });

  it('un identificador que no es un UUID se descarta sin consultar', async () => {
    // La columna es `uuid`: comparar contra texto arbitrario hace que PostgreSQL
    // conteste con un error de tipo, no con «no encontrado», y ese error subiría
    // como un 500 donde correspondía un 401.
    const pool = new PoolFalso();
    const identity = new PostgresIdentityProvider(pool, SECRETO, 3600);

    expect(await identity.findById("no-soy-un-uuid'; select 1")).toBeNull();
    expect(pool.llamadas).toHaveLength(0);

    await identity.findById(ID);
    expect(pool.llamadas).toHaveLength(1);
  });
});

describe('almacén de documentos', () => {
  const SALA = '44444444-4444-4444-8444-444444444444';

  it('un documento que no existe da null, que no es un error', async () => {
    const store = new PostgresDocumentStore(new PoolFalso());
    expect(await store.load(SALA)).toBeNull();
  });

  it('guarda sustituyendo, no acumulando versiones', async () => {
    const pool = new PoolFalso();
    const store = new PostgresDocumentStore(pool);

    await store.save(SALA, new Uint8Array([1, 2, 3]));

    expect(pool.textoCompleto).toContain('on conflict (sala_id) do update');
    expect(pool.llamadas).toHaveLength(1);
  });

  it('copia los bytes al guardar, porque el documento se sigue editando', async () => {
    // Compartir la memoria con el documento vivo significaría mandar a la base
    // de datos un estado a medio reescribir.
    const pool = new PoolFalso();
    const store = new PostgresDocumentStore(pool);

    const update = new Uint8Array([1, 2, 3]);
    await store.save(SALA, update);
    update[0] = 99;

    const enviado = pool.llamadas[0]?.valores[1] as Buffer;
    expect([...enviado]).toEqual([1, 2, 3]);
  });

  it('devuelve los mismos bytes que le dio la base de datos', async () => {
    const pool = new PoolFalso(() => [{ estado: Buffer.from([7, 8, 9]) }]);
    const store = new PostgresDocumentStore(pool);

    expect([...(await store.load(SALA))!]).toEqual([7, 8, 9]);
  });

  it('cierra el pool al apagarse, pero solo si es suyo', async () => {
    // El pool es compartido por los tres almacenes. Lo cierra el de documentos
    // porque `RoomManager.shutdown()` es el último paso del apagado, después de
    // vaciar la cola de guardado.
    const propio = new PoolFalso();
    await new PostgresDocumentStore(propio).close?.();
    expect(propio.cerrado).toBe(true);

    const ajeno = new PoolFalso();
    await new PostgresDocumentStore(ajeno, false).close?.();
    expect(ajeno.cerrado).toBe(false);
  });
});

/**
 * Batería contra una base de datos real.
 *
 * Se salta sola si no hay `TEST_DATABASE_URL`, que es el caso normal. Para
 * ejecutarla hace falta el driver instalado y una base de datos **de usar y
 * tirar**, porque esto crea el esquema y borra lo que crea.
 *
 * La contraseña va en `PGPASSWORD` y no dentro de la URL: `pg` la lee de ahí
 * cuando la cadena de conexión no la trae, y así no queda escrita en el
 * historial del terminal ni en ningún fichero. Ver [Despliegue §6.6].
 */
const urlDePruebas = process.env.TEST_DATABASE_URL;

describe.runIf(urlDePruebas)('contra PostgreSQL de verdad', () => {
  it('el recorrido completo: usuario, proyecto, permiso y documento', async () => {
    const { abrirPool, aplicarEsquema } = await import('./postgres.js');
    const pool = await abrirPool(urlDePruebas!);
    await aplicarEsquema(pool);

    const identity = new PostgresIdentityProvider(pool, 'secreto-de-prueba', 3600);
    const store = new PostgresProjectStore(pool);
    const documentos = new PostgresDocumentStore(pool, false);

    const sufijo = Date.now();
    try {
      const ana = await identity.register(
        `ana-${sufijo}@ejemplo.com`,
        'contraseña-larguísima',
        'Ana',
      );
      const sesion = await identity.authenticate(
        `ana-${sufijo}@ejemplo.com`,
        'contraseña-larguísima',
      );
      expect((await identity.verify(sesion!.token))?.id).toBe(ana.id);

      const proyecto = await store.createProject({
        name: 'Tienda',
        description: 'de prueba',
        ownerId: ana.id,
      });
      expect(await store.roleOf(proyecto.id, ana.id)).toBe('owner');
      expect(await store.listProjectsForUser(ana.id)).toHaveLength(1);

      await documentos.save(proyecto.id, new Uint8Array([1, 2, 3]));
      expect([...(await documentos.load(proyecto.id))!]).toEqual([1, 2, 3]);

      // Sobrescribir sustituye: si acumulara, el segundo `load` traería otra cosa.
      await documentos.save(proyecto.id, new Uint8Array([4, 5]));
      expect([...(await documentos.load(proyecto.id))!]).toEqual([4, 5]);

      await documentos.delete(proyecto.id);
      expect(await documentos.load(proyecto.id)).toBeNull();

      expect(await store.deleteProject(proyecto.id)).toBe(true);
      // La cascada se lleva la pertenencia; si no, quedaría apuntando a un
      // proyecto que ya no está.
      expect(await store.listMembers(proyecto.id)).toHaveLength(0);

      await pool.query('delete from usuarios where id = $1', [ana.id]);
    } finally {
      await pool.end();
    }
  });
});
