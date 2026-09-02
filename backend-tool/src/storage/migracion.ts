import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { StoredUser } from '../auth/identity.js';
import type { Membership, Project } from './store.js';
import { enTransaccion, type PoolPostgres } from './postgres.js';

/**
 * Traslado de los datos de fichero a PostgreSQL.
 *
 * ## Por qué esto no usa `PostgresIdentityProvider.register()`
 *
 * Porque `register()` genera un identificador nuevo y vuelve a derivar la
 * contraseña, y aquí las dos cosas serían un desastre:
 *
 * - Un identificador nuevo deja las pertenencias de `miembros` apuntando al
 *   usuario viejo. El resultado no es un error: es que cada uno entra y no ve
 *   ninguno de sus proyectos.
 * - Volver a derivar la contraseña es imposible, porque el fichero no la
 *   guarda —guarda su hash, que es justamente lo que no se puede deshacer—.
 *
 * Así que la migración inserta las filas tal cual, conservando identificadores,
 * sales, hashes y fechas. Es el único sitio del proyecto que escribe en las
 * tablas sin pasar por los almacenes, y es deliberado: un traslado no es una
 * alta.
 *
 * ## Idempotente
 *
 * Todo va con `on conflict do nothing`, así que ejecutarlo dos veces no duplica
 * nada ni pisa lo que ya hubiera. Lo que ya existe en la base gana: si alguien
 * ya se registró allí con el mismo correo, se respeta esa cuenta y se informa.
 */

export interface DocumentoDeFichero {
  salaId: string;
  estado: Uint8Array;
}

export interface DatosDeFichero {
  usuarios: StoredUser[];
  proyectos: Project[];
  pertenencias: Membership[];
  documentos: DocumentoDeFichero[];
}

interface InstantaneaProyectos {
  projects?: Project[];
  memberships?: Membership[];
}

