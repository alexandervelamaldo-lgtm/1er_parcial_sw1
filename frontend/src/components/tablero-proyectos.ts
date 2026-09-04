import { type OrigenCambio, type ResumenOrigenes, viasDeEntrada } from '@app/shared';
import type { FilaPanel } from '../services/api';

/**
 * Los cálculos del tablero de la pantalla de entrada, sin React y sin DOM.
 *
 * Viven aparte del componente por el mismo motivo que `paneles.ts`,
 * `barra-menu.ts` y `arbol-proyecto.ts`: en este proyecto no hay jsdom
 * instalado, así que lo que se pueda probar sin montar un navegador se prueba
 * sin montarlo. El componente queda reducido a pintar lo que estas funciones
 * devuelven, que es también la forma de que la aritmética no se esconda dentro
 * de un JSX donde nadie la mira.
 */

/**
 * La forma de los datos la fija el cable, en `services/api.ts`. Se reexporta
 * desde aquí para que quien pinta el tablero y quien lo prueba tengan un solo
 * sitio del que importar.
 */
export type { FilaPanel, ResumenProyecto } from '../services/api';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/**
 * Cuándo fue, en palabras.
 *
 * Un ISO 8601 obliga a restar mentalmente para responder a la única pregunta que
 * se le hace a esa columna, que es «¿esto es de esta semana?». Se corta en siete
 * días: más allá, la fecha concreta vuelve a ser más informativa que un «hace 23
 * días» que nadie sabe traducir.
 *
 * El futuro se trata como presente a propósito. El reloj de quien guardó el
 * cambio puede ir adelantado —es el mismo desajuste que `historial.ts` marca
 * como `relojDudoso`— y «dentro de 3 horas» en una lista de cosas ya ocurridas
 * parece un fallo del programa, no del reloj ajeno.
 */
export function haceCuanto(iso: string, ahora: Date): string {
  const momento = Date.parse(iso);
  if (Number.isNaN(momento)) return 'sin fecha';

  const transcurrido = ahora.getTime() - momento;
  if (transcurrido < MINUTO) return 'hace un momento';
  if (transcurrido < HORA) {
    const minutos = Math.floor(transcurrido / MINUTO);
    return `hace ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`;
  }
  if (transcurrido < DIA) {
    const horas = Math.floor(transcurrido / HORA);
    return `hace ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  }
  const dias = Math.floor(transcurrido / DIA);
  if (dias === 1) return 'ayer';
  if (dias < 7) return `hace ${dias} días`;

  return new Date(momento).toLocaleDateString('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export interface TotalesPanel {
  proyectos: number;
  /** De cuántos hay cifras: el resto quedó fuera del tope del servidor. */
  resumidos: number;
  clases: number;
  relaciones: number;
  cambios: number;
  /** Proyectos con al menos un error de validación. */
  conProblemas: number;
  porOrigen: Record<OrigenCambio, number>;
  fechasDudosas: number;
}

/**
 * Suma lo que hay, y dice sobre cuántos proyectos ha sumado.
 *
 * `resumidos` no es un detalle de implementación que se pueda callar: sin él, un
 * usuario con treinta proyectos leería «104 clases» creyendo que están todas,
 * cuando son las de los veinticuatro más recientes. Un total que no dice su
 * alcance es un total equivocado.
 */
export function totales(filas: FilaPanel[]): TotalesPanel {
  const porOrigen = {} as Record<OrigenCambio, number>;
  const acumulado: TotalesPanel = {
    proyectos: filas.length,
    resumidos: 0,
    clases: 0,
    relaciones: 0,
    cambios: 0,
    conProblemas: 0,
    porOrigen,
    fechasDudosas: 0,
  };

  for (const { resumen } of filas) {
    if (!resumen) continue;
    acumulado.resumidos += 1;
    acumulado.clases += resumen.clases;
    acumulado.relaciones += resumen.relaciones;
    acumulado.cambios += resumen.cambios;
    acumulado.fechasDudosas += resumen.fechasDudosas;
    if (resumen.problemas > 0) acumulado.conProblemas += 1;

    for (const [origen, cuantos] of Object.entries(resumen.porOrigen)) {
      porOrigen[origen as OrigenCambio] = (porOrigen[origen as OrigenCambio] ?? 0) + cuantos;
    }
  }

  return acumulado;
}

/** Adapta los totales a la forma que espera `viasDeEntrada` de shared. */
export function comoResumenOrigenes(total: TotalesPanel): ResumenOrigenes {
  return {
    porOrigen: total.porOrigen,
    total: total.cambios,
    fechasDudosas: total.fechasDudosas,
  };
}

/**
 * Los proyectos que hoy no pueden generar backend, del más roto al menos.
 *
 * Es la única lista del panel que pide una acción. Se ordena por número de
 * errores y no por fecha porque aquí la pregunta no es «qué toqué el último»
 * sino «qué me va a costar más arreglar».
 */
export function conProblemas(filas: FilaPanel[]): FilaPanel[] {
  return filas
    .filter((fila) => (fila.resumen?.problemas ?? 0) > 0)
    .sort((a, b) => (b.resumen?.problemas ?? 0) - (a.resumen?.problemas ?? 0));
}

/**
 * Porcentaje redondeado, para el rótulo.
 *
 * Solo para leerlo: la barra se reparte con `flex-grow` sobre los recuentos
 * crudos, así que lo que se ve es exacto aunque estos rótulos no sumen cien por
 * el redondeo. Calcular la anchura con este número sería meter el error de
 * redondeo en el dibujo.
 */
export function porcentaje(parte: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((parte / total) * 100);
}

export interface ContenidoTablero {
  /**
   * Si el tablero se pinta.
   *
   * Es `false` en los dos casos en los que no hay nada que resumir: una cuenta
   * recién creada y una carga que falló por falta de red. Los dos llegan aquí
   * como una lista vacía y los dos merecen la misma respuesta, que es no pintar
   * nada. La alternativa —el tablero con seis ceros— es lo que ve un tribunal en
   * una demostración desde cero, y seis ceros parecen una aplicación que no ha
   * cargado, no una cuenta nueva.
   */
  mostrar: boolean;
  total: TotalesPanel;
  /** Los que no generarían backend, del más roto al menos. */
  rotos: FilaPanel[];
  /** El reparto por vía de entrada, ordenado y sin las vías a cero. */
  vias: ReturnType<typeof viasDeEntrada>;
  /** Las cifras cubren menos proyectos de los que hay: hay que decirlo. */
  parcial: boolean;
}

/**
 * Todo lo que el tablero necesita saber, calculado de una vez.
 *
 * Existe para que los tres estados que hay que comprobar —sin proyectos, sin
 * conexión y con relojes desordenados— se puedan comprobar sin montar un
 * navegador, que en este proyecto no se puede montar. Si la decisión de pintar o
 * no pintar viviera dentro del JSX, sería justamente la parte que ninguna prueba
 * mira, y es la que decide qué se ve en el arranque en frío.
 */
export function contenidoDelTablero(filas: FilaPanel[]): ContenidoTablero {
  const total = totales(filas);
  return {
    mostrar: filas.length > 0,
    total,
    rotos: conProblemas(filas),
    vias: viasDeEntrada(comoResumenOrigenes(total)),
    parcial: total.resumidos < total.proyectos,
  };
}
