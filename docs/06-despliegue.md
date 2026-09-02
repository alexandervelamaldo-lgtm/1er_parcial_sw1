# 6. Despliegue

Cómo llevar la herramienta a GitHub y de ahí a AWS. El backend generado por la
herramienta es otra cosa y se despliega aparte, con su propio
`docker-compose.yml` ([Arquitectura §2.7.4]).

---

## 6.1 Antes del primer commit

Dos comprobaciones que solo se pueden hacer una vez, porque el primer commit de
un repositorio es donde se cuelan estas cosas y el historial de git no olvida.

**Rotar las claves expuestas.** Cualquier clave que haya aparecido en una
captura, en un chat o en una consola compartida está quemada. Rotarla en el
panel del proveedor **antes** de publicar el repositorio, no después.

**Verificar que no entra nada sensible.** Están ignorados `.env`, `datos/`,
`backend-tool/datos/` y los ficheros de trabajo `tmp-*`. Conviene confirmarlo
sobre lo que git realmente va a subir, no sobre lo que uno cree que hay:

```bash
git init
git add -A
git status --short          # revisar la lista entera antes de commitear
git ls-files | grep -Ei 'env|secreto|datos/'   # debe salir vacío
```

Una clave commiteada sigue en el historial aunque se borre en el commit
siguiente. Si pasa, la salida no es un `git rm`: es rotar la clave.

---

## 6.2 Lo que hay que saber antes de elegir plataforma

### El sistema de ficheros efímero

El almacén por defecto son ficheros en disco. En App Runner, en ECS Fargate y en
Render, el sistema de ficheros del contenedor **se destruye en cada despliegue y
en cada reinicio**. Sin base de datos, eso significa perder los usuarios, los
proyectos y todos los diagramas cada vez que se sube una versión.

No es pérdida de sesión: es pérdida de datos. Por eso `DATABASE_URL` no es
opcional en ninguno de esos destinos.

### El canal colaborativo es un WebSocket

Dos consecuencias que se olvidan y se pagan caras:

- **El balanceador tiene que permitir conexiones largas.** Un ALB las admite,
  pero el `idle timeout` por defecto (60 s) corta el socket. La aplicación
  reconecta —Yjs converge igual— pero se nota. Subirlo a 300 s o más.
- **Una sola instancia, o pegajosidad de sesión.** Las salas viven en la memoria
  del proceso. Con dos instancias detrás de un balanceador, dos usuarios del
  mismo proyecto pueden caer en instancias distintas y **no verse entre ellos**,
  aunque los dos guarden en la misma base de datos. Escalar en horizontal exige
  un adaptador de mensajería entre instancias, que hoy no existe. Para el
  tamaño de un parcial, una instancia sobra.

### Mismo origen

El cliente deriva la URL del WebSocket de `location.host`. Servir el frontend
desde S3/CloudFront y el backend desde otro sitio deja al navegador buscando el
canal colaborativo en el host del frontend, donde no hay nadie. Por eso la
imagen sirve las dos cosas: un contenedor, un origen, y CORS sin nada que hacer.

---

## 6.3 La imagen

`Dockerfile` en la raíz, multi-etapa: la primera construye el frontend, la
segunda ejecuta el servicio con el `dist/` ya dentro.

```bash
docker build -t uml-tool .
docker run --rm -p 3001:3001 \
  -e SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
  -e DATABASE_URL="postgresql://…" \
  uml-tool
```

Comprobar en `http://localhost:3001/salud` antes de subir nada. Esa misma ruta
es la que usan el `HEALTHCHECK` de la imagen y el balanceador.

### `docs/` viaja dentro, y no es documentación

