/**
 * Capturas del recorrido de primer acceso, en PNG y sin pulsar nada.
 *
 * Lo que hace: levanta Chrome sin ventana, una vez por pantalla, apuntando a la
 * página de desarrollo `vista-asistente.html` con el parámetro que la coloca
 * donde toca, y guarda el PNG en `docs/capturas/`.
 *
 * Por qué existe teniendo un navegador delante: las capturas hechas a mano
 * salen cada vez a un tamaño y con el foco en un sitio distinto, y hay que
 * repetirlas enteras cada vez que cambia un texto de `asistente-dps.ts`. Estas
 * se rehacen con una orden y salen siempre iguales, que es lo que hace que se
 * puedan comparar dos versiones y ver qué se movió.
 *
 *   npm run dev          (en otra consola: hace falta el servidor de Vite)
 *   node capturar-recorrido.mjs [puerto]
 *
 * El puerto va como argumento porque Vite se corre al siguiente libre cuando el
 * 5173 está ocupado, y lo está casi siempre si el editor ya está abierto.
 *
 * Un detalle de las imágenes que conviene saber antes de pegarlas en un informe:
 * el título de cada lámina sale con el anillo de foco alrededor. No es un fallo
 * y no es un adorno: al cambiar de lámina el foco va al título —es lo que hace
 * que un lector de pantalla lea la lámina nueva— y `estilos.css` esconde el
 * anillo cuando ese foco es de programa. Aquí se ve porque la página de
 * desarrollo salta de lámina con un `.click()` sintético, y un clic que no
 * viene de un ratón de verdad no cuenta como gesto de puntero para Chrome: deja
 * `:focus-visible` en pie. O sea que estas capturas enseñan el recorrido tal y
 * como lo ve quien navega con el teclado. Con el ratón el anillo no aparece.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SALIDA = resolve(AQUI, '..', 'docs', 'capturas');

const PUERTO = process.argv[2] ?? '5174';
const BASE = `http://localhost:${PUERTO}/vista-asistente.html`;

/*
  1280×860 es la ventana en la que se miró el recorrido mientras se ajustaba. No
  es una medida redonda por gusto: la caja tiene `max-height: min(88vh, 720px)`,
  y con 860 de alto el `88vh` da 757, o sea que manda el tope de 720 y la lámina
  tercera desborda. Es justo el caso que hay que poder ver en una captura,
  porque es donde se comprueba que la barra de desplazamiento aparece y que el
  pie se queda pegado abajo. Con una ventana más alta no se vería el problema
  aunque siguiera estando.
*/
const ANCHO = 1280;
const ALTO = 860;

/*
  Chrome solo está donde está en Windows. Si algún día esto corre en otro sitio,
  la variable de entorno es la salida; fallar con el nombre del fichero delante
  es mejor que fallar con «no se pudo capturar».
*/
const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const PANTALLAS = [
  ['01-portada', '?lamina=1'],
  ['02-proposito', '?lamina=2'],
  ['03-funcionalidades', '?lamina=3'],
  ['04-pasos', '?lamina=4'],
  ['05-requisitos', '?lamina=5'],
  ['06-criterios', '?lamina=6'],
  ['07-volver-a-abrirlo', '?ayuda'],
];

mkdirSync(SALIDA, { recursive: true });

for (const [nombre, consulta] of PANTALLAS) {
  const destino = join(SALIDA, `recorrido-${nombre}.png`);
  /*
    Un perfil nuevo y desechable por captura. Chrome se niega a arrancar en modo
    headless sobre el perfil que ya está abierto, y con uno reutilizado la
    segunda captura hereda el estado de la primera.
  */
  const perfil = join(AQUI, `.perfil-captura-${nombre}`);
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      `--user-data-dir=${perfil}`,
      `--window-size=${ANCHO},${ALTO}`,
      `--screenshot=${destino}`,
      /*
        El presupuesto de tiempo virtual deja que React monte, que el efecto
        pulse la entrada del índice y que la lámina pedida esté pintada antes
        del disparo. Sin él la captura sale en blanco: headless no espera a
        nadie, dispara en cuanto el documento está listo.
      */
      '--virtual-time-budget=4000',
      '--hide-scrollbars=false',
      BASE + consulta,
    ],
    { stdio: 'ignore' },
  );
  rmSync(perfil, { recursive: true, force: true });
  console.log(`  ${destino}`);
}

console.log(`\n${PANTALLAS.length} capturas en ${SALIDA}`);
