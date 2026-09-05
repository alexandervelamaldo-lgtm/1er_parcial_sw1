import { useMemo, useState } from 'react';
import { listModules, type Aplicar, type ClassDiagram, type UmlModule } from '@app/shared';
import { Icono } from './iconos';
import {
  errorDeNombre,
  errorDeSegmento,
  repartoDeModulos,
  rutaDeClase,
  sugerirSegmento,
} from './modulos';

/**
 * El catálogo de módulos.
 *
 * Un módulo reparte el dominio en subpaquetes: `Pedido` dentro de «Ventas» se
 * genera en `com.tienda.ventas.domain`, con su repositorio, su servicio y su
 * controlador al lado. Es la parte de contexto acotado que el enunciado pide
 * bajo «architect enterprise», y aquí se ve entera antes de generar nada.
 *
 * Lo que hace que esta pantalla valga algo es la ruta que aparece junto a cada
 * clase. Mover `Pedido` a «Ventas» cambia la línea a
 * `com/tienda/ventas/domain/Pedido.java` en el acto, y al descomprimir el ZIP
 * el fichero está exactamente ahí. Sin esa correspondencia el módulo sería una
 * etiqueta de colores, que es justo lo que la maqueta proponía.
 *
 * Es un modal y no un quinto panel acoplado porque la rejilla admite dos
 * paneles por lado y ya están los cuatro puestos; y porque esto se abre para
 * reorganizar y se cierra, no se consulta mientras se dibuja.
 *
 * Va vacío al principio y así se queda si nadie lo toca: un diagrama sin
 * módulos genera byte a byte lo mismo que antes de que existieran, y eso está
 * comprobado en `generator/src/modulos.test.ts`.
 */

interface Props {
  diagrama: ClassDiagram;
  aplicar: Aplicar;
  soloLectura: boolean;
  onCerrar: () => void;
}

/** Los campos del formulario, compartidos por el alta y la edición. */
interface Borrador {
  nombre: string;
  segmento: string;
  descripcion: string;
  /**
   * Deja de proponer segmento en cuanto alguien lo escribe a mano.
   *
   * Sin esto, escribir el paquete y luego corregir una tilde del nombre borra
   * lo escrito. La propuesta ayuda mientras el campo está intacto y estorba en
   * cuanto hay una decisión detrás.
   */
  segmentoTocado: boolean;
}

const VACIO: Borrador = { nombre: '', segmento: '', descripcion: '', segmentoTocado: false };

