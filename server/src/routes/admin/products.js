/**
 * Admin Product Management Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../database/init.js';
import { createProductValidation, updateProductValidation } from '../../middleware/validators.js';
import { NotFoundError, ConflictError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../../utils/logger.js';

const router = express.Router();

/**
 * Allowed sort columns - strict whitelist to prevent SQL injection
 */
const ALLOWED_SORT_COLUMNS = {
  'name': 'p.name',
  'price': 'p.price',
  'stock_quantity': 'p.stock_quantity',
  'created_at': 'p.created_at',
  'updated_at': 'p.updated_at',
  'sku': 'p.sku',
  'is_active': 'p.is_active',
  'is_featured': 'p.is_featured'
};

/**
 * Safely get sort column from whitelist
 */
const getSafeSort = (sort) => {
  return ALLOWED_SORT_COLUMNS[sort] || ALLOWED_SORT_COLUMNS['created_at'];
};

/**
 * Safely get sort direction
 */
const getSafeOrder = (order) => {
  return order?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
};

/**
 * GET /admin/products
 * List all products with admin details
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, category, status, sort = 'created_at', order = 'desc' } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();

    // Validate pagination params
    const safePage = Math.max(1, parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const safeOffset = (safePage - 1) * safeLimit;

    let whereConditions = [];
    const params = [];

    if (search) {
      whereConditions.push('(p.name LIKE ? OR p.sku LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (category) {
      whereConditions.push('p.category_id = ?');
      params.push(category);
    }

    if (status === 'active') {
      whereConditions.push('p.is_active = 1');
    } else if (status === 'inactive') {
      whereConditions.push('p.is_active = 0');
    } else if (status === 'low_stock') {
      whereConditions.push('p.track_inventory = 1 AND p.stock_quantity <= p.low_stock_threshold');
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Use safe sort column and direction from whitelist
    const safeSort = getSafeSort(sort);
    const safeOrder = getSafeOrder(order);

    const totalResult = await db.prepare(`SELECT COUNT(*) as count FROM products p ${whereClause}`).get(...params);
    const total = totalResult.count;

    const products = await db.prepare(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
      ORDER BY ${safeSort} ${safeOrder}
      LIMIT ? OFFSET ?
    `).all(...params, safeLimit, safeOffset);

    res.json({
      success: true,
      data: products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        slug: p.slug,
        price: p.price,
        compareAtPrice: p.compare_at_price,
        costPrice: p.cost_price,
        mg: p.mg,
        unit: p.unit,
        imageUrl: p.image_url,
        categoryId: p.category_id,
        categoryName: p.category_name,
        stockQuantity: p.stock_quantity,
        lowStockThreshold: p.low_stock_threshold,
        trackInventory: !!p.track_inventory,
        isActive: !!p.is_active,
        isFeatured: !!p.is_featured,
        hasVariations: !!p.has_variations,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      })),
      pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/products/:id
 * Get single product with all details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const product = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) throw new NotFoundError('Product not found');

    const variations = await db.prepare('SELECT * FROM product_variations WHERE product_id = ? ORDER BY sort_order').all(id);
    const reviews = await db.prepare(`
      SELECT r.*, u.first_name, u.last_name, u.email
      FROM product_reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.product_id = ?
      ORDER BY r.created_at DESC
    `).all(id);

    res.json({
      success: true,
      data: {
        ...product,
        images: product.images ? JSON.parse(product.images) : [],
        tags: product.tags ? JSON.parse(product.tags) : [],
        variations: variations.map(v => ({
          id: v.id,
          name: v.name,
          sku: v.sku,
          priceModifier: v.price_modifier,
          stockQuantity: v.stock_quantity,
          imageUrl: v.image_url,
          isActive: !!v.is_active,
          sortOrder: v.sort_order
        })),
        reviews: reviews.map(r => ({
          id: r.id,
          rating: r.rating,
          title: r.title,
          content: r.content,
          isApproved: !!r.is_approved,
          isVerifiedPurchase: !!r.is_verified_purchase,
          author: `${r.first_name} ${r.last_name}`,
          email: r.email,
          createdAt: r.created_at
        }))
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/products
 * Create new product
 */
