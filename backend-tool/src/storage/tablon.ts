import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MAXIMO_MENSAJES_POR_PROYECTO,
  extensionDeAudio,
  ordenarHilo,
  retirar as marcarRetirado,
  type Mensaje,
  type TipoAudio,
} from '@app/shared';

/**
 * Almacén del tablón: los mensajes del módulo de comunicación interna.
 *
 * Es el cuarto almacén de la herramienta y sigue la misma forma que los tres
 * anteriores: una interfaz que describe lo que el servicio necesita, una
 * implementación de fichero para desarrollar sin base de datos y otra contra
 * PostgreSQL para el despliegue. La interfaz se escribe mirando las rutas HTTP
 * que la van a usar, no mirando el disco.
 *
 * ## Por qué no vive en el documento Yjs
 *
 * El diagrama es un CRDT y el tablón no. Parece que encajarían —los dos son
 * datos compartidos del mismo proyecto— pero son dos problemas distintos:
 *
 * - Un CRDT converge **fusionando**. Es justo lo que se quiere en un lienzo,
 *   donde dos personas moviendo la misma caja deben acabar viendo lo mismo, y
 *   justo lo que no se quiere en un hilo, donde el orden de llegada *es* la
 *   información y fusionar dos versiones de un mensaje no significa nada.
 * - El documento se reenvía entero a cada cliente que se conecta. Meter dentro
 *   quinientos mensajes con sus audios significaría descargarlos todos —megabytes
 *   de voz— antes de poder mover la primera caja.
 * - Los mensajes tienen autor y fecha que deben ser fiables. En el CRDT los
 *   pone el cliente, y un cliente puede poner los que quiera.
 *
 * Así que el tablón es una tabla normal, con sus escrituras autorizadas en el
 * servidor. El precio es que no llega solo: hay que sondear.
 *
 * ## Tres formas de leer, y por qué no es una sola
 *
 * - `ultimos` abre la pantalla. Un chat se abre por el final, no por el
 *   principio: pedir «los cincuenta primeros» en un proyecto con cuatrocientos
 *   mensajes mostraría la conversación del primer día.
 * - `cambiosDesde` sondea. Va por `version`, no por `secuencia`, que es lo que
 *   hace que una retirada llegue a quien ya había pasado de ese punto.
 * - `anterioresA` sube por el hilo cuando alguien arrastra hacia arriba.
 *
 * Una sola función con un parámetro de modo habría escondido que son tres
 * consultas con tres índices distintos.
 */

export interface PaginaTablon {
  /** Ya ordenados por `secuencia` ascendente: listos para pintar. */
  mensajes: Mensaje[];
  /** Versión hasta la que el cliente está al día. Se devuelve en el próximo sondeo. */
  cursor: number;
  /** Quedan más mensajes de los que cabían en esta página. */
  hayMas: boolean;
}

export interface PublicacionTexto {
  proyectoId: string;
  autorId: string;
  /** Ya normalizado y validado por `normalizarTexto`. */
  texto: string;
}

export interface PublicacionVoz {
  proyectoId: string;
  autorId: string;
  audio: Uint8Array;
  /** Uno de los literales de `TIPOS_AUDIO`, nunca la cadena del cliente. */
  tipo: TipoAudio;
  duracionMs: number;
}

export interface TablonStore {
  publicarTexto(entrada: PublicacionTexto): Promise<Mensaje>;
  publicarVoz(entrada: PublicacionVoz): Promise<Mensaje>;
  ultimos(proyectoId: string, limite: number): Promise<PaginaTablon>;
  cambiosDesde(proyectoId: string, desde: number, limite: number): Promise<PaginaTablon>;
  anterioresA(proyectoId: string, secuencia: number, limite: number): Promise<PaginaTablon>;
  obtener(proyectoId: string, mensajeId: string): Promise<Mensaje | null>;
  /** `null` si el mensaje no existe, no es de voz, o ya fue retirado. */
  leerAudio(proyectoId: string, mensajeId: string): Promise<Uint8Array | null>;
  /** Devuelve la lápida, o `null` si el mensaje no existe. */
  retirar(proyectoId: string, mensajeId: string): Promise<Mensaje | null>;
  /** Se llama al borrar el proyecto. Se lleva los audios por delante. */
  borrarProyecto(proyectoId: string): Promise<void>;
  close?(): Promise<void>;
}

/**
 * Identificadores que pueden formar parte de un nombre de fichero.
 *
 * `proyectoId` llega de la URL. Hoy `requireRole` ya ha comprobado que el
 * proyecto existe antes de que este almacén lo vea, así que en la práctica
 * siempre es un UUID nuestro; pero un almacén que construye rutas a partir de
 * un parámetro no debe depender de que alguien más haya mirado antes. Con
 * `../../` dentro, `join` produce felizmente una ruta fuera del directorio de
 * datos.
 *
 * Se rechaza, no se limpia (RNF-SEG-06). Limpiar deja la duda de qué quedó
 * después de limpiar; rechazar no la deja.
 */
const ID_SEGURO = /^[A-Za-z0-9_-]{1,200}$/;

