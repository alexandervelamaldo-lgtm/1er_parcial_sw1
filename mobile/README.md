# uml_movil

Cliente móvil de la herramienta colaborativa de diagramas UML.

Son **dos aplicaciones dentro de la misma app**, y conviene saber cuál se está
mirando antes de tocar nada:

| | Qué es | Dónde vive |
|---|---|---|
| **Editor** | Una carcasa `WebView` sobre el editor de diagramas, con puentes nativos para el micrófono, el altavoz y las descargas | `lib/main.dart` (`PantallaWeb`), `lib/voz_nativa.dart`, `lib/descarga_nativa.dart` |
| **Asistente** | Un cliente genérico del **backend generado**: lee su manifiesto y de ahí saca pantallas, formularios y vocabulario | `lib/asistente/` |

El editor sirve para dibujar el modelo. El asistente sirve para operar sobre los
datos de la aplicación que ese modelo generó: «apúntame una cita para mañana a
las diez» y la cita acaba en PostgreSQL.

## Por qué las descargas necesitan un puente

Dentro del `WebView`, pulsar «descargar el ZIP» o «exportar a XMI» no hacía
nada, y sin decirlo. Son tres motivos encadenados, y ninguno se arregla solo:

1. Sin un `DownloadListener` registrado, un `<a download>` no dispara nada.
2. Aunque lo hubiera, ese oyente recibe una **URL** para el `DownloadManager`,
   y una `blob:` vive dentro del proceso del navegador: no hay nada que
   descargar desde fuera.
3. El ZIP además sale de un **POST con cabecera de autorización**, y el
   `DownloadManager` hace GET anónimos.

Así que el fichero viaja por un canal de JavaScript, en trozos de 256 KiB de
base64 porque el Binder de Android corta alrededor de 1 MB por transacción —y
cuando corta, el mensaje se pierde en silencio, no lanza—. El lado web está en
`frontend/src/services/descarga.ts` y el nativo en `lib/descarga_nativa.dart`;
los dos tienen pruebas que no necesitan teléfono.

Al llegar, el fichero se escribe en el directorio de documentos de la app y se
ofrece por el diálogo de compartir del sistema. No va a `Downloads` a propósito:
desde Android 10 una app no puede escribir ahí sin `MediaStore` o el selector
del sistema, mientras que compartir no pide ningún permiso. Por eso el aviso
dice **dónde** quedó la copia: si se ha mandado por WhatsApp, en el teléfono no
queda rastro visible.

## El editor en un teléfono no es el editor encogido

Dentro del `WebView` se sirve el mismo frontend, pero por debajo de 820 px se
monta de otra manera. No es una cuestión de que quepa menos:

- **Las acciones bajan al canto inferior.** La cabecera —menú, título, iconos—
  es la franja más lejana del pulgar de la mano que sujeta el aparato, y con un
  ratón es la esquina más cómoda. La misma disposición que está bien en el
  portátil está mal en el teléfono. En pantalla estrecha la barra de
  herramientas de la cabecera no se monta y aparece `BarraPulgar`: cinco
  botones —clase, relación, deshacer, ficha, encuadrar— de los que **ninguno
  destruye nada**, que es lo que hace aceptable ponerlos donde el pulgar
  descansa. «Eliminar» sigue viviendo en el menú y en el panel, que preguntan
  antes y dicen a cuántas relaciones se va a llevar por delante.
- **El cromo de React Flow desaparece.** Los controles y el minimapa ocupan las
  dos esquinas de abajo, que son las que el pulgar alcanza, y el minimapa
  además se traga el arrastre: cada intento de mover el diagrama que empieza
  sobre su rectángulo mueve el mapa. El zoom se hace con pellizco, y encuadrar
  está en la barra del pulgar.
- **Los objetivos crecen por `pointer: coarse`, no por ancho.** Son preguntas
  distintas: una tableta en horizontal es ancha y se toca con el dedo. El
  mínimo es 44 px —`LADO_TACTIL` en `frontend/src/components/barra-pulgar.ts`—
  y `estilos.test.ts` comprueba la hoja contra esa constante para que no se
  separen.
- **El dedo no emite cursor de presencia.** Un puntero táctil solo existe
  mientras toca el cristal, así que lo que veían los demás no era hacia dónde
  mira nadie, sino el rastro del último arrastre congelado sobre una clase.

