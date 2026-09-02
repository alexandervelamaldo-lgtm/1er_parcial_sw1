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
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY generator/package.json generator/
COPY backend-tool/package.json backend-tool/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts

COPY shared/ shared/
COPY generator/ generator/
COPY backend-tool/ backend-tool/
COPY --from=build /app/frontend/dist ./frontend/dist

# El manual. Aquí es un dato y no documentación: la guía de la herramienta lo
# lee para responder «¿cómo se hace esto?». Sin él el servicio arranca igual,
# pero con la ayuda desactivada y solo un aviso en el registro.
COPY docs/ docs/

# Node se ejecuta sin privilegios. La imagen base ya trae el usuario `node`.
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

CMD ["npm", "run", "start", "--workspace", "@app/backend-tool"]