export function esIdSeguroDeFichero(valor: string): boolean {
  return ID_SEGURO.test(valor);
}

function exigirIdSeguro(valor: string, que: string): void {
  if (!esIdSeguroDeFichero(valor)) {
    throw new Error(`Identificador de ${que} no admisible como nombre de fichero`);
  }
}

interface TablonEnDisco {
  contador: number;
  mensajes: Mensaje[];
}

function vacio(): TablonEnDisco {
  return { contador: 0, mensajes: [] };
}

/**
 * Las páginas se recortan con `slice(-limite)`, y `slice(-0)` no devuelve nada
 * sino **todo**: un límite de cero descargaría el hilo entero en lugar de la
 * página vacía que se pidió. La ruta ya exige un mínimo de uno; esto es el
 * segundo cerrojo, porque el almacén también lo usan las pruebas.
 */
function limiteSano(limite: number): number {
  return Math.max(1, Math.trunc(limite));
}

/**
 * Implementación en disco, la de desarrollo.
 *
 * Un fichero JSON por proyecto y un fichero suelto por audio. El audio va
 * aparte y no en base64 dentro del JSON por una razón concreta: el JSON se
 * reescribe entero en cada mensaje publicado, y con los audios dentro cada
 * «vale» de dos segundos reescribiría en disco todas las notas de voz del
 * proyecto.
 */
export class FileTablonStore implements TablonStore {
  private readonly directorio: string;
  private readonly cache = new Map<string, TablonEnDisco>();
  private colaDeEscritura: Promise<void> = Promise.resolve();

  constructor(
    dataDir: string,
    /**
     * El tope se inyecta para poder probar el recorte sin publicar quinientos
     * mensajes. Una prueba que tarda diez segundos en montar su escenario
     * acaba borrándose, y con ella la única comprobación de que al podar el
     * hilo también se borran los audios.
     */
    private readonly maximoMensajes: number = MAXIMO_MENSAJES_POR_PROYECTO,
  ) {
    this.directorio = join(resolve(dataDir), 'tablones');
  }

  private rutaTablon(proyectoId: string): string {
    exigirIdSeguro(proyectoId, 'proyecto');
    return join(this.directorio, `${proyectoId}.json`);
  }

  private rutaAudio(mensajeId: string, tipo: TipoAudio): string {
    exigirIdSeguro(mensajeId, 'mensaje');
    return join(this.directorio, 'audio', `${mensajeId}.${extensionDeAudio(tipo)}`);
  }

