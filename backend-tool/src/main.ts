import { createServer } from 'node:http';
import { cargarEnv, loadConfig } from './config.js';
import { createApp, createDependencies } from './app.js';

/**
 * Arranque del servicio.
 *
 * El apagado ordenado no es un adorno: los documentos colaborativos se guardan
 * en disco de forma diferida, así que terminar el proceso sin vaciar esa cola
 * pierde los últimos segundos de trabajo de todos los conectados.
 */

async function main(): Promise<void> {
  // Se lee el `.env` solo aquí, en el arranque real. Las pruebas construyen la
  // configuración a mano, y deben seguir sin tocar la red aunque exista un
  // fichero con credenciales en el disco de quien las ejecuta.
  cargarEnv();
  const config = loadConfig();

  if (config.sessionSecretIsGenerated) {
    console.warn(
      'AVISO: SESSION_SECRET no está definido. Se ha generado uno y guardado en ' +
        `${config.dataDir}/secreto-de-sesion, de modo que las sesiones sobreviven al reinicio. ` +
        'En producción debe venir del entorno: con varias instancias, cada una tendría el suyo ' +
        'y rechazaría los tokens emitidos por las demás.',
    );
  }

  const deps = await createDependencies(config);
  const { app, collab } = createApp(deps);

  console.log(`Asistente: ${deps.assistant.name}`);
  // Se nombra la variable que falta de verdad, no la lista de candidatas. Desde
  // que texto y visión pueden ir a proveedores distintos, decir «falta
  // LLM_API_KEY» cuando esa sí está y la que falta es LLM_VISION_API_KEY manda a
  // buscar el problema donde no está.
  console.log(
    deps.vision
      ? `Lectura de diagramas fotografiados: ${config.llmVisionModel}`
      : `Lectura de diagramas fotografiados: desactivada (falta ${
          !config.llmVisionModel ? 'LLM_VISION_MODEL' : 'LLM_VISION_API_KEY'
        })`,
  );

  const server = createServer(app);
  collab.attach(server);

  server.listen(config.port, config.host, () => {
    console.log(`Servicio escuchando en http://${config.host}:${config.port}`);
    console.log(`Canal colaborativo en ws://${config.host}:${config.port}/colaboracion`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    // Una segunda señal durante el apagado suele ser impaciencia; atenderla
    // interrumpiría justo el volcado que se está esperando.
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\nRecibido ${signal}, cerrando…`);
    server.close();
    await collab.close();
    await deps.rooms.shutdown();
    console.log('Documentos guardados. Adiós.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('No se pudo arrancar el servicio:', error);
  process.exit(1);
});
