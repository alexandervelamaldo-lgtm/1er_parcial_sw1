# 5. Guía de uso: control por voz e importación desde fotografía

Esta guía cubre las dos funcionalidades pedidas expresamente:

1. **Control por voz** para crear, modificar y eliminar tablas, sus campos y sus
   filas de datos, con validación de permisos, confirmación de acciones críticas
   y manejo de órdenes no reconocidas.
2. **Importación desde una fotografía**: leer con OCR la estructura y el
   contenido de una tabla y trasladarlos al proyecto.

Y una tercera que comparte con ellas el mismo principio —nada entra en el diagrama
sin que alguien lo confirme—: la **importación y exportación en XMI** (§5.5), para
intercambiar el diagrama con otras herramientas UML.

Además, este mismo documento es lo que contesta la **guía** de la aplicación
(§5.7): el botón «? Ayuda» busca aquí dentro y responde en castellano, con un
modelo local si lo hay y sin él si no lo hay.

Está escrita para usarse, no para archivarse. Empieza por lo que hay que saber
antes de tocar nada.

---

## 5.0 Qué significa aquí «base de datos». Léelo antes que nada

El encargo original pedía «modificar y editar tablas de bases de datos», «la
eliminación de registros» y «migración completa de datos a una base de datos
destino». Conviene decir sin rodeos cómo se ha materializado eso, porque **no es
lo que esas palabras sugieren en su lectura más literal**:

- La herramienta **no se conecta a ninguna base de datos en ejecución.** No
  guarda cadenas de conexión, no abre sockets a PostgreSQL, no ejecuta `UPDATE`
  ni `DELETE` contra ningún servidor.
- Una «tabla» es **una clase del diagrama UML**. Esa clase genera después una
  entidad JPA y, con ella, la tabla PostgreSQL correspondiente en el proyecto
  Spring Boot que se descarga.
- Los «registros» son **filas de datos de ejemplo asociadas a la clase**. Se
  materializan como `INSERT` en `V2__datos_iniciales.sql`, la migración Flyway
  de datos iniciales del proyecto generado.
- «Migrar a una base de datos destino» significa, por tanto: **la foto entra en
  el diagrama, y el diagrama genera el esquema y los datos iniciales.** La base
  de datos destino se crea al arrancar el proyecto generado, no antes.

Esta interpretación se eligió deliberadamente. La alternativa —conectar la
herramienta a una base de datos real— habría exigido almacenar credenciales de
producción en el servidor y permitir que **una orden dictada en voz alta borrara
filas reales**. Un reconocedor de voz que confunde «actualiza» con «elimina», o
un modelo de lenguaje que interpreta de más, tendría entonces consecuencias
irreversibles sobre datos de verdad. Con el diseño actual, el peor caso de un
malentendido es un diagrama equivocado, y se deshace con `Ctrl+Z`.

Si en el futuro se quisiera la conexión en vivo, el punto de extensión natural
es un nuevo backend de aplicación de operaciones; **nada del recorrido de voz o
de OCR cambiaría**, porque ninguno de los dos escribe directamente: los dos
producen operaciones (véase §5.1).

---

## 5.1 El principio común: proponer no es escribir

Voz y OCR comparten una regla, y es la que sostiene todo lo demás:

> **Ni el reconocimiento de voz, ni el modelo de lenguaje, ni el OCR escriben
> jamás en el diagrama. Los tres producen una lista de operaciones que se
> muestran en castellano y que una persona acepta o descarta.**

Es la decisión D6 de la arquitectura. Sus consecuencias prácticas:

- Un modelo que se equivoca es **una molestia, no una pérdida de trabajo**.
- La descripción que se lee («Añade el atributo `correo` de tipo `String` a
  `Cliente`») la calcula el servidor **a partir de la operación que se va a
  aplicar**, no a partir de la frase dictada. No puede darse el caso de que lo
  leído y lo aplicado sean cosas distintas.
- Todo pasa por el mismo camino de escritura que el ratón, así que **deshacer
  una importación de veinte filas es un solo `Ctrl+Z`**, no una limpieza manual.

---

## 5.2 Configuración

### La clave del modelo

La clave vive **solo** en `.env`, en la raíz del proyecto, que está en
`.gitignore`:

```env
# Texto: interpretar órdenes de voz. DeepSeek va bien y es barato.
LLM_PROVIDER=deepseek
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat

# Visión: leer un diagrama de una foto. DeepSeek NO sirve visión (ver más abajo),
# así que esto apunta a otro proveedor.
LLM_VISION_MODEL=gemini-3.6-flash
LLM_VISION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_VISION_API_KEY=...
```

| Variable | Para qué | Si falta |
|---|---|---|
| `LLM_API_KEY` | Autenticación con el proveedor de texto | El asistente funciona solo con la gramática local; el OCR se desactiva |
| `LLM_MODEL` | Interpretación de órdenes de voz y texto | Igual que arriba |
| `LLM_VISION_MODEL` | Lectura de fotografías | La ruta de OCR responde `SIN_MODELO_VISION` y explica qué definir |
| `LLM_VISION_BASE_URL` | Proveedor de visión, si es distinto del de texto | Se hereda `LLM_BASE_URL` |
| `LLM_VISION_API_KEY` | Clave de visión, si es distinta | Se hereda `LLM_API_KEY` **solo si la visión apunta al mismo proveedor**; si apunta a otro, la lectura de fotos se queda desactivada |

> La clave del texto no se presta a un proveedor distinto, y es a propósito:
> heredarla siempre significaría entregarle a Google la clave de DeepSeek en
> cuanto alguien apunta `LLM_VISION_BASE_URL` a otro sitio y se deja la suya sin
> poner. Antes que filtrar un secreto a un tercero por un descuido de
> configuración, la función se desactiva y lo dice al arrancar.
| `MAX_IMAGE_BYTES` | Tamaño máximo de foto (por defecto 4 MiB) | Se usa el valor por defecto |

### Qué modelo usar para leer fotos

**DeepSeek no sirve ningún modelo con visión en su API.** Sus modelos
(`deepseek-chat`, `deepseek-reasoner`) son de texto. Si se le manda una imagen,
en el mejor de los casos la ignora: responde que no ve ninguna tabla, y la
importación falla sin que quede claro por qué. Es un error real que estuvo en
este `.env` durante un tiempo, con un `deepseek-...-vision-exp` que no existe.

El código habla el protocolo compatible con OpenAI, así que sirve cualquier
proveedor que lo hable. Por orden de recomendación para este proyecto:

| Opción | Modelo | Coste | Por qué |
|---|---|---|---|
| **Google Gemini** *(recomendada)* | `gemini-3.6-flash` | Capa gratuita, sin tarjeta | Lee muy bien diagramas fotografiados y escritura a mano; con su endpoint compatible con OpenAI **no hace falta tocar código** |
| OpenAI | `gpt-4o-mini` | De pago desde el primer uso | Muy fiable, es la referencia del protocolo |
| OpenRouter | `qwen/qwen2.5-vl-72b-instruct` | Mixto, hay modelos gratis | Una sola clave para probar varios modelos y comparar |

> **Los nombres de modelo caducan.** Google retira versiones y el nombre deja de
> existir de un día para otro: `gemini-2.0-flash` estuvo en este fichero y hoy
> devuelve `404 NOT_FOUND`. El aviso es útil, porque el propio error dice cuál es
> el sustituto. Que caduque un nombre **no** significa que la clave esté mal: si el
> servidor te contesta hablando del modelo, es que la clave ya la aceptó. Un
> problema de clave se ve como `401`, o como un `400` con «API key not valid».

Para Gemini, la clave se saca en <https://aistudio.google.com/apikey> y la URL
base es `https://generativelanguage.googleapis.com/v1beta/openai`.

**Lo que no recomiendo aquí es un OCR clásico** tipo Tesseract, aunque sea
gratis y funcione sin conexión: devuelve caracteres sueltos y deja sin resolver
lo difícil —qué es cabecera, qué es dato, dónde acaba cada celda—, que es
justamente el trabajo que hace falta. Sobre una foto de pizarra con letra a mano
el resultado no es utilizable.

**Nunca la pongas en una variable `VITE_*`.** Vite empotra esas variables en el
JavaScript que descarga el navegador: publicarla ahí equivale a publicarla en
internet. El backend habla con el proveedor por su cuenta y el navegador nunca
ve la clave.

> ⚠️ **La clave que hay ahora en `.env` debe rotarse.** Se transmitió por chat y
> quedó en el historial de PowerShell. Genera una nueva en el panel de DeepSeek,
> sustitúyela en `.env` y revoca la antigua.

### Arrancar

```bash
npm install
npm run dev:backend     # http://localhost:3001
npm run dev:frontend    # http://localhost:5173
```

---

## 5.3 Control por voz

### Requisitos del navegador

El dictado usa la API de reconocimiento de voz del navegador: **Chrome o Edge**.
En Firefox y Safari el botón del micrófono aparece deshabilitado con una
explicación en el `title`; el campo de texto sigue funcionando y acepta
exactamente las mismas órdenes escritas.

### Cómo se usa

1. Abre un proyecto. La barra del asistente está abajo.
2. Pulsa **🎤** y habla, o escribe la orden y pulsa **Interpretar**.
3. Aparece la propuesta numerada, con el origen (`deepseek-v4-flash` o
   `gramática local (sin conexión)`).
4. Pulsa **Aplicar** para aceptarla o **Descartar** para tirarla.

### Repertorio de órdenes

**Estructura de tablas**

| Orden | Qué hace |
|---|---|
| «crea la clase Cliente» | Nueva tabla |
| «crea la clase Pedido con el atributo total de tipo Double» | Tabla y campo de una vez |
| «renombra la clase Cliente a Comprador» | Renombra la tabla |
| «elimina la clase Pedido» | Borra la tabla, sus campos, sus filas y sus relaciones |

**Campos (columnas)**

| Orden | Qué hace |
|---|---|
| «añade el atributo nombre de tipo String a Cliente» | Nueva columna |
| «añade el campo correo de tipo texto a Cliente» | Igual; los tipos en castellano se traducen |
| «elimina el campo correo de Cliente» | Borra la columna |
| «renombra el atributo nombre a nombreCompleto en Cliente» | Renombra la columna |

**Filas de datos**

| Orden | Qué hace |
|---|---|
| «borra la segunda fila de Empleado» | Elimina esa fila de los datos iniciales |
| «borra la séptima fila de Empleado» | Los ordinales dictados se entienden hasta el décimo |

**Relaciones**

| Orden | Qué hace | Cardinalidad resultante |
|---|---|---|
| «relaciona Cliente con Pedido» | Asociación | 1 → 1 |
| «un Cliente tiene muchos Pedidos» | Asociación | 1 → \* |
| «muchos Productos tienen muchas Categorías» | Asociación | \* → \* |
| «Pedido tiene una Factura» | Asociación | 1 → 1 |
| «Pedido hereda de Documento» | Herencia | (no tiene extremos que contar) |

El cuantificador de **cada** lado se lee por separado: el del sujeto («un…»,
«muchos…») y el del complemento («…tiene muchos», «…tiene una»). Si el sujeto no
lleva cuantificador se asume uno. Esta distinción no es de matiz: un muchos a
muchos guardado como uno a muchos produce un esquema de base de datos distinto
—tabla de unión en vez de clave ajena— y no hay forma de notarlo hasta abrir el
proyecto generado. Si dudas de cómo se ha entendido una frase, mírala en el
panel de propiedades («Editar las relaciones a mano», más abajo), que te dice el
mapeo JPA que va a salir.

**Órdenes encadenadas.** Se pueden unir con punto, punto y coma o con «y» antes
de un verbo: «crea la clase Cliente y añade el atributo nombre de tipo String a
Cliente». Se proponen como un lote y se aplican todas o ninguna.

### Editar las relaciones a mano

La voz es un atajo, no la única puerta. **Todo lo que se puede dictar se puede
hacer a mano**, y con las relaciones esto importa más que con nada: la
multiplicidad es el único campo del diagrama que decide la forma del esquema
generado, y dictarla es justo donde más fácil es que el asistente entienda otra
cosa.

Para crear una relación: botón **«↗ Relación»** de la barra superior, se elige el
tipo en el desplegable de al lado y se arrastra de una clase a otra en el
lienzo. Nace como **1 → \*** si el tipo tiene extremos que contar; la herencia y
la realización nacen en 1 → 1 porque no los tienen.

