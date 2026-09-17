import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
/*
  Las funciones se piden a `@xyflow/system`, que es donde vive el fallo y donde
  trabajan sobre objetos planos. Los tipos se piden a `@xyflow/react`, que es
  el paquete del que tira el componente: `system` exporta `InternalNodeBase` y
  `NodeBase`, genéricos, y usar los de `react` deja la prueba hablando de los
  mismos nodos que el lienzo.
*/
import { adoptUserNodes, getEdgePosition, type NodeHandleBounds } from '@xyflow/system';
import {
  ConnectionMode,
  Position,
  type Handle,
  type InternalNode,
  type Node,
} from '@xyflow/react';

/**
 * Que las relaciones sigan dibujadas después de mover una caja.
 *
 * El fallo que esta prueba recuerda se veía así: en un proyecto cualquiera se
 * arrastraba una tabla y **todas** las relaciones desaparecían de golpe, no
 * solo las de esa tabla. La barra de estado seguía diciendo «21 clases · 24
 * relaciones» y el `<div class="react-flow__edges">` estaba literalmente
 * vacío. No volvían nunca: ni al soltar, ni al mover otra caja, ni al hacer
 * zoom. Solo al recargar.
 *
 * La cadena, en `@xyflow/system` 12.11.6:
 *
 * 1. Arrastrar dispara `onMover`, que escribe la posición en Yjs en cada
 *    fotograma. El diagrama cambia, así que el `useMemo` de los nodos
 *    reconstruye cada objeto con identidad nueva.
 * 2. React Flow ve nodos nuevos y llama a `adoptUserNodes`, que rehace los
 *    internos: `handleBounds: parseHandles(userNode, internalNode)`.
 * 3. `parseHandles` empieza por `if (!userNode.handles) { return
 *    !userNode.measured ? undefined : internalNode?.internals.handleBounds; }`.
 *    Sin `measured` en el objeto del usuario devuelve `undefined`, y tira las
 *    posiciones de los conectores que ya estaban medidas.
 * 4. Sin `handleBounds`, `isNodeInitialized` es falso; `getEdgePosition`
 *    devuelve `null`; `EdgeWrapper` no pinta nada.
 * 5. No se recupera porque el `ResizeObserver` que volvería a medir solo salta
 *    cuando cambia el **tamaño** del elemento, y arrastrar no cambia ninguno.
 *
 * No era cuestión de tener muchas tablas, aunque así lo pareciera: con dos
 * cajas pasa igual. Lo que crece con el diagrama es la probabilidad de mover
 * algo.
 *
 * ## Por qué esta prueba no mira el fuente
 *
 * `lienzo-conectable.test.ts`, que vigila el fallo hermano, se conforma con
 * leer el texto del componente porque lo que comprueba es un acuerdo entre dos
 * decisiones y no había forma de ejecutar nada. Aquí sí la hay, y sale más
 * barata de lo que parecía: las tres funciones donde vive el fallo
 * —`adoptUserNodes`, `isNodeInitialized`, `getEdgePosition`— son funciones de
 * `@xyflow/system` que trabajan sobre objetos planos, sin DOM y sin React.
 * Se las puede llamar en Node y ver el `null` de verdad.
 *
 * Así que esto no comprueba que escribimos `measured:` en un fichero;
 * comprueba, contra la librería instalada, que **la arista tiene posición
 * después de mover el nodo**. Si mañana React Flow cambia la regla, esta
 * prueba se entera. Una que buscara la palabra en el fuente, no.
 *
 * Lo único que se queda fuera es el paso de React —que `useMemo` reconstruya
 * el array—, y ese es justo el que se ve a simple vista en cuanto se arrastra
 * una caja.
 */

/** El tamaño que `medidasDe` calcularía para una caja del diagrama. */
const MEDIDA = { width: 220, height: 140 };

/**
 * Los conectores tal y como los deja la medición del DOM.
 *
 * Las cuatro asas de la caja son `type="source"` —eso es lo que obliga a
 * `ConnectionMode.Loose`, y lo vigila `lienzo-conectable.test.ts`—, así que
 * `target` queda vacío a propósito.
 */
function conectores(nodeId: string): NodeHandleBounds {
  const asa = (id: string, position: Position, x: number, y: number): Handle => ({
    id,
    nodeId,
    type: 'source',
    position,
    x,
    y,
    width: 1,
    height: 1,
  });
  return {
    source: [
      asa('arriba', Position.Top, 110, 0),
      asa('derecha', Position.Right, 220, 70),
      asa('abajo', Position.Bottom, 110, 140),
      asa('izquierda', Position.Left, 0, 70),
    ],
    target: [],
  };
}

/**
 * Un nodo como el que construye el `useMemo` del lienzo.
 *
 * `conMedidas` es el interruptor del fallo: con `false` sale el objeto que se
 * pasaba antes del arreglo.
 */
function nodo(id: string, x: number, conMedidas: boolean): Node {
  return {
    id,
    type: 'claseUml',
    position: { x, y: 0 },
    data: {},
    width: MEDIDA.width,
    height: MEDIDA.height,
    ...(conMedidas ? { measured: { ...MEDIDA } } : {}),
  } as Node;
}

/**
 * Monta los internos como si el lienzo ya se hubiera dibujado y medido una vez.
 *
 * Se llama a `adoptUserNodes` de verdad y después se siembran los
 * `handleBounds` a mano, que es lo que hace el `ResizeObserver` del
 * `NodeWrapper` al montar: en la primera pasada no hay nada que medir todavía.
 */
