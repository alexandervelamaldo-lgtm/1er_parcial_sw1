import { describe, expect, it } from 'vitest';
import {
  IDIOMA_DE_RESPALDO,
  errorQueTermina,
  idiomaDeDictado,
  mejorAlternativa,
  mensajeDeError,
  puntuarPorVocabulario,
  unirDictado,
} from './dictado';

/**
 * Las decisiones del dictado, comprobadas sin micrófono.
 *
 * Lo que se vigila aquí es lo que el usuario describió como «no se me entiende»,
 * que resultó ser tres cosas separadas: el idioma del modelo, las hipótesis que
 * se tiraban y las pausas que cortaban la frase.
 */

describe('idiomaDeDictado', () => {
  it('escucha en la variante que declara el aparato', () => {
    expect(idiomaDeDictado(['es-BO', 'es', 'en-US'])).toBe('es-BO');
  });

  it('normaliza la región y acepta el guion bajo del sistema', () => {
    expect(idiomaDeDictado(['es_mx'])).toBe('es-MX');
  });

  /*
    El caso que motivó todo esto. `es-ES` estaba escrito a mano en el código y
    ninguna de estas etiquetas lo pedía: quien habla castellano de América
    recibía el modelo de España, que le devuelve otra palabra por cada palabra
    que dice.
  */
  it('nunca cae en el castellano de España por descarte', () => {
    expect(idiomaDeDictado(['es'])).toBe(IDIOMA_DE_RESPALDO);
    expect(idiomaDeDictado(['es-419'])).toBe(IDIOMA_DE_RESPALDO);
    expect(idiomaDeDictado([])).toBe(IDIOMA_DE_RESPALDO);
    expect(IDIOMA_DE_RESPALDO).not.toBe('es-ES');
  });

  it('respeta es-ES si es lo que pide el aparato', () => {
    expect(idiomaDeDictado(['es-ES'])).toBe('es-ES');
  });

  it('salta los idiomas que no son castellano', () => {
    expect(idiomaDeDictado(['en-US', 'pt-BR', 'es-CL'])).toBe('es-CL');
  });
});

describe('mejorAlternativa', () => {
  /*
    «Clase» y «plaza» suenan casi igual y el motor devuelve las dos. La primera
    hipótesis no siempre es la que trae la palabra que esta herramienta entiende,
    y antes era la única que se leía.
  */
  it('prefiere la hipótesis que trae vocabulario de la herramienta', () => {
    const oidas = ['crea la plaza pedido', 'crea la clase pedido'];
    expect(mejorAlternativa(oidas)).toBe('crea la clase pedido');
  });

  it('en empate se queda la del motor: sin motivo no se reordena', () => {
    expect(mejorAlternativa(['lo que sea', 'otra cosa'])).toBe('lo que sea');
  });

  it('descarta las hipótesis vacías', () => {
    expect(mejorAlternativa(['', '  ', 'crea la clase'])).toBe('crea la clase');
    expect(mejorAlternativa([])).toBe('');
  });

  it('acepta otra forma de puntuar: la gramática del asistente', () => {
    const puntuar = (texto: string): number => (texto.includes('Pedido') ? 10 : 0);
    expect(mejorAlternativa(['crea la clase pedido', 'crea la clase Pedido'], puntuar)).toBe(
      'crea la clase Pedido',
    );
  });

  it('no cuenta dos veces la misma palabra atascada', () => {
    expect(puntuarPorVocabulario('clase clase clase')).toBe(1);
    expect(puntuarPorVocabulario('la clase Pedido con el atributo total de tipo entero')).toBe(4);
  });

  it('puntúa igual con tildes y sin ellas: se dicta, no se teclea', () => {
    expect(puntuarPorVocabulario('añade el método')).toBe(puntuarPorVocabulario('anade el metodo'));
  });
});

describe('unirDictado', () => {
  it('pega los trozos que suelta el motor en una sola frase', () => {
    expect(unirDictado(['crea la clase', '  Pedido ', '', 'con el atributo total'])).toBe(
      'crea la clase Pedido con el atributo total',
    );
  });

  it('sin nada dicho no devuelve espacios', () => {
    expect(unirDictado(['', '   '])).toBe('');
  });
});

describe('errorQueTermina', () => {
  /*
    El corazón de «más tiempo». `no-speech` llegaba en cada pausa y apagaba el
    micrófono con un «No se ha oído nada» que el usuario leía como una avería,
    cuando solo estaba pensando la frase.
  */
  it('una pausa no es una avería', () => {
    expect(errorQueTermina('no-speech')).toBe(false);
  });

  it('el botón de parar tampoco', () => {
    expect(errorQueTermina('aborted')).toBe(false);
  });

  it('lo que no se arregla esperando sí termina', () => {
    expect(errorQueTermina('not-allowed')).toBe(true);
    expect(errorQueTermina('network')).toBe(true);
    expect(errorQueTermina('audio-capture')).toBe(true);
  });

  it('dice qué hacer, y para lo desconocido deja el código a la vista', () => {
    expect(mensajeDeError('not-allowed')).toContain('permiso');
    expect(mensajeDeError('network')).toContain('conexión');
    expect(mensajeDeError('lo-que-sea')).toContain('lo-que-sea');
  });
});