Para cambiarla: se selecciona la clase y se mira el apartado **«Relaciones»** del
panel derecho. Cada relación se puede tocar entera sin borrarla y volver a
crearla:

| Control | Qué cambia |
|---|---|
| Desplegable del tipo | asociación, agregación, composición, herencia, realización, dependencia |
| Desplegable de cada extremo | `1`, `0..1`, `*`, `1..*` |
| Botón «×» | Borra la relación |

Debajo de cada una hay dos líneas que existen para que no haya que traducir
mentalmente nada:

- **La lectura en castellano**: «Un **Cliente** tiene muchos Pedido; un Pedido
  tiene un Cliente». Los dos extremos se muestran siempre en el orden
  origen → destino, no en el orden de la clase que tengas seleccionada, porque
  invertirlos según desde dónde miras es exactamente cómo se acaba poniendo la
  clave ajena en la tabla equivocada.
- **El mapeo JPA que va a salir**: `@OneToMany / @ManyToOne (clave ajena en el
  lado «muchos»)`, `@ManyToMany (con tabla de unión)` o `@OneToOne (clave
  ajena)`. No es una explicación aproximada: el panel lo calcula con la misma
  regla que usa el generador (`isToMany` en cada extremo), así que no puede
  prometer algo que el ZIP no entregue.

Dos comportamientos que conviene conocer:

- **Cambiar una relación a herencia vuelve a comprobar los ciclos.** Si
  convertir esa asociación en herencia cerrase un ciclo, o hiciese que una clase
  heredase de sí misma, la operación se rechaza y la relación se queda como
  estaba. Sin esa comprobación, la validación que hace `addRelation` sería
  esquivable dibujando una asociación y convirtiéndola después, y el ciclo no
  aparecería como un error del diagrama sino como una recursión infinita dentro
  del generador.
- **Cada cambio viaja solo.** Modificar un extremo no reescribe el otro, así que
  dos personas ajustando lados opuestos de la misma relación a la vez no se
  pisan.

### Validación de permisos

Se comprueba en **tres sitios independientes**, porque cada uno protege algo
distinto:

1. **En la interfaz**: quien solo tiene permiso de lectura ve el campo y el
   micrófono deshabilitados. Es cortesía —enterarse de que no puedes editar
   *después* de dictar es la peor forma de enterarse—, no seguridad.
2. **En el canal colaborativo**: el servidor rechaza las actualizaciones de
   quien no es editor. La interfaz pasa a `sin-permiso`.
3. **En la API REST**: `requireRole(store, 'editor')` protege la ruta del
   asistente. Un cliente modificado que llame directamente al endpoint recibe
   `403` igualmente.

### Confirmación de acciones críticas

Cuando la propuesta destruye algo, la barra del asistente **cambia de aspecto y
enumera lo que se pierde antes de dejar aplicar**:

```
Se va a borrar, y el diagrama no lo recuerda por ti:
  • la clase Pedido con sus 4 atributos
  • 12 filas de datos de ejemplo
  • 3 relaciones que la tocan
Se puede deshacer con Ctrl+Z mientras no cierres el proyecto.
```

El botón pasa entonces a **«Sí, borrar»** (en rojo) y hay que pulsarlo una
segunda vez. Junto a él, **«No, cancelar»**.

Dos detalles del diseño que importan:

- **El impacto se calcula sobre el diagrama real, no sobre la lista de
  operaciones.** «Elimina la clase Pedido» destruye cosas distintas según lo que
  haya: quien dictó esa frase estaba pensando en una caja del lienzo, no en las
  tres flechas que la tocan.
- **La confirmación solo se interpone cuando hay algo concreto que enumerar.** Un
  «¿seguro?» genérico no es una confirmación: no dice qué se pierde, así que
  quien lo lee acaba pulsando «Sí» por costumbre y deja de ser un freno. Al
  aparecer solo ante un borrado real, aparecer significa algo.

### Manejo de órdenes no reconocidas

No hay fallo silencioso. Los tres casos posibles:

| Situación | Respuesta |
|---|---|
| El modelo entiende a medias | Devuelve una **petición de aclaración** («¿A qué clase quieres añadir el atributo?») y ninguna operación |
| No se entiende nada | «No he entendido la orden. Puedo crear, renombrar y eliminar clases, atributos, métodos, literales y relaciones, y borrar filas de datos de ejemplo; por ejemplo: …» — el mensaje **enumera el repertorio real** en vez de repetir «no te entiendo» |
| El modelo propone algo inválido | La propuesta entera se descarta y se recurre a la gramática local. Media propuesta es peor que ninguna |

**Sin conexión** el asistente no se apaga: cae a la gramática local, que viaja en
el propio paquete y entiende el repertorio de la tabla de arriba. Se anuncia con
`gramática local (sin conexión)` en la propuesta, para que quede claro por qué de
pronto solo entiende frases sencillas. El orden importa: se intenta primero el
servidor y la gramática después, porque al revés la gramática —que solo conoce un
repertorio cerrado— se comería las órdenes que el modelo sí sabría interpretar.

Y conviene decirlo así, porque es contraintuitivo: **offline la gramática no es
el premio de consolación, es la opción correcta.** Sin poder consultar nada, un
modelo pequeño tendría que adivinar, y adivinar mal en «elimina la clase Pedido»
se lleva por delante sus atributos y sus relaciones. Un repertorio cerrado que
dice claramente cuándo no ha entendido es justo lo que se quiere ahí.

### Qué parte de la voz funciona de verdad sin internet

«Funciona sin internet» son cuatro etapas, y no todas se cumplen igual. Conviene
saber cuál es cuál antes de prometerlo delante de nadie:

| Etapa | ¿Sin internet? | Por qué |
|---|---|---|
| Voz → texto (dictado) | **Depende** | En el navegador **no**: `SpeechRecognition` de Chrome manda el audio a Google. En la app **sí**, si el teléfono tiene el español descargado |
| Texto → operaciones | ✅ | La gramática de `shared/src/ai/grammar.ts`, sin red y sin modelo |
| Operaciones → diagrama | ✅ | Yjs con `y-indexeddb`; los cambios se guardan y se sincronizan al volver |
| Texto → voz (lectura) | ✅ | La síntesis ocurre en el aparato |

La única etapa que se sale de la máquina es el dictado, y **solo en el
navegador**. Dentro de la app Android el puente nativo pide reconocimiento *en
el aparato* (`onDevice`, [`voz_nativa.dart`](../mobile/lib/voz_nativa.dart)), y
entonces el audio no viaja.

Si el teléfono no tiene el español descargado, la app **no lo dice por lo bajo**:
avisa de qué falta, de que se puede seguir pulsando otra vez —esta vez el audio
sale a internet— y de dónde se instala el paquete (*Ajustes › Sistema › Idiomas ›
Reconocimiento de voz sin conexión*). A partir de ahí, la primera orden de cada
sesión recuerda que el dictado está viajando.

> Para dictar de verdad sin internet en la defensa: instala el paquete de voz
> **antes**, y compruébalo en modo avión. Es un ajuste del teléfono, no de esta
> aplicación, y no se puede arreglar desde aquí en el momento.

---

## 5.4 Importar un diagrama desde una imagen (OCR)

### Cómo se usa

1. **🖼 Desde imagen** en la barra superior.
2. Elige una imagen **PNG, JPEG o WebP** de hasta 4 MiB. Recórtala para dejar
   solo el diagrama: además de pesar menos, se lee bastante mejor.
   **Desde el móvil** el botón abre directamente la **cámara trasera**, que es lo
   que se quiere cuando la pizarra la tienes delante; en escritorio abre el
   selector de ficheros de siempre.
3. Espera unos segundos —un diagrama tarda más que una tabla suelta—. Aparece la
   **pantalla de revisión**: la imagen a la izquierda, lo leído a la derecha,
   editable.
4. **Compara la imagen con lo leído.** La foto tiene zoom: gira la rueda encima,
   haz doble clic donde quieras mirar, o usa los botones **−/+** y **«Encajar»**.
   Ampliada, se arrastra. Con el teclado: **Tab** hasta la foto, **+** y **−**
   para el zoom, las flechas para moverte y **0** para volver a encajarla. Está
   ahí por las cardinalidades: un «0..1» de rotulador en una pizarra fotografiada
   de lejos no se lee al tamaño de la columna, y sin poder acercarse, «compara
   con la imagen» es una instrucción que no se puede cumplir.
   Corrige lo que haga falta:
   - el nombre y el estereotipo de cada clase (clase, abstracta, interfaz, enumerado),
   - el nombre y el tipo de cada atributo, y cuál es la clave primaria,
   - **el tipo de cada relación y la cardinalidad de sus dos extremos**,
   - y puedes descartar clases o relaciones enteras.
5. Pulsa **«He comparado con la imagen: importar N clases»**.
6. Las clases, sus atributos, sus relaciones y sus filas de datos entran en el
   diagrama en un solo paso. `Ctrl+Z` lo deshace entero.

> **Si el diagrama lo hiciste en otra herramienta y aún tienes el fichero, no uses
> una foto.** Expórtalo a XMI desde allí y usa **⤒ Importar XMI** (§5.5): es
> exacto, no gasta saldo y no hay nada que revisar. La lectura por imagen es para
> cuando lo único que hay es una pizarra, un folio o una captura de pantalla.

### Qué lee: el diagrama entero, no una tabla

Antes esta función leía **una** tabla —cabeceras, tipos y filas— y había un botón
«📷 Desde foto» distinto. Se ha sustituido por uno solo porque casi nadie
fotografía una tabla aislada: se fotografía la pizarra de la reunión, y en la
pizarra hay cuatro recuadros y las flechas entre ellos. Con el lector de tablas,
esa foto devolvía una tabla inventada a partir del primer recuadro y perdía todo
lo demás sin decirlo.

**No se ha perdido nada al cambiar.** El esquema de lectura de un diagrama incluye
`filas` por clase, así que fotografiar una tabla con datos dentro sigue cargando
los datos, y todo lo de «migración sin pérdidas» de más abajo sigue en pie. La
diferencia es que ahora, además, se leen las relaciones.

### Las cardinalidades: lo que más caro sale de leer mal

Al revisar una tabla, lo que se compara son textos y el ojo lo hace solo. Al
revisar un diagrama, **lo más peligroso es lo que no se ve**: una cardinalidad que
el modelo no supo leer y rellenó por su cuenta. En el lienzo, esa flecha es
idéntica a las demás.

Y no es un detalle estético. La cardinalidad es lo que decide qué genera el
backend:

| Extremos | JPA | En PostgreSQL |
|---|---|---|
| Ninguno «a muchos» | `@OneToOne` | clave foránea con `UNIQUE` |
| Uno «a muchos» | `@OneToMany` / `@ManyToOne` | clave foránea en el lado «muchos» |
| Los dos «a muchos» | `@ManyToMany` | **tabla de unión aparte** |

Un `0..*` leído como `0..1` es la diferencia entre una tabla y una columna. Por
eso, cuando el modelo declara no haber podido leer un extremo:

- **La relación no se descarta.** Perderla en silencio sería peor: el diagrama
  importado parecería correcto y le faltaría una asociación.
- Se propone **`1 → *`**, que es la asociación más frecuente en un diagrama
  dibujado a mano.
- El extremo concreto se marca **«sin leer»** en rojo, la fila entera se resalta,
  y arriba aparece un contador propio: *«⚠ 2 extremos de relación sin cardinalidad
  legible»*.
- Ese contador **no vive en la lista de avisos amarilla**. Los demás avisos
  describen algo ya resuelto de forma razonable («se ha usado `String`»); este
  describe una suposición que nadie ha confirmado. Mezclarlos sería enseñar a
  ignorarlo.

Elegir la cardinalidad en el desplegable hace desaparecer la marca en el acto. Las
cuatro opciones son las mismas que ofrece el panel de relaciones (`1`, `0..1`,
`*`, `1..*`), a propósito: si aquí se pudiera elegir una que el panel no sabe
mostrar, la relación quedaría importada y no editable después.

Lo que el modelo escribe se **canoniza** antes de entrar: `0..*` y `0..n` pasan a
`*`, y `1..1` pasa a `1`. La misma función (`canonizarCardinalidad`, en `shared/`)
la usan la pantalla para decidir qué resaltar y el servidor para decidir qué
avisar, de modo que no puedan discrepar.

