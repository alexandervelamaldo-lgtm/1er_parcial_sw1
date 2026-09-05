import type { FicheroGenerado } from '../services/api';

/**
 * Cómo se ordena para leerlo lo que el generador devuelve como lista plana.
 *
 * `/api/proyectos/:id/generacion/previsualizacion` contesta con un array de
 * `{ ruta, bytes, contenido }`, unas decenas de entradas, todas con la ruta
 * completa desde la raíz del proyecto. Eso está bien para escribir un ZIP y
 * fatal para mirarlo: cincuenta líneas que empiezan las cuarenta primeras por
 * `src/main/java/com/ejemplo/tienda/` no dejan ver dónde acaba una capa y
 * empieza otra.
 *
 * Aquí no hay React a propósito, como en el resto de módulos hermanos: sin
 * jsdom no se monta un navegador en las pruebas, y esto es justo lo que hay que
 * poder probar.
 */

/** Las capas que el enunciado pide demostrar, más lo que no es ninguna. */
export type Capa =
  | 'dominio'
  | 'repositorio'
  | 'servicio'
  | 'controlador'
  | 'dto'
  | 'infraestructura'
  | 'configuracion';

export const ROTULO_CAPA: Record<Capa, string> = {
  dominio: 'Dominio',
  repositorio: 'Repositorio',
  servicio: 'Servicio',
  controlador: 'Controlador',
  dto: 'DTO',
  infraestructura: 'Infraestructura',
  configuracion: 'Configuración',
};

/*
  El orden en el que se enseñan, que es el del flujo de una petición: entra por
  el controlador, pasa por el servicio, llega al repositorio y toca el dominio.
  Se lista al revés —de dentro afuera— porque es como se explica un backend por
  capas y como está escrito en la documentación del proyecto.
*/
export const ORDEN_CAPAS: Capa[] = [
  'dominio',
  'repositorio',
  'servicio',
  'controlador',
  'dto',
  'infraestructura',
  'configuracion',
];

/**
 * A qué capa pertenece un fichero, por el segmento de su ruta.
 *
 * Se mira el segmento y no un `includes` sobre la ruta entera, y la diferencia
 * no es cosmética: un proyecto cuyo paquete base sea `com.tienda.service` haría
 * que *todos* sus ficheros contuvieran `/service/`, y el reparto por capas
 * diría que las cuarenta clases son de servicio. El paquete base lo escribe el
 * usuario, así que ese caso no es rebuscado.
 *
 * `dto/mapper` cuenta como DTO: el mapper existe solo para convertir entre la
 * entidad y su DTO, y separarlo en una capa propia sugiere una que no existe.
 */
export function capaDe(ruta: string): Capa {
  const segmentos = ruta.split('/');
  /*
    Se recorre desde el final. Buscando desde el principio, el primer segmento
    llamado `service` podría ser parte del paquete base; desde el final, el que
    se encuentra antes es el de la carpeta que contiene el fichero.
  */
  for (let i = segmentos.length - 2; i >= 0; i -= 1) {
    switch (segmentos[i]) {
      case 'domain':
        return 'dominio';
      case 'repository':
        return 'repositorio';
      case 'service':
      case 'impl':
        return 'servicio';
      case 'controller':
        return 'controlador';
      case 'dto':
      case 'mapper':
        return 'dto';
      case 'infraestructura':
      case 'exception':
        return 'infraestructura';
      default:
        break;
    }
  }
  return 'configuracion';
}

export interface RecuentoCapa {
  capa: Capa;
  ficheros: number;
  bytes: number;
}

/**
 * Cuántos ficheros hay en cada capa.
 *
 * Es el resumen que contesta a «¿de verdad genera las cuatro capas y el DTO?»
 * sin abrir el ZIP. Las capas vacías no se devuelven: una fila que dice
 * «Repositorio: 0» en un proyecto sin entidades ocupa sitio para no informar.
 */
