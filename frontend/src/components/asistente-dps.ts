import type { NombreIcono } from './iconos';

/**
 * El recorrido de primer acceso: contenido y reglas, sin una sola línea de DOM.
 *
 * Mismo reparto que en `barra-menu.ts` y por el mismo motivo. Lo que se rompe de
 * un recorrido guiado no es el dibujo: es que «Siguiente» se salga por el final,
 * que el índice y los puntos dejen de decir lo mismo, que Escape no cuente como
 * visto y el recorrido vuelva a salir en cada recarga, o —el peor— que cambie el
 * contenido y a quien ya lo vio no se le enseñe nunca lo nuevo. Nada de eso lo
 * ve el compilador ni se nota mirando la pantalla una vez, porque con el ratón y
 * con el `localStorage` recién puesto siempre va bien.
 *
 * Aquí están esas reglas escritas como funciones puras, así que se comprueban
 * sin navegador. Es lo que permite que existan pruebas de esto mientras jsdom
 * siga sin instalarse (tarea 15).
 *
 * El contenido también vive aquí, y no repartido por el `.tsx`. Lo que el
 * recorrido promete es lo que la herramienta hace, y eso se contrasta leyendo un
 * fichero entero, no persiguiendo cadenas entre etiquetas.
 */

/* --------------------------------------------------------------------------
   El contenido
   -------------------------------------------------------------------------- */

/** Un punto dentro de una sección: lo que se lee y el icono que lo acompaña. */
export interface PuntoDelPaso {
  /** Rótulo corto. Es también lo que aparece desplegado en el índice. */
  titulo: string;
  /** La frase que lo explica. Una, no un párrafo: esto se lee de pie. */
  texto: string;
  icono: NombreIcono;
}

export interface PasoDelAsistente {
  id: string;
  /** Cómo se llama en el índice. Más corto que el título de la lámina. */
  rotulo: string;
  titulo: string;
  /** La frase de entrada, que da el porqué antes de la lista. */
  entradilla: string;
  puntos: PuntoDelPaso[];
  /**
   * Una advertencia al pie, cuando la hay. Se usa para lo que de otro modo se
   * descubre tarde: que algo es opcional, o que necesita algo que no viene
   * puesto.
   */
  nota?: string;
}

/**
 * Las seis láminas.
 *
 * La primera es portada y las cinco siguientes son las secciones pedidas:
 * propósito, funcionalidades, implementación, requisitos y criterios de éxito.
 * Que la portada sea un paso más y no una pantalla aparte es deliberado: así el
 * índice, los puntos de progreso y el teclado tratan todo por igual, y no hay
 * dos caminos de navegación que mantener sincronizados.
 */
