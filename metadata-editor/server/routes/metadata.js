'use strict';

/**
 * routes/metadata.js
 *
 * Router de Express que expone la API del editor de metadata:
 *   GET  /templates    -> lista de plantillas de dispositivos
 *   POST /read         -> lee la metadata de un archivo subido
 *   POST /edit-image   -> escribe metadata EXIF en una imagen y la descarga
 *   POST /edit-video   -> escribe metadata en un video (sin re-encodear) y lo descarga
 */

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

// Permitimos overrides explicitos de los binarios de ffmpeg/ffprobe via env.
// Si no se definen, fluent-ffmpeg los resuelve del PATH (el paquete apt
// `ffmpeg` de Debian provee tanto ffmpeg como ffprobe en el PATH por defecto).
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}
if (process.env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
}

const {
  DEVICE_TEMPLATES,
  readMetadata,
  writeImageMetadata,
  buildTagsFromCustom
} = require('../utils/exifHelper');

const router = express.Router();

// Carpeta temporal para uploads: metadata-editor/uploads
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
fs.ensureDirSync(UPLOADS_DIR);

// Extensiones/MIME aceptados por cada endpoint de edicion. La seleccion de
// endpoint la hace el cliente, pero el servidor tambien valida para dar un
// 400 claro (en vez de un 500 opaco de exiftool/ffmpeg) a cualquier llamador.
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'];
const VIDEO_EXTS = ['.mp4', '.mov', '.avi', '.m4v', '.mkv'];

/**
 * Comprueba que el archivo subido concuerda con el tipo esperado por el
 * endpoint, mirando extension y (si esta disponible) el MIME.
 * @param {Object} file objeto de Multer (req.file)
 * @param {string} kind 'image' | 'video'
 * @returns {boolean}
 */
function fileMatchesKind(file, kind) {
  if (!file) {
    return false;
  }
  const ext = path.extname(file.originalname || file.path || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();
  if (kind === 'image') {
    return IMAGE_EXTS.indexOf(ext) !== -1 || mime.indexOf('image/') === 0;
  }
  if (kind === 'video') {
    return VIDEO_EXTS.indexOf(ext) !== -1 || mime.indexOf('video/') === 0;
  }
  return false;
}

// Campos EXIF de las plantillas que NO se envian a video (solo aplican a imagen).
// Para video se usan como -metadata make/model/etc.

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || '');
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB
});

/**
 * Elimina un archivo temporal sin lanzar excepciones.
 * @param {string} filePath ruta
 */
async function safeRemove(filePath) {
  if (!filePath) {
    return;
  }
  try {
    await fs.remove(filePath);
  } catch (err) {
    // Silencioso: la limpieza no debe romper la respuesta.
  }
}

/**
 * Parsea el campo `custom` del body que puede llegar como JSON string o como
 * objeto (segun el content-type). Devuelve un objeto plano.
 * @param {*} raw valor recibido
 * @returns {Object}
 */
