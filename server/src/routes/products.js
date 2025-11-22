/**
 * Product Routes
 * Public product catalog and details
 */

import express from 'express';
import { getDatabase } from '../database/init.js';
import { NotFoundError } from '../middleware/errorHandler.js';
import { paginationValidation } from '../middleware/validators.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /products
 * List all active products with filtering, sorting, and pagination
 */
router.get('/', paginationValidation, optionalAuth, async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      sort = 'created_at',
      order = 'desc',
      category,
      search,
      minPrice,
      maxPrice,
      featured
    } = req.query;

    const db = getDatabase();
    const offset = (page - 1) * limit;

    // Build query
    let whereConditions = ['p.is_active = 1'];
    const params = [];

    if (category) {
      whereConditions.push('(c.slug = ? OR c.id = ?)');
      params.push(category, category);
    }

    if (search) {
      whereConditions.push('(p.name LIKE ? OR p.description LIKE ? OR p.tags LIKE ?)');
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (minPrice) {
      whereConditions.push('p.price >= ?');
      params.push(parseFloat(minPrice));
    }

    if (maxPrice) {
      whereConditions.push('p.price <= ?');
      params.push(parseFloat(maxPrice));
    }

    if (featured === 'true') {
      whereConditions.push('p.is_featured = 1');
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Validate sort field
    const allowedSorts = ['name', 'price', 'created_at', 'mg', 'stock_quantity'];
    const sortField = allowedSorts.includes(sort) ? `p.${sort}` : 'p.created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
    `;
    const { total } = await db.prepare(countQuery).get(...params);

    // Get products
    const query = `
      SELECT
        p.id, p.sku, p.name, p.slug, p.description, p.short_description,
        p.price, p.compare_at_price, p.mg, p.unit, p.image_url, p.images,
        p.has_variations, p.is_featured, p.stock_quantity, p.track_inventory,
        p.allow_backorder, p.created_at,
        c.id as category_id, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
      ORDER BY ${sortField} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const products = await db.prepare(query).all(...params, limit, offset);

    // Get variations for products that have them
    const productIds = products.filter(p => p.has_variations).map(p => p.id);
    let variationsMap = {};

    if (productIds.length > 0) {
      const variations = await db.prepare(`
        SELECT id, product_id, name, sku, price_modifier, stock_quantity, image_url
        FROM product_variations
        WHERE product_id IN (${productIds.map(() => '?').join(',')}) AND is_active = 1
        ORDER BY sort_order
      `).all(...productIds);

      variationsMap = variations.reduce((acc, v) => {
        if (!acc[v.product_id]) acc[v.product_id] = [];
        acc[v.product_id].push(v);
        return acc;
      }, {});
    }

    // Format response
    const formattedProducts = products.map(p => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      slug: p.slug,
      description: p.description,
      shortDescription: p.short_description,
      price: p.price,
      compareAtPrice: p.compare_at_price,
      mg: p.mg,
      unit: p.unit,
      imageUrl: p.image_url,
      images: p.images ? JSON.parse(p.images) : [],
      hasVariations: !!p.has_variations,
      variations: variationsMap[p.id] || [],
      isFeatured: !!p.is_featured,
      inStock: !p.track_inventory || p.stock_quantity > 0 || p.allow_backorder,
      stockQuantity: p.track_inventory ? p.stock_quantity : null,
      category: p.category_id ? {
        id: p.category_id,
        name: p.category_name,
        slug: p.category_slug
      } : null,
      createdAt: p.created_at
    }));

    res.json({
      success: true,
      data: formattedProducts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /products/search
 * Quick search endpoint with autocomplete support
 */
router.get('/search', async (req, res, next) => {
  try {
    const { q, limit = 10 } = req.query;
    const db = getDatabase();

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const searchTerm = `%${q}%`;

    const products = await db.prepare(`
      SELECT p.id, p.name, p.slug, p.price, p.mg, p.image_url, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1 AND (p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)
      ORDER BY
        CASE WHEN p.name LIKE ? THEN 1 ELSE 2 END,
        p.name
      LIMIT ?
    `).all(searchTerm, searchTerm, searchTerm, `${q}%`, parseInt(limit));

    res.json({
      success: true,
      data: products.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        price: parseFloat(p.price),
        mg: p.mg,
        imageUrl: p.image_url,
        category: p.category_name
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /products/featured
 * Get featured products
 */
router.get('/featured', async (req, res, next) => {
  try {
    const db = getDatabase();
    const limit = parseInt(req.query.limit) || 8;

    const products = await db.prepare(`
      SELECT
        p.id, p.sku, p.name, p.slug, p.price, p.compare_at_price,
        p.mg, p.unit, p.image_url, p.has_variations,
        c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1 AND p.is_featured = 1
      ORDER BY p.created_at DESC
      LIMIT ?
    `).all(limit);

    res.json({
      success: true,
      data: products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        slug: p.slug,
        price: p.price,
        compareAtPrice: p.compare_at_price,
        mg: p.mg,
        unit: p.unit,
        imageUrl: p.image_url,
        hasVariations: !!p.has_variations,
        categoryName: p.category_name
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /products/categories
 * Get all active categories
 */
router.get('/categories', async (req, res, next) => {
  try {
    const db = getDatabase();

    const categories = await db.prepare(`
      SELECT c.id, c.name, c.slug, c.description, c.image_url,
        COUNT(p.id) as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id AND p.is_active = 1
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY c.sort_order, c.name
    `).all();

    res.json({
      success: true,
      data: categories.map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: c.image_url,
        productCount: c.product_count
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /products/:idOrSlug
 * Get single product by ID or slug
 */
router.get('/:idOrSlug', optionalAuth, async (req, res, next) => {
  try {
    const { idOrSlug } = req.params;
    const db = getDatabase();

    const product = await db.prepare(`
      SELECT
        p.*, c.id as category_id, c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE (p.id = ? OR p.slug = ?) AND p.is_active = 1
    `).get(idOrSlug, idOrSlug);

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    // Get variations
    const variations = await db.prepare(`
      SELECT id, name, sku, price_modifier, stock_quantity, image_url
      FROM product_variations
      WHERE product_id = ? AND is_active = 1
      ORDER BY sort_order
    `).all(product.id);

    // Get reviews
    const reviews = await db.prepare(`
      SELECT r.id, r.rating, r.title, r.content, r.is_verified_purchase,
        r.helpful_count, r.created_at, u.first_name
      FROM product_reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.product_id = ? AND r.is_approved = 1
      ORDER BY r.created_at DESC
      LIMIT 10
    `).all(product.id);

    // Calculate average rating
    const ratingStats = await db.prepare(`
      SELECT AVG(rating) as average, COUNT(*) as count
      FROM product_reviews
      WHERE product_id = ? AND is_approved = 1
    `).get(product.id);

    // Track view (if user logged in)
    if (req.user) {
      await db.prepare(`
        INSERT INTO product_performance (id, product_id, date, views)
        VALUES (?, ?, date('now'), 1)
        ON CONFLICT(product_id, date) DO UPDATE SET views = views + 1
      `).run(`${product.id}-${new Date().toISOString().split('T')[0]}`, product.id);
    }

    res.json({
      success: true,
      data: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        slug: product.slug,
        description: product.description,
        shortDescription: product.short_description,
        price: product.price,
        compareAtPrice: product.compare_at_price,
        mg: product.mg,
        unit: product.unit,
        weight: product.weight,
        weightUnit: product.weight_unit,
        imageUrl: product.image_url,
        images: product.images ? JSON.parse(product.images) : [],
        hasVariations: !!product.has_variations,
        variations,
        isFeatured: !!product.is_featured,
        isTaxable: !!product.is_taxable,
        requiresShipping: !!product.requires_shipping,
        inStock: !product.track_inventory || product.stock_quantity > 0 || product.allow_backorder,
        stockQuantity: product.track_inventory ? product.stock_quantity : null,
        lowStockThreshold: product.low_stock_threshold,
        category: product.category_id ? {
          id: product.category_id,
          name: product.category_name,
          slug: product.category_slug
        } : null,
        metaTitle: product.meta_title,
        metaDescription: product.meta_description,
        tags: product.tags ? JSON.parse(product.tags) : [],
        reviews: {
          average: ratingStats.average || 0,
          count: ratingStats.count || 0,
          items: reviews.map(r => ({
            id: r.id,
            rating: r.rating,
            title: r.title,
            content: r.content,
            verifiedPurchase: !!r.is_verified_purchase,
            helpfulCount: r.helpful_count,
            author: r.first_name,
            createdAt: r.created_at
          }))
        },
        createdAt: product.created_at
      }
    });

  } catch (error) {
    next(error);
  }
});

export default router;
