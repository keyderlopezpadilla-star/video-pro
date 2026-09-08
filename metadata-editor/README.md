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

Plantillas incluidas: `rayban-meta`, `iphone-15-pro`, `samsung-s24-ultra`,
`gopro-hero12`, `sony-a7iv`, `dji-mavic3`.

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

> El backend usa el binario provisto por `dist-exiftool`, por lo que ExifTool no
> necesita estar en el PATH. Instalarlo a nivel de sistema es recomendable como
> respaldo.

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

## Nota sobre el entorno de build (sandbox)

Este proyecto se generó en un entorno con red restringida. **No fue posible
ejecutar `npm install` ni `npm start`** dentro del sandbox porque el registro de
npm respondía con `403 Forbidden` y los binarios de `exiftool` y `ffmpeg` no
estaban presentes. En consecuencia, la verificación en el sandbox se limitó a la
validación de sintaxis (`node --check`). El flujo completo debe ejecutarse en un
entorno con acceso a npm y con ExifTool y ffmpeg instalados.
