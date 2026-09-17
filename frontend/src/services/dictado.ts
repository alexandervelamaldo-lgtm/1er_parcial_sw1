/**
 * Las decisiones del dictado, sin tocar el micrófono.
 *
 * Aquí está lo que se puede probar en Node: cuánto se espera antes de dar una
 * frase por terminada, en qué variante del castellano se escucha, y cuál de las
 * hipótesis que devuelve el motor se queda. `voz.ts` se limita a enchufar esto a
 * la API del navegador, que es la parte que no se puede probar sin navegador.
 *
 * Existe porque el dictado fallaba de tres formas distintas y las tres se veían
 * igual desde fuera —«no me entiende»—: cortaba en la primera pausa, escuchaba
 * en castellano de España a quien no lo habla, y tiraba a la basura las
 * alternativas que el propio motor ya había calculado.
 */

/* -------------------------------------------------------------------------- */
/* Cuánto se espera                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Silencio que cierra el dictado **cuando ya se ha dicho algo**.
 *
 * El motor del navegador corta por su cuenta en cuanto detecta una pausa de
 * medio segundo, y ese era el problema: quien piensa la frase mientras la dice
 * —«crea la clase… Pedido… con el atributo…»— la veía enviada a trozos. Aquí la
 * pausa ya no termina nada; se vuelve a escuchar y solo este temporizador, que
 * es mucho más largo que cualquier pausa al hablar, decide que la frase acabó.
 */
export const MS_SILENCIO_TRAS_HABLAR = 6_000;

/**
 * Silencio que cierra el dictado **cuando todavía no se ha oído nada**.
 *
 * Es el doble del otro a propósito. Entre pulsar el botón y empezar a hablar hay
 * que leer el campo, decidir qué se pide y coger aire, y medir eso con el mismo
 * reloj que una pausa en mitad de una frase apagaba el micrófono antes de la
 * primera palabra.
 */
export const MS_SILENCIO_ANTES_DE_HABLAR = 15_000;

/**
 * Tope absoluto de una sesión de dictado.
 *
 * No está para limitar al usuario sino para que un micrófono olvidado no se
 * quede abierto: con reinicio automático tras cada pausa, un `onend` que nadie
 * cerrara escucharía indefinidamente, y en el móvil eso es batería y un punto
 * rojo en la barra de estado que nadie sabe apagar.
 */
export const MS_MAXIMO_ESCUCHANDO = 120_000;

/**
 * Cuántas hipótesis se le piden al motor.
 *
 * Cuatro y no más: la lista viene ordenada por confianza del propio motor y a
 * partir de la cuarta lo que llega no se parece a lo dicho. Pedir varias no
 * cuesta nada —el motor ya las tiene calculadas— y es lo que permite descartar
 * la primera cuando la segunda sí contiene vocabulario de la herramienta.
 */
export const ALTERNATIVAS_PEDIDAS = 4;

/* -------------------------------------------------------------------------- */
/* En qué idioma se escucha                                                    */
/* -------------------------------------------------------------------------- */

/**
 * La variante que se usa cuando el aparato no dice ninguna útil.
 *
 * No es `es-ES`, y ese cambio es el que más se nota. Los modelos de
 * reconocimiento están entrenados por región: el de España espera una `c` de
 * «clase» pronunciada como en Madrid, y a un hablante latinoamericano le
 * devuelve sistemáticamente otra palabra. `es-US` es el modelo latinoamericano
 * con más cobertura de los que el servicio acepta con seguridad.
 */
export const IDIOMA_DE_RESPALDO = 'es-US';

/**
 * Elige la variante del castellano en la que escuchar.
 *
 * Se mira lo que declara el aparato porque es la única prueba disponible de cómo
 * habla quien lo tiene en la mano; el idioma de la interfaz no se toca, esto
 * decide solo qué modelo de reconocimiento se pide.
 *
 * Se descartan las etiquetas sin región (`es`) y las de región numérica
 * (`es-419`, que es «Latinoamérica» en M49): son válidas como etiqueta de idioma
 * pero el servicio de reconocimiento no las conoce, y pedirlas acaba en un
 * modelo por defecto que suele ser el de España. Para esos dos casos vale más el
 * respaldo, que sí es una región real.
 *
 * @param preferidos Idiomas del aparato, del más querido al menos.
 */
export function idiomaDeDictado(preferidos: readonly string[]): string {
  for (const etiqueta of preferidos) {
    const partes = etiqueta.trim().replace(/_/g, '-').split('-');
    const lengua = partes[0]?.toLowerCase();
    const region = partes[1];
    if (lengua !== 'es') continue;
    if (!region || /^\d+$/.test(region)) continue;
    return `es-${region.toUpperCase()}`;
  }
  return IDIOMA_DE_RESPALDO;
}

/* -------------------------------------------------------------------------- */
/* Qué hipótesis se queda                                                      */
/* -------------------------------------------------------------------------- */

const ACENTOS: Record<string, string> = {
  á: 'a',
  é: 'e',
  í: 'i',
  ó: 'o',
  ú: 'u',
  ü: 'u',
  ñ: 'n',
};

/** Minúsculas y sin tildes, para comparar palabra a palabra. */
function plegar(texto: string): string {
  return texto.toLowerCase().replace(/[áéíóúüñ]/g, (c) => ACENTOS[c] ?? c);
}

