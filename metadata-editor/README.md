# Metadata Editor Pro

Editor de metadatos EXIF para **imágenes y videos** con backend Node.js + Express
y un frontend en HTML5 / CSS3 / JavaScript vanilla. Permite aplicar plantillas de
dispositivos reales, editar campos personalizados (Make, Model, Software, fecha,
GPS), leer los metadatos existentes de un archivo y aplicar metadata avanzada vía
un editor JSON.

> ⚠️ **Uso local / educativo.** El proyecto no implementa autenticación ni está
> pensado para exponerse públicamente.

## Características

- **Editar Metadata**: arrastra y suelta un archivo, elige una plantilla de
  dispositivo (grid de tarjetas con iconos), completa campos personalizados y
  descarga el archivo modificado.
- **Leer Metadata**: sube un archivo y visualiza sus metadatos en un árbol
  jerárquico expandible.
- **Metadata Personalizado**: editor JSON con validación para aplicar tags
  avanzados que se combinan al procesar en la pestaña *Editar*.
- **Imágenes** (JPG, PNG, TIFF): escritura EXIF con ExifTool (`node-exiftool`).
- **Videos** (MP4, MOV, AVI): metadata mediante `fluent-ffmpeg` con `-c copy`
  (sin re-encodear).
- Límite de subida: **500 MB**. Los archivos temporales se eliminan tras la
  descarga.

## Estructura de carpetas

```
metadata-editor/
├── server/
│   ├── server.js          # Servidor Express principal
│   ├── package.json       # Dependencias
│   ├── routes/
│   │   └── metadata.js     # Endpoints de la API
│   └── utils/
│       └── exifHelper.js   # Helpers de exiftool + plantillas de dispositivos
├── public/
│   ├── index.html          # UI con 3 pestañas: Editar, Leer, Custom
│   ├── app.js              # Lógica del frontend
│   └── styles.css          # Diseño dark mode moderno
├── uploads/                # Carpeta temporal (se limpia automáticamente)
├── .gitignore
└── README.md
```

## API

Todos los endpoints están bajo `/api/metadata`:

| Método | Ruta            | Descripción                                                        |
|--------|-----------------|--------------------------------------------------------------------|
| GET    | `/templates`    | Lista de plantillas de dispositivos `{ templates: [{id,name,icon,...}] }` |
| POST   | `/read`         | Lee la metadata del archivo subido → `{ metadata: {...} }`         |
| POST   | `/edit-image`   | Escribe metadata EXIF (JPG/PNG/TIFF) y devuelve el archivo         |
| POST   | `/edit-video`   | Aplica metadata a video (MP4/MOV/AVI) con ffmpeg y lo devuelve     |

Los endpoints `POST` reciben `multipart/form-data` con el campo `file` y,
opcionalmente, `template`, `make`, `model`, `software`, `date`, `lat`, `lon` y
`custom` (JSON en string).

`edit-image` y `edit-video` validan en el servidor que el archivo coincida con el
tipo esperado (por extensión/MIME) y devuelven **400** si no coincide (por
ejemplo, subir un video a `edit-image`), en vez de fallar con un 500 opaco.

Plantillas incluidas: `rayban-meta`, `iphone-15-pro`, `samsung-s24-ultra`,
`gopro-hero12`, `sony-a7iv`, `dji-mavic3`.

### Coordenadas GPS (`lat` / `lon`)

Se aceptan dos formatos, y ambos coinciden con lo que sugiere la UI:

- Decimal con signo: `40.7128`, `-74.0060`.
- Decimal con sufijo cardinal: `40.7128 N`, `74.0060 W` (con o sin espacio).

El sufijo cardinal tiene prioridad sobre el signo (`S`/`W` fuerzan valor
negativo). Un valor vacío o no numérico simplemente no escribe GPS.

### Metadata en video (subconjunto)

Los contenedores MP4/MOV/AVI **no** llevan la óptica EXIF completa. `edit-video`
mapea solo `make`, `model`, `encoder` y `creation_time`, con precedencia
explícita: `Make` gana sobre `DeviceManufacturer` y `Model` sobre `DeviceModel`.
Los campos no soportados (apertura, ISO, lente, distancia focal, etc.) se
informan al cliente mediante las cabeceras `X-Applied-Metadata` y
`X-Ignored-Metadata`, y el frontend muestra un aviso con lo aplicado e ignorado
en lugar de descartarlo en silencio.