function lienzoYaMedido(conMedidas: boolean): Map<string, InternalNode> {
  const nodeLookup = new Map<string, InternalNode>();
  const parentLookup = new Map();
  adoptUserNodes([nodo('a', 0, conMedidas), nodo('b', 400, conMedidas)], nodeLookup, parentLookup);
  for (const [id, interno] of nodeLookup) {
    interno.internals.handleBounds = conectores(id);
    interno.measured = { ...MEDIDA };
  }
  return nodeLookup;
}

/** Mueve la caja «a», que es lo que hace `onMover` en cada fotograma. */
function arrastrar(
  nodeLookup: Map<string, InternalNode>,
  conMedidas: boolean,
): Map<string, InternalNode> {
  const parentLookup = new Map();
  // Objetos nuevos, no mutados: es exactamente lo que devuelve el `useMemo`
  // cuando el documento Yjs cambia.
  adoptUserNodes([nodo('a', 60, conMedidas), nodo('b', 400, conMedidas)], nodeLookup, parentLookup);
  return nodeLookup;
}

function posicionDeLaArista(nodeLookup: Map<string, InternalNode>) {
  return getEdgePosition({
    id: 'relacion-1',
    sourceNode: nodeLookup.get('a')!,
    targetNode: nodeLookup.get('b')!,
    sourceHandle: null,
    targetHandle: null,
    // El lienzo va en modo laxo porque no hay asas `target`.
    connectionMode: ConnectionMode.Loose,
    onError: () => {},
  });
}

describe('la relación sigue teniendo posición después de arrastrar la caja', () => {
  it('el montaje de partida dibuja la arista', () => {
    // Sin esto, un `null` más abajo podría venir de que la prueba está mal
    // montada y no de que el arreglo falte.
    expect(posicionDeLaArista(lienzoYaMedido(true))).not.toBeNull();
  });

  it('sin `measured`, arrastrar borra los conectores y la arista desaparece', () => {
    /*
      Esta es la prueba de que el diagnóstico era el correcto, y de que la
      librería instalada sigue comportándose así. Si algún día React Flow
      dejara de tirar los `handleBounds`, este caso empezaría a fallar y
      querría decir que el arreglo de abajo ya no hace falta.
    */
    const nodeLookup = arrastrar(lienzoYaMedido(false), false);

    expect(
      nodeLookup.get('a')?.internals.handleBounds,
      'React Flow ya no borra los conectores al reconstruir un nodo sin `measured`',
    ).toBeUndefined();
    expect(posicionDeLaArista(nodeLookup)).toBeNull();
  });

  it('con `measured`, los conectores sobreviven y la arista se sigue dibujando', () => {
    const nodeLookup = arrastrar(lienzoYaMedido(true), true);

    expect(
      nodeLookup.get('a')?.internals.handleBounds,
      'los conectores medidos deberían haber sobrevivido a la reconstrucción',
    ).toEqual(conectores('a'));

    const posicion = posicionDeLaArista(nodeLookup);
    expect(
      posicion,
      'la arista no tiene posición después de mover la caja: en el lienzo esto ' +
        'es `react-flow__edges` vacío, o sea TODAS las relaciones invisibles ' +
        'hasta recargar la página',
    ).not.toBeNull();

    /*
      Y la línea acompaña a la caja en vez de quedarse clavada donde estaba.
      Se comprueba el desplazamiento y no una coordenada concreta: cuál de las
      cuatro asas elige React Flow cuando la relación no nombra ninguna es
      cosa suya, y no es lo que esta prueba defiende.
    */
    const antes = posicionDeLaArista(lienzoYaMedido(true));
    expect(posicion!.sourceX - antes!.sourceX).toBe(60);
    expect(posicion!.targetX).toBe(antes!.targetX);
  });
});

/**
 * La otra mitad: que el componente siga dando las medidas.
 *
 * Lo de arriba demuestra la regla de React Flow. Esto comprueba que el lienzo
 * la cumple, y es lo único que hay que mirar en el fuente porque el `useMemo`
 * no se puede ejecutar sin `jsdom` (#15).
 *
 * Se admiten las dos formas legítimas de cumplirla —dar el tamaño hecho desde
 * el modelo, que es lo que se hace hoy, o atender los cambios `dimensions` en
 * `alCambiarNodos`— para no clavar la implementación de hoy. Lo que no puede
 * volver a pasar es que no se haga ninguna de las dos.
 */
describe('el lienzo le da medidas a sus nodos', () => {
  const CODIGO = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'LienzoFlow.tsx'),
    'utf8',
  )
    // El comentario que explica el arreglo cita `measured` media docena de
    // veces: sin quitarlo, la prueba encontraría en la prosa lo que busca en
    // el código y pasaría siempre.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('el fuente despojado conserva el código y pierde la prosa', () => {
    expect(CODIGO).toContain('<ReactFlow');
    expect(CODIGO).not.toContain('parseHandles');
  });

  it('los nodos llevan medidas, por el modelo o por el observador de tamaño', () => {
    const desdeElModelo = /measured:\s*\{/.test(CODIGO);
    const desdeElObservador = /cambio\.type\s*===\s*(["'])dimensions\1/.test(CODIGO);

    expect(
      desdeElModelo || desdeElObservador,
      'los nodos que se le pasan a React Flow no llevan `measured`, así que el ' +
        'primer arrastre dejará el diagrama sin ninguna relación a la vista. Hay ' +
        'que poner `measured: { width, height }` en el nodo, o atender los cambios ' +
        'de tipo `dimensions` en `alCambiarNodos`.',
    ).toBe(true);
  });
});
