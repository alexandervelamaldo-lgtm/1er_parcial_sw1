import { useMemo, useState } from 'react';
import {
  type Aplicar,
  RELATION_KIND_LABELS,
  canonizarCardinalidad,
  interpretarDiagramaExtraido,
  listSupportedTypes,
  type ClaseExtraida,
  type ClassDiagram,
  type DiagramaExtraido,
  type Operation,
  type RelacionExtraida,
} from '@app/shared';
import { ApiError, api } from '../services/api';
import { FotoConLupa } from './FotoConLupa';
import { Icono } from './iconos';

/**
 * Importar un diagrama de clases entero desde una foto (RF-VIS-01).
 *
 * Sustituye a la pantalla que leía *una* tabla. La razón de fondo es que casi
 * nadie fotografía una tabla suelta: se fotografía la pizarra de la reunión, y
 * en la pizarra hay cuatro recuadros y las flechas entre ellos. Con el lector de
 * tablas, esa foto devolvía una tabla inventada a partir del primer recuadro y
 * perdía todo lo demás sin decirlo.
 *
 * No se pierde nada al cambiar: una clase leída puede traer sus filas de datos,
 * así que fotografiar una tabla con contenido sigue cargando el contenido.
 *
 * La idea de la pantalla es la misma de antes —la foto y lo leído a la vez, y
 * nada entra sin que alguien lo apruebe— pero con un acento distinto. Al revisar
 * una tabla lo que se compara son textos, y el ojo lo hace solo. Al revisar un
 * diagrama, lo que más caro sale es lo que *no* se ve: una cardinalidad que el
 * modelo no supo leer y rellenó por su cuenta. En el lienzo eso es una flecha
 * idéntica a las demás, y en el proyecto generado es una tabla de unión donde
 * debía haber una clave foránea. Por eso los extremos que el modelo no leyó
 * salen marcados y con su propio contador arriba, en vez de escondidos en la
 * lista de avisos.
 */

const TIPOS = listSupportedTypes();

/** Lo que el navegador puede mandar y el servidor sabe reconocer por su firma. */
const MIMES_ADMITIDOS = ['image/png', 'image/jpeg', 'image/webp'];

/**
 * Las cuatro cardinalidades que ofrece también el panel de relaciones.
 *
 * Son las mismas a propósito: si aquí se pudiera elegir una que el panel no
 * sabe mostrar, la relación quedaría importada y no editable después.
 */
const MULTIPLICIDADES = ['1', '0..1', '*', '1..*'];

const ESTEREOTIPOS: { valor: ClaseExtraida['estereotipo']; etiqueta: string }[] = [
  { valor: 'class', etiqueta: 'Clase' },
  { valor: 'abstract', etiqueta: 'Abstracta' },
  { valor: 'interface', etiqueta: 'Interfaz' },
  { valor: 'enum', etiqueta: 'Enumerado' },
];

type Fase = 'vacio' | 'leyendo' | 'revision' | 'proponiendo';

export interface ImportarDiagramaProps {
  proyectoId: string;
  soloLectura: boolean;
  diagrama: ClassDiagram;
  aplicar: Aplicar;
  onCerrar: () => void;
}

