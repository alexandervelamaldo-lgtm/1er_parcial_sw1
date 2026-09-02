# 3. Stack tecnológico

**Documento relacionado:** [02-arquitectura.md](02-arquitectura.md)

Cada elección incluye su justificación y lo que se descartó. Una elección sin alternativa descartada normalmente significa que no se evaluó.

---

## 3.1 Resumen

| Capa | Tecnología | Versión objetivo |
|---|---|---|
| UI | React + TypeScript | React 18+, TS 5.x `strict` |
| Build | Vite | 5.x |
| PWA | Workbox + Vite PWA | — |
| Lienzo | Canvas 2D con abstracción de escena | — |
| Estado colaborativo | CRDT (Yjs) | 13.x |
| Persistencia local | IndexedDB vía `y-indexeddb` + Dexie | — |
| Transporte | WebSocket (`y-websocket`) | — |
| IA en navegador | ONNX Runtime Web · TensorFlow.js | — |
| Backend | Node.js + Express + TypeScript | Node 20 LTS |
| Base de datos | PostgreSQL | 16 |
| Plantillas del generador | Handlebars | 4.x |
| Salida generada | Spring Boot + PostgreSQL | Por confirmar (Q5) |
| Monorepo | pnpm workspaces | — |

---

## 3.2 Frontend

### React + Vite + TypeScript

Fijado por el enunciado. Notas de aplicación:

- **TypeScript en modo `strict`** y sin `any` implícito (RNF-MAN-03). En un proyecto donde el modelo de dominio se comparte entre tres paquetes, el tipado laxo se paga en el generador, que es donde un error produce código que no compila.
- **Vite** aporta arranque rápido y un buen soporte de Web Workers y WASM, ambos necesarios aquí (visión y ONNX). Su división de código por importación dinámica es lo que permite cumplir RNF-IA-02: los modelos no entran en el bundle inicial.

### Estado de la interfaz

| Tipo de estado | Herramienta |
|---|---|
| Modelo del diagrama | Documento Yjs (**no** un gestor de estado de React) |
| Estado de servidor (proyectos, usuarios) | TanStack Query |
| Estado de UI local (zoom, paneles) | Zustand |

**El error a evitar:** duplicar el modelo del diagrama en Redux o Zustand y sincronizarlo con el CRDT. Se acaba con dos fuentes de verdad que divergen. React se suscribe a Yjs y se redibuja; el CRDT es el estado.

### Lienzo: Canvas sobre SVG

| Opción | Veredicto |
|---|---|
| SVG con nodos DOM | Descartada. 300 clases con atributos y métodos superan los 10 000 nodos; el navegador no sostiene 50 fps (RNF-REND-04/05). |
| **Canvas 2D** | **Elegida.** Rendimiento suficiente para el objetivo, control total del dibujo, complejidad manejable. |
| WebGL | Reserva. Solo si el perfilado demuestra que Canvas 2D no llega. Coste de desarrollo notablemente mayor. |

Bibliotecas candidatas para no partir de cero: **Konva** (escena sobre Canvas, buen equilibrio) o **PixiJS** (WebGL, mayor potencia y mayor coste). Recomendación: empezar con Konva y medir contra RNF-REND-04 en el sprint 1 con un diagrama sintético de 300 clases. Es una medición barata que evita una reescritura cara.

> **Descartadas explícitamente:** React Flow y similares. Están orientadas a grafos de nodos genéricos, y la semántica UML (compartimentos de atributos y métodos, decoradores de extremo de relación, multiplicidades, enrutado ortogonal) obliga a luchar contra la biblioteca. Ver el análisis en la matriz de decisiones.

### PWA