La imagen copia `docs/` a propósito. Dejó de ser documentación cuando la guía de
la aplicación empezó a leerla para contestar ([§5.7](05-guia-voz-y-ocr.md#57-la-guía-preguntar-cómo-se-hace-algo)):
ahora es **dato de ejecución**. El `.dockerignore` la excluía con el comentario
«la documentación no se ejecuta», que había dejado de ser cierto.

Sin ese directorio el servicio **arranca igual**, con la ayuda desactivada y un
aviso en el registro. Es deliberado —quedarse sin servicio porque falta un
directorio de Markdown sería una avería buscada—, pero conviene saber que el
síntoma en producción es «eso no lo cubre el manual» a *todas* las preguntas.
Para descartarlo:

```bash
docker run --rm uml-tool ls docs
```

### El modelo local no se despliega

Ollama corre en la máquina de quien usa la aplicación, no en el contenedor: no
hay nada que instalar en AWS. Lo único que cambia al desplegar es que el
navegador llama a `localhost:11434` desde un origen que Ollama no conoce y lo
rechaza. Quien quiera el camino local contra la versión desplegada tiene que
arrancarlo con `OLLAMA_ORIGINS=https://tu-dominio.com`. Sin eso, la aplicación
usa el servidor, que es lo que hace ya cualquier móvil.

---

## 6.4 AWS

### Opción recomendada: App Runner + RDS

Es la que menos piezas tiene y la que menos se puede configurar mal.

1. **RDS PostgreSQL.** Instancia mínima (`db.t4g.micro`), en la misma región.
   No hacerla pública: se conecta por VPC. No hay que crear tablas a mano: el
   servicio aplica su esquema al arrancar (§6.5).
2. **ECR.** Crear el repositorio y subir la imagen:
   ```bash
   aws ecr get-login-password --region eu-west-1 \
     | docker login --username AWS --password-stdin <cuenta>.dkr.ecr.eu-west-1.amazonaws.com
   docker tag uml-tool <cuenta>.dkr.ecr.eu-west-1.amazonaws.com/uml-tool:v1
   docker push <cuenta>.dkr.ecr.eu-west-1.amazonaws.com/uml-tool:v1
   ```
3. **App Runner** apuntando a esa imagen. Puerto 3001, comprobación de salud en
   `/salud`, y un *VPC connector* para poder hablar con RDS.
4. **Variables de entorno**, con los secretos en Secrets Manager y no en texto
   plano en la consola:

   | Variable | Valor |
   |---|---|
   | `SESSION_SECRET` | Desde Secrets Manager. Obligatoria |
   | `DATABASE_URL` | Desde Secrets Manager, apuntando a RDS |
   | `FRONTEND_DIR` | `/app/frontend/dist` (ya viene en la imagen) |
   | `HOST` | `0.0.0.0` (ya viene en la imagen) |
   | `LLM_API_KEY`, `LLM_VISION_API_KEY` | Desde Secrets Manager |
   | `DOCS_DIR` | No hace falta. La imagen trae `docs/` y el valor por defecto lo encuentra |

App Runner admite WebSockets y termina TLS por su cuenta, así que `wss://`
funciona sin configurar nada más.

### Alternativa: ECS Fargate + ALB

Más control y más piezas. Lo específico frente a lo anterior:

- **Subir el `idle timeout` del ALB** a 300 s o el canal se corta cada minuto.
- **Grupo de destino** con comprobación de salud en `/salud`.
- **Una sola tarea** (`desiredCount: 1`) mientras no haya mensajería entre
  instancias, por lo dicho en §6.2.
- **Grupo de seguridad de RDS** que admita solo al de las tareas.

### Lo que no funciona

**S3 + CloudFront para el frontend con el backend aparte.** Rompe el WebSocket
por lo explicado en §6.2. Si se quiere CDN, va **delante** del servicio entero,
no en lugar de él.

**Lambda.** El canal colaborativo mantiene conexiones abiertas y estado en
memoria. No encaja en un modelo de función efímera.

---

## 6.5 La base de datos

### Un solo interruptor

`DATABASE_URL` decide dónde se guarda todo. Con ella, los usuarios, los
proyectos y los documentos van a PostgreSQL; sin ella, a ficheros bajo
`DATA_DIR`. No hay una variable aparte para el modo, precisamente para que no
exista el estado incoherente de pedir PostgreSQL sin decir cuál.

Los tres almacenes se eligen **juntos**. Media aplicación en la base de datos y
media en disco significaría permisos que sobreviven al despliegue apuntando a
usuarios que no: nadie podría entrar en su propio proyecto.

### El driver hay que instalarlo

```bash
npm install --workspace @app/backend-tool pg
npm install -D --workspace @app/backend-tool @types/pg   # solo para desarrollar
```

`pg` se carga con un `import()` dinámico y **solo cuando hay `DATABASE_URL`**, de
modo que una instalación de desarrollo no lo necesita para arrancar. Si falta y
la variable está puesta, el servicio no arranca y dice exactamente qué ejecutar,
en lugar de fallar en la primera petición.

### El esquema se aplica solo

`backend-tool/sql/esquema.sql` corre en cada arranque. Es idempotente —todo es
`create table if not exists`—, así que no hace falta el paso manual de entrar por
`psql`, que es el que siempre se olvida. El día que haya que *cambiar* una
columna existente esto no bastará y hará falta una herramienta de migraciones.

Cuatro tablas: `usuarios`, `proyectos`, `miembros` y `documentos`. El documento
colaborativo es un `bytea` con el estado Yjs entero, y vive en su propia tabla
porque se reescribe cada dos segundos y no conviene tenerlo pegado a la fila que
se consulta para pintar la lista de proyectos.

### Traer los datos que ya existen

Poner `DATABASE_URL` y arrancar **no trae nada consigo**: los almacenes leen de
las tablas, no de los ficheros, y el servicio aparece vacío. No se pierde nada
—`datos/` sigue en el disco y quitar la variable devuelve todo— pero conviene
saberlo antes y no a mitad de una demostración.

```bash
npm run migrar --workspace @app/backend-tool
```

Lee `DATA_DIR`, escribe en `DATABASE_URL` e imprime lo que ha hecho. Se puede
ejecutar más de una vez: todo va con `on conflict do nothing`, así que lo que ya
esté en la base gana y se informa de cuántas filas se respetaron.

Lo que hace y no se ve:

- **Conserva identificadores, sales y hashes.** No pasa por
  `PostgresIdentityProvider.register()`, que generaría identificadores nuevos y
  dejaría las pertenencias apuntando a los viejos: cada uno entraría sin ver
  ninguno de sus proyectos. Y la contraseña no se puede volver a derivar, porque
  del hash no se vuelve.
- **Conserva las fechas.** Con `default now()` la lista de proyectos, que se
  ordena por `actualizado_en`, saldría en un orden que no se parece al que el
  usuario recuerda.
- **Todo en una transacción.** A medias sería peor que nada.
- **Descarta los diagramas sin proyecto** y los nombra en el resumen. Una sala
  sin proyecto es inalcanzable desde la aplicación; copiarla solo llevaría
  basura a la base nueva. Sus ficheros no se tocan.

### TLS

Se respeta el `sslmode` de la cadena de conexión, como en `psql`. Conviene saber
qué se está pidiendo:

| `sslmode` | Qué hace |
|---|---|
| `disable` | Sin cifrar. Correcto solo contra una base local |
| `require` | Cifra, pero **no comprueba de quién es el certificado**. Protege de quien escucha el cable, no de quien suplanta la base de datos |
| `verify-full` | Cifra y verifica. Es lo correcto contra RDS, y necesita el *bundle* de autoridades de Amazon en `NODE_EXTRA_CA_CERTS` |

Sin `sslmode` y contra un host que no es local, se cifra sin verificar: es lo
mínimo que hace falta para que RDS conteste. Funciona, pero no es el ajuste con
el que conviene quedarse.

---

## 6.6 Estado

| Pieza | Estado |
|---|---|
| Configuración por entorno (`PORT`, `HOST`, `DATABASE_URL`, `FRONTEND_DIR`…) | ✅ |
| `wss://` derivado solo al pasar a HTTPS | ✅ |
| Frontend servido desde el propio servicio, con fallback de SPA | ✅ 9 pruebas |
| `DocumentStore` como costura para sacar los diagramas del disco | ✅ 18 pruebas |
| `Dockerfile` multi-etapa y `.dockerignore` | ✅ |
| Almacenes contra PostgreSQL y esquema SQL | ✅ 29 pruebas |
| Migración de los datos de fichero a PostgreSQL | ✅ 12 pruebas |
| **`pg` instalado** | ❌ **lo tiene que ejecutar el usuario** |
| Verificación contra una base de datos real | ✅ ejecutada contra PostgreSQL 16 |
| Imagen construida y probada de verdad | ❌ no verificado |
| Escalado horizontal del canal colaborativo | ❌ fuera de alcance |

### Qué está verificado y qué no

Las 29 pruebas de `postgres.test.ts` corren **sin base de datos**, contra un pool
falso. No demuestran que el SQL sea correcto —eso solo lo dice PostgreSQL—, sino
lo que sí se puede comprobar sin servidor y es donde están los errores caros:
que ningún dato escrito por el usuario acabe concatenado en el texto de la
consulta, que la contraseña en claro no salga nunca hacia la base de datos, que
crear un proyecto sea atómico y devuelva la conexión aunque falle a mitad, y que
la fila se traduzca al modelo sin perder ni inventar campos.

El recorrido completo contra una base de datos real está escrito y **se salta
solo** mientras no haya `TEST_DATABASE_URL`. Necesita una base de datos de usar
y tirar, porque crea el esquema y borra lo que crea.

Con un PostgreSQL ya instalado (PowerShell):

```powershell
# La contraseña se pide, no se escribe en la línea: así no queda en el historial.
$env:PGPASSWORD = Read-Host "contraseña de postgres" -AsSecureString `
  | ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) }

& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres -h localhost -p 5432 uml_pruebas

# Sin contraseña en la URL: `pg` la toma de PGPASSWORD cuando la cadena no la trae.
$env:TEST_DATABASE_URL = "postgresql://postgres@localhost:5432/uml_pruebas"
npx vitest run postgres

# Al terminar, para no dejar la contraseña en la sesión:
Remove-Item Env:PGPASSWORD, Env:TEST_DATABASE_URL
```

Con Docker, si se prefiere no tocar la instalación local:

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=pruebas --name pg-pruebas postgres:16
TEST_DATABASE_URL=postgresql://postgres:pruebas@localhost:5433/postgres npx vitest run postgres
```

Ejecutado contra PostgreSQL 16: las 30 pruebas en verde, incluido el recorrido
completo. El esquema se aplica, el usuario se registra y autentica, el proyecto
nace con su permiso `owner`, el diagrama se guarda, se sobrescribe y se borra, y
la cascada se lleva la pertenencia al eliminar el proyecto.

Queda sin verificar contra RDS, que es otra cosa: allí entra en juego el TLS, y
un `verify-full` sin el certificado de Amazon en `NODE_EXTRA_CA_CERTS` falla en
la conexión, no en las consultas.

### Lo que sigue pendiente

**Mientras `pg` no esté instalado, desplegar con `DATABASE_URL` no arranca** —con
un mensaje claro— y desplegar sin ella pierde todos los datos en cada
despliegue. Con una instancia y disco efímero la aplicación *funciona* —se puede
registrar, dibujar y generar—, pero no sobrevive a la siguiente versión.

