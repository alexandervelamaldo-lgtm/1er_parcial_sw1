import { describe, expect, it } from 'vitest';
import {
  ALTURA_ASIDERO,
  MARGEN_SOBRE_TECLADO,
  REDUCCION_MINIMA_TECLADO,
  VELOCIDAD_DE_IMPULSO,
  alturaArrastrada,
  alturaDe,
  alturaMaximaConTeclado,
  campoVisible,
  desplazamientoPorTeclado,
  destinoAlSoltar,
  posicionMasCercana,
  tecladoAbierto,
  type CampoEnfocado,
  type Ventana,
} from './movil-hoja';

/**
 * Pruebas de la hoja inferior, sin navegador.
 *
 * La mitad interesante es la del teclado. Es un fallo que no se puede reproducir
 * en un navegador de escritorio —no hay teclado virtual que levantar— y que en
 * un teléfono se ve a la primera, así que o se prueba con aritmética o no se
 * prueba nunca. Por eso las funciones toman las dos alturas como números en vez
 * de leer `visualViewport` por su cuenta.
 */

/** Un teléfono corriente en vertical, sin teclado. */
const SUELTA: Ventana = { alto: 800, altoVisible: 800 };

/** El mismo teléfono con el teclado levantado: 320 px menos de sitio. */
const CON_TECLADO: Ventana = { alto: 800, altoVisible: 480 };

describe('detectar el teclado', () => {
  it('sin nada levantado no hay teclado', () => {
    expect(tecladoAbierto(SUELTA)).toBe(false);
  });

  it('la barra de direcciones que se repliega no es un teclado', () => {
    // Chrome de Android esconde la barra al desplazar: unos 56 px. Si esto
    // contara como teclado, la hoja pegaría un salto cada vez que alguien
    // desplaza la lista de atributos.
    expect(tecladoAbierto({ alto: 800, altoVisible: 744 })).toBe(false);
  });

  it('el umbral está donde dice la constante, y es inclusivo', () => {
    const justo = { alto: 800, altoVisible: 800 - REDUCCION_MINIMA_TECLADO };
    expect(tecladoAbierto(justo)).toBe(true);
    expect(tecladoAbierto({ alto: 800, altoVisible: justo.altoVisible + 1 })).toBe(false);
  });

  it('un teclado de verdad se detecta', () => {
    expect(tecladoAbierto(CON_TECLADO)).toBe(true);
  });
});

describe('cuánto puede ocupar la hoja', () => {
  it('sin teclado, la ventana entera', () => {
    expect(alturaMaximaConTeclado(SUELTA)).toBe(800);
  });

  it('con teclado, solo lo que se ve', () => {
    // Esta es la línea que impide que la hoja se extienda por debajo de las
    // teclas. Medirla contra `alto` en vez de contra `altoVisible` es
    // exactamente el fallo clásico.
    expect(alturaMaximaConTeclado(CON_TECLADO)).toBe(480);
  });

  it('no se resta una altura de teclado inventada, se usa la medida real', () => {
    // Dos teclados distintos —uno con barra de sugerencias, otro sin ella— dan
    // dos alturas disponibles distintas, y las dos salen de lo que informa el
    // navegador.
    expect(alturaMaximaConTeclado({ alto: 800, altoVisible: 520 })).toBe(520);
    expect(alturaMaximaConTeclado({ alto: 800, altoVisible: 430 })).toBe(430);
  });
});

describe('las tres posiciones de reposo', () => {
  it('oculta deja el asidero a la vista y nada más', () => {
    expect(alturaDe('oculta', SUELTA)).toBe(ALTURA_ASIDERO);
  });

  it('el asidero es un objetivo que se puede tocar', () => {
    // Si fuera una raya de 4 px no habría forma de volver a abrir la ficha
    // arrastrando, y el único camino sería el botón de la barra.
    expect(ALTURA_ASIDERO).toBeGreaterThanOrEqual(24);
  });

  it('completa deja ver una rendija de lienzo', () => {
    const completa = alturaDe('completa', SUELTA);
    expect(completa).toBeLessThan(SUELTA.alto);
    expect(SUELTA.alto - completa).toBeGreaterThanOrEqual(40);
  });

  it('media deja más sitio al diagrama que a la hoja', () => {
    // Con la mitad justa no se lee cuál de los dos manda.
    expect(alturaDe('media', SUELTA)).toBeLessThan(SUELTA.alto / 2);
  });

  it('van de menor a mayor', () => {
    expect(alturaDe('oculta', SUELTA)).toBeLessThan(alturaDe('media', SUELTA));
    expect(alturaDe('media', SUELTA)).toBeLessThan(alturaDe('completa', SUELTA));
  });

  it('con el teclado abierto todas encogen', () => {
    expect(alturaDe('media', CON_TECLADO)).toBeLessThan(alturaDe('media', SUELTA));
    expect(alturaDe('completa', CON_TECLADO)).toBeLessThan(alturaDe('completa', SUELTA));
  });

  it('ninguna posición se mete por debajo del teclado', () => {
    for (const p of ['oculta', 'media', 'completa'] as const) {
      expect(alturaDe(p, CON_TECLADO)).toBeLessThanOrEqual(CON_TECLADO.altoVisible);
    }
  });
});

