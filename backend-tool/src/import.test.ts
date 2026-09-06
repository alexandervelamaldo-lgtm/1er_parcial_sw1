import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DiagramaExtraido, TablaExtraida } from '@app/shared';
import { loadConfig } from './config.js';
import { createApp, createDependencies, type AppDependencies } from './app.js';
import { ErrorDeModelo } from './ai/transporte.js';
import type { VisionEngine } from './ai/vision.js';

/**
 * Pruebas de integración de la importación por fotografía (RF-OCR-01 … RF-OCR-04).
 *
 * El motor de visión se sustituye por un doble. No es por comodidad: llamar al
 * proveedor real desde una prueba la haría depender de la red, del saldo de la
 * clave y de que el modelo devuelva hoy lo mismo que ayer, y además gastaría
 * dinero en cada ejecución. Lo que hay que comprobar aquí no es que el modelo
 * lea bien —no lo hace siempre, y de ahí la revisión humana— sino que todo lo
 * que rodea al modelo se comporta: permisos, límites de tamaño, validación de
 * formato y, sobre todo, que ninguna de las dos rutas escribe en el diagrama.
 */

let app: Express;
let deps: AppDependencies;
let dataDir: string;
let vision: VisionDoble;

/** Motor de visión falso: devuelve lo que se le diga y anota si lo llamaron. */
class VisionDoble implements VisionEngine {
  readonly model = 'modelo-de-prueba';
  llamadas = 0;
  respuesta: TablaExtraida | Error = {
    tabla: 'Empleado',
    columnas: [
      { nombre: 'id', tipo: 'Long', esClave: true },
      { nombre: 'nombre', tipo: 'texto', esClave: false },
    ],
    filas: [
      ['1', 'Ana Pérez'],
      ['2', 'Luis Gómez'],
    ],
    confianza: 1,
    ilegible: [],
  };

  /** El diagrama de la foto del enunciado: tres clases y dos asociaciones. */
  respuestaDiagrama: DiagramaExtraido | Error = {
    clases: [
      { nombre: 'Class A', estereotipo: 'class', atributos: [], filas: [] },
      { nombre: 'Class B', estereotipo: 'class', atributos: [], filas: [] },
      { nombre: 'Class C', estereotipo: 'class', atributos: [], filas: [] },
    ],
    relaciones: [
      {
        origen: 'Class A',
        destino: 'Class B',
        tipo: 'association',
        cardinalidadOrigen: '1',
        cardinalidadDestino: '0..*',
        nombre: 'Association A',
      },
      {
        origen: 'Class B',
        destino: 'Class C',
        tipo: 'association',
        cardinalidadOrigen: '1',
        cardinalidadDestino: '0..1',
        nombre: 'Association B',
      },
    ],
    confianza: 1,
    ilegible: [],
  };

  async extraerTabla(): Promise<TablaExtraida> {
    this.llamadas += 1;
    if (this.respuesta instanceof Error) throw this.respuesta;
    return this.respuesta;
  }

  async extraerDiagrama(): Promise<DiagramaExtraido> {
    this.llamadas += 1;
    if (this.respuestaDiagrama instanceof Error) throw this.respuestaDiagrama;
    return this.respuestaDiagrama;
  }
}

/** PNG de 1×1 válido: lo que importa es que la firma de bytes sea la real. */
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function registrar(email: string): Promise<string> {
  const response = await request(app)
    .post('/api/auth/registro')
    .send({ email, password: 'contraseña-larga', nombre: email.split('@')[0] });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

async function crearProyecto(token: string): Promise<string> {
  const response = await request(app)
    .post('/api/proyectos')
    .set('Authorization', `Bearer ${token}`)
    .send({ nombre: 'Tienda', descripcion: '' });
  expect(response.status).toBe(201);
  return response.body.proyecto.id as string;
}

async function invitar(
  token: string,
  proyectoId: string,
  email: string,
  rol: 'editor' | 'viewer',
): Promise<void> {
  const response = await request(app)
    .post(`/api/proyectos/${proyectoId}/miembros`)
    .set('Authorization', `Bearer ${token}`)
    .send({ email, rol });
  expect(response.status).toBe(201);
}

function leer(token: string, proyectoId: string, cuerpo: Record<string, unknown>) {
  return request(app)
    .post(`/api/proyectos/${proyectoId}/importar-tabla/leer`)
    .set('Authorization', `Bearer ${token}`)
    .send(cuerpo);
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'uml-ocr-'));
  const config = { ...loadConfig({ SESSION_SECRET: 'secreto-de-prueba' }), dataDir };
  deps = await createDependencies(config);
  vision = new VisionDoble();
  app = createApp({ ...deps, vision }).app;
});

