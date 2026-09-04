import { useMemo, useState } from 'react';
import {
  type Aplicar,
  decodificarXml,
  describeOperation,
  leerXmi,
  type ClassDiagram,
  type Operation,
} from '@app/shared';
import { Icono } from './iconos';

/**
 * Importar un diagrama desde un fichero XMI (RF-DIAG-12).
 *
 * Todo ocurre en el navegador. No hay llamada al servidor ni al modelo de
 * lenguaje: el fichero se analiza aquí, así que esta pantalla funciona sin
 * conexión y sin gastar clave, a diferencia de la importación desde foto.
 *
 * Y como en aquella, **nada entra en el diagrama hasta que alguien lo confirma**.
 * Aquí importa incluso más: un XMI ajeno puede traer doscientas clases de golpe,
 * y el diagrama es compartido. Volcarlas directamente le cambiaría el trabajo a
 * todos los que estén conectados en ese momento, sin que ninguno haya pedido
 * nada. Por eso se enseña primero el recuento, la lista de clases y los avisos,
 * y el botón dice cuántas clases va a crear.
 *
 * Las operaciones viajan como un solo lote, de modo que deshacer una importación
 * entera es un único Ctrl+Z y no una limpieza a mano de doscientas cajas.
 */

/** 8 MiB, el mismo tope que aplica el analizador. */
const MAX_BYTES = 8 * 1024 * 1024;

const EXTENSIONES = '.xmi,.xml,application/xml,text/xml';

export interface ImportarXmiProps {
  soloLectura: boolean;
  diagrama: ClassDiagram;
  aplicar: Aplicar;
  onCerrar: () => void;
}