describe('arrastrar la hoja', () => {
  it('subir el dedo sube la hoja', () => {
    const arrastre = { alturaInicial: 300, yInicial: 500 };
    expect(alturaArrastrada(arrastre, 400, SUELTA)).toBe(400);
  });

  it('bajar el dedo baja la hoja', () => {
    const arrastre = { alturaInicial: 300, yInicial: 500 };
    expect(alturaArrastrada(arrastre, 600, SUELTA)).toBe(200);
  });

  it('no se pasa del techo ni baja de cero', () => {
    const arrastre = { alturaInicial: 300, yInicial: 500 };
    expect(alturaArrastrada(arrastre, -5000, SUELTA)).toBe(alturaDe('completa', SUELTA));
    expect(alturaArrastrada(arrastre, 5000, SUELTA)).toBe(0);
  });

  it('llegar al tope y volver no deja la hoja descolgada del dedo', () => {
    /*
      La prueba que justifica guardar el punto de agarre en vez de ir acumulando
      incrementos. Con incrementos, los píxeles recortados contra el tope no se
      devuelven al bajar y la hoja se queda desplazada respecto al dedo para el
      resto del arrastre.
    */
    const arrastre = { alturaInicial: 300, yInicial: 500 };
    const ida = alturaArrastrada(arrastre, -2000, SUELTA);
    expect(ida).toBe(alturaDe('completa', SUELTA));
    const vuelta = alturaArrastrada(arrastre, 500, SUELTA);
    expect(vuelta).toBe(300);
  });
});

describe('dónde se queda al soltar', () => {
  it('soltando despacio se va a la más cercana', () => {
    const media = alturaDe('media', SUELTA);
    expect(destinoAlSoltar(media + 10, 0, SUELTA)).toBe('media');
    expect(destinoAlSoltar(10, 0, SUELTA)).toBe('oculta');
    expect(destinoAlSoltar(alturaDe('completa', SUELTA) - 5, 0, SUELTA)).toBe('completa');
  });

  it('un manotazo hacia abajo cierra aunque se suelte arriba', () => {
    /*
      El caso que motiva la rama del impulso. El dedo apenas ha movido la hoja
      —sigue cerca de «completa»— pero el gesto dice «quítamela de encima». Sin
      impulso, «la más cercana» la devolvería a donde estaba y el manotazo no
      haría nada.
    */
    const arriba = alturaDe('completa', SUELTA) - 5;
    expect(destinoAlSoltar(arriba, VELOCIDAD_DE_IMPULSO + 50, SUELTA)).toBe('media');
  });

  it('un manotazo hacia abajo desde media la oculta', () => {
    const media = alturaDe('media', SUELTA);
    expect(destinoAlSoltar(media, 900, SUELTA)).toBe('oculta');
  });

  it('un manotazo hacia arriba la abre del todo', () => {
    const media = alturaDe('media', SUELTA);
    expect(destinoAlSoltar(media, -900, SUELTA)).toBe('completa');
  });

  it('el impulso no se sale por ninguno de los dos extremos', () => {
    // Insistir hacia abajo con la hoja ya oculta, o hacia arriba con la hoja ya
    // completa, no puede devolver una posición que no existe.
    expect(destinoAlSoltar(ALTURA_ASIDERO, 2000, SUELTA)).toBe('oculta');
    expect(destinoAlSoltar(alturaDe('completa', SUELTA), -2000, SUELTA)).toBe('completa');
  });

  it('justo por debajo del umbral todavía manda la posición', () => {
    const arriba = alturaDe('completa', SUELTA) - 5;
    expect(destinoAlSoltar(arriba, VELOCIDAD_DE_IMPULSO - 1, SUELTA)).toBe('completa');
  });
});