/** Lee un JSON, tratando «no existe» como «no hay nada», que no es un error. */
async function leerJson<T>(ruta: string, siFalta: T): Promise<T> {
  try {
    return JSON.parse(await readFile(ruta, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return siFalta;
    throw error;
  }
}

/** Carga lo que haya en `dataDir` sin interpretarlo ni validarlo. */
export async function leerDatosDeFichero(dataDir: string): Promise<DatosDeFichero> {
  const raiz = resolve(dataDir);

  const usuarios = await leerJson<StoredUser[]>(join(raiz, 'usuarios.json'), []);
  const instantanea = await leerJson<InstantaneaProyectos>(join(raiz, 'proyectos.json'), {});

  const documentos: DocumentoDeFichero[] = [];
  let ficheros: string[] = [];
  try {
    ficheros = await readdir(join(raiz, 'documentos'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  for (const fichero of ficheros) {
    if (!fichero.endsWith('.bin')) continue;
    documentos.push({
      salaId: fichero.slice(0, -'.bin'.length),
      estado: await readFile(join(raiz, 'documentos', fichero)),
    });
  }

  return {
    usuarios,
    proyectos: instantanea.projects ?? [],
    pertenencias: instantanea.memberships ?? [],
    documentos,
  };
}

export interface ResumenMigracion {
  usuarios: number;
  usuariosOmitidos: number;
  proyectos: number;
  proyectosOmitidos: number;
  pertenencias: number;
  documentos: number;
  /**
   * Documentos cuyo proyecto ya no está en `proyectos.json`.
   *
   * No se migran: una sala sin proyecto es inalcanzable desde la aplicación
   * —no hay pantalla que lleve a ella— y copiarla solo llevaría basura a la
   * base nueva. El fichero sigue en el disco por si alguien lo echa de menos.
   */
  documentosHuerfanos: string[];
}

/**
 * Inserta todo dentro de una única transacción.
 *
 * O entra el conjunto o no entra nada. A medias sería peor que nada: usuarios
 * sin sus proyectos, o proyectos con permisos que apuntan a quien todavía no
 * está, y ninguna de las dos cosas se nota hasta que alguien intenta entrar.
 */
export async function migrar(
  pool: PoolPostgres,
  datos: DatosDeFichero,
): Promise<ResumenMigracion> {
  const idsDeProyecto = new Set(datos.proyectos.map((p) => p.id));
  const documentosHuerfanos = datos.documentos
    .filter((d) => !idsDeProyecto.has(d.salaId))
    .map((d) => d.salaId);

  return enTransaccion(pool, async (cliente) => {
    let usuarios = 0;
    for (const usuario of datos.usuarios) {
      // `on conflict do nothing` sin columna: cubre tanto el choque por `id`
      // como el choque por `correo`, que son dos formas distintas de decir que
      // esa persona ya está.
      const { rows } = await cliente.query<{ id: string }>(
        `insert into usuarios (id, correo, nombre, sal, hash)
         values ($1, $2, $3, $4, $5)
         on conflict do nothing
         returning id`,
        [usuario.id, usuario.email, usuario.displayName, usuario.salt, usuario.hash],
      );
      usuarios += rows.length;
    }

    let proyectos = 0;
    for (const proyecto of datos.proyectos) {
      // Las fechas se conservan: `default now()` las pondría todas hoy y la
      // lista de proyectos, que se ordena por `actualizado_en`, saldría en un
      // orden arbitrario distinto del que el usuario recuerda.
      const { rows } = await cliente.query<{ id: string }>(
        `insert into proyectos (id, nombre, descripcion, propietario_id, creado_en, actualizado_en)
         values ($1, $2, $3, $4, $5, $6)
         on conflict do nothing
         returning id`,
        [
          proyecto.id,
          proyecto.name,
          proyecto.description,
          proyecto.ownerId,
          proyecto.createdAt,
          proyecto.updatedAt,
        ],
      );
      proyectos += rows.length;
    }

    let pertenencias = 0;
    for (const miembro of datos.pertenencias) {
      // Una pertenencia a un proyecto que no se migró rompería la foránea y
      // tumbaría la transacción entera. Se descarta antes.
      if (!idsDeProyecto.has(miembro.projectId)) continue;
      const { rows } = await cliente.query<{ usuario_id: string }>(
        `insert into miembros (proyecto_id, usuario_id, rol)
         values ($1, $2, $3)
         on conflict do nothing
         returning usuario_id`,
        [miembro.projectId, miembro.userId, miembro.role],
      );
      pertenencias += rows.length;
    }

    let documentos = 0;
    for (const documento of datos.documentos) {
      if (!idsDeProyecto.has(documento.salaId)) continue;
      const { rows } = await cliente.query<{ sala_id: string }>(
        `insert into documentos (sala_id, estado)
         values ($1, $2)
         on conflict do nothing
         returning sala_id`,
        [documento.salaId, Buffer.from(documento.estado)],
      );
      documentos += rows.length;
    }

    return {
      usuarios,
      usuariosOmitidos: datos.usuarios.length - usuarios,
      proyectos,
      proyectosOmitidos: datos.proyectos.length - proyectos,
      pertenencias,
      documentos,
      documentosHuerfanos,
    };
  });
}

/** El resumen en texto, para imprimirlo al terminar. */
export function describirResumen(resumen: ResumenMigracion): string {
  const lineas = [
    `Usuarios migrados:     ${resumen.usuarios}`,
    `Proyectos migrados:    ${resumen.proyectos}`,
    `Permisos migrados:     ${resumen.pertenencias}`,
    `Diagramas migrados:    ${resumen.documentos}`,
  ];

  if (resumen.usuariosOmitidos > 0 || resumen.proyectosOmitidos > 0) {
    lineas.push(
      '',
      `Ya estaban en la base y se han respetado: ${resumen.usuariosOmitidos} usuarios, ` +
        `${resumen.proyectosOmitidos} proyectos.`,
    );
  }

  if (resumen.documentosHuerfanos.length > 0) {
    lineas.push(
      '',
      `${resumen.documentosHuerfanos.length} diagramas sin proyecto asociado, no migrados:`,
      ...resumen.documentosHuerfanos.map((id) => `  ${id}.bin`),
      'Sus ficheros siguen en el disco; no se ha borrado nada.',
    );
  }

  return lineas.join('\n');
}
