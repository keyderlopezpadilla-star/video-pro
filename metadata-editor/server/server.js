'use strict';

/**
 * server.js
 *
 * Servidor Express principal del Editor de Metadatos EXIF.
 * - Sirve el frontend estatico desde ../public
 * - Expone la API en /api/metadata
 * - Garantiza la existencia de la carpeta temporal uploads/
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const multer = require('multer');

const app = express();

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Aseguramos la carpeta temporal de uploads al arrancar.
fs.ensureDirSync(UPLOADS_DIR);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API
app.use('/api/metadata', require('./routes/metadata'));

// Frontend estatico
app.use(express.static(PUBLIC_DIR));

// Ruta raiz -> index.html del frontend
app.get('/', function (req, res) {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Manejador global de errores (incluye limite de tamano de Multer)
// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'El archivo supera el limite de 500MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(500).json({ error: err.message || 'Error interno del servidor.' });
  }
  return next();
});

app.listen(PORT, function () {
  // eslint-disable-next-line no-console
  console.log(`Editor de Metadatos EXIF corriendo en http://localhost:${PORT}`);
});

module.exports = app;