export const PASOS: PasoDelAsistente[] = [
  {
    id: 'portada',
    rotulo: 'Portada',
    titulo: 'Asistente de DPS',
    entradilla:
      'Recorrido de primer acceso a la herramienta CASE: del diagrama de clases al backend ' +
      'Spring Boot que compila. Son seis láminas y se puede salir en cualquier momento.',
    puntos: [
      {
        titulo: 'Qué es esta herramienta',
        texto:
          'Un editor UML colaborativo que además genera el proyecto Java a partir de lo que ' +
          'hay dibujado en el lienzo.',
        icono: 'clase',
      },
      {
        titulo: 'Cómo se recorre',
        texto:
          'Con «Siguiente» y «Anterior», con las flechas del teclado, o saltando a una sección ' +
          'desde el índice de la izquierda.',
        icono: 'desplegar',
      },
      {
        titulo: 'Si se cierra ahora',
        texto:
          'No vuelve a abrirse solo. Queda disponible en «Ver el recorrido», dentro del panel ' +
          'de ayuda.',
        icono: 'historial',
      },
    ],
    nota: 'El recorrido no bloquea nada: se puede cerrar y empezar a modelar directamente.',
  },

  {
    id: 'proposito',
    rotulo: 'Propósito de la guía',
    titulo: 'Para qué sirve esta guía',
    entradilla:
      'La mitad de lo que hace la herramienta no se adivina mirando el lienzo. Esta guía la ' +
      'nombra una vez, al principio, en lugar de dejar que se descubra por casualidad o no se ' +
      'descubra.',
    puntos: [
      {
        titulo: 'Sin manual aparte',
        texto:
          'La explicación vive dentro de la interfaz. No hay un PDF que se quede desfasado en ' +
          'una carpeta compartida.',
        icono: 'modulo',
      },
      {
        titulo: 'Después del recorrido, el botón «? Ayuda»',
        texto:
          'Responde preguntas concretas buscando en los once documentos de «docs/», con o sin ' +
          'conexión.',
        icono: 'comunicacion',
      },
      {
        titulo: 'Lo que no es',
        texto:
          'No es un tutorial obligatorio ni un asistente que rellene el diagrama: solo señala ' +
          'dónde está cada cosa y en qué orden conviene usarla.',
        icono: 'alerta',
      },
    ],
  },

  {
    id: 'funcionalidades',
    rotulo: 'Funcionalidades clave',
    titulo: 'Lo que el asistente pone a mano',
    entradilla:
      'Ocho capacidades, todas accesibles desde la barra del editor. Las cuatro primeras sirven ' +
      'para construir el modelo; las cuatro últimas, para sacarle partido.',
    puntos: [
      {
        titulo: 'Diagrama compartido en tiempo real',
        texto:
          'Varias personas editan el mismo lienzo a la vez; cada cursor lleva su color y los ' +
          'cambios no se pisan.',
        icono: 'comunicacion',
      },
      {
        titulo: 'Modelado desde una fotografía',
        texto:
          'Una foto de la pizarra se convierte en clases, atributos y relaciones revisables ' +
          'antes de aceptarlas.',
        icono: 'imagen',
      },
      {
        titulo: 'XMI 2.1 en los dos sentidos',
        texto:
          'El modelo entra y sale en el formato que abren Enterprise Architect, Papyrus y ' +
          'StarUML.',
        icono: 'exportar',
      },
      {
        titulo: 'Edición por voz',
        texto:
          'Las órdenes dictadas crean clases y relaciones; las acciones críticas se confirman ' +
          'hablando antes de aplicarse.',
        icono: 'microfono',
      },
      {
        titulo: 'Revisor de modelado',
        texto:
          'Señala lo que está mal antes de generar y ofrece arreglar de una vez lo que impide ' +
          'la generación.',
        icono: 'revisar',
      },
      {
        titulo: 'Generación del backend',
        texto:
          'Del diagrama sale un proyecto Spring Boot con sus cuatro capas, el DTO y el esquema ' +
          'de PostgreSQL.',
        icono: 'modulo',
      },
      {
        titulo: 'Módulos del dominio',
        texto:
          'El diagrama se reparte en contextos acotados, y ese reparto se traduce en subpaquetes ' +
          'Java de verdad.',
        icono: 'clase',
      },
      {
        titulo: 'Asistente móvil',
        texto:
          'Una app Flutter lee el manifiesto del backend generado y permite darlo de alta todo ' +
          'por voz, incluso sin cobertura.',
        icono: 'altavoz',
      },
    ],
  },

  {
    id: 'implementacion',
    rotulo: 'Pasos de implementación',
    titulo: 'Del lienzo vacío al backend en marcha',
    entradilla:
      'Seis pasos en orden. Los tres primeros son de modelado, el cuarto es la verificación y ' +
      'los dos últimos producen y levantan el código.',
    puntos: [
      {
        titulo: '1. Crear el proyecto',
        texto:
          'Desde la lista de proyectos. La dirección que queda en la barra del navegador es la ' +
          'que se comparte para que otra persona entre al mismo diagrama.',
        icono: 'mas',
      },
      {
        titulo: '2. Modelar las clases',
        texto:
          'Con la paleta, dictando, importando un XMI o partiendo de una fotografía. Las cuatro ' +
          'vías dejan el mismo modelo.',
        icono: 'clase',
      },
      {
        titulo: '3. Repartir en módulos',
        texto:
          'Antes de que el dominio pase de unas veinte clases. Después, reordenar cuesta más que ' +
          'hacerlo desde el principio.',
        icono: 'modulo',
      },
      {
        titulo: '4. Revisar',
        texto:
          'El revisor distingue lo que impide generar de lo que solo es mejorable, y lo primero ' +
          'se arregla con un botón.',
        icono: 'revisar',
      },
      {
        titulo: '5. Generar y descargar',
        texto:
          'El recuento por capas se ve antes de bajar el ZIP, así que se sabe qué trae sin ' +
          'abrirlo.',
        icono: 'exportar',
      },
      {
        titulo: '6. Levantar el proyecto',
        texto:
          'Con «mvn spring-boot:run» contra una base PostgreSQL. A partir de ahí, el asistente ' +
          'móvil ya puede apuntar a él sin recompilarse.',
        icono: 'comprobado',
      },
    ],
    nota: 'El orden importa solo entre el 4 y el 5: generar sin revisar produce un proyecto que no compila.',
  },

  {
    id: 'requisitos',
    rotulo: 'Requisitos técnicos',
    titulo: 'Qué hace falta, y qué es opcional',
    entradilla:
      'Lo imprescindible es un navegador. El resto son requisitos de lo que se produce, no de la ' +
      'herramienta, y conviene saber cuáles son opcionales antes de darlos por obligatorios.',
    puntos: [
      {
        titulo: 'Para editar: un navegador al día',
        texto:
          'La aplicación se instala como PWA y el diagrama sigue editándose sin conexión; al ' +
          'volver la red, se sincroniza.',
        icono: 'clase',
      },
      {
        titulo: 'Para el desarrollo: Node 20 o superior',
        texto:
          'El monorepo son cuatro espacios de trabajo —shared, generator, backend-tool y ' +
          'frontend— sobre npm workspaces.',
        icono: 'modulo',
      },
      {
        titulo: 'Para el proyecto generado: JDK 17 y PostgreSQL',
        texto:
          'Spring Boot 3.3.5 sobre Java 17, verificado compilando y arrancando lo que sale del ' +
          'generador.',
        icono: 'comprobado',
      },
      {
        titulo: 'Opcional: Ollama en el equipo',
        texto:
          'Si escucha en localhost:11434, la ayuda responde redactando con un modelo local. Sin ' +
          'él sigue funcionando: busca en el manual y cita los fragmentos.',
        icono: 'comunicacion',
      },
      {
        titulo: 'Opcional: micrófono con permiso',
        texto:
          'La voz necesita el permiso del navegador. Dentro de la app de Android lo aporta el ' +
          'puente nativo.',
        icono: 'microfono',
      },
      {
        titulo: 'Opcional: Enterprise Architect',
        texto: 'Solo si el XMI exportado se va a abrir ahí. Exportarlo no lo requiere.',
        icono: 'exportar',
      },
    ],
    nota: 'Ninguna función depende de una clave de API para editar el diagrama: la lectura de fotografías sí la usa, y es la única.',
  },

  {
    id: 'criterios',
    rotulo: 'Criterios de éxito',
    titulo: 'Cómo comprobar que funciona',
    entradilla:
      'Siete comprobaciones observables, cada una con su caso de prueba en «docs/pruebas». Si ' +
      'las siete salen, la instalación está bien.',
    puntos: [
      {
        titulo: 'La colaboración se ve (CP-01)',
        texto:
          'Con el mismo proyecto abierto en dos ventanas, mover una caja en una la mueve en la ' +
          'otra, y arriba aparece quién está mirando.',
        icono: 'comunicacion',
      },
      {
        titulo: 'El revisor queda en cero (CP-08, CP-09)',
        texto: 'Sin errores bloqueantes pendientes después de pulsar el arreglo automático.',
        icono: 'revisar',
      },
      {
        titulo: 'El ZIP trae las cuatro capas (CP-07)',
        texto:
          'Entidad, repositorio, servicio y controlador, más el DTO, y el proyecto compila con ' +
          'Maven.',
        icono: 'modulo',
      },
      {
        titulo: 'La ida y vuelta del XMI conserva el modelo (CP-06)',
        texto: 'Lo exportado, vuelto a importar, produce las mismas clases y las mismas relaciones.',
        icono: 'exportar',
      },
      {
        titulo: 'La voz modifica el diagrama (CP-10, CP-11)',
        texto:
          'Una orden dictada crea la clase en el lienzo; en el teléfono, la confirmación se oye ' +
          'antes de aplicarse.',
        icono: 'microfono',
      },
      {
        titulo: 'Sin cobertura no se pierde ni se duplica (CP-12)',
        texto:
          'Lo registrado en modo avión se reenvía al volver la red, y reenviarlo dos veces deja ' +
          'un solo registro.',
        icono: 'historial',
      },
      {
        titulo: 'La ayuda responde sin conexión (CP-13)',
        texto:
          'Con la red cortada, «? Ayuda» sigue contestando y citando el documento del que sale ' +
          'cada respuesta.',
        icono: 'comprobado',
      },
    ],
  },
];

