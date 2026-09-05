import { useEffect, useMemo, useState } from 'react';
import { api, descargarProyecto, type FicheroGenerado, type Proyecto } from '../services/api';
import { Icono } from './iconos';
import {
  ROTULO_CAPA,
  nombreDe,
  porCapas,
  porCarpetas,
  prefijoComun,
  tamaño,
} from './generacion';

/**
 * Ver el backend generado antes de descargarlo. **RF-GEN-13.**
 *
 * El requisito estaba escrito desde el principio —«vista previa del código
 * generado, archivo por archivo, antes de descargarlo»— y era el único de la
 * familia RF-GEN que seguía sin implementar. No es una pantalla que se añade
 * porque quede bien: es una casilla que llevaba meses sin marcar.
 *
 * Hasta ahora «Generar proyecto Spring Boot» bajaba un ZIP a ciegas: si el
 * generador se equivocaba en un nombre de paquete o dejaba una entidad fuera,
 * eso no se sabía hasta descomprimir y abrir un editor. El servidor ya sabía
 * contestar a esto —`/generacion/previsualizacion` devuelve cada fichero con su
 * contenido— y no lo llamaba nadie.
 *
 * Es también lo que hace falta enseñar en una defensa. El enunciado pide un
 * backend de cuatro capas más DTO; el recuento por capas de aquí arriba lo
 * responde en un vistazo y sin salir de la aplicación, y sale de contar los
 * ficheros que se van a escribir, no de una afirmación en una diapositiva.
 *
 * La previsualización no descarga nada y la descarga no vuelve a generar en
 * balde: son dos llamadas distintas al mismo generador, y el ZIP sigue
 * armándose en el servidor como antes.
 */

interface Props {
  proyecto: Proyecto;
  onCerrar: () => void;
}

type Estado =
  | { fase: 'cargando' }
  | { fase: 'error'; mensaje: string }
  | { fase: 'listo'; ficheros: FicheroGenerado[]; avisos: number };

