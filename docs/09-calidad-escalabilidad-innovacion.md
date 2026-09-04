# 9. Calidad, escalabilidad e innovación

Los tres criterios con los que se evalúa el trabajo. Este documento no los declara: los **localiza**. Cada afirmación viene con el fichero donde está el código y, cuando existe, con la prueba que falla si alguien lo rompe.

Está escrito así porque una defensa no se gana diciendo «el sistema es escalable». Se gana enseñando dónde, y —esto importa más— sabiendo decir dónde no lo es todavía. Un tribunal encuentra los huecos; conviene llegar habiéndolos encontrado antes.

## 9.1 Cómo leer las tablas

Cada fila lleva un estado, y los tres significan cosas distintas:

| Estado | Qué quiere decir |
|---|---|
| **Verificado** | Hay una prueba automática que falla si eso deja de ser cierto. Se puede enseñar rompiéndolo a propósito. |
| **Implementado** | El código está y funciona a mano, pero nada lo vigila. Si alguien lo rompe, se descubre usándolo. |
| **Pendiente** | Está escrito en los requisitos y no está en el código. Aparece aquí para que no lo encuentre otro. |

El estado del proyecto hoy, en un número: **630 pruebas en 28 ficheros**, todas en verde (`npm test`), y `npm run typecheck` limpio en los cuatro paquetes.

---

## 9.2 Calidad

### 9.2.1 Que el error no llegue a la ejecución

| Qué | Dónde | Estado |
|---|---|---|
| TypeScript en modo `strict` en los cuatro paquetes, sin `any` implícito (RNF-MAN-03). | `tsconfig.base.json` y los cuatro `tsconfig.json` | Verificado (`npm run typecheck`) |
| El modelo UML se define **una sola vez** y lo consumen frontend, backend y generador (RNF-MAN-04). | `shared/src/model/uml.ts` | Verificado |
| Todo cuerpo que entra por HTTP se valida con un esquema Zod antes de tocar nada. | `backend-tool/src/api/http.ts` → `parseBody` | Verificado |
| Ninguna salida de un modelo de IA modifica el diagrama sin pasar antes por la gramática y el esquema (RNF-IA-06). | `shared/src/ai/grammar.ts` | Verificado |

### 9.2.2 Que las pruebas prueben algo

Esto es lo que separa 630 pruebas de 630 líneas de decorado.

- **Control negativo.** `shared/src/xmi/casos-de-uso.test.ts` no se limita a comprobar que el catálogo válido pasa la revisión: rompe un caso a propósito en tres familias distintas —un paquete inexistente, un paso sin forma de llamada, una actividad sin nodo de inicio— y exige las tres quejas concretas. Sin eso, un validador que devolviera siempre «todo bien» aprobaría el examen, y su síntoma sería el éxito.
- **El servicio entero, no un doble.** `backend-tool/src/api.test.ts` levanta la aplicación real sobre un directorio temporal. Lo que hay que comprobar es que las comprobaciones de permiso están *conectadas*, y eso es justo lo que un doble de prueba oculta.
- **Ida y vuelta.** Los catorce ficheros `.xmi` generados se vuelven a leer con nuestro propio importador y se comprueba que llega cada clase, cada operación y cada mensaje numerado (`shared/src/xmi/casos-de-uso.test.ts`).
- **Contenido, no instantánea.** El documento de casos de uso se comprueba mirando que contenga cada paso y cada precondición, no comparándolo con una copia guardada. Una instantánea de mil líneas se actualiza a ciegas con `-u` y deja de comprobar nada.

### 9.2.3 Seguridad

| Requisito | Qué hace | Estado |
|---|---|---|
| RNF-SEG-02 | El permiso se comprueba **en cada mensaje** del canal colaborativo, no solo al conectar. | Verificado (`collab.test.ts`) |
| RNF-SEG-06 | Todo identificador que viene de un diagrama es entrada no confiable: se valida contra lista blanca antes de llegar a una plantilla, un nombre de fichero o SQL. Nunca se «limpia» quitando caracteres. | Verificado (`generator`, `naming.test.ts`) |
| RNF-SEG-07 | Política de contenido restrictiva, sin `unsafe-eval` ni scripts en línea. | Verificado (`api/proteccion.test.ts`) |
| RNF-SEG-08 | Límite de tasa en asistente, generación e importación desde imagen. | Verificado (`api/proteccion.test.ts`) |
| RNF-SEG-10 | La recuperación de cuenta no depende del correo y sus tres fracasos son indistinguibles. | Verificado (`api.test.ts`) |
| RNF-SEG-11 | Cambiar la contraseña invalida todos los tokens anteriores. | Verificado (`api.test.ts`) |
| RNF-SEG-01 | TLS 1.3 y `wss://`. | Pendiente: depende del despliegue, hoy se corre en claro contra localhost |
| RNF-SEG-09 | Cifrado en reposo de los diagramas. | Pendiente |