router.post('/', createProductValidation, async (req, res, next) => {
  try {
    const db = getDatabase();
    const productId = uuidv4();

    const {
      sku, name, description, shortDescription, categoryId, price, compareAtPrice, costPrice,
      mg, unit, weight, weightUnit, imageUrl, images, hasVariations, isFeatured, isTaxable,
      requiresShipping, stockQuantity, lowStockThreshold, trackInventory, allowBackorder,
      metaTitle, metaDescription, tags, variations
    } = req.body;

    // Check SKU uniqueness
    const existingSku = await db.prepare('SELECT id FROM products WHERE sku = ?').get(sku);
    if (existingSku) throw new ConflictError('SKU already exists');

    // Generate slug
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const existingSlug = await db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
    const finalSlug = existingSlug ? `${slug}-${Date.now()}` : slug;

    await db.prepare(`
      INSERT INTO products (id, sku, name, slug, description, short_description, category_id, price,
        compare_at_price, cost_price, mg, unit, weight, weight_unit, image_url, images,
        has_variations, is_featured, is_taxable, requires_shipping, stock_quantity,
        low_stock_threshold, track_inventory, allow_backorder, meta_title, meta_description, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId, sku, name, finalSlug, description || null, shortDescription || null, categoryId || null,
      price, compareAtPrice || null, costPrice || null, mg || 0, unit || null, weight || null,
      weightUnit || 'oz', imageUrl || null, images ? JSON.stringify(images) : null,
      hasVariations ? 1 : 0, isFeatured ? 1 : 0, isTaxable !== false ? 1 : 0,
      requiresShipping !== false ? 1 : 0, stockQuantity || 0, lowStockThreshold || 5,
      trackInventory !== false ? 1 : 0, allowBackorder ? 1 : 0,
      metaTitle || null, metaDescription || null, tags ? JSON.stringify(tags) : null
    );

    // Add variations
    if (variations?.length) {
      const variationInsert = db.prepare(`
        INSERT INTO product_variations (id, product_id, name, sku, price_modifier, stock_quantity, image_url, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (let i = 0; i < variations.length; i++) {
        const v = variations[i];
        await variationInsert.run(uuidv4(), productId, v.name, v.sku || `${sku}-${v.name.toUpperCase().replace(/\s+/g, '-')}`,
          v.priceModifier || 0, v.stockQuantity || 0, v.imageUrl || null, i);
      }
    }

    logAuditEvent(req.user.id, 'product_created', 'product', productId, { name, sku }, req.ip);

    res.status(201).json({
      success: true,
      data: { id: productId, slug: finalSlug },
      message: 'Product created successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/products/:id
 * Update product
 */
router.put('/:id', updateProductValidation, async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const existing = await db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) throw new NotFoundError('Product not found');

    const updates = req.body;
    const fields = [];
    const values = [];

    const fieldMap = {
      name: 'name', description: 'description', shortDescription: 'short_description',
      categoryId: 'category_id', price: 'price', compareAtPrice: 'compare_at_price',
      costPrice: 'cost_price', mg: 'mg', unit: 'unit', weight: 'weight',
      weightUnit: 'weight_unit', imageUrl: 'image_url', isFeatured: 'is_featured',
      isTaxable: 'is_taxable', requiresShipping: 'requires_shipping',
      stockQuantity: 'stock_quantity', lowStockThreshold: 'low_stock_threshold',
      trackInventory: 'track_inventory', allowBackorder: 'allow_backorder',
      isActive: 'is_active', metaTitle: 'meta_title', metaDescription: 'meta_description'
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (updates[key] !== undefined) {
        fields.push(`${dbField} = ?`);
        values.push(typeof updates[key] === 'boolean' ? (updates[key] ? 1 : 0) : updates[key]);
      }
    }

    if (updates.images) {
      fields.push('images = ?');
      values.push(JSON.stringify(updates.images));
    }

    if (updates.tags) {
      fields.push('tags = ?');
      values.push(JSON.stringify(updates.tags));
    }

    if (fields.length) {
      fields.push('updated_at = datetime(\'now\')');
      values.push(id);
      await db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    // Update variations
    if (updates.variations) {
      await db.prepare('DELETE FROM product_variations WHERE product_id = ?').run(id);
      const variationInsert = db.prepare(`
        INSERT INTO product_variations (id, product_id, name, sku, price_modifier, stock_quantity, image_url, is_active, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (let i = 0; i < updates.variations.length; i++) {
        const v = updates.variations[i];
        await variationInsert.run(v.id || uuidv4(), id, v.name, v.sku, v.priceModifier || 0,
          v.stockQuantity || 0, v.imageUrl || null, v.isActive !== false ? 1 : 0, i);
      }
    }

    logAuditEvent(req.user.id, 'product_updated', 'product', id, updates, req.ip);

    res.json({ success: true, message: 'Product updated successfully' });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/products/:id
 * Delete product (soft delete)
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const result = await db.prepare('UPDATE products SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError('Product not found');

    logAuditEvent(req.user.id, 'product_deleted', 'product', id, {}, req.ip);

    res.json({ success: true, message: 'Product deleted successfully' });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/products/:id/inventory
 * Adjust inventory
 */
router.post('/:id/inventory', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adjustment, reason, variationId } = req.body;
    const db = getDatabase();

    const product = await db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(id);
    if (!product) throw new NotFoundError('Product not found');

    const newQuantity = product.stock_quantity + adjustment;
    if (newQuantity < 0) throw new ValidationError('Cannot reduce stock below 0');

    await db.prepare('UPDATE products SET stock_quantity = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newQuantity, id);

    await db.prepare(`
      INSERT INTO inventory_transactions (id, product_id, variation_id, type, quantity, previous_quantity, new_quantity, notes, created_by)
      VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?, ?)
    `).run(uuidv4(), id, variationId || null, adjustment, product.stock_quantity, newQuantity, reason || null, req.user.id);

    logAuditEvent(req.user.id, 'inventory_adjusted', 'product', id, { adjustment, reason }, req.ip);

    res.json({ success: true, data: { previousQuantity: product.stock_quantity, newQuantity } });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/products/categories
 * Get all categories for admin
 */
router.get('/categories/all', async (req, res, next) => {
  try {
    const db = getDatabase();
    const categories = await db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all();

    res.json({
      success: true,
      data: categories.map(c => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: c.image_url,
        parentId: c.parent_id,
        sortOrder: c.sort_order,
        isActive: !!c.is_active
      }))
    });

  } catch (error) {
    next(error);
  }
});

export default router;