export function PrevisualizarGeneracion({ proyecto, onCerrar }: Props) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .previsualizarGeneracion(proyecto.id)
      .then((respuesta) => {
        if (!vivo) return;
        setEstado({ fase: 'listo', ficheros: respuesta.ficheros, avisos: respuesta.avisos.length });
        /*
          Se abre el primero por defecto. Un panel de código vacío junto a una
          lista de cuarenta ficheros obliga a adivinar que hay que pulsar uno;
          con uno abierto, la interacción queda enseñada sin escribirla.
        */
        setAbierto(respuesta.ficheros[0]?.ruta ?? null);
      })
      .catch((error: unknown) => {
        if (!vivo) return;
        setEstado({
          fase: 'error',
          mensaje:
            error instanceof Error ? error.message : 'No se pudo previsualizar la generación',
        });
      });
    return () => {
      vivo = false;
    };
  }, [proyecto.id]);

  const ficheros = estado.fase === 'listo' ? estado.ficheros : [];
  const capas = useMemo(() => porCapas(ficheros), [ficheros]);
  const carpetas = useMemo(() => porCarpetas(ficheros), [ficheros]);
  const prefijo = useMemo(() => prefijoComun(ficheros.map((f) => f.ruta)), [ficheros]);
  const activo = ficheros.find((f) => f.ruta === abierto) ?? null;
  const totalBytes = ficheros.reduce((suma, f) => suma + f.bytes, 0);

  const bajar = async (): Promise<void> => {
    setBajando(true);
    try {
      const { avisos } = await descargarProyecto(proyecto.id, proyecto.name);
      setAviso(
        avisos > 0
          ? `Proyecto descargado con ${String(avisos)} aviso${avisos === 1 ? '' : 's'}.`
          : 'Proyecto descargado.',
      );
    } catch (error) {
      setAviso(error instanceof Error ? error.message : 'No se pudo generar el proyecto');
    } finally {
      setBajando(false);
    }
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Proyecto generado">
      <div className="modal__caja generado">
        <header className="generado__cabecera">
          <div>
            <h2>Proyecto generado</h2>
            <p className="generado__resumen">
              {estado.fase === 'listo'
                ? `${String(ficheros.length)} ficheros · ${tamaño(totalBytes)}`
                : 'Preparando…'}
            </p>
          </div>
          <div className="generado__acciones">
            <button
              type="button"
              className="boton boton--primario"
              disabled={estado.fase !== 'listo' || bajando}
              onClick={() => void bajar()}
            >
              {bajando ? 'Descargando…' : 'Descargar ZIP'}
            </button>
            <button
              type="button"
              className="boton boton--icono"
              aria-label="Cerrar"
              onClick={onCerrar}
            >
              <Icono nombre="cerrar" />
            </button>
          </div>
        </header>

        {estado.fase === 'cargando' && <p className="panel__vacio">Generando la vista previa…</p>}

        {estado.fase === 'error' && <p className="panel__error">{estado.mensaje}</p>}

        {estado.fase === 'listo' && (
          <>
            {/*
              El aviso de validación no impide generar —el servidor genera con
              avisos— pero tiene que verse antes de descargar, no después.
            */}
            {estado.avisos > 0 && (
              <p className="generado__avisos">
                <Icono nombre="alerta" /> La validación deja {estado.avisos} aviso
                {estado.avisos === 1 ? '' : 's'}. El proyecto se genera igualmente; los avisos no
                son errores.
              </p>
            )}

            {/*
              El reparto por capas: la respuesta a «¿están las cuatro capas y el
              DTO?» sin descomprimir nada. Se cuentan los ficheros que se van a
              escribir, no se afirma nada de antemano.
            */}
            <ul className="generado__capas">
              {capas.map((recuento) => (
                <li key={recuento.capa}>
                  <span className="generado__capa-nombre">{ROTULO_CAPA[recuento.capa]}</span>
                  <span className="generado__capa-cuenta">{recuento.ficheros}</span>
                </li>
              ))}
            </ul>

            {prefijo !== '' && (
              <p className="generado__prefijo">
                Todas las rutas cuelgan de <code>{prefijo}</code>
              </p>
            )}

            <div className="generado__cuerpo">
              <nav className="generado__arbol" aria-label="Ficheros generados">
                {carpetas.map((carpeta) => (
                  <div key={carpeta.carpeta} className="generado__carpeta">
                    <p className="generado__carpeta-nombre">
                      {carpeta.carpeta === '' ? 'raíz' : carpeta.carpeta}
                    </p>
                    {carpeta.ficheros.map((fichero) => (
                      <button
                        key={fichero.ruta}
                        type="button"
                        className={`generado__fichero${
                          fichero.ruta === abierto ? ' generado__fichero--activo' : ''
                        }`}
                        aria-current={fichero.ruta === abierto}
                        onClick={() => setAbierto(fichero.ruta)}
                      >
                        <span className="generado__fichero-nombre">{nombreDe(fichero.ruta)}</span>
                        <span className="generado__fichero-tamano">{tamaño(fichero.bytes)}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </nav>

              {/*
                El código va en un `<pre>` sin coloreado. Un resaltador de
                sintaxis para Java, XML, SQL y properties son cuatro gramáticas
                y una dependencia nueva para que un fichero que se va a leer una
                vez salga en colores; el contenido se lee igual en monoespaciada.
              */}
              <div className="generado__codigo">
                {activo ? (
                  <>
                    <p className="generado__codigo-ruta">{activo.ruta}</p>
                    <pre>
                      <code>{activo.contenido}</code>
                    </pre>
                  </>
                ) : (
                  <p className="panel__vacio">Elija un fichero de la lista.</p>
                )}
              </div>
            </div>
          </>
        )}

        {aviso !== null && <p className="generado__nota">{aviso}</p>}
      </div>
    </div>
  );
}
