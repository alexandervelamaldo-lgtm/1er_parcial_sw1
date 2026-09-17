import { useEffect, useState } from 'react';
import { ProveedorSesion, useSesion } from './services/sesion';
import { PantallaAcceso } from './components/PantallaAcceso';
import { ListaProyectos } from './components/ListaProyectos';
import { EditorDiagrama } from './components/EditorDiagrama';
import { PantallaMovil } from './components/PantallaMovil';
import { Guia } from './components/Guia';
import { AsistenteDps } from './components/AsistenteDps';
import { almacenDelNavegador, debeAbrirse, marcarVisto } from './components/asistente-dps';
import { api, type Proyecto } from './services/api';

/**
 * Raíz de la aplicación.
 *
 * La navegación se lleva con el historial del navegador en vez de con una
 * librería de rutas. Son dos pantallas y una regla —`/proyecto/:id` abre el
 * editor—, y añadir un router para eso sería más código del que ahorra. Lo que
 * sí hace falta es que la URL identifique el diagrama abierto: es lo que se
 * pega en un mensaje para invitar a alguien a mirar lo mismo, y sin ello la
 * colaboración empieza por explicar dónde hay que hacer clic.
 *
 * ## Las dos formas del editor
 *
 * `/proyecto/:id` abre el editor de escritorio y `/movil/proyecto/:id` abre el de
 * teléfono. Es **la ruta** la que decide, no el ancho de la ventana, y eso es a
 * propósito:
 *
 * - La app Android carga la que le toca desde el primer instante, sin un parpadeo
 *   en el que se monta el editor de escritorio —con su árbol, su paleta y sus tres
 *   columnas suscritas al documento— para sustituirlo acto seguido.
 * - Un ancho no distingue «estoy en un teléfono» de «he estrechado la ventana en
 *   el portátil», y en el segundo caso cambiar de interfaz debajo de alguien que
 *   está trabajando es lo último que hay que hacer.
 * - Se puede entrar a propósito a una u otra, que es lo que hace falta para
 *   probarlas sin un teléfono delante.
 *
 * El documento es el mismo en las dos: el mismo `Y.Doc`, las mismas operaciones y
 * la misma validación de `shared`. Dos personas en el mismo proyecto, una en cada
 * interfaz, no notan que están en pantallas distintas.
 */

/** El prefijo de la interfaz de móvil. Ver `PantallaMovil.tsx`. */
const MOVIL = '/movil';

function enModoMovil(): boolean {
  return location.pathname === MOVIL || location.pathname.startsWith(`${MOVIL}/`);
}

function rutaProyecto(): string | null {
  // El prefijo es opcional en la misma expresión para que las dos formas de la URL
  // no se puedan desincronizar: con dos expresiones, añadir un segmento a una y
  // olvidarse de la otra deja media aplicación sin recargar.
  const coincidencia = /^(?:\/movil)?\/proyecto\/([^/]+)$/.exec(location.pathname);
  return coincidencia?.[1] ?? null;
}