Las reglas de qué botón está apagado y por qué viven en
`frontend/src/components/barra-pulgar.ts` y se prueban sin navegador; el `.tsx`
solo dibuja.

## La foto de la pizarra se endereza antes de leerla

«Desde imagen» es la función estrella del proyecto: se fotografía un diagrama en
una pizarra y un modelo de visión lo convierte en clases y relaciones. En el
teléfono eso tenía un problema que en el portátil no existe, porque en el
portátil se sube un fichero ya hecho: **una foto de una pizarra nunca está de
frente**. Sale torcida, con la mesa alrededor, y —esto es lo que importa— con el
borde lejano comprimido. No es un defecto estético: un diagrama fotografiado de
lado se lee mal, y lo que se pierde son justo los nombres de los atributos del
lado que quedó lejos.

Desde JavaScript eso no se puede arreglar, así que se arregla en Flutter. Al
pulsar «Desde imagen» se abre la cámara, aparece una pantalla con la foto y
cuatro asas, se arrastran hasta las esquinas del diagrama, y a la página le
llega un JPEG ya rectificado.

### El recorte no es un recorte: es una homografía

`copyRectify`, del paquete `image`, existe y hace casi esto. Está descartada a
propósito, porque su mapa es una **interpolación bilineal** de los cuatro
vértices: coloca bien las cuatro esquinas y mal todo lo de en medio. Con ella el
centro de la pizarra cae en el promedio de las cuatro esquinas, que es justo
donde no está —en una perspectiva de verdad el centro se desplaza hacia el lado
lejano—, y el resultado es una imagen con los bordes cuadrados y el interior
todavía deformado.

Lo correcto es la transformación proyectiva de ocho parámetros, que conserva las
rectas y reproduce el escorzo exacto. Está en `lib/camara/geometria.dart`, se
resuelve por Gauss con pivoteo parcial —obligatorio: la primera ecuación empieza
por `u = 0`, así que sin pivotar el primer pivote es cero exacto— y la prueba que
separa las dos cosas es la del punto medio de un trapecio: la bilineal lo pone
en el centro geométrico, la homografía en `y = 50/3`.

Un detalle que costó tres intentos: **que el sistema lineal se resuelva no basta**.
Con tres esquinas en línea recta la eliminación termina sin un solo pivote
pequeño y devuelve una matriz de buen aspecto que en realidad aplasta el plano
sobre una recta. Reproyectar las cuatro esquinas para comprobarlo tampoco vale,
porque esas ecuaciones *son* el sistema y se cumplen por construcción. Lo que
funciona es exigir que el divisor se mantenga lejos de cero, y como es afín
basta con mirarlo en los cuatro vértices. Los tres intentos están escritos en el
código para que nadie los repita.

### Cómo llega a la página

Por un fichero, no por un canal. `_elegirImagen` en `lib/main.dart` intercepta el
`<input type="file" capture="environment">` que la página ya tenía, y devuelve la
ruta de un temporal con el JPEG rectificado. **El frontend no cambia ni una
línea.**

La alternativa era devolver los bytes por un canal de JavaScript, y se descartó
al ver lo que costaba: bajar datos a la página va por `runJavaScript`, que mete
la carga en la cadena del guion y choca con el tope de ~1 MB del Binder
*perdiendo el mensaje en silencio*, así que haría falta trocear y reensamblar; y
el protocolo viviría partido entre dos lenguajes sin ningún compilador que
comprobara que siguen de acuerdo. Ese puente está escrito y probado en
`lib/camara_nativa.dart`, pero **no está conectado**, y su cabecera lo dice: se
guarda para el día que la página quiera pedir una foto por su cuenta o
distinguir «se canceló» de «falló», que un selector de ficheros no sabe decir.

Solo la cámara pasa por el recorte. Una imagen elegida de la galería suele ser
una captura de pantalla o un PNG exportado de otra herramienta, que ya están de
frente.

### Las dos cosas que se hacen una sola vez, y a propósito

