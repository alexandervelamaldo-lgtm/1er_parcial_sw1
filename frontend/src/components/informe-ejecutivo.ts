import type { FilaPanel } from '../services/api';
import { totales, type TotalesPanel } from './tablero-proyectos';

/**
 * Los números del informe que se enseña a quien no va a abrir el editor.
 *
 * La lógica vive aparte del componente por el motivo de siempre en este
 * proyecto: un cálculo dentro de un `.tsx` no se puede probar sin montar un
 * navegador, y las pruebas de componente siguen bloqueadas a falta de jsdom.
 * Aquí dentro no hay ni un `import` de React a propósito.
 *
 * Sobre qué NO calcula esto
 * -------------------------
 * La maqueta de la que sale esta pantalla enseñaba, con muy buen aspecto,
 * «Certificado bajo marco TOGAF 10», «Aprobado SOC 2 Type II / ISO 27001» y un
 * `complianceScore` que, cuando el proyecto no traía ninguno, caía a un 95 %
 * escrito a mano. Ninguna de las tres cosas es cierta aquí: nadie ha auditado
 * este sistema y no existe ninguna certificación que enseñar.
 *
 * No se portan. Un informe que se imprime y se entrega es justo el sitio donde
 * una cifra inventada deja de ser una maqueta y pasa a ser una afirmación
 * falsa, y la primera pregunta razonable delante de un «SOC 2 Type II» es quién
 * lo emitió. Todo lo que sale por aquí se deriva de `/api/panel`, que a su vez
 * cuenta lo que hay en los documentos.
 */
export interface InformeEjecutivo {
  /** Cuándo se generó, para que el papel impreso no mienta sobre su fecha. */
  emitido: Date;
  total: TotalesPanel;
  /** Proyectos sin ningún error de validación: los que se pueden generar hoy. */
  listos: number;
  /**
   * Qué parte del total resume de verdad el informe.
   *
   * El servidor solo resume los N proyectos más recientes. Si el informe
   * dijera «104 clases» sobre veinticuatro de treinta proyectos sin decirlo,
   * el número sería sencillamente falso, y encima impreso.
   */
  alcanceCompleto: boolean;
  /** Las filas ordenadas: primero lo que está roto, que es lo que hay que mirar. */
  filas: FilaPanel[];
}

/**
 * Ordena poniendo delante lo que reclama atención.
 *
 * Un informe ordenado alfabéticamente obliga a leérselo entero para encontrar
 * el proyecto con errores. Ordenado así, lo que hay que mirar está arriba y lo
 * que va bien se puede hojear.
 */
export function ordenarPorUrgencia(filas: FilaPanel[]): FilaPanel[] {
  return [...filas].sort((a, b) => {
    const problemasA = a.resumen?.problemas ?? 0;
    const problemasB = b.resumen?.problemas ?? 0;
    if (problemasA !== problemasB) return problemasB - problemasA;

    const avisosA = a.resumen?.avisos ?? 0;
    const avisosB = b.resumen?.avisos ?? 0;
    if (avisosA !== avisosB) return avisosB - avisosA;

    return a.proyecto.name.localeCompare(b.proyecto.name, 'es');
  });
}

export function componerInforme(filas: FilaPanel[], ahora: Date): InformeEjecutivo {
  const total = totales(filas);
  return {
    emitido: ahora,
    total,
    listos: total.resumidos - total.conProblemas,
    alcanceCompleto: total.resumidos === total.proyectos,
    filas: ordenarPorUrgencia(filas),
  };
}

/**
 * Cuántos cambios reparte de verdad la barra de procedencia.
 *
 * No es `total.cambios`. `viasDeEntrada` deja fuera deshacer y rehacer —no son
 * vías por las que entre modelo, son gestión del historial— y también las vías
 * a cero. Si el porcentaje se calculara sobre el total, los tramos sumarían
 * menos de cien sin que nada en el papel explicara adónde fue el resto.
 *
 * En pantalla eso se perdona, porque el tablero está al lado y se puede
 * preguntar. Impreso no: el lector solo tiene los números. Así que aquí el
 * denominador es lo que la barra reparte, y el rótulo de la sección dice
 * «entró el modelo» y no «cambios».
 */
export function cambiosDeModelo(vias: { cambios: number }[]): number {
  return vias.reduce((suma, via) => suma + via.cambios, 0);
}

/**
 * La fecha tal y como se imprime.
 *
 * Explícita y en español, no `toLocaleDateString()` a secas: el informe se
 * imprime y se entrega, y el papel no lleva encima la configuración regional
 * del navegador que lo generó. Un «03/04/2026» impreso no dice si es marzo o
 * abril.
 */
export function fechaLarga(fecha: Date): string {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const hora = String(fecha.getHours()).padStart(2, '0');
  const minuto = String(fecha.getMinutes()).padStart(2, '0');
  return `${fecha.getDate()} de ${meses[fecha.getMonth()]} de ${fecha.getFullYear()}, ${hora}:${minuto}`;
}

/**
 * El estado de un proyecto en una palabra, derivado y no almacenado.
 *
 * Son los tres estados que el sistema sabe distinguir de verdad, porque salen
 * de la validación que ya corre antes de generar. La maqueta ofrecía además
 * «Producción» y «Certificado»: eso no lo puede saber esta herramienta, que no
 * despliega nada ni conoce ningún proceso de certificación.
 */
export type EstadoProyecto = 'sin-datos' | 'con-errores' | 'con-avisos' | 'listo';

export function estadoDe(fila: FilaPanel): EstadoProyecto {
  if (!fila.resumen) return 'sin-datos';
  if (fila.resumen.problemas > 0) return 'con-errores';
  if (fila.resumen.avisos > 0) return 'con-avisos';
  return 'listo';
}

export const ROTULO_ESTADO: Record<EstadoProyecto, string> = {
  'sin-datos': 'Sin resumir',
  'con-errores': 'No se puede generar',
  'con-avisos': 'Genera con avisos',
  listo: 'Listo para generar',
};
