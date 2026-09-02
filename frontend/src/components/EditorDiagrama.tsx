import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  diagramaAXmi,
  type ContextoCambio,
  type Operation,
  type RelationKind,
} from '@app/shared';
import { useDiagrama } from '../hooks/useDiagrama';
import { usePresencia } from '../hooks/usePresencia';
import { usePantallaEstrecha, useTecladoFisico } from '../hooks/useDispositivo';
import { useSesion } from '../services/sesion';
import { descargarProyecto, type Proyecto } from '../services/api';
import { Lienzo } from './Lienzo';
import { PanelPropiedades } from './PanelPropiedades';
import { IndicadorSync } from './IndicadorSync';
import { Asistente } from './Asistente';
import { ImportarDiagrama } from './ImportarDiagrama';
import { ImportarXmi } from './ImportarXmi';
import { HistorialCambios } from './HistorialCambios';

/**
 * La pantalla de edición.
 *
 * Aquí no hay lógica de dominio: se limita a conectar el documento colaborativo
 * con los tres componentes que lo muestran y a traducir gestos —arrastrar,
 * pulsar, hablar— en operaciones. Todo lo que decide qué es válido está en
 * `shared`, y por eso el servidor puede aplicar exactamente las mismas
 * operaciones sin compartir una línea de esta interfaz.
 */

/**
 * Lo que dice la banda de aviso, y si además ofrece deshacerlo.
 *
 * El `deshacer` no es un adorno. Antes, tras importar un diagrama entero, el
 * aviso decía «Ctrl+Z lo deshace entero», que en un teléfono es una instrucción
 * imposible de seguir. La respuesta no fue reescribir la frase para el móvil
 * sino darse cuenta de que deshacer es una acción y estaba redactada como una
 * nota al pie: con el botón delante, la frase sobra en cualquier aparato.
 */
interface Aviso {
  texto: string;
  deshacer?: boolean;
}

const TIPOS_RELACION: { valor: RelationKind; etiqueta: string }[] = [
  { valor: 'association', etiqueta: 'Asociación' },
  { valor: 'aggregation', etiqueta: 'Agregación' },
  { valor: 'composition', etiqueta: 'Composición' },
  { valor: 'inheritance', etiqueta: 'Herencia' },
  { valor: 'realization', etiqueta: 'Realización' },
  { valor: 'dependency', etiqueta: 'Dependencia' },
];