/* --------------------------------------------------------------------------
   Persistencia: si ya se vio, y de qué versión
   -------------------------------------------------------------------------- */

/**
 * La versión del recorrido, que se guarda junto al «ya visto».
 *
 * Guardar solo un booleano tiene un fallo que tarda meses en aparecer y luego no
 * se arregla: el día que el recorrido cuente algo nuevo, las personas que más lo
 * necesitan —las que llevan tiempo usando la herramienta— son exactamente las
 * que nunca lo verán, porque su marca de «visto» es de hace un año.
 *
 * Se sube **a mano**, y solo cuando cambia lo que hay que contar. Atarla al
 * número de versión del paquete la subiría en cada parche y convertiría el
 * recorrido en una ventana que reaparece sin motivo, que es la otra forma de
 * que acabe ignorado.
 */
export const VERSION_DEL_RECORRIDO = 1;

export const CLAVE_VISTO = 'dps.recorrido.visto';

/**
 * Lo mínimo que hace falta de `localStorage`, para poder probarlo sin navegador.
 *
 * No se escribe `Storage` a secas: obligaría a las pruebas a fabricar los siete
 * miembros de esa interfaz para usar dos.
 */
export interface AlmacenDeVisitas {
  leer(clave: string): string | null;
  escribir(clave: string, valor: string): void;
}

