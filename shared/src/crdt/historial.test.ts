import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MAXIMO_ENTRADAS,
  autoriaDeClase,
  componerEntrada,
  getClassesMap,
  getHistorialArray,
  getRelationsMap,
  historialDeClase,
  leerHistorial,
  registrarCambio,
  type Autor,
  type Operation,
} from '../index.js';

/**
 * Pruebas del historial de cambios.
 *
 * Lo que se comprueba aquí es sobre todo lo que el historial *no* debe hacer:
 * no registrar arrastres, no perder entradas cuando dos personas escriben a la
 * vez, no dejar que `Ctrl+Z` borre el rastro de lo que se deshizo, no confundir
 * a quien confirma con lo que propone. Nada de eso lo detecta el compilador, y
 * todos son fallos que solo se notan meses después, cuando ya no hay forma de
 * reconstruir lo que pasó.
 */

const ana: Autor = { id: 'u-ana', nombre: 'Ana' };
const beto: Autor = { id: 'u-beto', nombre: 'Beto' };

const crearPedido: Operation = { op: 'addClass', name: 'Pedido', kind: 'class' };

describe('componerEntrada: qué merece quedar registrado', () => {
  it('un cambio de estructura produce una entrada', () => {
    const entrada = componerEntrada({ autor: ana, origen: 'manual', operaciones: [crearPedido] });
    expect(entrada).not.toBeNull();
    expect(entrada?.autorNombre).toBe('Ana');
    expect(entrada?.resumen).toContain('Pedido');
  });

  it('arrastrar una caja no produce ninguna', () => {
    const entrada = componerEntrada({
      autor: ana,
      origen: 'manual',
      operaciones: [{ op: 'moveClass', ref: { id: 'c1' }, position: { x: 10, y: 10 } }],
    });
    expect(entrada).toBeNull();
  });

  it('en un lote mixto, los movimientos no se listan pero el resto sí', () => {
    const entrada = componerEntrada({
      autor: ana,
      origen: 'manual',
      operaciones: [
        { op: 'moveClass', ref: { id: 'c1' }, position: { x: 10, y: 10 } },
        crearPedido,
      ],
    });
    // Una sola operación con interés: el resumen la describe y no hay detalles
    // que desplegar, porque repetir la misma línea debajo no informa de nada.
    expect(entrada?.resumen).toContain('Pedido');
    expect(entrada?.detalles).toEqual([]);
  });

  it('un lote de doce clases es un solo acto del usuario, no doce entradas', () => {
    const operaciones: Operation[] = Array.from({ length: 12 }, (_, i) => ({
      op: 'addClass',
      name: `Clase${String(i)}`,
      kind: 'class',
    }));
    const entrada = componerEntrada({ autor: ana, origen: 'foto', operaciones });
    expect(entrada?.resumen).toContain('11 cambios más');
    expect(entrada?.detalles).toHaveLength(12);
  });

  it('separa quién confirma de qué lo propuso', () => {
    const entrada = componerEntrada({
      autor: ana,
      origen: 'foto',
      propuestoPor: 'gemini-3.6-flash',
      operaciones: [crearPedido],
    });
    expect(entrada?.autorNombre).toBe('Ana');
    expect(entrada?.propuestoPor).toBe('gemini-3.6-flash');
    expect(entrada?.origen).toBe('foto');
  });

  it('sin sesión no se atribuye el cambio a nadie en concreto', () => {
    const entrada = componerEntrada({ autor: null, origen: 'manual', operaciones: [crearPedido] });
    expect(entrada?.autorId).toBe('');
    expect(entrada?.autorNombre).toBe('Alguien sin sesión');
  });

  it('deshacer se registra aunque no lleve operaciones detrás', () => {
    const entrada = componerEntrada({
      autor: ana,
      origen: 'deshacer',
      operaciones: [],
      resumen: 'Deshizo: Crear clase «Pedido»',
    });
    expect(entrada?.resumen).toBe('Deshizo: Crear clase «Pedido»');
  });

  it('un nombre desmesurado se recorta antes de entrar en el documento', () => {
    // Los nombres llegan de OCR y de ficheros XMI ajenos (RNF-SEG-06). No se
    // sanean quitando caracteres —eso corrompe nombres legítimos— pero tampoco
    // se deja que uno solo infle el documento que descarga todo el equipo.
    const entrada = componerEntrada({
      autor: ana,
      origen: 'xmi',
      operaciones: [{ op: 'addClass', name: 'A'.repeat(5000), kind: 'class' }],
    });
    expect(entrada?.resumen.length).toBeLessThan(300);
  });
});