export function EditorDiagrama({
  proyecto,
  onSalir,
}: {
  proyecto: Proyecto;
  onSalir: () => void;
}): JSX.Element {
  const { usuario } = useSesion();

  // El nombre que firma los cambios es el mismo que se muestra en presencia: si
  // el cursor de al lado dice «Ana» y el historial dijera «ana@…», haría falta
  // saber que son la misma persona para poder leer una cosa a la luz de la otra.
  const autor = useMemo(
    () => (usuario ? { id: usuario.id, nombre: usuario.displayName || usuario.email } : null),
    [usuario],
  );

  const estado = useDiagrama(proyecto.id, autor);
  const { participantes, anunciar } = usePresencia(
    estado.provider,
    usuario ? { nombre: usuario.displayName || usuario.email } : null,
  );

  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [herramienta, setHerramienta] = useState<'seleccion' | 'relacion'>('seleccion');
  const [tipoRelacion, setTipoRelacion] = useState<RelationKind>('association');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [importando, setImportando] = useState(false);
  const [importandoXmi, setImportandoXmi] = useState(false);
  const [viendoHistorial, setViendoHistorial] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const ultimoCursor = useRef(0);

  const estrecha = usePantallaEstrecha();
  const hayTeclado = useTecladoFisico();

  /*
    La barra ocupaba tres filas en un teléfono, siempre, y solo una de las tres
    se usa mientras se dibuja. Las otras dos —traer y llevarse ficheros, ver el
    historial, generar el proyecto— son acciones de una vez por sesión que
    estaban cobrando alquiler permanente en la parte de la pantalla donde debería
    estar el diagrama.

    Se pliegan en vez de esconderse en un menú aparte: al desplegar aparecen en
    su sitio de siempre, con los mismos grupos y en el mismo orden, así que no
    hay una segunda organización que aprender ni una lista donde buscarlas. Y
    quedan a un toque, no a un gesto que haya que descubrir.

    Deshacer y rehacer se quedan fuera del pliegue: se usan mientras se dibuja,
    que es exactamente cuando la barra está plegada.
  */
  const plegable = estrecha && !menuAbierto;

  // La mayoría de los avisos son una frase y ya está. Se le pone nombre para no
  // repetir el objeto en las nueve llamadas y para que las dos que sí llevan
  // acción se distingan de un vistazo.
  const avisar = useCallback((texto: string) => setAviso({ texto }), []);

  // Un usuario con permiso de lectura ve todo y no cambia nada. El servidor lo
  // impone de todos modos; deshabilitarlo aquí evita que descubra que no puede
  // después de haber escrito, que es la peor forma de enterarse.
  const soloLectura = proyecto.role === 'viewer' || estado.conexion === 'sin-permiso';

  const aplicar = useCallback(
    (operaciones: Operation[], contexto?: ContextoCambio) => {
      if (soloLectura) return { ok: false as const, error: 'Solo tienes permiso de lectura' };
      return estado.aplicar(operaciones, contexto);
    },
    [estado, soloLectura],
  );

  useEffect(() => anunciar({ seleccion }), [seleccion, anunciar]);

  const alMoverCursor = useCallback(
    (punto: { x: number; y: number } | null) => {
      // El cursor se anuncia como mucho veinte veces por segundo. Sin ese límite
      // se manda un mensaje por cada píxel recorrido: no lo nota quien mueve el
      // ratón, lo notan los demás, cuyo navegador tiene que aplicarlos todos.
      const ahora = Date.now();
      if (punto && ahora - ultimoCursor.current < 50) return;
      ultimoCursor.current = ahora;
      anunciar({ cursor: punto });
    },
    [anunciar],
  );

  const crearClase = useCallback(() => {
    // No se manda posición: colocarla es cosa de `addClass`, que ya sabe dónde
    // hay hueco. Había aquí una segunda rejilla, con otro paso y otro margen,
    // que hacía lo mismo un poco distinto —y solo la de `shared` aprendió a no
    // encimar las clases que dos personas crean a la vez sin conexión—.
    const n = Object.keys(estado.diagrama.classes).length;
    const resultado = aplicar([{ op: 'addClass', name: `Clase${n + 1}`, kind: 'class' }]);
    if (!resultado.ok) avisar(resultado.error);
  }, [aplicar, avisar, estado.diagrama.classes]);

  const relacionar = useCallback(
    (origenId: string, destinoId: string) => {
      // Se nace en «uno a muchos» para todo lo que tiene cardinalidad, no solo
      // para la asociación: una agregación o una composición uno a uno es rara
      // —un pedido tiene líneas, en plural—, y el caso raro se corrige en el
      // panel con un desplegable. Al revés, el caso frecuente obligaba a
      // corregir siempre. La herencia se queda en 1:1 porque no tiene extremos
      // que contar.
      const conCardinalidad = tipoRelacion !== 'inheritance' && tipoRelacion !== 'realization';
      const resultado = aplicar([
        {
          op: 'addRelation',
          kind: tipoRelacion,
          source: { id: origenId },
          target: { id: destinoId },
          sourceMultiplicity: '1',
          targetMultiplicity: conCardinalidad ? '*' : '1',
        },
      ]);
      if (!resultado.ok) avisar(resultado.error);
      else setHerramienta('seleccion');
    },
    [aplicar, avisar, tipoRelacion],
  );

  // Atajos. Se ignoran mientras se escribe en un campo: si no, teclear el nombre
  // de una clase con una «s» dispararía el atajo en vez de escribir la letra.
  useEffect(() => {
    const alPulsar = (evento: KeyboardEvent): void => {
      const destino = evento.target as HTMLElement | null;
      if (destino && /^(INPUT|TEXTAREA|SELECT)$/.test(destino.tagName)) return;

      if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'z') {
        evento.preventDefault();
        if (evento.shiftKey) estado.rehacer();
        else estado.deshacer();
        return;
      }
      if (evento.key === 'Escape') {
        setHerramienta('seleccion');
        setSeleccion(null);
      }
      if (evento.key === 'Delete' && seleccion && !soloLectura) {
        const resultado = aplicar([{ op: 'removeClass', ref: { id: seleccion } }]);
        if (resultado.ok) setSeleccion(null);
      }
    };

    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [estado, seleccion, soloLectura, aplicar]);

  const descargar = async (): Promise<void> => {
    try {
      const { avisos } = await descargarProyecto(proyecto.id, proyecto.name);
      avisar(
        avisos > 0
          ? `Proyecto descargado con ${avisos} aviso${avisos === 1 ? '' : 's'}.`
          : 'Proyecto descargado.',
      );
    } catch (error) {
      avisar(error instanceof Error ? error.message : 'No se pudo generar el proyecto');
    }
  };

  /**
   * Exportar el diagrama a XMI (RF-DIAG-12).
   *
   * No pasa por el servidor: el fichero se arma aquí con el diagrama que ya
   * tenemos en memoria, de modo que funciona sin conexión y no hay una segunda
   * versión de la verdad que pueda quedar desfasada respecto a lo que se ve.
   */
  const exportarXmi = (): void => {
    try {
      const xmi = diagramaAXmi(estado.diagrama);
      // `application/xml` y no `text/xml`: así el navegador lo descarga en vez
      // de intentar renderizarlo en una pestaña.
      const blob = new Blob([xmi], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const enlace = document.createElement('a');
      enlace.href = url;
      // El nombre del proyecto lo escribe una persona y acaba siendo un nombre
      // de fichero. Nos quedamos con lo que es seguro en cualquier sistema en
      // lugar de confiar en que el navegador lo arregle.
      const nombre = proyecto.name.replace(/[^A-Za-z0-9 _.-]/g, '').trim();
      enlace.download = `${nombre || 'diagrama'}.xmi`;
      enlace.click();
      URL.revokeObjectURL(url);
      avisar('Diagrama exportado a XMI.');
    } catch (error) {
      avisar(error instanceof Error ? error.message : 'No se pudo exportar el diagrama');
    }
  };

  const claseSeleccionada = seleccion ? (estado.diagrama.classes[seleccion] ?? null) : null;

  return (
    <div className="editor">
      <header className="barra">
        <button type="button" className="boton boton--discreto" onClick={onSalir}>
          ← Proyectos
        </button>
        <h1 className="barra__titulo">{proyecto.name}</h1>

        {/*
          Cuatro grupos, no ocho botones: dibujar (crear clases y unirlas),
          traer y llevarse (imagen y XMI), deshacer, y la acción que produce el
          resultado del trabajo. Antes todos tenían el mismo peso visual y había
          que leer las ocho etiquetas para encontrar una; ahora se busca primero
          el bloque, que se distingue por su sitio, y dentro hay dos o tres.
        */}
        <div className="barra__herramientas" role="group" aria-label="Herramientas del diagrama">
          <div className="barra__grupo">
            <button type="button" className="boton" disabled={soloLectura} onClick={crearClase}>
              + Clase
            </button>

            <div className="grupo-relacion">
              <button
                type="button"
                className={`boton${herramienta === 'relacion' ? ' boton--activo' : ''}`}
                disabled={soloLectura}
                aria-pressed={herramienta === 'relacion'}
                onClick={() =>
                  setHerramienta(herramienta === 'relacion' ? 'seleccion' : 'relacion')
                }
                title="Arrastra de una clase a otra para relacionarlas"
              >
                ↗ Relación
              </button>
              <select
                value={tipoRelacion}
                disabled={soloLectura}
                aria-label="Tipo de la relación que se va a trazar"
                onChange={(e) => setTipoRelacion(e.target.value as RelationKind)}
              >
                {TIPOS_RELACION.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Se deja de renderizar en vez de esconderse con CSS: un botón con
              `display:none` sigue en el árbol, y hay lectores de pantalla y
              recorridos de tabulación que lo encuentran igualmente. Aquí lo que
              se quiere decir es «esta acción no está ahora», no «no se ve». */}
          {!plegable && (
            <div className="barra__grupo">
              <button
                type="button"
                className="boton"
                disabled={soloLectura}
                onClick={() => setImportando(true)}
                title="Leer un diagrama de clases de una imagen y revisarlo antes de importarlo"
              >
                🖼 Desde imagen
              </button>

              <button
                type="button"
                className="boton"
                disabled={soloLectura}
                onClick={() => setImportandoXmi(true)}
                title="Leer un fichero XMI y revisarlo antes de importarlo"
              >
                ⤒ Importar XMI
              </button>

              {/* Exportar no cambia nada, así que también lo puede hacer quien
                  solo tiene permiso de lectura: se lleva una copia, no toca el
                  original. Va después de importar porque las dos entradas de
                  datos —la foto y el fichero— se buscan juntas. */}
              <button
                type="button"
                className="boton"
                onClick={exportarXmi}
                title="Descargar el diagrama como fichero XMI 2.1 (UML 2.x)"
              >
                ⤓ Exportar XMI
              </button>
            </div>
          )}

          <div className="barra__grupo">
            {/* Con `title` a secas, un lector de pantalla anuncia el carácter
                «↶» y nada más. La etiqueta accesible dice el verbo. */}
            <button
              type="button"
              className="boton"
              onClick={estado.deshacer}
              aria-label="Deshacer"
              title={hayTeclado ? 'Deshacer (Ctrl+Z)' : 'Deshacer'}
            >
              ↶
            </button>
            <button
              type="button"
              className="boton"
              onClick={estado.rehacer}
              aria-label="Rehacer"
              title={hayTeclado ? 'Rehacer (Ctrl+Mayús+Z)' : 'Rehacer'}
            >
              ↷
            </button>

            {/* Va con deshacer y rehacer porque los tres miran al pasado: los dos
                primeros lo cambian, este solo lo cuenta. Pero al pasado se mira
                de vez en cuando y se deshace a cada rato, así que en un móvil
                este se pliega y los otros dos no. */}
            {!plegable && (
              <button
                type="button"
                className="boton"
                onClick={() => setViendoHistorial(true)}
                aria-label="Historial de cambios"
                title="Ver quién ha cambiado qué"
              >
                🕘
              </button>
            )}
          </div>

          {!plegable && (
            <div className="barra__grupo">
              <button
                type="button"
                className="boton boton--primario"
                onClick={() => void descargar()}
              >
                Generar Spring Boot
              </button>
            </div>
          )}

          {/*
            Solo en pantalla estrecha. En un escritorio la barra cabe entera y un
            botón que despliega lo que ya se ve sería un mando que no hace nada.

            Lleva la palabra «Más» y no solo los tres puntos: el icono a secas
            informa de que hay algo detrás, pero se lee como un menú de ajustes,
            y lo que hay detrás son acciones de trabajo —traer una foto, generar
            el proyecto—, no preferencias.
          */}
          {estrecha && (
            <div className="barra__grupo">
              <button
                type="button"
                className="boton barra__mas"
                aria-expanded={menuAbierto}
                onClick={() => setMenuAbierto(!menuAbierto)}
              >
                {menuAbierto ? '✕ Menos' : '⋯ Más'}
              </button>
            </div>
          )}
        </div>

        <IndicadorSync
          estado={estado.conexion}
          detalle={estado.detalleConexion}
          sincronizado={estado.sincronizado}
          participantes={participantes}
        />
      </header>

      {/*
        Antes la banda entera cerraba al tocarla. Era cómodo y era inalcanzable
        con el teclado —un `div` con `onClick` no recibe foco—, y además dejaba de
        poder usarse en cuanto la banda tuvo dentro un botón: el toque destinado
        a «Deshacer» que se queda un píxel corto cerraba el aviso y se llevaba por
        delante la única forma de deshacer la importación. Un botón explícito de
        cerrar cuesta un icono y resuelve las dos cosas.
      */}
      {aviso && (
        <div className="aviso" role="status">
          <span className="aviso__texto">{aviso.texto}</span>
          {aviso.deshacer && (
            <button
              type="button"
              className="boton aviso__accion"
              onClick={() => {
                estado.deshacer();
                setAviso(null);
              }}
            >
              Deshacer
            </button>
          )}
          <button
            type="button"
            className="aviso__cerrar"
            aria-label="Cerrar aviso"
            onClick={() => setAviso(null)}
          >
            ×
          </button>
        </div>
      )}

      {soloLectura && (
        <div className="aviso aviso--lectura">
          Solo tienes permiso de lectura: puedes ver el diagrama y seguir los cambios de los demás.
        </div>
      )}

      <main className="editor__cuerpo">
        <Lienzo
          diagrama={estado.diagrama}
          seleccion={seleccion}
          participantes={participantes}
          soloLectura={soloLectura}
          herramienta={herramienta}
          onSeleccionar={setSeleccion}
          onMover={(id, x, y) => aplicar([{ op: 'moveClass', ref: { id }, position: { x, y } }])}
          onCursor={alMoverCursor}
          onRelacionar={relacionar}
        />

        <PanelPropiedades
          diagrama={estado.diagrama}
          clase={claseSeleccionada}
          soloLectura={soloLectura}
          historial={estado.historial}
          aplicar={aplicar}
        />
      </main>

      <Asistente
        proyectoId={proyecto.id}
        soloLectura={soloLectura}
        diagrama={estado.diagrama}
        aplicar={aplicar}
      />

      {viendoHistorial && (
        <HistorialCambios
          historial={estado.historial}
          onCerrar={() => setViendoHistorial(false)}
        />
      )}

      {importando && (
        <ImportarDiagrama
          proyectoId={proyecto.id}
          soloLectura={soloLectura}
          diagrama={estado.diagrama}
          aplicar={(operaciones) => {
            const resultado = aplicar(operaciones);
            if (resultado.ok) setAviso({ texto: 'Diagrama importado.', deshacer: true });
            return resultado;
          }}
          onCerrar={() => setImportando(false)}
        />
      )}

      {importandoXmi && (
        <ImportarXmi
          soloLectura={soloLectura}
          diagrama={estado.diagrama}
          aplicar={(operaciones) => {
            const resultado = aplicar(operaciones);
            if (resultado.ok) setAviso({ texto: 'XMI importado.', deshacer: true });
            return resultado;
          }}
          onCerrar={() => setImportandoXmi(false)}
        />
      )}
    </div>
  );
}