### Por qué la revisión es obligatoria

El encargo pedía que la información se extrajera «de forma automática» y se
copiara «íntegramente». **No se ha hecho así, y el motivo es concreto y
medible.**

En las pruebas sobre una imagen limpia —generada por ordenador, sin ruido, sin
escritura a mano, sin sombras— el modelo de visión leyó `ana@rrhh.com` como
**`ana@rrrh.com`** —una letra de más— y declaró al hacerlo `"confianza": 1.0` y
`"ilegible": []`. Es decir: se equivocó y afirmó no tener ninguna duda. En su
razonamiento visible se le veía confirmándose el error a sí mismo.

Ese error es especialmente peligroso porque **ninguna validación automática puede
detectarlo**: `ana@rrrh.com` es una dirección de correo perfectamente válida, con
formato correcto y dominio plausible. Pasaría cualquier comprobación de esquema,
de tipo y de formato. Un camino automático lo habría escrito en el diagrama, de
ahí en `V2__datos_iniciales.sql`, y de ahí en la base de datos del proyecto
generado, sin que nadie mirase la foto en ningún momento.

Por eso:

- La confianza declarada **se muestra como dato informativo y no controla nada**.
  La pantalla lo dice literalmente: «Es lo que el modelo opina de sí mismo, no
  una garantía».
- **No existe ningún botón de importación directa,** y la respuesta del servidor
  no incluye ningún campo del estilo `aplicarDirectamente` o `autoAplicable`. Hay
  una prueba que verifica que esos campos *no existen*, de modo que si alguien
  los añadiera en el futuro, la suite fallaría.
- El texto del botón es **«He comparado con la imagen: importar N clases»** y no
  «Importar». Nombrar la acción por lo que la justifica es lo único que separa un
  clic de un asentimiento.

La revisión intermedia no es fricción: es el único punto del recorrido en el que
alguien compara lo escrito con lo fotografiado.

### Qué valida la herramienta por su cuenta

La revisión humana cubre la exactitud de los datos. La máquina cubre lo que sí
puede comprobar sola, y lo hace **dos veces**: en el navegador mientras escribes,
para que los avisos se muevan según corrigen; y en el servidor al proponer,
porque el JavaScript del navegador no cuenta como frontera de confianza. Ambas
ejecuciones usan **la misma función** (`interpretarDiagramaExtraido`, en
`shared/`), así que es imposible que la pantalla acepte algo que el servidor
rechace.

| Comprobación | Qué ocurre |
|---|---|
| Nombre de clase inválido | Aviso: **la clase se descarta con su contenido**; el nombre no se «limpia» |
| Ninguna clase nueva reconocible | Error bloqueante: no hay nada que importar |
| La clase ya existe en el diagrama | Aviso: se deja como está, pero **sus relaciones con las clases nuevas sí se importan** |
| Dos clases leídas dan el mismo nombre | Aviso: se queda la primera |
| Nombre de atributo inválido | Aviso: se descarta ese atributo, no la clase |
| Dos atributos colapsan en el mismo nombre | Aviso. Pasa de verdad: «Fecha alta» y `fecha_alta` dan los dos `fechaAlta` |
| Tipo desconocido | Aviso: se usa `String`, que siempre funciona |
| Clase sin clave primaria | Aviso: se marca el primer atributo y se dice que se ha hecho. Solo en clases, no en interfaces ni enumerados |
| Cardinalidad ilegible | **Aviso destacado aparte**: se propone `1 → *` y se marca el extremo |
| Extremo que no es ninguna clase leída | Aviso: la relación se descarta. No se inventa la clase que falta |
| Una clase que hereda de sí misma | Aviso: se descarta esa relación |
| Relación repetida | Se importa una sola vez, sin ruido |
| Una fila con más o menos celdas que atributos | Aviso: **la fila se descarta entera** |
| Celda vacía | Se interpreta como `NULL`, no como cadena vacía |
| Zonas que el modelo declara ilegibles | Se enumeran como avisos |

Cuatro de esas decisiones merecen explicación:

- **Un nombre inválido se rechaza, nunca se limpia.** Quitarle los caracteres
  peligrosos a `Robert'); DROP TABLE alumnos;--` produciría una clase
  `RobertDropTable` que nadie pidió y ocultaría que la imagen traía algo raro
  (RNF-SEG-06).
- **Una clase que ya existe no bloquea la importación**, al contrario que en el
  lector de tablas anterior. Fotografiar un diagrama que solapa parcialmente con
  el proyecto es lo normal, y su nombre se recuerda para que las relaciones que
  salen de ella hacia las clases nuevas sigan funcionando.
- **Una fila descuadrada se descarta entera** en vez de colocar los valores que
  sí hay. Rellenar a medias los dejaría bajo el atributo equivocado, con el tipo
  correcto, y nadie lo notaría al revisar por encima.
- **Una autorrelación sí se permite** («un empleado tiene muchos subordinados»);
  lo que se descarta es que una clase *herede* de sí misma, porque el generador
  entraría en recursión infinita al emitir el `extends`.

Y una garantía transversal: **la importación nunca propone borrar nada.** Una
imagen es una sugerencia sobre lo que hay que añadir, jamás una orden de quitar lo
que ya está en el proyecto de otra persona. Hay una prueba que lo verifica sobre
el conjunto de operaciones generadas.

### El orden de las operaciones

Las operaciones salen en un orden concreto, y no es casual: se aplican en un solo
lote transaccional, así que si una falla se revierte el lote entero.

1. **Todas las clases y sus atributos**, primero.
2. **Después todas las relaciones.** Una relación entre la primera y la última
   clase fallaría si se emitiera junto a la primera.
3. **Al final las filas de datos.** `setSeedRows` rechaza columnas que todavía no
   existan, así que tienen que ir después de sus atributos.

### Mapeo automático de esquema

La conversión de lo fotografiado al modelo es automática:

| En la imagen | En el diagrama | En PostgreSQL |
|---|---|---|
| `Class A` (recuadro) | clase `ClassA` (PascalCase) | tabla `class_a` |
| `nombre completo` | atributo `nombreCompleto` (camelCase) | columna `nombre_completo` |
| `entero`, `int`, `número` | `Integer` | `integer` |
| `texto`, `varchar`, `string` | `String` | `varchar(255)` |
| `fecha` | `LocalDate` | `date` |
| Primer atributo, o el marcado | clave primaria | `PRIMARY KEY` |
| Línea con rombo relleno | composición | clave foránea con `ON DELETE CASCADE` |
| Flecha de punta hueca | herencia | según la estrategia de herencia elegida |
| Línea con `1` y `0..*` | asociación uno a muchos | clave foránea en el lado «muchos» |

Los nombres de los extremos de una relación se casan con los de las clases por
**dos vías**: el texto tal cual y su forma normalizada. El motivo es que el modelo
rara vez es consistente consigo mismo —titula el recuadro «Class A» y luego nombra
la flecha «ClassA»—, y con una sola vía esa relación se perdía en silencio. Ese es
el fallo más caro de todos: el diagrama importado parece correcto, le falta una
asociación, y al generar sale un esquema sin esa clave foránea.

Los tipos se resuelven contra el catálogo del proyecto; un tipo inventado por el
modelo se degrada a `String` y se anota como aviso, en vez de propagar un tipo
que no existe hasta el momento de compilar Java.

### Migración de los datos sin pérdidas

Las filas se guardan **indexadas por el nombre del atributo, nunca por su
posición**. Es la diferencia entre que los datos sobrevivan a una edición
posterior y que no: si se guardaran por posición, borrar o reordenar una columna
más tarde desplazaría todos los valores una casilla y los dejaría bajo la columna
equivocada, en silencio.

Al generar el proyecto, esas filas se convierten en `INSERT` dentro de
`V2__datos_iniciales.sql`. Detalles del generador que afectan a lo importado:

- Las comillas simples se escapan duplicándolas: `O'Brien` → `'O''Brien'`. Hay
  pruebas de inyección que verifican que un valor como `x'); DROP TABLE empleado; --`
  sale como literal y no como SQL.
- Un byte nulo en un valor **aborta la generación con un error explícito**:
  PostgreSQL no admite `NUL` en columnas `text` y fallar al generar es mejor que
  fallar al migrar.
- Si la clave primaria es autoincremental y las filas traen valores explícitos,
  se emite un `setval(pg_get_serial_sequence(...))` para que el primer registro
  que cree la aplicación no choque con los importados. **Solo si la columna es de
  verdad `SERIAL`/`BIGSERIAL`**: sobre una clave de texto, `pg_get_serial_sequence`
  devuelve `NULL` y `setval(NULL, …)` abortaría la migración del proyecto
  generado.
- `V1__esquema_inicial.sql` **nunca se reescribe**. Los datos van siempre en una
  migración aparte, que es lo que permite volver a generar sin romper un
  despliegue existente.

---

## 5.5 Importar y exportar XMI (RF-DIAG-12)

Los dos botones están en la barra del editor, a la derecha de «🖼 Desde imagen»:
**⤓ Exportar XMI** y **⤒ Importar XMI**.

Todo ocurre **en el navegador**. No hay llamada al servidor ni al modelo de
lenguaje: ni la exportación ni la importación gastan saldo, y ambas funcionan sin
conexión. Es la diferencia práctica con la importación desde foto.

### Exportar

Un clic y se descarga `<nombre del proyecto>.xmi`. Exportar no cambia nada, así
que **también puede hacerlo quien solo tiene permiso de lectura**: se lleva una
copia, no toca el original.

El fichero es XMI 2.1 sobre UML 2.x y tiene dos partes:

1. **El cuerpo estándar**, que es lo que entiende cualquier herramienta UML:
   `uml:Class`, `uml:Interface`, `uml:Enumeration` (las clases abstractas van como
   `uml:Class` con `isAbstract="true"`), sus `ownedAttribute` y `ownedOperation`
   con parámetros y tipo de retorno, los `ownedLiteral` de las enumeraciones,
   `generalization` para la herencia, `interfaceRealization` para la realización,
   `uml:Dependency`, y `uml:Association` con sus dos extremos y su cardinalidad.
   Todo ello dentro de un `uml:Package` que lleva el nombre del proyecto.
   Los tipos que UML trae de serie —`String`, `Integer`, `Boolean`— se
   referencian a la biblioteca estándar por `href`; los que no existen en UML
   —`Long`, `Decimal`, `Date`…— se declaran una vez como `uml:PrimitiveType` y
   se referencian por `xmi:idref`.

2. **Un bloque `<xmi:Extension extender="uml-colaborativo">`** con lo que UML no
   sabe guardar y esta herramienta sí necesita: qué atributo es clave primaria,
   cuáles son únicos o nulables, si es una colección, la posición y el tamaño de
   la caja en el lienzo, los campos transitorios, el estereotipo y **las filas de
   datos semilla**. Otras herramientas ignoran ese bloque sin enterarse; al
   reimportar aquí, el diagrama vuelve tal cual salió.

Los identificadores XML van todos con el prefijo `id_`. No es decorativo:
nuestros identificadores son ULID en base32 de Crockford y **pueden empezar por
un dígito**, lo que es ilegal como `xmi:id` y hace que algunos lectores rechacen
el fichero entero.

#### Lo que se corrigió al abrirlo en Enterprise Architect

Esta parte también se escribió primero contra la especificación a secas, y
también falló con el primer intento real: el fichero abría, pero **EA le ponía
el nombre del proyecto a todas las clases** y las asociaciones no unían ninguna
caja. Las pruebas de ida y vuelta estaban en verde, y no podían detectarlo:
comprobar que el diagrama sobrevive al viaje de aquí a aquí no dice nada sobre
lo que hace otra herramienta, porque nuestro lector es tolerante y acepta formas
que EA no lee. Ahora hay pruebas que afirman sobre **el XML que sale**
(`shared/src/xmi/ea-export.test.ts`), no sobre lo que vuelve.

Tres cosas cambiaron, y las tres consisten en escribir la variante que EA usa en
sus propios ficheros de entre las varias que el estándar permite:

