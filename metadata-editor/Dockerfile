# Metadata Editor Pro - imagen de despliegue
#
# Plataforma objetivo: cualquier host con proceso persistente + binarios de
# sistema (Render / Railway / Fly.io / VPS con Docker). NO sirve para Vercel
# u otros entornos serverless: la app es un servidor Express de larga vida que
# necesita los binarios nativos exiftool y ffmpeg.
#
# El contexto de build es el directorio metadata-editor/ (dockerContext), de
# modo que los archivos semilla obsoletos de la raiz del repo nunca entran a
# la imagen.
FROM node:20-bookworm-slim

# Binarios nativos requeridos en tiempo de ejecucion:
# - ffmpeg: fluent-ffmpeg NO trae binario, debe existir en el sistema.
# - libimage-exiftool-perl: perl para el exiftool de dist-exiftool y un
#   exiftool de sistema como respaldo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     ffmpeg \
     libimage-exiftool-perl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalamos dependencias primero para aprovechar la cache de capas.
# No hay package-lock.json en el repo, por lo que usamos `npm install`
# (npm ci exige lockfile). Solo dependencias de produccion.
COPY server/package.json ./server/package.json
RUN cd server && npm install --omit=dev

# Copiamos el resto del arbol metadata-editor/ preservando la disposicion
# hermana server/ + public/ + uploads/ para que server.js resuelva
# correctamente ../public y ../uploads.
COPY . .

# Aseguramos la carpeta temporal (fs.ensureDirSync tambien la crea al arrancar).
RUN mkdir -p /app/uploads

# HOST=0.0.0.0 hace el servidor alcanzable dentro del contenedor (el codigo
# usa 127.0.0.1 por defecto por seguridad; aqui lo sobreescribimos via env).
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# server.js resuelve ../public y ../uploads relativos a server/, asi que el
# proceso debe arrancar desde dentro de server/.
WORKDIR /app/server

CMD ["npm", "start"]