---

## 6.7 Antes de la nube: llegar desde el móvil a lo que corre en el portátil

Esta sección no va de desplegar, va de la defensa. El ingeniero acepta
`localhost` porque conoce el problema del internet en la facultad, y la app móvil
tendrá que hablar con un backend que estará corriendo en el portátil, ahí mismo.
Hay tres formas de conseguirlo y no valen lo mismo.

### La trampa de la que salen casi todos los fallos

En el teléfono, `localhost` es **el teléfono**. Una app que pide
`http://localhost:3001` se busca a sí misma, no encuentra nada y da *connection
refused*. No es un fallo del backend ni de la red: es que la palabra significa
otra cosa a cada lado del cable.

El backend ya está preparado para que le llamen de fuera —`HOST` vale `0.0.0.0`
por defecto, o sea que escucha en todas las interfaces, no solo en la de
loopback—, así que no hay nada que cambiar ahí.

### Las tres rutas

| Ruta | Qué se pide desde el móvil | Cuándo |
|---|---|---|
| **Cable USB** (`adb reverse tcp:3001 tcp:3001`) | `http://localhost:3001` | La defensa |
| **Misma Wi-Fi** | `http://192.168.x.x:3001` | Desarrollar en casa |
| **Emulador de Android** | `http://10.0.2.2:3001` | Sin teléfono delante |

**El cable es el que hay que llevar al examen**, y la razón no es la comodidad:
muchas redes institucionales tienen aislamiento de clientes, que deja pasar
internet pero impide que dos dispositivos de la misma red se vean entre ellos.
Con eso, la ruta por IP local deja de funcionar y **no hay nada que configurar
desde nuestro lado**. `adb reverse` abre un túnel por el USB, así que no pasa por
la red y le da igual cómo esté montada. Además el cable ya va a estar puesto:
`flutter run` en un móvil físico usa `adb` de todos modos.

