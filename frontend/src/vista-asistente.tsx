import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AsistenteDps } from './components/AsistenteDps';
import { TOTAL_PASOS } from './components/asistente-dps';
import { Guia } from './components/Guia';
import './estilos.css';

/**
 * Vista de desarrollo del recorrido de primer acceso.
 *
 * El recorrido, en la aplicación, se abre solo una vez y solo después de
 * entrar: es justo lo que se quiere de él y justo lo que estorba para mirarlo
 * mientras se está ajustando. Esta página lo monta suelto, con el mismo
 * componente y la misma hoja de estilos, para poder verlo y capturarlo sin
 * sesión, sin proyecto y sin tener que borrar la marca de «visto» cada vez.
 *
 * Al cerrarse no desaparece: deja debajo el panel de ayuda, que es de donde se
 * vuelve a abrir. Esa ida y vuelta —recorrido, «Saltar», «Ver el recorrido»— es
 * la que no se puede probar en la aplicación sin entrar y sin borrar la marca a
 * mano entre intento e intento, y es la que más fácil se rompe, porque el
 * segundo montaje del recorrido es distinto del primero: hay un foco anterior
 * al que volver.
 *
 * Lo que esta página no reproduce es *cuándo* se abre el recorrido. Eso vive en
 * `App.tsx` —`debeAbrirse` contra el almacén del navegador— y aquí se salta a
 * propósito, que es el único motivo por el que esto existe.
 *
 * Acepta dos parámetros para poder capturarla sin pulsar nada, que es lo que usa
 * `capturar-recorrido.mjs`:
 *
 *   ?lamina=4   abre el recorrido y salta a la lámina cuarta
 *   ?ayuda      lo deja cerrado, enseñando el panel del que se vuelve a abrir
 *
 * No entra en la compilación: `vite build` parte de `index.html`.
 */

/** El número de lámina pedido en la dirección, si lo hay y si existe. */
function laminaPedida(): number | null {
  const crudo = new URLSearchParams(window.location.search).get('lamina');
  if (crudo === null) return null;
  const n = Number(crudo);
  return Number.isInteger(n) && n >= 1 && n <= TOTAL_PASOS ? n : null;
}

function Vista(): JSX.Element {
  const [recorrido, setRecorrido] = useState(
    () => !new URLSearchParams(window.location.search).has('ayuda'),
  );
  /*
    La clave fuerza un montaje nuevo en cada reapertura. Sin ella, React
    reutilizaría el componente con el paso en el que se cerró, y el recorrido se
    reabriría por la lámina 4; en la aplicación siempre empieza por la primera,
    porque allí `App` lo desmonta al cerrarlo.
  */
  const [visitas, setVisitas] = useState(0);

  /*
    Saltar a la lámina pedida pulsando su entrada del índice, y no con una
    propiedad `pasoInicial` en el componente.

    La propiedad sería más directa, pero nadie la usaría en la aplicación —el
    recorrido siempre empieza por la primera lámina, tanto al entrar como desde
    «Ver el recorrido»—, así que sería código de producción que solo existe para
    que esta página de desarrollo funcione. Pulsar la entrada del índice es lo
    que haría cualquiera delante de la pantalla, y deja el componente como está.
  */
  useEffect(() => {
    const n = laminaPedida();
    if (n === null || !recorrido) return;
    const entradas = document.querySelectorAll<HTMLButtonElement>('.recorrido__entrada');
    entradas[n - 1]?.click();
  }, [recorrido, visitas]);

  return (
    <>
      <Guia onCerrar={() => undefined} onRecorrido={() => setRecorrido(true)} />
      {recorrido && (
        <AsistenteDps
          key={visitas}
          onCerrar={() => {
            setRecorrido(false);
            setVisitas((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

const contenedor = document.getElementById('raiz');
if (!contenedor) throw new Error('Falta el elemento #raiz en vista-asistente.html');

createRoot(contenedor).render(
  <StrictMode>
    <Vista />
  </StrictMode>,
);
