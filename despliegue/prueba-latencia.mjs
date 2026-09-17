/**
 * Cuanto cuesta el salto por CloudFront, por mensaje.
 *
 * La prueba del apreton de manos (prueba-websocket.mjs) mide el coste de ABRIR
 * la conexion: unos 500 ms de mas, casi todos del TLS. Ese numero asusta y no
 * significa lo que parece —se paga una vez, al entrar al proyecto—.
 *
 * Lo que decide si la colaboracion se siente fluida es el ida y vuelta de CADA
 * mensaje sobre una conexion ya abierta: arrastrar una clase son decenas de
 * mensajes por segundo. Eso es lo que mide este guion, reutilizando la conexion
 * (keep-alive) para que el TLS no contamine la medida.
 *
 * Se usa /salud porque no necesita sesion y no toca la base de datos: mide red,
 * no aplicacion. La politica de cache es CachingDisabled, asi que cada peticion
 * llega de verdad al origen —si se cachearan, esto mediria la distancia al borde
 * y saldria un numero precioso y falso—.
 */
import https from 'node:https';
import http from 'node:http';

const CLOUDFRONT = 'd3dpubw4ihutm1.cloudfront.net';
const ORIGEN = '13.220.255.222';
const REPETICIONES = 12;

function medir(agente, opciones) {
  return new Promise((resolve, reject) => {
    const inicio = process.hrtime.bigint();
    const req = (opciones.protocol === 'https:' ? https : http).request(
      { ...opciones, agent: agente, path: '/salud', method: 'GET' },
      (res) => {
        res.resume();
        res.on('end', () => resolve(Number(process.hrtime.bigint() - inicio) / 1e6));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function serie(etiqueta, opciones) {
  const Agente = opciones.protocol === 'https:' ? https.Agent : http.Agent;
  const agente = new Agente({ keepAlive: true, maxSockets: 1 });
  const muestras = [];
  // La primera peticion abre la conexion y paga el TLS: se descarta a proposito.
  await medir(agente, opciones);
  for (let i = 0; i < REPETICIONES; i += 1) {
    muestras.push(await medir(agente, opciones));
  }
  agente.destroy();
  muestras.sort((a, b) => a - b);
  // Mediana, no media: una sola muestra mala por un reintento de TCP arrastra la
  // media entera y no representa lo que siente quien usa la herramienta.
  const mediana = muestras[Math.floor(muestras.length / 2)];
  return { etiqueta, mediana, min: muestras[0], max: muestras[muestras.length - 1] };
}

const cf = await serie('CloudFront (https)', { protocol: 'https:', host: CLOUDFRONT, port: 443 });
const or = await serie('Origen EC2 (http)', { protocol: 'http:', host: ORIGEN, port: 80 });

console.log('');
for (const r of [cf, or]) {
  console.log(
    `${r.etiqueta.padEnd(20)} mediana ${r.mediana.toFixed(0).padStart(4)} ms   ` +
      `(min ${r.min.toFixed(0)}, max ${r.max.toFixed(0)})`,
  );
}
const delta = cf.mediana - or.mediana;
console.log('');
console.log(
  delta <= 0
    ? `El borde AHORRA ${Math.abs(delta).toFixed(0)} ms por mensaje frente al origen directo.`
    : `El borde CUESTA ${delta.toFixed(0)} ms por mensaje. Por debajo de ~50 ms no se percibe al arrastrar.`,
);