El comando hay que repetirlo si se desconecta el cable o se reinicia `adb`. Y es
solo Android; en iOS no hay equivalente y toca la ruta de la Wi-Fi.

### Para abrir la web (no la app) desde el móvil

Distinto caso: aquí no hay app nativa, es el navegador del teléfono entrando al
servidor de desarrollo.

```bash
npm run dev:frontend:lan
```

Imprime la dirección que hay que teclear. **Basta con abrir el 5173**, no el
3001: el teléfono habla solo con Vite, y es Vite —desde el portátil— quien llama
al backend por `localhost`, incluido el WebSocket de colaboración.

Verificado en esta máquina: Vite sirve en `192.168.0.62:5173` y el proxy llega al
backend. El cortafuegos de Windows ya tiene reglas de entrada para `node.exe` en
perfil Público, así que no hizo falta añadir ninguna; si en otra máquina no
estuvieran, Windows lo pregunta la primera vez y hay que decir que sí.

> Que la orden sea `dev:frontend:lan` y no la de por defecto es deliberado: este
> servidor hace de intermediario hacia el backend, con la sesión y los proyectos
> detrás, y sirve el código fuente con sus mapas. Dejarlo escuchando en todas las
> interfaces de forma permanente expone eso en cualquier red a la que se conecte
> el portátil. El razonamiento largo está en `frontend/vite.config.ts`.

### Dos cosas que van a fallar en la app Flutter aunque la red esté bien

**Android 9+ bloquea el HTTP en claro.** La conexión llega y el sistema la corta
igual. Se arregla con un `network_security_config.xml` que permita cleartext
**solo** para el host de desarrollo; poner `usesCleartextTraffic="true"` a secas
es más fácil y viaja a producción, que es justo lo que no se quiere. En iOS es lo
mismo con ATS (`NSAllowsLocalNetworking`), y además iOS 14+ pide permiso de «red
local» la primera vez.

**No hay origen, así que no hay URL relativa.** El frontend web pide `/api/...`
([`api.ts`](../frontend/src/services/api.ts)) y deriva el WebSocket de
`location.host`. Las dos cosas funcionan porque hay una página servida desde
algún sitio; en Flutter nativo no la hay. La app necesita una **URL base
configurable** —por `--dart-define`— de la que cuelguen el REST y el WebSocket.
No es trabajo perdido: es exactamente lo que hará falta para apuntar a AWS.

Lo que **no** hace falta en Flutter nativo es CORS. `CORS_ORIGINS` lo aplica el
navegador; una app nativa ni manda `Origin` ni respeta la política. Solo
importaría metiendo la web en un WebView.

### Y una que no tiene arreglo

**Ollama no va a funcionar desde el móvil**, ni ahora ni después. Un modelo de 3B
no corre en un teléfono. El móvil toma siempre el camino del servidor
(`/api/guia`) o el de búsqueda léxica en el propio navegador; las tres rutas y
cuándo entra cada una están en [Guía §5.7](05-guia-voz-y-ocr.md).

## 6.8 Y cuando llega: que quepa en la pantalla

Llegar y caber son dos problemas distintos. Resuelto el primero en §6.7, el
editor seguía sin poderse usar en un teléfono, y no por poco.

### Lo que estaba roto

El editor está pensado como tres franjas: barra arriba, lienzo y panel de
propiedades repartiéndose el ancho, asistente abajo. El panel medía **320 px
fijos**. En una pantalla de 390 px eso deja **setenta píxeles de lienzo**. No es
que quedara apretado: es que no había dónde dibujar.

### El cambio de eje

Por debajo de 820 px el cuerpo del editor pasa de fila a columna: lienzo y panel
dejan de repartirse el ancho y se reparten la altura. Y el panel **solo aparece
cuando hay una clase seleccionada**, que es exactamente cuando tiene algo que
decir; sin selección lo único que mostraba era «selecciona una clase», y eso
costaba media pantalla a cambio de nada.

Tocar el fondo del lienzo deselecciona, el panel se va y el diagrama recupera la
pantalla entera. No hizo falta ni un botón de cerrar ni un estado nuevo: la
selección ya significaba eso.