/**
 * El almacén real.
 *
 * Los dos `try` no son decoración defensiva. En Firefox con las cookies
 * bloqueadas y en una ventana privada de Safari, leer `localStorage` **lanza**
 * en lugar de devolver nulo; sin el `catch`, la aplicación entera se quedaría en
 * blanco por culpa del recorrido de bienvenida. El peor comportamiento
 * aceptable aquí es que el recorrido salga cada vez, no que no arranque nada.
 */
export const almacenDelNavegador: AlmacenDeVisitas = {
  leer(clave) {
    try {
      return localStorage.getItem(clave);
    } catch {
      return null;
    }
  },
  escribir(clave, valor) {
    try {
      localStorage.setItem(clave, valor);
    } catch {
      /* Sesión sin almacenamiento: el recorrido volverá a salir, y no pasa nada. */
    }
  },
};

/**
 * ¿Hay que abrirlo solo?
 *
 * Sí en el primer acceso, y sí también cuando lo guardado es de una versión
 * anterior a la actual. Un valor que no sea un número —basura de otra versión de
 * la aplicación, o alguien tocando el almacenamiento— cuenta como no visto: es
 * la única lectura que no deja a nadie sin la explicación.
 */
export function debeAbrirse(almacen: AlmacenDeVisitas): boolean {
  const guardado = almacen.leer(CLAVE_VISTO);
  if (guardado === null) return true;
  const version = Number.parseInt(guardado, 10);
  if (!Number.isFinite(version)) return true;
  return version < VERSION_DEL_RECORRIDO;
}

/**
 * Se marca como visto al cerrarlo, **salga como salga**: terminado, saltado o
 * con Escape.
 *
 * La tentación es marcarlo solo al llegar al final, para «asegurar» que se lea
 * entero. Es al revés: quien lo salta lo ha decidido, y volver a plantárselo en
 * la siguiente recarga no le enseña nada, solo le enseña a cerrar ventanas sin
 * leerlas.
 */
export function marcarVisto(almacen: AlmacenDeVisitas): void {
  almacen.escribir(CLAVE_VISTO, String(VERSION_DEL_RECORRIDO));
}

/* --------------------------------------------------------------------------
   Navegación
   -------------------------------------------------------------------------- */

/** Cómo terminó el recorrido. Se distingue porque no significan lo mismo. */
export type SalidaDelRecorrido = 'terminado' | 'saltado';

export interface ResultadoAsistente {
  /** El paso en el que queda. Aunque salga, para que el cierre no dé un salto. */
  paso: number;
  salir?: SalidaDelRecorrido;
}

