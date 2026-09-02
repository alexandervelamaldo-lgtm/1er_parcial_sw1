import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Handlebars from 'handlebars';

/**
 * Motor de plantillas.
 *
 * Handlebars se eligió *precisamente por su falta de lógica* (decisión T6): las
 * decisiones viven en la IR, no aquí. Los ayudantes registrados son de formato,
 * nunca de decisión de modelado.
 *
 * Sobre el escapado: se usa `{{{ }}}` en las plantillas de código. El escapado
 * HTML de Handlebars no aporta nada al generar Java o SQL —corrompería
 * `Set<Pedido>`— y la defensa real contra inyección es la lista blanca de
 * identificadores de `naming.ts`, aplicada en la validación previa (RNF-SEG-06).
 */

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../templates');

const handlebars = Handlebars.create();

handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
handlebars.registerHelper('ne', (a: unknown, b: unknown) => a !== b);
handlebars.registerHelper('or', (...args: unknown[]) => args.slice(0, -1).some(Boolean));
handlebars.registerHelper('and', (...args: unknown[]) => args.slice(0, -1).every(Boolean));
handlebars.registerHelper('not', (a: unknown) => !a);

handlebars.registerHelper('join', (items: unknown, separator: unknown) =>
  Array.isArray(items) ? items.join(typeof separator === 'string' ? separator : ', ') : '',
);

handlebars.registerHelper('upper', (value: unknown) =>
  typeof value === 'string' ? value.toUpperCase() : '',
);

handlebars.registerHelper('lower', (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase() : '',
);

/** Índice base 1, para listas numeradas en comentarios y SQL. */
handlebars.registerHelper('inc', (value: unknown) =>
  typeof value === 'number' ? value + 1 : value,
);

const cache = new Map<string, HandlebarsTemplateDelegate>();

export function loadTemplate(name: string): HandlebarsTemplateDelegate {
  const cached = cache.get(name);
  if (cached) return cached;

  const source = readFileSync(join(TEMPLATES_DIR, name), 'utf8');
  const compiled = handlebars.compile(source, { noEscape: false, strict: false });
  cache.set(name, compiled);
  return compiled;
}

export function render(templateName: string, context: unknown): string {
  const template = loadTemplate(templateName);
  return normalizeOutput(template(context));
}

export function listTemplates(): string[] {
  return readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.hbs'));
}

/**
 * Normaliza el resultado: saltos de línea LF, sin espacios en blanco al final de
 * línea y con una única línea en blanco al final. Sin esto, las plantillas
 * producen diferencias irrelevantes entre ejecuciones y sistemas operativos.
 */
function normalizeOutput(text: string): string {
  return (
    text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}
