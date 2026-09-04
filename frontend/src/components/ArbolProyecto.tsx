import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { ClassDiagram } from '@app/shared';
import {
  expandidosIniciales,
  filasDelArbol,
  moverEnArbol,
  type FilaArbol,
} from './arbol-proyecto';
import { Icono } from './iconos';

/**
 * El árbol del proyecto.
 *
 * Es la única vista que enumera el diagrama entero. En el lienzo, una clase que
 * quedó en la coordenada 4000 existe pero no se encuentra; aquí está en su
 * sitio, en una lista ordenada por nombre, y pulsar Enter la trae al centro de
 * la pantalla.
 *
 * Va memoizado porque el editor se repinta hasta veinte veces por segundo
 * mientras alguien mueve el ratón al otro lado de la conexión —cada cursor ajeno
 * es un cambio de estado—, y volver a construir doscientas filas por cada
 * movimiento del ratón de otra persona se nota al escribir.
 */

export interface ArbolProyectoProps {
  diagrama: ClassDiagram;
  nombreProyecto: string;
  seleccion: string | null;
  onSeleccionar: (id: string) => void;
  /** Encuadra en el lienzo las clases indicadas. */
  onCentrar: (ids: string[]) => void;
}

export const ArbolProyecto = memo(function ArbolProyecto({
  diagrama,
  nombreProyecto,
  seleccion,
  onSeleccionar,
  onCentrar,
}: ArbolProyectoProps): JSX.Element {
  const [expandidos, setExpandidos] = useState<Set<string>>(expandidosIniciales);
  const [focoId, setFocoId] = useState<string | null>(null);
  const elementos = useRef(new Map<string, HTMLDivElement>());

  const filas = useMemo(() => filasDelArbol(diagrama, expandidos), [diagrama, expandidos]);

  /**
   * Un solo tabulador para todo el árbol.
   *
   * Con doscientas filas tabulables, llegar desde el árbol al lienzo cuesta
   * doscientas pulsaciones. Lo que recibe el foco es una fila —la enfocada, o
   * la de la clase seleccionada, o la primera— y dentro se anda con las flechas.
   */
  const tabulable =
    (focoId !== null && filas.some((fila) => fila.id === focoId) ? focoId : null) ??
    filas.find((fila) => fila.tipo === 'clase' && fila.clase === seleccion)?.id ??
    filas[0]?.id ??
    null;

  const alternarExpandido = useCallback((id: string) => {
    setExpandidos((actual) => {
      const siguiente = new Set(actual);
      if (!siguiente.delete(id)) siguiente.add(id);
      return siguiente;
    });
  }, []);

  const activar = useCallback(
    (fila: FilaArbol) => {
      if (fila.clase) onSeleccionar(fila.clase);
      if (fila.centrar.length > 0) onCentrar(fila.centrar);
      if (fila.expandible) alternarExpandido(fila.id);
    },
    [alternarExpandido, onCentrar, onSeleccionar],
  );

  const enfocar = useCallback((id: string) => {
    setFocoId(id);
    elementos.current.get(id)?.focus();
  }, []);

  const alTeclear = useCallback(
    (evento: React.KeyboardEvent<HTMLDivElement>, indice: number) => {
      const movimiento = moverEnArbol(filas, indice, evento.key);
      if (!movimiento) return;
      evento.preventDefault();
      // Las flechas no deben llegar a los atajos del editor: Delete borra la
      // clase seleccionada y Escape deselecciona, y ninguna de las dos cosas es
      // lo que se pide al recorrer una lista.
      evento.stopPropagation();

      if (movimiento.alternar) alternarExpandido(movimiento.alternar);
      const destino = filas[movimiento.indice];
      if (!destino) return;
      if (movimiento.activar) activar(destino);
      else enfocar(destino.id);
    },
    [activar, alternarExpandido, enfocar, filas],
  );

  return (
    <div className="arbol">
      <p className="arbol__raiz" title={nombreProyecto}>
        {nombreProyecto}
      </p>

      <div role="tree" aria-label="Estructura del proyecto" className="arbol__lista">
        {filas.map((fila, indice) => (
          <div
            key={fila.id}
            ref={(elemento) => {
              if (elemento) elementos.current.set(fila.id, elemento);
              else elementos.current.delete(fila.id);
            }}
            role="treeitem"
            aria-level={fila.nivel}
            aria-posinset={indice + 1}
            aria-setsize={filas.length}
            {...(fila.expandible ? { 'aria-expanded': fila.expandida } : {})}
            {...(fila.clase ? { 'aria-selected': fila.clase === seleccion } : {})}
            tabIndex={fila.id === tabulable ? 0 : -1}
            className={`arbol__fila arbol__fila--${fila.tipo}${
              fila.tipo === 'clase' && fila.clase === seleccion ? ' arbol__fila--activa' : ''
            }`}
            style={{ paddingLeft: `${String(2 + (fila.nivel - 1) * 12)}px` }}
            onFocus={() => setFocoId(fila.id)}
            onClick={() => activar(fila)}
            onKeyDown={(evento) => alTeclear(evento, indice)}
          >
            {/* El hueco se reserva aunque la fila no se pueda desplegar: sin él,
                las hojas se recolocarían doce píxeles a la izquierda y la
                columna de nombres dejaría de estar alineada. */}
            <span className="arbol__flecha">
              {fila.expandible && <Icono nombre={fila.expandida ? 'plegar' : 'desplegar'} />}
            </span>
            {fila.marca && (
              <span className={`arbol__marca arbol__marca--${fila.marca.toLowerCase()}`}>
                {fila.marca}
              </span>
            )}
            <span className="arbol__etiqueta">{fila.etiqueta}</span>
            {fila.detalle && <span className="arbol__detalle">{fila.detalle}</span>}
          </div>
        ))}
      </div>

      {/*
        Estado vacío en registro técnico: qué hay, no qué podría hacer el
        usuario a continuación. La lista de las cuatro formas de crear una clase
        estaba aquí porque no había dónde ponerla; ahora está en el menú Modelo y
        en la paleta, que es donde se busca.
      */}
      {Object.keys(diagrama.classes).length === 0 && (
        <p className="panel__vacio">Sin elementos.</p>
      )}
    </div>
  );
});
