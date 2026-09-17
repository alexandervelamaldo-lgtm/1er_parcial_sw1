import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import type { EstadoConexion } from '@app/shared';
import { aBase64 } from '../services/descarga';
import { ESPERA_RESPALDO_MS, convieneRestaurar, leerBase64, decidirRespaldo } from './respaldo';

/**
 * Guardar el documento fuera del WebView, para lo que el WebView no conserva.
 *
 * El porqué —qué borra Android y qué no— está escrito entero en `respaldo.ts`,
 * junto a las reglas. Aquí solo queda lo que no se puede probar sin navegador:
 * serializar el documento, hablar por el puente y esperar a que dejen de
 * llegar cambios antes de escribir.
 *
 * ## Solo dentro de la app
 *
 * En un navegador de escritorio esto no se instala, y no por precaución sino
 * porque ahí el problema no existe: Chrome concede `navigator.storage.persist()`
 * y el almacén deja de ser desechable. El WebView es el único sitio donde no se
 * puede pedir esa promesa, así que es el único que necesita muleta. Si el
 * canal no está, el hook no hace nada y no avisa de nada: no hay nada roto.
 *
 * La otra mitad está en `mobile/lib/respaldo_nativo.dart`. Los dos nombres de
 * abajo son el contrato, y no hay compilador que lo compruebe.
 */

/** Canal por el que sube el documento (web → Flutter). */
const NOMBRE_CANAL = 'RespaldoNativo';

/** Función global que Flutter llama para contestar (Flutter → web). */
const NOMBRE_RECEPTOR = '__respaldoNativo';

interface PuenteNativo {
  postMessage(mensaje: string): void;
}

interface VentanaConRespaldo {
  [NOMBRE_CANAL]?: PuenteNativo;
  [NOMBRE_RECEPTOR]?: (crudo: string) => void;
}

function ventana(): VentanaConRespaldo | null {
  return typeof window === 'undefined' ? null : (window as unknown as VentanaConRespaldo);
}

/**
 * Con qué origen se marca lo que se restaura.
 *
 * El `UndoManager` de `useDiagrama` solo vigila `ORIGEN_LOCAL`, así que basta
 * con que esto sea **cualquier otra cosa** para quedar fuera de la pila de
 * deshacer. Y tiene que quedar fuera: lo restaurado no es algo que esta persona
 * acabe de hacer, y si entrase en la pila, el primer «deshacer» después de
 * recuperar un diagrama perdido lo volvería a borrar.
 *
 * Se pone un origen propio en vez de dejarlo sin marcar porque los orígenes
 * salen en los eventos de la transacción: con este, quien depure puede ver de
 * dónde vino el contenido.
 */
export const ORIGEN_RESPALDO = 'respaldo-nativo';

export interface UsoRespaldo {
  doc: Y.Doc;
  proyectoId: string;
  conexion: EstadoConexion;
  sincronizado: boolean;
  listoLocal: boolean;
}

