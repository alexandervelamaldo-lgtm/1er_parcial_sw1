/**
 * Vuelca el catálogo de casos de uso a JSON para el documento del parcial.
 *
 * Existe para que el .docx no se escriba a mano. El catálogo ya está en
 * `shared/src/xmi/casos-de-uso.ts` y de ahí salen los `.xmi` y el documento 8;
 * transcribir los mismos 19 casos a Word sería la cuarta copia, y la que se
 * quedaría vieja. El script de Python lee este JSON.
 *
 * El «flujo de sucesos» se arma con los pasos de ida. Los de retorno se dejan
 * fuera a propósito: en la plantilla del parcial esa celda es la narración de
 * lo que hace el usuario y el sistema, y las devoluciones son ruido — ya se
 * ven en el diagrama de comunicación, que es su sitio.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { modeloDeCasosDeUso } from '@app/shared';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** El actor iniciador es el del caso; los demás participan pero no arrancan. */
function actores(caso: (typeof modeloDeCasosDeUso.casos)[number]): string {
  const otros = caso.otrosActores ?? [];
  return [caso.actor, ...otros].join(', ');
}

/**
 * Los pasos de ida, numerados, en prosa.
 *
 * Se usa el alias del participante y no la clase de análisis porque en la
 * ficha del parcial se lee como narración, y `pantalla` dice más que
 * `PantallaAcceso` a quien no ha visto el diagrama todavía.
 */
function flujo(caso: (typeof modeloDeCasosDeUso.casos)[number]): string[] {
  return caso.pasos
    .filter((p) => !p.retorno)
    .map((p) => `${p.numero}. ${p.de} → ${p.a}: ${p.mensaje}`);
}

const salida = {
  sistema: modeloDeCasosDeUso.sistema,
  actores: modeloDeCasosDeUso.actores,
  paquetes: modeloDeCasosDeUso.paquetes.map((p) => ({
    ...p,
    casos: modeloDeCasosDeUso.casos.filter((c) => c.paquete === p.nombre).map((c) => c.id),
  })),
  casos: modeloDeCasosDeUso.casos.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    paquete: c.paquete,
    actor: c.actor,
    actores: actores(c),
    descripcion: c.descripcion,
    precondicion: c.precondicion,
    postcondicion: c.postcondicion,
    flujo: flujo(c),
    alternativos: c.alternativos.map((a) => ({ nombre: a.nombre, texto: a.texto })),
    participantes: c.participantes.map((p) => ({
      alias: p.alias,
      clase: p.clase,
      estereotipo: p.estereotipo,
      origen: p.origen ?? null,
    })),
    actividad: c.actividad,
  })),
};

const destino = join(raiz, 'docs', 'casos-de-uso.json');
writeFileSync(destino, JSON.stringify(salida, null, 2), 'utf8');
console.log(`docs/casos-de-uso.json  (${salida.casos.length} casos, ${salida.actores.length} actores)`);
