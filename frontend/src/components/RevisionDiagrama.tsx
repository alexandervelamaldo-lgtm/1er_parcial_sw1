import { useMemo } from 'react';
import {
  resumirRevision,
  revisarDiagrama,
  type ClassDiagram,
  type GravedadRevision,
  type Hallazgo,
} from '@app/shared';
import { Icono, type NombreIcono } from './iconos';

/**
 * La revisión del diagrama: qué está mal modelado, dicho con el motivo delante.
 *
 * Es la pantalla que contesta a «el profesor dice que hay dos errores y no sé
 * cuáles son». Hasta ahora la herramienta solo sabía contestar a una pregunta
 * distinta —«¿se puede generar el backend a partir de esto?»— y esa se responde
 * al pulsar «Generar». Un diagrama puede pasar la validación entera y seguir
 * teniendo una clase llamada `SistemaDeGestion`, un importe guardado como texto
 * y una subclase que vuelve a declarar los atributos de su padre. Eso compila. Y
 * eso es lo que se corrige en un examen.
 *
 * ## Por qué cada hallazgo lleva su porqué
 *
 * La tentación era una lista de etiquetas rojas. No sirve: quien tiene que
 * arreglar el diagrama necesita decidir si el aviso aplica a su caso, y para eso
 * hace falta el razonamiento, no el veredicto. Un «composición compartida» a
 * secas se arregla borrando la línea que sea; con el motivo delante se arregla
 * la que corresponde.
 *
 * Por lo mismo la nota del pie dice que esto señala candidatos y no sentencias.
 * Sería fácil escribir «tu diagrama tiene 3 errores» y quedaría más
 * contundente, pero el criterio de quien corrige no está dentro del programa, y
 * prometer lo contrario acabaría en una entrega con los avisos «arreglados» y
 * los errores de verdad intactos.
 *
 * ## Sin red
 *
 * `revisarDiagrama` es una función pura de `shared`: no llama a ningún modelo ni
 * a ningún servidor. Se ejecuta con el portátil desconectado y en el acto,
 * dentro de un `useMemo` sobre el diagrama, así que el resultado se actualiza
 * solo al arreglar algo sin que haya nada que volver a pulsar.
 */

interface Props {
  diagrama: ClassDiagram;
  /** Selecciona la clase señalada y cierra, para poder arreglarla. */
  onIrA: (classId: string) => void;
  onCerrar: () => void;
}

const ROTULO: Record<GravedadRevision, string> = {
  error: 'Error',
  aviso: 'Aviso',
  sugerencia: 'Sugerencia',
};

const ICONO: Record<GravedadRevision, NombreIcono> = {
  error: 'alerta',
  aviso: 'alerta',
  sugerencia: 'revisar',
};

/** El resumen en una frase, en vez de tres cifras sueltas que hay que sumar. */
function fraseResumen(cuenta: Record<GravedadRevision, number>): string {
  const partes: string[] = [];
  if (cuenta.error > 0) partes.push(`${cuenta.error} error${cuenta.error === 1 ? '' : 'es'}`);
  if (cuenta.aviso > 0) partes.push(`${cuenta.aviso} aviso${cuenta.aviso === 1 ? '' : 's'}`);
  if (cuenta.sugerencia > 0) {
    partes.push(`${cuenta.sugerencia} sugerencia${cuenta.sugerencia === 1 ? '' : 's'}`);
  }
  if (partes.length === 0) return 'Sin hallazgos.';
  if (partes.length === 1) return `${partes[0]}.`;
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}.`;
}

function Fila({ hallazgo, diagrama, onIrA }: { hallazgo: Hallazgo } & Omit<Props, 'onCerrar'>) {
  const clase = hallazgo.classId ? diagrama.classes[hallazgo.classId] : undefined;

  return (
    <li className={`revision__hallazgo revision__hallazgo--${hallazgo.gravedad}`}>
      <span className="revision__gravedad" title={ROTULO[hallazgo.gravedad]}>
        <Icono nombre={ICONO[hallazgo.gravedad]} />
        <span className="revision__gravedad-texto">{ROTULO[hallazgo.gravedad]}</span>
      </span>

      <div className="revision__cuerpo">
        <p className="revision__titulo">{hallazgo.titulo}</p>
        <p className="revision__detalle">{hallazgo.detalle}</p>
        {/*
          El código no es decoración: es lo que permite buscar la regla en
          `shared/src/revision/revision.ts` y ver por qué se ha disparado. Sin
          él, discutir un aviso obliga a adivinar cuál de las nueve reglas fue.
        */}
        <code className="revision__codigo">{hallazgo.codigo}</code>
      </div>

      {clase !== undefined && (
        <button
          type="button"
          className="boton boton--discreto revision__ir"
          onClick={() => onIrA(clase.id)}
        >
          Ir a «{clase.name}»
        </button>
      )}
    </li>
  );
}

export function RevisionDiagrama({ diagrama, onIrA, onCerrar }: Props) {
  const hallazgos = useMemo(() => revisarDiagrama(diagrama), [diagrama]);
  const cuenta = useMemo(() => resumirRevision(hallazgos), [hallazgos]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Revisión del diagrama">
      <div className="modal__caja revision">
        <header className="revision__cabecera">
          <div>
            <h2>Revisión del diagrama</h2>
            <p className="revision__resumen">{fraseResumen(cuenta)}</p>
          </div>
          <button
            type="button"
            className="boton boton--icono"
            aria-label="Cerrar"
            onClick={onCerrar}
          >
            <Icono nombre="cerrar" />
          </button>
        </header>

        {hallazgos.length === 0 ? (
          <div className="revision__limpio">
            <p>
              <Icono nombre="comprobado" /> No se ha encontrado ningún problema de modelado.
            </p>
          </div>
        ) : (
          <ul className="revision__lista">
            {hallazgos.map((hallazgo, indice) => (
              <Fila
                // El hallazgo no tiene identidad propia: dos avisos del mismo
                // código sobre la misma clase son dos atributos distintos. La
                // posición basta porque la lista es determinista.
                key={`${hallazgo.codigo}-${hallazgo.classId ?? ''}-${indice}`}
                hallazgo={hallazgo}
                diagrama={diagrama}
                onIrA={onIrA}
              />
            ))}
          </ul>
        )}

        {/*
          El pie cambia con el resultado, y no por adorno.

          Con hallazgos delante hace falta decir que son candidatos: son
          frases que acusan a una clase concreta, y quien las lee tiene que
          saber que puede descartarlas. Sin hallazgos esa advertencia no
          advierte de nada —no hay nada que descartar— y lo único que queda
          por decir es que el silencio no es un aprobado.

          Antes estaban las dos a la vez, más un párrafo que repetía lo del
          pie con otras palabras: cuatro avisos para comunicar que no pasa
          nada. Una pantalla que pide leer más cuanto menos tiene que contar
          acaba sin leerse, y ese es el día en que un aviso de verdad pasa
          desapercibido.
        */}
        <p className="revision__nota revision__nota--pie">
          {hallazgos.length === 0
            ? 'Se ha mirado la herencia, las clases vacías, las composiciones, los tipos de los atributos y las relaciones. Que no salga nada aquí no garantiza la nota.'
            : 'Esto señala candidatos, no sentencias: cada punto explica por qué salta para que se pueda descartar con criterio. Los errores que impiden generar el backend —tipo desconocido, entidad sin clave primaria— son otros y aparecen al pulsar «Generar».'}
        </p>
      </div>
    </div>
  );
}
