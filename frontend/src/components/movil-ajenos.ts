import type { EntradaLeida } from '@app/shared';

/**
 * Lo que han hecho los demás mientras tanto.
 *
 * Esta es la mitad de la colaboración que no se ve. La otra —quién está dentro,
 * de qué color, dónde tiene el cursor— ya la resuelven `usePresencia` e
 * `IndicadorSync`, y se reutilizan tal cual en el móvil. Lo que falta es más
 * difícil de notar y peor cuando falla: **un cambio ajeno que aparece de la
 * nada**.
 *
 * En el escritorio el daño está acotado. Hay una columna de historial a la
 * vista, el diagrama entero cabe en la pantalla y el panel de propiedades está
 * al lado de la caja que describe: si alguien toca algo, se ve el movimiento por
 * el rabillo del ojo. En un teléfono no hay rabillo del ojo. Se ve una porción
 * del diagrama al 100 % de zoom y una hoja que tapa la mitad inferior, y detrás
 * de esa hoja puede desaparecer una clase entera sin que nada parpadee.
 *
 * El caso que hay que evitar es concreto y tiene nombre: alguien está editando
 * los atributos de `Pedido` en la hoja, otra persona borra `Pedido`, y la hoja
 * sigue abierta aceptando texto. Cada pulsación se aplica a una clase que ya no
 * existe —el `aplicar` la rechaza, o peor, la resucita a medias— y no hay
 * ninguna señal de que el suelo se haya movido.
 *
 * ## Por qué el historial y no una comparación de diagramas
 *
 * La tentación es guardar el diagrama anterior y compararlo con el nuevo. Es
 * menos código y está mal, porque **una comparación no sabe quién**. El
 * resultado sería anunciarle a cada uno sus propios cambios: se escribe un
 * atributo, aparece un aviso de que hay un atributo nuevo. Dos días de eso y
 * nadie vuelve a leer un aviso de esta aplicación, que es una avería peor que la
 * que se pretendía arreglar, porque se lleva por delante también los avisos que
 * sí importaban.
 *
 * El historial sí sabe quién: cada entrada trae `autorId`. Se filtra por «no soy
 * yo» y lo que queda es, por construcción, ajeno.
 *
 * ## Lo que el historial no cuenta, y qué se hace con ello
 *
 * `historial.ts` deja fuera `moveClass` a propósito (su `SIN_INTERES`), y hace
 * bien: arrastrar una caja produce decenas de operaciones por segundo y
 * registrarlas sepultaría todo lo demás. Pero eso significa que «alguien ha
 * movido la clase que tengo abierta» **no se puede sacar de aquí**, y es justo
 * uno de los dos sucesos que hay que contar.
 *
 * Se resuelve sin volver a la comparación general: quien llama vigila la
 * posición de **una sola** clase —la que tiene abierta— y pasa el resultado como
 * `movida`. Es un dato que el componente ya tiene delante, no cuesta recorrer
 * nada, y al mirar una sola caja no hace falta atribuir nada por diferencias.
 *
 * Y se cuenta **una vez**, no cuarenta. Esa es la razón de que
 * `suerteDeLaAbierta` devuelva un estado y no un suceso: cuarenta fotogramas de
 * arrastre ajeno dejan el mismo estado «movida», y quien lo pinta muestra un
 * cartel, no cuarenta.
 *
 * ## Por qué se marca por identificador y no por hora
 *
 * Para saber «qué hay nuevo desde la última vez que miré» lo natural sería
 * guardar una hora. Aquí no vale, y no por gusto: las fechas del historial las
 * pone el reloj de quien hizo el cambio, y el propio módulo lo sabe —por eso
 * existe `relojDudoso`—. Un portátil con la hora mal puesta o alguien que estuvo
 * tres días editando sin conexión mete entradas con fecha anterior a la última
 * vista, y esas entradas no se anunciarían nunca.
 *
 * El orden del historial es el del CRDT, que es el orden en que las cosas
 * confluyeron de verdad. Así que la marca es el **identificador** de la última
 * entrada vista y lo nuevo es «todo lo que hay después de ella en el array».
 */

/**
 * Cuántos nombres se dicen antes de resumir en «y N más».
 *
 * Dos, porque el aviso vive en una franja de una línea sobre un teléfono de
 * 320 px y compite con el diagrama por el sitio. «Ana y Luis» cabe; «Ana, Luis,
 * Marta y Diego» se corta por la mitad y deja al último a medio nombre, que es
 * la peor de las opciones: ocupa el mismo espacio y encima parece un fallo.
 */
export const NOMBRES_EN_EL_AVISO = 2;

