import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useOnViewportChange,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnConnect,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { listClasses, listRelations, type UmlClass, type UmlRelation } from '@app/shared';
import {
  ALTO_CABECERA,
  ALTO_FILA,
  ANCHO_MINIMO,
  ESCALA_MAXIMA,
  ESCALA_MINIMA,
  PADDING,
  anclaje,
  desviosPorPar,
  etiquetaClase,
  medidasDe,
  puntoEnCurva,
  recortar,
  textoAtributo,
  textoMetodo,
  type Medida,
} from './geometria-lienzo';
import type { LienzoProps } from './Lienzo';

/**
 * El lienzo, sobre React Flow.
 *
 * Sustituye al SVG hecho a mano de `Lienzo.tsx`, del que se conserva **todo lo
 * que era una decisión y no una carencia**: las cuentas de `geometria-lienzo.ts`
 * —cuánto mide una caja, por dónde sale una flecha, cuánto se separan dos
 * relaciones entre el mismo par—, el dibujo de la caja tal cual, y sobre todo el
 * hecho de que la posición se escriba en el documento colaborativo en cuanto se
 * mueve algo.
 *
 * Eso último es la diferencia con la maqueta, que fue de donde salió la idea de
 * usar React Flow. En la maqueta las posiciones se calculan en un `useMemo` a
 * partir de un mapa fijo de identificadores y **no hay `onNodesChange`**: se
 * puede arrastrar una caja, pero no se guarda en ninguna parte y vuelve a su
 * sitio al siguiente render. Copiar ese cableado habría cambiado un lienzo que
 * colabora por uno que parece que colabora.
 *
 * Lo que aporta React Flow, y es por lo que se ha traído: el desplazamiento y el
 * zoom con sus inercias —incluido el pellizco, que aquí costaba escuchadores
 * nativos en fase de captura para sortear el `stopPropagation` de las cajas—, el
 * minimapa, los controles, y el fondo de puntos.
 *
 * Lo que React Flow no da y hay que seguir poniendo a mano es justo lo que hace
 * que un diagrama sea de UML: sus aristas van de conector a conector y en línea
 * quebrada, mientras que una relación UML sale del **borde** de la caja hacia la
 * otra y, si hay varias entre el mismo par, se abren en abanico para no
 * superponerse. Por eso la arista es propia y no una de las suyas.
 */

/**
 * El paso de la rejilla, en píxeles del diagrama.
 *
 * Se le pasa a React Flow como `snapGrid` y con eso gobierna las dos formas de
 * colocar una clase: al arrastrarla queda enganchada a múltiplos de diez, y con
 * las flechas del teclado se mueve de diez en diez, porque su movimiento por
 * teclado usa `snapGrid` como velocidad cuando el enganche está activo —si no,
 * serían cinco píxeles sueltos que no cuadran con nada—. Es lo mismo que hacía
 * el lienzo anterior a mano, y el efecto que importa es que dos cajas colocadas
 * a ojo acaben alineadas entre sí sin tener que apuntar.
 */
const REJILLA: [number, number] = [10, 10];

/**
 * Dónde va cada conector.
 *
 * El mapa es explícito, y no `Position[capitalizar(lado)]`, porque esa segunda
 * forma se apoya en que los nombres del enumerado coincidan con los nuestros
 * salvo la mayúscula. El día que React Flow renombre uno, TypeScript no diría
 * nada —el índice es un `string`— y el conector aparecería en la esquina
 * superior izquierda sin que nada avisara.
 */
const LADOS = [
  { id: 'arriba', posicion: Position.Top },
  { id: 'derecha', posicion: Position.Right },
  { id: 'abajo', posicion: Position.Bottom },
  { id: 'izquierda', posicion: Position.Left },
] as const;

/** Lo que viaja dentro de cada nodo. */
interface DatosNodo extends Record<string, unknown> {
  cls: UmlClass;
  medida: Medida;
  seleccionada: boolean;
  soloLectura: boolean;
  colorAjeno: string | null;
  nombreAjeno: string | null;
}

/** Lo que viaja dentro de cada arista. */
interface DatosArista extends Record<string, unknown> {
  relacion: UmlRelation;
  origen: UmlClass;
  destino: UmlClass;
  medidaOrigen: Medida;
  medidaDestino: Medida;
  desvio: number;
}

