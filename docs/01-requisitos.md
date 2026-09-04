# 1. Requisitos funcionales y no funcionales

**Proyecto:** Herramienta colaborativa de diseño UML con generación de backend Spring Boot
**Versión:** 0.1 (borrador de arquitectura)
**Estado:** en revisión

---

## 1.1 Alcance

Aplicación web progresiva (PWA) para diseñar diagramas de clases UML de forma colaborativa, asistida por un agente conversacional (voz y texto) y por reconocimiento de diagramas dibujados en pizarra a partir de una fotografía. A partir del diagrama validado, la herramienta genera un proyecto backend Spring Boot en 4 capas con persistencia PostgreSQL. El sistema opera sin conexión y reconcilia los cambios al recuperar la red.

### Fuera de alcance (v1)

- Diagramas UML distintos al de clases (secuencia, casos de uso, actividad).
- Generación de frontend a partir del diagrama.
- Despliegue automático del backend generado a un proveedor cloud.
- Edición colaborativa del código generado (el generador es unidireccional: diagrama → código).

---

## 1.2 Actores

| Actor | Descripción |
|---|---|
| **Diseñador** | Crea y edita diagramas. Actor principal. |
| **Colaborador** | Edita un diagrama compartido en tiempo real. Mismos permisos que diseñador dentro de la sala. |
| **Lector** | Acceso de solo lectura a un diagrama compartido. |
| **Propietario del proyecto** | Gestiona miembros, permisos y la exportación/generación. |
| **Architech Enterprise** | Sistema externo con el que se intercambian proyectos y/o modelos. Ver [RF-INT](#rf-int--integración-con-architech-enterprise). |

---

## 1.3 Requisitos funcionales

Cada requisito lleva un identificador estable para trazarlo en el plan de sprints y en las pruebas.
Prioridad: **M** (must, v1) · **S** (should, v1 si cabe) · **C** (could, post-v1).

### RF-DIAG — Edición de diagramas de clases

| ID | Requisito | Prio |
|---|---|---|
| RF-DIAG-01 | Crear, renombrar, duplicar y eliminar diagramas dentro de un proyecto. | M |
| RF-DIAG-02 | Crear clases con nombre, estereotipo y visibilidad; posicionarlas en un lienzo infinito con desplazamiento y zoom. | M |
| RF-DIAG-03 | Definir atributos: nombre, tipo, visibilidad (`+ - # ~`), multiplicidad, valor por defecto, marcas `static` / `final`. | M |
| RF-DIAG-04 | Definir métodos: nombre, parámetros tipados, tipo de retorno, visibilidad, marcas `static` / `abstract`. | M |
| RF-DIAG-05 | Crear relaciones: asociación, agregación, composición, herencia, realización y dependencia. | M |
| RF-DIAG-06 | Definir multiplicidad (`1`, `0..1`, `1..*`, `*`, `n..m`) y rol/nombre en cada extremo de una asociación. | M |
| RF-DIAG-07 | Marcar clases como `abstract`, `interface` o `enum`, con sus literales en el caso de `enum`. | M |
| RF-DIAG-08 | Deshacer y rehacer, respetando la semántica colaborativa: el deshacer afecta solo a las operaciones del usuario local. | M |
| RF-DIAG-09 | Enrutado automático de las líneas de relación, evitando solapamientos con las cajas de clase. | S |
| RF-DIAG-10 | Autodisposición del diagrama (layout automático) bajo demanda. | S |
| RF-DIAG-11 | Exportar el diagrama como PNG, SVG y JSON del modelo. | S |
| RF-DIAG-12 | Importar y exportar en XMI o PlantUML para interoperar con otras herramientas UML. **Implementado en su mitad de XMI** (XMI 2.1 / UML 2.x, ida y vuelta sin pérdida con la propia herramienta); PlantUML queda fuera. La interoperabilidad con Enterprise Architect está escrita contra la especificación de la OMG y **no verificada** contra un fichero real. | C |

### RF-COL — Colaboración en tiempo real

| ID | Requisito | Prio |
|---|---|---|
| RF-COL-01 | Varios usuarios editan el mismo diagrama simultáneamente y ven los cambios ajenos en menos de 300 ms (ver [RNF-REND-03](#rnf-rend--rendimiento)). | M |
| RF-COL-02 | Mostrar presencia: cursor, selección actual, nombre y color asignado por cada participante conectado. | M |
| RF-COL-03 | Las ediciones concurrentes sobre elementos distintos nunca se pierden ni requieren intervención del usuario. | M |
| RF-COL-04 | Las ediciones concurrentes sobre el **mismo campo** se resuelven de forma determinista y convergente en todos los clientes. | M |
| RF-COL-05 | Invitar colaboradores por enlace con rol (editor / lector) y caducidad opcional. | M |
| RF-COL-06 | Indicador visible del estado de conexión: en línea, sin conexión, sincronizando, conflicto. | M |
| RF-COL-07 | Historial de versiones con posibilidad de restaurar un punto anterior del diagrama. | S |
| RF-COL-08 | Comentarios anclados a una clase o relación, con hilo de respuestas. | C |

### RF-OFF — Modo sin conexión y sincronización

Este bloque es el núcleo diferenciador del producto. Se detalla el comportamiento esperado en [02-arquitectura.md](02-arquitectura.md#25-sincronización-y-modo-offline).

| ID | Requisito | Prio |
|---|---|---|
| RF-OFF-01 | La aplicación carga y es plenamente funcional sin red, siempre que se haya visitado al menos una vez (App Shell precacheado). | M |
| RF-OFF-02 | Todos los diagramas abiertos recientemente quedan disponibles sin conexión, con su contenido completo. | M |
| RF-OFF-03 | El usuario puede crear y editar diagramas sin conexión, sin diferencia funcional respecto al modo conectado. | M |
| RF-OFF-04 | Los cambios sin conexión se persisten localmente de forma duradera y sobreviven al cierre del navegador y al reinicio del equipo. | M |
| RF-OFF-05 | Al recuperar la conexión, los cambios locales se reconcilian automáticamente con el servidor sin intervención del usuario y sin pérdida de datos. | M |
| RF-OFF-06 | La reconciliación es **convergente**: dos clientes que hayan editado sin conexión llegan al mismo estado final tras sincronizar. | M |
| RF-OFF-07 | La aplicación indica de forma inequívoca qué cambios están pendientes de subir y cuándo se ha completado la sincronización. | M |
| RF-OFF-08 | Las funciones que requieren servidor (generación de código, IA en servidor, integración externa) se deshabilitan explicando el motivo, en lugar de fallar silenciosamente. | M |
| RF-OFF-09 | Las peticiones de generación lanzadas sin conexión se encolan y se ejecutan al reconectar (Background Sync). | S |
| RF-OFF-10 | Gestión de cuota de almacenamiento: avisar al usuario y permitir liberar diagramas antiguos del caché local. | S |
| RF-OFF-11 | Solicitar almacenamiento persistente al navegador para evitar el desalojo del caché bajo presión de disco. | S |

### RF-IA — Asistente conversacional

| ID | Requisito | Prio |
|---|---|---|
| RF-IA-01 | Entrada por texto en lenguaje natural para crear y modificar elementos del diagrama ("añade una clase Factura con total decimal y fecha"). | M |
| RF-IA-02 | Entrada por voz: dictado transcrito a texto y procesado por el mismo canal que RF-IA-01. | M |
| RF-IA-03 | El asistente traduce la petición a un conjunto de **operaciones sobre el modelo**, nunca a texto libre que el usuario deba copiar. | M |
| RF-IA-04 | Toda operación propuesta por el asistente se previsualiza y requiere confirmación antes de aplicarse al diagrama. | M |
| RF-IA-05 | Las operaciones del asistente son reversibles con un único deshacer, como una transacción atómica. | M |
| RF-IA-06 | Respuesta hablada opcional del asistente (síntesis de voz), desactivable. | S |
| RF-IA-07 | El asistente responde preguntas sobre el diagrama actual ("¿qué clases no tienen clave primaria?"). | S |
| RF-IA-08 | Modo degradado sin conexión: un intérprete de comandos local cubre un subconjunto acotado de instrucciones. Ver [RNF-IA-02](#rnf-ia--inteligencia-artificial). | S |
| RF-IA-09 | El asistente sugiere correcciones de modelado (normalización, relaciones faltantes, tipos inconsistentes). | C |

### RF-VIS — Reconocimiento de pizarra por fotografía

| ID | Requisito | Prio |
|---|---|---|
| RF-VIS-01 | Capturar una foto con la cámara del dispositivo o subir una imagen existente. | M |
| RF-VIS-02 | Corregir automáticamente la perspectiva y el contraste de la fotografía de pizarra antes de analizarla. | M |
| RF-VIS-03 | Detectar las cajas de clase y las líneas de relación presentes en la imagen. | M |
| RF-VIS-04 | Extraer por OCR el texto de cada caja y segmentarlo en nombre de clase, atributos y métodos. | M |
| RF-VIS-05 | Presentar el resultado como una **propuesta editable** con nivel de confianza por elemento, no como una importación directa. | M |
| RF-VIS-06 | El usuario puede corregir, descartar o aceptar cada elemento reconocido antes de incorporarlo al diagrama. | M |
| RF-VIS-07 | Inferir el tipo de relación (herencia, composición, asociación) a partir de la forma del extremo de la línea. | S |
| RF-VIS-08 | Procesamiento local en el navegador, sin enviar la imagen a ningún servidor. Ver [RNF-SEG-05](#rnf-seg--seguridad-y-privacidad). | S |

> **Cómo quedó implementado.** La canalización clásica que describen RF-VIS-02/03/04/07
> (OpenCV.js + OCR por región) se sustituyó por **una sola llamada a un modelo de
> visión en el servidor**, que devuelve el diagrama entero en JSON. Consecuencias:
>
> - **RF-VIS-01, 05, 06 se cumplen.** La revisión obligatoria es el eje del diseño:
>   nada entra en el diagrama sin que alguien lo confirme, y la confianza que el
>   modelo declara sobre sí mismo **no** se usa como garantía de nada.
> - **RF-VIS-07 se cumple**, pero por instrucción al modelo (rombo relleno =
>   composición, rombo hueco = agregación), no por geometría medida.
> - **RF-VIS-08 no se cumple**: la imagen sale de la máquina. Es el precio de tener
>   la función funcionando; era prioridad «S», no «M». Queda documentado como
>   desviación consciente en [§5.4](05-guia-voz-y-ocr.md), no como un olvido.
> - **Añadido sobre lo planeado**: cuando el modelo no lee una cardinalidad, se
>   marca como dudosa y se avisa en rojo en vez de suponerla, porque de ella
>   depende que el backend generado lleve una clave foránea o una tabla de unión.

### RF-GEN — Generación de backend Spring Boot

| ID | Requisito | Prio |
|---|---|---|
| RF-GEN-01 | Generar un proyecto Spring Boot compilable con estructura Maven o Gradle estándar. | M |
| RF-GEN-02 | Generar las 4 capas: entidad (modelo de dominio), repositorio, servicio y controlador REST. | M |
| RF-GEN-03 | Mapear cada clase UML a una entidad JPA con anotaciones `@Entity`, `@Id`, `@Column` y los tipos PostgreSQL correspondientes. | M |
| RF-GEN-04 | Traducir las relaciones UML a asociaciones JPA (`@OneToMany`, `@ManyToOne`, `@ManyToMany`, `@OneToOne`) con su `mappedBy` y estrategia de cascada. | M |
| RF-GEN-05 | Traducir la herencia UML a una estrategia JPA configurable (`SINGLE_TABLE`, `JOINED`, `TABLE_PER_CLASS`). | M |
| RF-GEN-06 | Generar repositorios Spring Data JPA con las consultas derivadas básicas. | M |
| RF-GEN-07 | Generar servicios con las operaciones CRUD y gestión transaccional (`@Transactional`). | M |
| RF-GEN-08 | Generar controladores REST con rutas CRUD, códigos de estado correctos y validación de entrada. | M |
| RF-GEN-09 | Generar DTOs y su mapeo, evitando exponer las entidades JPA directamente en la API. | M |
| RF-GEN-10 | Generar el esquema PostgreSQL como migraciones versionadas (Flyway o Liquibase), no mediante `ddl-auto`. | M |
| RF-GEN-11 | **Validar el modelo antes de generar** y bloquear la generación si hay errores (ciclos de composición, tipos desconocidos, clases sin identificador, nombres colisionantes con palabras reservadas de SQL o Java). | M |
| RF-GEN-12 | Descargar el proyecto generado como archivo ZIP. | M |
| RF-GEN-13 | Vista previa del código generado, archivo por archivo, antes de descargarlo. | S |
| RF-GEN-14 | Configurar el paquete base, el nombre del artefacto, la versión de Spring Boot y de Java. | M |
| RF-GEN-15 | Generar `docker-compose.yml` con el servicio PostgreSQL para levantar el proyecto localmente. | S |
| RF-GEN-16 | Generar pruebas unitarias y de integración esqueleto por entidad. | S |
| RF-GEN-17 | Generar documentación OpenAPI/Swagger de la API resultante. | S |
| RF-GEN-18 | Publicar el proyecto generado directamente en un repositorio Git del usuario. | C |

### RF-INT — Integración con Architech Enterprise

> **Bloqueante de diseño.** Los requisitos de esta sección están redactados a nivel de intención porque el contrato de Architech Enterprise no está disponible en el momento de escribir este documento. Requieren validación con el responsable del sistema antes de estimarse. Ver [preguntas abiertas](#16-preguntas-abiertas).

| ID | Requisito | Prio |
|---|---|---|
| RF-INT-01 | Autenticar a los usuarios contra el proveedor de identidad de Architech Enterprise (SSO), si lo expone. | M |
| RF-INT-02 | Importar un modelo o proyecto existente desde Architech Enterprise como diagrama editable. | M |
| RF-INT-03 | Publicar el diagrama y/o el backend generado hacia Architech Enterprise. | M |
| RF-INT-04 | Sincronizar el catálogo de proyectos: los proyectos visibles en la herramienta reflejan los permisos de Architech. | S |
| RF-INT-05 | Registrar en Architech un evento de auditoría por cada generación de código. | S |
| RF-INT-06 | Toda la comunicación pasa por una capa anticorrupción; ningún tipo de datos externo entra en el modelo de dominio propio. | M |

### RF-CTA — Cuentas, proyectos y permisos

| ID | Requisito | Prio |
|---|---|---|
| RF-CTA-01 | Registro e inicio de sesión (o SSO delegado, ver RF-INT-01). | M |
| RF-CTA-02 | Agrupar diagramas en proyectos. | M |
| RF-CTA-03 | Roles por proyecto: propietario, editor, lector. | M |
| RF-CTA-04 | El servidor valida los permisos en cada operación; el cliente solo los refleja en la interfaz. | M |
| RF-CTA-05 | Registro de auditoría de accesos y generaciones. | S |

---

## 1.4 Requisitos no funcionales

Los RNF se expresan con umbrales medibles. Un RNF sin número no es verificable y no se acepta en revisión.

### RNF-REND — Rendimiento

| ID | Requisito | Umbral |
|---|---|---|
| RNF-REND-01 | Carga inicial de la aplicación (First Contentful Paint) en red 4G simulada. | < 2,0 s |
| RNF-REND-02 | Arranque desde caché sin conexión (App Shell interactivo). | < 1,0 s |
| RNF-REND-03 | Latencia de propagación de una edición entre dos clientes conectados a la misma sala (p95). | < 300 ms |
| RNF-REND-04 | Interacción del lienzo (arrastrar una clase, hacer zoom) en un diagrama de 100 clases y 150 relaciones. | ≥ 50 fps |
| RNF-REND-05 | Tamaño máximo soportado de un diagrama sin degradación perceptible. | 300 clases / 500 relaciones |
| RNF-REND-06 | Tiempo de generación del proyecto Spring Boot para un diagrama de 50 clases (p95). | < 5 s |
| RNF-REND-07 | Reconocimiento de una fotografía de pizarra en un portátil de gama media. | < 10 s |
| RNF-REND-08 | Latencia de la transcripción de voz desde el fin del enunciado hasta el texto (p95). | < 1,5 s |
| RNF-REND-09 | Tamaño del bundle JavaScript inicial, comprimido con Brotli, sin contar modelos de IA. | < 300 KB |

### RNF-OFF — Disponibilidad y comportamiento sin conexión

| ID | Requisito | Umbral |
|---|---|---|
| RNF-OFF-01 | Autonomía sin conexión con plena funcionalidad de edición. | Indefinida |
| RNF-OFF-02 | Pérdida de datos admisible ante un cierre abrupto del navegador durante la edición. | 0 operaciones confirmadas |
| RNF-OFF-03 | Retardo entre una edición local y su persistencia en IndexedDB. | < 100 ms |
| RNF-OFF-04 | Consumo local por diagrama de tamaño medio (50 clases), incluido el historial. | < 5 MB |
| RNF-OFF-05 | Tiempo de reconciliación al reconectar tras 100 operaciones sin conexión. | < 3 s |
| RNF-OFF-06 | Convergencia: dos réplicas que han recibido el mismo conjunto de operaciones son idénticas. | 100 %, verificado con pruebas de propiedades |

### RNF-IA — Inteligencia artificial

| ID | Requisito | Umbral |
|---|---|---|
| RNF-IA-01 | Presupuesto total de modelos descargados al dispositivo para la funcionalidad local. | < 150 MB |
| RNF-IA-02 | Los modelos de IA se descargan **bajo demanda**, nunca en la carga inicial, y su descarga es visible y cancelable. | Obligatorio |
| RNF-IA-03 | Precisión del reconocimiento de pizarra: cajas de clase detectadas correctamente sobre el corpus de evaluación. | ≥ 85 % |
| RNF-IA-04 | Precisión del OCR sobre texto de pizarra legible, medida como exactitud a nivel de carácter. | ≥ 90 % |
| RNF-IA-05 | Precisión de la interpretación de instrucciones del asistente sobre el conjunto de intenciones definido. | ≥ 90 % |
| RNF-IA-06 | Ninguna salida del modelo modifica el diagrama sin validación previa contra el esquema del modelo. | Obligatorio |
| RNF-IA-07 | La degradación de la IA nunca bloquea la edición manual: si un modelo falla, la herramienta sigue siendo usable. | Obligatorio |

### RNF-SEG — Seguridad y privacidad

| ID | Requisito |
|---|---|
| RNF-SEG-01 | Todo el tráfico sobre TLS 1.3. WebSockets exclusivamente sobre `wss://`. |
| RNF-SEG-02 | Autorización verificada en el servidor en cada mensaje de sala, no solo al abrir la conexión. Un cliente no puede escribir en una sala en la que no tiene rol de editor. |
| RNF-SEG-03 | Los tokens de sesión no se almacenan en `localStorage`. Refresco mediante cookie `HttpOnly`, `Secure`, `SameSite=Strict`. |
| RNF-SEG-04 | El código generado no contiene credenciales incrustadas; la configuración se externaliza a variables de entorno. |
| RNF-SEG-05 | Las fotografías de pizarra se procesan localmente y no se transmiten ni almacenan en el servidor por defecto. |
| RNF-SEG-06 | El generador escapa y valida todo identificador procedente del diagrama antes de insertarlo en plantillas, código o SQL. Un nombre de clase es entrada no confiable. |
| RNF-SEG-07 | Content Security Policy restrictiva, sin `unsafe-eval` salvo donde el runtime WASM lo exija, en cuyo caso se acota por origen. |
| RNF-SEG-08 | Límite de tasa en los endpoints de generación e IA para evitar abuso de recursos. |
| RNF-SEG-09 | Cifrado en reposo de los diagramas en el servidor y borrado efectivo a petición del propietario. |
| RNF-SEG-10 | La recuperación de cuenta no depende de un canal de correo. Se hace con un código de un solo uso, entregado una vez y guardado solo como hash; la respuesta del endpoint es indistinguible entre correo desconocido, cuenta sin código y código erróneo. |
| RNF-SEG-11 | Cambiar la contraseña invalida de inmediato todos los tokens emitidos antes, incluidos los que estén en manos de un tercero. |

### RNF-USA — Usabilidad y accesibilidad

| ID | Requisito |
|---|---|
| RNF-USA-01 | Conformidad WCAG 2.1 nivel AA en la interfaz de la aplicación. |
| RNF-USA-02 | Toda la funcionalidad de edición es alcanzable por teclado, sin depender del ratón. |
| RNF-USA-03 | La entrada por voz es una alternativa, nunca el único camino para una función. |
| RNF-USA-04 | Los estados de conexión y sincronización se comunican con texto y forma, no solo con color. |
| RNF-USA-05 | Interfaz en español, con la infraestructura de internacionalización preparada desde el inicio. |
| RNF-USA-06 | Instalable como PWA en escritorio y móvil, con icono, splash y arranque en modo `standalone`. |

### RNF-MAN — Mantenibilidad y calidad

| ID | Requisito | Umbral |
|---|---|---|
| RNF-MAN-01 | Cobertura de pruebas en el motor de generación y en la lógica de sincronización. | ≥ 80 % |
| RNF-MAN-02 | El proyecto generado compila y sus pruebas pasan, verificado en integración continua sobre un corpus de diagramas de referencia. | 100 % del corpus |
| RNF-MAN-03 | TypeScript en modo `strict` en todo el frontend y en los tipos compartidos. | Sin `any` implícito |
| RNF-MAN-04 | Los tipos del modelo UML se definen una sola vez en `shared/` y los consumen frontend, backend y generador. | Fuente única de verdad |
| RNF-MAN-05 | Integración continua que ejecuta lint, tipos, pruebas unitarias y la compilación del corpus generado en cada PR. | Obligatorio |

### RNF-ESC — Escalabilidad y operación

| ID | Requisito | Umbral |
|---|---|---|
| RNF-ESC-01 | Sesiones de colaboración concurrentes soportadas por instancia de servidor. | ≥ 200 salas |
| RNF-ESC-02 | Participantes simultáneos en una misma sala sin degradar RNF-REND-03. | ≥ 10 |
| RNF-ESC-03 | El servidor de colaboración escala horizontalmente; el estado de sala no reside en memoria de un único proceso. | Obligatorio |
| RNF-ESC-04 | Disponibilidad mensual del servicio en la nube. | ≥ 99,5 % |
| RNF-ESC-05 | Objetivo de punto de recuperación (RPO) para los diagramas almacenados en servidor. | ≤ 1 h |
| RNF-ESC-06 | Trazas, métricas y registro estructurado que permitan diagnosticar un fallo de sincronización concreto. | Obligatorio |

---

## 1.5 Matriz de trazabilidad

| Bloque de requisitos | Sprint | Documento de diseño |
|---|---|---|
| RF-DIAG, RF-OFF (01–07) | S1 | [Arquitectura §2.4, §2.5](02-arquitectura.md#24-modelo-de-datos-y-crdt) |
| RF-COL, RF-CTA, RF-OFF (08–11) | S2 | [Arquitectura §2.5, §2.6](02-arquitectura.md#25-sincronización-y-modo-offline) |
| RF-GEN | S3 | [Arquitectura §2.7](02-arquitectura.md#27-motor-de-generación) |
| RF-IA | S4 | [Arquitectura §2.8](02-arquitectura.md#28-capa-de-inteligencia-artificial) |
| RF-VIS | S5 | [Arquitectura §2.8.3](02-arquitectura.md#283-reconocimiento-de-pizarra) |
| RF-INT, RNF-SEG, RNF-ESC | S6 | [Arquitectura §2.9](02-arquitectura.md#29-integración-con-architech-enterprise) |

---

## 1.6 Preguntas abiertas

Estas cuestiones bloquean decisiones de diseño y deben resolverse antes del sprint indicado.

| # | Pregunta | Bloquea | Límite |
|---|---|---|---|
| Q1 | ¿Qué es exactamente Architech Enterprise y qué interfaz expone (REST, SOAP, base de datos compartida, archivos)? ¿Hay documentación del contrato? | RF-INT completo | Antes de S2 |
| Q2 | ¿Architech Enterprise actúa como proveedor de identidad (SSO/OIDC/SAML) o la herramienta gestiona sus propias cuentas? | RF-CTA-01, RF-INT-01, diseño de sesión | Antes de S2 |
| Q3 | ¿La dirección de la integración es de entrada (importar modelos), de salida (publicar el backend) o bidireccional? | Alcance de S6 | Antes de S3 |
| Q4 | ¿Existe un formato de modelo canónico en Architech al que haya que ajustarse, o se define uno propio? | Modelo de dominio, `shared/` | Antes de S1 |
| Q5 | ¿Versión objetivo de Spring Boot y de Java para el código generado? ¿Maven o Gradle? | Plantillas del generador | Antes de S3 |
| Q6 | ¿Hay restricción de despliegue (nube concreta, servidores propios, entorno de la universidad)? | Infraestructura, RNF-ESC | Antes de S2 |
| Q7 | ¿Cuántos usuarios concurrentes reales se esperan? Los umbrales RNF-ESC son estimaciones sin dato de partida. | Dimensionado | Antes de S6 |
| Q8 | ¿Se dispone de un corpus de fotografías de pizarra reales para entrenar y evaluar RF-VIS? Sin él, RNF-IA-03/04 no son verificables. | Viabilidad de RF-VIS | Antes de S1 (spike) |

---

## 1.7 Riesgos asociados a los requisitos

| Riesgo | Impacto | Probabilidad | Mitigación |
|---|---|---|---|
| El reconocimiento de pizarra no alcanza una precisión útil con esfuerzo razonable | Alto | Alta | Spike acotado en S1. Si no se alcanza el umbral, degradar RF-VIS a "asistente de transcripción" con corrección manual intensiva y reasignar el sprint. |
| La interpretación de lenguaje natural exige un modelo grande, incompatible con RNF-IA-01 | Medio | Alta | Arquitectura híbrida: modelo en servidor cuando hay red, gramática de comandos local sin red (RF-IA-08). Documentado en Arquitectura §2.8.2. |
| El contrato de Architech Enterprise llega tarde o cambia | Alto | Media | Capa anticorrupción (RF-INT-06) y desarrollo contra un doble de pruebas hasta disponer del contrato real. |
| La complejidad de la sincronización offline se subestima | Alto | Media | Adoptar una biblioteca CRDT madura en lugar de implementación propia. Offline desde S1, no como añadido posterior. |
| El código generado no compila en casos límite del modelo | Medio | Media | Validación previa bloqueante (RF-GEN-11) y compilación del corpus en CI (RNF-MAN-02). |