export function porCapas(ficheros: FicheroGenerado[]): RecuentoCapa[] {
  const acumulado = new Map<Capa, RecuentoCapa>();
  for (const fichero of ficheros) {
    const capa = capaDe(fichero.ruta);
    const previo = acumulado.get(capa) ?? { capa, ficheros: 0, bytes: 0 };
    previo.ficheros += 1;
    previo.bytes += fichero.bytes;
    acumulado.set(capa, previo);
  }
  return ORDEN_CAPAS.map((capa) => acumulado.get(capa)).filter(
    (recuento): recuento is RecuentoCapa => recuento !== undefined,
  );
}

export interface CarpetaGenerada {
  /** La ruta de la carpeta, ya sin el prefijo común. */
  carpeta: string;
  ficheros: FicheroGenerado[];
}

/**
 * El prefijo que comparten todas las rutas, para quitarlo de la vista.
 *
 * Cuarenta ficheros que empiezan por `src/main/java/com/ejemplo/tienda/` gastan
 * la mitad del ancho de la lista en repetir lo mismo. Se recorta por segmentos
 * completos y no por caracteres: `src/main/java/com/a` y `src/main/java/com/ab`
 * comparten la cadena `src/main/java/com/a`, y cortar por ahí dejaría el
 * segundo empezando por «b», que no es ninguna carpeta.
 */
export function prefijoComun(rutas: string[]): string {
  if (rutas.length < 2) return '';
  const partido = rutas.map((r) => r.split('/'));
  const primera = partido[0] ?? [];
  let comunes = 0;
  /*
    El último segmento es el nombre del fichero y nunca entra en el prefijo:
    con un solo fichero por carpeta, incluirlo dejaría la ruta en blanco.
  */
  while (comunes < primera.length - 1) {
    const segmento = primera[comunes];
    if (!partido.every((r) => r.length - 1 > comunes && r[comunes] === segmento)) break;
    comunes += 1;
  }
  return comunes === 0 ? '' : `${primera.slice(0, comunes).join('/')}/`;
}

/**
 * Los ficheros agrupados por carpeta, en el orden en que se leen.
 *
 * Las carpetas salen ordenadas alfabéticamente y los ficheros dentro también.
 * No se respeta el orden en que llega la lista: el generador la construye en el
 * orden en que le toca escribir cada plantilla, que es un detalle suyo y
 * cambiaría la vista cada vez que alguien reordene el código del generador.
 */
export function porCarpetas(ficheros: FicheroGenerado[]): CarpetaGenerada[] {
  const prefijo = prefijoComun(ficheros.map((f) => f.ruta));
  const grupos = new Map<string, FicheroGenerado[]>();

  for (const fichero of ficheros) {
    const sinPrefijo = fichero.ruta.startsWith(prefijo)
      ? fichero.ruta.slice(prefijo.length)
      : fichero.ruta;
    const corte = sinPrefijo.lastIndexOf('/');
    const carpeta = corte === -1 ? '' : sinPrefijo.slice(0, corte);
    const lista = grupos.get(carpeta) ?? [];
    lista.push(fichero);
    grupos.set(carpeta, lista);
  }

  return [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([carpeta, lista]) => ({
      carpeta,
      ficheros: [...lista].sort((a, b) => a.ruta.localeCompare(b.ruta, 'es')),
    }));
}

/** El nombre del fichero sin su carpeta, para la lista. */
export function nombreDe(ruta: string): string {
  const partes = ruta.split('/');
  return partes[partes.length - 1] ?? ruta;
}

/**
 * El tamaño en una unidad que se lea.
 *
 * `1400` no dice nada de un vistazo; «1,4 kB» sí. Se usa kB de 1000 y no KiB de
 * 1024 porque es lo que enseña el explorador de ficheros del sistema, que es
 * contra lo que va a comparar quien descargue el ZIP.
 */
export function tamaño(bytes: number): string {
  if (bytes < 1000) return `${String(bytes)} B`;
  const kb = bytes / 1000;
  if (kb < 1000) return `${kb.toFixed(1).replace('.', ',')} kB`;
  return `${(kb / 1000).toFixed(1).replace('.', ',')} MB`;
}
