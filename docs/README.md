# Documentación

| # | Documento | Contenido |
|---|---|---|
| 1 | [Requisitos](01-requisitos.md) | RF y RNF con identificadores trazables, matriz de trazabilidad, preguntas abiertas |
| 2 | [Arquitectura](02-arquitectura.md) | Vistas de contexto y contenedores, modelo CRDT, sincronización offline, generador, IA, integración externa |
| 3 | [Stack tecnológico](03-stack-tecnologico.md) | Elecciones por capa con alternativas descartadas, matriz de decisiones, riesgos técnicos |
| 4 | [Plan de sprints](04-plan-sprints.md) | 6 sprints, spikes de riesgo, criterios de aceptación, calendario de decisiones |
| 5 | [Guía de voz y OCR](05-guia-voz-y-ocr.md) | Uso paso a paso de las dos funcionalidades, importación y exportación en XMI, configuración de la clave, seguridad, límites conocidos del OCR |
| 6 | [Despliegue](06-despliegue.md) | De GitHub a AWS: qué revisar antes del primer commit, la imagen Docker, App Runner y ECS, la base de datos —esquema, TLS y qué está verificado y qué no— y por qué el disco efímero obliga a PostgreSQL |
| 7 | [Cuentas y contraseñas](07-cuentas-y-contrasenas.md) | Crear la cuenta, el código de recuperación de un solo uso, recuperar sin servidor de correo, la escotilla de operador, qué pasa con las sesiones abiertas y qué está probado y qué no |
| 8 | [Casos de uso](08-casos-de-uso.md) | Los catorce casos de uso con sus actores, participantes, flujo principal, alternativos y actividad. **Se genera**: sale del mismo sitio que los `.xmi` de `docs/uml/` |
| 9 | [Calidad, escalabilidad e innovación](09-calidad-escalabilidad-innovacion.md) | Los tres criterios de evaluación, localizados en el código: qué está verificado por una prueba, qué está implementado sin vigilar y qué sigue pendiente. Incluye el techo real del sistema y un guion de defensa de cinco minutos |
| 10 | [Asistente móvil](10-asistente-movil.md) | El teléfono contra el backend generado: el manifiesto que hace que un solo APK sirva para cualquier diagrama, el repertorio de órdenes dictadas, el ciclo hablado, la bandeja de salida cuando no hay cobertura y por qué reenviar no duplica |

## Cómo leerlo

- Para entender **qué** se construye: documento 1.
- Para entender **por qué** está construido así: documento 2, sección [2.1 Principios rectores](02-arquitectura.md#21-principios-rectores) y [2.11 Decisiones registradas](02-arquitectura.md#211-decisiones-registradas).
- Para entender **con qué**: documento 3, [matriz de decisiones](03-stack-tecnologico.md#39-matriz-de-decisiones).
- Para entender **cuándo**: documento 4.
- Para **usar** el control por voz o la importación desde foto: documento 5. Empieza por [§5.0](05-guia-voz-y-ocr.md#50-qué-significa-aquí-base-de-datos-léelo-antes-que-nada), que aclara qué significa exactamente «base de datos» en esta herramienta.
- Para **intercambiar el diagrama con otra herramienta UML** (Enterprise Architect, Papyrus, StarUML): documento 5, [§5.5](05-guia-voz-y-ocr.md#55-importar-y-exportar-xmi-rf-diag-12).
- Para **usar por voz el backend que se ha generado**, desde el teléfono y sin tocar la web: documento 10. Ojo con no confundirlo con el 5: en el 5 se habla *para editar el diagrama*, en el 10 se habla *para dar de alta un pedido en la aplicación que salió de ese diagrama*. La diferencia está explicada en la tabla que abre el [documento 10](10-asistente-movil.md).
- Para entender **por qué un solo APK vale para cualquier proyecto** —el teléfono no se recompila cuando se mueve una caja del diagrama—: [§10.1](10-asistente-movil.md#101-el-manifiesto-un-solo-apk-para-cualquier-proyecto).
- Para **dictar sin cobertura** y saber qué queda apuntado y qué no se puede apuntar: [§10.6](10-asistente-movil.md#106-sin-cobertura-la-bandeja-de-salida). Si lo que se quiere es la garantía de que reenviar no duplica nada, [§10.7](10-asistente-movil.md#107-por-qué-reenviar-no-duplica).
- Para **poner el teléfono a hablar con el `localhost` del portátil** el día de la defensa: [§10.2](10-asistente-movil.md#102-puesta-en-marcha), que empieza por el `adb reverse`.
- Para **preguntarle a la aplicación cómo se hace algo** en vez de leer esto: el botón «? Ayuda» busca dentro de estos mismos documentos y contesta, con o sin conexión. Cómo funciona y cómo instalar el modelo local: [§5.7](05-guia-voz-y-ocr.md#57-la-guía-preguntar-cómo-se-hace-algo).
- Para **el análisis en UML** —casos de uso, comunicación, secuencia, actividad, clases de análisis—: documento 8, y los ficheros de `docs/uml/`, que se abren en Enterprise Architect. Los dos salen del mismo catálogo: no se editan a mano, se regeneran con `npm run diagramas --workspace @app/backend-tool`.
- Para **defender el trabajo** —qué respalda que el software tenga calidad, escale e innove, y dónde no llega—: documento 9. Empieza por [§9.1](09-calidad-escalabilidad-innovacion.md#91-cómo-leer-las-tablas), que distingue lo verificado por una prueba de lo que solo está escrito, y termina en [§9.6](09-calidad-escalabilidad-innovacion.md#96-cómo-enseñarlo-en-la-defensa).
- Para **entrar, o para volver a entrar si se olvidó la contraseña**: documento 7. Aquí no hay «te hemos enviado un correo»; hay un código que se enseña una sola vez y conviene leer [§7.2](07-cuentas-y-contrasenas.md#72-el-código-de-recuperación) antes de cerrar esa pantalla, no después.

## Estado

Borrador de arquitectura, versión 0.1. Ocho preguntas abiertas (Q1–Q8) bloquean decisiones de diseño; su calendario está en [§4.10](04-plan-sprints.md#410-calendario-de-decisiones-pendientes).

Las más urgentes:

- **Q8** (semana 1) — corpus de fotografías de pizarra. Sin él, el spike de visión del sprint 1 no mide nada y el sprint 5 se planifica a ciegas.
- **Q4** (semana 1) — formato canónico del modelo. Condiciona los tipos de `shared/`.
- **Q1/Q2** (semana 4) — contrato de Architech Enterprise e identidad. Toda la sección [2.9](02-arquitectura.md#29-integración-con-architech-enterprise) es provisional hasta resolverlas.
