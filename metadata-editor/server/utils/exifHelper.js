'use strict';

/**
 * exifHelper.js
 *
 * Utilidades para leer y escribir metadata EXIF usando node-exiftool.
 * Usa el binario que provee dist-exiftool, de modo que exiftool no necesita
 * estar instalado en el PATH del sistema.
 */

const exiftoolBin = require('dist-exiftool');
const { ExiftoolProcess } = require('node-exiftool');

/**
 * Plantillas de dispositivos. Cada plantilla incluye los campos EXIF que se
 * escribiran en el archivo, ademas de un `name` legible y un `icon` (emoji)
 * usados por el grid del frontend.
 */
const DEVICE_TEMPLATES = {
  'rayban-meta': {
    name: 'Ray-Ban Meta RW4008',
    icon: '🕶️',
    Make: 'Ray-Ban',
    Model: 'Meta RW4008',
    LensMake: 'Ray-Ban',
    LensModel: 'Meta Smart Glasses Camera',
    Software: 'Meta View 1.0',
    FNumber: 2.2,
    ExposureTime: '1/60',
    ISOSpeedRatings: 100,
    FocalLength: '2.5 mm',
    DeviceManufacturer: 'Ray-Ban',
    DeviceModel: 'Meta RW4008'
  },
  'iphone-15-pro': {
    name: 'iPhone 15 Pro',
    icon: '📱',
    Make: 'Apple',
    Model: 'iPhone 15 Pro',
    LensMake: 'Apple',
    LensModel: 'iPhone 15 Pro back triple camera 6.765mm f/1.78',
    Software: 'iOS 17.4',
    FNumber: 1.78,
    ExposureTime: '1/120',
    ISOSpeedRatings: 64,
    FocalLength: '6.765 mm',
    DeviceManufacturer: 'Apple',
    DeviceModel: 'iPhone 15 Pro'
  },
  'samsung-s24-ultra': {
    name: 'Galaxy S24 Ultra',
    icon: '📲',
    Make: 'Samsung',
    Model: 'SM-S928B',
    LensMake: 'Samsung',
    LensModel: 'Galaxy S24 Ultra Main Camera',
    Software: 'One UI 6.1',
    FNumber: 1.7,
    ExposureTime: '1/100',
    ISOSpeedRatings: 50,
    FocalLength: '6.3 mm',
    DeviceManufacturer: 'Samsung',
    DeviceModel: 'Galaxy S24 Ultra'
  },
  'gopro-hero12': {
    name: 'GoPro HERO12 Black',
    icon: '🎥',
    Make: 'GoPro',
    Model: 'HERO12 Black',
    LensMake: 'GoPro',
    LensModel: 'GoPro HyperSmooth Lens',
    Software: 'HD12.01.01.10.00',
    FNumber: 2.5,
    ExposureTime: '1/240',
    ISOSpeedRatings: 100,
    FocalLength: '3 mm',
    DeviceManufacturer: 'GoPro',
    DeviceModel: 'HERO12 Black'
  },
  'sony-a7iv': {
    name: 'Sony A7 IV',
    icon: '📷',
    Make: 'Sony',
    Model: 'ILCE-7M4',
    LensMake: 'Sony',
    LensModel: 'FE 24-70mm F2.8 GM II',
    Software: 'ILCE-7M4 v2.00',
    FNumber: 2.8,
    ExposureTime: '1/250',
    ISOSpeedRatings: 200,
    FocalLength: '50 mm',
    DeviceManufacturer: 'Sony',
    DeviceModel: 'Alpha A7 IV'
  },
  'dji-mavic3': {
    name: 'DJI Mavic 3',
    icon: '🚁',
    Make: 'DJI',
    Model: 'L2D-20c',
    LensMake: 'Hasselblad',
    LensModel: 'Hasselblad L2D-20c',
    Software: 'DJI Fly 1.12',
    FNumber: 2.8,
    ExposureTime: '1/500',
    ISOSpeedRatings: 100,
    FocalLength: '24 mm',
    DeviceManufacturer: 'DJI',
    DeviceModel: 'Mavic 3'
  }
};