export const TOTAL_PASOS = PASOS.length;

/**
 * Acota un índice al rango real. Existe para que nadie lo haga a ojo.
 *
 * `NaN` se trata aparte de los infinitos, y la diferencia no es un tecnicismo:
 * un infinito sigue diciendo hacia qué lado se iba —recortarlo al primero o al
 * último conserva esa intención—, mientras que `NaN` no dice nada y lo único
 * razonable es empezar por la portada. Escrito con `Number.isFinite` los tres
 * casos caían en cero, y `acotar(Infinity)` devolvía la portada en vez de la
 * última lámina.
 */
export function acotar(paso: number, total = TOTAL_PASOS): number {
  if (Number.isNaN(paso)) return 0;
  return Math.min(Math.max(Math.trunc(paso), 0), total - 1);
}

export function esUltimo(paso: number, total = TOTAL_PASOS): boolean {
  return acotar(paso, total) === total - 1;
}

/**
 * Avanzar. En el último paso **no** da la vuelta: termina.
 *
 * Un recorrido que vuelve a la portada al pulsar «Siguiente» en la última lámina
 * es un bucle sin salida visible, y quien no encuentre el botón de cerrar
 * acabará recargando la página.
 */
export function siguiente(paso: number, total = TOTAL_PASOS): ResultadoAsistente {
  const actual = acotar(paso, total);
  if (actual === total - 1) return { paso: actual, salir: 'terminado' };
  return { paso: actual + 1 };
}

/** Retroceder. En la portada se queda quieto: «Anterior» sale deshabilitado. */
export function anterior(paso: number, total = TOTAL_PASOS): ResultadoAsistente {
  return { paso: Math.max(0, acotar(paso, total) - 1) };
}

/** Saltar a una sección desde el índice. */
export function irA(destino: number, total = TOTAL_PASOS): ResultadoAsistente {
  return { paso: acotar(destino, total) };
}

/**
 * El teclado del recorrido.
 *
 * Devuelve `null` cuando la tecla no es asunto suyo, igual que `moverEnMenu`.
 * Ese contrato es el que permite que el componente no tenga que enumerar las
 * teclas que debe dejar pasar: si esto devuelve nulo, el evento sigue su curso y
 * el tabulador, las mayúsculas y los atajos del navegador siguen funcionando.
 *
 * Solo las flechas **horizontales** cambian de lámina. Antes también lo hacían
 * `ArrowUp`/`ArrowDown`, `PageUp`/`PageDown`, `Home` y `End`, con el argumento
 * de que la mano encuentra unas u otras indistintamente. Al mirar el recorrido
 * en una ventana de verdad apareció lo que ese argumento no contaba: la lámina
 * de las ocho funcionalidades no cabe en la caja y hay que **desplazarla**, y
 * esas seis teclas son justamente las que desplazan. Ocupadas todas, quien no
 * usa el ratón no tenía manera de llegar al final de la lámina: al intentar
 * bajar, saltaba a la siguiente.
 *
 * Lo que se pierde es el atajo para ir a la primera o a la última de un golpe;
 * queda el índice, que está siempre a la vista y se alcanza con el tabulador.
 * Lo que se gana es poder leer la lámina entera, que no es un atajo.
 */
export function moverEnAsistente(
  paso: number,
  tecla: string,
  total = TOTAL_PASOS,
): ResultadoAsistente | null {
  switch (tecla) {
    case 'ArrowRight':
      return siguiente(paso, total);
    case 'ArrowLeft':
      return anterior(paso, total);
    // Escape cierra, y cierra contando como visto. Es lo mismo que «Saltar»: la
    // diferencia entre las dos es el gesto, no la intención.
    case 'Escape':
      return { paso: acotar(paso, total), salir: 'saltado' };
    default:
      return null;
  }
}

/**
 * El texto de progreso, en palabras.
 *
 * Los puntos de debajo dicen cuántas láminas hay, pero contarlos exige mirarlos
 * uno a uno, y no los lee ningún lector de pantalla. Esta frase es la que se
 * anuncia al cambiar de lámina.
 */
export function progreso(paso: number, total = TOTAL_PASOS): string {
  return `Lámina ${String(acotar(paso, total) + 1)} de ${String(total)}`;
}