export function useRespaldo({
  doc,
  proyectoId,
  conexion,
  sincronizado,
  listoLocal,
}: UsoRespaldo): void {
  /*
    Lo último que se sabe, para que el temporizador lo consulte al disparar.

    Va en una `ref` y no en las dependencias del efecto porque el efecto instala
    la escucha del documento: rehacerlo cada vez que cambia el estado de la
    conexión significaría perder el temporizador a medias justo cuando la
    conexión se cae, que es cuando hay que escribir.
  */
  const situacion = useRef({ conexion, sincronizado, listoLocal, proyectoId });
  situacion.current = { conexion, sincronizado, listoLocal, proyectoId };

  /*
    Mirar la situación y actuar. Lo llaman los dos efectos de abajo —el
    temporizador y el del cambio de conexión— y está aquí arriba, una sola vez,
    porque son dos disparadores de la **misma** decisión. Tenerla escrita dos
    veces era la forma seguro de que dentro de unos meses solo una de las dos
    tuviera en cuenta alguna condición nueva.

    Lee de la `ref` y no de las variables del render para que valga igual
    llamada desde un temporizador que arrancó hace dos segundos.
  */
  const evaluar = (): void => {
    const canal = ventana()?.[NOMBRE_CANAL];
    if (!canal) return;
    const { conexion: ahora, sincronizado: sinc, listoLocal: listo, proyectoId: id } =
      situacion.current;

    /*
      El documento se codifica **antes** de decidir porque el tamaño es una de
      las entradas de la decisión. Cuesta una copia en memoria de unos
      kilobytes; hacerlo al revés obligaría a estimar el tamaño, y una
      estimación que se quede corta manda por el puente un mensaje que no cabe
      y que se pierde sin decirlo.
    */
    const datos = aBase64(Y.encodeStateAsUpdate(doc));
    const decision = decidirRespaldo({
      conexion: ahora,
      sincronizado: sinc,
      listoLocal: listo,
      caracteresB64: datos.length,
    });

    if (decision.accion === 'guardar') {
      canal.postMessage(JSON.stringify({ tipo: 'guardar', proyecto: id, datos }));
    }
    if (decision.accion === 'olvidar') {
      canal.postMessage(JSON.stringify({ tipo: 'olvidar', proyecto: id }));
    }
  };

  /** La última versión de `evaluar`, para que los efectos no se rehagan por ella. */
  const evaluarRef = useRef(evaluar);
  evaluarRef.current = evaluar;

  useEffect(() => {
    const w = ventana();
    if (!w?.[NOMBRE_CANAL]) return;

    let temporizador: ReturnType<typeof setTimeout> | null = null;

    const programar = (): void => {
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = setTimeout(() => evaluarRef.current(), ESPERA_RESPALDO_MS);
    };

    /*
      Contestaciones del lado nativo. Solo hay dos: la copia que se pidió al
      arrancar, y los fallos al escribir.
    */
    w[NOMBRE_RECEPTOR] = (crudo: string): void => {
      let mensaje: unknown;
      try {
        mensaje = JSON.parse(crudo);
      } catch {
        return;
      }
      if (typeof mensaje !== 'object' || mensaje === null) return;
      const cuerpo = mensaje as Record<string, unknown>;

      if (cuerpo['tipo'] === 'error') {
        // No hay pantalla donde enseñar esto, y tampoco debería haberla: quien
        // usa la app no puede hacer nada con «no se pudo escribir el respaldo».
        // Pero tragárselo del todo dejaría un respaldo que no existe pareciendo
        // que existe, así que al menos queda en la consola del WebView, que es
        // donde se mira cuando algo se ha perdido.
        console.warn('No se pudo respaldar el diagrama:', cuerpo['motivo']);
        return;
      }

      if (cuerpo['tipo'] !== 'respaldo') return;
      const proyecto = cuerpo['proyecto'];
      const recibido = cuerpo['datos'];
      if (typeof proyecto !== 'string') return;

      const veredicto = convieneRestaurar(situacion.current.proyectoId, {
        proyecto,
        datos: typeof recibido === 'string' ? recibido : null,
      });
      if (!veredicto.restaurar || typeof recibido !== 'string') return;

      const bytes = leerBase64(recibido);
      if (bytes === null) {
        console.warn('El respaldo guardado no se puede leer: se descarta');
        return;
      }
      /*
        Mezclar, no sustituir. Una actualización de Yjs es un delta conmutativo:
        aplicar una copia vieja sobre el documento que ya cargó del IndexedDB no
        pisa nada más nuevo ni resucita lo borrado, porque los borrados viajan
        como lápidas. Si la copia sobraba, esto es un no-op; si el almacén se
        había vaciado, esto es el diagrama volviendo.
      */
      Y.applyUpdate(doc, bytes, ORIGEN_RESPALDO);
    };

    doc.on('update', programar);

    return () => {
      doc.off('update', programar);
      if (temporizador !== null) clearTimeout(temporizador);
      delete w[NOMBRE_RECEPTOR];
    };
  }, [doc]);

  /*
    Cuando cambia el estado de la conexión se decide en el acto, sin esperar los
    dos segundos. Los dos saltos que importan son inmediatos por motivos
    opuestos: al terminar de sincronizar hay que tirar la copia cuanto antes
    —cuanto más vieja, más daño puede hacer— y al caerse la conexión hay que
    escribirla antes de que el sistema decida congelar la aplicación.
  */
  useEffect(() => {
    evaluarRef.current();
  }, [doc, proyectoId, conexion, sincronizado, listoLocal]);

  /*
    Y se pide la copia una vez, en cuanto el IndexedDB termina de cargar.

    El orden importa: pedirla antes de que cargue el almacén y mezclarla en un
    documento vacío también funcionaría —mezclar es seguro— pero dejaría al
    documento pareciendo lleno antes de que `IndexeddbPersistence` escriba lo
    suyo, y las dos escrituras se pisarían en la pantalla. Esperando, lo que se
    mezcla se mezcla sobre el documento de verdad.
  */
  const pedido = useRef<string | null>(null);
  useEffect(() => {
    if (!listoLocal) return;
    if (pedido.current === proyectoId) return;
    const canal = ventana()?.[NOMBRE_CANAL];
    if (!canal) return;
    pedido.current = proyectoId;
    canal.postMessage(JSON.stringify({ tipo: 'leer', proyecto: proyectoId }));
  }, [listoLocal, proyectoId]);
}