afterEach(async () => {
  await deps.rooms.shutdown();
  await rm(dataDir, { recursive: true, force: true });
});

describe('lectura de la foto', () => {
  it('devuelve la tabla leída y la interpretación, sin tocar el diagrama', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await leer(token, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.status).toBe(200);
    expect(response.body.tabla.tabla).toBe('Empleado');
    expect(response.body.clase).toBe('Empleado');
    expect(response.body.aplicable).toBe(true);
    expect(response.body.modelo).toBe('modelo-de-prueba');

    // Lo esencial de todo el diseño: leer no escribe.
    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);
    expect(Object.keys(diagrama.body.diagrama.classes)).toHaveLength(0);
  });

  it('acepta la imagen con el prefijo «data:» que pone el navegador', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await leer(token, proyectoId, {
      imagen: `data:image/png;base64,${PNG_1X1}`,
      mimeType: 'image/png',
    });

    expect(response.status).toBe(200);
  });

  it('expone la confianza como dato y no como permiso', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await leer(token, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.body.confianzaDeclarada).toBe(1);
    // No existe ningún campo que autorice a saltarse la revisión. Si algún día
    // aparece uno, esta prueba debe fallar antes de que el cliente lo use.
    expect(response.body).not.toHaveProperty('aplicarDirectamente');
    expect(response.body).not.toHaveProperty('autoAplicable');
  });

  it('traslada los avisos del modelo para que la revisión los vea de entrada', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    vision.respuesta = {
      tabla: 'Empleado',
      columnas: [{ nombre: 'id', tipo: 'Long', esClave: true }],
      filas: [],
      confianza: 0.4,
      ilegible: ['la esquina inferior está doblada'],
    };

    const response = await leer(token, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.body.avisos.some((a: { mensaje: string }) => a.mensaje.includes('doblada')))
      .toBe(true);
  });

  it('avisa de que la clase ya existe en vez de proponer un duplicado', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operaciones: [{ op: 'addClass', name: 'Empleado', kind: 'class' }] });

    const response = await leer(token, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.body.aplicable).toBe(false);
    expect(response.body.avisos[0].mensaje).toContain('Ya hay una clase');
  });
});