- **Vite PWA + Workbox** para el precacheo del App Shell y las estrategias de la sección [2.5.3](02-arquitectura.md#253-estrategia-de-caché-del-service-worker).
- Service Worker escrito a mano para el Background Sync (RF-OFF-09); la generación automática no cubre bien las colas personalizadas.
- Caché aparte para los modelos de IA, con política de expulsión propia, para que un modelo de 40 MB no desaloje el App Shell.

---

## 3.3 Sincronización y colaboración

### Yjs como CRDT

Decisión central del proyecto (D1, D2 en [2.11](02-arquitectura.md#211-decisiones-registradas)).

| Candidato | Valoración |
|---|---|
| **Yjs** | **Elegido.** Maduro, rápido, con `y-indexeddb` y `y-websocket` ya resueltos. El canal de *awareness* cubre la presencia (RF-COL-02) sin código propio. El deshacer por origen resuelve RF-DIAG-08 (deshacer solo lo propio), que es sorprendentemente difícil de implementar a mano. |
| Automerge | Alternativa seria. API agradable y buen modelo de historial, pero mayor consumo de memoria y ecosistema de proveedores de red menos rodado. |
| Loro | Prometedor y con buen rendimiento, pero más joven. No para una decisión estructural. |
| Implementación propia | Descartada. Ver D2: los errores de convergencia se manifiestan tarde y son casi irreproducibles. |

**Correspondencia con el modelo:**

| Concepto | Tipo Yjs |
|---|---|
| `classes`, `relations` | `Y.Map` indexado por identificador |
| Propiedades de una clase | `Y.Map` |
| `attributes`, `methods` (orden significativo) | `Y.Array` |
| Nombre de clase, de atributo | `Y.Text` si se quiere edición concurrente carácter a carácter; en caso contrario, campo de `Y.Map` |
| Cursor, selección, usuario | Awareness (efímero, fuera del documento) |

Detalle no obvio: usar `Y.Text` en los nombres permite que dos personas editen el mismo nombre a la vez sin pisarse. Con un campo simple, gana el último. Merece la pena en el nombre de clase, no en cada propiedad booleana.

### Transporte

`y-websocket` sobre `wss://`. La autorización se verifica **en cada mensaje**, no solo en el apretón de manos (RNF-SEG-02): un cliente que pierde el rol de editor a mitad de sesión debe dejar de poder escribir.

Para la afinidad de sala (sección [2.5.5](02-arquitectura.md#255-escalado-del-servidor-de-colaboración)), encaminamiento consistente por identificador de sala en el balanceador.

### Persistencia local

- **`y-indexeddb`** para la persistencia incremental del documento. Resuelve RF-OFF-04 y RNF-OFF-03 sin código propio.
- **Dexie** para lo que no es CRDT: catálogo de diagramas, metadatos, cola de peticiones diferidas. La API de IndexedDB en crudo es innecesariamente áspera.

---

## 3.4 Backend

### Node.js + Express + TypeScript

Fijado por el enunciado. Consideraciones:

- **Node 20 LTS.**
- Express cubre bien la parte REST. Para el servidor WebSocket se usa `ws` directamente junto al servidor HTTP; no hace falta Socket.IO, porque `y-websocket` ya aporta su propio protocolo y las capas de reconexión se solaparían.
- **Zod** para validar en el borde de la API, derivando los tipos de los esquemas compartidos en `shared/`. Una sola definición sirve para validar en ejecución y para tipar en compilación.

### PostgreSQL 16

| Uso | Detalle |
|---|---|
| Metadatos | Usuarios, proyectos, miembros, permisos, auditoría |
| Instantáneas de documentos | Estado Yjs serializado como `BYTEA`, para RNF-ESC-05 |
| Historial de versiones | Instantáneas etiquetadas para RF-COL-07 |

**ORM:** Prisma o Drizzle. Recomendación: **Drizzle**, por su cercanía a SQL y su menor peso en tiempo de ejecución. Prisma es válido si el equipo ya lo conoce; la diferencia no es estructural.

**Nota:** el PostgreSQL de la herramienta y el PostgreSQL del backend generado son cosas distintas. El generado lo levanta el usuario final con su `docker-compose.yml` (RF-GEN-15).

### Almacenamiento de artefactos

Los ZIP generados no van a la base de datos. Almacenamiento de objetos compatible con S3 (o disco con limpieza programada en despliegues pequeños), con enlaces de descarga temporales y caducidad de 24 h.

---

## 3.5 Inteligencia artificial

Esta es la parte del stack con más incertidumbre. Las cifras de tamaño son órdenes de magnitud para planificar, no compromisos.

### Presupuesto (RNF-IA-01: 150 MB)

| Componente | Modelo previsto | Tamaño aproximado |
|---|---|---|
| Detección de estructura | ONNX propio o adaptado, cuantizado | 10–25 MB |
| OCR | PaddleOCR o TrOCR en ONNX, cuantizado | 15–40 MB |
| Transcripción de voz (alternativa local) | Whisper `tiny` cuantizado | 40–75 MB |
| Interpretación de lenguaje (sin conexión) | Gramática de comandos, sin modelo | ~0 MB |

Todos se descargan **bajo demanda**, con progreso visible y cancelable (RNF-IA-02), y se cachean aparte del App Shell.

### Runtime: ONNX Runtime Web como principal

| Opción | Papel |
|---|---|
| **ONNX Runtime Web** | Principal. Backend WASM con SIMD y multihilo; WebGPU cuando el navegador lo permite. Formato ONNX: la mayoría de modelos de visión y OCR se exportan a él. |
| **TensorFlow.js** | Complementario. Útil si se adopta un modelo ya publicado en su formato o para preproceso de imagen. |
| Transformers.js | Vía práctica para Whisper y modelos de tipo *transformer* en el navegador; envuelve ONNX Runtime. |

Ambos se mencionan en el enunciado y ambos tienen sitio, pero la elección por defecto es ONNX Runtime Web; TensorFlow.js entra solo si un modelo concreto lo justifica. Tener dos runtimes cargados a la vez duplica el peso en WASM y debe evitarse.

### Voz (RF-IA-02)

Dos escalones, en este orden:

1. **Web Speech API** cuando está disponible. Coste cero de descarga y buena calidad.
   **Advertencia importante:** en la mayoría de navegadores implica enviar el audio a un servicio remoto y **no funciona sin conexión**. Debe declararse al usuario (RNF-SEG-05 se refiere a las imágenes, pero el criterio de transparencia aplica igual).
2. **Whisper `tiny` local vía ONNX** cuando no hay red, cuando el navegador no soporta la API, o cuando el usuario exige privacidad.

Síntesis de voz (RF-IA-06) con `SpeechSynthesis`, disponible de forma nativa y sin descarga.

### Interpretación de lenguaje natural (RF-IA-01, RF-IA-03)

Arquitectura híbrida de la sección [2.8.2](02-arquitectura.md#282-asistente-conversacional).

- **Con conexión:** modelo de lenguaje invocado desde `backend-tool/src/ai/`, con salida forzada a un JSON de operaciones validado contra esquema. La clave no es el modelo concreto sino el contrato: nunca texto libre, siempre operaciones validables.
- **Sin conexión:** gramática de comandos sobre un conjunto acotado de intenciones, documentada y descubrible desde la propia interfaz.

**Por qué no un modelo de lenguaje local:** los modelos que caben en el presupuesto no interpretan lenguaje abierto con la fiabilidad que pide RNF-IA-05 (90 %). Prometerlo sería un compromiso que la arquitectura no puede sostener.

### La guía del manual: IA local, sin conexión y en el móvil, las tres a la vez

Se pidió una IA local que sirva de guía —«cómo funciona esto, cómo se hace
aquello»—, que funcione **con internet y sin internet**, que valga **por voz**, y
que la aplicación acabe corriendo **en el móvil**. Enunciadas juntas, esas cuatro
condiciones no se pueden cumplir con un modelo de lenguaje: no hay ninguno que
quepa en un teléfono, se descargue en un tiempo razonable y merezca llamarse
útil.

**La salida no fue renunciar a un requisito, sino degradar la *modalidad*.** La
pregunta no es «¿qué modelo cabe en todas partes?» sino «¿qué es lo mínimo que
tiene que pasar para que la pregunta quede contestada?». Y la respuesta es: que
el usuario acabe leyendo el trozo de manual que resuelve su duda. Redactarlo con
frases propias es un lujo, no el objetivo.

De ahí la observación que sostiene todo el diseño: **un sistema RAG ya trocea los
documentos y busca la sección pertinente antes de llamar al modelo, así que la
mitad de recuperación es por sí sola el camino sin conexión.** No hubo que
construir un modo *offline* aparte; había que dejar de tirar el resultado
intermedio que ya se estaba calculando.

| Dónde | Quién redacta | Necesita | Fiabilidad |
|---|---|---|---|
| Escritorio con Ollama (`llama3.2:3b`) | Modelo local | Nada de red | Paráfrasis; puede desviarse |
| Móvil, o escritorio sin Ollama | El servidor, con el mismo proveedor del asistente | Red y clave | Igual, y además cuesta dinero |
| Cualquier sitio, sin nada | La búsqueda léxica, en el navegador | Nada | **La mayor**: es prosa que alguien escribió a propósito |

Consecuencias que conviene tener presentes:

- **Ollama no cuenta contra RNF-IA-01.** No es un modelo que la PWA descargue: es
  un proceso externo que el usuario instala en su máquina, y la aplicación lo
  descubre preguntando a `localhost:11434` con 1,5 s de espera. El presupuesto de
  150 MB sigue intacto porque el navegador no descarga nada.
- **Esto no contradice el párrafo anterior.** Ahí se descarta un modelo local para
  *emitir operaciones* sobre el diagrama, donde un error escribe en el documento
  del usuario. Aquí el modelo solo redacta prosa que se lee; lo peor que puede
  hacer es explicar mal algo que además está citado justo debajo, íntegro.
- **La búsqueda es léxica (BM25), no vectorial**, y a propósito: un embedding
  exige otro modelo con red, que es justo lo que rompe el único caso para el que
  existe la función.
- **No se afina ningún modelo.** Un modelo afinado con el manual queda obsoleto en
  cuanto se edita un documento. RAG sobre `docs/*.md` se actualiza solo.
- **`docs/` pasó a ser dato de ejecución, no documentación.** Va empaquetado en el
  bundle del navegador (~190 kB) y copiado en la imagen Docker. La primera versión
  del `.dockerignore` lo excluía con el comentario «la documentación no se
  ejecuta», que dejó de ser cierto sin que nadie lo notara.
- **De «voz» solo la mitad funciona sin red.** `speechSynthesis` es del
  dispositivo; el dictado de Chrome manda el audio a Google. Se dice tal cual en
  la guía en vez de dejar que se suponga.

El detalle de uso está en [§5.7](05-guia-voz-y-ocr.md#57-la-guía-preguntar-cómo-se-hace-algo).

### Visión (RF-VIS)

- **OpenCV.js** para el preproceso: corrección de perspectiva, binarización adaptativa, detección de contornos. Pesa bastante (~8 MB en WASM); se carga solo al abrir la función de foto.
- Detección de cajas y líneas: primero con visión clásica (contornos y transformada de Hough). Solo si no alcanza los umbrales se pasa a un modelo aprendido. Empezar por el enfoque clásico es deliberado: es más rápido de validar y puede bastar para diagramas de pizarra bien dibujados.
- OCR por región recortada, nunca sobre la imagen completa.
- Todo dentro de `vision.worker.ts`.

> **Riesgo abierto Q8:** sin un corpus de fotografías reales, RNF-IA-03 y RNF-IA-04 no son verificables. Conseguirlo es una tarea del sprint 1.

---

## 3.6 Generador

- **Lenguaje:** TypeScript sobre Node, mismo runtime que `backend-tool`, y reutiliza los tipos de `shared/`. Evita una segunda cadena de herramientas en el monorepo.
- **Motor de plantillas: Handlebars.** Elegido *precisamente por su falta de lógica*: obliga a que las decisiones vivan en la IR (D4). EJS permite JavaScript incrustado, y en un generador eso termina en plantillas imposibles de probar.
- **Formateo del código generado:** invocar un formateador de Java sobre la salida. Genera código consistente y permite escribir plantillas legibles sin pelearse con la indentación.
- **Empaquetado:** `archiver` para el ZIP, con verificación de que toda ruta queda dentro del directorio de salida (RNF-SEG-06).
- **Salida:** Spring Boot con PostgreSQL, Flyway para migraciones, MapStruct o mapeadores manuales para DTOs, Bean Validation. Versiones exactas pendientes de Q5.

---

## 3.7 Monorepo y utillaje

```
proyecto-herramienta-colaborativa/
├── frontend/       @app/frontend
├── backend-tool/   @app/backend
├── generator/      @app/generator
└── shared/         @app/shared   ← tipos del modelo, esquemas Zod, utilidades
```

- **pnpm workspaces.** Más eficiente en disco que npm y con resolución estricta, que evita las dependencias fantasma. Turborepo es opcional; con cuatro paquetes aún no se justifica.
- **`shared/` es la fuente única de verdad** del modelo UML (RNF-MAN-04). Si el generador y el frontend definen sus propios tipos, divergen y el fallo aparece en el código generado.

| Herramienta | Uso |
|---|---|
| Vitest | Pruebas unitarias en frontend, backend y generador |
| Playwright | Extremo a extremo, incluidos escenarios sin conexión y multicliente |
| fast-check | Pruebas de propiedades para la convergencia CRDT (RNF-OFF-06) |
| ESLint + Prettier | Estilo y análisis estático |
| GitHub Actions | CI: lint, tipos, pruebas, compilación del corpus generado |
| Lighthouse CI | Verificación automática de RNF-REND-01/09 y de la instalabilidad PWA |

Dos comprobaciones de CI merecen mención porque no son habituales y aquí son críticas:

1. **Compilación del corpus** (RNF-MAN-02): generar los diagramas de referencia, compilarlos con Maven o Gradle y ejecutar sus pruebas. Sin esto, el generador se rompe en silencio.
2. **Convergencia por propiedades** (RNF-OFF-06): generar secuencias aleatorias de operaciones, aplicarlas en distinto orden a réplicas distintas y verificar que el estado final coincide.

---

## 3.8 Despliegue

Pendiente de Q6 (restricciones de infraestructura). Forma prevista:

| Componente | Requisito de la plataforma |
|---|---|
| Frontend | Alojamiento estático con CDN. Cabeceras de caché correctas para el Service Worker: **el `sw.js` nunca se cachea**. |
| backend-tool | Contenedor con soporte de WebSocket y conexiones persistentes. Descarta plataformas *serverless* de función efímera para `collab/`. |
| PostgreSQL | Servicio gestionado con copias de seguridad automáticas (RNF-ESC-05). |
| Artefactos | Almacenamiento de objetos con caducidad. |

El detalle del Service Worker no es menor: una cabecera de caché agresiva sobre `sw.js` deja a los usuarios atrapados en una versión antigua de la aplicación, y es un fallo difícil de diagnosticar porque solo afecta a quien ya la visitó.

---

## 3.9 Matriz de decisiones

| # | Decisión | Alternativas | Motivo |
|---|---|---|---|
| T1 | Yjs | Automerge, Loro, propio | Madurez, proveedores listos, awareness y deshacer por origen resueltos |
| T2 | Canvas (Konva) | SVG/DOM, WebGL | SVG no llega a RNF-REND-04; WebGL es coste prematuro |
| T3 | Biblioteca de lienzo genérica, no de grafos | React Flow | La semántica UML obliga a pelearse con abstracciones de nodo genérico |
| T4 | ONNX Runtime Web principal | TensorFlow.js principal | Mejor disponibilidad de modelos de visión y OCR en ONNX |
| T5 | Visión clásica antes que modelo aprendido | Modelo entrenado desde el inicio | Validable en días, no en semanas; puede bastar |
| T6 | Handlebars | EJS, Nunjucks | Ausencia de lógica: obliga a que las decisiones estén en la IR |
| T7 | Generador en TypeScript | Python, Java | Una sola cadena de herramientas; reutiliza `shared/` |
| T8 | `ws` en crudo | Socket.IO | `y-websocket` ya trae protocolo y reconexión; se solaparían |
| T9 | Drizzle | Prisma | Cercanía a SQL, menor peso en ejecución |
| T10 | pnpm workspaces | npm, Turborepo | Estricto y eficiente; Turborepo no se justifica con 4 paquetes |
| T11 | Voz: API del navegador con respaldo local | Solo Whisper local | 40–75 MB no se imponen a quien tiene conexión |
| T12 | Interpretación NL en servidor | Modelo local | Ningún modelo dentro del presupuesto alcanza RNF-IA-05 |
| T13 | Guía por RAG sobre `docs/` | Afinar un modelo con el manual | Un modelo afinado envejece con cada edición del manual; el RAG se actualiza solo |
| T14 | Búsqueda léxica (BM25) | Embeddings | Un embedding exige otro modelo **con red**, que es justo lo que rompe el modo sin conexión |
| T15 | Ollama externo, no un modelo en el bundle | Modelo en la PWA | 150 MB de presupuesto intactos; y el modelo local es opcional por definición |
| T16 | Sin conexión: buscar, no redactar | Prometer redacción sin red | La recuperación del RAG ya es una respuesta, y la más fiable de las tres |

---

## 3.10 Riesgos técnicos

| Riesgo | Señal temprana | Respuesta |
|---|---|---|
| Canvas 2D no alcanza 50 fps con 300 clases | Perfilado en el spike de S1 | Pasar a WebGL (PixiJS) antes de construir sobre la abstracción |
| OpenCV.js infla demasiado la carga | Medición del bundle en S1 | Carga diferida estricta; sustituir por operaciones propias en WASM |
| El OCR no alcanza el 90 % en pizarra real | Spike de S1 sobre corpus real | Degradar RF-VIS a asistente de transcripción con corrección manual |
| Yjs consume demasiada memoria en diagramas grandes | Prueba de carga con 300 clases | Compactar historial, instantáneas más frecuentes |
| La afinidad de sala complica el despliegue | Al configurar el balanceador | Pasar al bus de mensajes entre instancias (opción 2 de §2.5.5) |
| El coste del modelo de lenguaje en servidor se dispara | Métricas de uso de S4 | Caché de intenciones frecuentes, límite de tasa (RNF-SEG-08) |
| Divergencia de tipos entre paquetes | Errores de compilación en el generador | Prohibir la redefinición de tipos del modelo fuera de `shared/` |
| El manual crece y el bundle con él | Tamaño del build del frontend | Hoy son ~190 kB. Pasado cierto punto, cargar el índice bajo demanda y cachearlo en el *service worker* |
| La guía deja de encontrar nada tras desplegar | «Eso no lo cubre el manual» a **todo** en producción, y no en local | Ya cubierto: `backend-tool/src/ai/guia.test.ts` exige que un `docs/` ausente haga fallar el arranque en vez de servir un manual vacío |
| Safari bloquea la llamada a `localhost` desde una página HTTPS | El camino local no arranca solo en ese navegador | Se cae al servidor de forma automática; es el mismo camino que el móvil |
