import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  readComunicaciones,
  writeComunicacion,
  type ClassKind,
  type ContextoCambio,
  type Operation,
} from '@app/shared';
import { useDiagrama } from '../hooks/useDiagrama';
import { usePresencia } from '../hooks/usePresencia';
import { usePantalla } from '../hooks/usePantalla';
import { useSesion } from '../services/sesion';
import { type Proyecto } from '../services/api';
import { exportarXmiDelDiagrama } from '../services/exportar';
import { LienzoFlow } from './LienzoFlow';
import type { OrdenVista } from './Lienzo';
import { Asistente } from './Asistente';
import { PanelPropiedades } from './PanelPropiedades';
import { HistorialCambios } from './HistorialCambios';
import { ImportarDiagrama } from './ImportarDiagrama';
import { ImportarXmi } from './ImportarXmi';
import { PrevisualizarGeneracion } from './PrevisualizarGeneracion';
import { CatalogoModulos } from './CatalogoModulos';
import { VisorComunicacionImportada } from './VisorComunicacionImportada';
import { RevisionDiagrama } from './RevisionDiagrama';
import { DialogoCompartir } from './DialogoCompartir';
import { BarraMovil } from './BarraMovil';
import { BotonFlotante } from './BotonFlotante';
import { CajonMovil } from './CajonMovil';
import { HojaMovil } from './HojaMovil';
import { PresentesMovil } from './PresentesMovil';
import { PanelTablon } from './PanelTablon';
import { Icono } from './iconos';
import {
  DESDE_EL_PRINCIPIO,
  cambiosDeOtros,
  resumirCambios,
  suerteDeLaAbierta,
  textoDeLaSuerte,
} from './movil-ajenos';
import { repartir } from './movil-reparto';
import { accionMovil, type EstadoAcciones, type IdAccionMovil } from './movil-acciones';
import type { PosicionHoja } from './movil-hoja';
import {
  MS_MANTENIDO,
  QUIETO,
  cuentaAtrasViva,
  menuPedido,
  siguiente,
  type EstadoMantenido,
  type SucesoGesto,
} from './movil-gestos';
import './movil.css';

/**
 * El editor, hecho para el dedo.
 *
 * No es `EditorDiagrama` con otra hoja de estilos: es **otro árbol de
 * componentes** sobre el mismo documento. Lo que comparten es todo lo que importa
 * —`useDiagrama`, o sea el mismo `Y.Doc`, las mismas operaciones y la misma
 * validación de `shared`— y lo que no comparten es la forma, porque la del
 * escritorio no cabe: una barra de menú necesita un puntero que pueda recorrerla
 * sin taparla, y un árbol de proyecto necesita una columna que en 320 px no
 * existe.
 *
 * Dos personas editando el mismo proyecto, una en el portátil y otra aquí, no
 * notan que están en pantallas distintas: es el mismo documento y las mismas
 * reglas. Eso es lo que hace que esto sea una versión móvil y no una aplicación
 * aparte que además habría que mantener en sincronía a mano.
 *
 * ## Cómo se reparte la pantalla
 *
 * El diagrama ocupa todo, y lo demás sube desde abajo. En apaisado y en tablet la
 * misma ficha se pinta como panel lateral en vez de como hoja, y esa decisión no
 * está aquí: la toma `movil-reparto.ts` con las medidas de la ventana, y aquí solo
 * se lee el resultado. Por eso girar el teléfono cambia el sitio de la ficha sin
 * que haya una sola rama `if (esTablet)` en este fichero.
 *
 * ## Lo que no se reimplementa
 *
 * Pellizcar para el zoom, un dedo para desplazar, tocar para seleccionar y tirar
 * desde el borde de una caja para crear una relación **ya funcionan**: los trae
 * React Flow sobre eventos de puntero. El único gesto que falta es «mantener
 * pulsado», que React Flow no tiene —en un escritorio eso es el botón derecho— y
 * vive en `movil-gestos.ts` con sus 23 pruebas.
 */