export function ImportarDiagrama({
  proyectoId,
  soloLectura,
  diagrama,
  aplicar,
  onCerrar,
}: ImportarDiagramaProps): JSX.Element {
  const [fase, setFase] = useState<Fase>('vacio');
  const [error, setError] = useState<string | null>(null);
  const [modelo, setModelo] = useState<string | null>(null);
  const [confianza, setConfianza] = useState<number | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  const [leido, setLeido] = useState<DiagramaExtraido | null>(null);

  /**
   * Se revalida en local con la misma función que usa el servidor.
   *
   * Así los avisos se mueven mientras se corrige —una cardinalidad que se elige
   * deja de estar marcada en el acto— en vez de aparecer solo al pulsar
   * importar. El servidor la vuelve a ejecutar al proponer: esto es comodidad,
   * no confianza.
   */
  const revision = useMemo(
    () => (leido ? interpretarDiagramaExtraido(leido, diagrama) : null),
    [leido, diagrama],
  );

  const leerFichero = async (fichero: File): Promise<void> => {
    setError(null);

    if (!MIMES_ADMITIDOS.includes(fichero.type)) {
      setError(
        `«${fichero.name}» es ${fichero.type || 'de un tipo que el navegador no reconoce'}. ` +
          'Solo se admiten PNG, JPEG y WebP.',
      );
      return;
    }

    // La vista previa sale del fichero local, no de lo que devuelva el servidor:
    // es la foto de verdad, la que hay que comparar con lo leído, y tiene que
    // seguir en pantalla aunque la lectura falle.
    const dataUrl = await new Promise<string>((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(String(lector.result));
      lector.onerror = () => rechazar(new Error('No se pudo leer el fichero'));
      lector.readAsDataURL(fichero);
    });
    setVistaPrevia(dataUrl);

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    setFase('leyendo');
    try {
      const respuesta = await api.leerDiagramaDeImagen(proyectoId, base64, fichero.type);
      setModelo(respuesta.modelo);
      setConfianza(respuesta.confianzaDeclarada);
      setLeido(respuesta.diagrama);
      setFase('revision');
    } catch (fallo) {
      // Sin modelo de visión no hay nada que leer, así que no hay vía local que
      // valga. Se da el motivo tal cual lo manda el servidor porque distingue
      // «no hay clave configurada» de «saldo agotado» y de «la foto no se
      // entiende», que se arreglan de tres maneras distintas.
      setError(
        fallo instanceof ApiError && fallo.esDeRed
          ? 'Sin conexión no se puede leer una foto: hace falta el modelo del servidor.'
          : fallo instanceof Error
            ? fallo.message
            : 'No se pudo leer la imagen',
      );
      setFase('vacio');
    }
  };

  // --- edición de lo leído ---------------------------------------------------

  const cambiar = (parcial: Partial<DiagramaExtraido>): void => {
    setLeido((actual) => (actual ? { ...actual, ...parcial } : actual));
  };

  const cambiarClase = (indice: number, parcial: Partial<ClaseExtraida>): void => {
    if (!leido) return;
    cambiar({
      clases: leido.clases.map((clase, i) => (i === indice ? { ...clase, ...parcial } : clase)),
    });
  };

  const cambiarAtributo = (
    clase: number,
    atributo: number,
    parcial: Partial<ClaseExtraida['atributos'][number]>,
  ): void => {
    if (!leido) return;
    const actual = leido.clases[clase];
    if (!actual) return;
    cambiarClase(clase, {
      atributos: actual.atributos.map((a, i) => (i === atributo ? { ...a, ...parcial } : a)),
    });
  };

  const marcarClave = (clase: number, atributo: number): void => {
    if (!leido) return;
    const actual = leido.clases[clase];
    if (!actual) return;
    // Una sola clave por clase: el modelo de dominio admite claves compuestas,
    // pero dos marcadas en una foto de pizarra casi siempre es el modelo
    // confundiéndose, y deshacerlo a mano cuesta más que marcarlo bien.
    cambiarClase(clase, {
      atributos: actual.atributos.map((a, i) => ({ ...a, esClave: i === atributo })),
    });
  };

  const borrarClase = (indice: number): void => {
    if (!leido) return;
    const fuera = leido.clases[indice]?.nombre;
    cambiar({
      clases: leido.clases.filter((_, i) => i !== indice),
      // Sus relaciones se van con ella: dejarlas apuntando a una clase que ya no
      // está solo produce avisos de «no es ninguna de las clases leídas».
      relaciones: leido.relaciones.filter((r) => r.origen !== fuera && r.destino !== fuera),
    });
  };

  const borrarAtributo = (clase: number, atributo: number): void => {
    if (!leido) return;
    const actual = leido.clases[clase];
    if (!actual) return;
    cambiarClase(clase, {
      atributos: actual.atributos.filter((_, i) => i !== atributo),
      // Las filas van alineadas por posición con los atributos: quitar solo la
      // cabecera dejaría cada valor bajo la columna siguiente.
      filas: actual.filas.map((valores) => valores.filter((_, i) => i !== atributo)),
    });
  };

  const cambiarRelacion = (indice: number, parcial: Partial<RelacionExtraida>): void => {
    if (!leido) return;
    cambiar({
      relaciones: leido.relaciones.map((r, i) => (i === indice ? { ...r, ...parcial } : r)),
    });
  };

  const borrarRelacion = (indice: number): void => {
    if (!leido) return;
    cambiar({ relaciones: leido.relaciones.filter((_, i) => i !== indice) });
  };

  // --- importación -----------------------------------------------------------

  const importar = async (): Promise<void> => {
    if (!leido) return;
    setFase('proponiendo');
    setError(null);
    try {
      // Se pregunta al servidor aunque las operaciones ya estén calculadas aquí
      // arriba: las que se aplican son las suyas. El cálculo local sirve para
      // enseñar avisos mientras se corrige, no para decidir qué se escribe.
      const respuesta = await api.proponerImportacionDiagrama(proyectoId, leido);
      if (!respuesta.aplicable) {
        setError(
          respuesta.avisos
            .filter((a) => a.severidad === 'error')
            .map((a) => a.mensaje)
            .join(' ') || 'El diagrama no se puede importar tal y como está.',
        );
        setFase('revision');
        return;
      }

      // El historial guarda las dos autorías por separado: quien confirma es el
      // usuario, quien lo propuso es el modelo que leyó la foto. Sin lo segundo,
      // dentro de un mes nadie sabría por qué esta clase tiene un atributo que
      // no recuerda haber escrito.
      const resultado = aplicar(
        respuesta.propuesta.map((p) => p.operacion),
        { origen: 'foto', ...(modelo ? { propuestoPor: modelo } : {}) },
      );
      if (!resultado.ok) {
        setError(resultado.error);
        setFase('revision');
        return;
      }
      onCerrar();
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : 'No se pudo importar el diagrama');
      setFase('revision');
    }
  };

  const errores = revision?.avisos.filter((a) => a.severidad === 'error') ?? [];
  const advertencias = revision?.avisos.filter((a) => a.severidad === 'aviso') ?? [];
  const dudosas = revision?.resumen.cardinalidadesDudosas ?? 0;

  /** Un desplegable de cardinalidad que dice cuándo el valor no se leyó. */
  const selectorCardinalidad = (
    indice: number,
    extremo: 'cardinalidadOrigen' | 'cardinalidadDestino',
    valor: string,
    etiqueta: string,
  ): JSX.Element => {
    const canon = canonizarCardinalidad(valor);
    return (
      <select
        className={canon === null ? 'importar-diagrama__dudosa' : undefined}
        value={canon ?? ''}
        aria-label={etiqueta}
        onChange={(e) => cambiarRelacion(indice, { [extremo]: e.target.value })}
      >
        {canon === null && <option value="">sin leer</option>}
        {!MULTIPLICIDADES.includes(canon ?? '') && canon !== null && (
          <option value={canon}>{canon}</option>
        )}
        {MULTIPLICIDADES.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Importar un diagrama desde una imagen"
    >
      <div className="modal__caja importar">
        <header className="importar__cabecera">
          <h2>Importar un diagrama desde una imagen</h2>
          <button
            type="button"
            className="boton boton--icono"
            aria-label="Cerrar"
            onClick={onCerrar}
          >
            <Icono nombre="cerrar" />
          </button>
        </header>

        {error && <p className="importar__error">{error}</p>}

        {fase === 'vacio' && (
          <div className="importar__inicio">
            <p>
              Sube la foto o la captura de un diagrama de clases —una pizarra, un folio, la
              pantalla de otra herramienta— y aquí se leerán las clases, sus atributos y las
              relaciones entre ellas. <strong>No se importa nada sin que lo revises</strong>:
              verás la imagen junto a lo leído para compararlo antes de aceptar.
            </p>
            {/*
              `capture` abre la cámara trasera en el móvil en vez del carrete, que
              es lo que se quiere cuando lo que se fotografía es una pizarra que
              tienes delante. En escritorio el atributo se ignora, así que no hay
              que ramificar por dispositivo.

              Va aquí y NO en la entrada de XMI: un fichero no se fotografía, y
              poner `capture` allí abriría la cámara para elegir un `.xml`.
            */}
            <input
              type="file"
              accept={MIMES_ADMITIDOS.join(',')}
              capture="environment"
              disabled={soloLectura}
              onChange={(e) => {
                const fichero = e.target.files?.[0];
                if (fichero) void leerFichero(fichero);
              }}
            />
            <p className="importar__nota">
              {/* El rótulo se cita tal cual aparece en el menú, y nombrando también el
                  menú que lo contiene. Antes citaba un botón que llevaba un glifo delante
                  y que ya no existe: una instrucción que nombra un control inexistente es
                  peor que no darla. */}
              Si el diagrama procede de otra herramienta y se conserva el fichero, conviene
              usar «Importar XMI», en el menú Archivo, en lugar de una foto: la lectura es
              exacta y no requiere revisión.
            </p>
          </div>
        )}

        {fase === 'leyendo' && (
          <p className="importar__cargando">
            Leyendo la imagen… un diagrama tarda más que una tabla, unos segundos.
          </p>
        )}

        {leido && revision && (fase === 'revision' || fase === 'proponiendo') && (
          <div className="importar__revision">
            <div className="importar__foto">
              {vistaPrevia && (
                <FotoConLupa src={vistaPrevia} alt="La imagen que se está importando" />
              )}
              {(modelo || confianza !== null) && (
                <div className="importar__meta">
                  {modelo && <span className="importar__modelo-tag">Modelo: {modelo}</span>}
                  {confianza !== null && (
                    <span
                      className={`importar__confianza-badge ${
                        confianza >= 0.85
                          ? 'importar__confianza-badge--alta'
                          : 'importar__confianza-badge--media'
                      }`}
                    >
                      Confianza: {Math.round(confianza * 100)}%
                    </span>
                  )}
                </div>
              )}
              <p className="importar__nota">
                {confianza !== null && (
                  <>
                    <strong>Estimación declarada por el modelo</strong>, no una garantía de
                    corrección. Conviene revisar la imagen con el visor y contrastar las clases y
                    cardinalidades antes de incorporar la propuesta.
                  </>
                )}
              </p>
            </div>

            <div className="importar__tabla">
              <div className="importar-xmi__recuento">
                <span>
                  {revision.resumen.clases} clase{revision.resumen.clases === 1 ? '' : 's'}
                </span>
                <span>{revision.resumen.atributos} atributos</span>
                <span>
                  {revision.resumen.relaciones} relaci
                  {revision.resumen.relaciones === 1 ? 'ón' : 'ones'}
                </span>
                {revision.resumen.filas > 0 && <span>{revision.resumen.filas} filas de datos</span>}
              </div>

              {/*
                El contador propio, arriba y en rojo, no es alarmismo. Una
                cardinalidad supuesta es indistinguible de una leída en cuanto
                entra al lienzo, y decide si el generador emite una clave foránea
                o una tabla de unión. Si esto viviera dentro de la lista de
                avisos, se pasaría por alto exactamente igual que se pasan por
                alto los avisos.
              */}
              {dudosas > 0 && (
                <p className="importar-diagrama__alerta">
                  <Icono nombre="alerta" className="alerta__simbolo" /> {dudosas} extremo
                  {dudosas === 1 ? '' : 's'} de relación sin cardinalidad
                  legible. Están marcados abajo como «sin leer» y se propone{' '}
                  <code>1 → *</code>. Conviene ampliarlos en la foto antes de importar —con la
                  rueda, con un doble clic o con los botones de zoom—: de esto depende que el
                  proyecto generado lleve una clave foránea o una tabla de unión.
                </p>
              )}

              <h3 className="importar-diagrama__titulo">Clases</h3>
              {leido.clases.map((clase, i) => (
                <details key={i} className="importar-xmi__detalle" open={leido.clases.length <= 4}>
                  <summary>
                    {clase.nombre || '(sin nombre)'}
                    {clase.atributos.length > 0 && ` · ${clase.atributos.length} atributos`}
                    {clase.filas.length > 0 && ` · ${clase.filas.length} filas`}
                  </summary>

                  <div className="importar-diagrama__clase">
                    <input
                      value={clase.nombre}
                      aria-label={`Nombre de la clase ${i + 1}`}
                      onChange={(e) => cambiarClase(i, { nombre: e.target.value })}
                    />
                    <select
                      value={clase.estereotipo}
                      aria-label={`Tipo de la clase ${i + 1}`}
                      onChange={(e) =>
                        cambiarClase(i, {
                          estereotipo: e.target.value as ClaseExtraida['estereotipo'],
                        })
                      }
                    >
                      {ESTEREOTIPOS.map((op) => (
                        <option key={op.valor} value={op.valor}>
                          {op.etiqueta}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="boton boton--discreto"
                      title="Descartar esta clase y sus relaciones"
                      onClick={() => borrarClase(i)}
                    >
                      <Icono nombre="cerrar" />
                    </button>
                  </div>

                  {clase.atributos.map((atributo, j) => (
                    <div key={j} className="importar-diagrama__atributo">
                      <input
                        value={atributo.nombre}
                        aria-label={`Atributo ${j + 1} de ${clase.nombre}`}
                        onChange={(e) => cambiarAtributo(i, j, { nombre: e.target.value })}
                      />
                      <select
                        value={atributo.tipo}
                        aria-label={`Tipo del atributo ${j + 1} de ${clase.nombre}`}
                        onChange={(e) => cambiarAtributo(i, j, { tipo: e.target.value })}
                      >
                        {!TIPOS.includes(atributo.tipo) && (
                          <option value={atributo.tipo}>{atributo.tipo} (desconocido)</option>
                        )}
                        {TIPOS.map((tipo) => (
                          <option key={tipo} value={tipo}>
                            {tipo}
                          </option>
                        ))}
                      </select>
                      <label title="Clave primaria">
                        <input
                          type="radio"
                          name={`clave-${i}`}
                          checked={atributo.esClave}
                          onChange={() => marcarClave(i, j)}
                        />
                        clave
                      </label>
                      <button
                        type="button"
                        className="boton boton--discreto"
                        title="Quitar este atributo"
                        onClick={() => borrarAtributo(i, j)}
                      >
                        <Icono nombre="cerrar" />
                      </button>
                    </div>
                  ))}
                </details>
              ))}

              {leido.relaciones.length > 0 && (
                <>
                  <h3 className="importar-diagrama__titulo">Relaciones</h3>
                  {leido.relaciones.map((relacion, i) => {
                    const sinLeer =
                      canonizarCardinalidad(relacion.cardinalidadOrigen) === null ||
                      canonizarCardinalidad(relacion.cardinalidadDestino) === null;
                    return (
                      <div
                        key={i}
                        className={
                          sinLeer
                            ? 'importar-diagrama__relacion importar-diagrama__relacion--dudosa'
                            : 'importar-diagrama__relacion'
                        }
                      >
                        <span className="importar-diagrama__extremo">{relacion.origen}</span>
                        {selectorCardinalidad(
                          i,
                          'cardinalidadOrigen',
                          relacion.cardinalidadOrigen,
                          `Cardinalidad de ${relacion.origen} en la relación ${i + 1}`,
                        )}
                        <select
                          value={relacion.tipo}
                          aria-label={`Tipo de la relación ${i + 1}`}
                          onChange={(e) =>
                            cambiarRelacion(i, {
                              tipo: e.target.value as RelacionExtraida['tipo'],
                            })
                          }
                        >
                          {Object.entries(RELATION_KIND_LABELS).map(([valor, etiqueta]) => (
                            <option key={valor} value={valor}>
                              {etiqueta}
                            </option>
                          ))}
                        </select>
                        {selectorCardinalidad(
                          i,
                          'cardinalidadDestino',
                          relacion.cardinalidadDestino,
                          `Cardinalidad de ${relacion.destino} en la relación ${i + 1}`,
                        )}
                        <span className="importar-diagrama__extremo">{relacion.destino}</span>
                        <button
                          type="button"
                          className="boton boton--discreto"
                          title="Descartar esta relación"
                          onClick={() => borrarRelacion(i)}
                        >
                          <Icono nombre="cerrar" />
                        </button>
                      </div>
                    );
                  })}
                </>
              )}

              {errores.length > 0 && (
                <ul className="importar__avisos importar__avisos--error">
                  {errores.map((aviso, i) => (
                    <li key={i}>{aviso.mensaje}</li>
                  ))}
                </ul>
              )}
              {advertencias.length > 0 && (
                <ul className="importar__avisos">
                  {advertencias.map((aviso, i) => (
                    <li key={i}>{aviso.mensaje}</li>
                  ))}
                </ul>
              )}

              <div className="importar__acciones">
                <button
                  type="button"
                  className="boton boton--primario"
                  disabled={soloLectura || !revision.aplicable || fase === 'proponiendo'}
                  onClick={() => void importar()}
                >
                  {fase === 'proponiendo'
                    ? 'Importando…'
                    : `He comparado con la imagen: importar ${revision.resumen.clases} clase${
                        revision.resumen.clases === 1 ? '' : 's'
                      }`}
                </button>
                <button type="button" className="boton" onClick={onCerrar}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