export function ImportarXmi({
  soloLectura,
  diagrama,
  aplicar,
  onCerrar,
}: ImportarXmiProps): JSX.Element {
  const [contenido, setContenido] = useState<string | null>(null);
  const [nombreFichero, setNombreFichero] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Se recalcula contra el diagrama actual, no contra el que había al abrir el
  // fichero: si mientras tanto otro colaborador crea una clase «Cliente», el
  // aviso de choque aparece solo.
  const revision = useMemo(
    () => (contenido !== null ? leerXmi(contenido, diagrama) : null),
    [contenido, diagrama],
  );

  const leerFichero = async (fichero: File): Promise<void> => {
    setError(null);
    if (fichero.size > MAX_BYTES) {
      setError(
        `«${fichero.name}» ocupa ${Math.round(fichero.size / 1024 / 1024)} MB y el límite son 8 MB.`,
      );
      return;
    }
    try {
      // `fichero.text()` supone UTF-8 siempre; Enterprise Architect exporta en
      // windows-1252. Los bytes se decodifican según lo que el propio fichero
      // declara para que los acentos no lleguen rotos al validador de nombres.
      const texto = decodificarXml(await fichero.arrayBuffer());
      setNombreFichero(fichero.name);
      setContenido(texto);
    } catch {
      setError('No se pudo leer el fichero.');
    }
  };

  const importar = (): void => {
    if (!revision || !revision.aplicable) return;
    // El nombre del fichero es el «quién lo propuso» de esta vía: es lo que
    // permite rastrear un modelo raro hasta el XMI del que salió.
    const resultado = aplicar(revision.operaciones, {
      origen: 'xmi',
      ...(nombreFichero ? { propuestoPor: nombreFichero } : {}),
    });
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    onCerrar();
  };

  const errores = revision?.avisos.filter((a) => a.severidad === 'error') ?? [];
  const advertencias = revision?.avisos.filter((a) => a.severidad === 'aviso') ?? [];

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Importar un fichero XMI">
      <div className="modal__caja importar-xmi">
        <header className="importar__cabecera">
          <h2>Importar desde XMI</h2>
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

        {revision === null && (
          <div className="importar__inicio">
            <p>
              Admite un <code>.xmi</code> exportado de Enterprise Architect, Papyrus, StarUML o de
              esta misma herramienta. Se leen las clases, sus atributos y métodos, y las relaciones
              con su cardinalidad.{' '}
              <strong>Nada se aplica al diagrama hasta la confirmación.</strong>
            </p>
            <p className="importar__nota">
              Si el fichero trae un diagrama de comunicación (o de secuencia), también se aprovecha:
              cada objeto se lee como su clase, cada mensaje pasa a ser un método de quien lo{' '}
              <em>recibe</em>, y cada enlace, una dependencia. El orden de los mensajes no se
              conserva, porque un diagrama de clases no tiene dónde guardarlo.
            </p>
            <input
              type="file"
              accept={EXTENSIONES}
              disabled={soloLectura}
              onChange={(e) => {
                const fichero = e.target.files?.[0];
                if (fichero) void leerFichero(fichero);
              }}
            />
            <p className="importar__nota">
              Se añade a lo que ya hay; no reemplaza el diagrama. Una clase del fichero cuyo nombre
              ya exista aquí no se duplica: se omite y se te dice cuál, salvo que venga de un
              diagrama de comunicación, en cuyo caso se le añaden los métodos que falten.
            </p>
          </div>
        )}

        {revision && (
          <div className="importar-xmi__revision">
            <p className="importar-xmi__fuente">
              <strong>{nombreFichero}</strong>
            </p>

            {revision.aplicable ? (
              <>
                <ul className="importar-xmi__recuento">
                  <li>
                    <strong>{revision.resumen.clases}</strong> clases
                  </li>
                  <li>
                    <strong>{revision.resumen.atributos}</strong> atributos
                  </li>
                  <li>
                    <strong>{revision.resumen.metodos}</strong> métodos
                  </li>
                  <li>
                    <strong>{revision.resumen.relaciones}</strong> relaciones
                  </li>
                  <li>
                    <strong>{revision.resumen.filas}</strong> filas de datos
                  </li>
                  {/* Solo cuando el fichero trae interacciones: en un XMI de
                      clases normal serían dos ceros que no dicen nada. */}
                  {revision.comunicacion && (
                    <>
                      <li>
                        <strong>{revision.resumen.mensajes}</strong> mensajes
                      </li>
                      <li>
                        <strong>{revision.resumen.enlaces}</strong> enlaces
                      </li>
                    </>
                  )}
                </ul>

                <p className="importar-xmi__clases">
                  {revision.clases.map((nombre) => (
                    <span key={nombre} className="etiqueta">
                      {nombre}
                    </span>
                  ))}
                </p>

                {/* Ampliar una clase que ya existe es lo único que esta
                    pantalla hace sobre lo que ya hay dibujado. Decir cuáles
                    son es lo que permite revisarlo antes de aceptar. */}
                {revision.ampliadas.length > 0 && (
                  <p className="importar-xmi__ampliadas">
                    Además se añaden métodos a {revision.ampliadas.length} clase
                    {revision.ampliadas.length === 1 ? '' : 's'} que ya está
                    {revision.ampliadas.length === 1 ? '' : 'n'} en el diagrama:{' '}
                    {revision.ampliadas.map((nombre) => (
                      <span key={nombre} className="etiqueta">
                        {nombre}
                      </span>
                    ))}
                  </p>
                )}

                <details className="importar-xmi__detalle">
                  <summary>Ver las {revision.operaciones.length} operaciones</summary>
                  <ol>
                    {revision.operaciones.map((operacion, indice) => (
                      <li key={indice}>{describeOperation(operacion)}</li>
                    ))}
                  </ol>
                </details>
              </>
            ) : (
              <ul className="importar__avisos importar__avisos--error">
                {errores.map((aviso, indice) => (
                  <li key={indice}>{aviso.mensaje}</li>
                ))}
              </ul>
            )}

            {advertencias.length > 0 && (
              <details className="importar-xmi__detalle" open>
                <summary>
                  {advertencias.length} aviso{advertencias.length === 1 ? '' : 's'}: hay cosas del
                  fichero que no se importan
                </summary>
                <ul className="importar__avisos">
                  {advertencias.map((aviso, indice) => (
                    <li key={indice}>{aviso.mensaje}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <footer className="importar__acciones">
          <button type="button" className="boton boton--discreto" onClick={onCerrar}>
            Cancelar
          </button>
          {revision?.aplicable && (
            <button
              type="button"
              className="boton boton--primario"
              disabled={soloLectura}
              onClick={importar}
            >
              {/* Con un diagrama de comunicación de clases ya existentes no se
                  crea ninguna: el botón no puede decir «Importar 0 clases». */}
              {revision.resumen.clases === 0
                ? `Aplicar ${revision.operaciones.length} cambios`
                : `Importar ${revision.resumen.clases} clase${revision.resumen.clases === 1 ? '' : 's'}`}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
