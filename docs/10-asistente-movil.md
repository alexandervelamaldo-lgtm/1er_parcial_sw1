# 10. Guía de uso: el asistente móvil

Esta guía cubre la app Flutter de `mobile/` cuando se usa como **asistente de
voz contra un backend ya generado**: dictarle «apúntame una cita para mañana a
las diez» a un teléfono y que la cita aparezca en PostgreSQL.

Es la otra mitad del proyecto y conviene no confundirla con el documento 5. Allí
se dicta **para editar el diagrama**; aquí se dicta **para operar sobre los datos
del proyecto que ese diagrama generó**. Son dos asistentes distintos, con dos
gramáticas distintas, y solo uno de los dos toca datos reales:

| | Documento 5 (web) | Este documento (móvil) |
|---|---|---|
| Sobre qué se habla | El diagrama UML | Los registros del backend generado |
| Qué pasa si se entiende mal | Un diagrama equivocado, `Ctrl+Z` | Un registro equivocado, y hay que arreglarlo |
| Quién interpreta | DeepSeek, con gramática local de respaldo | **Solo** gramática local, siempre |
| Hace falta internet | Para el modelo, sí | No |

Que la segunda columna no use ningún modelo de lenguaje es deliberado y se
explica en [§10.3](#103-por-qué-aquí-no-hay-modelo-de-lenguaje).

---

## 10.0 Qué hace falta antes de empezar

1. **Un backend generado y arrancado.** Cualquiera de los que produce la
   herramienta. Si no hay ninguno todavía, el recorrido está en el documento 6.
2. **El teléfono conectado por cable**, con depuración USB activada.
3. **Español descargado en el reconocedor de voz** del teléfono, si se quiere
   dictar sin conexión. Se comprueba en *Ajustes → Sistema → Idiomas →
   Reconocimiento de voz sin conexión*. La app avisa si falta, y sigue
   funcionando saliendo a internet
   ([§10.8](#108-el-dictado-sin-conexión-de-verdad)).

No hace falta ninguna clave de API. La app no habla con DeepSeek ni con ningún
otro proveedor: **solo con el backend**.

---

## 10.1 El manifiesto: un solo APK para cualquier proyecto

La pregunta obvia al ver esto por primera vez es por qué no se genera una app
por cada diagrama, igual que se genera un backend por cada diagrama.

Porque el ciclo de trabajo lo haría inútil. Generar un proyecto Flutter por
diagrama significa que **mover una caja en el lienzo obliga a recompilar y
reinstalar un APK**. En una defensa de veinte minutos eso no se enseña; en una
barbería, nadie actualiza la app cada vez que el modelo cambia.

Así que la dependencia se invierte. El backend generado publica una descripción
de sí mismo:

```
GET /asistente/manifiesto
```

y **una sola app genérica** deriva de ella, en tiempo de ejecución, las
pantallas, los formularios y el vocabulario que entiende. El mismo APK que
contra el proyecto «tienda» sugiere «muéstrame los clientes», contra el de una
barbería sugiere «muéstrame las citas». Sin recompilar nada.

### Qué lleva el manifiesto que no lleva un OpenAPI

Ésta es la parte que justifica el formato propio, porque la objeción razonable
es «esto ya lo describe Swagger». Lo que Swagger no sabe y el diagrama sí:

- **`etiquetaHablada`**: cómo se dice la entidad en singular y en plural. Un
  esquema REST sabe que la ruta es `/linea-pedidos`; no sabe que eso se dice
  «línea de pedido» y que su plural no es «linea-pedidoes».
- **`valores` de un enumerado**: la lista cerrada. Permite que el intérprete
  acepte «ponlo en enviado» y rechace «ponlo en mandado» *antes* de gastar una
  petición.
- **`borradoEnCascada`**: qué se lleva por delante borrar algo. Sale del rombo
  relleno de una composición en el diagrama, y **es invisible desde REST**: no
  hay forma de deducir desde un OpenAPI que borrar un pedido borra sus líneas.
  Es lo que permite avisar antes, y no después.
- **`campoEtiqueta`**: con qué campo se nombra un registro cuando se habla de
  él, para poder decir «¿borro a Ana Pérez?» en vez de «¿borro el 4?».
- **`criticas`**: qué acciones exigen confirmación.

Todo eso lo sabe el diagrama y solo el diagrama. El manifiesto es el canal por
el que llega al teléfono.

---

## 10.2 Puesta en marcha

### El túnel por cable

Con `localhost` el teléfono se busca a sí mismo, no al portátil. Hace falta el
túnel, y **hay que repetirlo cada vez que se desconecta el cable**:

```bash
adb reverse tcp:8080 tcp:8080
```

Es el fallo más probable el día de la defensa, y por eso la pantalla de conexión
de la app lleva ese comando escrito debajo del campo, en vez de dejarlo en un
README que nadie abre con el proyector encendido.

### Instalar y abrir

```bash
cd mobile
flutter run --release
```

Para apuntar a otro backend sin recompilar la pantalla de conexión, se puede
fijar el valor por defecto al compilar:

```bash
flutter run --dart-define=BACKEND_URL=http://192.168.1.40:8080
```

### El recorrido dentro de la app

1. Pantalla de inicio → tarjeta **«Asistente»**.
2. Se escribe la dirección del backend → **Conectar**. Aquí es donde se descarga
   el manifiesto; si esto funciona, todo lo demás está construido.
3. Aparece el índice de entidades, sacado del manifiesto.
4. Botón flotante **«Pedir»** → la pantalla del asistente.

El asistente está en un botón flotante y no escondido en un menú porque es la
forma principal de usar la app. El índice de entidades queda como el camino
manual para cuando lo dictado no se entienda.

---

## 10.3 Por qué aquí no hay modelo de lenguaje

En la herramienta web, si DeepSeek no contesta, se cae a una gramática local y
como mucho se entiende menos. Aquí la decisión es más fuerte: **no hay modelo de
lenguaje en absoluto**, ni local ni remoto. Tres razones, en orden de peso:

1. **Tiene que funcionar sin conexión.** Un asistente que necesita internet para
   entender «apunta una cita» no es un asistente offline; es un asistente que
   deja de existir en un sótano. Y un modelo local de los que caben en un
   teléfono ocupa gigabytes, calienta el aparato y tarda segundos por frase.
2. **Aquí se tocan datos reales.** Un modelo que interpreta de más, sobre el
   diagrama, produce una caja mal puesta. Sobre los datos, produce un borrado.
3. **Lo que hay que entender es cerrado.** No es lenguaje libre: es un verbo, una
   entidad, un número y unos cuantos campos, y **la lista de entidades y campos
   la da el manifiesto**. Un modelo generalista sobra para ese trabajo.

La consecuencia práctica: el vocabulario del intérprete móvil **no contiene ni
una palabra de ningún dominio**. Los verbos («borra», «apunta», «muéstrame») son
castellano y están en el código; los sustantivos («cliente», «cita», «pedido»)
salen todos del manifiesto. Esto no es una promesa: hay una prueba con un
manifiesto de barbería que no comparte una sola palabra con el de la tienda, y
las dos baterías pasan con el mismo código.

---

## 10.4 El repertorio de órdenes

Cinco acciones. Los verbos aceptados de cada una:

| Acción | Se dice | Ejemplo |
|---|---|---|
| **Listar** | listar, lista, muéstrame, muestra, enséñame, ver todos, dame la lista de, cuántos | «muéstrame los clientes» |
| **Abrir** | ver, abrir, abre, consulta, ficha de, busca, encuentra | «abre el cliente 4» |
| **Crear** | crear, crea, nuevo, nueva, añade, agrega, registra, dar de alta, **apunta**, **configúrame**, **reserva**, **programa**, **agenda** | «agéndame una cita para mañana a las diez» |
| **Cambiar** | actualizar, actualiza, edita, modifica, cambia, corrige, ponle, pon | «cambia el email del cliente 4 a ana@ejemplo.com» |
| **Borrar** | borrar, borra, elimina, quita, suprime, dar de baja, anula | «borra el pedido 7» |

Los verbos de cita —*apunta*, *configúrame*, *reserva*, *agenda*— están ahí
porque son los que sale decir cuando se le habla a un teléfono como si fuera una
persona, que es el caso de uso que el encargo pedía: «que un barbero diga
configúrame esta cita para mañana».

### Cómo se identifica un registro

De dos maneras, y **no son equivalentes**:

- **Por número**: «borra el pedido 7». Directo.
- **Por nombre**: «borra el cliente Ana». Se busca, y **si sale más de uno no se
  elige por el usuario**: se enseñan los candidatos con su número y decide él.
  Quedarse con el primero sería borrar al cliente equivocado sin que nadie se
  enterase.

### Fechas y horas habladas

Se entienden «mañana», «pasado mañana», «el lunes», «el 3 de marzo», «a las
diez», «a las diez y media», «a las cinco de la tarde». La hora se interpreta
**antes** que la fecha, porque «mañana» significa las dos cosas —*el día
siguiente* y *la franja matinal*— y el orden contrario convertiría «mañana a las
diez» en algo distinto de lo que se dijo.

### Qué pasa cuando falta un dato

No se rechaza la frase. Si se dice «nuevo cliente Ana Pérez» y el email es
obligatorio, **se abre la ficha con lo que sí se entendió puesto y el foco en lo
que falta**. Obligar a repetir la frase entera por un dato que no se dijo es la
forma más rápida de que nadie vuelva a usar el dictado.

### Si no se entiende nada

La app contesta con su propio repertorio, dicho con las palabras del proyecto:
«Puedo listar, abrir, crear, cambiar y borrar: clientes, pedidos, productos…».
También se puede preguntar directamente: «¿qué puedes hacer?».

---

## 10.5 Dictar: el ciclo hablado

1. Se toca el **micrófono**. Se pone rojo.
2. Mientras se habla, lo que el teléfono lleva oído aparece en el campo de texto.
   Sin ese eco, el usuario repite la frase entera creyendo que no le oyen.
3. Al terminar la frase, el micrófono se apaga solo y la orden se interpreta.
4. **El asistente lee en voz alta lo que va a hacer** y pregunta si lo hace.
5. Se contesta hablando.

El paso 4 incluye el aviso de arrastre: antes de un borrado en cascada dice
«También desaparecerán sus líneas de pedido», y lo dice **antes** de tocar la
base de datos, no después.

### Contestar de viva voz

- **Confirman**: sí, claro, correcto, vale, dale, adelante, hazlo, confirmo, eso,
  exacto, perfecto, ok.
- **Cancelan**: no, cancela, para, espera, olvídalo, déjalo, mejor no, nada,
  anula.

La regla que importa: **tienen que serlo todas las palabras de la frase**. Un
«sí, adelante» confirma; un «sí, borra el cliente 4» **no** confirma nada — es
una orden nueva que se dice empezando por «sí», y tomarla por un asentimiento
ejecutaría la propuesta anterior y tiraría la frase que de verdad se dijo.

Rectificar también funciona sin decir «no»: si en vez de contestar se dicta otra
orden, sustituye a la propuesta anterior. Es lo que hace alguien que se ha
explicado mal.

### El micrófono no se enciende solo

Hay **exactamente una escucha automática en toda la app**: cuando el asistente
acaba de hacer una pregunta y está esperando el sí o el no. Fuera de ese caso el
micrófono se abre a mano.

No es una limitación, es la regla: un micrófono que se enciende solo es un
micrófono que graba sin que nadie se lo haya pedido.

---

## 10.6 Sin cobertura: la bandeja de salida

Es la parte que hace cierto «funciona sin conexión» para las escrituras.

Sin bandeja, «offline» solo querría decir que la pantalla no se rompe. Con ella:
se dicta el alta en un sótano sin señal, la app contesta **«queda apuntado»**, y
cuando el teléfono vuelve a ver la red la manda sola.

### Qué se ve

Cuando hay algo pendiente aparece un icono con un contador en la barra superior.
Solo aparece si hay algo dentro: un icono siempre encendido se convierte en parte
del decorado y deja de avisar. Al tocarlo se abre la lista, con el motivo por el
que cada orden sigue ahí y un botón **«Enviar ahora»** para no depender de que la
app decida reconectar por su cuenta —útil el día de la defensa.

### Qué se puede apuntar y qué no

Esto es lo que conviene tener claro antes de enseñarlo, porque la app **dice que
no** en dos casos y es a propósito:

| Orden | Sin cobertura | Por qué |
|---|---|---|
| **Alta** («agenda una cita para mañana») | ✅ Se apunta | Lleva dentro todo lo necesario |
| **Borrado por número** («borra el pedido 7») | ✅ Se apunta, avisando antes | El número lo dijo el usuario |
| Borrado por nombre («borra el cliente Ana») | ❌ | Hay que buscar de quién se trata, y eso pide conexión. Elegir a ciegas sería borrar al equivocado |
| Cambio («cambia el email del cliente 4») | ❌ | El `PUT` manda el registro entero y de lo dictado solo salen los campos nombrados. Sin poder leer antes cómo está, guardarlo vaciaría el resto |
| Consultar o listar | ❌ | No se arregla reintentándolo más tarde |

Que se haya caído la red **no convierte un borrado en algo que se apunta sin
preguntar**: el aviso de cascada se da igual, y si se cancela no queda nada
apuntado.

### En qué orden salen

En el mismo en que se dictaron, y **se para en cuanto una falla por red**. Si se
dijo «nuevo cliente Ana» y después «cambia el email de Ana», mandar el segundo
primero es un 404 contra un registro que aún no existe. Y si no se llega al
servidor para la primera, tampoco se va a llegar para la siguiente.

### Qué pasa si el servidor rechaza una

- **4xx** (dato inválido): se aparta, marcada, y **la cola sigue corriendo**.
  Reintentarlo mil veces daría mil veces lo mismo y taponaría todo lo de detrás.
- **5xx o 429** (el servidor está pero no puede ahora): se conserva y se detiene
  la cola, igual que con un corte de red.

Lo rechazado **se queda a la vista** hasta que alguien lo descarta a mano. Una
orden que el usuario dio y que nunca se cumplió tiene que dejar rastro, o la
próxima vez que mire la agenda faltará una cita y no habrá forma de saber por
qué.

### Sobrevive a cerrar la app

Se guarda en el directorio privado de la app —no en la caché, que el sistema
vacía cuando le hace falta espacio— con escritura atómica: se escribe a un
fichero temporal y se renombra encima. Si Android mata la app a mitad, queda la
bandeja vieja entera o la nueva entera, nunca media. Escribir directamente sobre
el fichero bueno cambiaría «pierdo la última orden» por «pierdo todas».

---

## 10.7 Por qué reenviar no duplica

Es la pregunta de la que sale todo el diseño de la bandeja:

> **¿Qué pasa si la primera petición sí llegó al servidor y lo que se perdió fue
> la respuesta?**

Desde el teléfono los dos casos son idénticos: un socket que se corta. Reintentar
a ciegas duplicaría el registro la mitad de las veces —y con una cita, eso es
que el barbero tiene dos clientes a las diez.

Lo que lo impide es una **clave de idempotencia**, y el detalle que la hace
funcionar es **cuándo se genera**:

> La clave se fija **al dictar la orden**, no al mandarla.

Si se generase al enviar, cada reintento traería una clave distinta y no habría
nada que comparar: sería exactamente el caso que la cabecera existe para
impedir. Como se fija al dictar, viaja con la orden hasta el disco y el reenvío
manda **la misma**.

El backend generado la recibe en `Idempotency-Key` y la guarda con la respuesta.
La exclusión mutua no es un candado en memoria —que no sobreviviría a dos
instancias detrás de un balanceador— sino **la clave primaria de PostgreSQL**:
un `INSERT … ON CONFLICT DO NOTHING`. El que gana ejecuta; el que pierde recibe
la respuesta guardada. Solo se guardan las respuestas 2xx, para que un fallo
transitorio no quede grabado como definitivo.

Un caso merece mención aparte: **un 404 al reenviar un borrado se cuenta como
éxito**. Es el resultado que se pedía, y lo más probable es que la primera
petición sí llegara y solo se perdiera la respuesta. Tratarlo como error dejaría
en la bandeja, marcada en rojo, una orden que ya se cumplió. La misma respuesta
al reenviar un **cambio** sí es un fallo: ahí nadie pidió que el registro dejara
de existir.

---

## 10.8 El dictado, sin conexión de verdad

El reconocimiento se pide **dentro del aparato** (`onDevice`), no en los
servidores de Google. Es media promesa del proyecto: si saliera a internet en
cada orden, «funciona sin conexión» dejaría de ser cierto.

Hay una sola familia de errores que no significa «el dictado no funciona» sino
«no funciona sin salir a la red»: que el español no esté descargado. Cuando pasa:

1. Se avisa, con lo que hay que hacer («Ajustes → …»).
2. **Se cae a reconocimiento por red** y se sigue trabajando.
3. Se dice **una sola vez**. Repetirlo en cada orden lo convertiría en ruido que
   se aprende a ignorar, y entonces dejaría de avisar de nada.

El altavoz espera a terminar de hablar antes de devolver el control
(`awaitSpeakCompletion`). Sin eso, la pantalla reabre el micrófono mientras el
altavoz sigue sonando, y **el teléfono se oye a sí mismo** y toma su propia frase
por la respuesta del usuario.

---

## 10.9 Seguridad

- **La app no lleva ninguna clave de API dentro.** No habla con DeepSeek ni con
  ningún proveedor: solo con el backend. Una clave compilada en un APK es una
  clave pública, porque un APK se descompila.
- **Nada de lo dictado se convierte nunca en un identificador ni en un trozo de
  URL.** Los nombres de entidad y de campo se eligen de la lista que ya venía
  validada en el manifiesto; lo dictado solo puede acabar como **valor** dentro
  del cuerpo JSON. Es la misma regla (RNF-SEG-06) que se aplica al OCR y al XMI:
  lista blanca, nunca sanear quitando caracteres.
- **Lo que se lee del fichero de la bandeja también es entrada no confiable.**
  Una entrada mal formada se descarta —sin llevarse las demás por delante— y el
  nombre de la entidad se resuelve contra el manifiesto actual en vez de
  concatenarse en una URL. Si el diagrama cambió mientras la orden esperaba, se
  marca y se enseña; no se manda a una ruta adivinada.
- **El audio no se sube a ningún sitio** mientras el español esté descargado.
- Los permisos de micrófono se piden en tiempo de ejecución, y la app se instala
  igual en un teléfono sin cámara (`required="false"`).

---

## 10.10 Qué está probado

`cd mobile && flutter test` — **206 pruebas**, y `flutter analyze` sin avisos.

Lo que cubren, en lo que a esta guía respecta:

| Afirmación de este documento | Dónde se comprueba |
|---|---|
| El vocabulario sale del manifiesto y no del código | `gramatica_test.dart`, con un manifiesto de barbería sin una palabra en común |
| Un borrado en cascada avisa antes de tocar nada | `pantalla_asistente_test.dart` |
| Un borrado entero sin tocar la pantalla, dictado y confirmado | «un borrado entero sin tocar la pantalla» |
| El micrófono no se enciende solo salvo tras una pregunta | «tras preguntar se vuelve a abrir el micrófono solo» |
| La clave se fija al dictar y es la que viaja | «la clave del dictado es la que acaba viajando en el POST» |
| Se dicta sin cobertura y sale solo al volver la red, con la clave original | «un alta dictada queda apuntada y sale sola al volver la red» |
| El reenvío respeta el orden y se para al primer corte | `bandeja_test.dart` |
| Un 404 al reenviar un borrado no es un fallo | `bandeja_test.dart` |
| Un fichero de bandeja corrupto no impide arrancar | `bandeja_test.dart` |

El micrófono y el altavoz están detrás de una interfaz (`MotorDeVoz`) con un
doble de pruebas. No es purismo: `speech_to_text` y `flutter_tts` hablan por
canales de plataforma y en un `flutter test` no hay nadie al otro lado, así que
sin el doble estas afirmaciones habría que ir a verificarlas a mano con un móvil
en la mano cada vez que se toca un fichero. **Una prueba que necesita un teléfono
es una prueba que no se ejecuta.**

Lo que **no** está verificado automáticamente y hay que probar en el aparato:

- El dictado sin conexión real, en modo avión, con el español descargado.
- Que el reconocedor del teléfono concreto entienda los nombres propios del
  dominio.

---

## 10.11 Problemas frecuentes

**«No se pudo conectar».** Falta el `adb reverse`, o el backend no está
arrancado. Se repite el túnel cada vez que se desconecta el cable.

**«Ahí hay un servidor, pero no publica /asistente/manifiesto».** Está
conectando contra algo que no es un backend generado por esta herramienta, o
contra uno generado antes de que existiera el manifiesto. Se regenera.

**El micrófono no arranca.** Falta el permiso, o el teléfono no tiene
reconocedor. Desde Android 11 una app no ve a las demás salvo que las declare, y
sin esa declaración el sistema contesta «no hay» en un teléfono que sí lo tiene;
está declarado en el manifiesto de Android, pero si se toca ese fichero, es el
primer sitio donde mirar.

**Habla pero no oye la respuesta.** El altavoz y el micrófono se pisan. Debería
estar resuelto esperando a que termine de hablar; si reaparece, es ahí.

**Se dictó una orden y no aparece en la base de datos.** Se mira el contador de
la barra superior. Si la orden está en la bandeja marcada en rojo, el motivo está
escrito debajo. Si está en gris, es que todavía no ha habido red: **«Enviar
ahora»**.

**Dice «no puedo apuntarlo sin conexión».** Es un cambio, o un borrado por
nombre. Está en la tabla de [§10.6](#106-sin-cobertura-la-bandeja-de-salida), y
para el borrado hay salida: decirlo con el número.
