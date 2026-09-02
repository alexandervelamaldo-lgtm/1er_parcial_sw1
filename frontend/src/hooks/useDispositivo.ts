import { useEffect, useState } from 'react';

/**
 * Qué sabe la interfaz del aparato en el que se está ejecutando.
 *
 * Existe porque la aplicación se dio cuenta tarde de que corre en dos sitios muy
 * distintos: un navegador de escritorio y un WebView dentro de una app Android.
 * En el segundo no hay teclado, así que decirle a alguien «pulsa Ctrl+Z» es
 * mandarle a buscar una tecla que no tiene, justo después de importar doscientas
 * clases —el momento en que más falta hace poder deshacer—.
 *
 * Todo lo de aquí responde a «qué puede hacer este aparato», nunca a «qué
 * aparato es». Preguntar por el modelo o por el `userAgent` obliga a mantener
 * una lista que siempre está desactualizada; preguntar por la capacidad lo
 * decide el navegador, que es quien lo sabe.
 */

/**
 * El mismo corte que usa `estilos.css` para pasar el editor a una columna.
 *
 * Está duplicado —aquí y en la hoja de estilos— porque no hay forma de compartir
 * un número entre CSS y TypeScript sin inventarse un paso de compilación. Si
 * cambia uno tiene que cambiar el otro: el menú de la barra y el reparto del
 * cuerpo dejarían de aparecer a la vez, y el resultado sería una franja de
 * anchos en la que la barra está plegada pero el panel sigue al lado del lienzo.
 */
export const ANCHO_ESTRECHO = 820;

function soportaConsultas(): boolean {
  // En Node —las pruebas de `shared` importan tipos de aquí— no hay `window`.
  // Devolver `false` en vez de reventar deja que lo que se pruebe sea la lógica
  // y no el entorno.
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * Sigue una media query desde React.
 *
 * Se suscribe al cambio en vez de leerla una vez: una ventana que se redimensiona
 * o un ratón que se enchufa cambian la respuesta, y una interfaz que se quedó con
 * la primera lectura miente hasta que algo la obliga a repintarse.
 */
export function useConsultaMedia(consulta: string): boolean {
  const [activa, setActiva] = useState(() =>
    soportaConsultas() ? window.matchMedia(consulta).matches : false,
  );

  useEffect(() => {
    if (!soportaConsultas()) return;
    const mq = window.matchMedia(consulta);
    const alCambiar = (): void => setActiva(mq.matches);
    // Se lee otra vez al suscribirse: entre el primer render y este efecto la
    // respuesta puede haber cambiado, y ese hueco es justo donde se cuelan los
    // fallos que solo pasan «a veces al abrir».
    alCambiar();
    mq.addEventListener('change', alCambiar);
    return () => mq.removeEventListener('change', alCambiar);
  }, [consulta]);

  return activa;
}

/** Ancho de móvil o de tablet en vertical. Lo que no cabe en tres franjas. */
export function usePantallaEstrecha(): boolean {
  return useConsultaMedia(`(max-width: ${ANCHO_ESTRECHO}px)`);
}

/**
 * Una vez visto un modificador, deja de ser una suposición.
 *
 * Vive fuera del hook a propósito: es un dato del aparato, no de un componente.
 * Si el panel del asistente aprende que hay teclado, la barra de herramientas no
 * tiene por qué volver a averiguarlo cuando se monte más tarde.
 */
let tecladoConfirmado = false;

/**
 * Si se puede contar con que hay teclado físico.
 *
 * No existe ninguna API que conteste a esto, así que son dos aproximaciones que
 * se complementan y ninguna miente en la dirección peligrosa:
 *
 * 1. `any-pointer: fine` —hay algún puntero de precisión, o sea ratón o
 *    trackpad—. Un aparato con ratón tiene teclado prácticamente siempre; un
 *    teléfono no da esta respuesta. Se usa `any-pointer` y no `pointer` porque
 *    una tablet con funda-teclado sigue teniendo el dedo como puntero primario y
 *    `pointer: coarse` la clasificaría como si fuese un móvil.
 *
 * 2. Haber visto pulsar Ctrl o Cmd. Esto ya no es una aproximación: si la tecla
 *    se ha pulsado, existe. Cubre el caso que la primera falla —un teclado
 *    Bluetooth emparejado a un teléfono— en cuanto se usa por primera vez.
 *
 * Solo se aprende en un sentido, de «no hay» a «sí hay». No ver un teclado
 * durante un rato no es prueba de que se lo hayan llevado, y una interfaz que
 * cambia de texto sola cada vez que alguien suelta el ratón es peor que una que
 * se queda con la respuesta útil.
 */
export function useTecladoFisico(): boolean {
  const punteroFino = useConsultaMedia('(any-pointer: fine)');
  const [confirmado, setConfirmado] = useState(tecladoConfirmado);

  useEffect(() => {
    if (confirmado || typeof window === 'undefined') return;
    const alPulsar = (evento: KeyboardEvent): void => {
      if (evento.ctrlKey || evento.metaKey || evento.key === 'Control' || evento.key === 'Meta') {
        tecladoConfirmado = true;
        setConfirmado(true);
      }
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [confirmado]);

  return confirmado || punteroFino;
}

/**
 * Cómo se llama «deshacer» en este aparato.
 *
 * Se centraliza aquí porque la frase aparecía en cinco sitios y en los cinco
 * decía «Ctrl+Z». Cinco copias es una garantía de que la próxima vez se arreglen
 * cuatro.
 */
export function nombreDeshacer(hayTeclado: boolean): string {
  return hayTeclado ? 'Ctrl+Z' : 'el botón ↶ de la barra';
}