| Antes | Ahora | Qué se veía en EA |
|---|---|---|
| Las clases colgaban del `uml:Model` | Van dentro de un `uml:Package` con el nombre del proyecto; el modelo se llama `EA_Model` | El nombre del proyecto repetido en todas las clases |
| El extremo de asociación llevaba `type="…"` como atributo | Lo lleva como hijo `<type xmi:idref="…"/>` | Asociaciones sueltas, sin enganchar a las cajas |
| Cada primitivo se declaraba como elemento del modelo | Los de UML se referencian por `href` a la biblioteca estándar | Elementos «String» y «Boolean» en el navegador de proyecto que nadie había dibujado |

**Lo que sigue sin viajar a EA es la posición de las cajas.** EA guarda la
geometría de sus diagramas en su propio `<xmi:Extension extender="Enterprise
Architect">`, y escribir ese bloque a ciegas —sin poder abrirlo en EA para
comprobar el resultado— es más arriesgado que no escribirlo: un bloque de
extensión mal formado puede hacer que EA rechace la importación entera. Al
importar, EA crea los elementos en el navegador de proyecto y el diagrama se
compone arrastrándolos. Entre esta herramienta y ella misma no se pierde nada,
porque las coordenadas van en nuestra propia extensión.

### Importar

Se elige un `.xmi` y **no entra nada en el diagrama hasta que se pulsa el botón**,
que dice cuántas clases va a crear. Aquí la revisión importa incluso más que en la
importación desde foto: un XMI ajeno puede traer doscientas clases de golpe y el
diagrama es compartido. Volcarlas directamente le cambiaría el trabajo a todos los
que estén conectados en ese momento sin que ninguno haya pedido nada.

La pantalla de revisión enseña, en este orden: el recuento (clases, atributos,
métodos, relaciones y filas, más mensajes y enlaces si el fichero trae un diagrama
de comunicación), la lista de nombres de las clases, las clases que se van a
**ampliar** en vez de crear, un desplegable con **la lista completa de operaciones
en castellano** —las mismas frases que usa el asistente de voz— y los avisos.

Dos detalles del comportamiento:

- **Se añade a lo que ya hay; no reemplaza el diagrama.** Una clase cuyo nombre ya
  exista se omite, junto con sus relaciones, y se dice cuál. La única excepción
  son los métodos que salen de un diagrama de comunicación, que sí se añaden a la
  clase existente; se explica en el apartado siguiente. La importación **nunca
  propone borrar nada**; hay una prueba dedicada a ello.
- Las operaciones viajan como **un único lote**, de modo que deshacer una
  importación entera es un `Ctrl+Z` y no una limpieza a mano de doscientas cajas.
- El recuento se recalcula contra el diagrama **actual**, no contra el que había
  al abrir el fichero: si mientras se revisa otro colaborador crea una clase
  «Cliente», el aviso de choque aparece solo.

### Qué acepta el lector

El estándar deja margen y cada herramienta lo aprovecha distinto, así que el
importador es deliberadamente tolerante:

| Variante | Se acepta |
|---|---|
| El tipo del elemento | `xmi:type`, `xsi:type`, o el propio nombre de la etiqueta (`<UML:Class>`, estilo XMI 1.x) |
| El tipo de un atributo | Hijo `<type xmi:idref="…">`, atributo `type="…"`, o un `href` del que se toma lo que va tras el `#` |
| La cardinalidad | Hijos `lowerValue`/`upperValue`, o atributos `lower`/`upper` |
| Los extremos de una asociación | `ownedEnd`, o `memberEnd` apuntando a un `ownedAttribute` de la clase |
| La marca de agregación | En cualquiera de los dos extremos |

Un `0..*` se guarda como `*` y un `1..1` como `1`, porque son los valores que
ofrece el selector de cardinalidad del panel; sin esa normalización una relación
importada aparecería con el selector en blanco. Y si a un extremo le falta la cota
inferior se aplica **1**, que es lo que dice UML 2.5, no 0.

### Diagramas de comunicación (y de secuencia)

Un `.xmi` que traiga un **diagrama de comunicación** —o de colaboración, o de
secuencia— también se aprovecha. No se dibuja: se **traduce** a lo único que este
editor sabe guardar, que es un diagrama de clases.

| En el diagrama de comunicación | Qué llega al diagrama de clases |
|---|---|
| Un objeto `p1:Pedido` | La clase `Pedido` (si no existe ya) |
| Un mensaje `2: confirmar(fecha)` | Un método `confirmar(fecha: String)` en la clase que lo **recibe** |
| Un enlace o conector entre dos objetos | Una dependencia entre sus dos clases |
| Un automensaje | El método, pero **ninguna** relación de la clase consigo misma |
| Un mensaje de respuesta, de creación o de destrucción | Solo la dependencia; ningún método |

La regla que sostiene todo lo demás es que **el método va en quien recibe el
mensaje, no en quien lo envía**. Al revés sale un modelo que parece correcto y
está del revés entero.

En secuencia y en comunicación, XMI escribe exactamente lo mismo —una
`uml:Interaction`—; lo que cambia es cómo lo dibuja cada herramienta, y eso vive
en su bloque de extensión. Por eso el lector acepta los dos sin distinguirlos.

Detalles que conviene saber antes de usarlo:

- **Aquí sí se amplía una clase que ya existe.** Es lo contrario de lo que hace
  la importación de clases, y es a propósito: los objetos de un diagrama de
  comunicación **normalmente son** clases que ya están en el diagrama, y omitirlas
  dejaría la importación en nada. Se le añaden los métodos que le falten, nunca se
  le quita ni se le cambia nada, y la pantalla de revisión dice cuáles se amplían.
- **El orden de los mensajes se pierde.** Los números `1`, `1.1`, `2`… son la
  esencia del diagrama y un diagrama de clases no tiene dónde guardarlos. Se
  quitan del nombre —un método llamado `_23_confirmar` sería peor que perderlos— y
  se avisa de la pérdida en vez de callarla.
- **También se quitan las guardas y las asignaciones.** De
  `*[i:=1..n] 2.3: total := calcular(iva)` queda `calcular(iva: String)`.
- **Los tipos de los parámetros casi nunca están.** Si el mensaje los declara
  (`aplicar(descuento: Double)`) se respetan; si no, se supone `String` y se avisa
  una vez, no una por parámetro. Los valores literales (`42`, `"hola"`) no generan
  parámetro: nadie escribió ese nombre.
- **Un objeto que no dice de qué clase es se descarta**, con su aviso. Un `tmp`
  suelto no da para inventarle una clase.
- **No se dibuja una dependencia donde ya hay una relación.** Dos flechas entre
  las mismas dos cajas no dicen nada más y ensucian el lienzo.
- **Un fichero mixto funciona.** Si el `.xmi` trae el diagrama de clases y el de
  comunicación a la vez, las clases no se duplican: las del cuerpo mandan y la
  interacción solo añade los métodos que falten.
- **Exportar sigue produciendo solo el diagrama de clases.** Generar una
  interacción a partir de un diagrama de clases sería inventarse los mensajes.

Topes propios de esta vía: **500 mensajes** y **100 clases nuevas** deducidas de
objetos. Al pasarse, se recorta y se avisa.

#### Lo que hace Enterprise Architect, que no es lo que dice el estándar

Este apartado se escribió primero contra la especificación de la OMG y **fallaba
con el primer fichero real**: un diagrama de comunicación exportado por EA daba
«no se ha encontrado ninguna clase en el fichero». No era un error del fichero.
Cuatro cosas que EA escribe de otra manera, todas legales:

| El estándar sugiere | Enterprise Architect escribe |
|---|---|
| Participantes como `uml:Class` | `uml:Component`, con sus `ownedOperation` dentro |
| Objetos con `type` o `represents` | `uml:InstanceSpecification` con `classifier` |
| `ownedConnector` dentro de la `Collaboration` | Los saca al paquete de instancias, un nivel arriba |
| Los mensajes como `uml:Message` | **No emite ninguno**: solo están en su bloque de extensión |

Las tres primeras ya se leen. La cuarta no, y es deliberado: los mensajes de EA
viven en `<xmi:Extension extender="Enterprise Architect">`, y este lector no
interpreta extensiones ajenas. En la práctica no se pierde casi nada, porque las
operaciones que los mensajes invocan **ya vienen declaradas** en los componentes,
y los enlaces ya vienen como conectores. Lo que no llega es qué operación concreta
se llama en cada flecha.

Hay dos consecuencias que conviene tener presentes:

- **El nombre que se importa es el de la clase, no el del objeto.** Un objeto
  etiquetado `con` cuyo `classifier` es «Component A» entra como `ComponentA`.
  Quedarse con `Con` habría llenado el diagrama de clases inventadas sin dar
  ningún error.
- **El mismo vínculo puede venir dos veces**, como asociación entre los
  componentes y como conector entre las instancias. Se dibuja una sola vez: manda
  la asociación, que lleva multiplicidades.

También se reconoce `type="EAnone_void"`, que es como EA dice que una operación no
devuelve nada. Antes se buscaba como si fuera un tipo, no se encontraba, y el
método acababa devolviendo `String` con un aviso al lado.

#### La codificación del fichero

EA exporta en **windows-1252**, no en UTF-8, y lo declara en la primera línea.
El navegador, por su cuenta, decodifica todo como UTF-8. Con nombres en inglés no
se nota; con «Artículo» el byte `0xED` no es UTF-8 válido, se sustituye por `�` y
el nombre deja de pasar la lista blanca —con un aviso que además culpa al nombre
en vez de a la lectura—. Por eso el fichero se lee en bytes y se decodifica según
lo que él mismo declara.

### Qué no se importa, y se avisa

Los avisos amarillos no bloquean; enumeran lo que se queda fuera:

| Aviso | Motivo |
|---|---|
| «Se ignora un clasificador sin `xmi:id` / sin nombre» | Sin nombre no hay tabla que crear |
| «*X* no sirve como nombre de clase y se descarta junto con su contenido» | No pasa la validación de identificadores (RNF-SEG-06) |
| «El fichero trae dos clases que se llamarían *X*: se queda la primera» | Colisión dentro del propio fichero |
| «*X* ya existe en el diagrama: se omite, junto con sus relaciones» | No se pisa lo que ya hay |
| «Tipo *T* desconocido en …: se usa `String`» | El tipo no está en el catálogo |
| «*X* pasa de 100 atributos: se recorta» | Límite por clase |
| «No se sabe a qué objeto va el mensaje *X*: se descarta» | El objeto no declara de qué clase es |
| «El orden de los mensajes no se conserva» | Un diagrama de clases no tiene dónde guardarlo |
| «Los tipos de los parámetros son supuestos: *String*» | El mensaje no los declaraba |

Y hay tres errores que **sí** bloquean la importación entera: que el fichero no
sea XML válido, que no contenga ninguna clase **ni objetos con mensajes de los que
deducirlas** (suele significar que es un XMI de otro tipo de diagrama) y que traiga
más de 300 clases.

### Seguridad

- **Los nombres de un XMI son entrada no confiable**, igual que los que devuelve
  el OCR. Se validan con la lista blanca de RNF-SEG-06 y **se rechazan, no se
  limpian**: un `Cliente; DROP TABLE usuarios--` se descarta con un aviso, no se
  convierte en `ClienteDROPTABLEusuarios`. Hay una prueba que lo fija.
- Lo mismo vale para **los nombres de los mensajes**, y ahí la comprobación se
  hace sobre el texto **antes** de normalizarlo. Normalizar primero convertiría
  `borrar(); DROP TABLE pedidos--` en el inocente `borrarDropTablePedidos`, que es
  un identificador Java perfectamente válido: sería sanear quitando caracteres,
  justo lo que RNF-SEG-06 prohíbe. El aviso cita la etiqueta entera del fichero.
- **XXE y «billion laughs» no aplican por construcción.** El lector XML está
  escrito a mano, se salta el `DOCTYPE` entero y no declara ninguna entidad, de
  modo que un `<!ENTITY xxe SYSTEM "file:///etc/passwd">` se queda como el texto
  literal `&xxe;`. Hay una prueba con ese fichero exacto.
- Topes: **8 MiB** de fichero, 200 000 nodos, 200 niveles de anidamiento,
  300 clases y 100 atributos por clase.
- El bloque de extensión **solo se lee si su `extender` es `uml-colaborativo`**.
  Las extensiones de otras herramientas se ignoran a propósito: no sabemos qué
  significan y no vamos a adivinarlo.
- Nada de esto llega al diagrama sin pasar por `applyOperations`, con las mismas
  validaciones que aplican al asistente de voz y al OCR.