type NodoClase = Node<DatosNodo, 'claseUml'>;
type AristaRelacion = Edge<DatosArista, 'relacionUml'>;

/* --------------------------------------------------------------------------
   Las puntas de flecha
   -------------------------------------------------------------------------- */

/**
 * Los marcadores viven en un SVG aparte, de tamaño cero.
 *
 * React Flow pinta las aristas en un SVG suyo al que no se le puede meter un
 * `<defs>`, pero un `url(#…)` resuelve contra el documento entero, así que basta
 * con que los marcadores existan en algún sitio. Son los mismos cuatro de
 * siempre: triángulo hueco para la herencia, rombo lleno para la composición,
 * hueco para la agregación y flecha abierta para la dependencia.
 */
function Marcadores(): JSX.Element {
  return (
    <svg className="lienzo__marcadores" aria-hidden="true">
      <defs>
        <marker
          id="flecha"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10z" fill="var(--texto-2)" />
        </marker>
        <marker
          id="herencia"
          viewBox="0 0 12 12"
          refX="11"
          refY="6"
          markerWidth="11"
          markerHeight="11"
          orient="auto-start-reverse"
        >
          <path d="M0 0L11 6L0 12z" fill="var(--fondo)" stroke="var(--texto-2)" strokeWidth="1.5" />
        </marker>
        <marker
          id="rombo"
          viewBox="0 0 14 10"
          refX="13"
          refY="5"
          markerWidth="12"
          markerHeight="10"
          orient="auto-start-reverse"
        >
          <path d="M0 5L7 0L14 5L7 10z" fill="var(--fondo)" stroke="var(--texto-2)" strokeWidth="1.5" />
        </marker>
        <marker
          id="rombo-lleno"
          viewBox="0 0 14 10"
          refX="13"
          refY="5"
          markerWidth="12"
          markerHeight="10"
          orient="auto-start-reverse"
        >
          <path d="M0 5L7 0L14 5L7 10z" fill="var(--texto-2)" />
        </marker>
      </defs>
    </svg>
  );
}

/* --------------------------------------------------------------------------
   La caja
   -------------------------------------------------------------------------- */

/**
 * La clase, dibujada dentro de un nodo de React Flow.
 *
 * El contenido va en un `<svg>` y no en `<div>`s con CSS, que sería lo natural
 * en React Flow. El motivo es que así el dibujo es **el mismo** que el del
 * lienzo anterior —los mismos `.caja__*`, las mismas medidas de
 * `geometria-lienzo.ts`— en vez de una segunda versión escrita en otro lenguaje
 * que habría que mantener en paralelo y que se separaría a la primera.
 */
