# 11. Comunicación interna

El tablón del proyecto: un hilo de mensajes por diagrama, con texto y con notas
de voz, para coordinarse mientras se modela sin salir a otra aplicación.

En el código se llama **tablón**. La palabra «comunicación» ya está ocupada en
este repositorio por el *diagrama de comunicación* de UML —`shared/src/model/comunicacion.ts`,
`VisorComunicacion`, la importación desde Enterprise Architect de [§5.14](05-guia-voz-y-ocr.md#514-importar-un-diagrama-de-comunicación-desde-xmi)—
y un tercer sentido de la misma palabra convertiría cada importación en una
pregunta. De cara a quien lo usa, el menú dice «Comunicación interna».

## 11.1 Qué es y qué no es

| | |
|---|---|
| **Uno por proyecto** | No hay canales por clase ni mensajería privada entre dos personas. La unidad es el proyecto porque es la unidad que la herramienta ya sabe autorizar: los permisos salen de `ProjectStore.roleOf` y no existe una segunda noción de «quién ve qué» que pueda desincronizarse de la primera |
| **Vive en el servidor** | A diferencia del historial de cambios, que viaja dentro del documento Yjs y está en el teléfono aunque no haya cobertura, el tablón es una tabla del backend. Sin red no hay nada que enseñar, y la aplicación lo dice en vez de enseñar un hilo vacío |
| **No es un archivo** | Se conservan los últimos **500 mensajes** por proyecto (`MAXIMO_MENSAJES_POR_PROYECTO`). Por encima de eso se borran los más antiguos con sus audios |
| **Sondeo, no WebSocket** | El navegador pregunta cada pocos segundos. El porqué está en [§11.5](#115-por-qué-sondeo-y-no-websocket) |

## 11.2 Quién puede escribir

Escribir exige ser **miembro del proyecto, incluso con rol `viewer`**. Va en
contra del reflejo de pedir `editor`, y es deliberado: a un `viewer` se le invita
precisamente para que revise el diagrama, y un revisor que no puede decir «esta
cardinalidad está al revés» no está revisando nada.

Retirar un mensaje puede hacerlo **su autor o el propietario del proyecto**. La
regla está escrita dos veces —en `api/tablon.ts` y en `puedeRetirar` de
`frontend/src/components/tablon.ts`—, pero la del cliente solo sirve para no
ofrecer un botón que va a dar 403. La que manda es la del servidor.

Un mensaje retirado **deja lápida**: la fila sobrevive marcada, sin texto y sin
audio, y en su sitio se lee «Mensaje retirado». No es un descuido. Un cliente que
pregunta «¿qué hay de nuevo?» no puede recibir por respuesta la ausencia de algo,
así que borrar la fila entera dejaría la nota de voz reproducible para siempre en
la pantalla de quien ya la tuviera cargada. Lo que sí se borra de verdad son los
bytes del audio.

## 11.3 Usarlo en el escritorio

El tablón es el tercer panel de la columna derecha, junto al historial de
cambios. Se abre desde **Ver → Comunicación interna** y empieza cerrado.

- **Escribir**: el cuadro de abajo. `Intro` envía y `Mayús+Intro` hace párrafo,
  como en cualquier chat. En una pantalla táctil no: allí `Intro` es el salto de
  línea del teclado del sistema y el envío es el botón, porque no hay forma de
  hacer `Mayús+Intro` con el pulgar. Tope de **2000 caracteres**, unas
  trescientas palabras.
- **Grabar una nota de voz**: el botón del micrófono. Cuenta el tiempo mientras
  graba y avisa en los últimos diez segundos; a los **90 segundos** se corta sola
  y se envía. Por debajo de medio segundo no se manda: eso es un botón pulsado
  sin querer, no una nota.
- **Escuchar**: los bytes **no** vienen en el listado. Se descargan al pulsar el
  botón de reproducir, y por eso un hilo con cuarenta notas de voz no descarga
  cuarenta audios al abrirlo.

El panel **solo se monta cuando está abierto**, y en eso es el único de los cinco
paneles acoplados: los demás se esconden con CSS. El tablón sondea, y un panel
plegado pero montado generaría tráfico permanente por una conversación que nadie
está mirando.

## 11.4 Usarlo en el teléfono

Entrada en el cajón lateral, grupo «Proyecto», entre «Historial de cambios» y
«Compartir». Abre la hoja **a altura completa** y no a media: a media caben tres
mensajes y el cuadro de escribir, y además el teclado va a subir en cuanto se
toque el cuadro.

Es la única acción del cajón que un `viewer` puede usar, igual que en el
servidor. Y a diferencia del historial, que está justo encima, **sin conexión se
apaga**: el historial viaja en el documento y está en el aparato; el tablón vive
en el servidor y en el metro no hay nada que enseñar.

En la app Flutter hace falta además el permiso de micrófono, que es lo que cuenta
[§11.6](#116-el-micrófono-dentro-del-webview).

## 11.5 Por qué sondeo y no WebSocket

Ya hay un WebSocket en marcha: el de Yjs, que sincroniza el diagrama. La
tentación era meter los mensajes por ahí.

No se hizo por tres motivos. El primero es que el documento Yjs se replica entero
en cada cliente y se guarda en el navegador: meter la conversación dentro
significaría que el historial de mensajes se descarga con el diagrama y sobrevive
en el disco de todo el que haya entrado alguna vez. El segundo es que retirar un
mensaje en un CRDT no lo borra de ningún sitio —queda en el historial de
operaciones—, y «retirar» tiene que borrar bytes de verdad. El tercero es que el
tablón necesita permisos por rol y un CRDT no los tiene: quien puede escribir en
el documento puede escribirlo todo.

El sondeo no es de intervalo fijo. `siguienteEspera` mira tres cosas:

| Situación | Espera |
|---|---|
| Conversación en marcha | 3 s |
| Nadie dice nada desde hace 5 vueltas | 10 s |
| Nadie dice nada desde hace 20 | 30 s |
| Pestaña en segundo plano | 60 s |
| El servidor no contesta | retroceso exponencial hasta 30 s |

Cualquier mensaje que llegue devuelve el contador a cero, así que una
conversación activa nunca se ralentiza. En segundo plano no se para del todo a
propósito: al volver a la pestaña conviene que el hilo esté casi al día en lugar
de enseñar la conversación de hace media hora mientras carga.

El error de red **no se enseña hasta el tercer fallo seguido**. Una red móvil se
cae un segundo con regularidad, y un panel que grita «sin conexión» en cada bache
es ruido.

### Las dos numeraciones

Cada mensaje lleva dos números y confundirlos rompe una de las dos cosas:

- **`secuencia` ordena.** Se asigna al publicar y no cambia nunca.
- **`version` sincroniza.** Se reasigna cada vez que el mensaje cambia, que hoy
  solo ocurre al retirarlo. Es lo que el cliente manda en `?desde=`.

Con una sola numeración habría que elegir cuál se rompe. Reutilizando `secuencia`
como cursor y subiéndola al retirar, el mensaje retirado saltaría al final del
hilo delante de quien lo estuviera leyendo. Sin subirla, quien ya hubiera pasado
de ese número nunca se enteraría de la retirada.

## 11.6 El micrófono dentro del WebView

Esta es la parte que más cuesta diagnosticar si falla, porque no da ningún error
visible.

Cuando la página llama a `getUserMedia` dentro de la app Flutter, el permiso hay
que darlo **dos veces y a dos interlocutores distintos**:

1. **Al WebView**, que pregunta si esa página puede usar el micrófono. Se
   contesta desde `setOnPlatformPermissionRequest`.
2. **A Android**, que pregunta si *la app* puede usar el micrófono. Ese es el
   diálogo del sistema, y **el WebView no lo abre solo**.

Conceder solo la primera es el fallo que motivó `mobile/lib/permisos_nativos.dart`:
el WebView dice que sí, la página cree que tiene permiso, y al abrir el micrófono
Android lo niega. Lo que llega al navegador es un `NotAllowedError`
indistinguible de que la persona haya dicho que no, así que el tablón enseña
«hay que abrir el candado de la barra de direcciones» —consejo inútil en una app
sin barra de direcciones— y nadie sabe por qué no graba.

Hasta el tablón nadie había pedido el micrófono por esta vía: la cámara la abre
`image_picker` y el dictado lo hace `speech_to_text`, y cada uno pide lo suyo
desde su propio código nativo. Las notas de voz son la primera función que captura
audio **desde la página**.

De paso se dejó de conceder a ciegas. Ahora se deniega lo que no se reconoce
—MIDI SysEx, identificadores de medios protegidos— y se concede **todo o nada**,
porque la petición del WebView es todo o nada: no hay forma de contestar «la
cámara sí y el micrófono no».

Si al grabar desde el teléfono no pasa nada, en este orden:

1. ¿`RECORD_AUDIO` en `AndroidManifest.xml`? Sí, está desde hace tiempo. Eso solo
   da derecho a preguntar.
2. ¿Se rechazó el diálogo con «no volver a preguntar»? Android no vuelve a
   abrirlo. Hay que ir a los ajustes de la aplicación.
3. ¿La URL es `localhost`? Los navegadores tratan `localhost` como origen seguro,
   así que el micrófono está permitido. Sobre `http://192.168.x.x` estaría
   bloqueado por no ser HTTPS, y el fallo se lee igual.

## 11.7 Formatos y límites

| | |
|---|---|
| Texto | 2000 caracteres, contados después de recortar los extremos |
| Nota de voz | 90 s y 1 MB. El límite que frena es el de tiempo, que se ve contando; el de bytes es holgado a propósito |
| Tipos de audio | `audio/webm` (Chrome), `audio/ogg` (Firefox), `audio/mp4` (Safari) |
| Publicación | 30 mensajes por minuto y usuario |
| Página | 50 mensajes |

La lista de tipos es cerrada y se valida **rechazando, no limpiando**: el valor
vuelve a salir tal cual en la cabecera `Content-Type` de la descarga, y lo que se
guarda no es la cadena del cliente saneada sino uno de los tres literales de
`TIPOS_AUDIO`.

La cuota de publicación se monta **ruta a ruta** y no en `app.ts` como las demás,
porque el camino `/proyectos/:id/tablon` incluye el sondeo: montada arriba,
gastaría cuota con cada vuelta del temporizador y el tablón se apagaría solo a
los tres minutos de tenerlo abierto.

## 11.8 Dónde está cada cosa

| Fichero | Qué contiene |
|---|---|
| `shared/src/tablon/mensaje.ts` | El contrato: esquemas, límites, las dos numeraciones, la lápida |
| `backend-tool/src/storage/tablon.ts` | El almacén, en fichero y en PostgreSQL |
| `backend-tool/src/api/tablon.ts` | Las cinco rutas HTTP y la autorización |
| `frontend/src/components/tablon.ts` | Lógica pura: fusión, cursor, agrupación por bloques, cadencia del sondeo |
| `frontend/src/components/grabadora.ts` | La máquina de estados de la grabación |
| `frontend/src/components/PanelTablon.tsx` | El panel, compartido por escritorio y móvil |
| `mobile/lib/permisos_nativos.dart` | El permiso de micrófono del WebView |

`PanelTablon.tsx` se llama así y no `Tablon.tsx` por una razón tonta pero real:
la lógica pura vive en `tablon.ts`, y ni Windows ni macOS distinguen mayúsculas
en los nombres de fichero, así que `Tablon.tsx` sería el mismo fichero y
TypeScript se niega a compilar.

## 11.9 Qué está probado y qué no

Probado con pruebas automáticas: la lógica del cliente (`tablon.test.ts`, 30
casos), la grabación (`grabadora.test.ts`, 26), el almacén y la API en el backend,
y la decisión de permisos del WebView (`permisos_nativos_test.dart`, 11).

**Sin prueba automática**: el panel montado. No hay jsdom en este proyecto
([tarea #15](README.md)), así que lo que se comprueba es la lógica extraída del
componente, no el componente. Y **sin verificar en un teléfono real**: la
grabación desde la app Flutter está escrita y analizada, pero no se ha probado
sobre un aparato. Es lo primero que hay que hacer con el siguiente APK.