function Aplicacion(): JSX.Element {
  const { usuario, cargando } = useSesion();
  const [proyecto, setProyecto] = useState<Proyecto | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(rutaProyecto());
  const [error, setError] = useState<string | null>(null);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [recorridoAbierto, setRecorridoAbierto] = useState(false);

  /*
    El recorrido de primer acceso.

    Se decide después de saber quién ha entrado, y no en el arranque, por dos
    motivos. Uno es de cortesía: plantar la bienvenida encima del formulario de
    acceso interrumpe a quien solo quiere volver a entrar. El otro es que sin
    sesión no hay nada que enseñar todavía —el recorrido habla del editor y de
    la lista de proyectos, que aún no existen en pantalla—.

    La marca de «visto» vive en el navegador, no en el perfil. Es una decisión y
    tiene su contrapartida: quien entre desde otro equipo lo verá otra vez. A
    cambio no hay que añadir una columna al usuario, ni una llamada al servidor
    antes de pintar, ni la pregunta de qué pasa cuando el servidor no contesta;
    y lo que se pierde en el caso malo es que alguien lea seis láminas que ya
    conocía y las salte en dos segundos.
  */
  useEffect(() => {
    if (!usuario) return;
    if (debeAbrirse(almacenDelNavegador)) setRecorridoAbierto(true);
  }, [usuario]);

  const cerrarRecorrido = (): void => {
    // Se marca salga como salga: terminado y saltado significan lo mismo aquí.
    // Quien lo cierra lo ha decidido, y volver a plantárselo en la siguiente
    // recarga solo enseña a cerrar ventanas sin leerlas.
    marcarVisto(almacenDelNavegador);
    setRecorridoAbierto(false);
  };

  /*
    El modo se lee de la URL una vez y se conserva al navegar dentro de la
    aplicación: quien entró por `/movil` sigue en `/movil` al abrir un proyecto y al
    salir de él. Si el prefijo se perdiera al volver a la lista, la app Android
    acabaría en el editor de escritorio en cuanto alguien pulsara «salir».
  */
  const [movil] = useState(enModoMovil);
  const prefijo = movil ? MOVIL : '';

  const abrir = (p: Proyecto): void => {
    history.pushState(null, '', `${prefijo}/proyecto/${p.id}`);
    setProyecto(p);
    setAbriendo(null);
  };

  const salirDelProyecto = (): void => {
    history.pushState(null, '', `${prefijo}/`);
    setProyecto(null);
    setAbriendo(null);
  };

  // Los botones de atrás y adelante del navegador tienen que funcionar: en una
  // aplicación instalada como PWA, «atrás» es a menudo el único gesto de
  // navegación que el usuario tiene a mano.
  useEffect(() => {
    const alNavegar = (): void => {
      const id = rutaProyecto();
      if (!id) {
        setProyecto(null);
        setAbriendo(null);
      } else if (id !== proyecto?.id) {
        setProyecto(null);
        setAbriendo(id);
      }
    };
    window.addEventListener('popstate', alNavegar);
    return () => window.removeEventListener('popstate', alNavegar);
  }, [proyecto?.id]);

  // Entrar por una URL directa: hay identificador pero no metadatos, y el rol
  // hace falta antes de pintar nada, porque decide si la interfaz se muestra
  // editable.
  useEffect(() => {
    if (!abriendo || !usuario) return;
    let cancelado = false;
    void api
      .verProyecto(abriendo)
      .then(({ proyecto: p }) => {
        if (cancelado) return;
        setProyecto(p);
        setAbriendo(null);
      })
      .catch((e: unknown) => {
        if (cancelado) return;
        setError(e instanceof Error ? e.message : 'No se pudo abrir el proyecto');
        setAbriendo(null);
        history.replaceState(null, '', '/');
      });
    return () => {
      cancelado = true;
    };
  }, [abriendo, usuario]);

  if (cargando) return <div className="cargando">Cargando…</div>;
  if (!usuario) return <PantallaAcceso />;
  if (abriendo) return <div className="cargando">Abriendo el proyecto…</div>;

  return (
    <>
      {proyecto ? (
        // La clave fuerza a React a desmontar el editor al cambiar de proyecto.
        // Sin ella reutilizaría el componente y con él su documento Yjs, que
        // seguiría apuntando al diagrama anterior.
        movil ? (
          <PantallaMovil key={proyecto.id} proyecto={proyecto} onSalir={salirDelProyecto} />
        ) : (
          <EditorDiagrama key={proyecto.id} proyecto={proyecto} onSalir={salirDelProyecto} />
        )
      ) : (
        <>
          {error && <p className="panel__error panel__error--flotante">{error}</p>}
          <ListaProyectos onAbrir={abrir} />
        </>
      )}

      {/*
        La ayuda se monta aquí y no dentro del editor porque la pregunta «¿cómo
        empiezo?» se hace antes de abrir ningún proyecto, que es justo donde el
        editor todavía no existe. Y se monta solo cuando se abre: construir el
        índice del manual cuesta un instante y no hay motivo de pagarlo en cada
        arranque de la aplicación.
      */}
      {/*
        El recorrido va el último del árbol y con el `z-index` más alto: si se
        abre estando la ayuda abierta —se entra a él justo desde ahí— tiene que
        quedar por encima, no debajo.
      */}
      {recorridoAbierto && <AsistenteDps onCerrar={cerrarRecorrido} />}

      {ayudaAbierta ? (
        <Guia
          onCerrar={() => setAyudaAbierta(false)}
          onRecorrido={() => {
            // La ayuda se cierra al abrirlo. Dejar las dos superpuestas obliga
            // a cerrar dos cosas para volver al diagrama, y la de abajo ya no
            // se puede usar.
            setAyudaAbierta(false);
            setRecorridoAbierto(true);
          }}
        />
      ) : (
        <button
          type="button"
          className="boton-ayuda"
          title="Guía: preguntar cómo se hace algo"
          onClick={() => setAyudaAbierta(true)}
        >
          ? <span>Ayuda</span>
        </button>
      )}
    </>
  );
}

export function App(): JSX.Element {
  return (
    <ProveedorSesion>
      <Aplicacion />
    </ProveedorSesion>
  );
}
