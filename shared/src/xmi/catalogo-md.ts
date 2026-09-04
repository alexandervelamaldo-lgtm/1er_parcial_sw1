import {
  enlacesDe,
  operacionesPorClase,
  type CasoDeUso,
  type ModeloDeCasosDeUso,
} from './analisis.js';

/**
 * El catálogo de casos de uso, escrito como documento.
 *
 * ## Por qué se genera en vez de escribirse
 *
 * El documento y los diagramas cuentan lo mismo. Escribirlos por separado es
 * mantener dos copias de una verdad, y la que se queda vieja es siempre el
 * documento, porque los diagramas se miran en la defensa y el documento no. Aquí
 * los dos salen de `casos-de-uso.ts`: si un paso cambia, cambian los dos.
 *
 * El precio es que el fichero de salida no se edita a mano —lo que se escriba
 * encima se pierde en la siguiente ejecución— y por eso lo primero que dice es
 * de dónde viene y qué orden hay que ejecutar para cambiarlo.
 *
 * ## Y por qué acaba en `docs/`
 *
 * Porque `docs/*.md` es el corpus de la guía: el asistente responde con lo que
 * ahí ponga, tanto en el servidor como en el navegador, y no hay que registrar
 * nada. Un caso de uso descrito aquí es una pregunta que el asistente sabe
 * contestar citando su fuente.
 */

function tabla(filas: readonly (readonly string[])[]): string {
  if (filas.length === 0) return '';
  const [cabecera, ...cuerpo] = filas;
  const linea = (celdas: readonly string[]): string => `| ${celdas.join(' | ')} |`;
  return [
    linea(cabecera!),
    linea(cabecera!.map(() => '---')),
    ...cuerpo.map((f) => linea(f)),
  ].join('\n');
}

function seccionDeCaso(caso: CasoDeUso): string {
  const partes: string[] = [];

  partes.push(`## ${caso.id} — ${caso.nombre}`);
  partes.push('');
  partes.push(caso.descripcion);
  partes.push('');

  const actores = [caso.actor, ...(caso.otrosActores ?? [])].join(', ');
  partes.push(
    tabla([
      ['Ficha', ''],
      ['**Paquete**', caso.paquete],
      ['**Actores**', actores],
      ['**Precondición**', caso.precondicion],
      ['**Postcondición**', caso.postcondicion],
    ]),
  );
  partes.push('');

  partes.push('### Participantes');
  partes.push('');
  partes.push(
    tabla([
      ['Objeto', 'Clase de análisis', 'Estereotipo', 'De dónde sale'],
      ...caso.participantes.map((p) => [
        `\`${p.alias}\``,
        p.clase,
        p.estereotipo === 'actor' ? 'actor' : `«${p.estereotipo}»`,
        p.origen === undefined ? '—' : `\`${p.origen}\``,
      ]),
    ]),
  );
  partes.push('');

  partes.push('### Flujo principal');
  partes.push('');
  partes.push(
    tabla([
      ['#', 'De', 'A', 'Mensaje'],
      ...caso.pasos.map((p) => [
        p.numero,
        `\`${p.de}\``,
        `\`${p.a}\``,
        p.retorno === true ? `*${p.mensaje}* (retorno)` : `\`${p.mensaje}\``,
      ]),
    ]),
  );
  partes.push('');

  partes.push('### Flujos alternativos');
  partes.push('');
  for (const alternativo of caso.alternativos) {
    partes.push(`- **${alternativo.nombre}.** ${alternativo.texto}`);
  }
  partes.push('');

  partes.push('### Operaciones que salen del análisis');
  partes.push('');
  const operaciones = operacionesPorClase(caso);
  for (const participante of caso.participantes) {
    if (participante.estereotipo === 'actor') continue;
    const suyas = operaciones.get(participante.clase) ?? [];
    const firma =
      suyas.length === 0
        ? '*ninguna: solo envía*'
        : suyas.map((o) => `\`${o.nombre}(${o.argumentos.join(', ')})\``).join(', ');
    partes.push(`- **${participante.clase}**: ${firma}`);
  }
  partes.push('');

  partes.push('### Actividad');
  partes.push('');
  const calles = [...new Set(caso.actividad.nodos.map((n) => n.calle))];
  partes.push(`Calles: ${calles.map((c) => `**${c}**`).join(' · ')}.`);
  partes.push('');
  for (const flujo of caso.actividad.flujos) {
    const de = caso.actividad.nodos.find((n) => n.id === flujo.de);
    const a = caso.actividad.nodos.find((n) => n.id === flujo.a);
    const rotulo = (nodo: (typeof caso.actividad.nodos)[number] | undefined): string => {
      if (nodo === undefined) return '?';
      if (nodo.tipo === 'inicio') return '(inicio)';
      if (nodo.tipo === 'fin') return '(fin)';
      const texto = nodo.texto ?? nodo.id;
      // Un rombo escrito en llano se lee como una acción más. Los signos de
      // interrogación son lo único que distingue «El código sigue vigente» de
      // «Guardar la contraseña» cuando el diagrama se cuenta con flechas.
      return nodo.tipo === 'decision' ? `¿${texto}?` : texto;
    };
    const guarda = flujo.guarda === undefined ? '' : ` **[${flujo.guarda}]**`;
    partes.push(`- ${rotulo(de)} →${guarda} ${rotulo(a)}`);
  }
  partes.push('');

  partes.push(
    `Enlaces del diagrama de comunicación: ${enlacesDe(caso).length} ` +
      `entre ${caso.participantes.length} objetos.`,
  );
  partes.push('');

  return partes.join('\n');
}

