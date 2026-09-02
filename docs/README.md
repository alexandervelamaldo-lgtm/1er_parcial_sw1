# Documentación

| # | Documento | Contenido |
|---|---|---|
| 1 | [Requisitos](01-requisitos.md) | RF y RNF con identificadores trazables, matriz de trazabilidad, preguntas abiertas |
| 2 | [Arquitectura](02-arquitectura.md) | Vistas de contexto y contenedores, modelo CRDT, sincronización offline, generador, IA, integración externa |
| 3 | [Stack tecnológico](03-stack-tecnologico.md) | Elecciones por capa con alternativas descartadas, matriz de decisiones, riesgos técnicos |
| 4 | [Plan de sprints](04-plan-sprints.md) | 6 sprints, spikes de riesgo, criterios de aceptación, calendario de decisiones |
| 5 | [Guía de voz y OCR](05-guia-voz-y-ocr.md) | Uso paso a paso de las dos funcionalidades, importación y exportación en XMI, configuración de la clave, seguridad, límites conocidos del OCR |
| 6 | [Despliegue](06-despliegue.md) | De GitHub a AWS: qué revisar antes del primer commit, la imagen Docker, App Runner y ECS, la base de datos —esquema, TLS y qué está verificado y qué no— y por qué el disco efímero obliga a PostgreSQL |

## Cómo leerlo

- Para entender **qué** se construye: documento 1.
- Para entender **por qué** está construido así: documento 2, sección [2.1 Principios rectores](02-arquitectura.md#21-principios-rectores) y [2.11 Decisiones registradas](02-arquitectura.md#211-decisiones-registradas).
- Para entender **con qué**: documento 3, [matriz de decisiones](03-stack-tecnologico.md#39-matriz-de-decisiones).
- Para entender **cuándo**: documento 4.
- Para **usar** el control por voz o la importación desde foto: documento 5. Empieza por [§5.0](05-guia-voz-y-ocr.md#50-qué-significa-aquí-base-de-datos-léelo-antes-que-nada), que aclara qué significa exactamente «base de datos» en esta herramienta.
- Para **intercambiar el diagrama con otra herramienta UML** (Enterprise Architect, Papyrus, StarUML): documento 5, [§5.5](05-guia-voz-y-ocr.md#55-importar-y-exportar-xmi-rf-diag-12).
- Para **preguntarle a la aplicación cómo se hace algo** en vez de leer esto: el botón «? Ayuda» busca dentro de estos mismos documentos y contesta, con o sin conexión. Cómo funciona y cómo instalar el modelo local: [§5.7](05-guia-voz-y-ocr.md#57-la-guía-preguntar-cómo-se-hace-algo).

## Estado

Borrador de arquitectura, versión 0.1. Ocho preguntas abiertas (Q1–Q8) bloquean decisiones de diseño; su calendario está en [§4.10](04-plan-sprints.md#410-calendario-de-decisiones-pendientes).

Las más urgentes:

- **Q8** (semana 1) — corpus de fotografías de pizarra. Sin él, el spike de visión del sprint 1 no mide nada y el sprint 5 se planifica a ciegas.
- **Q4** (semana 1) — formato canónico del modelo. Condiciona los tipos de `shared/`.
- **Q1/Q2** (semana 4) — contrato de Architech Enterprise e identidad. Toda la sección [2.9](02-arquitectura.md#29-integración-con-architech-enterprise) es provisional hasta resolverlas.