describe('lo que la ruta de lectura rechaza antes de gastar la clave', () => {
  it('rechaza a quien solo puede leer el proyecto (RNF-SEG-04)', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);
    await invitar(ana, proyectoId, 'beto@ejemplo.com', 'viewer');

    const response = await leer(beto, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.status).toBe(403);
    // Y no ha llegado a subir la imagen al proveedor: subirla ya cuesta dinero.
    expect(vision.llamadas).toBe(0);
  });

  it('deja pasar a un editor invitado', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);
    await invitar(ana, proyectoId, 'beto@ejemplo.com', 'editor');

    const response = await leer(beto, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });
    expect(response.status).toBe(200);
  });

  it('rechaza sin sesión', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await request(app)
      .post(`/api/proyectos/${proyectoId}/importar-tabla/leer`)
      .send({ imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.status).toBe(401);
    expect(vision.llamadas).toBe(0);
  });

  it('rechaza lo que no está codificado en base64', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    // Node descodificaría esto en silencio a un buffer corto, y el fallo
    // aparecería mucho después como «el modelo no ve ninguna tabla».
    const response = await leer(token, proyectoId, {
      imagen: 'esto no es base64 ¡¡!!',
      mimeType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(vision.llamadas).toBe(0);
  });

  it('rechaza un contenido que no es la imagen que dice ser', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    // base64 válido, pero los bytes no son un PNG: un ZIP o un ejecutable
    // llegarían igual si no se comprobara la firma.
    const response = await leer(token, proyectoId, {
      imagen: Buffer.from('PK esto es un zip disfrazado').toString('base64'),
      mimeType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('IMAGEN_NO_VALIDA');
    expect(vision.llamadas).toBe(0);
  });

  it('rechaza un mimeType que no está en la lista blanca', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await leer(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/svg+xml',
    });

    expect(response.status).toBe(400);
    expect(vision.llamadas).toBe(0);
  });

  it('rechaza una imagen que supera el máximo, diciendo cuánto pesa', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    // Un PNG de verdad, con su firma correcta, pero pasado del máximo. El
    // exceso es pequeño a propósito: así el cuerpo cabe en el límite de Express
    // y quien comprueba el tamaño es la ruta, que sabe explicar qué hacer.
    const grande = Buffer.concat([
      Buffer.from(PNG_1X1, 'base64'),
      Buffer.alloc(4 * 1024 * 1024 + 50 * 1024, 0x41),
    ]);

    const response = await leer(token, proyectoId, {
      imagen: grande.toString('base64'),
      mimeType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('IMAGEN_DEMASIADO_GRANDE');
    expect(response.body.error).toContain('MB');
    expect(vision.llamadas).toBe(0);
  });

  it('un cuerpo desmesurado lo corta Express antes de llegar a la ruta', async () => {
    // Documenta el reparto: la ruta explica el exceso razonable; el middleware
    // corta lo que no tiene sentido ni intentar descodificar. Lo que no puede
    // pasar es que una foto *dentro* del máximo rebote aquí, que es por lo que
    // el límite del cuerpo se deriva de `maxImageBytes` y no es una constante.
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const enorme = Buffer.alloc(12 * 1024 * 1024, 0x41).toString('base64');
    const response = await leer(token, proyectoId, { imagen: enorme, mimeType: 'image/png' });

    expect(response.status).toBe(413);
    expect(vision.llamadas).toBe(0);
  });

  it('explica qué configurar cuando la instalación no tiene modelo de visión', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    const sinVision = createApp({ ...deps, vision: undefined }).app;

    const response = await request(sinVision)
      .post(`/api/proyectos/${proyectoId}/importar-tabla/leer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('SIN_MODELO_VISION');
    expect(response.body.error).toContain('LLM_VISION_MODEL');
  });

  it('propaga el motivo del proveedor en vez de un error genérico', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    vision.respuesta = new ErrorDeModelo('402 Insufficient Balance');

    const response = await leer(token, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('LECTURA_FALLIDA');
    // «Saldo agotado» y «la foto no se entiende» se arreglan de forma muy
    // distinta, y solo el mensaje del proveedor distingue una de otra.
    expect(response.body.error).toContain('Insufficient Balance');
  });
});

describe('propuesta a partir de la tabla revisada', () => {
  const tablaRevisada = {
    tabla: 'Empleado',
    columnas: [
      { nombre: 'id', tipo: 'Long', esClave: true },
      { nombre: 'nombre', tipo: 'String', esClave: false },
    ],
    filas: [['1', 'Ana Pérez']],
    confianza: 1,
    ilegible: [],
  };

  function proponer(token: string, proyectoId: string, tabla: unknown) {
    return request(app)
      .post(`/api/proyectos/${proyectoId}/importar-tabla/proponer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tabla });
  }

  it('devuelve operaciones con su descripción, y tampoco escribe', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await proponer(token, proyectoId, tablaRevisada);

    expect(response.status).toBe(200);
    expect(response.body.aplicable).toBe(true);
    expect(response.body.propuesta[0].operacion.op).toBe('addClass');
    expect(response.body.propuesta[0].descripcion).toContain('Empleado');

    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);
    expect(Object.keys(diagrama.body.diagrama.classes)).toHaveLength(0);
  });

  it('revalida la tabla aunque venga de nuestra propia ruta de lectura', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    // Entre leer y proponer ha pasado por el navegador, que no es una frontera
    // de confianza: aquí llega ya editada por el usuario.
    const response = await proponer(token, proyectoId, { tabla: 'X', columnas: 'no es una lista' });

    expect(response.status).toBe(400);
  });

  it('rechaza un nombre de tabla que no da un identificador Java (RNF-SEG-06)', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await proponer(token, proyectoId, {
      ...tablaRevisada,
      tabla: '1; DROP TABLE empleados',
    });

    expect(response.status).toBe(200);
    expect(response.body.aplicable).toBe(false);
    expect(response.body.propuesta).toHaveLength(0);
  });

  it('exige permiso de edición', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);
    await invitar(ana, proyectoId, 'beto@ejemplo.com', 'viewer');

    expect((await proponer(beto, proyectoId, tablaRevisada)).status).toBe(403);
  });

  it('funciona sin modelo de visión: la revisión no depende del proveedor', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    const sinVision = createApp({ ...deps, vision: undefined }).app;

    const response = await request(sinVision)
      .post(`/api/proyectos/${proyectoId}/importar-tabla/proponer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tabla: tablaRevisada });

    expect(response.status).toBe(200);
    expect(response.body.aplicable).toBe(true);
  });
});

describe('el recorrido entero, hasta el SQL generado', () => {
  it('foto → revisión → propuesta → aplicación → data.sql', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    // 1. Se lee la foto. No escribe nada.
    const lectura = await leer(token, proyectoId, { imagen: PNG_1X1, mimeType: 'image/png' });
    expect(lectura.status).toBe(200);

    // 2. La persona corrige lo que el modelo leyó mal. Es el único punto del
    //    recorrido donde alguien compara lo escrito con lo fotografiado.
    const revisada = lectura.body.tabla;
    revisada.filas[0][1] = 'Ana Pérez Corregido';

    // 3. Se piden las operaciones. Tampoco escribe.
    const propuesta = await request(app)
      .post(`/api/proyectos/${proyectoId}/importar-tabla/proponer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tabla: revisada });
    expect(propuesta.status).toBe(200);

    // 4. Aplicar es una tercera llamada explícita, por el mismo camino que el
    //    ratón y la voz.
    const operaciones = propuesta.body.propuesta.map(
      (p: { operacion: unknown }) => p.operacion,
    );
    const aplicacion = await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operaciones });
    expect(aplicacion.status).toBe(200);

    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);
    const clase = Object.values(diagrama.body.diagrama.classes)[0] as {
      name: string;
      seedRows: Record<string, string>[];
    };
    expect(clase.name).toBe('Empleado');
    expect(clase.seedRows).toHaveLength(2);

    // 5. Y lo corregido —no lo que leyó el modelo— es lo que acaba en el SQL.
    const generacion = await request(app)
      .post(`/api/proyectos/${proyectoId}/generacion/previsualizacion`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(generacion.status).toBe(200);

    const sql = (generacion.body.ficheros as { ruta: string; contenido: string }[]).find((f) =>
      f.ruta.endsWith('V2__datos_iniciales.sql'),
    );
    expect(sql?.contenido).toContain("'Ana Pérez Corregido'");
    expect(sql?.contenido).not.toContain("'Ana Pérez'");
  });
});

