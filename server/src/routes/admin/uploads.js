/**
 * Admin Upload Routes
 * Secure file upload endpoints for admin users
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { uploadSingleImage, uploadMultipleImages, deleteUploadedFile } from '../../middleware/upload.js';
import { ValidationError, NotFoundError } from '../../middleware/errorHandler.js';
import { logAuditEvent, logger } from '../../utils/logger.js';
import { getDatabase } from '../../database/init.js';

const router = express.Router();

/**
 * POST /admin/uploads/product-image
 * Upload a single product image
 */
router.post('/product-image', (req, res, next) => {
  req.uploadSubDir = 'products';
  next();
}, ...uploadSingleImage('image'), async (req, res, next) => {
  try {
    if (!req.uploadedFile) {
      throw new ValidationError('No image file provided');
    }

    logAuditEvent(req.user.id, 'product_image_uploaded', 'upload', req.uploadedFile.filename, {
      url: req.uploadedFile.url,
      size: req.uploadedFile.size
    }, req.ip);

    res.json({
      success: true,
      data: {
        url: req.uploadedFile.url,
        filename: req.uploadedFile.filename,
        size: req.uploadedFile.size
      },
      message: 'Image uploaded successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/uploads/product-images
 * Upload multiple product images
 */
router.post('/product-images', (req, res, next) => {
  req.uploadSubDir = 'products';
  next();
}, ...uploadMultipleImages('images', 10), async (req, res, next) => {
  try {
    if (!req.uploadedFiles || req.uploadedFiles.length === 0) {
      throw new ValidationError('No image files provided');
    }

    logAuditEvent(req.user.id, 'product_images_uploaded', 'upload', null, {
      count: req.uploadedFiles.length,
      files: req.uploadedFiles.map(f => f.filename)
    }, req.ip);

    res.json({
      success: true,
      data: req.uploadedFiles.map(f => ({
        url: f.url,
        filename: f.filename,
        size: f.size
      })),
      message: `${req.uploadedFiles.length} images uploaded successfully`
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/uploads/category-image
 * Upload a category image
 */
router.post('/category-image', (req, res, next) => {
  req.uploadSubDir = 'categories';
  next();
}, ...uploadSingleImage('image'), async (req, res, next) => {
  try {
    if (!req.uploadedFile) {
      throw new ValidationError('No image file provided');
    }

    logAuditEvent(req.user.id, 'category_image_uploaded', 'upload', req.uploadedFile.filename, {
      url: req.uploadedFile.url
    }, req.ip);

    res.json({
      success: true,
      data: {
        url: req.uploadedFile.url,
        filename: req.uploadedFile.filename,
        size: req.uploadedFile.size
      },
      message: 'Category image uploaded successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/uploads/:filename
 * Delete an uploaded file
 */
router.delete('/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const { subDir = 'products' } = req.query;

    // Validate filename (prevent directory traversal)
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new ValidationError('Invalid filename');
    }

    // Validate subDir
    const allowedDirs = ['products', 'categories'];
    if (!allowedDirs.includes(subDir)) {
      throw new ValidationError('Invalid directory');
    }

    const filepath = `${process.cwd()}/uploads/${subDir}/${filename}`;
    const deleted = deleteUploadedFile(filepath);

    if (!deleted) {
      throw new NotFoundError('File not found');
    }

    logAuditEvent(req.user.id, 'file_deleted', 'upload', filename, { subDir }, req.ip);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/uploads/stats
 * Get upload statistics
 */
router.get('/stats', async (req, res, next) => {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const { config } = await import('../../config/index.js');

    const stats = {
      products: { count: 0, size: 0 },
      categories: { count: 0, size: 0 },
      total: { count: 0, size: 0 }
    };

    const countDir = (dirPath, key) => {
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        files.forEach(file => {
          const filePath = path.join(dirPath, file);
          const fileStat = fs.statSync(filePath);
          if (fileStat.isFile()) {
            stats[key].count++;
            stats[key].size += fileStat.size;
            stats.total.count++;
            stats.total.size += fileStat.size;
          }
        });
      }
    };

    countDir(path.join(config.uploadDir, 'products'), 'products');
    countDir(path.join(config.uploadDir, 'categories'), 'categories');

    res.json({
      success: true,
      data: {
        products: {
          files: stats.products.count,
          sizeBytes: stats.products.size,
          sizeMB: (stats.products.size / (1024 * 1024)).toFixed(2)
        },
        categories: {
          files: stats.categories.count,
          sizeBytes: stats.categories.size,
          sizeMB: (stats.categories.size / (1024 * 1024)).toFixed(2)
        },
        total: {
          files: stats.total.count,
          sizeBytes: stats.total.size,
          sizeMB: (stats.total.size / (1024 * 1024)).toFixed(2)
        },
        maxFileSizeMB: (config.maxFileSize / (1024 * 1024)).toFixed(2),
        allowedTypes: config.allowedFileTypes
      }
    });

  } catch (error) {
    next(error);
  }
});

export default router;
