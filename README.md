# proyecto-herramienta-colaborativa

PWA colaborativa para diseñar diagramas de clases UML, con asistente conversacional por voz y texto y reconocimiento de pizarras a partir de una fotografía. Funciona sin conexión y sincroniza al recuperar la red. Genera un backend Spring Boot en 4 capas con PostgreSQL a partir del diagrama.

> **Estado:** implementada y en verde (577 pruebas, 25 ficheros). La arquitectura y las guías de uso están en [`docs/`](docs/README.md). Lo que falta por verificar —compilación real del backend generado, imagen Docker, RDS— está enumerado sin adornos en [Despliegue §6.6](docs/06-despliegue.md#66-estado) y [§5.9](docs/05-guia-voz-y-ocr.md#59-pruebas).

## Stack

| Módulo | Tecnología |
|---|---|
| `frontend/` | React + Vite + TypeScript (PWA) |
| `backend-tool/` | Node.js + Express |
| `generator/` | Motor de generación de Spring Boot |
| `shared/` | Tipos y utilidades compartidas |

Estado colaborativo con CRDT (Yjs) persistido en IndexedDB: la edición sin conexión y la colaboración en tiempo real son el mismo mecanismo. IA en dos capas: modelos locales en el navegador (ONNX Runtime Web) bajo `frontend/src/ai/`, con interpretación de lenguaje natural en servidor en `backend-tool/src/ai/`.

Las decisiones y sus alternativas descartadas están en [Arquitectura §2.11](docs/02-arquitectura.md#211-decisiones-registradas) y [Stack §3.9](docs/03-stack-tecnologico.md#39-matriz-de-decisiones).

## Estructura

```
proyecto-herramienta-colaborativa/
├── frontend/                # Aplicación web PWA (React + Vite + TypeScript)
│   ├── public/
│   ├── src/
│   │   ├── components/      # Interfaz conversacional, visor de diagramas
│   │   ├── services/        # Lógica de sincronización, API, IndexedDB
│   │   ├── ai/              # Modelos locales en navegador (TensorFlow.js, ONNX)
│   │   └── workers/         # Service workers para offline
│   └── manifest.json
├── backend-tool/            # Backend de la herramienta (Node.js + Express)
│   ├── src/
│   │   ├── api/             # Rutas REST
│   │   ├── collab/          # WebSockets para colaboración en tiempo real
│   │   ├── sync/            # Endpoints de sincronización
│   │   └── ai/              # Servicios de IA en servidor (opcional)
│   └── package.json
├── generator/               # Motor de generación de backend Spring Boot
│   ├── templates/
│   └── src/
├── shared/                  # Tipos y utilidades compartidas (monorepo)
├── docs/
└── .claude/
    └── settings.json
```

## Puesta en marcha

Monorepo con workspaces de npm; una sola instalación desde la raíz.

```bash
npm install

npm run dev:backend    # API y colaboración, en el 3001
npm run dev:frontend   # interfaz, en el 5173
```

Hacen falta las dos, en terminales distintas. El servidor de desarrollo del
frontend hace de intermediario hacia el backend, así que se navega siempre por
`http://localhost:5173`.

```bash
npm test          # 539; las otras 4 piden PostgreSQL u Ollama y se saltan solas
npm run typecheck # más estricto que las pruebas: es la puerta que importa
npm run build
```

### Desde el móvil, en la misma red

```bash
npm run dev:frontend:lan
```

Arranca igual pero escuchando en todas las interfaces, e imprime la dirección
que hay que abrir en el teléfono (`http://192.168.x.x:5173`). Basta con ese
puerto: el móvil habla solo con Vite, y es Vite quien llama al backend.

Es una orden aparte y no la de por defecto a propósito — el detalle está en el
comentario de `frontend/vite.config.ts`. En una red con aislamiento de clientes,
frecuente en universidades, esto no funciona y no hay nada que configurar: ahí la
salida es el cable, explicada en [Despliegue §6.7](docs/06-despliegue.md).

### Ayuda con modelo local (opcional)

```bash
ollama pull llama3.2:3b
```

La aplicación funciona sin esto. Con ello, la guía responde desde tu propia
máquina, gratis y sin que las preguntas salgan del equipo — [Guía §5.7](docs/05-guia-voz-y-ocr.md#57-la-guía-preguntar-cómo-se-hace-algo).

## Documentación

| # | Documento |
|---|---|
| 1 | [Requisitos funcionales y no funcionales](docs/01-requisitos.md) |
| 2 | [Arquitectura general](docs/02-arquitectura.md) |
| 3 | [Stack tecnológico](docs/03-stack-tecnologico.md) |
| 4 | [Plan de desarrollo en 6 sprints](docs/04-plan-sprints.md) |

Índice y estado en [`docs/README.md`](docs/README.md).