function parseCustom(raw) {
  if (!raw) {
    return {};
  }
  if (typeof raw === 'object') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

/**
 * Construye el conjunto final de tags combinando la plantilla del dispositivo,
 * un objeto custom (JSON avanzado) y los campos individuales del formulario.
 * @param {Object} body body de la peticion
 * @returns {Object} tags EXIF
 */
function buildTags(body) {
  let tags = {};

  // 1) Plantilla del dispositivo (sin campos de presentacion name/icon).
  if (body.template && DEVICE_TEMPLATES[body.template]) {
    const template = DEVICE_TEMPLATES[body.template];
    for (const key of Object.keys(template)) {
      if (key === 'name' || key === 'icon') {
        continue;
      }
      tags[key] = template[key];
    }
  }

  // 2) Campos del formulario simple (make/model/software/date/lat/lon).
  const formTags = buildTagsFromCustom({
    make: body.make,
    model: body.model,
    software: body.software,
    date: body.date,
    lat: body.lat,
    lon: body.lon
  });
  tags = Object.assign(tags, formTags);

  // 3) JSON custom avanzado (tiene la maxima prioridad).
  const custom = parseCustom(body.custom);
  tags = Object.assign(tags, custom);

  return tags;
}

// GET /templates -> lista de plantillas como array {id, name, icon, ...fields}
router.get('/templates', function (req, res) {
  try {
    const list = Object.keys(DEVICE_TEMPLATES).map(function (id) {
      return Object.assign({ id: id }, DEVICE_TEMPLATES[id]);
    });
    res.json({ templates: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /read -> lee metadata y elimina el temporal
router.post('/read', upload.single('file'), async function (req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibio ningun archivo.' });
  }
  const filePath = req.file.path;
  try {
    const metadata = await readMetadata(filePath);
    res.json({ metadata: metadata });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[POST /api/metadata/read] error:', err && err.stack ? err.stack : err);
    res.status(500).json({
      error: (err && err.message) || 'Error interno al leer la metadata del archivo.'
    });
  } finally {
    await safeRemove(filePath);
  }
});

// POST /edit-image -> escribe metadata EXIF y descarga el archivo modificado
router.post('/edit-image', upload.single('file'), async function (req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibio ningun archivo.' });
  }
  const filePath = req.file.path;

  if (!fileMatchesKind(req.file, 'image')) {
    await safeRemove(filePath);
    return res.status(400).json({
      error: 'El archivo no es una imagen soportada (JPG, PNG, TIFF). ' +
        'Usa /edit-video para archivos de video.'
    });
  }

  try {
    const tags = buildTags(req.body || {});
    if (Object.keys(tags).length === 0) {
      await safeRemove(filePath);
      return res.status(400).json({ error: 'No se proporciono metadata para escribir.' });
    }

    await writeImageMetadata(filePath, tags);

    const downloadName = `edited-${req.file.originalname || path.basename(filePath)}`;
    res.download(filePath, downloadName, function (err) {
      // Limpieza tras finalizar la descarga (con o sin error de streaming).
      safeRemove(filePath);
      if (err) {
        // eslint-disable-next-line no-console
        console.error('[POST /api/metadata/edit-image] download error:', err && err.stack ? err.stack : err);
        if (!res.headersSent) {
          res.status(500).json({
            error: (err && err.message) || 'Error interno al descargar la imagen procesada.'
          });
        }
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[POST /api/metadata/edit-image] error:', err && err.stack ? err.stack : err);
    await safeRemove(filePath);
    if (!res.headersSent) {
      res.status(500).json({
        error: (err && err.message) || 'Error interno al procesar la imagen.'
      });
    }
  }
});

// POST /edit-video -> copia el video (sin re-encodear) con metadata y lo descarga
router.post('/edit-video', upload.single('file'), async function (req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibio ningun archivo.' });
  }
  const inputPath = req.file.path;

  if (!fileMatchesKind(req.file, 'video')) {
    await safeRemove(inputPath);
    return res.status(400).json({
      error: 'El archivo no es un video soportado (MP4, MOV, AVI). ' +
        'Usa /edit-image para imagenes.'
    });
  }

  const ext = path.extname(req.file.originalname || inputPath) || '.mp4';
  const outputPath = path.join(UPLOADS_DIR, `${uuidv4()}${ext}`);

  try {
    const tags = buildTags(req.body || {});

    // Los contenedores de video (MP4/MOV/AVI) solo llevan un subconjunto de la
    // metadata EXIF. Cada clave de contenedor tiene una lista de tags EXIF
    // candidatos en ORDEN DE PRECEDENCIA explicito: se usa el primero presente.
    // Esto hace determinista la colision Make/DeviceManufacturer y
    // Model/DeviceModel (el tag "principal" gana sobre el de "device").
    const videoMetaPrecedence = {
      make: ['Make', 'DeviceManufacturer'],
      model: ['Model', 'DeviceModel'],
      encoder: ['Software'],
      creation_time: ['DateTimeOriginal', 'CreateDate']
    };

    // Construimos el comando ffmpeg como variable para poder anadir cada
    // -metadata con la forma de DOS argumentos, que fluent-ffmpeg NO parte por
    // espacios (ver nota mas abajo).
    const command = ffmpeg(inputPath);

    // `-c copy` y `-map_metadata 0` se pasan como un array de un solo argumento:
    // fluent-ffmpeg parte cada cadena "flag valor" en dos tokens SOLO cuando
    // resultan exactamente 2 partes, y estos dos casos cumplen esa condicion
    // ('-c copy' -> ['-c','copy'], '-map_metadata 0' -> ['-map_metadata','0']).
    command.outputOptions(['-c copy', '-map_metadata 0']);

    const appliedTags = [];
    for (const metaKey of Object.keys(videoMetaPrecedence)) {
      const candidates = videoMetaPrecedence[metaKey];
      let chosenTag = null;
      for (const tagName of candidates) {
        if (tags[tagName] !== undefined && tags[tagName] !== null && tags[tagName] !== '') {
          chosenTag = tagName;
          break;
        }
      }
      if (!chosenTag) {
        continue;
      }
      const value = String(tags[chosenTag]);
      // IMPORTANTE: usamos la forma de DOS argumentos .outputOption(flag, valor).
      // fluent-ffmpeg ^2.1.2 (lib/options/custom.js) solo parte una opcion por
      // espacios cuando se la llama con UN unico argumento; con multiples
      // argumentos hace doSplit=false y empuja cada argumento intacto. Asi, un
      // valor con espacios (ej. Model 'Meta RW4008', Software 'Meta View 1.0' o
      // un creation_time 'YYYY:MM:DD HH:MM:SS') se conserva como UN solo token
      // argv y no corrompe el comando ffmpeg (el bug que causaba el 500).
      command.outputOption('-metadata', `${metaKey}=${value}`);
      appliedTags.push(chosenTag);
    }

    // Campos EXIF presentes que los contenedores de video no soportan (optica,
    // lentes, etc.). Se informan al cliente para que avise al usuario en vez de
    // descartarlos en silencio.
    const ignoredTags = Object.keys(tags).filter(function (tagName) {
      return appliedTags.indexOf(tagName) === -1;
    });

    // Exponemos que se aplico y que se ignoro via cabeceras (la respuesta es una
    // descarga binaria, asi que no podemos usar el cuerpo JSON). El frontend las
    // lee para mostrar un aviso.
    res.setHeader('X-Applied-Metadata', appliedTags.join(','));
    res.setHeader('X-Ignored-Metadata', ignoredTags.join(','));
    res.setHeader('Access-Control-Expose-Headers', 'X-Applied-Metadata, X-Ignored-Metadata');

    await new Promise(function (resolve, reject) {
      command
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    const downloadName = `edited-${req.file.originalname || path.basename(outputPath)}`;
    res.download(outputPath, downloadName, function (err) {
      // Limpieza de entrada y salida tras la descarga.
      safeRemove(inputPath);
      safeRemove(outputPath);
      if (err) {
        // eslint-disable-next-line no-console
        console.error('[POST /api/metadata/edit-video] download error:', err && err.stack ? err.stack : err);
        if (!res.headersSent) {
          res.status(500).json({
            error: (err && err.message) || 'Error interno al descargar el video procesado.'
          });
        }
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[POST /api/metadata/edit-video] error:', err && err.stack ? err.stack : err);
    await safeRemove(inputPath);
    await safeRemove(outputPath);
    if (!res.headersSent) {
      res.status(500).json({
        error: (err && err.message) || 'Error interno al procesar el video.'
      });
    }
  }
});

module.exports = router;