  private async cargar(proyectoId: string): Promise<TablonEnDisco> {
    const enMemoria = this.cache.get(proyectoId);
    if (enMemoria) return enMemoria;

    let tablon = vacio();
    try {
      tablon = JSON.parse(await readFile(this.rutaTablon(proyectoId), 'utf8')) as TablonEnDisco;
    } catch (error) {
      // Proyecto sin ningún mensaje todavía: no es un error, es lo normal.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.cache.set(proyectoId, tablon);
    return tablon;
  }

  /**
   * Vuelca el tablón. Se escribe a un temporal y se renombra, igual que el
   * documento Yjs: un JSON truncado a mitad de escritura no se puede leer, y
   * eso no perdería el último mensaje sino el hilo entero.
   */
  private persistir(proyectoId: string, tablon: TablonEnDisco): void {
    const destino = this.rutaTablon(proyectoId);
    this.colaDeEscritura = this.colaDeEscritura
      .then(async () => {
        await mkdir(dirname(destino), { recursive: true });
        const temporal = `${destino}.tmp`;
        await writeFile(temporal, JSON.stringify(tablon, null, 2), 'utf8');
        await rename(temporal, destino);
      })
      .catch((error: unknown) => {
        console.error('No se pudo persistir el tablón:', error);
      });
  }

  /** Espera al volcado pendiente. Solo lo usan las pruebas y el apagado. */
  async flush(): Promise<void> {
    await this.colaDeEscritura;
  }

  /**
   * Recorta el hilo al tope y devuelve los audios que hay que borrar.
   *
   * Se recorta por `secuencia` y no por fecha por la misma razón que se ordena
   * por ella: es lo único monótono que hay.
   */
  private recortar(tablon: TablonEnDisco): Mensaje[] {
    const sobrantes = tablon.mensajes.length - this.maximoMensajes;
    if (sobrantes <= 0) return [];

    const ordenados = ordenarHilo(tablon.mensajes);
    const retirados = ordenados.slice(0, sobrantes);
    tablon.mensajes = ordenados.slice(sobrantes);
    return retirados;
  }

  private async publicar(
    proyectoId: string,
    construir: (secuencia: number) => Mensaje,
  ): Promise<Mensaje> {
    const tablon = await this.cargar(proyectoId);
    tablon.contador += 1;
    const mensaje = construir(tablon.contador);
    tablon.mensajes.push(mensaje);

    for (const viejo of this.recortar(tablon)) {
      if (viejo.audio) await rm(this.rutaAudio(viejo.id, viejo.audio.tipo), { force: true });
    }

    this.persistir(proyectoId, tablon);
    return mensaje;
  }

  async publicarTexto(entrada: PublicacionTexto): Promise<Mensaje> {
    return this.publicar(entrada.proyectoId, (n) => ({
      id: randomUUID(),
      proyectoId: entrada.proyectoId,
      autorId: entrada.autorId,
      secuencia: n,
      version: n,
      creadoEn: new Date().toISOString(),
      tipo: 'texto',
      texto: entrada.texto,
      audio: null,
      retirado: false,
    }));
  }

  async publicarVoz(entrada: PublicacionVoz): Promise<Mensaje> {
    // Se comprueba aquí y no solo dentro de `publicar`: si el identificador se
    // rechazara después de escribir el audio, quedaría un fichero huérfano que
    // nadie va a borrar porque no hay ningún mensaje que lo mencione.
    exigirIdSeguro(entrada.proyectoId, 'proyecto');
    const id = randomUUID();
    const ruta = this.rutaAudio(id, entrada.tipo);
    await mkdir(dirname(ruta), { recursive: true });
    // El audio se escribe **antes** de registrar el mensaje. Al revés, un fallo
    // de disco entre las dos operaciones dejaría en el hilo una nota de voz que
    // no se puede reproducir, que es peor que no tener la nota.
    await writeFile(ruta, entrada.audio);

    return this.publicar(entrada.proyectoId, (n) => ({
      id,
      proyectoId: entrada.proyectoId,
      autorId: entrada.autorId,
      secuencia: n,
      version: n,
      creadoEn: new Date().toISOString(),
      tipo: 'voz',
      texto: '',
      audio: { tipo: entrada.tipo, bytes: entrada.audio.byteLength, duracionMs: entrada.duracionMs },
      retirado: false,
    }));
  }

  async ultimos(proyectoId: string, limite: number): Promise<PaginaTablon> {
    const tope = limiteSano(limite);
    const tablon = await this.cargar(proyectoId);
    const ordenados = ordenarHilo(tablon.mensajes);
    return {
      mensajes: ordenados.slice(-tope),
      cursor: tablon.contador,
      hayMas: ordenados.length > tope,
    };
  }

  async cambiosDesde(proyectoId: string, desde: number, limite: number): Promise<PaginaTablon> {
    const tope = limiteSano(limite);
    const tablon = await this.cargar(proyectoId);
    const pendientes = tablon.mensajes
      .filter((m) => m.version > desde)
      .sort((a, b) => a.version - b.version);
    const pagina = pendientes.slice(0, tope);
    const hayMas = pendientes.length > tope;

    return {
      mensajes: ordenarHilo(pagina),
      // Si la página se truncó, el cursor se queda en el último entregado para
      // que el siguiente sondeo continúe justo ahí. Si no, salta al contador y
      // no al máximo entregado: así una poda de mensajes viejos no deja el
      // cursor atascado pidiendo para siempre cambios que ya no existen.
      cursor: hayMas ? (pagina[pagina.length - 1]?.version ?? desde) : tablon.contador,
      hayMas,
    };
  }

  async anterioresA(proyectoId: string, secuencia: number, limite: number): Promise<PaginaTablon> {
    const tope = limiteSano(limite);
    const tablon = await this.cargar(proyectoId);
    const anteriores = ordenarHilo(tablon.mensajes.filter((m) => m.secuencia < secuencia));
    return {
      mensajes: anteriores.slice(-tope),
      cursor: tablon.contador,
      hayMas: anteriores.length > tope,
    };
  }

  async obtener(proyectoId: string, mensajeId: string): Promise<Mensaje | null> {
    const tablon = await this.cargar(proyectoId);
    return tablon.mensajes.find((m) => m.id === mensajeId) ?? null;
  }

  async leerAudio(proyectoId: string, mensajeId: string): Promise<Uint8Array | null> {
    const mensaje = await this.obtener(proyectoId, mensajeId);
    if (!mensaje?.audio || mensaje.retirado) return null;
    try {
      return new Uint8Array(await readFile(this.rutaAudio(mensajeId, mensaje.audio.tipo)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async retirar(proyectoId: string, mensajeId: string): Promise<Mensaje | null> {
    const tablon = await this.cargar(proyectoId);
    const indice = tablon.mensajes.findIndex((m) => m.id === mensajeId);
    if (indice < 0) return null;

    const original = tablon.mensajes[indice]!;
    if (original.retirado) return original;

    tablon.contador += 1;
    const lapida = marcarRetirado(original, tablon.contador);
    tablon.mensajes[indice] = lapida;

    if (original.audio) await rm(this.rutaAudio(mensajeId, original.audio.tipo), { force: true });
    this.persistir(proyectoId, tablon);
    return lapida;
  }

  async borrarProyecto(proyectoId: string): Promise<void> {
    const tablon = await this.cargar(proyectoId);
    for (const mensaje of tablon.mensajes) {
      if (mensaje.audio) await rm(this.rutaAudio(mensaje.id, mensaje.audio.tipo), { force: true });
    }
    this.cache.delete(proyectoId);
    await this.flush();
    await rm(this.rutaTablon(proyectoId), { force: true });
  }
}