/** El documento entero, listo para escribir en `docs/`. */
export function documentarCasosDeUso(modelo: ModeloDeCasosDeUso): string {
  const partes: string[] = [];

  partes.push(`# Casos de uso de ${modelo.sistema}`);
  partes.push('');
  partes.push(
    '> Este documento **se genera**. Sale de `shared/src/xmi/casos-de-uso.ts`, que es también\n' +
      '> de donde salen los `.xmi` de `docs/uml/`. Para cambiar algo se cambia allí y se ejecuta\n' +
      '> `npm run diagramas --workspace @app/backend-tool`; lo que se escriba aquí a mano se\n' +
      '> pierde en la siguiente ejecución.',
  );
  partes.push('');
  partes.push(
    'Cada caso de uso se describe una sola vez. De esa descripción salen el diagrama de\n' +
      'comunicación, el de secuencia, el de actividad y el de análisis de clases, que son la\n' +
      'misma información contada de cuatro maneras. Mantenerlos a mano es mantener cuatro\n' +
      'copias que se desincronizan, y el sitio donde se nota es la defensa.',
  );
  partes.push('');

  partes.push('## Actores');
  partes.push('');
  partes.push(
    tabla([
      ['Actor', 'Hereda de', 'Qué es'],
      ...modelo.actores.map((a) => [a.nombre, a.hereda ?? '—', a.descripcion]),
    ]),
  );
  partes.push('');

  partes.push('## Paquetes');
  partes.push('');
  partes.push(
    tabla([
      ['Paquete', 'Qué agrupa', 'Casos'],
      ...modelo.paquetes.map((p) => [
        p.nombre,
        p.descripcion,
        modelo.casos
          .filter((c) => c.paquete === p.nombre)
          .map((c) => c.id)
          .join(', '),
      ]),
    ]),
  );
  partes.push('');

  partes.push('## Resumen');
  partes.push('');
  partes.push(
    tabla([
      ['Caso', 'Nombre', 'Actor', 'Paquete'],
      ...modelo.casos.map((c) => [c.id, c.nombre, c.actor, c.paquete]),
    ]),
  );
  partes.push('');

  for (const caso of modelo.casos) {
    partes.push(seccionDeCaso(caso));
  }

  return `${partes.join('\n').trimEnd()}\n`;
}
