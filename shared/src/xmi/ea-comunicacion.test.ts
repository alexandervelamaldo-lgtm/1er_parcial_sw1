import { describe, expect, it } from 'vitest';
import { createDiagram } from '../model/factory.js';
import type { ClassDiagram } from '../model/uml.js';
import type { CasoDeUso } from './analisis.js';
import { revisarModelo } from './analisis.js';
import { exportarComunicacionEa } from './ea-comunicacion.js';
import { leerXmi } from './import.js';

/**
 * Verificación de un fichero para Enterprise Architect sin Enterprise Architect.
 *
 * No hay forma de comprobar desde aquí que EA dibuje el diagrama: eso solo lo
 * dice EA. Pero sí hay una forma de comprobar que el fichero **dice lo que el
 * caso de uso dice**, y es pasarlo por nuestro propio importador, que es un
 * lector de XMI ajeno a este escritor y que ya se enfrentó a un fichero real de
 * EA. Si un mensaje se pierde por el camino, o un objeto llega sin saber de qué
 * clase es, `leerXmi` lo dice — es exactamente el fallo que tuvo el importador
 * cuando llegó el primer fichero de EA de verdad.
 *
 * Lo que esto prueba: que el cuerpo estándar está bien. Lo que no prueba: que el
 * bloque de extensión de EA esté bien, porque nuestro importador lo ignora. Para
 * eso se comprueba aparte que las piezas que EA necesita —`<diagrams>`, el
 * `message_link` de cada mensaje, la geometría de cada caja— estén ahí y estén
 * enganchadas entre sí, que es lo más cerca que se puede llegar.
 */

const vacio = (): ClassDiagram => createDiagram({ name: 'Proyecto' });

const acceso: CasoDeUso = {
  id: 'CU0',
  nombre: 'Iniciar sesión',
  paquete: 'Acceso',
  actor: 'Usuario',
  descripcion: 'El usuario se identifica con su correo y su contraseña.',
  precondicion: 'El usuario tiene una cuenta.',
  postcondicion: 'El usuario queda con una sesión abierta.',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    { alias: 'pantalla', clase: 'PantallaAcceso', estereotipo: 'boundary' },
    { alias: 'gestor', clase: 'GestorAcceso', estereotipo: 'control' },
    { alias: 'cuentas', clase: 'ColeccionUsuario', estereotipo: 'entity' },
  ],
  pasos: [
    { numero: '1', de: 'usuario', a: 'pantalla', mensaje: 'introducirCredenciales()' },
    { numero: '2', de: 'pantalla', a: 'gestor', mensaje: 'autenticar(correo, contrasena)' },
    { numero: '2.1', de: 'gestor', a: 'cuentas', mensaje: 'buscarPorCorreo(correo)' },
    { numero: '2.2', de: 'cuentas', a: 'gestor', mensaje: 'devolverUsuario()', retorno: true },
    { numero: '3', de: 'gestor', a: 'pantalla', mensaje: 'entregarSesion()', retorno: true },
  ],
  alternativos: [
    { nombre: 'Credenciales incorrectas', texto: 'El gestor rechaza y la pantalla lo dice.' },
  ],
  actividad: {
    nodos: [
      { id: 'i', tipo: 'inicio', calle: 'Usuario' },
      { id: 'a1', tipo: 'accion', calle: 'Usuario', texto: 'Escribir correo y contraseña' },
      { id: 'a2', tipo: 'accion', calle: 'Sistema', texto: 'Comprobar credenciales' },
      { id: 'd', tipo: 'decision', calle: 'Sistema', texto: '¿Son correctas?' },
      { id: 'a3', tipo: 'accion', calle: 'Sistema', texto: 'Abrir sesión' },
      { id: 'a4', tipo: 'accion', calle: 'Sistema', texto: 'Avisar del error' },
      { id: 'f', tipo: 'fin', calle: 'Sistema' },
    ],
    flujos: [
      { de: 'i', a: 'a1' },
      { de: 'a1', a: 'a2' },
      { de: 'a2', a: 'd' },
      { de: 'd', a: 'a3', guarda: 'Sí' },
      { de: 'd', a: 'a4', guarda: 'No' },
      { de: 'a3', a: 'f' },
      { de: 'a4', a: 'f' },
    ],
  },
};

