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
    res.status(500).json({ error: err.message });
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
      if (err && !res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    await safeRemove(filePath);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// POST /edit-video -> copia el video (sin re-encodear) con metadata y lo descarga
router.post('/edit-video', upload.single('file'), async function (req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibio ningun archivo.' });
  }
  const inputPath = req.file.path;
  const ext = path.extname(req.file.originalname || inputPath) || '.mp4';
  const outputPath = path.join(UPLOADS_DIR, `${uuidv4()}${ext}`);

  try {
    const tags = buildTags(req.body || {});

    // Mapeo de tags EXIF a claves de metadata reconocidas por contenedores de video.
    const videoMetaMap = {
      Make: 'make',
      Model: 'model',
      Software: 'encoder',
      DateTimeOriginal: 'creation_time',
      CreateDate: 'creation_time',
      DeviceManufacturer: 'make',
      DeviceModel: 'model'
    };

    const outputOptions = ['-c copy', '-map_metadata 0'];
    const usedKeys = new Set();
    for (const tagKey of Object.keys(tags)) {
      const metaKey = videoMetaMap[tagKey];
      if (!metaKey || usedKeys.has(metaKey)) {
        continue;
      }
      const value = String(tags[tagKey]).replace(/"/g, '');
      outputOptions.push(`-metadata`);
      outputOptions.push(`${metaKey}=${value}`);
      usedKeys.add(metaKey);
    }

    await new Promise(function (resolve, reject) {
      ffmpeg(inputPath)
        .outputOptions(outputOptions)
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    const downloadName = `edited-${req.file.originalname || path.basename(outputPath)}`;
    res.download(outputPath, downloadName, function (err) {
      // Limpieza de entrada y salida tras la descarga.
      safeRemove(inputPath);
      safeRemove(outputPath);
      if (err && !res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
  } catch (err) {
    await safeRemove(inputPath);
    await safeRemove(outputPath);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

module.exports = router;