/**
 * Marca de «se empezó a mirar con el historial vacío».
 *
 * Hace falta porque `null` y «vacío» no son lo mismo y confundirlos se come un
 * aviso. `null` significa «todavía no se sabe por dónde va esto», y entonces hay
 * que callar. Esto otro significa «se estaba delante y no había nada», y entonces
 * el primer cambio que llegue **sí** es una novedad.
 *
 * Sin esta distinción, en un proyecto recién creado el primer cambio de otra
 * persona no se anunciaría nunca: no habría última entrada que marcar, la marca
 * se quedaría en `null` y `null` manda callar. Es justo el caso de dos personas
 * empezando un diagrama juntas, que es cuando más se mira quién hace qué.
 *
 * Es la cadena vacía porque ningún identificador real lo es, así que no puede
 * coincidir con una entrada de verdad.
 */
export const DESDE_EL_PRINCIPIO = '';

/** Lo que ha pasado con la clase que hay abierta en la hoja. */
export type Suerte = 'intacta' | 'movida' | 'cambiada' | 'borrada';

export interface SuerteDeLaAbierta {
  suerte: Suerte;
  /** Quién lo hizo, si el historial lo sabe. Vacío cuando solo consta el movimiento. */
  porQuien: string;
}

export interface Novedades {
  /** Entradas ajenas todavía sin ver, de la más antigua a la más reciente. */
  entradas: EntradaLeida[];
  /**
   * Identificador de la última entrada del historial completo.
   *
   * Es lo que hay que guardar al dar las novedades por vistas, y sale de aquí y
   * no de `entradas` por un motivo que solo aparece con dos personas: si el
   * último cambio lo hice yo, `entradas` está vacío pero la marca tiene que
   * avanzar igualmente. Si no avanzara, las entradas ajenas anteriores a la mía
   * volverían a contarse como nuevas en la siguiente vuelta.
   */
  ultima: string | null;
}

/**
 * Lo que han hecho los demás desde la marca.
 *
 * Si la marca es `null` —primera vez que se mira— no se devuelve nada. Es
 * deliberado: al abrir un proyecto con doscientas entradas de historial, lo
 * último que hace falta es un cartel diciendo «doscientos cambios de cuatro
 * personas». Eso no es una novedad, es el proyecto. Lo nuevo empieza a contar
 * desde que se está delante.
 *
 * Una marca que ya no aparece en el historial —la entrada se cayó por el tope de
 * `MAXIMO_ENTRADAS`, o se está mirando otro proyecto— se trata igual que la
 * primera vez, y por lo mismo: es preferible callar una novedad que empezar
 * anunciando el historial entero.
 */
export function cambiosDeOtros(
  historial: readonly EntradaLeida[],
  yoId: string,
  ultimoVisto: string | null,
): Novedades {
  const ultima = historial.length > 0 ? (historial[historial.length - 1]?.id ?? null) : null;

  if (ultimoVisto === null) return { entradas: [], ultima };

  if (ultimoVisto === DESDE_EL_PRINCIPIO) {
    return { entradas: historial.filter((e) => e.autorId !== yoId), ultima };
  }

  const corte = historial.findIndex((e) => e.id === ultimoVisto);
  if (corte === -1) return { entradas: [], ultima };

  return {
    entradas: historial.slice(corte + 1).filter((e) => e.autorId !== yoId),
    ultima,
  };
}

/**
 * Los nombres de quienes firman unas entradas, sin repetir y en orden de aparición.
 *
 * El orden es el del historial y no alfabético a propósito: quien acaba de tocar
 * algo es de quien se quiere leer el nombre primero, porque es a quien se le va a
 * preguntar.
 */
export function autoresDe(entradas: readonly EntradaLeida[]): string[] {
  const vistos: string[] = [];
  for (const entrada of entradas) {
    if (!vistos.includes(entrada.autorNombre)) vistos.push(entrada.autorNombre);
  }
  return vistos;
}

/**
 * «Ana», «Ana y Luis», «Ana, Luis y 2 más».
 *
 * Con la lista vacía devuelve cadena vacía en vez de fallar. Quien llama ya ha
 * comprobado que hay entradas; obligarle a comprobarlo otra vez aquí solo añade
 * una rama que nunca se recorre y que, por no recorrerse nunca, nadie mantiene.
 */