El corte está en **820 px y no en 480**. Por debajo de 820 el panel de 320 deja
menos de 500 al lienzo, incómodo aunque sea un portátil con la ventana a medias;
y una tablet en vertical (768) tiene el mismo problema que un móvil, no uno
distinto.

### El fallo que solo se ve echando la cuenta

El reparto se escribió primero como `max-height: 55vh` para el panel. Está mal, y
la pantalla no lo delata hasta que se mide:

| | |
|---|---|
| Ventana de un móvil | 750 px |
| Menos la barra de herramientas (≈3 filas) | −138 |
| Menos la franja del asistente | −54 |
| **Le queda al cuerpo del editor** | **468** |
| Panel a `55vh` = 55 % de 750 | 412 |
| **Le queda al lienzo** | **56 px** |

`vh` mide la ventana entera, pero para cuando el panel entra en juego la barra y
el asistente ya se han llevado un tercio. La regla correcta es un **porcentaje**,
que se mide contra el hueco que de verdad hay: `max-height: 50%` reparte a medias
lo que queda. El lienzo lleva además un `min-height: 40%` como suelo, por si ese
porcentaje no resolviera en algún navegador.

### Ampliar con dos dedos

En un móvil no hay rueda del ratón, y el lienzo lleva `touch-action: none` para
poder arrastrar clases sin que la página haga scroll —lo que también apaga el
zoom del navegador—. Sin pellizco, un diagrama de diez clases no cabe en un
teléfono y **no hay ninguna forma de alejarlo**.

Está puesto con escuchadores nativos en **fase de captura**, no con los
`onPointer…` de React, y el motivo es concreto: `Caja` llama a `stopPropagation`
al recibir un dedo, así que el segundo dedo —que cae encima de una clase justo
cuando se quiere ampliar esa clase— nunca llegaría a contarse. La captura ocurre
antes de que nadie pueda pararla.

### El `viewBox` que se quedaba viejo

Aparte, un fallo que estaba ahí desde el principio y que solo se manifiesta fuera
de un portátil quieto. El tamaño del lienzo se leía del DOM **en pleno render**
(`svgRef.current?.clientWidth ?? 1200`), y nada provoca un render cuando el
elemento cambia de tamaño. Al girar el teléfono, al abrir el panel —que ahora le
quita la mitad de la altura— o al cambiar el navegador de ventana, el `viewBox`
conservaba las medidas de antes y el diagrama salía estirado hasta que otra cosa
cualquiera obligaba a repintar. Ahora lo observa un `ResizeObserver` y vive en
estado.

### Qué está verificado y qué no

| | |
|---|---|
| `typecheck` en los cuatro paquetes | ✅ |
| 539 pruebas en verde, `build` correcto | ✅ |
| El escritorio no cambia | ✅ *por construcción*: todo va dentro de `@media (max-width: 820px)` |
| El reparto de alturas | ✏️ calculado, no visto |
| **En un teléfono de verdad** | ❌ **no** |

Lo último no es un descuido: no hay forma de mirarlo desde aquí. El servidor de
desarrollo está escuchando en la LAN (§6.7), así que la comprobación es abrir
`http://192.168.0.62:5173` en el móvil y mirar cuatro cosas —que la barra no pase
de tres filas, que al tocar una clase el panel ocupe la mitad de abajo y no más,
que al tocar el fondo se vaya, y que el pellizco amplíe—. Ninguna prueba
automática de este repositorio cubre CSS.

## 6.9 La app Flutter

### Qué es, y por qué es eso

`mobile/` es una **carcasa nativa alrededor de la web**, no una reescritura.

La razón está en dónde vive el riesgo. La colaboración va por el protocolo
binario de `y-websocket` —reimplementado en `shared/src/crdt/wire.ts` sobre
`lib0` y `y-protocols`— y el trabajo sin conexión por `y-indexeddb`. Portar Yjs a
Dart significaría apostar la pieza más delicada del proyecto a `y_crdt`, que está
incompleto y sin mantenimiento. Y el modo de fallo de un port de CRDT no es una
excepción que salte: es un documento que deja de sincronizar **en silencio**,
que es la peor clase de error posible en una defensa. Dentro del WebView, en
cambio, el editor, el CRDT y el offline son exactamente el código que ya tiene
las 539 pruebas detrás.