- **La orientación EXIF se hornea al principio.** Casi ningún teléfono gira la
  foto al guardarla: la escribe como la leyó el sensor y anota aparte «esto va
  girado 90°». Flutter respeta esa etiqueta al pintar y `decodeImage` **no** la
  aplica. Si la pantalla de recorte enseñara los bytes originales, las esquinas
  se marcarían sobre una foto vertical y se aplicarían sobre una horizontal. Se
  resuelve en `enderezarOrientacion`, que gira, reencodifica y borra la etiqueta;
  a partir de ahí solo circulan esos bytes, así que nadie puede aplicarla dos
  veces. Es un fallo que no sale nunca en el emulador y sale siempre en un
  teléfono sujeto en vertical.
- **El enderezado va en otro isolate.** Recorrer dos millones de píxeles en Dart
  puro pasa del segundo. En el hilo de la interfaz eso es la pantalla congelada
  justo después del disparador, y si se alarga, el diálogo de «la aplicación no
  responde». `lib/camara/rectificar.dart` **no importa Flutter**, precisamente
  para que esa decisión no se pueda saltar por descuido.

### Las esquinas se guardan en píxeles de la imagen

Nunca en coordenadas de pantalla, aunque para pintar fuera más cómodo: al girar
el teléfono la caja cambia de tamaño y el recorte se movería solo. Las cuentas
de la conversión están en `lib/camara/recorte_en_pantalla.dart`, en Dart puro y
sin Flutter, porque los fallos de ahí —un margen mal aplicado— se ven en un
teléfono con otra proporción de pantalla y no en el que se probó. Las asas miden
44 px, el mismo `LADO_TACTIL` que la web.

Se puede dejar el cuadrilátero cruzado o aplastado: se avisa y no se deja
aceptar, pero no se bloquea el arrastre, porque para deshacer un cruce hay que
pasar por una posición que no vale.

## La guía está en `docs/`

**[docs/10-asistente-movil.md](../docs/10-asistente-movil.md)** es la
documentación de uso del asistente: el repertorio de órdenes, el ciclo hablado,
la bandeja de salida cuando no hay cobertura y por qué reenviar no duplica
nada. Este fichero solo tiene lo justo para arrancar.

## Arranque rápido

Con el backend generado ya escuchando en el 8080 y el teléfono por cable:

```bash
adb reverse tcp:8080 tcp:8080   # hay que repetirlo cada vez que se desconecta
cd mobile
flutter run --release
```

Dentro: **Asistente** → dirección del backend → **Conectar** → botón flotante
**«Pedir»**.

Para apuntar a otra dirección sin escribirla a mano cada vez:

```bash
flutter run --dart-define=BACKEND_URL=http://192.168.1.40:8080
```

Si la conexión falla, el sospechoso número uno es el `adb reverse`: con
`localhost` el teléfono se busca a sí mismo, no al portátil.

## Pruebas

```bash
flutter analyze
flutter test
```

Todo el asistente está probado sin teléfono. Eso es deliberado: el
reconocimiento de voz y la síntesis se usan a través de la interfaz `MotorDeVoz`
(`lib/asistente/voz.dart`) precisamente para poder sustituirlos en las pruebas,
porque los plugins reales hablan por canales de plataforma y lanzan
`MissingPluginException` bajo `flutter test`. Una prueba que necesita un teléfono
es una prueba que no se ejecuta.

Lo mismo vale para la cámara: la homografía, el reparto de las asas en pantalla
y la pantalla de recorte entera se prueban sin teléfono, y el enderezado vive en
`lib/camara/rectificar.dart`, que no importa Flutter.

Lo que sí hay que comprobar a mano en un dispositivo real:

- Del asistente, lo listado en
  [§10.10](../docs/10-asistente-movil.md#1010-qué-está-probado).
- **Una foto de verdad, con el teléfono en vertical**, que es el único sitio
  donde sale el fallo de la orientación EXIF: si el diagrama aparece tumbado en
  la pantalla de recorte, `enderezarOrientacion` no se aplicó.
- **Que la interfaz no se congela** entre el disparador y la pantalla de
  recorte, ni al pulsar «Usar la foto». En el emulador no se nota.
- **Que el JPEG rectificado llega a «Desde imagen»** y el modelo de visión lo
  lee: es el único extremo que atraviesa el `input type="file"`.
- **Una descarga de más de un mega** (§ el ZIP), que es la que ejercita el
  troceado del Binder.
