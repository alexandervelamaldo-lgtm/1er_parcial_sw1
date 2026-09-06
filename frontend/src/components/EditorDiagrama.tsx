import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  diagramaAXmi,
  type ClassKind,
  type ContextoCambio,
  type Operation,
  type RelationKind,
} from '@app/shared';
import { useDiagrama } from '../hooks/useDiagrama';
import { usePresencia } from '../hooks/usePresencia';
import { usePantallaEstrecha, useTecladoFisico } from '../hooks/useDispositivo';
import { usePaneles } from '../hooks/usePaneles';
import { useTema } from '../hooks/useTema';
import { useSesion } from '../services/sesion';
import { type Proyecto } from '../services/api';
import type { OrdenVista } from './Lienzo';
import { LienzoFlow } from './LienzoFlow';
import { PanelPropiedades } from './PanelPropiedades';
import { Asistente } from './Asistente';
import { ImportarDiagrama } from './ImportarDiagrama';
import { ImportarXmi } from './ImportarXmi';
import { PrevisualizarGeneracion } from './PrevisualizarGeneracion';
import { CatalogoModulos } from './CatalogoModulos';
import { VisorComunicacion } from './VisorComunicacion';
import { HistorialCambios } from './HistorialCambios';
import { ColumnaAcoplada } from './PanelAcoplado';
import type { Acoplado, EstadoColumna } from './paneles';
import { ArbolProyecto } from './ArbolProyecto';
import { Paleta } from './Paleta';
import { BarraEstado } from './BarraEstado';
import { BarraMenu } from './BarraMenu';
import type { MenuDesplegable } from './barra-menu';
import { Icono } from './iconos';

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

/**
 * Cómo se llama lo que se acaba de crear.
 *
 * El nombre por defecto era «Clase{n}» para los cuatro tipos, y un diagrama con
 * «Clase3» que resulta ser una enumeración se lee mal desde el primer minuto.
 * Se numera con el total de clases del diagrama, no con las de su tipo: así dos
 * elementos distintos nunca comparten número y no hay que buscar cuál es cuál.
 */
/** El ancho de una columna en la rejilla: lo que mide, o el riel si está plegada. */
function anchoColumna(columna: EstadoColumna): string {
  return columna.plegada ? 'var(--riel-ancho)' : `${String(columna.ancho)}px`;
}