Lo nativo aporta lo que la página no puede hacer sola dentro de un WebView: el
selector de ficheros de la cámara (`setOnShowFileSelector`) y la concesión de
permisos del sistema (`setOnPlatformPermissionRequest`). Sin esas dos piezas el
botón «🖼 Desde imagen» —la función estrella— está muerto en el móvil, y sin
ningún mensaje de error.

La decisión es **reversible**: el proyecto Flutter, la URL base configurable, el
`network_security_config.xml` y el flujo de `adb reverse` sirven igual si algún
día se va a nativo.

### Cómo se lanza

```powershell
npm run build                      # el backend sirve el frontend ya construido
npm start                          # backend en el 3001
cd mobile
.\compilar.ps1                     # instala y arranca en el móvil conectado
```

`compilar.ps1` no es azúcar: prepara el entorno que esta máquina necesita (ver
más abajo), hace el `adb reverse` y llama a `flutter`. Para otra cosa se le pasan
los argumentos tal cual: `.\compilar.ps1 build apk --debug`.

Que la URL por defecto sea `http://localhost:3001` no es casual. Con
`adb reverse tcp:3001 tcp:3001` el teléfono se pide a sí mismo y el túnel USB lo
lleva al portátil; y como **`localhost` es origen seguro para el navegador**,
dentro del WebView siguen permitidos la cámara y el micrófono. Sobre
`http://192.168.x.x` estarían bloqueados por no ser HTTPS. Para apuntar a otro
sitio —AWS, el día que toque— se compila con
`--dart-define=APP_URL=https://…`, que es la pieza descrita en §6.7.

### El fallo que costó toda la tarde y no era del proyecto

El APK no compilaba. Gradle decía:

```
java.io.IOException: Unable to establish loopback connection
```

Ese mensaje manda a buscar un problema de red que **no existe**: el TCP contra
`127.0.0.1` funciona perfectamente en esta máquina. La causa real está tres capas
más abajo. `Selector.open()` —lo que Gradle usa para que su cliente y su demonio
se hablen— crea por dentro un socket de dominio Unix (AF_UNIX) en el directorio
temporal, y aquí esa llamada falla con `SocketException: Invalid argument`
siempre que el directorio cuelga de `AppData\Local`, que es justo donde apunta
`%TEMP%`.

Lo que descarta cada sospechoso habitual:

| Sospechoso | Descartado porque |
|---|---|
| El proyecto | falla igual en un `gradlew help` vacío |
| El JDK | falla en Temurin 17 **y** en el JBR 21 |
| IPv6 | `-Djava.net.preferIPv4Stack=true` no cambia nada |
| El catálogo Winsock | limpio, solo entradas de Microsoft; `AF_UNIX` presente |
| El driver `afunix.sys` | instalado y en estado *RUNNING* |
| Protección de Carpetas | apagada |
| El nombre corto `ALEXAN~1` | falla igual con la ruta larga |
| Un antivirus intermitente | es determinista: **0/20** dentro, **20/20** fuera |

Lo que sí lo arregla es sacar el temporal de `AppData\Local`:

```powershell
$env:TEMP = 'C:\gradle-tmp'; $env:TMP = 'C:\gradle-tmp'
```

Dos detalles que costaron intentos fallidos y conviene no repetir:

- **`-Djava.io.tmpdir` no sirve.** El JDK lee el temporal para AF_UNIX del
  entorno, no de esa propiedad. Hay que mover `TEMP` y `TMP`.
- **Ponerlo en `org.gradle.jvmargs` tampoco sirve.** Gradle separa las `-D` que
  no conoce y las aplica *dentro* del demonio ya arrancado — demasiado tarde,
  porque el socket se crea antes. Se intentó y se retiró: `gradle.properties`
  está como lo generó Flutter, a propósito.

El síntoma intermedio, cuando solo el cliente tenía el arreglo, era
`Could not receive a message from the daemon`. Es la misma avería vista desde el
otro lado.

Esto es **una avería de esta máquina, no del repositorio**. En otro equipo o en
la nube `compilar.ps1` sobra. Merece la pena arreglarlo de raíz —algo filtra
`AppData\Local`— porque va a morder otra vez: cualquier `Selector` de Java pasa
por ahí, y eso incluye el Tomcat del Spring Boot que genera esta herramienta.