export function nombrarAutores(nombres: readonly string[]): string {
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0] ?? '';
  if (nombres.length <= NOMBRES_EN_EL_AVISO) {
    return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1] ?? ''}`;
  }
  const restantes = nombres.length - NOMBRES_EN_EL_AVISO;
  return `${nombres.slice(0, NOMBRES_EN_EL_AVISO).join(', ')} y ${String(restantes)} más`;
}

/**
 * La línea que se lee en la franja de aviso.
 *
 * Con un solo cambio se usa el `resumen` que ya escribió `describeOperation`
 * —«Creó la clase Pedido»— en vez de redactar otro aquí. Tener dos redacciones
 * del mismo suceso es tener una que se queda vieja, y la del historial es la que
 * está probada y la que se ve al abrir la lista completa: que coincidan es lo
 * que hace que pulsar el aviso y encontrar esa misma línea se entienda como la
 * misma cosa y no como dos.
 *
 * A partir de dos se cuenta en vez de enumerar. Un teléfono no tiene sitio para
 * tres resúmenes, y el que importa —si es que importa alguno— se mira en la
 * lista, que está a un toque.
 *
 * Devuelve `null` y no una cadena vacía cuando no hay nada que decir: es la
 * diferencia entre «no hay aviso» y «hay un aviso en blanco», y con una cadena
 * vacía el componente pintaría la franja vacía sobre el diagrama.
 */
export function resumirCambios(entradas: readonly EntradaLeida[]): string | null {
  if (entradas.length === 0) return null;

  const quien = nombrarAutores(autoresDe(entradas));

  if (entradas.length === 1) {
    const sola = entradas[0];
    if (!sola) return null;
    return `${quien}: ${sola.resumen}`;
  }

  return `${String(entradas.length)} cambios de ${quien}`;
}

/**
 * Qué le ha pasado a la clase que hay abierta en la hoja.
 *
 * Los cuatro estados están ordenados por gravedad y se devuelve el peor, porque
 * lo que se pinta es un cartel y solo hay sitio para uno. Que se haya movido
 * *además* de haberse borrado no cambia nada de lo que hay que hacer.
 *
 * - **borrada**: la clase ya no está en el diagrama. Es la única que obliga a
 *   cerrar la ficha, porque lo que hay debajo de los campos ya no existe.
 * - **cambiada**: sigue ahí, pero alguien ha tocado algo suyo. La ficha se puede
 *   seguir usando; lo que no puede es fingir que el contenido es el que se dejó.
 * - **movida**: solo ha cambiado de sitio en el lienzo. No afecta a la ficha en
 *   absoluto, y se cuenta únicamente porque al cerrar la hoja la caja no va a
 *   estar donde se la dejó, y buscarla sin saber que se ha movido es la clase de
 *   desconcierto que hace pensar que se ha perdido algo.
 * - **intacta**: nada que decir.
 *
 * `sigueViva` entra como argumento en vez de deducirse del historial porque el
 * historial no registra bajas como tales: `entrada.clases` dice qué clases tocó
 * un cambio, no si las dejó vivas. Quien llama tiene el diagrama delante y la
 * respuesta le cuesta una búsqueda en un objeto, así que la trae hecha. Deducir
 * aquí, por el texto del resumen, ataría esto al idioma —y el propio
 * `historial.ts` ya explica por qué eso no se hace—.
 *
 * Con `claseId` a `null` —no hay ficha abierta— siempre es `intacta`. No es un
 * caso raro que haya que tolerar: es el estado normal de la pantalla.
 */
export function suerteDeLaAbierta(
  claseId: string | null,
  sigueViva: boolean,
  movida: boolean,
  entradas: readonly EntradaLeida[],
): SuerteDeLaAbierta {
  if (claseId === null) return { suerte: 'intacta', porQuien: '' };

  const laTocaron = entradas.filter((e) => e.clases.includes(claseId));
  const porQuien = nombrarAutores(autoresDe(laTocaron));

  if (!sigueViva) return { suerte: 'borrada', porQuien };
  if (laTocaron.length > 0) return { suerte: 'cambiada', porQuien };
  if (movida) return { suerte: 'movida', porQuien: '' };
  return { suerte: 'intacta', porQuien: '' };
}

/**
 * El cartel que se pinta encima de la ficha.
 *
 * Se separa de `suerteDeLaAbierta` porque son dos decisiones distintas: una es
 * qué ha pasado y la otra cómo se cuenta. La primera es la que tiene reglas y la
 * que se prueba a conciencia; la segunda es redacción, y mezclarlas obligaría a
 * reescribir las pruebas de la primera cada vez que se retoca una palabra.
 *
 * Sin nombre de autor las frases quedan en impersonal. Pasa de verdad: si el
 * único rastro es que la caja se ha movido, no hay entrada de historial y no hay
 * a quién atribuirlo. Decir «alguien» sería inventarse una persona; la forma
 * impersonal dice lo mismo sin afirmar de más.
 */
export function textoDeLaSuerte({ suerte, porQuien }: SuerteDeLaAbierta): string | null {
  const firma = porQuien === '' ? '' : ` (${porQuien})`;
  switch (suerte) {
    case 'borrada':
      return `Esta clase se ha borrado mientras estaba abierta${firma}.`;
    case 'cambiada':
      return `Esta clase ha cambiado mientras estaba abierta${firma}.`;
    case 'movida':
      return 'Esta clase ha cambiado de sitio en el lienzo.';
    case 'intacta':
      return null;
  }
}