/** El caso mínimo: dos participantes y un mensaje. */
const minimo: CasoDeUso = {
  ...acceso,
  id: 'CU00',
  nombre: 'Consultar la guía',
  participantes: [
    { alias: 'usuario', clase: 'Usuario', estereotipo: 'actor' },
    { alias: 'panel', clase: 'PanelDeAyuda', estereotipo: 'boundary' },
  ],
  pasos: [{ numero: '1', de: 'usuario', a: 'panel', mensaje: 'preguntar(texto)' }],
};

/** Extrae los valores de un atributo, en el orden en que aparecen. */
function atributos(xmi: string, nombre: string): string[] {
  const salida: string[] = [];
  const patron = new RegExp(`${nombre}="([^"]*)"`, 'g');
  let encontrado = patron.exec(xmi);
  while (encontrado !== null) {
    salida.push(encontrado[1]!);
    encontrado = patron.exec(xmi);
  }
  return salida;
}

describe('el caso de uso de prueba es válido', () => {
  it('pasa la revisión, para que un fallo aquí no se confunda con uno del escritor', () => {
    const problemas = revisarModelo({
      sistema: 'Prueba',
      actores: [{ nombre: 'Usuario', descripcion: 'Persona que usa la herramienta.' }],
      paquetes: [{ nombre: 'Acceso', descripcion: 'Entrar y salir.' }],
      casos: [acceso, minimo],
    });

    expect(problemas).toEqual([]);
  });
});

describe('XMI de comunicación para Enterprise Architect', () => {
  it('es XML bien formado y declara la codificación que de verdad tiene', () => {
    const xmi = exportarComunicacionEa(acceso);

    // Se declara UTF-8 porque el fichero lleva tildes. El de EA dice
    // windows-1252; copiar esa declaración y escribir UTF-8 rompería
    // «Comunicación» en la primera apertura.
    expect(xmi.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xmi).toContain('Comunicación - CU0 Iniciar sesión');
    expect(xmi.trimEnd().endsWith('</xmi:XMI>')).toBe(true);
  });

  it('vuelve a entrar por nuestro propio importador', () => {
    const resultado = leerXmi(exportarComunicacionEa(acceso), vacio());

    expect(resultado.aplicable).toBe(true);
    expect(resultado.comunicacion).toBe(true);
    expect(resultado.avisos.filter((a) => a.severidad === 'error')).toEqual([]);
  });

  it('no pierde ningún participante por el camino', () => {
    const resultado = leerXmi(exportarComunicacionEa(acceso), vacio());

    // Las clases, no los alias: el objeto se llama `pantalla` y su clase es
    // `PantallaAcceso`. Importar «Pantalla» sería el mismo fallo silencioso que
    // tuvo el importador con el fichero real de EA.
    expect(resultado.clases).toContain('PantallaAcceso');
    expect(resultado.clases).toContain('GestorAcceso');
    expect(resultado.clases).toContain('ColeccionUsuario');
  });

  it('no descarta ningún mensaje por no saber a quién va', () => {
    const resultado = leerXmi(exportarComunicacionEa(acceso), vacio());

    // El aviso que salta cuando una línea de vida llega sin clasificador. Es el
    // fallo que este formato invita a cometer, porque la clase está a tres
    // saltos del mensaje: mensaje → ocurrencia → línea de vida → propiedad.
    const perdidos = resultado.avisos.filter((a) => a.mensaje.includes('mensaje'));
    expect(perdidos).toEqual([]);
  });

  it('el único aviso que quedaba es la asociación del actor', () => {
    const resultado = leerXmi(exportarComunicacionEa(acceso), vacio());

    // `Usuario` se emite como `uml:Actor` para que EA lo dibuje como el monigote
    // y no como una caja más. Los dos lectores lo tratan distinto y los dos
    // aciertan: el de comunicaciones lo recoge, porque le llega por el mensaje y
    // no por la lista de clasificadores; el de clases no lo reconoce como
    // clasificador y descarta la asociación que lo une a la pantalla. Queda un
    // aviso, y es el correcto — una línea entre un actor y una clase no pinta
    // nada en un diagrama de clases.
    expect(resultado.clases).toContain('Usuario');
    expect(resultado.avisos).toHaveLength(1);
    expect(resultado.avisos[0]?.mensaje).toContain('no tiene dos extremos');
  });

  it('convierte en operación cada mensaje que se recibe, y solo esos', () => {
    const resultado = leerXmi(exportarComunicacionEa(acceso), vacio());
    const metodos = resultado.operaciones.filter((o) => o.op === 'addMethod');
    const nombres = metodos.map((m) => m.name);

    expect(nombres).toContain('autenticar');
    expect(nombres).toContain('buscarPorCorreo');
    // Un retorno no es una llamada: `devolverUsuario` es la vuelta de
    // `buscarPorCorreo` y no debe aparecer como operación de nadie.
    expect(nombres).not.toContain('devolverUsuario');
    expect(nombres).not.toContain('entregarSesion');
  });

  it('conserva los argumentos del mensaje como parámetros', () => {
    const resultado = leerXmi(exportarComunicacionEa(acceso), vacio());
    const autenticar = resultado.operaciones.find(
      (o) => o.op === 'addMethod' && o.name === 'autenticar',
    );

    expect(autenticar?.op).toBe('addMethod');
    if (autenticar?.op !== 'addMethod') return;
    expect(autenticar.parameters.map((p) => p.name)).toEqual(['correo', 'contrasena']);
  });

  it('aguanta el caso mínimo: dos participantes y un mensaje', () => {
    const resultado = leerXmi(exportarComunicacionEa(minimo), vacio());

    expect(resultado.aplicable).toBe(true);
    expect(resultado.clases).toContain('PanelDeAyuda');
  });
});

