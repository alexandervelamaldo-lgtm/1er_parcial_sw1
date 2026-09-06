import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Que se pueda trazar una relación tirando de un conector.
 *
 * Esto es una prueba sobre el **texto** del componente, no sobre el componente
 * ejecutándose, y conviene decir por qué antes de que alguien la lea y piense
 * que es pereza. Sin `jsdom` instalado no hay forma de montar `LienzoFlow` en
 * una prueba (#15), y aunque la hubiera, React Flow no traza conexiones en un
 * DOM sintético: necesita medir el contenedor y las asas con
 * `getBoundingClientRect`, que en `jsdom` devuelve ceros. Un arrastre simulado
 * daría verde con el fallo dentro. Lo honesto es comprobar lo único que se
 * puede comprobar de verdad —que las dos mitades de la decisión siguen de
 * acuerdo— y decir que el resto se mira en pantalla.
 *
 * El fallo que esta prueba recuerda: las cuatro asas de la caja son
 * `type="source"`, y el modo por defecto de React Flow es `Strict`, que solo da
 * por buena una conexión que termine en un `target`. Como no había ninguno, no
 * se podía crear ni una sola relación. No saltaba ningún error: la línea seguía
 * al ratón y al soltar no pasaba nada. Un fallo mudo en la función principal de
 * un editor de diagramas de clases.
 *
 * Se comprueba la relación entre las dos cosas, no cada una por su lado.
 * Fijarlas por separado —«hay cuatro asas source», «el modo es Loose»— sería
 * clavar la implementación de hoy y estorbar el día que alguien añada asas
 * `target`, que es una solución perfectamente válida. Lo que no puede volver a
 * pasar es que el lienzo se quede sin ninguna de las dos.
 */

const COMPONENTE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'LienzoFlow.tsx'),
  'utf8',
);

/**
 * El fuente sin comentarios ni cadenas de texto.
 *
 * Es imprescindible aquí, no una precaución de rutina: el comentario que
 * explica este mismo arreglo cita `type="target"` y `ConnectionMode.Loose`
 * literalmente. Leyendo el fichero entero, la prueba encontraría en la prosa lo
 * que busca en el código y pasaría siempre, incluso con el arreglo deshecho.
 * Una prueba que no puede fallar no es una prueba.
 */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('las asas de la caja y el modo de conexión están de acuerdo', () => {
  const CODIGO = soloCodigo(COMPONENTE);

  it('el fuente despojado conserva el código y pierde la prosa', () => {
    // Sin esto, todo lo que sigue podría estar midiendo una cadena vacía.
    expect(CODIGO).toContain('<ReactFlow');
    expect(CODIGO).toContain('<Handle');
    expect(CODIGO, 'los comentarios que citan la API deberían haberse ido').not.toContain(
      'no se puede relacionar ni una sola clase',
    );
  });

  it('si no hay asas de destino, el modo de conexión es Loose', () => {
    const hayDestino = /type=(["'])target\1/.test(CODIGO);
    const esLaxo = /connectionMode=\{\s*ConnectionMode\.Loose\s*\}/.test(CODIGO);

    expect(
      hayDestino || esLaxo,
      'todas las asas son «source» y el modo es «strict» (el de por defecto): ' +
        'React Flow descartará toda conexión al soltarla y no se podrá crear ninguna ' +
        'relación. Hay que añadir asas type="target" o poner ' +
        'connectionMode={ConnectionMode.Loose}.',
    ).toBe(true);
  });

  it('las asas se pueden usar salvo en solo lectura', () => {
    /*
      La otra puerta por la que se cierra lo mismo. `isConnectable` en el
      `<Handle>` gobierna si el asa deja empezar un arrastre, y
      `nodesConnectable` en el `<ReactFlow>` lo gobierna para todo el lienzo: si
      cualquiera de las dos se quedara fija en `false`, el resultado visible
      sería otra vez «no me deja hacer asociaciones», con el modo de conexión
      correcto y sin nada que mirar en la consola.
    */
    expect(CODIGO, 'el asa no debería estar deshabilitada salvo por solo lectura').toMatch(
      /isConnectable=\{!soloLectura\}/,
    );
    expect(CODIGO, 'el lienzo no debería estar deshabilitado salvo por solo lectura').toMatch(
      /nodesConnectable=\{!soloLectura\}/,
    );
  });

  it('la conexión terminada se convierte en una relación del modelo', () => {
    /*
      Que React Flow acepte el gesto no sirve de nada si el resultado no sale
      del componente. `onConnect` es lo único que conecta el arrastre con
      `onRelacionar`, que es quien lo escribe en el documento colaborativo.
    */
    expect(CODIGO).toMatch(/onConnect=\{alConectar\}/);
    expect(CODIGO).toMatch(/onRelacionar\(\s*conexion\.source\s*,\s*conexion\.target\s*\)/);
  });
});
