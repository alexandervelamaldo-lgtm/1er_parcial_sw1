import { useCallback, useEffect, useRef, useState, type PointerEvent as EventoPuntero } from 'react';
import {
  abrirAcoplado,
  alternarAcoplado,
  alternarColumna,
  leerDisposicion,
  redimensionar,
  type Acoplado,
  type Disposicion,
  type Lado,
} from '../components/paneles';
import { usePantallaEstrecha } from './useDispositivo';

/**
 * La disposición de los paneles acoplados, con memoria.
 *
 * Este hook es la parte que no se puede probar sin navegador: el arrastre de las
 * canaletas y el `localStorage`. Las reglas —cuánto puede medir una columna,
 * cuándo se pliega sola, qué hacer con lo que había guardado— viven en
 * `components/paneles.ts` y se prueban aparte.
 */

/**
 * Se guarda por proyecto y no globalmente.
 *
 * Un diagrama de dos clases y uno de sesenta no se miran igual: en el segundo el
 * árbol hace falta ancho y en el primero estorba. Guardar una sola disposición
 * para todo obligaría a recolocar los paneles cada vez que se cambia de
 * proyecto.
 *
 * La `v1` del prefijo es para poder cambiar el formato sin heredar basura: si un
 * día hay tres columnas, se estrena clave y nadie arrastra una disposición
 * incompatible.
 */
function claveDe(proyectoId: string): string {
  return `paneles:v1:${proyectoId}`;
}

function leerAlmacen(clave: string): string | null {
  // `localStorage` lanza —no devuelve null— en navegación privada de Safari y
  // con cookies de terceros bloqueadas dentro de un WebView. Que no se pueda
  // recordar la disposición no es motivo para no abrir el editor.
  try {
    return window.localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function escribirAlmacen(clave: string, valor: string): void {
  try {
    window.localStorage.setItem(clave, valor);
  } catch {
    /* Sin sitio o sin permiso: se pierde la memoria, no la sesión. */
  }
}

/** Lo que mueve una flecha sobre la canaleta enfocada. */
const PASO_TECLADO = 16;

export interface ControlDePaneles {
  disposicion: Disposicion;
  /**
   * Si la ventana es de teléfono. Lo usa la columna para no dibujar la canaleta:
   * ahí abajo el panel abierto flota sobre el lienzo y no reparte ancho con
   * nadie, así que la canaleta no tendría nada que mover. Se decide aquí y no en
   * la hoja de estilos porque un `display: none` dejaría un `separator`
   * enfocable, sin efecto y anunciado por el lector de pantalla.
   */
  estrecha: boolean;
  /**
   * La rejilla. De su borde sale la medida del arrastre: la canaleta izquierda
   * mide desde el borde izquierdo del cuerpo y la derecha desde el derecho, así
   * que el ancho no depende de dónde esté la ventana en la pantalla.
   */
  cuerpo: React.RefObject<HTMLDivElement>;
  /** Qué canaleta se está arrastrando, para pintarla activa y bloquear la selección. */
  ladoArrastrado: Lado | null;
  alternar: (acoplado: Acoplado) => void;
  /**
   * Abrir sin alternar, para quien ya sabe que quiere verlo.
   *
   * `alternar` no vale para eso y el caso se da: un panel marcado como abierto
   * dentro de una columna plegada —que es como arranca el editor en un
   * teléfono— responde al primer toque cerrándose, así que no pasa nada
   * visible, y solo al segundo aparece. Quien pulsa «Ficha» en la barra del
   * pulgar está pidiendo verla, no conmutar un interruptor que no tiene
   * delante.
   */
  abrir: (acoplado: Acoplado) => void;
  alternarLado: (lado: Lado) => void;
  iniciarArrastre: (lado: Lado, evento: EventoPuntero<HTMLElement>) => void;
  /** Mueve la canaleta con el teclado; `delta` en píxeles, positivo ensancha. */
  empujar: (lado: Lado, delta: number) => void;
}

export function usePaneles(proyectoId: string): ControlDePaneles {
  const estrecha = usePantallaEstrecha();
  const cuerpo = useRef<HTMLDivElement>(null);
  const [ladoArrastrado, setLadoArrastrado] = useState<Lado | null>(null);
  const [disposicion, setDisposicion] = useState<Disposicion>(() =>
    leerDisposicion(leerAlmacen(claveDe(proyectoId)), estrecha),
  );

  // Cambiar de proyecto sin desmontar el editor tiene que traer la disposición
  // del proyecto nuevo. El identificador se compara a mano en vez de meter el
  // `setState` en un efecto sin guarda, que reiniciaría la disposición en cada
  // repintado.
  const proyectoCargado = useRef(proyectoId);
  useEffect(() => {
    if (proyectoCargado.current === proyectoId) return;
    proyectoCargado.current = proyectoId;
    setDisposicion(leerDisposicion(leerAlmacen(claveDe(proyectoId)), estrecha));
  }, [proyectoId, estrecha]);

  // No se guarda mientras se arrastra: son sesenta escrituras por segundo para
  // conservar solo la última. Al soltar, `ladoArrastrado` vuelve a null y este
  // efecto escribe el ancho definitivo.
  useEffect(() => {
    if (ladoArrastrado !== null) return;
    escribirAlmacen(claveDe(proyectoId), JSON.stringify(disposicion));
  }, [proyectoId, disposicion, ladoArrastrado]);

  const alternar = useCallback((acoplado: Acoplado) => {
    setDisposicion((actual) => alternarAcoplado(actual, acoplado));
  }, []);

  const abrir = useCallback((acoplado: Acoplado) => {
    setDisposicion((actual) => abrirAcoplado(actual, acoplado));
  }, []);

  const alternarLado = useCallback((lado: Lado) => {
    setDisposicion((actual) => alternarColumna(actual, lado));
  }, []);

  const empujar = useCallback((lado: Lado, delta: number) => {
    setDisposicion((actual) => ({
      ...actual,
      [lado]: redimensionar(actual[lado], actual[lado].ancho + delta),
    }));
  }, []);

  /**
   * El arrastre se sigue en `window` y no en la canaleta.
   *
   * Con `setPointerCapture` bastaría en un navegador sano, pero un puntero que
   * sale de la ventana —o un WebView que pierde el foco a mitad de gesto— deja
   * el evento de soltar sin destinatario y la columna se queda pegada al ratón.
   * Escuchando también `pointercancel` en la ventana, el gesto siempre termina.
   */
  const iniciarArrastre = useCallback((lado: Lado, evento: EventoPuntero<HTMLElement>) => {
    const marco = cuerpo.current?.getBoundingClientRect();
    if (!marco) return;

    evento.preventDefault();
    setLadoArrastrado(lado);

    const mover = (movimiento: PointerEvent): void => {
      const pedido =
        lado === 'izquierda' ? movimiento.clientX - marco.left : marco.right - movimiento.clientX;
      setDisposicion((actual) => ({ ...actual, [lado]: redimensionar(actual[lado], pedido) }));
    };
    const soltar = (): void => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', soltar);
      setLadoArrastrado(null);
    };

    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', soltar);
  }, []);

  return {
    disposicion,
    estrecha,
    cuerpo,
    ladoArrastrado,
    alternar,
    abrir,
    alternarLado,
    iniciarArrastre,
    empujar,
  };
}

export { PASO_TECLADO };