/**
 * Las palabras con las que se habla a esta herramienta.
 *
 * No es un diccionario de castellano: es la lista de términos que solo aparecen
 * si el motor acertó. «Crea la clase Pedido» y «crea la plaza pedido» son casi
 * el mismo sonido y el motor devuelve las dos; la única diferencia medible entre
 * ellas es que una contiene una palabra de esta lista.
 *
 * Está en forma plegada —sin tildes y en minúsculas— porque se compara contra
 * texto plegado, no contra el que se muestra.
 */
const VOCABULARIO = new Set([
  // Elementos
  'clase',
  'clases',
  'interfaz',
  'interfaces',
  'enum',
  'enumeracion',
  'abstracta',
  'atributo',
  'atributos',
  'campo',
  'campos',
  'metodo',
  'metodos',
  'operacion',
  'operaciones',
  'parametro',
  'parametros',
  // Relaciones
  'relacion',
  'relaciones',
  'asociacion',
  'herencia',
  'hereda',
  'agregacion',
  'composicion',
  'dependencia',
  'multiplicidad',
  'muchos',
  // Tipos
  'tipo',
  'entero',
  'texto',
  'decimal',
  'booleano',
  'fecha',
  'cadena',
  // Verbos de orden
  'crea',
  'crear',
  'anade',
  'agrega',
  'elimina',
  'borra',
  'quita',
  'renombra',
  'conecta',
  'une',
  'genera',
  'exporta',
  'importa',
  // La herramienta y lo que produce
  'diagrama',
  'proyecto',
  'lienzo',
  'tabla',
  'fila',
  'columna',
  'uml',
  'xmi',
  'zip',
  'spring',
  'boot',
  'java',
  'angular',
  'backend',
  'frontend',
]);

/**
 * Cuántas palabras de la herramienta aparecen en una hipótesis.
 *
 * Cuenta palabras distintas y no repeticiones: «clase clase clase» no es una
 * transcripción tres veces mejor, y sin el conjunto una hipótesis con una
 * palabra atascada le ganaría a otra que entendió la frase entera.
 */
export function puntuarPorVocabulario(texto: string): number {
  const vistas = new Set<string>();
  for (const palabra of plegar(texto).split(/[^a-z0-9]+/)) {
    if (palabra && VOCABULARIO.has(palabra)) vistas.add(palabra);
  }
  return vistas.size;
}

/**
 * De las hipótesis del motor, la que más se parece a una orden de la herramienta.
 *
 * El motor las devuelve ordenadas por su propia confianza acústica, que no sabe
 * nada de este programa. Esto reordena solo cuando tiene un motivo: en caso de
 * empate se respeta la primera, porque sin evidencia a favor de otra el motor
 * acierta más que cualquier heurística de aquí.
 *
 * @param puntuar Con qué medir. Por omisión, el vocabulario de la herramienta;
 *   quien tenga una gramática de verdad delante —el asistente la tiene— puede
 *   pasar una que puntúe si la frase se convierte en una operación.
 */
export function mejorAlternativa(
  alternativas: readonly string[],
  puntuar: (texto: string) => number = puntuarPorVocabulario,
): string {
  let mejor = '';
  let mejorPunto = -1;
  for (const alternativa of alternativas) {
    const texto = alternativa.trim();
    if (!texto) continue;
    const punto = puntuar(texto);
    if (punto > mejorPunto) {
      mejor = texto;
      mejorPunto = punto;
    }
  }
  return mejor;
}

/* -------------------------------------------------------------------------- */
/* Cómo se pega lo dictado                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Junta los trozos que ha ido soltando el motor en una sola frase.
 *
 * Con el dictado continuo la frase llega partida por las pausas, y cada trozo
 * viene con sus propios espacios sobrantes. Se normaliza aquí y no al mostrar
 * para que lo que se ve mientras se habla y lo que se envía al terminar sean
 * exactamente el mismo texto.
 */
export function unirDictado(partes: readonly string[]): string {
  return partes
    .map((parte) => parte.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Los errores del motor                                                       */
/* -------------------------------------------------------------------------- */

const MENSAJES: Record<string, string> = {
  'not-allowed': 'No se ha dado permiso para usar el micrófono.',
  'service-not-allowed': 'El navegador no permite usar el reconocimiento de voz aquí.',
  'audio-capture': 'No se encuentra ningún micrófono.',
  network: 'El reconocimiento de voz necesita conexión.',
};

/**
 * Qué errores terminan el dictado y cuáles no.
 *
 * La distinción es la que permite escuchar más tiempo. `no-speech` llega cada
 * vez que el motor se aburre de un silencio y antes apagaba el micrófono con un
 * «No se ha oído nada» en pantalla; no es una avería, es una pausa, y lo que
 * toca es volver a escuchar. `aborted` es el que provoca el propio botón de
 * parar. Los que quedan —permiso, red, micrófono ausente— no se arreglan
 * esperando, y ahí sí hay que dejar de escuchar y decirlo.
 */
export function errorQueTermina(codigo: string): boolean {
  return codigo !== 'no-speech' && codigo !== 'aborted';
}

/** El error del motor, dicho de forma que se pueda actuar. */
export function mensajeDeError(codigo: string): string {
  return MENSAJES[codigo] ?? `Error de reconocimiento: ${codigo}`;
}
