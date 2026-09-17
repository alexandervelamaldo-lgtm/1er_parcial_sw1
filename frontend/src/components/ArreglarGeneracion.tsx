import { useMemo, useState } from 'react';
import {
  planificarReparacion,
  type Aplicar,
  type ClassDiagram,
  type ValidationResult,
} from '@app/shared';
import { Icono } from './iconos';

/**
 * Lo que impide generar, y el botón que lo arregla.
 *
 * Es la pantalla que aparece al pulsar «Generar proyecto Spring Boot» cuando el
 * diagrama todavía no se puede convertir en código. Antes de existir, ese caso
 * terminaba en una línea roja del servidor —«El diagrama no es válido: …»— con
 * los seis motivos concatenados por punto y coma, sin decir en qué clase estaba
 * cada uno ni qué había que escribir en su lugar.
 *
 * ## Por qué hay un botón y no solo una lista
 *
 * Un diagrama que se dibuja aquí llega con uno o dos errores y se corrigen en
 * el panel de propiedades. Uno que llega de una foto de pizarra ajena llega con
 * diez, todos mecánicos: una clave primaria que es una fecha, tres columnas
 * llamadas `name`, `type` y `order`, un tipo que el modelo leyó como `Money`.
 * Ninguno admite más de una solución sensata, y hacerlos a mano es teclear
 * durante diez minutos lo que el programa ya sabe. En una defensa con cinco
 * minutos de reloj, esos diez minutos son el examen entero.
 *
 * ## Por qué la lista va delante y el botón detrás
 *
 * Porque el plan reescribe el diagrama de otra persona. `model/naming.ts` lo
 * dice de la única forma que importa —un nombre escrito por alguien que sabe
 * que es un identificador no se corrige a su espalda, se le dice— y aquí se le
 * dice: cada cambio sale con su título, su porqué y el código de la regla que
 * lo pide, antes de tocar nada. Quien pulsa ya ha leído lo que va a pasar.
 *
 * Y lo que el plan no sabe arreglar se enseña igual, aparte y sin botón: una
 * enumeración vacía, dos clases con el mismo nombre, una herencia múltiple.
 * Elegir por su cuenta en esos casos cambiaría el significado del diagrama.
 * Fingir que el botón lo deja todo listo sería peor que no tenerlo, porque la
 * siguiente pantalla volvería a fallar sin explicar por qué.
 *
 * ## Deshacer
 *
 * El plan entero va en una sola llamada a `aplicar`, así que Yjs lo apila como
 * un único elemento deshacible: si el resultado no convence, Ctrl+Z lo devuelve
 * todo de golpe. Aplicarlo cambio a cambio habría dejado once pasos de deshacer
 * para una acción que quien la pulsó vivió como una.
 *
 * ## Sin red
 *
 * `validateDiagram` y `planificarReparacion` son funciones puras de `shared`.
 * Ni modelo de lenguaje ni servidor: el botón contesta en el acto y funciona
 * con el portátil desconectado, que es el motivo por el que la validación se
 * mudó de `generator` a `shared`.
 */

interface Props {
  diagrama: ClassDiagram;
  /** Ya calculada por quien nos pinta: no hace falta validar dos veces. */
  validacion: ValidationResult;
  aplicar: Aplicar;
  soloLectura: boolean;
}

/** «6 errores», «1 error». La concordancia se escribe una vez. */
function errores(n: number): string {
  return `${String(n)} error${n === 1 ? '' : 'es'}`;
}

/**
 * La frase del resumen, que cuenta **cambios** y no errores.
 *
 * La primera versión decía «9 errores impiden generar el backend. 14 se pueden
 * arreglar sin decidir nada», y ese «14» no tenía antecedente posible: el único
 * número en la frase eran los 9 errores, así que se leía como «14 de los 9».
 *
 * El 14 es correcto. `planificarReparacion` planifica por rondas, y quitar la
 * marca de clave primaria a `Order.date` *crea* el arreglo «añadir orderId»:
 * un error puede costar dos cambios, de modo que los cambios superan a los
 * errores con normalidad. Lo que estaba mal era llamarlos «errores» a los dos.
 *
 * Contando cambios la aritmética desaparece —14 cambios para 9 errores no
 * sorprende a nadie— y de paso la frase dice lo que de verdad importa antes de
 * pulsar: cuántas modificaciones va a recibir el diagrama.
 */
function cambios(n: number): string {
  return `${String(n)} cambio${n === 1 ? '' : 's'}`;
}

