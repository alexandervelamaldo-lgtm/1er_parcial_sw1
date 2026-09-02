import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  buscar,
  comoContexto,
  construirCorpus,
  indexar,
  NO_CUBIERTO,
  SISTEMA_GUIA,
  type Documento,
  type Indice,
  type Resultado,
} from '@app/shared';
import { pedirAlModelo } from './transporte.js';

/**
 * La guía, contestada desde el servidor.
 *
 * Existe por un dispositivo concreto: **el móvil**. Ollama no corre en un
 * teléfono, así que la ruta «modelo en tu propia máquina» ahí no está
 * disponible; y la ruta «buscar en el manual» sí funciona, pero devuelve
 * secciones en lugar de una respuesta redactada. Esta es la de en medio: el
 * mismo manual, el mismo trozo recuperado, y un modelo remoto que lo redacta.
 *
 * De modo que la ayuda tiene tres caminos, y ninguno es un plan B del otro:
 *
 *   | Dónde                        | Quién responde        | Necesita       |
 *   |------------------------------|-----------------------|----------------|
 *   | escritorio con Ollama        | modelo local          | nada de red    |
 *   | móvil o escritorio con red   | esto                  | red y clave    |
 *   | cualquier sitio sin red      | búsqueda del manual   | nada           |
 *
 * El tercero funciona siempre y es el único que no puede fallar, porque es el
 * único que no depende de nadie. Los otros dos redactan mejor.
 *
 * El índice se construye una vez al arrancar y se guarda en memoria. Son unos
 * doscientos fragmentos: cabe de sobra, y releer siete ficheros del disco en
 * cada pregunta no aportaría nada salvo latencia.
 */

/** Lo mismo que la ruta devuelve: texto redactado, o solo las secciones. */
export interface RespuestaDeLaGuia {
  readonly texto: string | null;
  readonly fuentes: readonly Resultado[];
  /** Quién contestó, para poder decirlo en pantalla. */
  readonly motor: string;
  /**
   * Por qué no hay texto redactado, cuando se esperaba que lo hubiera.
   *
   * Que el modelo falle no se traga en silencio. Devolver las secciones sin más
   * dejaría a quien administra el despliegue sin saber que su clave caducó: la
   * ayuda seguiría «funcionando» y nadie miraría los registros. Se degrada, y se
   * dice que se ha degradado.
   */
  readonly aviso?: string;
}

/**
 * Lee los documentos del disco.
 *
 * Vive aquí y no en `shared/guia/corpus.ts` a propósito: aquel módulo lo ejecuta
 * también el navegador, donde no hay sistema de ficheros. Meter un `readFile`
 * allí ataría el corpus a Node y rompería justo la mitad que tiene que funcionar
 * sin conexión.
 */
export async function leerDocumentos(directorio: string): Promise<Documento[]> {
  const raiz = resolve(directorio);
  const nombres = (await readdir(raiz)).filter((n) => n.endsWith('.md')).sort();

  const documentos = await Promise.all(
    nombres.map(async (nombre) => {
      const markdown = await readFile(join(raiz, nombre), 'utf8');
      const titulo = /^#\s+(.+)$/m.exec(markdown);
      return {
        // El nombre legible sale del primer encabezado del propio fichero. Una
        // tabla de nombres aquí sería una segunda copia del título, y se
        // quedaría desfasada la primera vez que alguien renombre una sección.
        nombre: titulo?.[1]?.trim() ?? basename(nombre, '.md'),
        ruta: `docs/${nombre}`,
        markdown,
      };
    }),
  );

  return documentos;
}

export interface OpcionesGuia {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

interface RespuestaOpenAI {
  choices?: { message?: { content?: string } }[];
}

export class GuiaDelManual {
  private constructor(
    private readonly indice: Indice,
    private readonly opciones: OpcionesGuia,
  ) {}

  static async abrir(directorio: string, opciones: OpcionesGuia = {}): Promise<GuiaDelManual> {
    const documentos = await leerDocumentos(directorio);
    return new GuiaDelManual(indexar(construirCorpus(documentos)), opciones);
  }

  /** Cuántos fragmentos tiene el manual. Sale en `/salud` para poder verlo. */
  get fragmentos(): number {
    return this.indice.fragmentos.length;
  }

  async responder(pregunta: string): Promise<RespuestaDeLaGuia> {
    const fuentes = buscar(this.indice, pregunta, 4);

    // Sin nada que citar no se llama al modelo. Un modelo sin contexto solo
    // puede improvisar, que es exactamente lo que el sistema le prohíbe hacer,
    // y pagar una llamada para que conteste «no lo sé» es pagar por nada.
    if (fuentes.length === 0) {
      return { texto: NO_CUBIERTO, fuentes: [], motor: 'busqueda-en-el-manual' };
    }

    const { apiKey } = this.opciones;
    if (apiKey === undefined || apiKey === '') {
      // Sin clave la guía sigue sirviendo: devuelve las secciones. Es una
      // respuesta peor redactada, no una avería, y se dice cuál de las dos es.
      return { texto: null, fuentes, motor: 'busqueda-en-el-manual' };
    }

    const modelo = this.opciones.model ?? 'deepseek-chat';

    try {
      const respuesta = await pedirAlModelo<RespuestaOpenAI>({
        url: `${this.opciones.baseUrl ?? 'https://api.deepseek.com'}/chat/completions`,
        headers: { authorization: `Bearer ${apiKey}` },
        timeoutMs: this.opciones.timeoutMs ?? 20_000,
        reintentos: 1,
        body: {
          model: modelo,
          // Temperatura baja: de una guía se espera la misma respuesta a la
          // misma pregunta, no variedad.
          temperature: 0.2,
          max_tokens: 400,
          messages: [
            { role: 'system', content: SISTEMA_GUIA },
            {
              role: 'user',
              content: `MANUAL:\n\n${comoContexto(fuentes)}\n\nPREGUNTA: ${pregunta}`,
            },
          ],
        },
      });

      const texto = respuesta.choices?.[0]?.message?.content?.trim();
      if (texto === undefined || texto === '') {
        return {
          texto: null,
          fuentes,
          motor: 'busqueda-en-el-manual',
          aviso: `${modelo} contestó vacío`,
        };
      }
      return { texto, fuentes, motor: modelo };
    } catch (error) {
      // Aquí está la razón de recuperar SIEMPRE antes de llamar al modelo: en
      // este punto ya tenemos una respuesta buena en la mano. Propagar el error
      // sería tirarla y contestar con un 500 teniendo el manual delante.
      const detalle = error instanceof Error ? error.message : String(error);
      console.warn(`La guía no pudo usar ${modelo}: ${detalle}`);
      return {
        texto: null,
        fuentes,
        motor: 'busqueda-en-el-manual',
        aviso: `El modelo remoto no contestó (${detalle}).`,
      };
    }
  }
}