const PREFIJO: Record<ClassKind, string> = {
  class: 'Clase',
  interface: 'Interfaz',
  abstract: 'Abstracta',
  enum: 'Enumeracion',
};

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
  // Se le pasa `autor` entero, con id: el color de presencia se reparte por
  // identidad, no por conexión, para que sea el mismo tras recargar.
  const { participantes, anunciar } = usePresencia(estado.provider, autor);

  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [herramienta, setHerramienta] = useState<'seleccion' | 'relacion'>('seleccion');
  const [tipoRelacion, setTipoRelacion] = useState<RelationKind>('association');
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [importando, setImportando] = useState(false);
  const [importandoXmi, setImportandoXmi] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [modulos, setModulos] = useState(false);
  const [comunicacion, setComunicacion] = useState(false);
  const ultimoCursor = useRef(0);

  // El encuadre se pide como una acción numerada; el lienzo la atiende una vez y
  // sigue siendo el dueño de su vista. Ver `OrdenVista`.
  const [orden, setOrden] = useState<OrdenVista | null>(null);
  const [escala, setEscala] = useState(1);
  const serie = useRef(0);

  const estrecha = usePantallaEstrecha();
  const hayTeclado = useTecladoFisico();
  const paneles = usePaneles(proyecto.id);
  const { tema, alternar: alternarTema } = useTema();

  const pedirZoom = useCallback((tipo: 'acercar' | 'alejar' | 'ajustar') => {
    serie.current += 1;
    setOrden({ tipo, n: serie.current });
  }, []);

  const centrar = useCallback((ids: string[]) => {
    serie.current += 1;
    setOrden({ tipo: 'centrar', ids, n: serie.current });
  }, []);

  /*
    La barra ocupaba tres filas en un teléfono y solo una de las tres se usaba
    mientras se dibuja: las otras dos —traer y llevarse ficheros, ver el
    historial, generar el proyecto— son acciones de una vez por sesión que
    estaban cobrando alquiler permanente en la parte de la pantalla donde debería
    estar el diagrama. Se resolvió con un botón «Más» que las plegaba.

    Con el menú ese apaño sobra. Esas órdenes viven ahora en Archivo y en Ver, en
    el mismo sitio en el teléfono y en el escritorio, y la barra se queda con las
    cuatro que se pulsan a cada rato. Una organización sola en vez de dos.
  */

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
      if (soloLectura) return { ok: false as const, error: 'Permiso de solo lectura' };
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

  const crearClase = useCallback(
    (kind: ClassKind) => {
      // No se manda posición: colocarla es cosa de `addClass`, que ya sabe dónde
      // hay hueco. Había aquí una segunda rejilla, con otro paso y otro margen,
      // que hacía lo mismo un poco distinto —y solo la de `shared` aprendió a no
      // encimar las clases que dos personas crean a la vez sin conexión—.
      const n = Object.keys(estado.diagrama.classes).length;
      const resultado = aplicar([{ op: 'addClass', name: `${PREFIJO[kind]}${n + 1}`, kind }]);
      if (!resultado.ok) avisar(resultado.error);
    },
    [aplicar, avisar, estado.diagrama.classes],
  );

  /**
   * Arma la herramienta de relación, o la desarma si ya estaba con ese tipo.
   *
   * Volver a pulsar el botón que ya está hundido tiene que apagarlo: si no, la
   * única forma de salir del modo relación sería la tecla Escape, que en un
   * teléfono no existe.
   */
  const seleccionar = useCallback(() => setHerramienta('seleccion'), []);

  const armarRelacion = useCallback(
    (kind: RelationKind) => {
      if (herramienta === 'relacion' && tipoRelacion === kind) {
        setHerramienta('seleccion');
        return;
      }
      setTipoRelacion(kind);
      setHerramienta('relacion');
    },
    [herramienta, tipoRelacion],
  );

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

  /*
    Aquí estaba `descargar`, que bajaba el ZIP en cuanto se pulsaba la orden del
    menú. Ya no: la orden abre `PrevisualizarGeneracion`, y el botón de descarga
    vive dentro de esa pantalla, junto a los ficheros que se van a escribir.

    El cambio no es de comodidad. Descargar a ciegas significaba que un paquete
    base mal escrito o una entidad que el validador dejó fuera no se veían hasta
    descomprimir el ZIP y abrir un editor —y en una defensa, no se veían nunca—.
  */

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

  /**
   * El menú.
   *
   * Reúne en cinco listas todo lo que la aplicación sabe hacer, incluido lo que
   * antes solo existía como botón en la barra o como atajo que había que saberse.
   * Un menú no es decoración de escritorio: es el único sitio donde alguien que
   * abre el programa por primera vez puede leer el repertorio completo sin que
   * nadie se lo cuente, y donde se aprenden los atajos —van escritos al lado de
   * su orden, y por eso hay una columna para ellos—.
   *
   * No hay ninguna orden inventada: cada una llama a una función que ya existía.
   * Un menú con entradas que no hacen nada es peor que no tener menú.
   */
  const menus = useMemo(
    (): MenuDesplegable[] => [
      {
        id: 'archivo',
        etiqueta: 'Archivo',
        comandos: [
          {
            id: 'importar-imagen',
            etiqueta: 'Importar desde imagen…',
            icono: 'imagen',
            deshabilitado: soloLectura,
          },
          {
            id: 'importar-xmi',
            etiqueta: 'Importar XMI…',
            icono: 'importar',
            deshabilitado: soloLectura,
          },
          // Exportar no cambia nada, así que también lo puede hacer quien solo
          // tiene permiso de lectura: se lleva una copia, no toca el original.
          { id: 'exportar-xmi', etiqueta: 'Exportar XMI', icono: 'exportar' },
          // Con puntos suspensivos porque ya no descarga: abre la
          // previsualización, y desde ahí se decide si se descarga.
          {
            id: 'generar',
            etiqueta: 'Generar proyecto Spring Boot…',
            separadorAntes: true,
          },
          { id: 'salir', etiqueta: 'Volver a proyectos', icono: 'atras', separadorAntes: true },
        ],
      },
      {
        id: 'edicion',
        etiqueta: 'Edición',
        comandos: [
          {
            id: 'deshacer',
            etiqueta: 'Deshacer',
            icono: 'deshacer',
            // El atajo solo se anuncia si hay teclado físico. En un teléfono,
            // «Ctrl+Z» es una instrucción que no se puede seguir.
            atajo: hayTeclado ? 'Ctrl+Z' : undefined,
          },
          {
            id: 'rehacer',
            etiqueta: 'Rehacer',
            icono: 'rehacer',
            atajo: hayTeclado ? 'Ctrl+Mayús+Z' : undefined,
          },
          {
            id: 'eliminar',
            etiqueta: 'Eliminar la clase seleccionada',
            atajo: hayTeclado ? 'Supr' : undefined,
            separadorAntes: true,
            deshabilitado: soloLectura || seleccion === null,
          },
        ],
      },
      {
        id: 'ver',
        etiqueta: 'Ver',
        comandos: [
          // Estos cuatro dicen un estado, no ejecutan algo: salen con casilla y
          // se anuncian con `aria-checked`.
          { id: 'ver:arbol', etiqueta: 'Explorador', marcado: paneles.disposicion.abiertos.arbol },
          { id: 'ver:paleta', etiqueta: 'Paleta', marcado: paneles.disposicion.abiertos.paleta },
          {
            id: 'ver:propiedades',
            etiqueta: 'Propiedades',
            marcado: paneles.disposicion.abiertos.propiedades,
          },
          {
            id: 'ver:historial',
            etiqueta: 'Historial de cambios',
            icono: 'historial',
            marcado: paneles.disposicion.abiertos.historial,
          },
          { id: 'zoom:acercar', etiqueta: 'Acercar', separadorAntes: true },
          { id: 'zoom:alejar', etiqueta: 'Alejar' },
          { id: 'zoom:ajustar', etiqueta: 'Encuadrar el diagrama' },
          {
            id: 'tema',
            etiqueta: 'Tema claro',
            icono: tema === 'oscuro' ? 'tema-claro' : 'tema-oscuro',
            separadorAntes: true,
            marcado: tema === 'claro',
          },
        ],
      },
      {
        id: 'modelo',
        etiqueta: 'Modelo',
        comandos: [
          { id: 'nueva:class', etiqueta: 'Nueva clase', icono: 'clase', deshabilitado: soloLectura },
          {
            id: 'nueva:interface',
            etiqueta: 'Nueva interfaz',
            icono: 'interfaz',
            deshabilitado: soloLectura,
          },
          {
            id: 'nueva:abstract',
            etiqueta: 'Nueva clase abstracta',
            icono: 'abstracta',
            deshabilitado: soloLectura,
          },
          {
            id: 'nueva:enum',
            etiqueta: 'Nueva enumeración',
            icono: 'enumeracion',
            deshabilitado: soloLectura,
          },
          {
            id: 'modulos',
            etiqueta: 'Módulos del proyecto…',
            icono: 'modulo',
            separadorAntes: true,
          },
          // En «Modelo» y no en «Ver» porque no enseña este diagrama desde otro
          // ángulo: enseña el backend que saldría de él.
          {
            id: 'comunicacion',
            etiqueta: 'Diagrama de comunicación…',
            icono: 'comunicacion',
          },
        ],
      },
    ],
    [hayTeclado, paneles.disposicion.abiertos, seleccion, soloLectura, tema],
  );

  const ejecutar = useCallback(
    (id: string) => {
      if (id.startsWith('ver:')) {
        paneles.alternar(id.slice(4) as Acoplado);
        return;
      }
      if (id.startsWith('zoom:')) {
        pedirZoom(id.slice(5) as 'acercar' | 'alejar' | 'ajustar');
        return;
      }
      if (id.startsWith('nueva:')) {
        crearClase(id.slice(6) as ClassKind);
        return;
      }
      switch (id) {
        case 'importar-imagen':
          setImportando(true);
          return;
        case 'importar-xmi':
          setImportandoXmi(true);
          return;
        case 'exportar-xmi':
          exportarXmi();
          return;
        case 'generar':
          setGenerando(true);
          return;
        case 'modulos':
          setModulos(true);
          return;
        case 'comunicacion':
          setComunicacion(true);
          return;
        case 'salir':
          onSalir();
          return;
        case 'deshacer':
          estado.deshacer();
          return;
        case 'rehacer':
          estado.rehacer();
          return;
        case 'eliminar': {
          if (seleccion === null) return;
          const resultado = aplicar([{ op: 'removeClass', ref: { id: seleccion } }]);
          if (resultado.ok) setSeleccion(null);
          else avisar(resultado.error);
          return;
        }
        case 'tema':
          alternarTema();
          return;
        default:
          return;
      }
    },
    // `exportarXmi` se redefine en cada pintado y no se puede
    // memorizar sin arrastrar medio componente a sus dependencias; el menú se
    // rehace igualmente cuando cambia lo que sí importa.
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    [alternarTema, aplicar, avisar, crearClase, estado, onSalir, paneles, pedirZoom, seleccion],
  );

  return (
    <div className="editor">
      <header className="barra">
        <BarraMenu menus={menus} onComando={ejecutar} />
        <h1 className="barra__titulo">{proyecto.name}</h1>

        {/*
          La barra de herramientas, ahora que hay menú.

          Deja de ser el catálogo de todo lo que se puede hacer —de eso se ocupa
          el menú— y se queda con lo que se pulsa muchas veces en la misma sesión:
          deshacer, rehacer y las dos columnas. Son órdenes de un solo icono, sin
          rótulo, porque se reconocen por su sitio: el que las usa no las lee, las
          señala. Lo que se hace una vez por sesión —importar una foto, generar el
          proyecto— vive en el menú, donde se busca por su nombre.

          Nada de lo que hay aquí es exclusivo de la barra: todo tiene su entrada
          de menú y su atajo. Una barra de herramientas es un acceso rápido, no la
          única puerta.
        */}
        <div className="barra__herramientas" role="group" aria-label="Herramientas del diagrama">
          <div className="barra__grupo">
            {/* Con `title` a secas, un lector de pantalla anuncia el icono y nada
                más. La etiqueta accesible dice el verbo. */}
            <button
              type="button"
              className="boton boton--icono"
              onClick={estado.deshacer}
              aria-label="Deshacer"
              title={hayTeclado ? 'Deshacer (Ctrl+Z)' : 'Deshacer'}
            >
              <Icono nombre="deshacer" />
            </button>
            <button
              type="button"
              className="boton boton--icono"
              onClick={estado.rehacer}
              aria-label="Rehacer"
              title={hayTeclado ? 'Rehacer (Ctrl+Mayús+Z)' : 'Rehacer'}
            >
              <Icono nombre="rehacer" />
            </button>
          </div>

          {/*
            Mostrar y ocultar las columnas.

            Las canaletas ya pliegan con doble clic y los rieles vuelven a abrir,
            pero las dos cosas hay que descubrirlas. Estos dos botones dicen que
            los paneles se pueden quitar de en medio, que es lo primero que quiere
            hacer quien viene a mirar un diagrama en una pantalla pequeña.

            Se dejan de renderizar en vez de esconderse con CSS: un botón con
            `display:none` sigue en el árbol, y hay lectores de pantalla y
            recorridos de tabulación que lo encuentran igualmente. Aquí lo que se
            quiere decir es «esta acción no está ahora», no «no se ve».
          */}
          {!estrecha && (
            <div className="barra__grupo">
              <button
                type="button"
                className={`boton boton--icono${paneles.disposicion.izquierda.plegada ? '' : ' boton--activo'}`}
                aria-pressed={!paneles.disposicion.izquierda.plegada}
                onClick={() => paneles.alternarLado('izquierda')}
                aria-label="Mostrar u ocultar los paneles de la izquierda"
                title="Explorador y paleta"
              >
                <Icono nombre="columna-izquierda" />
              </button>
              <button
                type="button"
                className={`boton boton--icono${paneles.disposicion.derecha.plegada ? '' : ' boton--activo'}`}
                aria-pressed={!paneles.disposicion.derecha.plegada}
                onClick={() => paneles.alternarLado('derecha')}
                aria-label="Mostrar u ocultar los paneles de la derecha"
                title="Propiedades e historial"
              >
                <Icono nombre="columna-derecha" />
              </button>
            </div>
          )}

          {/*
            Aquí había un botón «Más» que desplegaba en el móvil los grupos que
            no cabían. Sobra desde que hay menú: el menú ya es esa segunda capa, y
            además es la misma en el teléfono y en el escritorio, así que no hay
            dos organizaciones distintas que aprender según el aparato.
          */}
        </div>
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
            <Icono nombre="cerrar" />
          </button>
        </div>
      )}

      {soloLectura && (
        <div className="aviso aviso--lectura">
          Permiso de solo lectura. El diagrama se ve y se actualiza con los cambios de los demás,
          pero no admite modificaciones.
        </div>
      )}

      {/*
        Tres columnas y no un flex de dos hijos. La diferencia práctica es que
        los anchos son del contenedor y no de los paneles: el lienzo se queda con
        `minmax(0, 1fr)` —el `minmax` importa, porque un `1fr` a secas no baja del
        tamaño de su contenido y el SVG empujaría las columnas fuera de la
        pantalla— y plegar una columna le devuelve su ancho entero sin que nadie
        recalcule nada.

        Lo que se pasa desde aquí son dos variables, no la rejilla entera: en
        pantalla estrecha la hoja de estilos monta el mismo cuerpo de otra manera
        —la columna abierta se superpone al lienzo en vez de quitarle ancho— y
        con la plantilla escrita en el `style` no habría forma de que la
        cambiara.
      */}
      <main
        className="editor__cuerpo"
        ref={paneles.cuerpo}
        style={
          {
            '--ancho-izquierda': anchoColumna(paneles.disposicion.izquierda),
            '--ancho-derecha': anchoColumna(paneles.disposicion.derecha),
          } as CSSProperties
        }
      >
        <ColumnaAcoplada
          lado="izquierda"
          control={paneles}
          paneles={[
            {
              acoplado: 'arbol',
              contenido: (
                <ArbolProyecto
                  diagrama={estado.diagrama}
                  nombreProyecto={proyecto.name}
                  seleccion={seleccion}
                  onSeleccionar={setSeleccion}
                  onCentrar={centrar}
                />
              ),
            },
            {
              acoplado: 'paleta',
              contenido: (
                <Paleta
                  soloLectura={soloLectura}
                  herramienta={herramienta}
                  tipoRelacion={tipoRelacion}
                  onCrear={crearClase}
                  onArmarRelacion={armarRelacion}
                  onSeleccionar={seleccionar}
                />
              ),
            },
          ]}
        />

        <LienzoFlow
          diagrama={estado.diagrama}
          seleccion={seleccion}
          participantes={participantes}
          soloLectura={soloLectura}
          herramienta={herramienta}
          onSeleccionar={setSeleccion}
          onMover={(id, x, y) => aplicar([{ op: 'moveClass', ref: { id }, position: { x, y } }])}
          onCursor={alMoverCursor}
          onRelacionar={relacionar}
          orden={orden}
          onEscala={setEscala}
        />

        <ColumnaAcoplada
          lado="derecha"
          control={paneles}
          paneles={[
            {
              acoplado: 'propiedades',
              contenido: (
                <PanelPropiedades
                  diagrama={estado.diagrama}
                  clase={claseSeleccionada}
                  soloLectura={soloLectura}
                  historial={estado.historial}
                  aplicar={aplicar}
                />
              ),
            },
            {
              acoplado: 'historial',
              contenido: <HistorialCambios historial={estado.historial} />,
            },
          ]}
        />
      </main>

      <BarraEstado
        escala={escala}
        onAcercar={() => pedirZoom('acercar')}
        onAlejar={() => pedirZoom('alejar')}
        onAjustar={() => pedirZoom('ajustar')}
        estado={estado.conexion}
        detalle={estado.detalleConexion}
        sincronizado={estado.sincronizado}
        participantes={participantes}
        clase={claseSeleccionada}
        clases={Object.keys(estado.diagrama.classes).length}
        relaciones={Object.keys(estado.diagrama.relations).length}
      />

      <Asistente
        proyectoId={proyecto.id}
        soloLectura={soloLectura}
        diagrama={estado.diagrama}
        aplicar={aplicar}
      />

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

      {generando && (
        <PrevisualizarGeneracion proyecto={proyecto} onCerrar={() => setGenerando(false)} />
      )}

      {modulos && (
        <CatalogoModulos
          diagrama={estado.diagrama}
          aplicar={aplicar}
          soloLectura={soloLectura}
          onCerrar={() => setModulos(false)}
        />
      )}

      {comunicacion && (
        <VisorComunicacion diagrama={estado.diagrama} onCerrar={() => setComunicacion(false)} />
      )}
    </div>
  );
}