function NodoClaseUml({ data, selected }: NodeProps<NodoClase>): JSX.Element {
  const { cls, medida, seleccionada, soloLectura, colorAjeno, nombreAjeno } = data;
  const etiqueta = etiquetaClase(cls);
  const { ancho, alto } = medida;
  const separador = ALTO_CABECERA + cls.attributes.length * ALTO_FILA + 3;
  const activa = seleccionada || selected;

  /*
    Aquí no hay `role`, ni `aria-label`, ni manejador de teclado, y es a
    propósito.

    Quien recibe el foco no es este `div` sino el envoltorio que React Flow pone
    por encima: es él quien lleva el `tabIndex` y quien escucha las teclas. Un
    `onKeyDown` puesto aquí no llegaría a ejecutarse nunca —los eventos suben,
    no bajan— y un `aria-label` aquí quedaría por debajo del elemento que el
    lector de pantalla anuncia. Las dos cosas se declaran sobre el nodo, en el
    `useMemo` de más abajo, que es donde React Flow las lee.

    El movimiento con las flechas lo hace React Flow, y sí llega a los demás:
    acaba en un cambio de tipo `position` que sale por `onNodesChange`, o sea por
    el mismo sitio que el arrastre con el ratón y por tanto por `onMover`.
  */
  return (
    <div className={`caja${activa ? ' caja--activa' : ''}`} style={{ width: ancho, height: alto }}>
      {/*
        Los cuatro conectores son lo único que React Flow necesita para dejar
        trazar una relación arrastrando. Se quedan invisibles hasta que se pasa
        por encima: un diagrama de clases con cuatro puntos por caja siempre
        visibles se lee peor, y lo que tiene que destacar es el modelo.
      */}
      {LADOS.map((lado) => (
        <Handle
          key={lado.id}
          id={lado.id}
          type="source"
          position={lado.posicion}
          className="caja__conector"
          isConnectable={!soloLectura}
        />
      ))}

      <svg width={ancho} height={alto} aria-hidden="true">
        <rect
          width={ancho}
          height={alto}
          rx="6"
          className="caja__fondo"
          stroke={colorAjeno ?? (activa ? 'var(--acento)' : 'var(--borde)')}
          strokeWidth={colorAjeno || activa ? 2 : 1}
        />
        {etiqueta && (
          <text x={ancho / 2} y="14" textAnchor="middle" className="caja__estereotipo">
            {etiqueta}
          </text>
        )}
        <text
          x={ancho / 2}
          y={etiqueta ? 28 : 22}
          textAnchor="middle"
          className={`caja__nombre${cls.kind === 'abstract' ? ' caja__nombre--abstracta' : ''}`}
        >
          {recortar(cls.name, ancho)}
        </text>
        <line x1="0" y1={ALTO_CABECERA} x2={ancho} y2={ALTO_CABECERA} className="caja__linea" />

        {cls.attributes.map((atributo, indice) => (
          <text
            key={atributo.name}
            x={PADDING}
            y={ALTO_CABECERA + (indice + 1) * ALTO_FILA - 5}
            className="caja__miembro"
          >
            {recortar(textoAtributo(atributo), ancho)}
          </text>
        ))}

        {cls.methods.length > 0 && (
          <line x1="0" y1={separador} x2={ancho} y2={separador} className="caja__linea" />
        )}

        {cls.methods.map((metodo, indice) => (
          <text
            key={metodo.name}
            x={PADDING}
            y={ALTO_CABECERA + (cls.attributes.length + indice + 1) * ALTO_FILA + 4}
            className="caja__miembro caja__miembro--metodo"
          >
            {recortar(textoMetodo(metodo), ancho)}
          </text>
        ))}
      </svg>

      {nombreAjeno && (
        <span className="caja__ajeno" style={{ color: colorAjeno ?? 'var(--texto-2)' }}>
          {nombreAjeno}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   La relación
   -------------------------------------------------------------------------- */

/** Estilo de trazo y punta de flecha según el tipo de relación UML. */
function estiloRelacion(kind: UmlRelation['kind']): {
  marcadorFin?: string;
  marcadorInicio?: string;
  discontinua: boolean;
} {
  switch (kind) {
    case 'inheritance':
      return { marcadorFin: 'url(#herencia)', discontinua: false };
    case 'realization':
      return { marcadorFin: 'url(#herencia)', discontinua: true };
    case 'composition':
      return { marcadorInicio: 'url(#rombo-lleno)', discontinua: false };
    case 'aggregation':
      return { marcadorInicio: 'url(#rombo)', discontinua: false };
    case 'dependency':
      return { marcadorFin: 'url(#flecha)', discontinua: true };
    default:
      return { discontinua: false };
  }
}

/** Cuánto se abre el abanico entre relaciones que unen el mismo par. */
const SEPARACION_ABANICO = 34;

/**
 * La arista, calculada con nuestra geometría y no con la de React Flow.
 *
 * React Flow ofrece aristas rectas, escalonadas y de Bézier, todas de conector a
 * conector. Ninguna sirve: en UML la línea sale del borde de la caja en
 * dirección a la otra —da igual por qué lado quede—, y varias relaciones entre
 * el mismo par tienen que abrirse en abanico o se ven como una sola con las
 * cardinalidades encimadas. Las dos cosas son las que ya resolvía
 * `geometria-lienzo.ts`, con sus pruebas, así que lo que se hace aquí es
 * llamarlas.
 */
function AristaRelacionUml({ data }: EdgeProps<AristaRelacion>): JSX.Element | null {
  if (!data) return null;
  const { relacion, origen, destino, medidaOrigen, medidaDestino, desvio } = data;
  const estilo = estiloRelacion(relacion.kind);

  const trazo = (
    d: string,
    etiquetas: {
      origen: { x: number; y: number };
      destino: { x: number; y: number };
      centro: { x: number; y: number };
    },
  ): JSX.Element => (
    <g className="relacion">
      <path
        d={d}
        fill="none"
        stroke="var(--texto-2)"
        strokeWidth="1.5"
        strokeDasharray={estilo.discontinua ? '6 4' : undefined}
        markerEnd={estilo.marcadorFin}
        markerStart={estilo.marcadorInicio}
      />
      {relacion.name && (
        <text x={etiquetas.centro.x} y={etiquetas.centro.y} className="relacion__etiqueta">
          {relacion.name}
        </text>
      )}
      <text x={etiquetas.origen.x} y={etiquetas.origen.y} className="relacion__multiplicidad">
        {relacion.source.multiplicity}
      </text>
      <text x={etiquetas.destino.x} y={etiquetas.destino.y} className="relacion__multiplicidad">
        {relacion.target.multiplicity}
      </text>
    </g>
  );

  // Reflexiva: un lazo por el lado derecho, que es la convención en UML. Sin
  // esto sería una línea de longitud cero y no se vería nada.
  if (origen.id === destino.id) {
    const x = origen.position.x + medidaOrigen.ancho;
    const y = origen.position.y + medidaOrigen.alto / 2;
    const fondo = 70 + Math.abs(desvio) * 26;
    const d = `M ${x} ${y - 14} C ${x + fondo} ${y - 52}, ${x + fondo} ${y + 52}, ${x} ${y + 14}`;
    return trazo(d, {
      origen: { x: x + 8, y: y - 20 },
      destino: { x: x + 8, y: y + 30 },
      centro: { x: x + fondo * 0.78, y },
    });
  }

  const centroOrigen = {
    x: origen.position.x + medidaOrigen.ancho / 2,
    y: origen.position.y + medidaOrigen.alto / 2,
  };
  const centroDestino = {
    x: destino.position.x + medidaDestino.ancho / 2,
    y: destino.position.y + medidaDestino.alto / 2,
  };

  const dx = centroDestino.x - centroOrigen.x;
  const dy = centroDestino.y - centroOrigen.y;
  const largo = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / largo, y: dx / largo };

  const control = {
    x: (centroOrigen.x + centroDestino.x) / 2 + normal.x * desvio * SEPARACION_ABANICO,
    y: (centroOrigen.y + centroDestino.y) / 2 + normal.y * desvio * SEPARACION_ABANICO,
  };

  const desde = anclaje(origen, medidaOrigen, control);
  const hasta = anclaje(destino, medidaDestino, control);
  const d = `M ${desde.x} ${desde.y} Q ${control.x} ${control.y} ${hasta.x} ${hasta.y}`;

  const junto = (t: number): { x: number; y: number } => {
    const punto = puntoEnCurva(desde, control, hasta, t);
    const lado = desvio >= 0 ? 1 : -1;
    return { x: punto.x + normal.x * 12 * lado, y: punto.y + normal.y * 12 * lado - 2 };
  };

  const centro = puntoEnCurva(desde, control, hasta, 0.5);
  return trazo(d, {
    origen: junto(0.16),
    destino: junto(0.84),
    centro: { x: centro.x, y: centro.y - 7 },
  });
}

/**
 * Cómo se anuncia una clase a quien no ve el dibujo.
 *
 * Sin esto React Flow anuncia el nodo por su identificador, y un lector de
 * pantalla diría «C3» donde debería decir «Clase Conductor, 4 atributos». El
 * identificador es una cadena interna: no significa nada para nadie.
 *
 * Las comillas angulares del estereotipo se quitan porque se leen en voz alta
 * como «comilla angular izquierda»; el texto que queda es el mismo.
 */
function descripcionDe(cls: UmlClass): string {
  const etiqueta = etiquetaClase(cls);
  return [
    etiqueta
      ? `${etiqueta.replaceAll('«', '').replaceAll('»', '')} ${cls.name}`
      : `Clase ${cls.name}`,
    cls.attributes.length > 0 && `${cls.attributes.length} atributos`,
    cls.methods.length > 0 && `${cls.methods.length} métodos`,
  ]
    .filter(Boolean)
    .join(', ');
}

const TIPOS_NODO = { claseUml: NodoClaseUml };
const TIPOS_ARISTA = { relacionUml: AristaRelacionUml };

/* --------------------------------------------------------------------------
   El lienzo
   -------------------------------------------------------------------------- */

function LienzoInterno({
  diagrama,
  seleccion,
  participantes,
  soloLectura,
  onSeleccionar,
  onMover,
  onCursor,
  onRelacionar,
  herramienta,
  orden,
  onEscala,
}: LienzoProps): JSX.Element {
  const flow = useReactFlow();
  const clases = useMemo(() => listClasses(diagrama), [diagrama]);
  const relaciones = useMemo(() => listRelations(diagrama), [diagrama]);
  const medidas = useMemo(() => new Map(clases.map((c) => [c.id, medidasDe(c)])), [clases]);

  const nodos: NodoClase[] = useMemo(
    () =>
      clases.map((cls) => {
        // No hace falta descartar el cliente propio: `usePresencia` ya lo
        // excluye al construir la lista, porque nadie necesita ver su propia
        // selección duplicada con el retraso de una ida y vuelta.
        const ajeno = participantes.find((p) => p.seleccion === cls.id);
        return {
          id: cls.id,
          type: 'claseUml' as const,
          position: cls.position,
          selected: cls.id === seleccion,
          draggable: !soloLectura,
          // El envoltorio de React Flow es quien recibe el foco, así que es él
          // quien tiene que llevar el nombre y el papel.
          ariaLabel: descripcionDe(cls),
          ariaRole: 'button',
          data: {
            cls,
            medida: medidas.get(cls.id) ?? { ancho: ANCHO_MINIMO, alto: 80 },
            seleccionada: cls.id === seleccion,
            soloLectura,
            colorAjeno: ajeno?.color ?? null,
            nombreAjeno: ajeno?.nombre ?? null,
          },
        };
      }),
    [clases, medidas, participantes, seleccion, soloLectura],
  );

  const aristas: AristaRelacion[] = useMemo(() => {
    const desvios = desviosPorPar(relaciones);
    return relaciones.flatMap((relacion) => {
      const origen = diagrama.classes[relacion.source.classId];
      const destino = diagrama.classes[relacion.target.classId];
      // Una relación puede sobrevivir un instante a la clase que une, si el
      // borrado llega antes por el socket. Dibujar la mitad que queda daría una
      // línea que sale de la nada.
      if (!origen || !destino) return [];
      const porDefecto: Medida = { ancho: ANCHO_MINIMO, alto: 80 };
      return [
        {
          id: relacion.id,
          source: relacion.source.classId,
          target: relacion.target.classId,
          type: 'relacionUml' as const,
          data: {
            relacion,
            origen,
            destino,
            medidaOrigen: medidas.get(origen.id) ?? porDefecto,
            medidaDestino: medidas.get(destino.id) ?? porDefecto,
            desvio: desvios.get(relacion.id) ?? 0,
          },
        },
      ];
    });
  }, [relaciones, diagrama.classes, medidas]);

  /*
    Cada cambio de posición se escribe en el documento en el acto, también
    mientras se arrastra. Es lo que hacía el lienzo anterior y no es un detalle:
    guardar solo al soltar haría que los demás participantes vieran la caja dar
    un salto al final en vez de seguirla, y que un corte de red a media
    arrastrada perdiera el movimiento entero.
  */
  const alCambiarNodos = useCallback(
    (cambios: NodeChange<NodoClase>[]): void => {
      if (soloLectura) return;
      for (const cambio of cambios) {
        if (cambio.type === 'position' && cambio.position) {
          onMover(cambio.id, Math.round(cambio.position.x), Math.round(cambio.position.y));
        }
      }
    },
    [onMover, soloLectura],
  );

  const alConectar: OnConnect = useCallback(
    (conexion) => {
      if (soloLectura) return;
      if (!conexion.source || !conexion.target) return;
      onRelacionar(conexion.source, conexion.target);
    },
    [onRelacionar, soloLectura],
  );

  // El aumento se comunica hacia fuera para que la barra de estado lo muestre.
  useOnViewportChange({
    onChange: useCallback(
      ({ zoom }: { zoom: number }) => {
        onEscala?.(zoom);
      },
      [onEscala],
    ),
  });

  /*
    Las órdenes de encuadre llegan de la barra de estado y del árbol del
    proyecto. Traen número de serie porque lo que se pide es una acción y no un
    estado: pulsar «Ajustar» dos veces tiene que encuadrar dos veces, y un objeto
    igual al anterior no dispararía el efecto.
  */
  useEffect(() => {
    if (!orden) return;
    switch (orden.tipo) {
      case 'acercar':
        void flow.zoomIn({ duration: 180 });
        return;
      case 'alejar':
        void flow.zoomOut({ duration: 180 });
        return;
      case 'ajustar':
        void flow.fitView({ duration: 220, padding: 0.18 });
        return;
      case 'centrar':
        void flow.fitView({
          duration: 220,
          padding: 0.35,
          nodes: orden.ids.map((id) => ({ id })),
        });
        return;
    }
  }, [orden, flow]);

  /*
    La herramienta de relación, traducida al idioma de React Flow.

    En el lienzo anterior significaba «arrastrar de una caja a otra traza una
    relación»; aquí las relaciones se trazan tirando de un conector, que es el
    gesto que React Flow entiende y el que además deja elegir por qué lado sale.
    Si se dejara así, el botón de la paleta no haría nada visible y parecería
    roto.

    Lo que hace es sacar los cuatro conectores de todas las cajas a la vez, en
    vez de solo en la que tiene el ratón encima. Con la herramienta activa se ve
    de un vistazo de dónde se puede tirar; sin ella, el diagrama se queda limpio.
  */
  const clase = `lienzo lienzo--flow${herramienta === 'relacion' ? ' lienzo--relacionando' : ''}`;

  return (
    <div className={clase}>
      <Marcadores />
      <ReactFlow<NodoClase, AristaRelacion>
        nodes={nodos}
        edges={aristas}
        nodeTypes={TIPOS_NODO}
        edgeTypes={TIPOS_ARISTA}
        onNodesChange={alCambiarNodos}
        onConnect={alConectar}
        onNodeClick={(_, nodo) => onSeleccionar(nodo.id)}
        onPaneClick={() => onSeleccionar(null)}
        onPointerMove={(evento) => {
          onCursor(flow.screenToFlowPosition({ x: evento.clientX, y: evento.clientY }));
        }}
        onPointerLeave={() => onCursor(null)}
        minZoom={ESCALA_MINIMA}
        maxZoom={ESCALA_MAXIMA}
        snapToGrid
        snapGrid={REJILLA}
        nodesDraggable={!soloLectura}
        nodesConnectable={!soloLectura}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.18 }}
        /*
          La atribución de React Flow se queda.
          ------------------------------------
          Existe `proOptions={{ hideAttribution: true }}` y quitarla es una
          línea, pero sus autores reservan esa opción a quien tiene suscripción
          de pago. La biblioteca es MIT y no hay nada que obligue por contrato;
          la razón para dejarla es más simple: el proyecto se apoya en trabajo
          ajeno y decir de quién es cuesta una esquina de 60 píxeles. En
          `estilos.css` se pinta con `--texto-2` sobre el fondo, que es lo
          discreto que puede ser sin esconderla.
        */
        // El borrado va por el menú y por el panel, que piden confirmación y
        // calculan el impacto. Dejar la tecla suelta aquí saltaría ese camino.
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="var(--borde)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable ariaLabel="Mapa del diagrama" />

        {/*
          Los cursores ajenos van dentro del portal del viewport, así que se
          expresan en coordenadas del diagrama y React Flow los desplaza y
          escala con todo lo demás. Colocarlos en píxeles de pantalla, como hacía
          la maqueta, los deja clavados donde estaban en cuanto alguien mueve el
          lienzo.
        */}
        <ViewportPortal>
          {participantes.map((p) =>
            p.cursor === null ? null : (
              <div
                key={p.clientId}
                className="lienzo__cursor"
                style={{
                  transform: `translate(${p.cursor.x}px, ${p.cursor.y}px)`,
                  color: p.color,
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M1 1 L1 12 L4.2 9 L6.4 14 L8.6 13 L6.4 8.2 L11 8.2 z" fill="currentColor" />
                </svg>
                <span style={{ background: p.color }}>{p.nombre}</span>
              </div>
            ),
          )}
        </ViewportPortal>
      </ReactFlow>
    </div>
  );
}

/**
 * React Flow guarda su estado en un contexto, y `useReactFlow` solo funciona por
 * debajo de él. El proveedor va aquí y no en `EditorDiagrama` para que quien use
 * el lienzo no tenga que saber sobre qué está construido.
 */
export function LienzoFlow(props: LienzoProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <LienzoInterno {...props} />
    </ReactFlowProvider>
  );
}
