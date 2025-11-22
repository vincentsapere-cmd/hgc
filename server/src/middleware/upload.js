/**
 * Secure File Upload Middleware
 * Handles image uploads with validation, sanitization, and processing
 */

import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { ValidationError } from './errorHandler.js';
import { logger, logSecurityEvent } from '../utils/logger.js';

// Ensure upload directory exists
const ensureUploadDir = (subDir = '') => {
  const dir = path.join(config.uploadDir, subDir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

// Initialize directories
ensureUploadDir('products');
ensureUploadDir('categories');
ensureUploadDir('temp');

/**
 * Generate secure filename
 */
const generateSecureFilename = (originalName) => {
  const ext = path.extname(originalName).toLowerCase();
  const timestamp = Date.now();
  const randomBytes = crypto.randomBytes(16).toString('hex');
  return `${timestamp}-${randomBytes}${ext}`;
};

/**
 * Validate file is actually an image by checking magic bytes
 */
const validateImageMagicBytes = (buffer) => {
  const signatures = {
    'image/jpeg': [0xFF, 0xD8, 0xFF],
    'image/png': [0x89, 0x50, 0x4E, 0x47],
    'image/gif': [0x47, 0x49, 0x46],
    'image/webp': [0x52, 0x49, 0x46, 0x46] // RIFF header (WebP starts with RIFF...WEBP)
  };

  for (const [mimeType, signature] of Object.entries(signatures)) {
    const matches = signature.every((byte, index) => buffer[index] === byte);
    if (matches) {
      // Additional check for WebP
      if (mimeType === 'image/webp') {
        const webpSignature = Buffer.from('WEBP');
        if (buffer.slice(8, 12).equals(webpSignature)) {
          return mimeType;
        }
      } else {
        return mimeType;
      }
    }
  }

  return null;
};

/**
 * Multer storage configuration - store in memory for processing
 */
const storage = multer.memoryStorage();

/**
 * File filter for allowed types
 */
const fileFilter = (req, file, cb) => {
  // Check MIME type
  if (!config.allowedFileTypes.includes(file.mimetype)) {
    logSecurityEvent('upload_rejected_mimetype', {
      mimetype: file.mimetype,
      filename: file.originalname,
      ip: req.ip,
      userId: req.user?.id
    });
    return cb(new ValidationError(`File type ${file.mimetype} is not allowed`), false);
  }

  // Check extension
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  if (!allowedExtensions.includes(ext)) {
    logSecurityEvent('upload_rejected_extension', {
      extension: ext,
      filename: file.originalname,
      ip: req.ip,
      userId: req.user?.id
    });
    return cb(new ValidationError(`File extension ${ext} is not allowed`), false);
  }

  cb(null, true);
};

/**
 * Multer upload instance
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.maxFileSize,
    files: 10 // Max 10 files per request
  }
});

/**
 * Process and save uploaded image
 */
const processAndSaveImage = async (buffer, options = {}) => {
  const {
    subDir = 'products',
    maxWidth = 1200,
    maxHeight = 1200,
    quality = 85,
    format = 'webp'
  } = options;

  // Validate magic bytes
  const detectedType = validateImageMagicBytes(buffer);
  if (!detectedType) {
    throw new ValidationError('File does not appear to be a valid image');
  }

  // Generate filename
  const filename = generateSecureFilename(`image.${format}`);
  const uploadDir = ensureUploadDir(subDir);
  const filepath = path.join(uploadDir, filename);

  // Process with sharp - this also strips EXIF data for privacy
  let sharpInstance = sharp(buffer)
    .resize(maxWidth, maxHeight, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .rotate(); // Auto-rotate based on EXIF

  // Convert to specified format
  switch (format) {
    case 'webp':
      sharpInstance = sharpInstance.webp({ quality });
      break;
    case 'jpeg':
    case 'jpg':
      sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });
      break;
    case 'png':
      sharpInstance = sharpInstance.png({ quality, compressionLevel: 9 });
      break;
    default:
      sharpInstance = sharpInstance.webp({ quality });
  }

  // Save processed image
  await sharpInstance.toFile(filepath);

  // Get file info
  const stats = fs.statSync(filepath);

  logger.info('Image processed and saved', {
    filename,
    originalType: detectedType,
    outputFormat: format,
    size: stats.size
  });

  return {
    filename,
    path: filepath,
    url: `/uploads/${subDir}/${filename}`,
    size: stats.size,
    format
  };
};

/**
 * Middleware for single image upload
 */
export const uploadSingleImage = (fieldName = 'image') => {
  return [
    upload.single(fieldName),
    async (req, res, next) => {
      try {
        if (!req.file) {
          return next();
        }

        const result = await processAndSaveImage(req.file.buffer, {
          subDir: req.uploadSubDir || 'products'
        });

        req.uploadedFile = result;
        next();
      } catch (error) {
        next(error);
      }
    }
  ];
};

/**
 * Middleware for multiple image upload
 */
export const uploadMultipleImages = (fieldName = 'images', maxCount = 10) => {
  return [
    upload.array(fieldName, maxCount),
    async (req, res, next) => {
      try {
        if (!req.files || req.files.length === 0) {
          return next();
        }

        const results = await Promise.all(
          req.files.map(file =>
            processAndSaveImage(file.buffer, {
              subDir: req.uploadSubDir || 'products'
            })
          )
        );

        req.uploadedFiles = results;
        next();
      } catch (error) {
        next(error);
      }
    }
  ];
};

/**
 * Delete uploaded file
 */
export const deleteUploadedFile = (filepath) => {
  try {
    // Security: Ensure path is within upload directory
    const resolvedPath = path.resolve(filepath);
    const resolvedUploadDir = path.resolve(config.uploadDir);

    if (!resolvedPath.startsWith(resolvedUploadDir)) {
      throw new Error('Invalid file path');
    }

    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
      logger.info('File deleted', { filepath: resolvedPath });
      return true;
    }
    return false;
  } catch (error) {
    logger.error('Failed to delete file', { filepath, error: error.message });
    return false;
  }
};

/**
 * Cleanup old temp files (run periodically)
 */
export const cleanupTempFiles = (maxAgeHours = 24) => {
  const tempDir = path.join(config.uploadDir, 'temp');
  if (!fs.existsSync(tempDir)) return;

  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();

  fs.readdirSync(tempDir).forEach(file => {
    const filepath = path.join(tempDir, file);
    const stats = fs.statSync(filepath);
    if (now - stats.mtimeMs > maxAgeMs) {
      fs.unlinkSync(filepath);
      logger.info('Temp file cleaned up', { filepath });
    }
  });
};

export default {
  uploadSingleImage,
  uploadMultipleImages,
  deleteUploadedFile,
  cleanupTempFiles,
  processAndSaveImage
};