// ---------------------------------------------------------------------------
// Diagrama de clases entero (RF-VIS-01)
// ---------------------------------------------------------------------------

/**
 * Las mismas garantías que arriba, sobre el caso que de verdad pidió el usuario:
 * fotografiar un diagrama de clases completo, no una tabla suelta.
 *
 * Lo que cambia respecto a la tabla es el coste del error. Una celda mal leída
 * estropea un dato; una cardinalidad mal leída estropea el esquema, porque de
 * ella depende que el generador emita una clave foránea o una tabla de unión. Por
 * eso hay pruebas dedicadas a que la duda del modelo llegue a la pantalla en vez
 * de convertirse en una suposición silenciosa.
 */
describe('lectura de un diagrama de clases fotografiado', () => {
  function leerDiagrama(token: string, proyectoId: string, cuerpo: Record<string, unknown>) {
    return request(app)
      .post(`/api/proyectos/${proyectoId}/importar-diagrama/leer`)
      .set('Authorization', `Bearer ${token}`)
      .send(cuerpo);
  }

  it('traduce un 503 del proveedor en vez de escupir su JSON', async () => {
    // Lo que le llegaba al usuario era «No se pudo leer la imagen: 503 [{ "error":
    // { "code": 503, … } }]». Eso parece una avería del programa y da a entender
    // que la culpa es de su foto, cuando lo único que pasa es que el modelo está
    // ocupado y basta con reintentar. El cuerpo crudo se conserva detrás, que es
    // lo que sirve para depurar.
    const token = await registrar('saturado@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    vision.respuestaDiagrama = new ErrorDeModelo(
      '503 [{ "error": { "code": 503, "message": "high demand" } }]',
      503,
    );

    const response = await leerDiagrama(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('LECTURA_FALLIDA');
    expect(response.body.error).toMatch(/saturado/);
    expect(response.body.error).toMatch(/vuelve a intentarlo/i);
    expect(response.body.error).toMatch(/high demand/);
  });

  it('un 404 manda a mirar LLM_VISION_MODEL, no la foto', async () => {
    // Es el caso del modelo retirado: `gemini-2.0-flash` dejó de existir de un
    // día para otro. El fallo no tiene nada que ver con la imagen, y decirlo así
    // le ahorra a quien lo sufre buscar donde no hay nada.
    const token = await registrar('retirado@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    vision.respuestaDiagrama = new ErrorDeModelo(
      '404 This model is no longer available. Please use models/otro',
      404,
    );

    const response = await leerDiagrama(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(response.body.error).toMatch(/LLM_VISION_MODEL/);
    expect(response.body.error).toMatch(/models\/otro/);
  });

  it('un 404 en HTML manda a mirar la URL, que es otra avería distinta', async () => {
    /*
      Este caso se descubrió sufriéndolo. Con `LLM_VISION_BASE_URL` puesta a
      `https://googleapis.com` —el dominio paraguas de Google, no el de la API—
      la petición acaba en `https://googleapis.com/chat/completions`, que no
      existe, y el servidor web devuelve su página de error genérica. Es un 404
      como el del modelo retirado, así que el mensaje mandaba a revisar
      `LLM_VISION_MODEL`. El nombre del modelo era irrelevante: con el correcto
      habría fallado igual, y quien lo sufrió estuvo cambiando la variable que
      no era.

      Lo que los separa es el cuerpo. La API contesta JSON; un servidor web que
      no encuentra la ruta contesta HTML. La prueba usa el HTML literal de
      Google, recortado como llega —`pedirAlModelo` se queda con los primeros
      300 caracteres—, para que sea el caso real y no una versión de laboratorio
      que casaría con cualquier cosa.
    */
    const token = await registrar('urlmala@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    vision.respuestaDiagrama = new ErrorDeModelo(
      '404 <!DOCTYPE html> <html lang=en> <meta charset=utf-8> ' +
        '<title>Error 404 (Not Found)!!1</title>',
      404,
    );

    const response = await leerDiagrama(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(response.body.error).toMatch(/LLM_VISION_BASE_URL/);
    expect(response.body.error).toMatch(/generativelanguage\.googleapis\.com/);
    // Y sobre todo: que no vuelva a mandar a la variable que no toca.
    expect(
      response.body.error,
      'un 404 en HTML no dice nada del nombre del modelo',
    ).not.toMatch(/LLM_VISION_MODEL/);
  });

  it('devuelve las clases y las relaciones, sin tocar el diagrama', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await leerDiagrama(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(response.status).toBe(200);
    expect(response.body.clases).toEqual(['ClassA', 'ClassB', 'ClassC']);
    expect(response.body.resumen.relaciones).toBe(2);
    expect(response.body.aplicable).toBe(true);

    // Lo esencial de todo el diseño: leer no escribe.
    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);
    expect(Object.keys(diagrama.body.diagrama.classes)).toHaveLength(0);
  });

  it('canoniza «0..*» y conserva «0..1»', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await leerDiagrama(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(response.body.relaciones[0].cardinalidadDestino).toBe('*');
    expect(response.body.relaciones[1].cardinalidadDestino).toBe('0..1');
  });

  it('cuenta las cardinalidades dudosas para que la pantalla las destaque', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    const respuesta = vision.respuestaDiagrama as DiagramaExtraido;
    respuesta.relaciones[1]!.cardinalidadDestino = '';

    const response = await leerDiagrama(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    // Enterrarlo en la lista de avisos sería enterrarlo: este número existe para
    // que se pueda decir «2 relaciones sin cardinalidad legible» de entrada.
    expect(response.body.resumen.cardinalidadesDudosas).toBe(1);
    expect(response.body.relaciones[1].dudosa).toBe(true);
  });

  it('rechaza a quien solo puede leer, sin gastar la clave', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);
    await invitar(ana, proyectoId, 'beto@ejemplo.com', 'viewer');

    const response = await leerDiagrama(beto, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(response.status).toBe(403);
    expect(vision.llamadas).toBe(0);
  });

  it('aplica las mismas comprobaciones de imagen que la ruta de tablas', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    // Si esta ruta se hubiera escrito por su cuenta, aquí es donde se le habría
    // olvidado comprobar la firma.
    const response = await leerDiagrama(token, proyectoId, {
      imagen: Buffer.from('PK esto es un zip disfrazado').toString('base64'),
      mimeType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('IMAGEN_NO_VALIDA');
    expect(vision.llamadas).toBe(0);
  });

  it('propaga el motivo del proveedor', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    vision.respuestaDiagrama = new ErrorDeModelo(
      'el modelo no ha encontrado ningún diagrama de clases en la imagen',
    );

    const response = await leerDiagrama(token, proyectoId, {
      imagen: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('LECTURA_FALLIDA');
    expect(response.body.error).toContain('ningún diagrama');
  });
});

describe('propuesta a partir del diagrama revisado', () => {
  const diagramaRevisado = {
    clases: [
      { nombre: 'Pedido', estereotipo: 'class', atributos: [], filas: [] },
      { nombre: 'Linea', estereotipo: 'class', atributos: [], filas: [] },
    ],
    relaciones: [
      {
        origen: 'Pedido',
        destino: 'Linea',
        tipo: 'composition',
        cardinalidadOrigen: '1',
        cardinalidadDestino: '*',
        nombre: '',
      },
    ],
    confianza: 1,
    ilegible: [],
  };

  function proponer(token: string, proyectoId: string, diagrama: unknown) {
    return request(app)
      .post(`/api/proyectos/${proyectoId}/importar-diagrama/proponer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ diagrama });
  }

  it('devuelve operaciones con su descripción, y tampoco escribe', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await proponer(token, proyectoId, diagramaRevisado);

    expect(response.status).toBe(200);
    expect(response.body.aplicable).toBe(true);
    expect(response.body.propuesta[0].operacion.op).toBe('addClass');

    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);
    expect(Object.keys(diagrama.body.diagrama.classes)).toHaveLength(0);
  });

  it('revalida aunque venga de nuestra propia ruta de lectura', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await proponer(token, proyectoId, { clases: 'no es una lista' });
    expect(response.status).toBe(400);
  });

  it('rechaza un nombre de clase hostil sin limpiarlo (RNF-SEG-06)', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const response = await proponer(token, proyectoId, {
      ...diagramaRevisado,
      clases: [{ nombre: "1; DROP TABLE pedidos", estereotipo: 'class', atributos: [], filas: [] }],
      relaciones: [],
    });

    expect(response.status).toBe(200);
    expect(response.body.aplicable).toBe(false);
    expect(response.body.propuesta).toHaveLength(0);
  });

  it('exige permiso de edición', async () => {
    const ana = await registrar('ana@ejemplo.com');
    const beto = await registrar('beto@ejemplo.com');
    const proyectoId = await crearProyecto(ana);
    await invitar(ana, proyectoId, 'beto@ejemplo.com', 'viewer');

    expect((await proponer(beto, proyectoId, diagramaRevisado)).status).toBe(403);
  });

  it('funciona sin modelo de visión: la revisión no depende del proveedor', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);
    const sinVision = createApp({ ...deps, vision: undefined }).app;

    const response = await request(sinVision)
      .post(`/api/proyectos/${proyectoId}/importar-diagrama/proponer`)
      .set('Authorization', `Bearer ${token}`)
      .send({ diagrama: diagramaRevisado });

    expect(response.status).toBe(200);
    expect(response.body.aplicable).toBe(true);
  });

  it('foto → revisión → aplicación deja el diagrama con sus relaciones', async () => {
    const token = await registrar('ana@ejemplo.com');
    const proyectoId = await crearProyecto(token);

    const propuesta = await proponer(token, proyectoId, diagramaRevisado);
    const operaciones = propuesta.body.propuesta.map((p: { operacion: unknown }) => p.operacion);

    const aplicacion = await request(app)
      .post(`/api/proyectos/${proyectoId}/diagrama/operaciones`)
      .set('Authorization', `Bearer ${token}`)
      .send({ operaciones });
    expect(aplicacion.status).toBe(200);

    const diagrama = await request(app)
      .get(`/api/proyectos/${proyectoId}/diagrama`)
      .set('Authorization', `Bearer ${token}`);

    expect(Object.keys(diagrama.body.diagrama.classes)).toHaveLength(2);
    // La composición 1→* es lo que hace que el generador ponga la clave foránea
    // en Linea. Que llegue entera hasta aquí es el objetivo de toda la función.
    const relaciones = Object.values(diagrama.body.diagrama.relations) as {
      kind: string;
      source: { multiplicity: string };
      target: { multiplicity: string };
    }[];
    expect(relaciones).toHaveLength(1);
    expect(relaciones[0]?.kind).toBe('composition');
    expect(relaciones[0]?.target.multiplicity).toBe('*');
  });
});