describe('al cambiar el tamaño de la ventana', () => {
  it('la hoja se queda en la posición, no en los píxeles', () => {
    /*
      Al girar el teléfono, 360 px dejan de significar «a media altura». Si el
      `.tsx` conservara la altura en píxeles, una hoja a media altura en
      vertical aparecería casi completa en horizontal.
    */
    const vertical: Ventana = { alto: 800, altoVisible: 800 };
    const horizontal: Ventana = { alto: 400, altoVisible: 400 };

    const enVertical = alturaDe('media', vertical);
    expect(posicionMasCercana(enVertical, vertical)).toBe('media');
    expect(posicionMasCercana(enVertical, horizontal)).toBe('completa');
  });

  it('la posición sobrevive al ir y volver', () => {
    for (const p of ['oculta', 'media', 'completa'] as const) {
      expect(posicionMasCercana(alturaDe(p, SUELTA), SUELTA)).toBe(p);
      expect(posicionMasCercana(alturaDe(p, CON_TECLADO), CON_TECLADO)).toBe(p);
    }
  });
});

describe('el teclado no tapa el campo en el que se escribe', () => {
  /** Un campo de texto de altura corriente, con su etiqueta. */
  const campoEn = (arriba: number): CampoEnfocado => ({ arriba, alto: 44 });

  it('sin teclado no se mueve nada', () => {
    expect(desplazamientoPorTeclado(campoEn(700), SUELTA)).toBe(0);
  });

  it('un campo que ya se ve no se mueve', () => {
    expect(desplazamientoPorTeclado(campoEn(100), CON_TECLADO)).toBe(0);
  });

  it('un campo tapado por el teclado se sube hasta verse', () => {
    const campo = campoEn(460);
    const d = desplazamientoPorTeclado(campo, CON_TECLADO);
    expect(d).toBeGreaterThan(0);
    expect(campoVisible(campo, CON_TECLADO, d)).toBe(true);
  });

  it('se sube lo justo, dejando el margen y ni un píxel más', () => {
    const campo = campoEn(460);
    const d = desplazamientoPorTeclado(campo, CON_TECLADO);
    const abajo = campo.arriba + campo.alto - d;
    expect(abajo).toBe(CON_TECLADO.altoVisible - MARGEN_SOBRE_TECLADO);
  });

  it('nunca devuelve un desplazamiento negativo', () => {
    // Bajar contenido sería apartar de la vista algo que se está mirando para
    // acercar algo que ya se veía.
    for (let arriba = 0; arriba <= 800; arriba += 20) {
      expect(desplazamientoPorTeclado(campoEn(arriba), CON_TECLADO)).toBeGreaterThanOrEqual(0);
    }
  });

  it('cualquier campo que quepa acaba visible', () => {
    /*
      La propiedad que de verdad importa, afirmada sobre todo el recorrido en
      vez de sobre un píxel concreto: da igual dónde estuviera el campo, después
      de aplicar el desplazamiento se ve entero.
    */
    for (let arriba = 0; arriba <= CON_TECLADO.altoVisible + 200; arriba += 17) {
      const campo = campoEn(arriba);
      const d = desplazamientoPorTeclado(campo, CON_TECLADO);
      if (campo.alto > CON_TECLADO.altoVisible) continue;
      expect(campoVisible(campo, CON_TECLADO, d)).toBe(true);
    }
  });

  it('con un campo más alto que el hueco se salva la parte de arriba', () => {
    /*
      Un área de texto larga —la lista de métodos— puede no caber sobre el
      teclado. Entonces hay que elegir qué mitad se sacrifica, y se sacrifica la
      de abajo: lo que importa es la etiqueta y la primera línea.
    */
    const enorme: CampoEnfocado = { arriba: 300, alto: 600 };
    const d = desplazamientoPorTeclado(enorme, CON_TECLADO);
    expect(enorme.arriba - d).toBe(0);
    expect(campoVisible(enorme, CON_TECLADO, d)).toBe(false);
  });

  it('el margen se puede ajustar sin tocar la función', () => {
    const campo = campoEn(460);
    const conMas = desplazamientoPorTeclado(campo, CON_TECLADO, 40);
    const conMenos = desplazamientoPorTeclado(campo, CON_TECLADO, 0);
    expect(conMas).toBeGreaterThan(conMenos);
  });
});