export function CatalogoModulos({ diagrama, aplicar, soloLectura, onCerrar }: Props) {
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState<Borrador>(VACIO);
  const [error, setError] = useState<string | null>(null);

  const filas = useMemo(() => repartoDeModulos(diagrama), [diagrama]);
  const modulos = useMemo(() => listModules(diagrama), [diagrama]);

  const errNombre = errorDeNombre(borrador.nombre, modulos, editando);
  const errSegmento = errorDeSegmento(borrador.segmento, modulos, editando);
  const listo = errNombre === null && errSegmento === null;

  const cambiarNombre = (nombre: string): void => {
    setBorrador((b) => ({
      ...b,
      nombre,
      segmento: b.segmentoTocado ? b.segmento : sugerirSegmento(nombre),
    }));
  };

  const empezarAlta = (): void => {
    setEditando(null);
    setBorrador(VACIO);
    setError(null);
  };

  const empezarEdicion = (modulo: UmlModule): void => {
    setEditando(modulo.id);
    setBorrador({
      nombre: modulo.name,
      segmento: modulo.packageSegment,
      descripcion: modulo.description,
      // Ya está escrito: no se toca al reeditar el nombre.
      segmentoTocado: true,
    });
    setError(null);
  };

  const guardar = (): void => {
    if (!listo) return;
    const nombre = borrador.nombre.trim();
    const descripcion = borrador.descripcion.trim();
    const resultado = aplicar([
      editando === null
        ? { op: 'addModule', name: nombre, packageSegment: borrador.segmento, description: descripcion }
        : {
            op: 'updateModule',
            id: editando,
            changes: { name: nombre, packageSegment: borrador.segmento, description: descripcion },
          },
    ]);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    empezarAlta();
  };

  const borrar = (modulo: UmlModule): void => {
    // Se borra el módulo, no sus clases: vuelven al paquete base, que es donde
    // estaban antes de que el módulo existiera.
    const resultado = aplicar([{ op: 'removeModule', id: modulo.id }]);
    setError(resultado.ok ? null : resultado.error);
    if (resultado.ok && editando === modulo.id) empezarAlta();
  };

  const mover = (classId: string, moduleId: string | null): void => {
    const resultado = aplicar([{ op: 'assignClassToModule', classRef: { id: classId }, moduleId }]);
    setError(resultado.ok ? null : resultado.error);
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Módulos del proyecto">
      <div className="modal__caja modulos">
        <header className="modulos__cabecera">
          <div>
            <h2>Módulos</h2>
            <p className="modulos__resumen">
              Cada módulo añade un tramo al paquete de sus clases. Debajo de
              <code> {diagrama.meta.basePackage}</code>.
            </p>
          </div>
          <button type="button" className="boton boton--icono" aria-label="Cerrar" onClick={onCerrar}>
            <Icono nombre="cerrar" />
          </button>
        </header>

        {error !== null && <p className="panel__error">{error}</p>}

        <div className="modulos__cuerpo">
          {!soloLectura && (
            <form
              className="modulos__formulario"
              onSubmit={(evento) => {
                evento.preventDefault();
                guardar();
              }}
            >
              <h3>{editando === null ? 'Nuevo módulo' : 'Editar módulo'}</h3>

              <label className="campo">
                <span>Nombre</span>
                <input
                  type="text"
                  value={borrador.nombre}
                  onChange={(e) => cambiarNombre(e.target.value)}
                  placeholder="Ventas"
                />
              </label>

              <label className="campo">
                <span>Paquete</span>
                <input
                  type="text"
                  value={borrador.segmento}
                  onChange={(e) =>
                    setBorrador((b) => ({ ...b, segmento: e.target.value, segmentoTocado: true }))
                  }
                  placeholder="ventas"
                  spellCheck={false}
                />
              </label>

              {/*
                La ruta completa se enseña mientras se escribe, no al generar.
                Es la forma de ver que el segmento es un tramo y no un paquete
                entero antes de que el formulario lo rechace.
              */}
              <p className="modulos__vista-paquete">
                <code>
                  {diagrama.meta.basePackage}.{borrador.segmento === '' ? '…' : borrador.segmento}
                </code>
              </p>

              <label className="campo">
                <span>Descripción</span>
                <input
                  type="text"
                  value={borrador.descripcion}
                  onChange={(e) => setBorrador((b) => ({ ...b, descripcion: e.target.value }))}
                  placeholder="Pedidos y sus líneas"
                />
              </label>

              {/*
                El motivo se enseña siempre que haya algo escrito, no solo al
                enviar: quien teclea «com.ventas» se entera en ese momento de
                que un módulo es un único tramo.
              */}
              {borrador.nombre !== '' && errNombre !== null && (
                <p className="modulos__error">{errNombre}</p>
              )}
              {borrador.segmento !== '' && errSegmento !== null && (
                <p className="modulos__error">{errSegmento}</p>
              )}

              <div className="modulos__acciones">
                <button type="submit" className="boton boton--primario" disabled={!listo}>
                  {editando === null ? 'Crear módulo' : 'Guardar cambios'}
                </button>
                {editando !== null && (
                  <button type="button" className="boton" onClick={empezarAlta}>
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          )}

          <div className="modulos__lista">
            {filas.map((fila) => (
              <section
                key={fila.modulo?.id ?? 'sin-modulo'}
                className={`modulos__tarjeta${fila.modulo === null ? ' modulos__tarjeta--sueltas' : ''}`}
              >
                <header className="modulos__tarjeta-cabecera">
                  <div>
                    <h3>
                      <Icono nombre="modulo" /> {fila.modulo?.name ?? 'Sin módulo'}
                    </h3>
                    <code className="modulos__paquete">{fila.paquete}</code>
                    {fila.modulo !== null && fila.modulo.description !== '' && (
                      <p className="modulos__descripcion">{fila.modulo.description}</p>
                    )}
                  </div>
                  <div className="modulos__tarjeta-acciones">
                    <span className="modulos__cuenta">
                      {fila.clases.length} clase{fila.clases.length === 1 ? '' : 's'}
                    </span>
                    {fila.modulo !== null && !soloLectura && (
                      <>
                        <button
                          type="button"
                          className="boton boton--discreto"
                          onClick={() => empezarEdicion(fila.modulo!)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="boton boton--discreto"
                          onClick={() => borrar(fila.modulo!)}
                        >
                          Borrar
                        </button>
                      </>
                    )}
                  </div>
                </header>

                {fila.clases.length === 0 ? (
                  <p className="panel__vacio">
                    Sin clases. Muévalas desde el selector de cada clase.
                  </p>
                ) : (
                  <ul className="modulos__clases">
                    {fila.clases.map((cls) => (
                      <li key={cls.id}>
                        <span className="modulos__clase-nombre">{cls.name}</span>
                        {/*
                          La ruta del fichero que se va a escribir. Es lo que
                          convierte el módulo en algo comprobable sin generar.
                        */}
                        <code className="modulos__ruta">{rutaDeClase(diagrama, cls)}</code>
                        <select
                          className="modulos__selector"
                          aria-label={`Módulo de ${cls.name}`}
                          disabled={soloLectura}
                          value={fila.modulo?.id ?? ''}
                          onChange={(e) => mover(cls.id, e.target.value === '' ? null : e.target.value)}
                        >
                          <option value="">Sin módulo</option>
                          {modulos.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>

        <p className="modulos__nota">
          El módulo organiza el código, no la base de datos: las tablas salen iguales estén las
          clases repartidas o no.
        </p>
      </div>
    </div>
  );
}
