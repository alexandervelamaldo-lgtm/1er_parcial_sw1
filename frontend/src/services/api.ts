import type {
  AvisoImportacion,
  ClassDiagram,
  DiagramaExtraido,
  Operation,
  RelationKind,
  TablaExtraida,
} from '@app/shared';

/**
 * Cliente HTTP de la API.
 *
 * Las rutas son relativas a propósito. En desarrollo el servidor de Vite hace de
 * intermediario y en producción todo se sirve del mismo origen, así que no hay
 * ninguna URL de backend que configurar ni que equivocarse al desplegar.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** ¿Es un fallo de red y no una respuesta del servidor? Distingue «sin conexión». */
  get esDeRed(): boolean {
    return this.status === 0;
  }
}

export interface Usuario {
  id: string;
  email: string;
  displayName: string;
}

export type Rol = 'owner' | 'editor' | 'viewer';

export interface Proyecto {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  role: Rol;
}

export interface Miembro {
  usuarioId: string;
  rol: Rol;
  email: string | null;
  nombre: string | null;
}

let tokenActual: string | null = null;

export function setToken(token: string | null): void {
  tokenActual = token;
}

export function getToken(): string | null {
  return tokenActual;
}

/**
 * Aviso de que el servidor ha rechazado nuestras credenciales.
 *
 * Existe porque el WebSocket no puede averiguarlo por su cuenta. Cuando el
 * apretón de manos se rechaza con un 401, la API del navegador oculta el código
 * de estado —por diseño, para no filtrar información entre orígenes— y el
 * cliente solo ve un cierre 1006, idéntico al de un servidor apagado. El canal
 * colaborativo se queda entonces reintentando y la interfaz dice «Sin conexión»,
 * que es una mentira tranquilizadora: promete que lo editado se enviará solo
 * cuando vuelva la red, y la red está perfectamente; lo caducado es la sesión.
 *
 * La respuesta HTTP sí trae el 401, así que es la petición de reconciliación la
 * que descubre la verdad y avisa por aquí. Un solo sitio, porque la sesión es
 * del usuario y no del diagrama que tenga abierto.
 */
type EscuchaNoAutorizado = () => void;
let alPerderLaSesion: EscuchaNoAutorizado | null = null;

export function alNoAutorizado(escucha: EscuchaNoAutorizado | null): void {
  alPerderLaSesion = escucha;
}

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const cabeceras = new Headers(init.headers);
  cabeceras.set('Accept', 'application/json');
  if (init.body !== undefined) cabeceras.set('Content-Type', 'application/json');
  if (tokenActual) cabeceras.set('Authorization', `Bearer ${tokenActual}`);

  let respuesta: Response;
  try {
    respuesta = await fetch(`/api${ruta}`, { ...init, headers: cabeceras });
  } catch {
    // Estar sin conexión no es un error del servidor y la interfaz tiene que
    // poder distinguirlo: offline se sigue trabajando en local, mientras que un
    // 500 sí merece que el usuario deje de intentarlo.
    throw new ApiError(0, 'No hay conexión con el servidor');
  }

  if (respuesta.status === 204) return undefined as T;

  const cuerpo: unknown = await respuesta.json().catch(() => null);

  if (!respuesta.ok) {
    const detalle = cuerpo as { error?: string; code?: string } | null;
    // Se avisa solo si había un token: un 401 al intentar acceder con la
    // contraseña equivocada es una respuesta normal del formulario, no una
    // sesión que se ha caído por debajo de los pies del usuario.
    if (respuesta.status === 401 && tokenActual) alPerderLaSesion?.();
    // Un 5xx *sin cuerpo JSON* casi nunca viene del backend: viene del proxy de
    // desarrollo, que responde 500 cuando no encuentra a quién reenviar. Decir
    // «Error 500» a secas manda a buscar el fallo en el servidor cuando lo que
    // pasa es que no está arrancado. El backend, cuando falla de verdad,
    // contesta con `{ error, code }` y ese mensaje es el que se muestra.
    const generico =
      respuesta.status >= 500 && detalle?.error === undefined
        ? 'El servidor no responde. Comprueba que el backend esté arrancado (npm run dev:backend).'
        : `Error ${respuesta.status}`;
    throw new ApiError(respuesta.status, detalle?.error ?? generico, detalle?.code);
  }

  return cuerpo as T;
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