Las dos últimas incorporaciones —cabeceras y límite de tasa— viven en `backend-tool/src/api/proteccion.ts`, y merecen dos notas porque son decisiones y no automatismos:

- **El límite se monta por camino, no envolviendo el router.** `use(middleware, router)` se ejecuta en toda petición que entre en `/api/proyectos`, así que abrir un diagrama habría gastado cuota de generación: el usuario se quedaría sin poder generar por haber trabajado. Hay una prueba dedicada a esto.
- **HSTS solo se envía si ya se está en HTTPS.** Mandarlo desde `http://localhost` deja el navegador obligado a usar HTTPS contra localhost durante un año, y eso rompe justamente la defensa, que corre en claro.

### 9.2.4 Lo que falta

| Hueco | Consecuencia | Coste de cerrarlo |
|---|---|---|
| No hay `eslint.config.*` ni la dependencia instalada: `npm run lint` falla de entrada (RNF-MAN-05). | La integración continua no puede ejecutar el paso de lint que el documento 1 exige. | Un `npm install -D eslint typescript-eslint` y un fichero de configuración. |
| No hay pruebas de componente del frontend: falta `jsdom` (tarea #15). | Lo que se prueba del frontend es la lógica extraída (`geometria-lienzo`, `useDispositivo`, `ollama`); los componentes no. | Una instalación de dependencias. |
| El proyecto Spring Boot generado **nunca se ha compilado** (RNF-MAN-02: no hay Maven en la máquina). | Se genera código que se ve correcto y nadie ha visto arrancar. Es el hueco de calidad más serio del proyecto. | Instalar Maven y ejecutar `mvn test` sobre un proyecto generado. |
| La imagen Docker nunca se ha construido. | El despliegue documentado no está probado. | Instalar Docker y `docker build`. |

---

## 9.3 Escalabilidad

### 9.3.1 Lo que ya escala, y por qué

**La convergencia no la hace el servidor.** El documento es un CRDT (Yjs): dos réplicas que han recibido las mismas operaciones son idénticas, sin que nadie arbitre. El servidor es un participante más que además tiene disco (`backend-tool/src/collab/rooms.ts:31`). De ahí salen tres propiedades que no habría con un servidor autoritativo:

- editar sin conexión es el caso normal, no un modo degradado;
- reconectar no exige resolver conflictos a mano;
- añadir clientes a una sala no añade trabajo de arbitraje al servidor, solo retransmisión.

**Se guarda el estado, no el registro de operaciones.** Yjs comprime el historial al codificar el estado, así que un documento con miles de ediciones ocupa lo que ocupa su contenido y no su historia (`rooms.ts`, comentario de cabecera). Un diagrama muy editado no crece sin límite.

**Las tres puertas de almacenamiento están abiertas.** `DocumentStore` (`storage/documents.ts:18`), `ProjectStore` (`storage/store.ts:33`) e `IdentityProvider` (`auth/identity.ts:46`) son interfaces con dos implementaciones cada una: fichero y PostgreSQL. La elección la decide **una sola variable**, `DATABASE_URL`, y se hace para las tres a la vez (`app.ts`, `createDependencies`). Media aplicación en base de datos y media en disco significaría permisos que sobreviven al despliegue apuntando a usuarios que no: nadie podría entrar en su propio proyecto.

Esto es lo que convierte «desplegar en la nube» en un cambio de configuración. El disco de App Runner y el de ECS son efímeros: sin esa costura, cada despliegue borraría los diagramas.

**El traslado a PostgreSQL es idempotente.** `storage/migracion.ts` inserta con `on conflict do nothing` y conserva identificadores, sales y hashes: ejecutarlo dos veces no duplica ni pisa nada.

| Qué | Dónde | Estado |
|---|---|---|
| Convergencia de réplicas (RNF-OFF-06). | `shared/src/crdt/` | Verificado (`crdt.test.ts`) |
| Una sala por proyecto, con persistencia agrupada por intervalo. | `collab/rooms.ts` | Verificado (`collab.test.ts`) |
| Dos implementaciones intercambiables de cada almacén. | `storage/` | Verificado (`postgres.test.ts`, `documents.test.ts`) |
| Traslado de fichero a PostgreSQL, repetible. | `storage/migracion.ts` | Verificado (`migracion.test.ts`) |
| El frontend construido se sirve desde el propio servicio, mismo origen. | `app.ts` → `servirFrontend` | Verificado (`frontend-estatico.test.ts`) |
| Imagen Docker y despliegue en App Runner / ECS. | `Dockerfile`, documento 6 | Implementado, nunca ejecutado |

### 9.3.2 El techo, dicho claro

Tres límites reales. Ninguno impide la defensa; los tres se preguntan en una defensa.

1. **RNF-ESC-03 no se cumple hoy.** El requisito dice que el estado de sala no reside en la memoria de un único proceso. Reside: `Room` tiene su `Y.Doc` vivo en el proceso (`collab/rooms.ts:32`). Con dos instancias detrás de un balanceador, dos usuarios del mismo proyecto en instancias distintas no se verían hasta que ambas guardasen. **La salida corta** es sesiones pegajosas por sala —el balanceador manda cada proyecto siempre a la misma instancia—, y la larga es un relevo de mensajes por Redis. Lo mismo vale para el límite de tasa, que hoy cuenta en memoria del proceso y está comentado en su propio fichero.
2. **Un diagrama por proyecto, sin paquetes ni carpetas.** `ClassDiagramSchema` (`shared/src/model/uml.ts:136-142`) es `{ id, name, classes, relations, meta }`. No es una limitación de la interfaz: cambiarla toca el CRDT, el protocolo de colaboración, el almacenamiento, el generador y el XMI. Es el techo de crecimiento del modelo y conviene decirlo antes de que lo pregunten.
3. **No hay métricas ni trazas (RNF-ESC-06).** Hay `GET /salud` con salas abiertas y conexiones, y nada más. Diagnosticar un fallo de sincronización concreto hoy es leer el registro.

Y una nota sobre los números del documento 1: RNF-ESC-01 (≥ 200 salas por instancia) y RNF-ESC-02 (≥ 10 participantes por sala) son **objetivos de diseño no medidos**. No hay prueba de carga. Decir «soporta 200 salas» sin haberlo medido es exactamente el tipo de afirmación que este documento existe para no hacer.

---

## 9.4 Innovación

No es innovación por ser llamativo, sino por resolver algo que las herramientas del gremio no resuelven. Cada punto lleva **qué hace** y **contra qué se compara**.

### 9.4.1 Editar el diagrama hablando, sin internet

Se dicta «crea la clase Factura con total decimal» y la clase aparece. Lo que lo hace distinto de un botón de dictado:

- El texto reconocido no se aplica: se traduce a operaciones del modelo y se **valida contra la gramática y el esquema** antes de tocar nada (`shared/src/ai/grammar.ts`). Una orden que el modelo entienda mal produce un rechazo, no un diagrama roto.
- Las acciones destructivas piden confirmación explícita.
- Funciona **con el modelo local**, contra Ollama en la máquina del usuario (`frontend/src/services/ollama.ts:35`). En un aula sin internet sigue funcionando; en la nube, el mismo camino usa DeepSeek. La política de contenido del servicio deja abierta esa conexión a propósito (`api/proteccion.ts`), que es un detalle pequeño y la diferencia entre que funcione y que no.

### 9.4.2 Importar un diagrama desde una fotografía de la pizarra

Se fotografía la pizarra y salen clases, atributos y relaciones. Lo que importa del diseño: **nada se aplica sin revisión**. El modelo propone, marca lo que ha leído con poca confianza, y el editor confirma o descarta (CU9, documento 8). Una lectura automática que escribiera directamente en el diagrama sería más vistosa en la demostración y peor herramienta: el error de OCR entraría sin que nadie lo viese.

### 9.4.3 Puente nativo de voz entre Flutter y la web

La aplicación de Android no es una ventana con la web dentro: el micrófono y el altavoz son nativos y hablan con la página por un puente (`mobile/`, tarea #46). El reconocimiento de voz del WebView de Android es limitado; el del sistema no lo es.

### 9.4.4 La guía responde sobre el propio proyecto

El botón «? Ayuda» busca dentro de `docs/*.md` y contesta citando su fuente, con o sin conexión (`shared/src/guia/`, `backend-tool/src/ai/guia.ts`). El corpus se indexa solo: un documento nuevo en `docs/` —este mismo, sin ir más lejos— entra en la guía sin registrar nada.

### 9.4.5 Los diagramas UML se generan, no se dibujan

Esto es lo más difícil de replicar y lo que menos se ve. Los catorce casos de uso están descritos **una sola vez** en `shared/src/xmi/casos-de-uso.ts`, y de esa descripción salen el diagrama de comunicación, el documento 8 y —cuando estén los ficheros de muestra— los de secuencia, actividad y análisis de clases. Cambiar un paso y ejecutar una orden los deja todos al día:

```
npm run diagramas --workspace @app/backend-tool
```

Dos consecuencias que se pueden enseñar:

- **No pueden contradecirse.** Mantener a mano cuatro diagramas y un documento son cinco copias de una verdad, y la que se queda vieja es siempre el documento, porque los diagramas se miran en la defensa y el documento no.
- **El fichero se abre en Enterprise Architect y aparece dibujado**, no como una lista de elementos en el árbol del proyecto. Eso exige escribir el bloque `<xmi:Extension>` que ninguna especificación documenta. De hecho el emisor escribe **las dos formas** —el `uml:Message` estándar y el conector de extensión de EA—, y EA no emite la primera: el fichero generado es más completo que el que exporta la propia herramienta.

### 9.4.6 Lo que falta para poder presumir de esto

| Hueco | Estado |
|---|---|
| Precisión del OCR sobre pizarra (RNF-IA-03: ≥ 85 %, RNF-IA-04: ≥ 90 %) no medida: falta el corpus de fotografías (pregunta abierta Q8). | Pendiente |
| Dictado sin conexión verificado en un teléfono real, en modo avión (tarea #47). | Pendiente |
| Emisores de los otros cuatro diagramas: bloqueados hasta tener cuatro `.xmi` de muestra exportados desde EA (tarea #55). | Bloqueado |

---

## 9.5 Qué cerrar primero

Ordenado por lo que cuesta, no por lo que luce:

1. **Arreglar el `.env`** — `LLM_VISION_MODEL` apuntaba a un modelo que no existe y la importación desde foto devolvía 404. Ya corregido a `gemini-2.0-flash`. *(Hecho.)*
2. **Rotar las dos claves quemadas** (tarea #48). Aparecieron en una conversación y en una captura. Una clave expuesta no se arregla borrándola del fichero: se rota.
3. **Instalar Maven y compilar un proyecto generado.** Convierte el hueco de calidad más serio en una prueba.
4. **`npm install -D eslint typescript-eslint`** y un `eslint.config.js`. Desbloquea RNF-MAN-05.
5. **`npm install -D jsdom @testing-library/react`.** Desbloquea la tarea #15.
6. **Construir la imagen Docker y desplegar en AWS.** Convierte el documento 6 en un hecho.
7. **Sesiones pegajosas por sala** en el balanceador. Es la forma barata de cumplir RNF-ESC-03 sin montar Redis.

## 9.6 Cómo enseñarlo en la defensa

Cinco minutos, en este orden, porque cada paso apoya al siguiente:

1. `npm test` — 630 pruebas en verde en trece segundos. **Calidad.**
2. Abrir el mismo proyecto en dos navegadores, editar en uno y ver el cambio en el otro; cortar la red a uno, seguir editando, y reconectar. **Escalabilidad**, y la afirmación de que el servidor no arbitra deja de ser una frase.
3. Dictar una orden con Ollama y el equipo en modo avión. **Innovación**, y la que menos se espera.
4. Fotografiar un diagrama de la pizarra, enseñar la pantalla de revisión y **descartar** la propuesta. Enseñar que se puede rechazar vale más que enseñar que acierta.
5. `npm run diagramas` y abrir un `.xmi` recién generado en Enterprise Architect, dibujado.

Y si preguntan por los límites —que es lo que suelen preguntar—: sección 9.3.2, dicha de memoria. Saber dónde no llega el sistema propio es parte del criterio de calidad, no una concesión.
