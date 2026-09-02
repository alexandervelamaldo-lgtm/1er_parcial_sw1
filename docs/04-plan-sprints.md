# 4. Plan de desarrollo

**Documento relacionado:** [01-requisitos.md](01-requisitos.md) · [02-arquitectura.md](02-arquitectura.md) · [03-stack-tecnologico.md](03-stack-tecnologico.md)

---

## 4.1 Marco

- **6 sprints de 2 semanas** — 12 semanas de desarrollo.
- Cada sprint termina con **software desplegado y demostrable**, no con documentos ni ramas sin fusionar.
- La definición de terminado es común a todos los sprints ([§4.9](#49-definición-de-terminado)).

### Principios de ordenación

Tres criterios determinan el orden, y conviene entenderlos porque explican decisiones que de otro modo parecen extrañas:

1. **El riesgo se ataca antes que el valor.** Lo que puede invalidar la arquitectura se prueba en el sprint 1, aunque no genere funcionalidad visible.
2. **El modo sin conexión no se pospone.** Es la decisión estructural más profunda ([D3](02-arquitectura.md#211-decisiones-registradas)). Añadirlo en el sprint 5 significaría reescribir toda la capa de estado. Entra en el sprint 1.
3. **La IA va después del núcleo.** El asistente produce operaciones sobre el modelo; sin un modelo sólido y un canal de comandos estable, no hay dónde apoyarlo.

Esto implica una consecuencia que conviene aceptar de antemano: **el sprint 1 produce poca funcionalidad visible.** Es lo correcto. Un sprint 1 vistoso que deje la sincronización para más tarde compra una demo y vende el proyecto.

---

## 4.2 Vista general

| Sprint | Semanas | Objetivo | Requisitos principales |
|---|---|---|---|
| **S1** | 1–2 | Núcleo local-first y spikes de riesgo | RF-DIAG, RF-OFF-01…04 |
| **S2** | 3–4 | Colaboración en tiempo real y cuentas | RF-COL, RF-CTA, RF-OFF-05…11 |
| **S3** | 5–6 | Motor de generación Spring Boot | RF-GEN |
| **S4** | 7–8 | Asistente conversacional (texto y voz) | RF-IA |
| **S5** | 9–10 | Reconocimiento de pizarra | RF-VIS |
| **S6** | 11–12 | Integración Architech, endurecimiento y despliegue | RF-INT, RNF-SEG, RNF-ESC |

```
S1 ████ Núcleo + offline + spikes        ← riesgo arquitectónico
S2 ████ Colaboración + cuentas           ← riesgo de sincronización
S3 ████ Generador                        ← valor central del producto
S4 ████ Asistente conversacional
S5 ████ Visión de pizarra                ← riesgo de precisión (mitigado en S1)
S6 ████ Integración + endurecimiento     ← riesgo externo (Q1–Q4)
```

---

## 4.3 Sprint 1 — Núcleo local-first y reducción de riesgo

**Semanas 1–2.** Objetivo: un editor UML de un solo usuario que ya es local-first, más la validación de los dos supuestos que pueden tumbar la arquitectura.

### Alcance

**Cimientos**
- Monorepo pnpm con los cuatro paquetes y la CI en verde desde el primer día.
- Modelo de dominio en `shared/` con esquemas Zod ([§2.4.1](02-arquitectura.md#241-el-modelo-de-dominio)).
- Documento Yjs mapeado al modelo, con `y-indexeddb`.
- Capa de comandos de dominio ([§2.6.2](02-arquitectura.md#262-regla-de-flujo-de-datos)). Todas las mutaciones pasan por aquí desde el inicio.

**Editor** — RF-DIAG-01…08
- Lienzo con desplazamiento, zoom y selección.
- Crear, mover, redimensionar y eliminar clases.
- Editar atributos y métodos con visibilidad y tipos.
- Las seis clases de relación con multiplicidades.
- Deshacer y rehacer por origen.

**Sin conexión** — RF-OFF-01…04
- Service Worker con precacheo del App Shell.
- Persistencia en IndexedDB y rehidratación al abrir.
- `manifest.json` completo e instalable (RNF-USA-06).

### Spikes (tiempo acotado, resultado escrito)

| Spike | Pregunta | Límite | Si falla |
|---|---|---|---|
| **SP-1 Rendimiento del lienzo** | ¿Konva sobre Canvas 2D sostiene 50 fps con 300 clases y 500 relaciones? | 2 días | Pasar a PixiJS/WebGL **ahora**, antes de construir encima |
| **SP-2 Visión de pizarra** | Sobre fotos reales, ¿la detección de cajas llega al 85 % y el OCR al 90 %? | 3 días | Replantear RF-VIS y reasignar el sprint 5 |

SP-2 es el más importante del proyecto. Requiere resolver antes la pregunta abierta **Q8**: reunir entre 30 y 50 fotografías de pizarra reales, con variedad de letra, iluminación y calidad. Sin ese corpus el spike no mide nada.

### Entregables

- Editor UML de un solo usuario, instalable, funcional sin red.
- Informe de SP-1 con cifras de perfilado.
- Informe de SP-2 con precisión medida sobre el corpus, y recomendación explícita: seguir, degradar o replantear.
- CI con lint, tipos y pruebas unitarias.

### Criterios de aceptación

- [ ] Se crea un diagrama de 10 clases con relaciones, se cierra el navegador y al reabrir está intacto.
- [ ] Con el modo avión activado, la aplicación carga y permite editar con normalidad.
- [ ] Se instala como PWA en escritorio y móvil.
- [ ] SP-1 y SP-2 documentados con datos, no con impresiones.
- [ ] RNF-REND-02 verificado: arranque sin red por debajo de 1 s.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| No hay corpus de fotos y SP-2 no se puede ejecutar | **Conseguirlo en la semana 1.** Bloquea el spike y, en cascada, todo el sprint 5. |
| El mapeo Yjs↔modelo resulta más arduo de lo previsto | Es el corazón del sistema. Si hace falta, recortar RF-DIAG-09/10 antes que apresurar esta parte. |

---

## 4.4 Sprint 2 — Colaboración en tiempo real y cuentas

**Semanas 3–4.** Objetivo: varias personas editan el mismo diagrama a la vez, incluso tras haber trabajado sin conexión.

### Alcance

**Backend** — RF-CTA
- Express con TypeScript, PostgreSQL con Drizzle, migraciones.
- Autenticación tras la interfaz `IdentityProvider` ([§2.9.3](02-arquitectura.md#293-postura-ante-la-incertidumbre)), sustituible por SSO en S6.
- Proyectos, miembros y roles. Autorización verificada en servidor (RF-CTA-04).

**Colaboración** — RF-COL-01…06
- Servidor WebSocket con salas y autorización por mensaje (RNF-SEG-02).
- Presencia mediante awareness: cursores, selección, colores.
- Indicador de estado de conexión con los cinco estados de [§2.5.2](02-arquitectura.md#252-ciclo-de-vida-de-la-conexión).
- Invitación por enlace con rol.

**Sincronización** — RF-OFF-05…11
- Reconciliación al reconectar con retroceso exponencial.
- Instantáneas periódicas en servidor (RNF-ESC-05).
- Background Sync para las peticiones diferidas (RF-OFF-09).
- Gestión de cuota y almacenamiento persistente (RF-OFF-10/11).

### Entregables

- Colaboración multiusuario desplegada en un entorno accesible.
- Suite de pruebas de convergencia con fast-check (RNF-OFF-06).
- Pruebas Playwright de dos clientes con desconexión y reconexión.

### Criterios de aceptación

- [ ] Dos navegadores editan el mismo diagrama y ven los cambios ajenos en menos de 300 ms (RNF-REND-03).
- [ ] Un cliente se desconecta, edita 50 operaciones, reconecta, y **todo** se integra sin pérdida ni diálogo de conflicto.
- [ ] Dos clientes editan sin conexión la misma clase, ambos reconectan, y convergen al mismo estado.
- [ ] Un lector no puede escribir, verificado enviando mensajes al WebSocket a mano.
- [ ] Las pruebas de propiedades pasan sobre 1 000 secuencias aleatorias.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| La autorización por mensaje se olvida y solo se valida al conectar | Es un fallo de seguridad real. Prueba explícita en los criterios de aceptación. |
| El escalado por afinidad de sala complica el despliegue | Una sola instancia en S2; el escalado horizontal se aborda en S6. |

> **Q1, Q2 y Q6 deben estar resueltas al terminar este sprint.** Si Architech es el proveedor de identidad, el trabajo de autenticación de S2 cambia de forma.

---

## 4.5 Sprint 3 — Motor de generación Spring Boot

**Semanas 5–6.** Objetivo: convertir un diagrama en un proyecto Spring Boot que compile y arranque.

### Alcance

**Canalización** — [§2.7.1](02-arquitectura.md#271-canalización)
- Exportación del CRDT al modelo canónico.
- Normalización a IR: resolución de herencia, lado propietario de cada relación, claves ajenas, convenciones de nombre.
- Validación bloqueante con las ocho reglas de [§2.7.2](02-arquitectura.md#272-validaciones-bloqueantes), reportando por elemento.

**Plantillas** — RF-GEN-01…10
- Las cuatro capas: dominio, repositorio, servicio, controlador.
- DTOs y mapeo (RF-GEN-09).
- Mapeo completo de relaciones y herencia JPA.
- Migraciones Flyway (RF-GEN-10). **No `ddl-auto`.**
- `pom.xml` o `build.gradle`, `application.yml`, manejo de excepciones.

**Entrega** — RF-GEN-12…15
- Descarga en ZIP y vista previa del código por archivo.
- Configuración de paquete base, artefacto, versiones.
- `docker-compose.yml` con PostgreSQL.

**Seguridad** — RNF-SEG-06
- Validación de identificadores, palabras reservadas de Java y SQL, y verificación de rutas al empaquetar.

### Entregables

- Generador completo integrado en la interfaz.
- Corpus de diagramas de referencia en CI, con compilación real (RNF-MAN-02).
- Documentación del mapeo UML→JPA para el usuario final.

### Criterios de aceptación

- [ ] Un diagrama de 20 clases con herencia y relaciones muchos a muchos genera un proyecto que **compila con Maven o Gradle**.
- [ ] El proyecto generado arranca contra el PostgreSQL de su `docker-compose` y expone los CRUD.
- [ ] Un diagrama inválido (clase sin identificador, ciclo de composición) **bloquea** la generación con un mensaje por elemento.
- [ ] Una clase llamada `User; DROP TABLE--` no produce código ni SQL peligrosos.
- [ ] La CI compila los ocho casos del corpus en cada PR.
- [ ] RNF-REND-06: 50 clases generadas en menos de 5 s.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Los casos límite de relaciones producen código que no compila | El corpus en CI es la red de seguridad. Ampliarlo con cada fallo encontrado. |
| Lógica que se cuela en las plantillas | Revisión de código con criterio explícito: si una plantilla decide, la decisión sube a la IR. |

> **Q5 debe estar resuelta antes de empezar** (versión de Spring Boot, de Java, Maven o Gradle).

---

## 4.6 Sprint 4 — Asistente conversacional

**Semanas 7–8.** Objetivo: crear y modificar el diagrama hablando o escribiendo.

### Alcance

**Canal de operaciones** — RF-IA-03…05
- Esquema JSON de operaciones ([§2.8.2](02-arquitectura.md#282-asistente-conversacional)) con validación estricta.
- Aplicación mediante la capa de comandos de S1: el asistente **no** tiene una vía propia al modelo.
- Previsualización con confirmación y deshacer atómico.

**Con conexión** — RF-IA-01
- Servicio de interpretación en `backend-tool/src/ai/`, con salida forzada a JSON validado.
- Límite de tasa (RNF-SEG-08).

**Sin conexión** — RF-IA-08
- Gramática de comandos local para el subconjunto acotado, descubrible desde la interfaz.

**Voz** — RF-IA-02, RF-IA-06
- Web Speech API con aviso claro de que requiere conexión.
- Whisper `tiny` en ONNX como alternativa local, descargado bajo demanda (RNF-IA-02).
- Síntesis de voz opcional.

**Consultas** — RF-IA-07
- Preguntas de solo lectura sobre el diagrama.

### Entregables

- Asistente de texto y voz operativo.
- Conjunto de evaluación de intenciones con precisión medida (RNF-IA-05).
- Documentación de los comandos disponibles sin conexión.

### Criterios de aceptación

- [ ] "Crea una clase Factura con número entero, fecha y total decimal" produce la clase correcta tras confirmar.
- [ ] La operación del asistente se deshace con **un solo** Ctrl+Z.
- [ ] Una salida del modelo que no valida contra el esquema se descarta sin tocar el diagrama.
- [ ] Sin conexión, los comandos de la gramática local funcionan y el resto se rechaza con un mensaje claro.
- [ ] Precisión ≥ 90 % sobre el conjunto de evaluación de intenciones.
- [ ] Toda función del asistente es alcanzable también por teclado (RNF-USA-02/03).

### Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo devuelve operaciones plausibles pero erróneas | Previsualización obligatoria. El usuario ve el cambio antes de aplicarlo. |
| La gramática local resulta demasiado pobre y frustra | Documentar su alcance con honestidad en la interfaz, sin prometer más. |

---

## 4.7 Sprint 5 — Reconocimiento de pizarra

**Semanas 9–10.** Objetivo: convertir la foto de una pizarra en una propuesta de diagrama editable.

> **El alcance de este sprint depende del resultado de SP-2 (sprint 1).** Si el spike no alcanzó los umbrales, se aplica el plan degradado de más abajo antes de empezar.

### Alcance

> **Lo que se hizo en realidad.** No se llegó a montar la canalización de OpenCV.js
> descrita abajo. En su lugar hay **un botón «🖼 Desde imagen»** que manda la foto a
> un modelo de visión y devuelve el diagrama entero —clases, atributos, relaciones y
> cardinalidades— en una sola pasada, para revisarlo antes de importarlo. Cubre
> RF-VIS-01/03/04/05/06/07 y **renuncia a RF-VIS-08** (el procesamiento no es local).
> El detalle está en [§5.4 de la guía](05-guia-voz-y-ocr.md). Lo de abajo se
> conserva como lo que se planeó, no como lo que se construyó.

**Captura** — RF-VIS-01/02
- Cámara y subida de archivo.
- Preproceso con OpenCV.js: perspectiva, contraste, binarización, reflejos.

**Canalización** — RF-VIS-03/04/07
- Detección de rectángulos y segmentos.
- OCR por región recortada.
- Segmentación de cada caja en nombre, atributos y métodos.
- Inferencia del tipo de relación por el extremo de la línea.

**Revisión** — RF-VIS-05/06
- Interfaz de propuesta con confianza por elemento.
- Aceptar, corregir o descartar elemento a elemento.
- Incorporación mediante la capa de comandos, como el asistente.

**Rendimiento** — RNF-REND-07, RF-VIS-08
- Todo en `vision.worker.ts`.
- Carga diferida de OpenCV.js y de los modelos.
- Procesamiento local: la imagen no sale del dispositivo (RNF-SEG-05).

### Plan degradado (si SP-2 no alcanzó los umbrales)

1. Reducir el alcance a detección de cajas y OCR, sin inferencia de relaciones (el usuario las traza a mano).
2. Si tampoco llega: ofrecer la foto como plantilla de fondo del lienzo para calcar encima, con OCR asistido por selección manual de región.
3. Reasignar el tiempo liberado a RF-GEN-16/17 (pruebas y OpenAPI) y a RF-COL-07 (historial de versiones).

Este plan existe para que un mal resultado del spike sea una decisión tomada, no una crisis a mitad de sprint.

### Criterios de aceptación

- [ ] Una foto de pizarra con 5 clases produce una propuesta con ≥ 85 % de cajas detectadas (RNF-IA-03).
- [ ] El OCR alcanza ≥ 90 % de exactitud por carácter sobre texto legible (RNF-IA-04).
- [ ] Cada elemento muestra su confianza y es corregible antes de aceptarlo.
- [ ] Procesamiento en menos de 10 s en un portátil de gama media (RNF-REND-07).
- [ ] Ninguna petición de red transporta la imagen, verificado en el inspector de red.
- [ ] La interfaz no se congela durante el procesamiento.

---

## 4.8 Sprint 6 — Integración, endurecimiento y despliegue

**Semanas 11–12.** Objetivo: conectar con Architech Enterprise, cerrar los no funcionales y desplegar a producción.

> El contenido de la parte de integración depende de Q1–Q4. Si siguen sin resolverse al empezar la semana 11, **el trabajo de integración se sustituye por el completado del adaptador contra un doble de pruebas** y se reasigna el tiempo a endurecimiento. Es imprescindible decidirlo el primer día del sprint, no a mitad.

### Alcance

**Integración** — RF-INT
- Adaptador de la capa anticorrupción ([§2.9.1](02-arquitectura.md#291-capa-anticorrupción)).
- SSO sustituyendo la implementación de `IdentityProvider` de S2 (RF-INT-01).
- Importación y publicación (RF-INT-02/03).
- Eventos de auditoría (RF-INT-05).

**Seguridad** — RNF-SEG
- Content Security Policy, cabeceras de seguridad.
- Revisión de la autorización en todos los endpoints y mensajes de sala.
- Límites de tasa en generación e IA.
- Cifrado en reposo y borrado efectivo (RNF-SEG-09).
- Revisión de seguridad del generador.

**Escalado y operación** — RNF-ESC
- Afinidad de sala y prueba con varias instancias.
- Trazas, métricas y registro estructurado (RNF-ESC-06).
- Copias de seguridad y verificación del RPO.
- Prueba de carga: 200 salas, 10 participantes en una.

**Calidad**
- Auditoría de accesibilidad WCAG 2.1 AA (RNF-USA-01).
- Lighthouse CI sobre los umbrales de rendimiento.
- Cierre de la deuda técnica anotada en S1–S5.

### Criterios de aceptación

- [ ] Inicio de sesión mediante SSO de Architech, o adaptador completo contra doble de pruebas con su contrato documentado.
- [ ] Prueba de carga superada: RNF-ESC-01 y RNF-ESC-02 sin degradar RNF-REND-03.
- [ ] Auditoría de accesibilidad sin incidencias de nivel AA.
- [ ] Lighthouse: RNF-REND-01 y RNF-REND-09 en verde.
- [ ] Restauración desde copia de seguridad ejecutada y verificada.
- [ ] Cobertura ≥ 80 % en generador y sincronización (RNF-MAN-01).
- [ ] Aplicación desplegada en producción con supervisión activa.

---

## 4.9 Definición de terminado

Aplica a toda historia, en todos los sprints:

- [ ] Código revisado y fusionado en la rama principal.
- [ ] Pruebas unitarias de la lógica nueva; pruebas de extremo a extremo de los recorridos críticos.
- [ ] CI en verde: lint, tipos, pruebas, compilación del corpus.
- [ ] TypeScript `strict` sin `any` implícito ni supresiones sin justificar.
- [ ] **Verificado sin conexión** si la funcionalidad debe operar sin red.
- [ ] Alcanzable por teclado y con etiquetas accesibles.
- [ ] Sin secretos en el código ni en el repositorio.
- [ ] Desplegado en el entorno de pruebas y comprobado a mano.
- [ ] Los requisitos que cubre, marcados en la matriz de trazabilidad.

---

## 4.10 Calendario de decisiones pendientes

Las preguntas abiertas de [§1.6](01-requisitos.md#16-preguntas-abiertas) tienen fecha límite. Rebasarla no retrasa un sprint: cambia lo que se puede construir.

| Pregunta | Límite | Consecuencia de no resolverla |
|---|---|---|
| **Q8** — corpus de fotos de pizarra | Semana 1 | SP-2 no se puede ejecutar; el sprint 5 se planifica a ciegas |
| **Q4** — formato canónico del modelo | Semana 1 | El modelo de `shared/` puede requerir rehacerse |
| **Q1, Q2** — contrato e identidad de Architech | Semana 4 | La autenticación de S2 podría tener que rehacerse en S6 |
| **Q6** — restricciones de despliegue | Semana 4 | El diseño de infraestructura queda en el aire |
| **Q5** — versiones de Spring Boot y Java | Semana 4 | El sprint 3 no puede empezar |
| **Q3** — dirección de la integración | Semana 6 | El alcance del sprint 6 no es estimable |
| **Q7** — usuarios concurrentes esperados | Semana 10 | Los umbrales de RNF-ESC siguen siendo conjeturas |

---

## 4.11 Ajustes de alcance previstos

Si el proyecto se retrasa, este es el orden de recorte. Definirlo ahora evita improvisar bajo presión.

**Primero (impacto bajo):** RF-DIAG-10 layout automático · RF-COL-08 comentarios · RF-GEN-16/17 pruebas y OpenAPI generados · RF-IA-09 sugerencias de modelado.

> RF-DIAG-12 estaba el primero de esta lista y acabó implementándose de todos modos, en su mitad de XMI: se pidió expresamente durante el desarrollo. PlantUML sigue fuera. Ver [§5.5 de la guía](05-guia-voz-y-ocr.md#55-importar-y-exportar-xmi-rf-diag-12).

**Después (impacto medio):** RF-COL-07 historial de versiones · RF-GEN-13 vista previa de código · RF-IA-06 respuesta hablada · RF-VIS-07 inferencia del tipo de relación · RF-GEN-15 docker-compose.

**Nunca se recortan:** el modo sin conexión y la convergencia (RF-OFF) · la validación previa a la generación (RF-GEN-11) · la autorización en servidor (RF-CTA-04, RNF-SEG-02) · la confirmación de las propuestas de IA (RF-IA-04, RF-VIS-05).

Los tres últimos son la diferencia entre un prototipo y un producto. El primero es la razón de ser del proyecto.