describe('registrarCambio sobre el documento', () => {
  it('la entrada queda en el documento y se lee de vuelta', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, { autor: ana, origen: 'manual', operaciones: [crearPedido] });

    const historial = leerHistorial(doc);
    expect(historial).toHaveLength(1);
    expect(historial[0]?.autorNombre).toBe('Ana');
  });

  it('un lote que solo mueve cajas no deja rastro', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, {
      autor: ana,
      origen: 'manual',
      operaciones: [{ op: 'moveClass', ref: { id: 'c1' }, position: { x: 1, y: 1 } }],
    });
    expect(leerHistorial(doc)).toHaveLength(0);
  });

  it('se poda por el extremo antiguo y se conserva lo reciente', () => {
    const doc = new Y.Doc();
    for (let i = 0; i < MAXIMO_ENTRADAS + 25; i += 1) {
      registrarCambio(doc, {
        autor: ana,
        origen: 'manual',
        operaciones: [{ op: 'addClass', name: `Clase${String(i)}`, kind: 'class' }],
      });
    }

    const historial = leerHistorial(doc);
    expect(historial).toHaveLength(MAXIMO_ENTRADAS);
    // Lo último que pasó es lo que alguien va a mirar: es lo que no se puede
    // perder al podar.
    expect(historial[historial.length - 1]?.resumen).toContain(`Clase${String(MAXIMO_ENTRADAS + 24)}`);
  });

  it('el orden del CRDT manda sobre la hora, y un reloj torcido se marca', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, {
      autor: ana,
      origen: 'manual',
      operaciones: [crearPedido],
      ahora: new Date('2026-03-10T10:00:00Z'),
    });
    // Beto tiene el portátil con la hora atrasada, o estuvo tres días sin
    // conexión. Su entrada llega después pero dice ser anterior.
    registrarCambio(doc, {
      autor: beto,
      origen: 'manual',
      operaciones: [{ op: 'addClass', name: 'Cliente', kind: 'class' }],
      ahora: new Date('2026-03-01T08:00:00Z'),
    });

    const historial = leerHistorial(doc);
    expect(historial[0]?.relojDudoso).toBe(false);
    expect(historial[1]?.relojDudoso).toBe(true);
    // No se reordena por fecha: eso sería creerse el reloj que acaba de fallar.
    expect(historial[1]?.autorNombre).toBe('Beto');
  });
});

describe('convivencia con el resto del documento', () => {
  it('dos personas que registran a la vez conservan ambas entradas', () => {
    const deAna = new Y.Doc();
    const deBeto = new Y.Doc();

    registrarCambio(deAna, { autor: ana, origen: 'manual', operaciones: [crearPedido] });
    registrarCambio(deBeto, {
      autor: beto,
      origen: 'manual',
      operaciones: [{ op: 'addClass', name: 'Cliente', kind: 'class' }],
    });

    // Se sincronizan como lo harían al reconectar tras editar sin conexión.
    Y.applyUpdate(deAna, Y.encodeStateAsUpdate(deBeto));
    Y.applyUpdate(deBeto, Y.encodeStateAsUpdate(deAna));

    const nombres = leerHistorial(deAna).map((e) => e.autorNombre);
    expect(nombres).toHaveLength(2);
    expect(nombres).toContain('Ana');
    expect(nombres).toContain('Beto');
    // Las dos réplicas convergen al mismo orden; si no, cada uno leería una
    // historia distinta de los mismos hechos.
    expect(leerHistorial(deBeto).map((e) => e.id)).toEqual(leerHistorial(deAna).map((e) => e.id));
  });

  it('deshacer no borra el historial: el UndoManager no lo vigila', () => {
    const doc = new Y.Doc();
    const ORIGEN = Symbol('local');
    const undo = new Y.UndoManager([getClassesMap(doc), getRelationsMap(doc)], {
      trackedOrigins: new Set([ORIGEN]),
    });

    doc.transact(() => getClassesMap(doc).set('c1', new Y.Map()), ORIGEN);
    registrarCambio(doc, { autor: ana, origen: 'manual', operaciones: [crearPedido] });

    undo.undo();

    // La clase se ha ido; la entrada que cuenta que existió, no. Si el historial
    // estuviera en la pila de deshacer se borraría a sí mismo justo en los casos
    // que más interesa poder rastrear.
    expect(getClassesMap(doc).size).toBe(0);
    expect(leerHistorial(doc)).toHaveLength(1);
    undo.destroy();
  });

  it('una entrada corrupta se ignora en vez de tumbar la lectura', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, { autor: ana, origen: 'manual', operaciones: [crearPedido] });
    // Un cliente que escribe distinto —otra versión, o alguien trasteando— no
    // puede dejar el panel en blanco para todos los demás.
    getHistorialArray(doc).push([{ basura: true }]);

    expect(leerHistorial(doc)).toHaveLength(1);
  });
});

describe('la pregunta que motivó todo: quién creó esta clase', () => {
  const conClase = (id: string, autor: Autor, creada: boolean) => ({
    autor,
    origen: 'manual' as const,
    operaciones: [crearPedido],
    clases: [id],
    ...(creada ? { creadas: [id] } : {}),
  });

  it('distingue quien la creó de quien la tocó después', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, conClase('c1', ana, true));
    registrarCambio(doc, conClase('c1', beto, false));

    const { creacion, ultima } = autoriaDeClase(leerHistorial(doc), 'c1');
    expect(creacion?.autorNombre).toBe('Ana');
    expect(ultima?.autorNombre).toBe('Beto');
  });

  it('no inventa un creador cuando solo constan modificaciones', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, conClase('c1', beto, false));

    const { creacion, ultima } = autoriaDeClase(leerHistorial(doc), 'c1');
    // Decir «creada por Beto» porque es el primero que aparece en un historial
    // recortado sería atribuirle algo que no hizo.
    expect(creacion).toBeNull();
    expect(ultima?.autorNombre).toBe('Beto');
  });

  it('el historial de una clase no arrastra el de las demás', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, conClase('c1', ana, true));
    registrarCambio(doc, conClase('c2', beto, true));

    const propias = historialDeClase(leerHistorial(doc), 'c1');
    expect(propias).toHaveLength(1);
    expect(propias[0]?.autorNombre).toBe('Ana');
  });

  it('la clase se lista de lo más reciente a lo más antiguo', () => {
    const doc = new Y.Doc();
    registrarCambio(doc, conClase('c1', ana, true));
    registrarCambio(doc, conClase('c1', beto, false));

    expect(historialDeClase(leerHistorial(doc), 'c1')[0]?.autorNombre).toBe('Beto');
  });
});