### Qué está verificado contra Enterprise Architect y qué no

Durante buena parte del desarrollo este apartado decía que nada de esto se había
probado contra un fichero real de EA. **Ya no**: hay uno en
`shared/src/xmi/fixtures/ea-comunicacion.xmi`, un diagrama de comunicación
exportado por EA 6.5 que se guarda entero —con su codificación y sus 57 KB de
extensión— y sobre el que corre `shared/src/xmi/ea.test.ts`. Se guarda sin
recortar a propósito: un fixture podado a mano deja de probar lo que la
herramienta hace y pasa a probar lo que uno cree que hace, que es justo el error
que tuvo este lector devolviendo «el fichero está vacío» durante semanas.

En la dirección contraria —lo que exportamos— la verificación es de otro tipo y
conviene no confundirla: **el fichero que sale se ha abierto en EA de verdad** y
de ahí salieron los tres fallos del apartado «Lo que se corrigió al abrirlo en
Enterprise Architect». Lo que hay en pruebas no es EA, sino afirmaciones sobre
la forma concreta del XML que se escribe, contrastada con la que EA usa en sus
propios ficheros. Es una prueba de regresión, no una garantía: dice que no
volvemos a la forma que falló, no que EA lea bien todo lo demás.

Lo que ese fichero **no** cubre, y sigue sin verificarse:

- Un diagrama de **clases** exportado por EA. El de comunicación traía
  componentes; el de clases traerá `uml:Class` y, sobre todo, asociaciones con
  multiplicidades, que es donde está la duda de abajo.
- Un diagrama de comunicación cuyos participantes sean instancias de clases sin
  operaciones declaradas. Ahí los mensajes sí harían falta, y los mensajes de EA
  están en su bloque de extensión, que no leemos. El síntoma sería una
  importación con clases y dependencias pero **sin ningún método**.
- Otras herramientas: Visual Paradigm, StarUML, Papyrus. De dónde saca cada una
  la clase de un objeto se prueba por orden —`classifier`, clasificador
  declarado, el rol que la línea de vida representa y, al final, el `p1:Pedido`
  del nombre—; si alguna usa una quinta forma, el síntoma será un aviso de «no se
  sabe a qué objeto va el mensaje» y ningún método importado.

Lo primero que habría que revisar con un fichero real de EA delante es **en qué
extremo de la asociación se escribe la marca `aggregation`**. En UML la lleva la
propiedad que pertenece al «todo» y está tipada por la «parte»; en nuestro modelo
el «todo» es siempre el origen de la relación. No todas las herramientas lo
escriben igual. El importador ya acepta la marca en cualquiera de los dos extremos
y deduce el «todo» de donde la encuentre, así que el síntoma más probable de un
desajuste no es un error sino **una composición que aparece del revés**. Si pasa,
el arreglo está en `shared/src/xmi/export.ts`, en el comentario que documenta
justamente esta duda.

---

## 5.6 Historial de cambios: quién creó y quién modificó

En un editor donde varias personas escriben a la vez —y donde además se puede
editar sin conexión durante horas— un cambio que aparece sin más es
indistinguible de un error. El historial responde a las dos preguntas que
surgen entonces: **«¿qué ha pasado en este proyecto?»** y **«¿quién creó esta
tabla?»**.

### Cómo se usa

| Quiero saber | Dónde mirar |
|---|---|
| Todo lo que ha pasado en el diagrama | Botón **🕘** de la barra, junto a deshacer y rehacer |
| Quién creó una clase y quién la tocó por última vez | Selecciona la clase; al final del panel derecho, bajo **Historial** |

Cada entrada dice **quién**, **cuándo** y **por qué vía**. Las de un lote —una
importación, una orden de voz que crea varias cosas— se despliegan para ver los
cambios uno a uno.

### Qué se registra y qué no

Se registra **una entrada por acto del usuario**, no por operación interna:
importar una foto con doce clases es una entrada, no doce.

**Mover cajas por el lienzo no cuenta.** No cambia el modelo ni lo que se
genera, y llega en ráfagas de decenas por segundo mientras se arrastra: si se
registrara, un «Ana creó la clase Pedido» quedaría enterrado bajo doscientas
líneas de «Ana movió la clase Pedido». El historial sería completo e inservible.

**Deshacer añade una entrada, no borra la anterior.** Un registro que se puede
reescribir no sirve para reconstruir nada, así que `Ctrl+Z` deja escrito
«Deshizo: Crear clase Pedido» en lugar de hacer desaparecer la línea original.

### Doble autoría: quién confirma y qué propuso

Es la parte que más importa de esta pantalla. La foto de pizarra, la voz y el
XMI **proponen**; una persona **confirma** (§5.1). Si el historial guardara solo
«Ana añadió doce clases» estaría ocultando lo esencial:

> Crear clase «Pedido» y 11 cambios más
> **Ana** · hace 3 h · *desde una foto*
> *Propuesto por gemini-3.6-flash y confirmado*

Cuando dentro de un mes alguien encuentre un atributo que nadie recuerda haber
escrito, esa segunda línea es la que explica de dónde salió.

### La hora frente al orden

El orden de la lista es el del documento colaborativo: el orden en que los
cambios confluyeron. Las **fechas** las pone cada equipo con su propio reloj.

Cuando las dos cosas se contradicen —un portátil con la hora mal puesta, o
alguien que estuvo tres días editando sin conexión— la entrada se marca en rojo
y lo dice: *la posición en la lista es fiable, la hora no*. No se reordena por
fecha, que sería creerse un reloj que acaba de demostrar estar mal, ni se calla,
que sería dar por buena una hora falsa.

### Límites, dichos en voz alta

- **Se conservan los últimos 400 cambios.** El documento entero viaja a cada
  participante que se conecta; un historial sin tope acabaría siendo el grueso de
  lo que se descarga al abrir un proyecto viejo. Al podar se tira siempre por el
  extremo antiguo.
- **Lo anterior a esta función no consta.** Una clase sin registro muestra «no
  consta quién la creó» en lugar de un hueco, y nunca atribuye la creación a
  quien solo aparece modificándola.
- **No es una auditoría a prueba de manipulación.** Lo escribe cada participante
  en su propio navegador, igual que escribe las clases. Sirve para reconstruir
  qué pasó entre gente que colabora; no para demostrar nada ante quien quisiera
  falsearlo. Para eso el servidor tendría que derivar el registro por su cuenta y
  firmarlo, y eso depende de la identidad definitiva de Architech (decisión D8,
  pregunta abierta Q2).

### Dónde está

Todo el registro entra por `useDiagrama.aplicar`, que es el **único** camino de
escritura de la interfaz (decisión D6). Esa es la razón por la que ese camino
único merece defenderse: una segunda vía de escritura dejaría agujeros en el
historial sin que fallara ninguna comprobación de tipos.

| Fichero | Qué contiene |
|---|---|
| `shared/src/crdt/historial.ts` | El modelo, la poda y la lectura; qué merece registrarse |
| `frontend/src/hooks/useDiagrama.ts` | La captura, enganchada al único camino de escritura |
| `frontend/src/components/HistorialCambios.tsx` | Las dos vistas: el diagrama entero y una sola clase |

---

## 5.7 La guía: preguntar cómo se hace algo

El botón **«? Ayuda»**, abajo a la derecha, abre un panel donde se escribe —o se
dicta— una pregunta en castellano y contesta **este manual**. No es un chatbot de
propósito general: no sabe de otra cosa, y cuando la pregunta no está cubierta lo
dice en vez de improvisar.

### Las tres formas de contestar, y por qué no las elige el usuario

La misma pregunta se responde por uno de tres caminos. **No hay un selector**: se
usa el primero que esté disponible, porque el que está disponible depende de la
máquina, no del gusto de nadie.

| Dónde estás | Quién redacta | Qué necesita | Qué cuesta |
|---|---|---|---|
| Escritorio con Ollama instalado | Un modelo **en tu propio equipo** | Nada de red | Nada |
| Móvil, o escritorio sin Ollama, con conexión | El servidor, con DeepSeek | Red y clave | Céntimos por pregunta |
| Cualquier sitio, sin nada | La **búsqueda del manual**, en el navegador | Nada | Nada |

El tercero no es un mensaje de error disfrazado. Es una respuesta útil y, de
hecho, **la más fiable de las tres**: devuelve las secciones del manual tal como
alguien las escribió a propósito, en lugar de una paráfrasis que puede haberse
desviado. Por eso el panel lo enseña también cuando sí hubo modelo, bajo el
epígrafe «De dónde sale».

La cabecera del panel dice siempre con qué se está contestando —«Respondiendo con
llama3.2:3b, en tu máquina» o «Buscando en el manual, aquí mismo»—. No es un
adorno técnico: las tres respuestas se parecen en pantalla y no merecen la misma
confianza, y quien lee tiene derecho a saber cuál está leyendo.

### Cómo se usa

1. Pulsa **«? Ayuda»** (o ciérralo con `Escape`).
2. Escribe la pregunta, o pulsa el micrófono y dítala.
3. Si no se te ocurre ninguna, hay cuatro de ejemplo; se lanzan con un clic.
4. La respuesta redactada aparece arriba y **las secciones del manual debajo**.
   El botón **🔊 Escuchar** la lee en voz alta.

Las secciones aparecen **antes** que la respuesta, siempre. La búsqueda es
instantánea y no necesita red, así que no hay razón para mirar una pantalla vacía
mientras se decide si hay modelo. Con un modelo local de 3B en un portátil, la
respuesta entera tarda varios segundos; se pinta según llega, palabra a palabra,
que es lo que distingue «está pensando» de «se colgó».

### Instalar el modelo local (opcional, pero es lo que se enseña en la defensa)

Ollama **no viene con el proyecto** y la aplicación funciona sin él. Para tenerlo:

```bash
# 1. Instálalo desde https://ollama.com/download
# 2. Descarga un modelo pequeño. 3B basta de sobra: no tiene que saber nada,
#    solo redactar con el fragmento del manual que se le pasa delante.
ollama pull llama3.2:3b
```

Eso es todo. El panel pregunta a `http://localhost:11434` al abrirse, con **1,5
segundos de espera como máximo**, y si no contesta pasa al siguiente camino sin
enseñar nada rojo: que no haya modelo es el caso normal, no una avería.

#### Medido en esta máquina, no estimado

Con Ollama 0.33.2 y `llama3.2:3b` (1,88 GB en disco) sobre Windows:

| Qué | Cuánto |
|---|---|
| Detectar que hay modelo (`/api/tags`) | ~30 ms |
| Primera respuesta del día | ~16 s |
| Cargar el modelo en memoria, incluido arriba | ~5 s, solo la primera vez |

Los 16 segundos son la respuesta **completa**; las primeras palabras aparecen
mucho antes porque se pinta según llega. Aun así conviene abrir el panel una vez
antes de la defensa: eso deja el modelo cargado en RAM y la siguiente pregunta
arranca sin los cinco segundos de carga.

**CORS no hay que tocarlo en local.** Ollama contesta a `http://localhost:5173`
con su propio origen en `Access-Control-Allow-Origin` sin configurar nada; la
variable `OLLAMA_ORIGINS` solo hace falta desde un dominio desplegado, como se
explica más abajo.

> **No hay que entrenar ni afinar nada, y no conviene.** Un modelo afinado con
> este manual queda obsoleto en cuanto se toca un documento, y habría que
> reentrenarlo en cada cambio. Lo que hace la guía es buscar el fragmento
> pertinente y pasárselo al modelo en la misma pregunta (RAG). Se actualiza solo:
> editas `docs/`, y la ayuda ya sabe lo nuevo.

### Un modelo pequeño obedece la última instrucción, no la más importante

Merece la pena contarlo porque es la clase de fallo que no sale en ninguna
prueba con dobles, y porque explica por qué el prompt está redactado como está.

La primera versión terminaba con «responde en dos o tres frases **y cita entre
comillas angulares el título de la sección**». Preguntado por cómo exportar XMI,
`llama3.2:3b` contestaba esto y nada más:

```
«Exportar XMI»
```

La cita entera, sin la respuesta. Y la búsqueda había funcionado perfectamente:
le pasó las cuatro secciones correctas, incluida «5.5 Importar y exportar XMI».
El fallo era del prompt. Un modelo grande entiende que citar es un añadido al
final; uno de 3B se agarra a la última instrucción que ha leído y a su formato.