export function PantallaMovil({
  proyecto,
  onSalir,
}: {
  proyecto: Proyecto;
  onSalir: () => void;
}): JSX.Element {
  const { usuario } = useSesion();

  const autor = useMemo(
    () => (usuario ? { id: usuario.id, nombre: usuario.displayName || usuario.email } : null),
    [usuario],
  );

  const estado = useDiagrama(proyecto.id, autor);
  const { participantes, anunciar } = usePresencia(estado.provider, autor);
  const pantalla = usePantalla();

  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [hoja, setHoja] = useState<PosicionHoja>('oculta');
  const [contenidoHoja, setContenidoHoja] = useState<
    'propiedades' | 'historial' | 'presentes' | 'asistente' | 'tablon'
  >('propiedades');
  /*
    Si el asistente tiene que abrir el micrófono él solo al aparecer. Es `true`
    únicamente cuando se llega desde el micrófono flotante, porque ahí el gesto
    del dedo **ya fue** la petición de hablar: pedir un segundo toque sobre el
    botón de dentro sería cobrar dos veces por la misma intención. Desde el cajón
    es `false`, porque «Dictar un cambio» ahí está entre otras entradas y quien
    lo toca puede estar solo echando un vistazo al panel.
  */
  const [dictarAlAbrir, setDictarAlAbrir] = useState(false);
  const [cajon, setCajon] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [orden, setOrden] = useState<OrdenVista | null>(null);
  const serie = useRef(0);

  // Las pantallas grandes se siguen reutilizando tal cual: son modales a pantalla
  // completa, que en un teléfono es exactamente la forma correcta. Reescribirlas
  // habría dado dos versiones de «importar XMI» y una de las dos se quedaría atrás.
  const [pantallaAparte, setPantallaAparte] = useState<
    'imagen' | 'xmi' | 'generar' | 'modulos' | 'comunicacion' | 'revisar' | 'compartir' | null
  >(null);

  const soloLectura = proyecto.role === 'viewer' || estado.conexion === 'sin-permiso';

  const aplicar = useCallback(
    (operaciones: Operation[], contexto?: ContextoCambio) => {
      if (soloLectura) return { ok: false as const, error: 'Permiso de solo lectura' };
      return estado.aplicar(operaciones, contexto);
    },
    [estado, soloLectura],
  );

  useEffect(() => anunciar({ seleccion }), [seleccion, anunciar]);

  const reparto = repartir(pantalla, hoja, hoja !== 'oculta');
  const claseSeleccionada = seleccion ? (estado.diagrama.classes[seleccion] ?? null) : null;

  /* ---------------------------------------------------------------------- */
  /* Lo que hacen los demás                                                  */
  /* ---------------------------------------------------------------------- */

  /*
    Desde dónde cuenta «lo nuevo». Las reglas están en `movil-ajenos.ts`; aquí
    solo se guarda la marca y se decide cuándo empieza a contar.

    Y empieza cuando el documento está **al día**, no en el primer render. Antes
    de sincronizar lo que hay es el historial que quedó en IndexedDB de la última
    vez, y todo lo que llegue del servidor a continuación —meses de trabajo de
    otra gente— entraría como novedad de golpe. Esperar a `sincronizado` es lo que
    hace que el cartel diga lo que ha pasado *mientras se está delante*.
  */
  const [ultimoVisto, setUltimoVisto] = useState<string | null>(null);
  const marcado = useRef(false);

  useEffect(() => {
    if (marcado.current || !estado.sincronizado) return;
    marcado.current = true;
    // `DESDE_EL_PRINCIPIO` y no `null` cuando el historial está vacío: son dos
    // cosas distintas y el módulo explica por qué confundirlas se come un aviso.
    setUltimoVisto(estado.historial[estado.historial.length - 1]?.id ?? DESDE_EL_PRINCIPIO);
  }, [estado.sincronizado, estado.historial]);

  const novedades = useMemo(
    () => cambiosDeOtros(estado.historial, autor?.id ?? '', ultimoVisto),
    [estado.historial, autor?.id, ultimoVisto],
  );

  const darPorVistas = useCallback(() => {
    setUltimoVisto(novedades.ultima ?? DESDE_EL_PRINCIPIO);
  }, [novedades.ultima]);

  /*
    Que la caja abierta se mueva no lo cuenta el historial: `historial.ts` deja
    fuera `moveClass` a propósito, porque arrastrar produce decenas de operaciones
    por segundo. Así que se vigila la posición de **una sola** clase, la que está
    abierta, y solo mientras lo está.

    Es un pestillo y no un suceso: cuarenta fotogramas de arrastre ajeno lo dejan
    puesto una vez, y se pinta un cartel en vez de cuarenta. Se quita al cerrar la
    ficha o al cambiar de clase, que es cuando la advertencia ya no viene a cuento.
  */
  const [movidaPorOtro, setMovidaPorOtro] = useState(false);
  const posicionVista = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const ahora = claseSeleccionada?.position ?? null;
    const antes = posicionVista.current;
    posicionVista.current = ahora;
    if (!antes || !ahora) return;
    if (antes.x !== ahora.x || antes.y !== ahora.y) setMovidaPorOtro(true);
  }, [claseSeleccionada?.position]);

  useEffect(() => {
    setMovidaPorOtro(false);
    posicionVista.current = null;
  }, [seleccion]);

  const suerte = suerteDeLaAbierta(
    contenidoHoja === 'propiedades' ? seleccion : null,
    claseSeleccionada !== null,
    movidaPorOtro,
    novedades.entradas,
  );
  const avisoDeLaFicha = textoDeLaSuerte(suerte);

  /*
    Si la clase que se está editando desaparece, la hoja se cierra en vez de
    quedarse aceptando texto sobre una clase que ya no existe. Lo que **no** se
    hace es cerrarla en silencio: antes de cerrar se deja dicho quién la borró, y
    para eso el mensaje se saca de `suerte` —que se ha calculado con la clase
    todavía seleccionada— y se pasa a la franja de avisos. Cerrar sin decir nada
    era el fallo de la versión anterior: la ficha se desvanecía y parecía un
    cuelgue de la aplicación, no el trabajo de otra persona.
  */
  useEffect(() => {
    if (suerte.suerte !== 'borrada') return;
    setAviso(avisoDeLaFicha);
    setSeleccion(null);
    setHoja('oculta');
  }, [suerte.suerte, avisoDeLaFicha]);

  /* ---------------------------------------------------------------------- */
  /* Mantener pulsado                                                        */
  /* ---------------------------------------------------------------------- */

  const [mantenido, setMantenido] = useState<EstadoMantenido>(QUIETO);

  const gesto = useCallback((suceso: SucesoGesto) => {
    setMantenido((anterior) => siguiente(anterior, suceso));
  }, []);

  /*
    El temporizador se monta solo mientras hay una cuenta atrás viva, y se
    desmonta en cuanto deja de haberla. La alternativa —un intervalo permanente—
    despierta el hilo principal veinte veces por segundo para no hacer nada, y en
    un teléfono eso se paga en batería.
  */
  useEffect(() => {
    if (!cuentaAtrasViva(mantenido)) return;
    const id = window.setTimeout(() => gesto({ tipo: 'tictac', ahora: Date.now() }), MS_MANTENIDO);
    return () => window.clearTimeout(id);
  }, [mantenido, gesto]);

  // Mantener pulsado abre la ficha de esa clase: es el equivalente del botón
  // derecho, y lo que se quiere de una clase en el móvil es casi siempre editarla.
  const pedido = menuPedido(mantenido);
  useEffect(() => {
    if (pedido === null) return;
    const entrada = Object.entries(estado.diagrama.classes).find(([, c]) => c.name === pedido);
    if (entrada) {
      setSeleccion(entrada[0]);
      setContenidoHoja('propiedades');
      setHoja('media');
    }
    setMantenido(QUIETO);
  }, [pedido, estado.diagrama.classes]);

  const alPosarEnLienzo = useCallback(
    (evento: React.PointerEvent<HTMLDivElement>) => {
      // Solo el dedo. Con un ratón, mantener pulsado es arrastrar, y disparar el
      // menú a la vez daría las dos cosas: la caja movida y la ficha abierta.
      if (evento.pointerType === 'mouse') return;
      const caja = (evento.target as HTMLElement).closest('[data-id]');
      const id = caja?.getAttribute('data-id') ?? null;
      const clase = id ? (estado.diagrama.classes[id]?.name ?? null) : null;
      gesto({
        tipo: 'posar',
        puntero: evento.pointerId,
        x: evento.clientX,
        y: evento.clientY,
        clase,
        ahora: Date.now(),
      });
    },
    [gesto, estado.diagrama.classes],
  );

  /* ---------------------------------------------------------------------- */
  /* Acciones                                                                */
  /* ---------------------------------------------------------------------- */

  /*
    Los diagramas de comunicación importados no viven en el diagrama de clases sino
    en un tipo raíz aparte del documento, así que hay que leerlos del `doc`. Se
    recalcula cuando cambia `version` —que es lo que `useDiagrama` incrementa en
    cada transacción— porque un `Y.Doc` no es un valor que React pueda comparar: sin
    la versión en las dependencias, la entrada del cajón no aparecería hasta el
    siguiente repintado por otro motivo.
  */
  const tieneComunicacion = useMemo(
    () => readComunicaciones(estado.doc).length > 0,
    [estado.doc, estado.version],
  );

  const estadoAcciones: EstadoAcciones = {
    soloLectura,
    clases: Object.keys(estado.diagrama.classes).length,
    conectado: estado.conexion === 'conectado',
    tieneComunicacion,
    propietario: proyecto.role === 'owner',
  };

  const voz = accionMovil(estadoAcciones, 'asistente');

  const crearClase = useCallback(
    (kind: ClassKind) => {
      const n = Object.keys(estado.diagrama.classes).length;
      const resultado = aplicar([{ op: 'addClass', name: `Clase${String(n + 1)}`, kind }]);
      if (!resultado.ok) setAviso(resultado.error);
    },
    [aplicar, estado.diagrama.classes],
  );

  const exportar = useCallback(async () => {
    try {
      setAviso(await exportarXmiDelDiagrama(estado.diagrama, proyecto.name));
    } catch (error) {
      setAviso(error instanceof Error ? error.message : 'No se pudo exportar el diagrama');
    }
  }, [estado.diagrama, proyecto.name]);

  const hacer = useCallback(
    (id: IdAccionMovil) => {
      switch (id) {
        case 'clase':
          crearClase('class');
          break;
        case 'asistente':
          // Sin abrir el micrófono: ver el panel y hablarle son dos decisiones,
          // y quien entra por el cajón todavía no ha tomado la segunda.
          setDictarAlAbrir(false);
          setContenidoHoja('asistente');
          setHoja('media');
          break;
        case 'desde-imagen':
          setPantallaAparte('imagen');
          break;
        case 'importar-xmi':
          setPantallaAparte('xmi');
          break;
        case 'exportar-xmi':
          void exportar();
          break;
        case 'generar':
        case 'previsualizar':
          // Las dos abren la misma pantalla, y eso es correcto: desde que la
          // descarga vive dentro de la previsualización, «generar» ya no baja un
          // ZIP a ciegas. Se conservan como dos entradas porque son dos
          // intenciones distintas y la gente busca una o la otra.
          setPantallaAparte('generar');
          break;
        case 'modulos':
          setPantallaAparte('modulos');
          break;
        case 'comunicacion':
          setPantallaAparte('comunicacion');
          break;
        case 'revisar':
          setPantallaAparte('revisar');
          break;
        case 'historial':
          setContenidoHoja('historial');
          setHoja('media');
          // Haber leído la lista es haberlas visto. Sin esto, cerrar el historial
          // devolvería el cartel de novedades a la pantalla, que es la aplicación
          // insistiendo en contar algo que se acaba de leer.
          darPorVistas();
          break;
        case 'tablon':
          setContenidoHoja('tablon');
          // La única entrada del cajón que abre la hoja del todo. Las demás
          // enseñan algo y se cierran; esta es una conversación, y a media
          // altura caben tres mensajes y el cuadro de escribir. Además el
          // teclado va a subir en cuanto se toque el cuadro: arrancar ya
          // arriba evita que la hoja dé un salto justo cuando aparece.
          setHoja('completa');
          break;
        case 'compartir':
          setPantallaAparte('compartir');
          break;
        case 'salir':
          onSalir();
          break;
      }
    },
    [crearClase, exportar, onSalir, darPorVistas],
  );

  const pedirEncuadre = useCallback(() => {
    serie.current += 1;
    setOrden({ tipo: 'ajustar', n: serie.current });
  }, []);

  /* ---------------------------------------------------------------------- */

  /**
   * Llevar el lienzo a donde está trabajando otro.
   *
   * Selecciona y centra, y cierra la hoja. Lo tercero es lo que hace que sirva:
   * la hoja tapa entre media pantalla y toda, así que centrar sin cerrarla dejaría
   * la clase detrás de la propia lista desde la que se ha pedido ir a verla.
   */
  const irAClase = useCallback((claseId: string) => {
    setSeleccion(claseId);
    serie.current += 1;
    setOrden({ tipo: 'centrar', ids: [claseId], n: serie.current });
    setHoja('oculta');
  }, []);

  const nombreDeClase = useCallback(
    (id: string): string | null => estado.diagrama.classes[id]?.name ?? null,
    [estado.diagrama],
  );

  const ficha =
    contenidoHoja === 'asistente' ? (
      /*
        El mismo asistente del escritorio, sin una versión táctil aparte. Cabe
        tal cual porque lo que pide son exactamente los datos que esta pantalla
        ya tiene, y porque `dictar()` en el móvil no usa la API del navegador
        —que en un WebView de Android no existe— sino el puente al reconocedor
        nativo. Copiarlo habría dado dos gramáticas que interpretar y dos sitios
        donde arreglar la próxima orden que falle.
      */
      <Asistente
        proyectoId={proyecto.id}
        soloLectura={soloLectura}
        diagrama={estado.diagrama}
        aplicar={aplicar}
        dictarAlAbrir={dictarAlAbrir}
      />
    ) : contenidoHoja === 'presentes' ? (
      <PresentesMovil
        participantes={participantes}
        nombreDeClase={nombreDeClase}
        onIr={irAClase}
      />
    ) : contenidoHoja === 'historial' ? (
      <HistorialCambios historial={estado.historial} />
    ) : contenidoHoja === 'tablon' ? (
      /*
        El mismo panel que en el escritorio, y aquí importa más que en los
        demás: el tablón sondea al servidor, y dos implementaciones significaría
        dos sitios donde dejarse un temporizador encendido. Lo que cambia entre
        una pantalla y otra es el ancho, y de eso ya se ocupa la hoja.

        Sin sesión no se monta. No es una comprobación defensiva de adorno: el
        panel pide el audio con el token de la sesión, así que sin ella lo único
        que enseñaría sería una lista de errores.
      */
      usuario ? (
        <PanelTablon proyectoId={proyecto.id} usuarioId={usuario.id} rol={proyecto.role} />
      ) : (
        <p className="movil__ficha-aviso" role="status">
          Hace falta una sesión iniciada para leer el tablón del proyecto
        </p>
      )
    ) : (
      <>
        {/*
          El cartel va **dentro** de la ficha y encima de los campos, no en la
          franja de abajo. Lo que advierte es que el contenido que hay debajo ya
          no es el que se dejó, así que tiene que leerse en el mismo golpe de
          vista que ese contenido; en la franja inferior competiría con el
          teclado y se leería después de haber escrito encima.
        */}
        {avisoDeLaFicha && (
          <p className="movil__ficha-aviso" role="status">
            {avisoDeLaFicha}
          </p>
        )}
        <PanelPropiedades
          diagrama={estado.diagrama}
          clase={claseSeleccionada}
          soloLectura={soloLectura}
          historial={estado.historial}
          aplicar={aplicar}
        />
      </>
    );

  const TITULOS = {
    asistente: 'Dictar un cambio',
    historial: 'Historial de cambios',
    presentes: 'Quién está en el proyecto',
    propiedades: 'Propiedades',
    tablon: 'Comunicación interna',
  } as const;
  const tituloHoja = TITULOS[contenidoHoja];

  return (
    <div className="movil">
      <BarraMovil
        nombreProyecto={proyecto.name}
        conexion={estado.conexion}
        detalleConexion={estado.detalleConexion}
        sincronizado={estado.sincronizado}
        participantes={participantes}
        onCajon={() => setCajon(true)}
        onPresentes={() => {
          setContenidoHoja('presentes');
          setHoja('media');
        }}
      />

      <div className="movil__cuerpo">
        <div
          className="movil__lienzo"
          style={{ width: `${String(reparto.lienzo.ancho)}px` }}
          onPointerDown={alPosarEnLienzo}
          onPointerMove={(e) => gesto({ tipo: 'mover', puntero: e.pointerId, x: e.clientX, y: e.clientY })}
          onPointerUp={(e) => gesto({ tipo: 'levantar', puntero: e.pointerId })}
          onPointerCancel={() => gesto({ tipo: 'cancelar' })}
        >
          <LienzoFlow
            diagrama={estado.diagrama}
            seleccion={seleccion}
            participantes={participantes}
            soloLectura={soloLectura}
            herramienta="seleccion"
            onSeleccionar={setSeleccion}
            onMover={(id, x, y) => aplicar([{ op: 'moveClass', ref: { id }, position: { x, y } }])}
            // El cursor de presencia no se anuncia desde el móvil: un dedo no
            // tiene posición cuando no está tocando, así que lo que verían los
            // demás sería un puntero que aparece y desaparece a saltos.
            onCursor={() => undefined}
            onRelacionar={(origenId, destinoId) => {
              const resultado = aplicar([
                {
                  op: 'addRelation',
                  kind: 'association',
                  source: { id: origenId },
                  target: { id: destinoId },
                  sourceMultiplicity: '1',
                  targetMultiplicity: '*',
                },
              ]);
              if (!resultado.ok) setAviso(resultado.error);
            }}
            orden={orden}
            onEscala={() => undefined}
          />
        </div>

        {/*
          El mismo contenido, el otro sitio. En apaisado y en tablet la ficha se
          queda al lado en vez de taparse y destaparse: es lo que pedía el encargo
          y es lo que evita tener dos componentes de propiedades.
        */}
        {reparto.sitio === 'panel' && hoja !== 'oculta' && (
          <aside
            className={`movil__panel${contenidoHoja === 'tablon' ? ' movil__panel--fijo' : ''}`}
            style={{ width: `${String(reparto.panel)}px` }}
            aria-label={tituloHoja}
          >
            <div className="movil__panel-cabecera">
              <h2 className="movil__panel-titulo">{tituloHoja}</h2>
              <button type="button" onClick={() => setHoja('oculta')} aria-label="Cerrar el panel">
                <Icono nombre="cerrar" />
              </button>
            </div>
            {ficha}
          </aside>
        )}
      </div>

      {reparto.sitio === 'hoja' && hoja !== 'oculta' && (
        <HojaMovil
          titulo={tituloHoja}
          pantalla={pantalla}
          posicion={hoja}
          onPosicion={setHoja}
          onCerrar={() => setHoja('oculta')}
          cuerpoFijo={contenidoHoja === 'tablon'}
        >
          {ficha}
        </HojaMovil>
      )}

      {/*
        «Encuadrar» está fuera del botón flotante y siempre encendido, por lo mismo
        que en la barra del pulgar del escritorio: es la salida de emergencia de
        quien se ha perdido con un pellizco y se ha ido a mirar el vacío.
      */}
      <button
        type="button"
        className="movil__encuadrar"
        onClick={pedirEncuadre}
        aria-label="Encuadrar el diagrama"
      >
        <Icono nombre="encuadrar" />
      </button>

      {/*
        El micrófono, también fuera del botón flotante. No es capricho de sitio:
        el desplegable está limitado a tres acciones y esa cota tiene una prueba
        detrás, así que meterlo dentro obligaba a echar a otra. Y encima dictar
        es lo contrario de una acción rebuscada —es la forma rápida de editar
        cuando no apetece pelearse con el teclado sobre el diagrama—, de modo que
        pedir dos toques para llegar a ella sería cobrarla más cara que escribir.

        Etiqueta, icono y motivo salen del **mismo catálogo** que la entrada del
        cajón. Es la única manera de que el atajo no acabe diciendo una cosa y el
        cajón otra el día que cambie cuándo se apaga.
      */}
      <button
        type="button"
        className="movil__voz"
        disabled={voz.deshabilitada}
        aria-label={voz.motivo ? `${voz.etiqueta}. ${voz.motivo}` : voz.etiqueta}
        onClick={() => {
          // Aquí sí se abre el micrófono solo: el dedo ya ha dicho «quiero hablar».
          setDictarAlAbrir(true);
          setContenidoHoja('asistente');
          setHoja('media');
        }}
      >
        <Icono nombre={voz.icono} />
      </button>

      <BotonFlotante estado={estadoAcciones} onAccion={hacer} />

      {cajon && (
        <CajonMovil estado={estadoAcciones} onAccion={hacer} onCerrar={() => setCajon(false)} />
      )}

      {/*
        Lo que han hecho los demás. Es un botón y no un cartel porque tiene un
        sitio al que llevar: la lista completa, que es donde está la respuesta a
        «¿qué han cambiado exactamente?». Un aviso que informa de que algo pasó
        pero no deja ir a verlo obliga a buscarlo por el cajón, y a esas alturas
        ya se ha perdido de vista qué era.

        Al pulsarlo se da por visto. También se da por visto al abrir el historial
        desde el cajón: haber leído la lista es haberlas visto, y volver a
        anunciarlas después sería no haberse enterado de que se miraron.
      */}
      {resumirCambios(novedades.entradas) !== null && (
        <button
          type="button"
          className="movil__novedades"
          onClick={() => {
            setContenidoHoja('historial');
            setHoja('media');
            darPorVistas();
          }}
        >
          <span className="movil__novedades-texto">{resumirCambios(novedades.entradas)}</span>
          <span className="movil__novedades-ver">Ver</span>
        </button>
      )}

      {aviso && (
        <div className="movil__aviso" role="status">
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Cerrar el aviso">
            <Icono nombre="cerrar" />
          </button>
        </div>
      )}

      {pantallaAparte === 'imagen' && (
        <ImportarDiagrama
          proyectoId={proyecto.id}
          soloLectura={soloLectura}
          diagrama={estado.diagrama}
          aplicar={(operaciones) => {
            const resultado = aplicar(operaciones);
            if (resultado.ok) setAviso('Diagrama importado.');
            return resultado;
          }}
          onCerrar={() => setPantallaAparte(null)}
        />
      )}

      {pantallaAparte === 'xmi' && (
        <ImportarXmi
          soloLectura={soloLectura}
          diagrama={estado.diagrama}
          aplicar={(operaciones) => {
            const resultado = aplicar(operaciones);
            if (resultado.ok) setAviso('XMI importado.');
            return resultado;
          }}
          guardarComunicaciones={(diagramas) => {
            for (const d of diagramas) writeComunicacion(estado.doc, d);
            if (diagramas.length > 0) {
              setAviso(
                `${diagramas.length === 1 ? 'Diagrama' : `${String(diagramas.length)} diagramas`} de comunicación en el proyecto. Están en el cajón.`,
              );
            }
          }}
          onCerrar={() => setPantallaAparte(null)}
        />
      )}

      {pantallaAparte === 'generar' && (
        <PrevisualizarGeneracion
          proyecto={proyecto}
          diagrama={estado.diagrama}
          aplicar={aplicar}
          soloLectura={soloLectura}
          onCerrar={() => setPantallaAparte(null)}
        />
      )}

      {pantallaAparte === 'modulos' && (
        <CatalogoModulos
          diagrama={estado.diagrama}
          aplicar={aplicar}
          soloLectura={soloLectura}
          onCerrar={() => setPantallaAparte(null)}
        />
      )}

      {pantallaAparte === 'comunicacion' && (
        <VisorComunicacionImportada
          doc={estado.doc}
          version={estado.version}
          soloLectura={soloLectura}
          onCerrar={() => setPantallaAparte(null)}
        />
      )}

      {/*
        El mismo diálogo que usa la lista de proyectos, sin versión táctil
        aparte. En un teléfono un modal ocupa la pantalla entera, que es
        justamente lo que hace falta aquí, y una segunda copia sería un segundo
        sitio donde arreglar el día que cambie el contrato de miembros.
      */}
      {pantallaAparte === 'compartir' && (
        <DialogoCompartir proyecto={proyecto} onCerrar={() => setPantallaAparte(null)} />
      )}

      {pantallaAparte === 'revisar' && (
        <RevisionDiagrama
          diagrama={estado.diagrama}
          // Ir a la clase la selecciona y abre su ficha: el arreglo se hace ahí
          // mismo, sin volver a buscarla en el lienzo.
          onIrA={(classId) => {
            setSeleccion(classId);
            setContenidoHoja('propiedades');
            setHoja('media');
            setPantallaAparte(null);
          }}
          onCerrar={() => setPantallaAparte(null)}
        />
      )}
    </div>
  );
}
