import { useEffect, useState } from 'react';
import { ProveedorSesion, useSesion } from './services/sesion';
import { PantallaAcceso } from './components/PantallaAcceso';
import { ListaProyectos } from './components/ListaProyectos';
import { EditorDiagrama } from './components/EditorDiagrama';
import { Guia } from './components/Guia';
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
 */

function rutaProyecto(): string | null {
  const coincidencia = /^\/proyecto\/([^/]+)$/.exec(location.pathname);
  return coincidencia?.[1] ?? null;
}

function Aplicacion(): JSX.Element {
  const { usuario, cargando } = useSesion();
  const [proyecto, setProyecto] = useState<Proyecto | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(rutaProyecto());
  const [error, setError] = useState<string | null>(null);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);

  const abrir = (p: Proyecto): void => {
    history.pushState(null, '', `/proyecto/${p.id}`);
    setProyecto(p);
    setAbriendo(null);
  };

  const salirDelProyecto = (): void => {
    history.pushState(null, '', '/');
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
        <EditorDiagrama key={proyecto.id} proyecto={proyecto} onSalir={salirDelProyecto} />
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
      {ayudaAbierta ? (
        <Guia onCerrar={() => setAyudaAbierta(false)} />
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
