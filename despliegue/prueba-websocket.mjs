/**
 * Prueba del canal colaborativo a traves de CloudFront.
 *
 * La pregunta que responde no es "cargo la pagina" —eso ya se sabe— sino si el
 * apreton de manos de WebSocket sobrevive el salto por CloudFront. Es la unica
 * incognita que quedaba de la arquitectura: si no sobrevive, la herramienta se
 * dibuja pero no colabora, que es justamente lo que se califica.
 *
 * El truco esta en el token invalido. El servidor rechaza con 401 ANTES de
 * completar el apreton (collab/server.ts:99-103), asi que un 401 es la mejor
 * respuesta posible: prueba que la peticion de upgrade llego entera hasta la
 * aplicacion, con sus cabeceras Sec-WebSocket-*, sin necesitar una sesion real.
 * Un 403 con cabeceras de CloudFront, en cambio, significa que el borde la corto.
 *
 * Se prueba tambien contra el origen en claro como control. Si las dos fallan el
 * problema es la aplicacion; si solo falla la de CloudFront, es el borde.
 */
import WebSocket from 'ws';

const CLOUDFRONT = 'd3dpubw4ihutm1.cloudfront.net';
const ORIGEN = '13.220.255.222';

// Un UUID con forma valida pero que no existe: pasa isValidRoomId (rooms.ts:251)
// para que la ejecucion llegue hasta la comprobacion del token, que es la que
// queremos ver responder.
const PROYECTO = '00000000-0000-4000-8000-000000000000';
const TOKEN = 'token-invalido-a-proposito';

function ruta(base) {
  return `${base}/colaboracion?proyecto=${PROYECTO}&token=${TOKEN}`;
}

function probar(etiqueta, url) {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const ws = new WebSocket(url, { handshakeTimeout: 15000 });
    let resuelto = false;

    const terminar = (veredicto, detalle) => {
      if (resuelto) return;
      resuelto = true;
      try {
        ws.terminate();
      } catch {
        /* el socket ya estaba cerrado */
      }
      resolve({ etiqueta, veredicto, detalle, ms: Date.now() - inicio });
    };

    ws.on('unexpected-response', (_req, res) => {
      const cache = res.headers['x-cache'] ?? '(sin x-cache)';
      const via = res.headers.via ?? '(sin via)';
      if (res.statusCode === 401) {
        terminar('LLEGO', `401 de la aplicacion — el upgrade cruzo entero. via=${via}`);
      } else {
        terminar('CORTADO', `HTTP ${res.statusCode}; x-cache=${cache}; via=${via}`);
      }
    });

    // No deberia ocurrir con un token invalido; si ocurre, la autorizacion
    // del canal colaborativo tiene un agujero y eso importa mas que CloudFront.
    ws.on('open', () => terminar('ALERTA', 'apreton COMPLETADO con un token invalido'));

    ws.on('error', (err) => terminar('FALLO', `${err.code ?? ''} ${err.message}`.trim()));
  });
}

const resultados = [];
resultados.push(await probar('CloudFront (wss)', ruta(`wss://${CLOUDFRONT}`)));
resultados.push(await probar('Origen EC2 (ws) [control]', ruta(`ws://${ORIGEN}`)));

console.log('');
for (const r of resultados) {
  console.log(`${r.veredicto.padEnd(8)} ${r.etiqueta.padEnd(28)} ${r.ms} ms  ${r.detalle}`);
}
console.log('');

const cf = resultados[0];
const origen = resultados[1];
if (cf.veredicto === 'LLEGO' && origen.veredicto === 'LLEGO') {
  console.log('CloudFront transporta WebSocket. La colaboracion funciona sobre HTTPS.');
  console.log(`Coste del salto por el borde: ${cf.ms - origen.ms} ms sobre el origen.`);
} else if (origen.veredicto === 'LLEGO') {
  console.log('El origen acepta el upgrade pero CloudFront no lo deja pasar.');
} else {
  console.log('Falla tambien contra el origen: el problema no es CloudFront.');
}