La corrección es numerar las dos partes, decir cuál es el cuerpo y cuál el pie, y
prohibir explícitamente el fallo observado —«NUNCA respondas solo con el título
de una sección»—. Eso ya está en el código.

Dos consecuencias que sí cambian el diseño:

- **El prompt vive en `shared/src/guia/prompt.ts`**, uno solo para los dos
  motores. Estuvo duplicado, y al corregir la copia del navegador la del
  servidor se quedó atrás durante un rato. Quien pregunta no elige qué motor le
  contesta —lo elige la disponibilidad—, así que dos prompts distintos son dos
  formatos de respuesta para la misma duda.
- **Un prompt es código sin compilador.** Nada avisa de que ha cambiado. Por eso
  hay pruebas que afirman su forma: que la explicación va antes que la cita, que
  la prohibición sigue ahí, y que la negativa es la misma cadena que devuelven
  los dos motores por su cuenta cuando la búsqueda no encuentra nada.

### Configuración

| Variable | Dónde | Para qué |
|---|---|---|
| `DOCS_DIR` | Servidor | Dónde están los `.md`. Por defecto el `docs/` del repositorio, resuelto desde el propio módulo y **no desde el directorio de trabajo**, para que arranque igual desde cualquier sitio |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` | Servidor | Los mismos que ya usa el asistente de voz. Sin clave, el servidor contesta solo con la búsqueda |
| `OLLAMA_ORIGINS` | La máquina con Ollama | **Solo si la aplicación está desplegada en un dominio.** Ver abajo |

En el navegador no hay nada que configurar: el manual **viaja dentro del
paquete** (`import.meta.glob` sobre `docs/*.md`), que es lo que permite responder
sin servidor. Son unos 190 kB de Markdown en el bundle, y es lo que se paga por
que la función que existe para funcionar sin red no dependa de la red.

#### El caso del dominio desplegado

Abriendo la aplicación en `http://localhost:5173` no hay nada que hacer. Pero
servida desde `https://tu-dominio.com`, el navegador pide a Ollama desde un
origen que Ollama no reconoce y **lo rechaza**. Hay que arrancarlo diciéndoselo:

```bash
# Windows (PowerShell), en la sesión desde la que se lanza Ollama
$env:OLLAMA_ORIGINS = "https://tu-dominio.com"; ollama serve
```

Dos aclaraciones que suelen dar problemas:

- **Una página HTTPS sí puede llamar a `http://localhost`.** Chrome, Edge y
  Firefox tratan `localhost` y `127.0.0.1` como origen de confianza y no lo
  bloquean por contenido mixto. **Safari es más estricto**; ahí el camino local
  puede no funcionar y se cae al servidor, que es exactamente para lo que está.
- El modelo local **nunca** se usa desde el móvil. Ollama no corre en un
  teléfono. En el móvil el camino es el servidor, y sin cobertura, la búsqueda.

### Qué es «sin conexión» de verdad, sin adornos

Conviene decirlo con precisión, porque «funciona sin internet» se promete mucho y
se cumple poco:

| Pieza | ¿Funciona sin red? |
|---|---|
| Buscar en el manual y enseñar las secciones | **Sí.** Índice y documentos están en el navegador |
| Redactar con Ollama | **Sí**, si Ollama está en esa misma máquina |
| Redactar con DeepSeek | No. Es el camino del móvil |
| **Escuchar** la respuesta (`speechSynthesis`) | **Sí.** La síntesis de voz es del dispositivo |
| **Dictar** la pregunta (`SpeechRecognition`) | **No.** En Chrome el audio viaja a Google |

Esa última fila es la mitad incómoda y por eso está escrita: el dictado no es
local por mucho que lo parezca. Lo que sí puede prometerse sin red es la lectura
en voz alta y la búsqueda.

### Por qué la búsqueda es léxica y no vectorial

Lo habitual en RAG es buscar por *embeddings*, que capturan mejor el significado.
Aquí no, y es deliberado: calcular un embedding exige **otro modelo, con red**,
que es justo lo que rompe el único caso para el que existe esta función. Una
búsqueda que necesita conexión para funcionar sin conexión no sirve de nada.

Se usa BM25 sobre los fragmentos del manual, con tres detalles que importan:

- **Los acentos se pliegan.** El dictado devuelve «como importo un xmi», sin una
  sola tilde. Sin plegar acentos, la pregunta más natural del manual sería la
  única que no encuentra su sección.
- **Las raíces se recortan hasta punto fijo**, no un número fijo de veces. Con
  dos pasadas, `ficheros` → `ficher` pero `fichero` → `fich`: una palabra dejaría
  de encajar con su propio plural. Iterando hasta que no queda sufijo, todas las
  variantes convergen.
- **Los identificadores sobreviven al troceo**: `RNF-SEG-06`,
  `V1__esquema_inicial` o `uml:Package` se buscan tal cual, sin partirse por los
  guiones ni por los dos puntos.

### Qué pasa cuando algo falla

Nunca se pierde la respuesta, y esa es toda la idea del diseño: **la búsqueda se
hace siempre y primero, antes de llamar a ningún modelo**. Cuando el modelo
falla, ya tenemos una respuesta buena en la mano; propagar un `500` sería tirarla.

| Qué falla | Qué ve el usuario |
|---|---|
| No hay Ollama | Se prueba el servidor, sin decir nada |
| No hay red | Las secciones del manual, **y ningún error**: quedarse sin cobertura no es una avería de la aplicación y no tiene por qué parecerlo |
| El modelo local revienta a media frase | Las secciones, y un aviso diciendo qué falló |
| DeepSeek devuelve `402 Insufficient Balance` | Las secciones, **y un aviso**. Nunca un `500` |
| El modelo contesta una cadena vacía | Se trata como fallo, no como respuesta |
| La pregunta no está en el manual | «Eso no lo cubre el manual», y **no se llama al modelo**: sin contexto solo podría improvisar, que es lo que tiene prohibido, y preguntar igualmente es pagar por un «no lo sé» |

El aviso existe para que la degradación **se vea**. Sin él, una clave caducada
dejaría la ayuda «funcionando» y nadie iría a mirar los registros.

### Dónde está

| Fichero | Qué contiene |
|---|---|
| `shared/src/guia/corpus.ts` | Trocear los `.md` por encabezados, respetando los bloques de código |
| `shared/src/guia/buscar.ts` | El índice y la búsqueda BM25; el contexto que se le pasa al modelo |
| `frontend/src/services/documentos.ts` | El manual empaquetado en el navegador |
| `frontend/src/services/ollama.ts` | El cliente del modelo local, con lectura por trozos |
| `frontend/src/components/Guia.tsx` | El panel: los tres caminos, el micrófono y la lectura en voz alta |
| `backend-tool/src/ai/guia.ts` | La guía del servidor: el camino del móvil |
| `backend-tool/src/api/guia.ts` | `POST /api/guia` |

---

## 5.8 Generar el backend y verlo antes de descargarlo (RF-GEN-13)

El diagrama no es el entregable: el entregable es un backend Spring Boot de
cuatro capas más DTO, con su esquema PostgreSQL. La orden que lo produce está en
**Archivo ▸ Generar proyecto Spring Boot…**.

Los puntos suspensivos no son decorativos. Hasta hace poco esa orden bajaba el
ZIP directamente, y eso tenía un problema concreto: **si el generador escribía
mal un nombre de paquete, o el validador dejaba una entidad fuera, no se sabía
hasta descomprimir el fichero y abrir un editor.** En una defensa de veinte
minutos, eso significa no saberlo nunca.

Ahora la orden abre una pantalla con lo que se va a escribir, y la descarga es
un botón dentro de ella.

### Cómo se usa

| Para | Dónde |
|---|---|
| Ver cuántos ficheros salen y cuánto ocupan | Bajo el título, en cuanto abre |
| Comprobar que están las cuatro capas y el DTO | La fila de recuentos por capa |
| Leer un fichero concreto | Pulsarlo en el árbol de la izquierda; sale a la derecha |
| Descargar el ZIP | Botón **Descargar ZIP**, arriba a la derecha |

El árbol agrupa por carpeta y recorta el prefijo que comparten todas las rutas
—`src/main/java/com/ejemplo/tienda/`— para que el ancho se gaste en los nombres
y no en repetir lo mismo cuarenta veces. El prefijo recortado se indica encima
del árbol, así que no se pierde de vista dónde va a parar cada cosa.

### El recuento por capas es una cuenta, no una promesa

Es la parte que contesta a la pregunta del enunciado —«¿de verdad genera las
cuatro capas y el DTO?»— y la contesta **contando los ficheros que se van a
escribir**, no afirmándolo. Si una capa sale a cero, no aparece su fila: un
«Repositorio: 0» ocupa una línea para no informar de nada.

La capa de cada fichero se deduce de la carpeta que lo contiene, mirando los
segmentos de la ruta **desde el final**. Tiene un motivo que se ve con un
ejemplo: el paquete base lo escribe quien crea el proyecto, y si escribe
`com.tienda.service`, entonces *todas* las rutas del proyecto contienen
`/service/`. Buscando desde el principio, las cuarenta clases saldrían como
servicios.

### Avisos: se genera igual, pero se dice antes

Si la validación deja avisos, salen arriba, con su número, **antes** de que haya
nada que descargar. Los avisos no son errores: el proyecto se genera igualmente.
Los errores sí bloquean, y eso ocurre en la validación (RF-GEN-11), no aquí.

### Lo que esta pantalla no hace

- **No genera dos veces.** Previsualizar y descargar son dos llamadas al mismo
  generador; la vista previa no deja un ZIP a medias en ningún sitio.
- **No colorea la sintaxis.** Un resaltador para Java, XML, SQL y `.properties`
  son cuatro gramáticas y una dependencia nueva para que un fichero que se lee
  una vez salga en colores. Se lee igual en monoespaciada.
- **No permite editar el código generado.** Lo que hay que corregir es el
  diagrama; editar la salida es perder el cambio en la siguiente generación.

### Dónde está esto en el código

| Fichero | Qué hace |
|---|---|
| `frontend/src/components/PrevisualizarGeneracion.tsx` | La pantalla |
| `frontend/src/components/generacion.ts` | Capas, carpetas, prefijo común y tamaños |
| `frontend/src/components/generacion.test.ts` | Sus pruebas, con rutas reales del generador |
| `GET /api/proyectos/:id/generacion/previsualizacion` | Devuelve cada fichero con su contenido |

---

## 5.9 Módulos: repartir el dominio en subpaquetes

Un proyecto de cuarenta clases en un solo paquete `com.tienda.domain` compila
perfectamente y no hay quien lo lea. Los **módulos** reparten esas clases en
contextos acotados —«Ventas», «Catálogo», «Inventario»— y cada uno aporta **un
tramo** al paquete de las suyas:

```
com.tienda.domain.Pedido                 →  com.tienda.ventas.domain.Pedido
com.tienda.repository.PedidoRepository   →  com.tienda.ventas.repository.PedidoRepository
com.tienda.service.PedidoService         →  com.tienda.ventas.service.PedidoService
```

La orden está en **Modelo ▸ Módulos del proyecto…**.

### Lo que hace que no sea una etiqueta

Es la única pregunta que importa aquí, porque una pantalla de módulos que
colorea cajas y no cambia nada es fácil de montar y no vale para nada. **El
módulo cambia lo que el generador escribe**: la línea `package …;` de cada
fichero, la carpeta dentro del ZIP, y los `import` entre unas clases y otras.

Ese último punto es el que se olvida. Sin módulos, `Pedido` y `Cliente`
comparten paquete y Java resuelve la referencia sin ningún `import`. En cuanto
`Pedido` se va a «Ventas» y `Cliente` se queda fuera, falta el import y **el
proyecto deja de compilar**. El generador lo detecta y lo escribe:

```java
package com.tienda.ventas.domain;

import com.tienda.domain.Cliente;                 // se quedó en el paquete base
import com.tienda.catalogo.domain.Producto;       // vive en otro módulo
```

Por eso la pantalla enseña, junto a cada clase, **la ruta del fichero que se va
a escribir**. Mover `Pedido` a «Ventas» cambia la línea a
`com/tienda/ventas/domain/Pedido.java` en el acto; al descomprimir el ZIP el
fichero está exactamente ahí. Es la comprobación que se puede hacer delante del
tribunal sin generar nada.

### Cómo se usa

| Para | Dónde |
|---|---|
| Crear un módulo | Formulario de la izquierda: nombre, paquete, descripción |
| Mover una clase | El selector que hay a la derecha de cada clase |
| Sacar una clase de todos los módulos | El mismo selector, opción **Sin módulo** |
| Ver dónde acabará un fichero | La ruta en monoespaciada, junto al nombre de la clase |
| Renombrar o borrar un módulo | **Editar** / **Borrar** en la cabecera de su tarjeta |

El paquete se **propone** a partir del nombre —«Recursos Humanos» sugiere
`recursos_humanos`, «Catálogo» sugiere `catalogo`— pero el campo queda editable
y manda lo que quede escrito. La propuesta deja de sobrescribir en cuanto
alguien toca el campo a mano: corregir una tilde del nombre no borra el paquete
que ya se había decidido.

Cuando de un nombre no sale nada válido —«2020», «class»— el campo se queda
**vacío** en vez de inventar `m2020` o `class2`. Un segmento inventado es peor
que un campo vacío: el vacío se ve, y `class2` acaba en el `package` sin que
nadie haya decidido llamarlo así.

### Borrar un módulo no borra sus clases

Vuelven al paquete base, que es donde estaban antes de que el módulo existiera.
Arrastrarlas consigo convertiría un cambio de organización en una pérdida de
trabajo.

Lo mismo pasa con las carreras de la edición colaborativa: si alguien borra
«Ventas» mientras otro le mete una clase, el CRDT conserva las dos operaciones y
la clase queda apuntando a un módulo que ya no existe. Eso **no es un error**;
se trata como «sin asignar» y el fichero sale en el paquete base. Tratarlo como
error convertiría una carrera corriente en un diagrama que no se puede generar.

### Qué se rechaza, y por qué no se «limpia»

El segmento acaba siendo un tramo de `package …;` y un nombre de carpeta dentro
del ZIP, así que es entrada no confiable en el sentido de **RNF-SEG-06**: se
acepta lo que encaja con la lista blanca y se rechaza lo demás, sin
transformarlo.

| Se escribe | Qué pasa |
|---|---|
| `com.ventas` | Rechazado: *«El paquete del módulo es un único tramo: escriba «ventas», no «com.ventas».»* |
| `../otro`, `..` | Rechazado. **No se le quitan los puntos para dejarlo pasar**: un módulo no puede salirse del paquete base por muy creativo que sea su nombre |
| `package`, `int` | Rechazado: palabra reservada de Java |
| `Ventas`, `recursos humanos` | Rechazado: mayúsculas y espacios |
| `ventas` cuando ya lo usa otro | Rechazado, **nombrando al que lo ocupa**: sus clases acabarían mezcladas en la misma carpeta |

Esa última es la peor de todas si se cuela, y no porque no compile: compila. Dos
módulos con el mismo paquete mezclan sus ficheros en una carpeta y nadie lo
advierte hasta que dos clases con el mismo nombre se pisan. Se comprueba **dos
veces**: en el formulario y otra vez en la validación del generador, porque un
diagrama puede llegar de un XMI importado o de un fichero copiado a mano sin
pasar por esta pantalla.

### Lo que los módulos no tocan

- **La base de datos.** Las tablas salen idénticas estén las clases repartidas o
  no. El módulo organiza el código, que es de lo que trata un contexto acotado.
  Hay una prueba que compara el fichero de migración con y sin módulos y exige
  que sea el mismo byte a byte.
- **La infraestructura compartida.** `Application.java`, el manejador global de
  errores y `ResourceNotFoundException` se quedan donde estaban; todos los
  módulos los importan del paquete base.
- **Un diagrama sin módulos.** Genera exactamente lo mismo que antes de que los
  módulos existieran. No es una promesa: hay dos pruebas que comparan las listas
  de ficheros enteras con `toEqual`, y las 986 pruebas anteriores pasaron sin
  tocar ni una.

### Cómo está comprobado, sin un compilador de Java a mano

No se puede compilar Java dentro de la suite, así que la comprobación
equivalente es **estructural** y se le pasa a todo el corpus de diagramas:

1. La línea `package …;` de cada fichero generado **coincide con la carpeta** en
   la que está.
2. Cada `import` que apunta dentro del proyecto **resuelve a un fichero que
   existe** en lo generado.

Un proyecto que pasa esas dos y no compila tendría que fallar por otra cosa.

Y para saber que la red no está descosida, se rompió a propósito: al hacer que
el generador usara el paquete base en vez del paquete de la entidad, cayeron
cinco pruebas; al invertir la condición que decide si hace falta el `import`
entre módulos, cayó exactamente la que lo vigila. Las dos mutaciones se
revirtieron.

### Dónde está esto en el código

| Fichero | Qué hace |
|---|---|
| `frontend/src/components/CatalogoModulos.tsx` | La pantalla |
| `frontend/src/components/modulos.ts` | Reparto, propuesta de segmento, validación y ruta del fichero |
| `frontend/src/components/modulos.test.ts` | Sus pruebas, sin navegador |
| `shared/src/ops/operations.ts` | `addModule`, `updateModule`, `removeModule`, `assignClassToModule` y la lista blanca del segmento |
| `generator/src/validation/validate.ts` | `INVALID_MODULE_SEGMENT` y `MODULE_SEGMENT_COLLISION` |
| `generator/src/modulos.test.ts` | La comprobación estructural y las pruebas de invariancia |

---

## 5.10 Seguridad

### Permisos

Ambas rutas de importación exigen **permiso de editor**, igual que el asistente.

La ruta de lectura de la foto no escribe nada, y aun así lo exige, por dos
razones: sube una imagen al proveedor **con cargo a la clave de esta
instalación**, y el resumen del diagrama que devuelve es información del
proyecto. Hay una prueba que comprueba que un usuario de solo lectura recibe
`403` **y que el motor de visión registró cero llamadas**: el permiso se verifica
antes de gastar un céntimo.

### Validación de todo lo que viene del modelo

Todo identificador que nace de una fotografía es **entrada no confiable**: ni
siquiera es texto que alguien haya escrito. Un nombre de columna leído de una
pizarra acaba siendo un identificador Java, un nombre de columna SQL y parte de
una ruta de fichero dentro del ZIP.

- Se valida **contra lista blanca**, después de convertirlo a la convención del
  modelo. Lo que no pasa **se rechaza con su motivo**.
- **No se «limpia» quitando caracteres.** Sanear borrando deja huecos y, peor,
  cambia el nombre a espaldas de quien está revisando.
- Los **valores de las celdas** sí se admiten tal cual, porque no son
  identificadores; el escapado para SQL lo hace el generador, en un solo sitio y
  con pruebas propias.

### Validación de la imagen

El `mimeType` lo declara el cliente, y un cliente puede decir cualquier cosa. Se
comprueban además los **bytes de cabecera** contra las firmas de PNG, JPEG y
WebP. Sin eso, la ruta aceptaría cualquier base64 —un ZIP, un ejecutable, cuatro
megas de ceros— y lo reenviaría al proveedor a costa de la clave.

| Rechazo | Código |
|---|---|
| No es base64 válido | `400` |
| Los bytes no son la imagen que dice ser | `IMAGEN_NO_VALIDA` |
| Supera `MAX_IMAGE_BYTES` | `IMAGEN_DEMASIADO_GRANDE`, diciendo cuánto pesa |
| Cuerpo desmesurado | `413`, cortado por Express antes de llegar a la ruta |
| El proveedor falla | `LECTURA_FALLIDA`, **propagando su motivo** para distinguir «saldo agotado» de «la foto no se entiende» |

### La guía también exige sesión, y no por lo que parece

`POST /api/guia` no toca ningún proyecto y solo devuelve trozos de un manual que
está publicado. Aun así pide sesión iniciada, y el motivo es **económico**: cada
pregunta que contesta el modelo se paga con la clave de esta instalación, y una
ruta abierta es una factura abierta.

Lo que el modelo devuelve se muestra como texto y nunca se convierte en
identificador, en nombre de fichero ni en SQL, así que no pasa por la lista
blanca: no tiene por dónde hacer daño. Esa garantía se rompería en el momento en
que a alguien se le ocurriera dejar que la guía **aplique** lo que explica; si se
hace, la respuesta pasa a ser entrada no confiable como cualquier otra.

### La clave

Solo en `.env` (ignorado por git), leída **en el servidor**. El navegador nunca
la ve. No aparece en el código ni en ninguna variable `VITE_*`.

Ollama no tiene clave, y esa es media razón para preferirlo: el camino local no
gasta nada y **el texto de las preguntas no sale del equipo**.

---

## 5.11 Pruebas

**543 pruebas en 24 ficheros, todas en verde.** Se ejecutan con `npx vitest run`.

De ellas, **539 corren sin instalar nada**. Las cuatro restantes se saltan solas
porque necesitan algo que no está en integración continua, y se activan poniendo
una variable:

| Variable | Qué enciende | Qué hace falta |
|---|---|---|
| `TEST_DATABASE_URL` | El recorrido contra PostgreSQL de verdad | Una base de datos **de usar y tirar** ([Despliegue §6.6](06-despliegue.md#66-estado)) |
| `TEST_OLLAMA_URL` | La guía contra un modelo local de verdad | `ollama pull llama3.2:3b` (~2 GB) |

```
TEST_OLLAMA_URL=http://localhost:11434 npx vitest run
```

| Fichero | Cubre |
|---|---|
| `shared/src/ai/grammar.test.ts` | Gramática local: el repertorio de órdenes, los ordinales dictados sin tilde, y que «elimina el campo correo de Cliente» **no** se lleve por delante `Cliente` entera |
| `shared/src/ops/import-table.test.ts` | Validación e interpretación de la tabla leída, incluida la prueba de que **la confianza declarada no cambia el resultado** |
| `shared/src/xmi/ea-export.test.ts` | **El XML que sale**, no el que vuelve: que las clases estén dentro de un `uml:Package` y que el nombre del proyecto aparezca una sola vez en él —el fallo era verlo escrito en todas las clases al abrir el fichero en EA—, que el tipo de cada extremo de asociación vaya como hijo `<type xmi:idref>` y no como atributo, que ninguna referencia (`xmi:idref`, `general`, `association`, `client`, `supplier`) apunte a un id que no está en el fichero, y que los primitivos de UML se referencien a la biblioteca estándar en vez de declararse como elementos del modelo |
| `shared/src/ops/import-diagram.test.ts` | El diagrama leído de la imagen: que `abstract` sobreviva como tipo de clase, que un extremo escrito «Class A» encuentre a la clase `ClassA`, que `0..*` se canonice a `*`, que una cardinalidad ilegible se marque como dudosa en vez de inventarse, y que las operaciones emitidas se apliquen de verdad sobre un `Y.Doc` |
| `shared/src/crdt/crdt.test.ts` | Filas de datos: que se rechacen columnas inexistentes, que `removeSeedRow` sea 1-basado, y que las filas sobrevivan al borrado de *otra* columna |
| `shared/src/ops/impact.test.ts` | Cálculo de lo que se pierde en un borrado |
| `generator/src/generator.test.ts` | Las cuatro capas sobre el **texto generado** —porque Maven no está instalado y la compilación real no se ha podido verificar (ver [Arquitectura §2.7.6])—: que el controlador no nombre nunca la entidad, que `mappedBy` caiga en el lado inverso, que la cascada solo aparezca en composición, que cada repositorio importe lo que usa y nada más; la generación del `data.sql` con su escapado, su inyección, el `setval` solo cuando procede y el byte nulo; y las operaciones del diagrama, que van al **servicio** y no a la entidad, lanzan en vez de devolver un valor inventado, no se convierten en endpoints, y se descartan con aviso cuando son privadas, chocan con el CRUD o duplican un accesor |
| `backend-tool/src/ai/assistant.test.ts` | El asistente contra un proveedor simulado: degradación a gramática ante `402`, timeout y `500`; una operación inválida descarta la propuesta entera |
| `backend-tool/src/import.test.ts` | Las rutas de OCR de extremo a extremo, incluidos permisos, validación de imagen y el recorrido completo |
| `shared/src/xmi/xmi.test.ts` | El lector XML (incluido el XXE y el orden de documento), la exportación, el ida y vuelta completo, las variantes de XMI que acepta el importador, y el diagrama de comunicación: que el método vaya en quien **recibe** el mensaje, que `p1:Pedido` cree `Pedido` y no `p1`, que el número de secuencia no acabe dentro del nombre, que un mensaje de respuesta no invente un método, que una clase que ya existía se amplíe en vez de omitirse, que ningún método se proponga dos veces —porque `applyOperations` es todo o nada y un duplicado tumbaría el lote entero— y que las clases se creen siempre antes que los métodos que van dentro |
| `shared/src/xmi/ea.test.ts` | **Un fichero real de Enterprise Architect**, guardado entero como fixture: que un diagrama de comunicación cuyos participantes son `uml:Component` y cuyos objetos son `uml:InstanceSpecification` se importe en vez de dar «el fichero está vacío», que las clases lleven el nombre del componente y no el de la instancia (`ComponentA`, no `Con`), que los `ownedConnector` de fuera de la `Collaboration` se encuentren, que el mismo vínculo escrito como asociación y como conector se dibuje una sola vez, que `EAnone_void` se lea como «no devuelve nada», y que windows-1252 no destroce los acentos |
| `shared/src/crdt/historial.test.ts` | El historial de cambios: que un acto del usuario produzca **una** entrada y arrastrar una caja ninguna, que quien confirma y lo que propone se guarden por separado, que dos participantes concurrentes no pierdan entradas al reconectar, que `Ctrl+Z` **no** borre el rastro de lo que deshizo, y que no se atribuya la creación de una clase a quien solo la modificó |
| `frontend/src/components/geometria-lienzo.test.ts` | La geometría del dibujo, que no la comprueba el compilador: que una caja crezca con su contenido y se recorte al llegar al tope, que una flecha salga por el **borde** de la caja y no de su centro, y que dos relaciones entre el mismo par de clases no acaben una encima de otra —contando A→B y B→A como el mismo par— |
| `backend-tool/src/storage/documents.test.ts` | El almacén de documentos colaborativos, la costura que permite sacar los diagramas del disco (ver [Despliegue §6.6](06-despliegue.md#66-estado)). La misma batería corre contra la versión de fichero y la de memoria: que un documento ausente dé `null` y no un error, que guardar dos veces sustituya en vez de acumular, y que un fichero corrupto se propague en lugar de fingir que el proyecto no existe. Más el orden del apagado: primero guardar, después cerrar |
| `backend-tool/src/storage/postgres.test.ts` | Los almacenes contra PostgreSQL **sin PostgreSQL**, usando un pool falso: que ningún nombre escrito por una persona acabe concatenado en el texto de la consulta —se intenta con `'; drop table proyectos; --`—, que la contraseña en claro no salga nunca hacia la base de datos, que crear un proyecto sea atómico y devuelva la conexión aunque falle a mitad, que el choque de unicidad del correo se traduzca a un 409 en vez de a un 500, y que un identificador que no es un UUID se descarte sin consultar. Más el recorrido completo contra una base de datos de verdad, que **se salta solo** sin `TEST_DATABASE_URL` |
| `backend-tool/src/storage/migracion.test.ts` | El traslado de los ficheros a PostgreSQL, y en concreto lo que lo haría irreversible: que el identificador y el hash de cada usuario lleguen **tal cual** —generar identificadores nuevos dejaría a cada uno sin sus proyectos, y del hash no se vuelve—, que las fechas se conserven para que la lista no salga desordenada, que todo vaya en una transacción, que ejecutarlo dos veces no duplique, y que un diagrama sin proyecto se descarte con aviso en vez de tumbar el traslado entero |
| `shared/src/guia/guia.test.ts` | El troceo del manual y la búsqueda, contra documentos **inventados** y no contra `docs/`: atarla al manual de verdad la volvería frágil por la razón equivocada, porque una prueba que falla porque alguien añadió un párrafo no está midiendo la búsqueda. Comprueba que un encabezado dentro de un bloque de código no parta una sección, que las secciones vacías se descarten, que la cita no repita el nombre del documento, que «como exporto un xmi» —dictado, sin tildes— llegue a la sección de exportar, que `fichero` y `ficheros` compartan raíz, que `RNF-SEG-06` no se parta por los guiones, que un corpus vacío no reviente, que una pregunta ajena no devuelva nada en vez de devolver el primer fragmento, y que el contexto se recorte por fragmentos enteros |
| `frontend/src/services/ollama.test.ts` | El cliente del modelo local **sin Ollama delante**, con un `fetch` falso: que una línea JSON partida entre dos lecturas del socket no se pierda —el fallo silencioso más fácil de escribir aquí—, que el último trozo sin salto de línea final se emita igual, que `onTrozo` respete el orden, que **no se llame al modelo** cuando el manual no tiene nada que citar, que un `404` se traduzca a un error que menciona el modelo, y que la detección de modelos se trague un `Failed to fetch` o una respuesta que no es JSON en vez de propagarlos: no tener Ollama es lo normal, no una avería |
| `frontend/src/services/ollama.integracion.test.ts` | La guía contra **un Ollama de verdad**, saltada si no hay `TEST_OLLAMA_URL`. Existe porque el `fetch` falso de la fila anterior lo escribimos nosotros: prueba que el lector de NDJSON hace lo que *creemos* que Ollama manda, y si esa creencia es falsa las dos pruebas pasan en verde mientras el panel sale en blanco. No afirma **qué** contesta el modelo —eso cambia con la versión sin que nada se rompa— sino que llega texto, que llega a trozos y que las secciones citadas son las que eligió la búsqueda. Es la que cazó el fallo del prompt contado en §5.7 |
| `backend-tool/src/ai/guia.test.ts` | La guía del servidor, esta sí contra el **`docs/` de verdad** —es lo único que comprueba que el manual de hoy se puede trocear y buscar—: que un `docs/` ausente haga fallar el arranque en lugar de servir un manual vacío que contestaría «eso no lo cubre» a todo, que una pregunta real sobre exportar encuentre la sección de XMI, y sobre todo que un `402` del proveedor **devuelva el manual con un aviso y no un `500`**, igual que una respuesta vacía del modelo |
| `backend-tool/src/frontend-estatico.test.ts` | El servicio sirviendo también el frontend, que es lo que permite desplegar en un solo contenedor. Vigila sobre todo el orden de los middlewares: que `/api/no-existe` siga devolviendo JSON y no el `index.html` con un 200, que `/salud` no quede tapada —si devolviera el index, la comprobación del balanceador pasaría siempre, incluso con el servicio roto—, y que no se pueda escapar del directorio del frontend |

La prueba que mejor resume el diseño está al final de `import.test.ts`: sube una
foto, **el usuario corrige un valor en la revisión**, y se comprueba que lo que
acaba en `V2__datos_iniciales.sql` es **el valor corregido y no el que leyó el
modelo**.

### Pendiente

- **No hay pruebas de componente del frontend.** Requieren `jsdom` y
  `@testing-library/react`, cuya instalación quedó bloqueada. Para añadirlas:

  ```bash
  npm install -D --workspace @app/frontend jsdom @testing-library/react @testing-library/user-event @testing-library/dom
  ```

  Las que faltan por escribir son: que `Asistente` no llame a `aplicar` en el
  primer clic cuando el impacto es destructivo, que `ImportarDiagrama` no llame a
  `aplicar` hasta que se pulse el botón de importar, y lo mismo para
  `ImportarXmi`. Esas propiedades están hoy
  garantizadas por revisión de código y por sus equivalentes en el servidor, no
  por una prueba automática de la interfaz.

- **RNF-MAN-02 sin verificar en local**: no hay Maven ni Docker instalados en
  esta máquina (solo JDK 17), así que no se ha podido comprobar aquí que el
  proyecto generado compile y pase sus propias pruebas.

---

## 5.12 Problemas frecuentes

| Síntoma | Causa | Solución |
|---|---|---|
| El micrófono está deshabilitado | Navegador sin API de reconocimiento de voz | Usa Chrome o Edge, o escribe la orden |
| «Sin conexión solo entiendo órdenes sencillas» | El servidor no responde | Es la gramática local; funciona, con menos repertorio |
| `SIN_MODELO_VISION` | Falta `LLM_VISION_MODEL` o `LLM_API_KEY` | Defínelas en `.env` y reinicia el backend |
| «el modelo no ha encontrado ningún diagrama en la imagen» + mención de `LLM_VISION_MODEL` | El modelo configurado no sabe mirar imágenes (p. ej. uno de DeepSeek: **ninguno** de sus modelos tiene visión) | Apunta la visión a Gemini u otro proveedor con visión (§5.2) |
| «no tiene la forma esperada: `columnas: Array must contain at least 1`» | Versión antigua del mismo caso anterior | Ya no ocurre; actualiza y relee el mensaje nuevo |
| `LECTURA_FALLIDA: Insufficient Balance` | Saldo agotado en DeepSeek | Recarga la cuenta |
| `404` … «This model … is no longer available» | El nombre de `LLM_VISION_MODEL` lo ha retirado el proveedor | El propio error dice el sustituto; ponlo en `.env` y reinicia. La clave está bien: te contestó |
| `404` al llamar a `/models` a mano para probar la clave | La capa compatible con OpenAI de Google sirve `/chat/completions`, no el listado | Prueba con `/chat/completions`, que es lo que usa el backend |
| `IMAGEN_DEMASIADO_GRANDE` | Foto por encima de 4 MiB | Recórtala; se lee mejor además |
| «Ya hay una clase X» | El diagrama ya tiene esa tabla | Cambia el nombre en la revisión, o borra la existente |
| El botón de importar está apagado | Hay errores bloqueantes | Están enumerados en rojo bajo la tabla |
| Se importó un dato mal leído | El modelo se equivocó y nadie lo vio al revisar | `Ctrl+Z` deshace la importación entera |
| Aviso rojo «N extremos de relación sin cardinalidad legible» | El modelo no pudo leer un `1`, un `*` o un `0..1` del dibujo, y **no lo ha adivinado** | Míralos en la imagen y corrígelos en los desplegables antes de importar: de ahí sale la clave foránea o la tabla de unión |
| Una relación que sí está en el dibujo no aparece en la revisión | El modelo escribió un extremo con un nombre que no corresponde a ninguna clase leída | Añádela a mano en el panel de relaciones tras importar; el emparejamiento ya prueba «Class A» ↔ `ClassA`, pero no nombres inventados |
| Una herencia sale invertida | El modelo confundió hija con padre | Cámbiala en el panel: en el diagrama el origen es la **hija** y el destino el **padre** |
| Salió agregación donde el dibujo tiene composición | Rombo hueco y rombo relleno se parecen en fotos con poca luz | Corrige el tipo en la revisión; cambia si el hijo se borra en cascada o no |
| «No se ha encontrado ninguna clase en el fichero» | El XMI es de otro tipo de diagrama (casos de uso, secuencia…) | Exporta desde la otra herramienta el diagrama de clases |
| «El fichero no es XML válido» | Fichero truncado, o no es un XMI | Vuelve a exportarlo desde la herramienta de origen |
| Una composición aparece del revés tras importar | La otra herramienta pone `aggregation` en el extremo contrario | Cámbiala en el panel; ver el límite conocido en §5.5 |
| Al importar, todas las clases salen con aviso «ya existe» | Estás importando el mismo fichero dos veces | La importación añade, no reemplaza: no hay nada que hacer |
| La ayuda dice «Buscando en el manual» aunque Ollama está arrancado | No contestó en 1,5 s, o rechazó el origen | Comprueba `ollama list`; si la aplicación no está en `localhost`, arranca Ollama con `OLLAMA_ORIGINS` (§5.7) |
| La ayuda contesta «Eso no lo cubre el manual» a **todo** | El servidor arrancó sin encontrar `docs/` | Mira el registro al arrancar: avisa. Define `DOCS_DIR`, o comprueba que la imagen Docker copió `docs/` |
| «El modelo remoto no contestó (402…)» bajo la respuesta | Saldo agotado en DeepSeek | Las secciones de abajo siguen siendo la respuesta. Recarga la cuenta |
| El micrófono de la ayuda no transcribe sin internet | El dictado de Chrome manda el audio a Google | Escribe la pregunta. La lectura en voz alta sí funciona sin red |
| La respuesta se corta a media palabra en las secciones | Es el resumen de la sección, no la sección entera | Abre el documento de `docs/` que cita el encabezado |