describe('lo que Enterprise Architect necesita para dibujarlo', () => {
  it('lleva el bloque de diagrama, que es lo que lo distingue de un volcado', () => {
    const xmi = exportarComunicacionEa(acceso);

    // Sin `<diagrams>` el fichero se importa igual: los elementos aparecen en el
    // navegador de proyecto y el diagrama hay que montarlo arrastrando cajas.
    // Es justo la limitación que el exportador de clases documenta y la razón de
    // que este módulo exista.
    expect(xmi).toContain('<diagrams>');
    expect(xmi).toContain('type="Collaboration"');
  });

  it('coloca cada objeto en una caja propia, sin dos en el mismo sitio', () => {
    const xmi = exportarComunicacionEa(acceso);
    const geometrias = atributos(xmi, 'geometry').filter((g) => g.startsWith('Left='));

    expect(geometrias).toHaveLength(acceso.participantes.length);
    expect(new Set(geometrias).size).toBe(geometrias.length);
    // Arriba es menor que abajo: EA cuenta la Y hacia abajo, e invertirlo da
    // cajas de altura negativa que no se ven.
    for (const g of geometrias) {
      const nums = /Left=(\d+);Top=(\d+);Right=(\d+);Bottom=(\d+);/.exec(g);
      expect(nums).not.toBeNull();
      expect(Number(nums![3])).toBeGreaterThan(Number(nums![1]));
      expect(Number(nums![4])).toBeGreaterThan(Number(nums![2]));
    }
  });

  it('cada mensaje va montado sobre un enlace que existe', () => {
    const xmi = exportarComunicacionEa(acceso);
    const enlaces = new Set(atributos(xmi, 'message_link'));
    const conectores = new Set(atributos(xmi, 'xmi:idref'));

    // `message_link` apunta al enlace por el que viaja el mensaje. Si apunta a
    // algo que no está en el fichero, el mensaje entra en el modelo y no se
    // dibuja: se pierde en silencio, que es la peor forma de perderse.
    expect(enlaces.size).toBeGreaterThan(0);
    for (const enlace of enlaces) {
      expect(conectores.has(enlace)).toBe(true);
    }
  });

  it('rotula cada mensaje con su número de secuencia', () => {
    const xmi = exportarComunicacionEa(acceso);
    const rotulos = atributos(xmi, 'lt');

    // En una comunicación el orden no se lee en la posición, como en una
    // secuencia: se lee en el número. Un rótulo sin número deja el diagrama sin
    // orden.
    expect(rotulos).toContain('2: autenticar(correo, contrasena)');
    expect(rotulos).toContain('2.1: buscarPorCorreo(correo)');
    expect(atributos(xmi, 'privatedata4')).toContain('2.1');
  });

  it('separa los rótulos de los mensajes que comparten enlace', () => {
    const xmi = exportarComunicacionEa(acceso);
    // `pantalla`→`gestor` y `gestor`→`pantalla` van por el mismo enlace: son dos
    // rótulos en la misma línea. Si los dos salen con el mismo desplazamiento se
    // dibujan uno encima de otro.
    const desplazamientos = atributos(xmi, 'geometry')
      .filter((g) => g.startsWith('SX='))
      .map((g) => /SY=(-?\d+);/.exec(g)?.[1]);

    expect(new Set(desplazamientos).size).toBeGreaterThan(1);
  });

  it('marca el retorno como retorno', () => {
    const xmi = exportarComunicacionEa(acceso);

    expect(atributos(xmi, 'stateflags')).toContain('IsReturn=true;');
    expect(atributos(xmi, 'privatedata3')).toContain('Return');
  });

  it('declara el tipo de retorno al que apuntan las operaciones', () => {
    const xmi = exportarComunicacionEa(acceso);

    // Todas las operaciones tienen `type="EAnone_void"`. Si el elemento no se
    // declara, EA lo importa como una referencia rota.
    expect(xmi).toContain('xmi:id="EAnone_void"');
  });

  it('no repite ningún identificador de elemento', () => {
    const xmi = exportarComunicacionEa(acceso);
    // Solo los del cuerpo: en el bloque de extensión, el mismo enlace aparece
    // dentro de los dos objetos que une, y ahí repetir el id es lo correcto —es
    // así como EA sabe que es la misma línea.
    const ids = xmi
      .split('\n')
      .filter((linea) => linea.includes('<packagedElement') || linea.includes('<ownedConnector'))
      .flatMap((linea) => atributos(linea, 'xmi:id'));

    // Dos elementos con el mismo id se funden en uno al importar: el fichero
    // abre bien y falta una caja.
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('es reproducible: dos exportaciones del mismo caso son idénticas', () => {
    // Los ids salen de un hash del contenido, no de un contador ni de un reloj.
    // Así el `diff` de una regeneración enseña lo que cambió de verdad, y
    // reimportar en EA actualiza los elementos en vez de duplicarlos.
    expect(exportarComunicacionEa(acceso)).toBe(exportarComunicacionEa(acceso));
  });

  it('casos distintos no comparten identificadores', () => {
    // `EAnone_void` y su paquete son constantes conocidas de EA, iguales en
    // todos los ficheros a propósito: es el tipo «no devuelve nada».
    const propios = (id: string): boolean => /^EA(ID|PK)_/.test(id);
    const unos = new Set(atributos(exportarComunicacionEa(acceso), 'xmi:id').filter(propios));
    const otros = atributos(exportarComunicacionEa(minimo), 'xmi:id').filter(propios);
    const compartidos = otros.filter((id) => unos.has(id));

    // Los diecinueve ficheros se importan en el mismo proyecto de EA. Si dos casos
    // usan el mismo id para su pantalla, el segundo import pisa al primero.
    expect(compartidos).toEqual([]);
  });

  it('permite quitar los mensajes estándar sin tocar nada más', () => {
    const sinMensajes = exportarComunicacionEa(acceso, { mensajesEstandar: false });

    // La escotilla por si EA se queja de los `uml:Message` que él mismo no
    // escribe. El diagrama sigue entero; lo que se pierde es poder verificarlo
    // aquí.
    expect(sinMensajes).not.toContain('uml:Message');
    expect(sinMensajes).toContain('<diagrams>');
    expect(atributos(sinMensajes, 'lt')).toContain('2.1: buscarPorCorreo(correo)');

    // Las clases y sus operaciones siguen enteras: viven en `ownedOperation`, no
    // en los mensajes. Lo que se pierde es la traza de quién llama a quién, que
    // es justo lo que verifican las pruebas de más arriba — de ahí que la opción
    // exista pero no sea la de por defecto.
    const resultado = leerXmi(sinMensajes, vacio());
    expect(resultado.aplicable).toBe(true);
    expect(resultado.clases).toContain('GestorAcceso');
    expect(
      resultado.operaciones.filter((o) => o.op === 'addMethod' && o.name === 'autenticar'),
    ).toHaveLength(1);
  });
});