interface RespuestaSesion {
  usuario: Usuario;
  token: string;
  expira: string;
}

export const api = {
  registro: (email: string, password: string, nombre: string) =>
    pedir<RespuestaSesion>('/auth/registro', {
      method: 'POST',
      body: JSON.stringify({ email, password, nombre }),
    }),

  acceso: (email: string, password: string) =>
    pedir<RespuestaSesion>('/auth/acceso', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  yo: () => pedir<{ usuario: Usuario }>('/auth/yo'),

  // -------------------------------------------------------------------------
  // Proyectos
  // -------------------------------------------------------------------------

  listarProyectos: () => pedir<{ proyectos: Proyecto[] }>('/proyectos'),

  crearProyecto: (nombre: string, descripcion: string, paqueteBase?: string) =>
    pedir<{ proyecto: Proyecto }>('/proyectos', {
      method: 'POST',
      body: JSON.stringify({ nombre, descripcion, paqueteBase }),
    }),

  verProyecto: (id: string) => pedir<{ proyecto: Proyecto }>(`/proyectos/${id}`),

  borrarProyecto: (id: string) => pedir<void>(`/proyectos/${id}`, { method: 'DELETE' }),

  listarMiembros: (id: string) => pedir<{ miembros: Miembro[] }>(`/proyectos/${id}/miembros`),

  invitar: (id: string, email: string, rol: 'editor' | 'viewer') =>
    pedir<{ miembro: Miembro }>(`/proyectos/${id}/miembros`, {
      method: 'POST',
      body: JSON.stringify({ email, rol }),
    }),

  expulsar: (id: string, usuarioId: string) =>
    pedir<void>(`/proyectos/${id}/miembros/${usuarioId}`, { method: 'DELETE' }),

  // -------------------------------------------------------------------------
  // Diagrama
  // -------------------------------------------------------------------------

  leerDiagrama: (id: string) => pedir<{ diagrama: ClassDiagram }>(`/proyectos/${id}/diagrama`),

  /**
   * Fusiona en el servidor lo que se hizo sin conexión y recoge lo que hicieron
   * los demás (RF-OFF-04).
   *
   * Se manda el vector de estado además de la actualización: es lo que permite
   * al servidor contestar solo con la diferencia. Sin él respondería el
   * documento entero en cada reconciliación, que en un diagrama grande es la
   * diferencia entre volver del túnel y que la aplicación se congele un segundo.
   */
  sincronizarEstado: (id: string, actualizacion: string, vectorEstado: string) =>
    pedir<{ actualizacion: string; vectorEstado: string }>(`/proyectos/${id}/diagrama/estado`, {
      method: 'POST',
      body: JSON.stringify({ actualizacion, vectorEstado }),
    }),

  descargarEstado: (id: string, desde?: string) =>
    pedir<{ actualizacion: string; vectorEstado: string }>(
      `/proyectos/${id}/diagrama/estado${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`,
    ),

  aplicarOperaciones: (id: string, operaciones: Operation[]) =>
    pedir<{ aplicadas: number; descripciones: string[]; diagrama: ClassDiagram }>(
      `/proyectos/${id}/diagrama/operaciones`,
      { method: 'POST', body: JSON.stringify({ operaciones }) },
    ),

  // -------------------------------------------------------------------------
  // Asistente y generación
  // -------------------------------------------------------------------------

  interpretar: (id: string, texto: string) =>
    pedir<RespuestaAsistente>(`/proyectos/${id}/asistente`, {
      method: 'POST',
      body: JSON.stringify({ texto }),
    }),

  /**
   * Pregunta a la guía a través del servidor.
   *
   * Es el camino del móvil: allí no hay Ollama que valga, pero con red el
   * servidor redacta la respuesta usando el mismo manual y el mismo fragmento
   * recuperado. No cuelga de ningún proyecto porque no habla de ninguno: se
   * pregunta «¿por dónde empiezo?» antes de tener uno abierto.
   */
  preguntarGuia: (texto: string) =>
    pedir<RespuestaGuia>('/guia', { method: 'POST', body: JSON.stringify({ texto }) }),

  validar: (id: string) =>
    pedir<{ valido: boolean; errores: ProblemaValidacion[]; avisos: ProblemaValidacion[] }>(
      `/proyectos/${id}/validacion`,
    ),

  previsualizarGeneracion: (id: string, opciones: OpcionesGeneracion = {}) =>
    pedir<{ avisos: ProblemaValidacion[]; ficheros: FicheroGenerado[] }>(
      `/proyectos/${id}/generacion/previsualizacion`,
      { method: 'POST', body: JSON.stringify(opciones) },
    ),

  // -------------------------------------------------------------------------
  // Importación de una tabla fotografiada
  // -------------------------------------------------------------------------

  /**
   * Sube la foto y devuelve lo que el modelo ha leído. No escribe nada.
   *
   * `imagen` va en base64 sin el prefijo `data:`; el servidor lo tolera de todos
   * modos, pero mandarlo limpio evita cargar un tercio de más en la cadena.
   */
  leerTablaDeImagen: (id: string, imagen: string, mimeType: string) =>
    pedir<RespuestaLecturaTabla>(`/proyectos/${id}/importar-tabla/leer`, {
      method: 'POST',
      body: JSON.stringify({ imagen, mimeType }),
    }),

  /**
   * Pide las operaciones para la tabla *ya revisada por la persona*.
   *
   * Es una llamada aparte y no la continuación automática de la anterior porque
   * entre las dos ocurre lo único que garantiza que los datos sean correctos:
   * alguien mira la foto y la tabla lado a lado.
   */
  proponerImportacion: (id: string, tabla: TablaExtraida) =>
    pedir<RespuestaPropuestaTabla>(`/proyectos/${id}/importar-tabla/proponer`, {
      method: 'POST',
      body: JSON.stringify({ tabla }),
    }),

  // -------------------------------------------------------------------------
  // Importación de un diagrama de clases fotografiado
  // -------------------------------------------------------------------------

  /** Sube la foto de un diagrama entero y devuelve lo leído. No escribe nada. */
  leerDiagramaDeImagen: (id: string, imagen: string, mimeType: string) =>
    pedir<RespuestaLecturaDiagrama>(`/proyectos/${id}/importar-diagrama/leer`, {
      method: 'POST',
      body: JSON.stringify({ imagen, mimeType }),
    }),

  /** Pide las operaciones para el diagrama *ya revisado por la persona*. */
  proponerImportacionDiagrama: (id: string, diagrama: DiagramaExtraido) =>
    pedir<RespuestaPropuestaDiagrama>(`/proyectos/${id}/importar-diagrama/proponer`, {
      method: 'POST',
      body: JSON.stringify({ diagrama }),
    }),
};

export interface RelacionRevisada {
  origen: string;
  destino: string;
  tipo: RelationKind;
  cardinalidadOrigen: string;
  cardinalidadDestino: string;
  /** El modelo no pudo leer la cardinalidad y esta es la que se ha supuesto. */
  dudosa: boolean;
}

export interface ResumenDiagramaLeido {
  clases: number;
  atributos: number;
  relaciones: number;
  filas: number;
  cardinalidadesDudosas: number;
}

export interface RespuestaLecturaDiagrama {
  modelo: string;
  diagrama: DiagramaExtraido;
  clases: string[];
  relaciones: RelacionRevisada[];
  avisos: AvisoImportacion[];
  aplicable: boolean;
  resumen: ResumenDiagramaLeido;
  confianzaDeclarada: number;
}

export interface RespuestaPropuestaDiagrama {
  clases: string[];
  relaciones: RelacionRevisada[];
  avisos: AvisoImportacion[];
  aplicable: boolean;
  resumen: ResumenDiagramaLeido;
  propuesta: PropuestaAsistente[];
}

export interface RespuestaLecturaTabla {
  modelo: string;
  tabla: TablaExtraida;
  clase: string;
  avisos: AvisoImportacion[];
  aplicable: boolean;
  /**
   * Lo que el modelo dice de sí mismo. Se enseña como dato y nunca como
   * permiso: en las pruebas que motivaron este diseño declaró 1.0 mientras
   * leía mal un correo electrónico.
   */
  confianzaDeclarada: number;
}

export interface RespuestaPropuestaTabla {
  clase: string;
  avisos: AvisoImportacion[];
  aplicable: boolean;
  propuesta: PropuestaAsistente[];
}

export interface PropuestaAsistente {
  operacion: Operation;
  descripcion: string;
}

export interface RespuestaAsistente {
  motor: string;
  confianza: number;
  aclaracion: string | null;
  explicacion: string;
  propuesta: PropuestaAsistente[];
}

/** Una sección del manual tal y como la manda el servidor. */
export interface FuenteDeLaGuia {
  documento: string;
  titulo: string;
  ruta: string[];
  ancla: string;
  texto: string;
}

export interface RespuestaGuia {
  /** El modelo que redactó, o `busqueda-en-el-manual` si nadie redactó. */
  motor: string;
  /** Nulo cuando no hubo modelo: entonces la respuesta son las `fuentes`. */
  texto: string | null;
  /** Por qué no hubo modelo, cuando se esperaba que lo hubiera. */
  aviso: string | null;
  fuentes: FuenteDeLaGuia[];
}

/**
 * Un problema de validación tal y como lo manda el servidor.
 *
 * Estaba declarado como `string[]`, y como nadie compara los tipos de una
 * respuesta HTTP con lo que de verdad llega, el error salía a pantalla como
 * «[object Object]» repetido cinco veces. La lección: el tipo de una respuesta
 * ajena es una afirmación sobre el otro lado, no una comprobación.
 */
export interface ProblemaValidacion {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  elementId?: string;
  elementName?: string;
}

/** «Pedido: una clase persistente necesita identificador» */
export function describirProblema(problema: ProblemaValidacion): string {
  return problema.elementName ? `${problema.elementName}: ${problema.message}` : problema.message;
}

export interface FicheroGenerado {
  ruta: string;
  bytes: number;
  contenido: string;
}

export interface OpcionesGeneracion {
  paqueteBase?: string;
  artifactId?: string;
  estrategiaHerencia?: string;
}

/**
 * Descarga el ZIP generado.
 *
 * Va aparte del resto porque la respuesta es binaria y con cabeceras propias:
 * pasarla por el mismo camino obligaría a que el ayudante genérico supiera de
 * `Blob`, de `Content-Disposition` y del aviso que el servidor manda en
 * `X-Avisos`, y todo eso solo lo necesita esta llamada.
 */
export async function descargarProyecto(
  id: string,
  nombreSugerido: string,
  opciones: OpcionesGeneracion = {},
): Promise<{ avisos: number }> {
  const cabeceras = new Headers({ 'Content-Type': 'application/json' });
  if (tokenActual) cabeceras.set('Authorization', `Bearer ${tokenActual}`);

  const respuesta = await fetch(`/api/proyectos/${id}/generacion`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify(opciones),
  }).catch(() => {
    throw new ApiError(0, 'No hay conexión con el servidor');
  });

  if (!respuesta.ok) {
    const detalle = (await respuesta.json().catch(() => null)) as {
      error?: string;
      errores?: ProblemaValidacion[];
    } | null;
    throw new ApiError(
      respuesta.status,
      detalle?.errores?.length
        ? `${detalle.error}: ${detalle.errores.map(describirProblema).join('; ')}`
        : (detalle?.error ?? `Error ${respuesta.status}`),
      'GENERACION_FALLIDA',
    );
  }

  const blob = await respuesta.blob();
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${nombreSugerido || 'proyecto'}.zip`;
  enlace.click();
  // Sin revocar, el ZIP entero se queda en memoria hasta recargar la página.
  URL.revokeObjectURL(url);

  return { avisos: Number(respuesta.headers.get('X-Avisos') ?? 0) };
}

/** URL del canal colaborativo para un proyecto, con el token en la consulta. */
export function urlColaboracion(proyectoId: string, token: string): string {
  const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocolo}//${location.host}/colaboracion?proyecto=${encodeURIComponent(
    proyectoId,
  )}&token=${encodeURIComponent(token)}`;
}

/** Utilidades de base64 para las actualizaciones Yjs, que son binarias. */
export function aBase64(bytes: Uint8Array): string {
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario);
}

export function deBase64(base64: string): Uint8Array {
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return bytes;
}
