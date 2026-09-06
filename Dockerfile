# Imagen del servicio completo: API, canal colaborativo y frontend construido.
#
# Un solo contenedor y no dos a propósito. El cliente deriva la URL del WebSocket
# de `location.host`, así que servir el frontend desde otro origen dejaría al
# navegador buscando el canal colaborativo donde no hay nadie. Mismo origen,
# además, deja CORS sin nada que configurar.

# ---------------------------------------------------------------------------
# Etapa 1: construir el frontend.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Primero solo los manifiestos. Docker cachea esta capa, de modo que cambiar
# código fuente no vuelve a descargar node_modules entero: sin esto, cada
# despliegue reinstala todas las dependencias.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY generator/package.json generator/
COPY backend-tool/package.json backend-tool/
COPY frontend/package.json frontend/

# `npm ci` y no `npm install`: respeta el lock exactamente y falla si no cuadra,
# que es justo lo que se quiere en un build reproducible.
RUN npm ci

COPY . .

RUN npm run build --workspace @app/frontend

# ---------------------------------------------------------------------------
# Etapa 2: imagen de ejecución.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# El backend corre TypeScript directamente con tsx, que es una devDependency:
# por eso aquí no se puede usar `--omit=dev`. Compilar a JavaScript en la etapa
# de build reduciría la imagen, pero exige un `tsconfig` de emisión que hoy no
# existe y que el proyecto no necesita para nada más.
#
# `--include=dev` no es redundante: `NODE_ENV=production`, unas líneas más
# arriba, hace que `npm ci` omita las devDependencies por su cuenta, sin que
# nadie escriba `--omit=dev` en ningún sitio. La imagen se construía entera y
# sin un solo aviso, y luego el contenedor moría al arrancar con
# «Cannot find package 'tsx'». Se pone la bandera aquí, en la línea que
# instala, y no moviendo el `ENV`: así el arreglo sigue en pie aunque alguien
# reordene las variables de entorno más tarde.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY generator/package.json generator/
COPY backend-tool/package.json backend-tool/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts --include=dev

COPY shared/ shared/
COPY generator/ generator/
COPY backend-tool/ backend-tool/
COPY --from=build /app/frontend/dist ./frontend/dist

# El manual. Aquí es un dato y no documentación: la guía de la herramienta lo
# lee para responder «¿cómo se hace esto?». Sin él el servicio arranca igual,
# pero con la ayuda desactivada y solo un aviso en el registro.
COPY docs/ docs/

# Node se ejecuta sin privilegios. La imagen base ya trae el usuario `node`.
#
# `/app` es de root, así que el directorio de datos hay que crearlo aquí y
# dárselo a `node`. Sin esto, `loadConfig` intenta un `mkdirSync('./datos')` en
# cuanto falta `SESSION_SECRET` y el contenedor muere con un `EACCES` que no
# dice cuál de las dos variables es la que falta. En App Runner el directorio
# es efímero y no debe guardar nada —para eso está `DATABASE_URL`—, pero tiene
# que existir y ser escribible para que el arranque llegue a explicarse.
RUN mkdir -p /app/datos && chown node:node /app/datos

USER node

ENV HOST=0.0.0.0 \
    PORT=3001 \
    FRONTEND_DIR=/app/frontend/dist

EXPOSE 3001

# Comprobación de vida contra la ruta que ya existía. El balanceador de AWS usa
# esta misma ruta; tenerla también aquí hace que `docker run` falle rápido si el
# servicio arranca pero no responde.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node es el proceso 1, sin `npm` ni shell por delante.
#
# El apagado ordenado de `main.ts` vacía a disco los documentos que aún no se
# habían guardado, y para eso tiene que recibir el SIGTERM que manda AWS al
# retirar el contenedor. Con `npm run start` la señal tendría que atravesar npm,
# el shell que npm abre y el proceso de tsx antes de llegar a los manejadores;
# cada salto es una ocasión de que se pierda, y el síntoma —unos segundos de
# trabajo ajeno perdidos en cada despliegue— no se parece a un problema de
# señales y no habría quien lo diagnosticara.
#
# `--import tsx` en vez del binario `tsx` por lo mismo: el binario también abre
# un proceso hijo. Así solo hay uno, y es el que escucha.
CMD ["node", "--import", "tsx", "backend-tool/src/main.ts"]