### Qué está verificado y qué no

| | |
|---|---|
| `flutter analyze` sin avisos | ✅ |
| 12 pruebas de Dart en verde (`explicarFallo` y el puente de voz) | ✅ |
| `flutter build apk --debug` compila (139 MB) | ✅ |
| `compilar.ps1` | ✏️ sintaxis validada; sus órdenes, ejecutadas una a una |
| **Instalada y abierta en un teléfono** | ✅ `AN8JVB5B28000440`, por cable |
| **Que el WebView cargue y sincronice** | ✅ diagrama importado y «En directo» |
| **Cámara, permisos y «Desde imagen» en el móvil** | ❌ **no** |
| **Voz por el puente nativo en el teléfono** | ❌ **no** |

Que compile dice que el código es válido; **no** dice que la app funcione. Las
dos filas rojas siguen necesitando que alguien lo pruebe con el teléfono
delante.

### La voz dentro del WebView: por qué hizo falta un puente

El WebView de Android **no implementa la Web Speech API**. Chrome en Android sí;
el WebView, que es otro componente, no —y no por ser una versión vieja: comparte
motor de render y deja fuera esta API a propósito—. Ni `SpeechRecognition` ni
`speechSynthesis` existen en `window`.

Eso no dejaba una excepción ni una pantalla en blanco, que habría sido más fácil
de diagnosticar. Dejaba **una función que desaparecía sin decir nada**: el botón
del micrófono deshabilitado y el de «🔊 Escuchar» de la guía sin dibujarse
siquiera, porque estaba detrás de un `'speechSynthesis' in window`. Desde fuera
era indistinguible de algo que nadie había programado.

La salida es un puente nativo, y está hecho:

- **Dart**: [`mobile/lib/voz_nativa.dart`](../mobile/lib/voz_nativa.dart)
  registra el canal `VozNativa` con `speech_to_text` y `flutter_tts` detrás, y
  contesta llamando a `window.__vozNativa(...)` con `runJavaScript`.
- **Web**: [`frontend/src/services/voz.ts`](../frontend/src/services/voz.ts)
  prefiere el puente cuando existe y cae en la API del navegador cuando no. La
  elección es automática: dentro de la app lo nativo es lo único que funciona;
  en un navegador el puente no existe y no hay nada que elegir.

El canal se registra **antes** de `loadRequest`, así que `window.VozNativa` ya
existe en el primer render y el frontend no necesita un saludo asíncrono para
saber si hay voz. A cambio, que el puente exista no garantiza que el micrófono
funcione: eso se sabe al usarlo, y por eso los errores llegan con el motivo que
da el sistema en vez de con un «no disponible» genérico.

Dos detalles que se arreglaron de paso:

- El `title` decía «Prueba con Chrome o Edge», consejo imposible de seguir
  dentro de una app de la que no se puede salir a otro navegador. Ahora
  `motivoSinVoz()` distingue el WebView del navegador, porque las salidas son
  distintas —actualizar la app frente a instalar otro navegador—.
- El botón «🔊 Escuchar» se dibuja siempre que haya respuesta. Si no puede leer,
  lo dice por escrito y no en un `title`: esto se lee sobre todo en el móvil,
  donde no hay puntero que pueda posarse encima.

Una asimetría que conviene no perder de vista al prometer «voz sin internet»:
la síntesis ocurre en el aparato, mientras que el dictado **de Chrome** manda el
audio a Google. En el navegador la frase es cierta para una mitad y falsa para
la otra.

Dentro de la app no, y por eso se hizo el puente: se pide reconocimiento en el
aparato (`SpeechListenOptions.onDevice`), así que el audio no sale del teléfono
si tiene el español descargado. Si no lo tiene, se dice —con la ruta de ajustes
donde se instala— en vez de salir a internet sin avisar. El detalle está en
[§5.3 de la guía](05-guia-voz-y-ocr.md).

No se reintenta solo con la red cuando falla el reconocimiento local, y es
deliberado: el reintento tendría que tragarse el «fin» del intento fallido para
que la web no apagase el micrófono a mitad, y ese «fin» llega por otro camino
sin orden garantizado. Acertar a veces dejaría el punto rojo encendido
escuchando a nadie. Un toque más, una vez por teléfono, sale más barato.
