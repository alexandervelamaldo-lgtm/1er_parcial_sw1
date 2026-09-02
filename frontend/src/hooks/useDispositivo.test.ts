import { describe, expect, it } from 'vitest';
import { nombreDeshacer } from './useDispositivo';

/**
 * De este módulo solo se prueba la parte pura.
 *
 * `useConsultaMedia` y `useTecladoFisico` necesitan `window.matchMedia` y un
 * árbol de React montado, o sea jsdom, que todavía no está instalado (tarea
 * #15). Fingirlo aquí a mano —un objeto con `matches` y `addEventListener`—
 * probaría que mi imitación se comporta como yo creo que se comporta un
 * navegador, que es justo lo que no se quiere saber.
 *
 * Lo que sí se puede fijar sin navegador es la decisión, y es la que se rompió:
 * cinco sitios distintos decían «Ctrl+Z» a alguien que estaba mirando un
 * teléfono.
 */
describe('nombreDeshacer', () => {
  it('con teclado nombra el atajo, que es más rápido que el botón', () => {
    expect(nombreDeshacer(true)).toBe('Ctrl+Z');
  });

  it('sin teclado no menciona ninguna tecla', () => {
    const frase = nombreDeshacer(false);

    // Lo importante no es qué dice, sino qué deja de decir: la queja original
    // fue leer «Ctrl+Z» en una pantalla sin teclas.
    expect(frase).not.toMatch(/ctrl/i);
    expect(frase).not.toMatch(/cmd|⌘/i);
  });

  it('sin teclado señala algo que está en la pantalla', () => {
    // El botón «↶» existe en la barra y no se pliega en móvil justamente para
    // que esta frase siga siendo cierta. Si alguien lo mete algún día en el
    // menú «⋯ Más», esta prueba no lo detecta —pero el comentario de
    // `EditorDiagrama` que lo explica está a un `grep` de aquí.
    expect(nombreDeshacer(false)).toContain('↶');
  });
});