/**
 * Convierte una coordenada decimal a su referencia (N/S para latitud,
 * E/W para longitud).
 * @param {number} value coordenada decimal
 * @param {boolean} isLat true si es latitud
 * @returns {string} referencia cardinal
 */
function coordRef(value, isLat) {
  if (isLat) {
    return value >= 0 ? 'N' : 'S';
  }
  return value >= 0 ? 'E' : 'W';
}

/**
 * Mapea los campos del formulario personalizado a nombres de tags EXIF validos.
 * Campos soportados: make, model, software, date, lat, lon.
 * @param {Object} custom objeto con campos del formulario
 * @returns {Object} tags EXIF listos para escribir
 */
function buildTagsFromCustom(custom) {
  const tags = {};
  if (!custom || typeof custom !== 'object') {
    return tags;
  }

  if (custom.make) {
    tags.Make = custom.make;
  }
  if (custom.model) {
    tags.Model = custom.model;
  }
  if (custom.software) {
    tags.Software = custom.software;
  }
  if (custom.date) {
    // exiftool acepta el formato 'YYYY:MM:DD HH:MM:SS'. Normalizamos guiones/'T'.
    const normalized = String(custom.date)
      .replace('T', ' ')
      .replace(/-/g, ':');
    tags.DateTimeOriginal = normalized;
    tags.CreateDate = normalized;
    tags.ModifyDate = normalized;
  }

  const lat = custom.lat === undefined || custom.lat === '' ? null : Number(custom.lat);
  const lon = custom.lon === undefined || custom.lon === '' ? null : Number(custom.lon);

  if (lat !== null && !Number.isNaN(lat)) {
    tags.GPSLatitude = Math.abs(lat);
    tags.GPSLatitudeRef = coordRef(lat, true);
  }
  if (lon !== null && !Number.isNaN(lon)) {
    tags.GPSLongitude = Math.abs(lon);
    tags.GPSLongitudeRef = coordRef(lon, false);
  }

  return tags;
}

/**
 * Lee la metadata de un archivo. Siempre cierra el proceso de exiftool.
 * @param {string} filePath ruta al archivo
 * @returns {Promise<Object>} objeto de metadata (data del primer resultado)
 */
async function readMetadata(filePath) {
  const ep = new ExiftoolProcess(exiftoolBin);
  try {
    await ep.open();
    const result = await ep.readMetadata(filePath, ['-File:all']);
    if (result && result.error) {
      // exiftool puede reportar errores no fatales; los propagamos si no hay data.
      if (!result.data || result.data.length === 0) {
        throw new Error(result.error);
      }
    }
    const data = result && Array.isArray(result.data) ? result.data[0] : result && result.data;
    return data || {};
  } finally {
    try {
      if (ep.isOpen) {
        await ep.close();
      }
    } catch (closeErr) {
      // Nunca dejamos que un error de cierre oculte el resultado/error original.
    }
  }
}

/**
 * Escribe tags EXIF en un archivo (in-place). Siempre cierra el proceso.
 * @param {string} filePath ruta al archivo
 * @param {Object} tags tags EXIF a escribir
 * @returns {Promise<Object>} resultado de exiftool
 */
async function writeImageMetadata(filePath, tags) {
  const ep = new ExiftoolProcess(exiftoolBin);
  try {
    await ep.open();
    // overwrite_original evita generar copias *_original.
    const result = await ep.writeMetadata(filePath, tags, ['overwrite_original']);
    if (result && result.error && (!result.data || result.data === null)) {
      throw new Error(result.error);
    }
    return result;
  } finally {
    try {
      if (ep.isOpen) {
        await ep.close();
      }
    } catch (closeErr) {
      // Ignoramos errores de cierre.
    }
  }
}

module.exports = {
  DEVICE_TEMPLATES,
  readMetadata,
  writeImageMetadata,
  buildTagsFromCustom
};