export function ArreglarGeneracion({ diagrama, validacion, aplicar, soloLectura }: Props) {
  const plan = useMemo(() => planificarReparacion(diagrama), [diagrama]);
  const [fallo, setFallo] = useState<string | null>(null);

  const arreglar = (): void => {
    const resultado = aplicar(plan.operaciones);
    // No hay estado de éxito que enseñar: al aplicarse, el diagrama cambia, el
    // `useMemo` de arriba se recalcula y esta pantalla deja sitio a la vista
    // previa del proyecto. Un «listo» que se pinta justo antes de desaparecer
    // no lo lee nadie.
    setFallo(resultado.ok ? null : resultado.error);
  };

  const total = validacion.errors.length;
  const quedan = plan.irreparables.length;

  return (
    <div className="arreglo">
      <div className="arreglo__resumen">
        <p className="arreglo__frase">
          <Icono nombre="alerta" /> {errores(total)}
          {total === 1 ? ' impide' : ' impiden'} generar el backend.
          {plan.arreglos.length > 0 &&
            ` ${cambios(plan.arreglos.length)} ${
              plan.arreglos.length === 1 ? 'automático los' : 'automáticos los'
            } ${
              /*
                Con irreparables por medio no se puede prometer «todos»: la
                lista de abajo seguirá teniendo errores después de pulsar, y
                una frase que diga lo contrario convierte el botón en un
                embuste a los diez segundos.
              */
              quedan === 0 ? 'arreglan todos' : 'arreglan en parte'
            }.`}
        </p>

        {plan.arreglos.length > 0 && (
          <button
            type="button"
            className="boton boton--primario"
            disabled={soloLectura}
            onClick={arreglar}
          >
            {/*
              «Aplicar los 14 cambios» y no «Arreglar los 14»: lo segundo deja
              el número sin sustantivo justo al lado de un recuento de errores
              distinto, que es de donde venía la confusión.
            */}
            Aplicar{' '}
            {plan.arreglos.length === 1 ? 'el cambio' : `los ${String(plan.arreglos.length)} cambios`}
          </button>
        )}
      </div>

      {soloLectura && (
        <p className="arreglo__nota">
          El permiso sobre este proyecto es de solo lectura, así que los cambios los tiene que
          aplicar quien pueda editarlo. La lista se ve igual.
        </p>
      )}

      {fallo !== null && <p className="panel__error">{fallo}</p>}

      {plan.arreglos.length > 0 && (
        <>
          <h3 className="arreglo__titulo-seccion">
            Lo que se va a cambiar
            {/*
              El recuento va aquí y no solo en el botón: la lista tiene scroll,
              y quien la recorre necesita saber cuántos quedan por leer sin
              volver arriba.
            */}
            <span className="arreglo__cuenta">{plan.arreglos.length}</span>
          </h3>

          <ul className="arreglo__lista">
            {plan.arreglos.map((arreglo, indice) => (
              <li
                // Dos arreglos del mismo código sobre la misma clase son dos
                // atributos distintos; el plan es determinista, así que la
                // posición identifica.
                key={`${arreglo.codigo}-${arreglo.classId ?? ''}-${indice}`}
                className="arreglo__fila"
              >
                <span className="arreglo__marca" aria-hidden="true">
                  {indice + 1}
                </span>
                <div className="arreglo__cuerpo">
                  <p className="arreglo__que">{arreglo.titulo}</p>
                  <p className="arreglo__porque">{arreglo.detalle}</p>
                  <code className="arreglo__codigo">{arreglo.codigo}</code>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {quedan > 0 && (
        <>
          <h3 className="arreglo__titulo-seccion">
            {/*
              La sección de abajo no es «lo que falla», es «lo que hay que
              decidir». La diferencia importa: son problemas de modelado con
              varias salidas posibles, y el programa no tiene criterio para
              elegir una.
            */}
            {quedan === 1 ? 'Y esto hay que decidirlo' : 'Y esto hay que decidirlo a mano'}
            <span className="arreglo__cuenta">{quedan}</span>
          </h3>

          <ul className="arreglo__lista arreglo__lista--manual">
            {plan.irreparables.map((issue, indice) => (
              <li key={`${issue.code}-${issue.elementId ?? ''}-${indice}`} className="arreglo__fila">
                <span className="arreglo__marca arreglo__marca--manual" aria-hidden="true">
                  <Icono nombre="alerta" />
                </span>
                <div className="arreglo__cuerpo">
                  <p className="arreglo__que">{issue.message}</p>
                  <code className="arreglo__codigo">{issue.code}</code>
                </div>
              </li>
            ))}
          </ul>

          <p className="arreglo__nota">
            Estos no tienen un arreglo único: elegir uno cambiaría lo que el diagrama significa.
            Se corrigen en el panel de propiedades y la generación vuelve a intentarse desde aquí.
          </p>
        </>
      )}

      {plan.arreglos.length === 0 && quedan === 0 && (
        <p className="arreglo__nota">
          La validación no encuentra nada que arreglar. Si la generación sigue sin salir, el
          motivo está en el servidor y no en el diagrama.
        </p>
      )}
    </div>
  );
}
