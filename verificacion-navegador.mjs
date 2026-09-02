/**
 * Verificación en navegadores reales de la edición colaborativa.
 *
 * Lanza dos instancias de Chrome independientes —perfiles distintos, IndexedDB
 * distinta, sesión distinta— contra el servidor de desarrollo, y comprueba que
 * lo que dibuja una aparece en la otra. Dos perfiles y no dos pestañas: si
 * compartieran almacenamiento, la sincronización podría estar ocurriendo por
 * IndexedDB en lugar de por el canal colaborativo, y la prueba no probaría nada.
 *
 * Se conduce por el protocolo de DevTools sobre `ws`, que ya es dependencia del
 * backend, para no añadir un navegador de pruebas al proyecto.
 *
 * Uso: con el backend en :3001 y el frontend en :5173,
 *   node verificacion-navegador.mjs
 */

import { exec, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const CANDIDATOS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const CHROME = CANDIDATOS.find((c) => existsSync(c));
if (!CHROME) throw new Error('No hay ningún navegador Chromium instalado en las rutas conocidas');

const SELLO = Date.now().toString(36);
const salida = mkdtempSync(join(tmpdir(), 'verificacion-'));

const pasos = [];
function paso(texto) {
  pasos.push(texto);
  console.log(`  ✓ ${texto}`);
}

/* ------------------------------------------------------------------ */
/* Cliente mínimo del protocolo de DevTools                            */
/* ------------------------------------------------------------------ */

function conectar(url) {
  const socket = new WebSocket(url, { maxPayload: 512 * 1024 * 1024 });
  const pendientes = new Map();
  const oyentes = [];
  let siguienteId = 0;

  socket.on('message', (crudo) => {
    const mensaje = JSON.parse(crudo.toString());
    const espera = mensaje.id != null ? pendientes.get(mensaje.id) : undefined;
    if (espera) {
      pendientes.delete(mensaje.id);
      if (mensaje.error) espera.rechazar(new Error(JSON.stringify(mensaje.error)));
      else espera.resolver(mensaje.result);
    } else {
      for (const oyente of oyentes) oyente(mensaje);
    }
  });

  const abierto = new Promise((resolver, rechazar) => {
    socket.once('open', resolver);
    socket.once('error', rechazar);
  });

  return {
    abierto,
    enviar(metodo, parametros, sesion) {
      const id = ++siguienteId;
      const sobre = { id, method: metodo, params: parametros ?? {} };
      if (sesion) sobre.sessionId = sesion;
      return new Promise((resolver, rechazar) => {
        pendientes.set(id, { resolver, rechazar });
        socket.send(JSON.stringify(sobre));
      });
    },
    alRecibir(oyente) {
      oyentes.push(oyente);
    },
    cerrar() {
      socket.close();
    },
  };
}

async function esperarPuerto(puerto, ms = 20000) {
  const limite = Date.now() + ms;
  for (;;) {
    try {
      const respuesta = await fetch(`http://127.0.0.1:${puerto}/json/version`);
      if (respuesta.ok) return await respuesta.json();
    } catch {
      /* todavía no escucha */
    }
    if (Date.now() > limite) throw new Error(`El navegador no abrió el puerto ${puerto}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

/* ------------------------------------------------------------------ */
/* Un navegador                                                        */
/* ------------------------------------------------------------------ */

async function lanzar(etiqueta, puerto) {
  const perfil = mkdtempSync(join(tmpdir(), `perfil-${etiqueta}-`));
  const proceso = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${puerto}`,
      `--user-data-dir=${perfil}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1400,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const version = await esperarPuerto(puerto);
  const cliente = conectar(version.webSocketDebuggerUrl);
  await cliente.abierto;

  const consola = [];
  cliente.alRecibir((mensaje) => {
    if (mensaje.method === 'Runtime.consoleAPICalled') {
      const texto = (mensaje.params.args ?? [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ');
      consola.push({ nivel: mensaje.params.type, texto });
    } else if (mensaje.method === 'Runtime.exceptionThrown') {
      const d = mensaje.params.exceptionDetails;
      consola.push({ nivel: 'excepcion', texto: d.exception?.description ?? d.text });
    }
  });

  const { targetId } = await cliente.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cliente.enviar('Target.attachToTarget', { targetId, flatten: true });

  const nav = { etiqueta, proceso, cliente, sesion: sessionId, targetId, consola, puerto };
  await cliente.enviar('Page.enable', {}, sessionId);
  await cliente.enviar('Runtime.enable', {}, sessionId);
  // Antes de navegar: Chrome solo cierra los WebSocket que estaba vigilando, así
  // que si `Network` se activa después de abrir el canal, apagar la red deja la
  // conexión viva y la prueba de «sin conexión» no probaría nada.
  await cliente.enviar('Network.enable', {}, sessionId);
  return nav;
}

async function evaluar(nav, expresion, esperarPromesa = true) {
  const r = await nav.cliente.enviar(
    'Runtime.evaluate',
    {
      expression: expresion,
      awaitPromise: esperarPromesa,
      returnByValue: true,
      userGesture: true,
    },
    nav.sesion,
  );
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error(`[${nav.etiqueta}] ${d.exception?.description ?? d.text}`);
  }
  return r.result.value;
}

const AYUDAS = `
window.__rellenar = (sel, valor, indice = 0) => {
  const el = document.querySelectorAll(sel)[indice];
  if (!el) throw new Error('no existe ' + sel + '[' + indice + ']');
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, valor);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
window.__pulsar = (texto, sel = 'button') => {
  const b = [...document.querySelectorAll(sel)].find((x) => (x.textContent || '').trim().includes(texto));
  if (!b) throw new Error('no hay «' + texto + '» entre ' + sel);
  if (b.disabled) throw new Error('«' + texto + '» está deshabilitado');
  b.click();
  return true;
};
window.__clases = () => [...document.querySelectorAll('.clases .caja .caja__nombre')].map((t) => t.textContent);
// El lienzo selecciona en 'pointerdown', no en 'click': un click sintético no
// abre el panel de propiedades y la prueba parecería un fallo de la aplicación.
window.__seleccionar = (nombre) => {
  const t = [...document.querySelectorAll('.clases .caja .caja__nombre')].find((x) => x.textContent === nombre);
  if (!t) throw new Error('no hay clase «' + nombre + '» en el lienzo');
  const caja = t.closest('.caja');
  const r = caja.getBoundingClientRect();
  const opciones = { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5, button: 0, pointerId: 1, isPrimary: true };
  caja.dispatchEvent(new PointerEvent('pointerdown', opciones));
  window.dispatchEvent(new PointerEvent('pointerup', opciones));
  return true;
};
// Añade el atributo y lo marca como clave primaria. Los dos pasos son del panel
// de propiedades, que es el único camino de escritura que tiene un usuario.
window.__identificador = (nombre, tipo) => {
  const form = document.querySelector('.panel__seccion form.fila-formulario');
  if (!form) throw new Error('el panel de propiedades no está abierto');
  window.__rellenar('.panel__seccion form.fila-formulario input', nombre);
  window.__rellenar('.panel__seccion form.fila-formulario select', tipo);
  form.querySelector('button[type=submit]').click();
  return true;
};
window.__marcarClave = (nombre) => {
  const fila = [...document.querySelectorAll('.lista__fila--atributo')].find((f) => f.querySelector('.lista__nombre')?.textContent === nombre);
  if (!fila) throw new Error('no aparece el atributo «' + nombre + '»');
  const boton = [...fila.querySelectorAll('.marca')].find((b) => !b.classList.contains('marca--borrar'));
  if (boton.disabled) throw new Error('la llave está deshabilitada para «' + nombre + '»');
  boton.click();
  return true;
};
true;`;

async function ir(nav, ruta) {
  await nav.cliente.enviar('Page.navigate', { url: `${APP}${ruta}` }, nav.sesion);
  await esperar(nav, `document.readyState === 'complete'`, 'carga de la página');
  await evaluar(nav, AYUDAS, false);
}

async function esperar(nav, expresion, descripcion, ms = 20000) {
  const limite = Date.now() + ms;
  for (;;) {
    const valor = await evaluar(
      nav,
      `(() => { try { return !!(${expresion}); } catch (e) { return false; } })()`,
      false,
    );
    if (valor) return;
    if (Date.now() > limite) throw new Error(`[${nav.etiqueta}] agotado esperando: ${descripcion}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function captura(nav, nombre) {
  const { data } = await nav.cliente.enviar(
    'Page.captureScreenshot',
    { format: 'png' },
    nav.sesion,
  );
  const destino = join(salida, `${nombre}.png`);
  writeFileSync(destino, Buffer.from(data, 'base64'));
  return destino;
}

/** Abre una pestaña nueva en el mismo navegador y descarta la anterior. */
async function nuevaPestana(nav) {
  try {
    await nav.cliente.enviar('Target.closeTarget', { targetId: nav.targetId });
  } catch {
    /* ya estaba cerrada */
  }
  const { targetId } = await nav.cliente.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await nav.cliente.enviar('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  nav.targetId = targetId;
  nav.sesion = sessionId;
  await nav.cliente.enviar('Page.enable', {}, sessionId);
  await nav.cliente.enviar('Runtime.enable', {}, sessionId);
}

/*
 * Provocar una caída de verdad, y no simularla.
 *
 * La emulación de red de DevTools no sirve aquí: bloquea las peticiones nuevas
 * pero deja vivo el WebSocket que ya estaba abierto, así que el cliente seguiría
 * creyéndose conectado. Y la aplicación no escucha los eventos `online`/`offline`
 * del navegador a propósito —el único juez de si hay canal es el propio canal—,
 * de modo que la única forma honesta de comprobar el modo sin conexión es apagar
 * el servidor. Eso además deja a los dos clientes divergiendo a la vez, que es el
 * caso que de verdad pone a prueba la fusión.
 */
const RAIZ = process.cwd();
let backend = null;

/*
 * Se mata por puerto y no por pid.
 *
 * Matar por pid parece lo correcto y falla de la peor manera: `npm` lanza a
 * `tsx`, que lanza a node, así que hay que llevarse el árbol (`/T`). Pero además,
 * si alguien dejó un backend suelto de una sesión anterior, `arrancarBackend`
 * no llega a coger el puerto —el hijo muere solo al chocar con el 3001 ocupado—
 * y entonces `pararBackend` mata un proceso que no era el que servía. El síntoma
 * es «el backend no llegó a estar abajo» mientras la aplicación sigue en directo,
 * y culpa al producto de un descuido del banco de pruebas. El puerto es lo que
 * los clientes ven; el puerto es lo que hay que apagar.
 */
function matarPorPuerto(puerto) {
  const guion =
    `Get-NetTCPConnection -LocalPort ${puerto} -State Listen -ErrorAction SilentlyContinue | ` +
    'Select-Object -ExpandProperty OwningProcess -Unique | ' +
    'ForEach-Object { taskkill /pid $_ /T /F }';
  return new Promise((resolver) =>
    exec(`powershell -NoProfile -Command "${guion}"`, () => resolver()),
  );
}

async function arrancarBackend() {
  await matarPorPuerto(3001);
  backend = spawn('npm', ['run', 'dev:backend'], { cwd: RAIZ, shell: true, stdio: 'ignore' });
}

async function pararBackend() {
  const pid = backend?.pid;
  backend = null;
  if (pid) await new Promise((resolver) => exec(`taskkill /pid ${pid} /T /F`, () => resolver()));
  await matarPorPuerto(3001);
}

async function esperarBackend(vivo, ms = 60000) {
  const limite = Date.now() + ms;
  for (;;) {
    let responde = false;
    try {
      const r = await fetch('http://localhost:3001/salud');
      responde = r.ok;
    } catch {
      responde = false;
    }
    if (responde === vivo) return;
    if (Date.now() > limite) {
      throw new Error(`El backend no llegó a estar ${vivo ? 'arriba' : 'abajo'}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function moverRaton(nav, x, y) {
  await nav.cliente.enviar(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 },
    nav.sesion,
  );
}

/* ------------------------------------------------------------------ */
/* El guion                                                            */
/* ------------------------------------------------------------------ */

async function registrar(nav, email, nombre) {
  await ir(nav, '/');
  await esperar(nav, `document.querySelector('.acceso__tarjeta')`, 'pantalla de acceso');
  await evaluar(nav, `__pulsar('Crea una')`, false);
  await esperar(nav, `document.querySelectorAll('.acceso__tarjeta input').length === 3`, 'formulario de registro');
  await evaluar(nav, `__rellenar('.acceso__tarjeta input', ${JSON.stringify(nombre)}, 0)`, false);
  await evaluar(nav, `__rellenar('.acceso__tarjeta input[type=email]', ${JSON.stringify(email)})`, false);
  await evaluar(nav, `__rellenar('.acceso__tarjeta input[type=password]', 'contrasena-larga')`, false);
  await evaluar(nav, `__pulsar('Crear cuenta')`, false);
  await esperar(nav, `document.querySelector('.proyectos')`, 'lista de proyectos');
}

const capturas = [];

async function principal() {
  console.log(`Navegador: ${CHROME}`);
  console.log(`Aplicación: ${APP}`);

  // El guion arranca el backend él mismo porque a media prueba lo tiene que
  // apagar. El frontend se espera ya en marcha (`npm run dev:frontend`).
  await arrancarBackend();
  await esperarBackend(true);
  console.log('Backend en pie.\n');

  const ana = await lanzar('ana', 9222);
  const beto = await lanzar('beto', 9333);

  try {
    /* 1. Beto se registra primero: solo se puede invitar a quien ya tiene cuenta. */
    await registrar(beto, `beto-${SELLO}@ejemplo.com`, 'Beto');
    paso('Beto se registra y ve su lista de proyectos vacía');

    await registrar(ana, `ana-${SELLO}@ejemplo.com`, 'Ana');
    paso('Ana se registra en un navegador independiente');

    /* 2. Ana crea el proyecto. */
    await evaluar(ana, `__pulsar('+ Nuevo proyecto')`, false);
    await esperar(ana, `document.querySelector('.tarjeta--formulario')`, 'formulario de proyecto');
    await evaluar(ana, `__rellenar('.tarjeta--formulario input', 'Tienda en línea', 0)`, false);
    await evaluar(ana, `__rellenar('.tarjeta--formulario input', 'Diagrama de prueba', 1)`, false);
    await evaluar(ana, `__rellenar('.tarjeta--formulario input', 'com.ejemplo.tienda', 2)`, false);
    await evaluar(ana, `__pulsar('Crear y abrir')`, false);
    await esperar(ana, `document.querySelector('.editor')`, 'editor abierto');
    const ruta = await evaluar(ana, `location.pathname`, false);
    const proyectoId = ruta.split('/').pop();
    paso(`Ana crea «Tienda en línea» y el editor se abre en ${ruta}`);

    // «En directo» es el único texto que afirma a la vez conectado y al día:
    // `IndicadorSync` degrada a «Poniéndose al día…» mientras falta el documento.
    await esperar(
      ana,
      `document.querySelector('.indicador--bien')?.textContent.includes('En directo')`,
      'canal colaborativo en directo',
    );
    paso(
      `Ana queda conectada al canal: «${await evaluar(ana, `document.querySelector('.indicador').textContent.trim()`, false)}»`,
    );

    /* 3. Ana invita a Beto como editor. */
    await evaluar(ana, `__pulsar('← Proyectos')`, false);
    await esperar(ana, `document.querySelector('.tarjeta__principal')`, 'vuelta a la lista');
    await evaluar(ana, `__pulsar('Compartir')`, false);
    await esperar(ana, `document.querySelector('.modal__caja')`, 'diálogo de compartir');
    await evaluar(ana, `__rellenar('.modal__caja input[type=email]', ${JSON.stringify(`beto-${SELLO}@ejemplo.com`)})`, false);
    await evaluar(ana, `__rellenar('.modal__caja select', 'editor')`, false);
    await evaluar(ana, `__pulsar('Invitar')`, false);
    await esperar(
      ana,
      `[...document.querySelectorAll('.modal__caja .lista__fila')].some((f) => /Beto/.test(f.textContent))`,
      'Beto en la lista de miembros',
    );
    paso('Ana invita a Beto como editor y aparece entre los miembros');
    await evaluar(ana, `__pulsar('Cerrar')`, false);

    /* 4. Los dos abren el mismo diagrama. */
    await evaluar(ana, `__pulsar('Tienda en línea', '.tarjeta__principal')`, false);
    await esperar(ana, `document.querySelector('.editor')`, 'Ana en el editor');

    await ir(beto, `/proyecto/${proyectoId}`);
    await esperar(beto, `document.querySelector('.editor')`, 'Beto en el editor', 30000);
    await esperar(
      beto,
      `document.querySelector('.indicador--bien')?.textContent.includes('En directo')`,
      'Beto en directo',
    );
    paso('Beto abre el mismo proyecto por su URL en el otro navegador');

    /* 5. La prueba: lo que dibuja Ana aparece en la pantalla de Beto. */
    await evaluar(ana, `__pulsar('+ Clase')`, false);
    await esperar(ana, `__clases().length === 1`, 'la clase aparece en Ana');
    await esperar(beto, `__clases().length === 1`, 'la clase de Ana aparece en Beto', 15000);
    const enBeto = await evaluar(beto, `__clases()`, false);
    paso(`Ana crea una clase y Beto la ve sin recargar: ${JSON.stringify(enBeto)}`);

    /* 6. Y al revés. */
    await evaluar(beto, `__pulsar('+ Clase')`, false);
    await esperar(beto, `__clases().length === 2`, 'la segunda clase en Beto');
    await esperar(ana, `__clases().length === 2`, 'la clase de Beto aparece en Ana', 15000);
    paso(`Beto crea otra y Ana la ve: ${JSON.stringify(await evaluar(ana, `__clases()`, false))}`);

    /* 7. Presencia. */
    await esperar(ana, `document.querySelectorAll('.presentes__ficha').length >= 1`, 'ficha de Beto en Ana');
    await esperar(beto, `document.querySelectorAll('.presentes__ficha').length >= 1`, 'ficha de Ana en Beto');
    const titulo = await evaluar(ana, `document.querySelector('.presentes').title`, false);
    paso(`Cada uno ve al otro en la barra de presencia (Ana ve: «${titulo}»)`);

    /* 8. El cursor de Beto viaja a la pantalla de Ana. */
    const caja = await evaluar(
      beto,
      `(() => { const r = document.querySelector('.lienzo').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
      false,
    );
    for (let i = 0; i < 10; i++) {
      await moverRaton(beto, caja.x + i * 12, caja.y + i * 6);
      await new Promise((r) => setTimeout(r, 80));
    }
    await esperar(ana, `document.querySelectorAll('.cursores g').length >= 1`, 'cursor de Beto en Ana', 15000);
    paso('El cursor de Beto se dibuja en la pantalla de Ana');

    /* 9. El asistente propone, no escribe: hay que aceptar la propuesta. */
    await evaluar(
      ana,
      `__rellenar('.asistente__entrada input', 'crea la clase Pedido con el atributo total de tipo Double')`,
      false,
    );
    await evaluar(ana, `__pulsar('Interpretar')`, false);
    await esperar(ana, `document.querySelector('.asistente__propuesta')`, 'propuesta del asistente');
    const propuesta = await evaluar(
      ana,
      `[...document.querySelectorAll('.asistente__propuesta li')].map((l) => l.textContent)`,
      false,
    );
    const motor = await evaluar(
      ana,
      `document.querySelector('.asistente__origen').textContent`,
      false,
    );
    if (propuesta.length !== 2) {
      throw new Error(`Se esperaban clase y atributo; llegó ${JSON.stringify(propuesta)}`);
    }
    await esperar(beto, `!__clases().includes('Pedido')`, 'la propuesta todavía no se ha aplicado');
    paso(`El asistente propone sin tocar el diagrama — ${motor.trim()} ${JSON.stringify(propuesta)}`);

    await evaluar(ana, `__pulsar('Aplicar')`, false);
    await esperar(beto, `__clases().includes('Pedido')`, 'la clase del asistente llega a Beto', 15000);
    await esperar(
      beto,
      `[...document.querySelectorAll('.caja__miembro')].some((m) => /total/.test(m.textContent))`,
      'el atributo del asistente llega a Beto',
    );
    paso('Ana acepta la propuesta y la clase con su atributo aparece en la pantalla de Beto');

    capturas.push(await captura(ana, 'ana-editando'));
    capturas.push(await captura(beto, 'beto-viendo-lo-mismo'));

    /* 10. Se cae el servidor: se sigue editando y al volver se funde todo. */
    await pararBackend();
    await esperarBackend(false);
    for (const nav of [ana, beto]) {
      await esperar(
        nav,
        `document.querySelector('.indicador--offline')?.textContent.includes('Sin conexión')`,
        `${nav.etiqueta} se entera de que no hay servidor`,
        45000,
      );
    }
    paso('Se apaga el servidor y las dos pantallas lo dicen: «Sin conexión»');

    // Cada uno crea algo distinto, y por el asistente: sin servidor debe caer en
    // la gramática que viaja en el propio paquete (RF-OFF-03).
    for (const [nav, orden, clase] of [
      [ana, 'crea la clase Factura', 'Factura'],
      [beto, 'crea la clase Almacen', 'Almacen'],
    ]) {
      await evaluar(nav, `__rellenar('.asistente__entrada input', ${JSON.stringify(orden)})`, false);
      await evaluar(nav, `__pulsar('Interpretar')`, false);
      await esperar(nav, `document.querySelector('.asistente__propuesta')`, `propuesta de ${nav.etiqueta}`);
      const fuente = await evaluar(nav, `document.querySelector('.asistente__origen').textContent`, false);
      if (!/sin conexión/i.test(fuente)) {
        throw new Error(`${nav.etiqueta} no usó la gramática local: «${fuente.trim()}»`);
      }
      await evaluar(nav, `__pulsar('Aplicar')`, false);
      await esperar(nav, `__clases().includes(${JSON.stringify(clase)})`, `${clase} en ${nav.etiqueta}`);
    }
    paso('Sin servidor, el asistente cae en la gramática local y los dos siguen editando');

    const separados = {
      ana: await evaluar(ana, `__clases().slice().sort()`, false),
      beto: await evaluar(beto, `__clases().slice().sort()`, false),
    };
    if (separados.ana.includes('Almacen') || separados.beto.includes('Factura')) {
      throw new Error('Los cambios viajaron con el servidor apagado; la prueba no vale');
    }
    paso(
      `Divergen de verdad — Ana ${JSON.stringify(separados.ana)}, Beto ${JSON.stringify(separados.beto)}`,
    );

    await arrancarBackend();
    await esperarBackend(true);
    for (const nav of [ana, beto]) {
      await esperar(
        nav,
        `document.querySelector('.indicador--bien')?.textContent.includes('En directo')`,
        `${nav.etiqueta} vuelve a estar en directo`,
        90000,
      );
    }
    await esperar(ana, `__clases().includes('Almacen')`, 'Ana recibe lo de Beto', 45000);
    await esperar(beto, `__clases().includes('Factura')`, 'Beto recibe lo de Ana', 45000);

    const convergido = await evaluar(ana, `__clases().slice().sort()`, false);
    const convergidoBeto = await evaluar(beto, `__clases().slice().sort()`, false);
    if (JSON.stringify(convergido) !== JSON.stringify(convergidoBeto)) {
      throw new Error(
        `No convergen: ${JSON.stringify(convergido)} vs ${JSON.stringify(convergidoBeto)}`,
      );
    }
    if (convergido.length !== 5) {
      throw new Error(`Se perdió o duplicó algo al fundir: ${JSON.stringify(convergido)}`);
    }
    paso(`Vuelve el servidor y las dos pantallas convergen en ${JSON.stringify(convergido)}`);

    // Converger no es lo mismo que verse. Las dos crearon su clase con el mismo
    // recuento delante, así que la rejilla les daba la misma casilla y una
    // quedaba tapada por la otra: el dato estaba, la clase no se veía, y quien
    // la escribió pensaba que se había perdido en la fusión.
    const encimadas = await evaluar(
      ana,
      `(() => {
        const vistas = new Map();
        for (const c of document.querySelectorAll('.clases .caja')) {
          const nombre = c.querySelector('.caja__nombre').textContent;
          const r = c.getBoundingClientRect();
          const sitio = Math.round(r.left) + 'x' + Math.round(r.top);
          if (vistas.has(sitio)) return [vistas.get(sitio), nombre];
          vistas.set(sitio, nombre);
        }
        return null;
      })()`,
      false,
    );
    if (encimadas) {
      throw new Error(`Al fundir, «${encimadas[1]}» quedó justo encima de «${encimadas[0]}»`);
    }
    paso('Ninguna de las dos clases hechas a la vez quedó tapada por la otra');
    capturas.push(await captura(ana, 'ana-tras-reconectar'));

    /* 11. Y desaparece cuando cierra: el defecto de limpieza, en un navegador. */
    await beto.cliente.enviar('Target.closeTarget', { targetId: beto.targetId });
    await esperar(ana, `document.querySelectorAll('.cursores g').length === 0`, 'el cursor de Beto desaparece', 20000);
    await esperar(ana, `document.querySelectorAll('.presentes__ficha').length === 0`, 'la ficha de Beto desaparece', 20000);
    paso('Beto cierra la pestaña y su cursor y su ficha desaparecen de la pantalla de Ana');

    /* 12. Lo escrito sobrevive a recargar: IndexedDB + servidor. */
    await ir(ana, `/proyecto/${proyectoId}`);
    await esperar(ana, `document.querySelector('.editor')`, 'Ana vuelve a entrar', 30000);
    await esperar(ana, `__clases().length === 5`, 'las cinco clases siguen ahí tras recargar');
    paso('Ana recarga y el diagrama entero sigue en su sitio');

    /* 13. Quitar el permiso echa a quien esté dentro (RNF-SEG-04). */
    await nuevaPestana(beto);
    await ir(beto, `/proyecto/${proyectoId}`);
    await esperar(beto, `document.querySelector('.editor')`, 'Beto vuelve a entrar', 30000);
    await esperar(
      beto,
      `document.querySelector('.indicador--bien')?.textContent.includes('En directo')`,
      'Beto en directo otra vez',
    );

    await evaluar(ana, `__pulsar('← Proyectos')`, false);
    await esperar(ana, `document.querySelector('.tarjeta__principal')`, 'lista de proyectos');
    await evaluar(ana, `__pulsar('Compartir')`, false);
    await esperar(ana, `document.querySelector('.modal__caja')`, 'diálogo de compartir');
    // La caja del diálogo aparece antes que sus miembros: la lista llega por una
    // petición aparte. Esperar solo a la caja hacía que la fila de Beto todavía
    // no existiera al ir a pulsar, y el fallo —«undefined»— parecía un selector
    // equivocado cuando era una carrera.
    await esperar(
      ana,
      `[...document.querySelectorAll('.modal__caja .lista__fila')].some((f) => /Beto/.test(f.textContent))`,
      'la ficha de Beto en el diálogo',
    );
    await evaluar(
      ana,
      `(() => { const f = [...document.querySelectorAll('.modal__caja .lista__fila')].find((x) => /Beto/.test(x.textContent)); f.querySelector('.marca--borrar').click(); return true; })()`,
      false,
    );
    await esperar(
      ana,
      `![...document.querySelectorAll('.modal__caja .lista__fila')].some((f) => /Beto/.test(f.textContent))`,
      'Beto fuera de la lista de miembros',
    );
    await esperar(
      beto,
      `document.querySelector('.indicador--error') || /Sin acceso|permiso/i.test(document.body.innerText)`,
      'Beto pierde el acceso con el editor abierto',
      30000,
    );
    const pantallaBeto = await evaluar(
      beto,
      `document.querySelector('.indicador')?.textContent.trim() ?? document.body.innerText.slice(0, 120)`,
      false,
    );
    paso(`Ana le quita el permiso a Beto y su editor abierto reacciona: «${pantallaBeto}»`);
    capturas.push(await captura(beto, 'beto-sin-acceso'));

    /* 14. Generar el proyecto Spring Boot y comprobar que baja un ZIP de verdad. */
    const descargas = mkdtempSync(join(tmpdir(), 'descarga-'));
    await ana.cliente.enviar('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: descargas,
    });
    await evaluar(ana, `__pulsar('Tienda en línea', '.tarjeta__principal')`, false);
    await esperar(ana, `document.querySelector('.editor')`, 'Ana en el editor');

    // Primero se comprueba que negarse a generar se explica. El diagrama que han
    // dibujado entre los dos no tiene ninguna clave primaria, así que la
    // validación bloqueante (RF-GEN-11) tiene que saltar; lo que se mira aquí no
    // es que salte, sino que lo que sale a pantalla se pueda leer. Así se cazó
    // que los errores llegaban como objetos y se pintaban «[object Object]».
    await evaluar(ana, `__pulsar('Generar Spring Boot')`, false);
    await esperar(ana, `document.querySelector('.aviso')`, 'respuesta a «Generar»', 60000);
    const queja = await evaluar(ana, `document.querySelector('.aviso').textContent.trim()`, false);
    if (/\[object/i.test(queja)) {
      throw new Error(`El aviso de validación sale sin traducir: ${queja}`);
    }
    if (!/identificador|clave primaria/i.test(queja)) {
      throw new Error(`El aviso no dice qué falta: ${queja}`);
    }
    paso(`Sin claves primarias no genera, y lo explica: «${queja.slice(0, 100)}…»`);

    // Y ahora se arregla justo lo que pedía, por el mismo camino que usaría una
    // persona: seleccionar la clase, añadir el atributo, marcarlo como clave.
    const nombres = JSON.parse(await evaluar(ana, `JSON.stringify(__clases())`, false));
    for (const clase of nombres) {
      await evaluar(ana, `__seleccionar(${JSON.stringify(clase)})`, false);
      await esperar(
        ana,
        `document.querySelector('.panel__seccion form.fila-formulario')`,
        `el panel de «${clase}»`,
      );
      await evaluar(ana, `__identificador('id', 'Long')`, false);
      await esperar(
        ana,
        `[...document.querySelectorAll('.lista__fila--atributo .lista__nombre')].some((n) => n.textContent === 'id')`,
        `el atributo id de «${clase}»`,
      );
      await evaluar(ana, `__marcarClave('id')`, false);
      await esperar(
        ana,
        `[...document.querySelectorAll('.lista__fila--atributo')].some((f) => f.querySelector('.lista__nombre')?.textContent === 'id' && f.querySelector('.marca--activa'))`,
        `la llave de «${clase}»`,
      );
    }
    paso(`Ana pone clave primaria en las ${nombres.length} clases, que es lo que pedía el aviso`);

    await evaluar(ana, `__pulsar('Generar Spring Boot')`, false);
    await esperar(ana, `/descargado/i.test(document.body.innerText)`, 'aviso de descarga', 60000);

    const limite = Date.now() + 30000;
    let zip = [];
    while (Date.now() < limite) {
      zip = readdirSync(descargas).filter((f) => f.endsWith('.zip'));
      if (zip.length) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!zip.length) throw new Error(`No bajó ningún ZIP a ${descargas}`);
    const bytes = statSync(join(descargas, zip[0])).size;
    paso(`«Generar Spring Boot» descarga ${zip[0]} (${(bytes / 1024).toFixed(0)} kB)`);

    console.log('\nCapturas:');
    for (const c of capturas) console.log(`  ${c}`);

    const problemas = [...ana.consola, ...beto.consola].filter(
      (e) => e.nivel === 'error' || e.nivel === 'excepcion',
    );
    console.log(`\nErrores en consola: ${problemas.length}`);
    for (const p of problemas.slice(0, 20)) console.log(`  [${p.nivel}] ${p.texto}`);

    const avisos = [...ana.consola, ...beto.consola].filter((e) => e.nivel === 'warning');
    if (avisos.length) {
      console.log(`\nAvisos (${avisos.length}):`);
      for (const a of avisos.slice(0, 10)) console.log(`  ${a.texto}`);
    }

    console.log(`\n${pasos.length} comprobaciones superadas en navegadores reales.`);
  } catch (error) {
    console.error(`\nFALLÓ: ${error.message}`);
    for (const nav of [ana, beto]) {
      try {
        console.error(`  captura de ${nav.etiqueta}: ${await captura(nav, `fallo-${nav.etiqueta}`)}`);
        const texto = await evaluar(nav, `document.body.innerText.slice(0, 600)`, false);
        console.error(`  pantalla de ${nav.etiqueta}: ${JSON.stringify(texto)}`);
      } catch {
        /* la pestaña puede estar cerrada */
      }
      for (const e of nav.consola.filter((c) => c.nivel === 'error' || c.nivel === 'excepcion')) {
        console.error(`  [${nav.etiqueta}/${e.nivel}] ${e.texto}`);
      }
    }
    process.exitCode = 1;
  } finally {
    for (const nav of [ana, beto]) {
      nav.cliente.cerrar();
      nav.proceso.kill();
    }
    await pararBackend();
  }
}

await principal();
