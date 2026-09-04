import { escaparXml } from './xml.js';

/**
 * Constructor de XML por líneas.
 *
 * Estaba dentro de `export.ts`, que era su único usuario. Ahora hay dos —el
 * exportador de diagramas de clases y el de diagramas de comunicación para
 * Enterprise Architect— y la alternativa a sacarlo era copiarlo, que es como
 * empiezan las dos versiones que se separan sin que nadie se entere.
 *
 * No valida nada. No sabe qué es UML ni qué etiquetas existen: solo sangra,
 * escapa los atributos y deja fuera los que valen `undefined`, que es lo que
 * permite escribir `{ name: quizasIndefinido }` sin un condicional en cada
 * llamada.
 */
export class Xml {
  private readonly lineas: string[] = [];
  private nivel = 0;

  abrir(etiqueta: string, atributos: Record<string, string | undefined> = {}): void {
    this.lineas.push(`${this.sangria()}<${etiqueta}${this.atributos(atributos)}>`);
    this.nivel++;
  }

  cerrar(etiqueta: string): void {
    this.nivel--;
    this.lineas.push(`${this.sangria()}</${etiqueta}>`);
  }

  vacio(etiqueta: string, atributos: Record<string, string | undefined> = {}): void {
    this.lineas.push(`${this.sangria()}<${etiqueta}${this.atributos(atributos)}/>`);
  }

  crudo(linea: string): void {
    this.lineas.push(linea);
  }

  texto(): string {
    return this.lineas.join('\n') + '\n';
  }

  private sangria(): string {
    return '  '.repeat(this.nivel);
  }

  private atributos(atributos: Record<string, string | undefined>): string {
    return Object.entries(atributos)
      .filter((par): par is [string, string] => par[1] !== undefined)
      .map(([clave, valor]) => ` ${clave}="${escaparXml(valor)}"`)
      .join('');
  }
}