## Instalación y uso

### 1. Instalar dependencias de Node

```bash
cd metadata-editor/server
npm install
```

### 2. Instalar ExifTool (según el sistema operativo)

```bash
# macOS
brew install exiftool

# Linux (Debian/Ubuntu)
sudo apt-get install libimage-exiftool-perl

# Windows
# Descargar desde https://exiftool.org/
```

> El backend **prefiere un `exiftool` de sistema en el PATH** (instalado vía
> `libimage-exiftool-perl` en Linux o `brew install exiftool` en macOS), porque
> es el más fiable dentro de contenedores. Si no encuentra uno, cae al binario
> empaquetado por `dist-exiftool` (útil para dev local sin instalación de
> sistema). El orden de resolución es: `EXIFTOOL_PATH` → `exiftool` del PATH →
> `dist-exiftool`.

#### Variables de entorno para binarios nativos

Opcionalmente puedes forzar las rutas de los binarios (útil si no están en el
PATH o quieres una versión concreta):

- `EXIFTOOL_PATH`: ruta a un ejecutable `exiftool` específico.
- `FFMPEG_PATH`: ruta a un ejecutable `ffmpeg` específico.
- `FFPROBE_PATH`: ruta a un ejecutable `ffprobe` específico.

Si no se definen, el backend resuelve `exiftool`, `ffmpeg` y `ffprobe` desde el
PATH del sistema (en el contenedor los proveen `libimage-exiftool-perl` y el
paquete `ffmpeg` de Debian).

### 3. Instalar ffmpeg (requerido para editar metadata de videos)

```bash
# macOS
brew install ffmpeg

# Linux (Debian/Ubuntu)
sudo apt-get install ffmpeg

# Windows
# Descargar desde https://ffmpeg.org/download.html
```

### 4. Iniciar el servidor

```bash
npm start
```

### 5. Abrir en el navegador

```
http://localhost:3000
```

### Configuración de red (`HOST` / `PORT`)

Como la herramienta fabrica identidad de cámara y coordenadas GPS y **no tiene
autenticación**, el servidor se enlaza a `127.0.0.1` por defecto para no
exponer un servicio anónimo de falsificación de metadata en una interfaz
enrutable. Se puede sobreescribir con variables de entorno si entiendes el
riesgo (por ejemplo, en un laboratorio aislado):

```bash
HOST=0.0.0.0 PORT=3000 npm start
```

## Despliegue

### Por qué Vercel (y el serverless en general) NO funciona

Esta app **no** es un sitio estático ni una colección de funciones serverless.
Es un servidor **Express de proceso persistente** que además **ejecuta binarios
nativos del sistema** (`exiftool` y `ffmpeg`). Vercel y plataformas similares
fallan por tres motivos:

- **No hay proceso persistente.** El serverless levanta funciones efímeras por
  petición; no mantiene vivo un servidor Express con estado ni la carpeta
  temporal `uploads/`.
- **No hay binarios de sistema.** `fluent-ffmpeg` necesita el binario `ffmpeg`
  instalado, y `exiftool` requiere `perl` en tiempo de ejecución. Esos binarios
  no existen en las funciones serverless.
- **Hosting estático servía basura.** Al no ejecutar el backend, Vercel sirvió
  como sitio estático los **archivos semilla obsoletos de la raíz del repo**
  (`index.html`, `app.js`, `Javascript*.js`, `json.txt`, `bash.txt`), que son
  restos previos a la app real. De ahí la página sin estilos y la API caída.

La solución (Opción C) es desplegar en una plataforma que soporte un proceso
Express persistente **y** binarios de sistema: **Render / Railway / Fly.io / un
VPS con Docker**. El `Dockerfile` de `metadata-editor/` instala `ffmpeg` y
`libimage-exiftool-perl` y arranca el servidor.

### Opción 1: Docker en local

Desde la raíz del repo (el contexto de build es `metadata-editor/`):

```bash
docker build -t metadata-editor ./metadata-editor
docker run -p 3000:3000 metadata-editor
```

Luego abre:

```
http://localhost:3000
```

Deberías ver la UI dark mode completa (no la página semilla sin estilos).

### Opción 2: Render (blueprint)

El repo incluye un blueprint `render.yaml` en la raíz. Pasos:

1. En Render: **New > Blueprint**.
2. Conecta este repositorio; Render leerá `render.yaml` automáticamente.
3. El blueprint define un servicio web **Docker** que construye desde
   `./metadata-editor/Dockerfile` con contexto `./metadata-editor`, expone un
   health check en `/` y fija `HOST=0.0.0.0`.
4. Render **inyecta `PORT` automáticamente** y `server.js` ya lo respeta.
5. Despliega y abre la URL pública que te asigne Render.

### Opción 3: Railway (nota)

Railway también sirve: crea un servicio **desde el Dockerfile**, fija el
directorio raíz / contexto del build a `metadata-editor/`, deja que Railway
**inyecte `PORT`** y añade la variable de entorno `HOST=0.0.0.0`.

### Sobre `HOST=0.0.0.0` y la exposición sin autenticación

El código usa `HOST=127.0.0.1` por defecto **a propósito**: esta herramienta
fabrica identidad de cámara y coordenadas GPS y **no tiene autenticación**.
Para que el contenedor sea alcanzable, el `Dockerfile` y el blueprint fijan
`HOST=0.0.0.0`, lo que expone un servicio anónimo de falsificación de metadata
en una interfaz enrutable. **Despliega solo en un contexto controlado / privado**
y considera añadir autenticación o restricción de acceso antes de exponerlo
públicamente.

> Los archivos de la raíz del repo (`index.html`, `app.js`, `Javascript*.js`,
> `json.txt`, `bash.txt`) son semillas obsoletas que la app **no** usa. Se
> conservan a propósito; el despliegue está acotado a `metadata-editor/` vía
> `dockerContext` / `dockerfilePath`, así que nunca se sirven.

## Nota sobre el entorno de build (sandbox)

Este proyecto se generó en un entorno con red restringida (sin acceso externo).
**No fue posible ejecutar `npm install`, `docker build` ni `docker run`** dentro
del sandbox porque no hay acceso al registro de npm ni a Docker Hub, y los
binarios de `exiftool` y `ffmpeg` no estaban presentes ni eran instalables. En
consecuencia, la verificación en el sandbox se limitó a la **validación estática
de sintaxis** (`node --check` sobre los `.js`, y validación de `package.json` /
`render.yaml` / `Dockerfile`).

**La construcción de la imagen y la ejecución en tiempo real NO se ejecutaron en
este sandbox offline y deben ser verificadas por el usuario fuera del sandbox:**

```bash
docker build -t metadata-editor ./metadata-editor
docker run -p 3000:3000 metadata-editor
# abrir http://localhost:3000 y probar editar/leer imagen y video
```

y, para el despliegue gestionado, el blueprint de Render (o Railway) descrito
arriba.

### Corrección del HTTP 500 al procesar (imagen/video)

Se corrigió un **HTTP 500** que ocurría en Render/Docker al subir un archivo y
pulsar *Procesar* (endpoints `POST /api/metadata/edit-image` y
`POST /api/metadata/edit-video`). Cambios clave:

- **Imagen**: `exifHelper.js` ahora resuelve el binario de exiftool con la
  precedencia `EXIFTOOL_PATH` → `exiftool` del PATH → `dist-exiftool`, en vez de
  usar siempre el binario empaquetado (v10.53), que suele fallar dentro de
  contenedores Debian slim.
- **Video**: `routes/metadata.js` ahora envía cada tag `-metadata` como **una
  sola cadena** (`-metadata clave=valor`) a `fluent-ffmpeg`, en lugar de partir
  el flag y su valor en dos elementos del array de `outputOptions`. Además
  honra `FFMPEG_PATH` / `FFPROBE_PATH` si están definidos.
- **Visibilidad de errores**: los tres endpoints (`/read`, `/edit-image`,
  `/edit-video`) ahora registran el error completo con `console.error` (visible
  en los logs de Render) y garantizan un mensaje de error no vacío hacia el
  cliente.

> ⚠️ **Esta corrección se validó ESTÁTICAMENTE únicamente** (`node --check` sobre
> los `.js` y validación de `package.json`), porque el sandbox está sin red y no
> tiene los binarios `exiftool` / `ffmpeg` ni `node_modules` instalados. **Debe
> confirmarse por el usuario** redesplegando en Render (o con `docker build` +
> `docker run` en local) y repitiendo el flujo *subir archivo → Procesar* con
> **una imagen y un video**.
