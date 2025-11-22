/**
 * Admin Coupon Management Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../database/init.js';
import { createCouponValidation } from '../../middleware/validators.js';
import { NotFoundError, ConflictError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../../utils/logger.js';

const router = express.Router();

/**
 * GET /admin/coupons
 * List all coupons
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();

    let whereConditions = [];
    const params = [];

    if (search) {
      whereConditions.push('(code LIKE ? OR description LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    if (status === 'active') {
      whereConditions.push('is_active = 1 AND (expires_at IS NULL OR expires_at > datetime(\'now\'))');
    } else if (status === 'expired') {
      whereConditions.push('expires_at <= datetime(\'now\')');
    } else if (status === 'inactive') {
      whereConditions.push('is_active = 0');
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) as count FROM coupons ${whereClause}`).get(...params).count;

    const coupons = db.prepare(`
      SELECT * FROM coupons ${whereClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      success: true,
      data: coupons.map(c => ({
        id: c.id,
        code: c.code,
        description: c.description,
        type: c.type,
        value: c.value,
        minimumOrderAmount: c.minimum_order_amount,
        maximumDiscount: c.maximum_discount,
        usageLimit: c.usage_limit,
        usageCount: c.usage_count,
        perUserLimit: c.per_user_limit,
        startsAt: c.starts_at,
        expiresAt: c.expires_at,
        isActive: !!c.is_active,
        createdAt: c.created_at
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/coupons
 * Create coupon
 */
router.post('/', createCouponValidation, async (req, res, next) => {
  try {
    const {
      code, description, type, value, minimumOrderAmount, maximumDiscount,
      usageLimit, perUserLimit, applicableProducts, applicableCategories,
      excludedProducts, startsAt, expiresAt
    } = req.body;
    const db = getDatabase();

    const existing = db.prepare('SELECT id FROM coupons WHERE code = ?').get(code.toUpperCase());
    if (existing) throw new ConflictError('Coupon code already exists');

    const couponId = uuidv4();

    db.prepare(`
      INSERT INTO coupons (id, code, description, type, value, minimum_order_amount, maximum_discount,
        usage_limit, per_user_limit, applicable_products, applicable_categories, excluded_products,
        starts_at, expires_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      couponId, code.toUpperCase(), description || null, type, value,
      minimumOrderAmount || 0, maximumDiscount || null, usageLimit || null,
      perUserLimit || 1, applicableProducts ? JSON.stringify(applicableProducts) : null,
      applicableCategories ? JSON.stringify(applicableCategories) : null,
      excludedProducts ? JSON.stringify(excludedProducts) : null,
      startsAt || null, expiresAt || null, req.user.id
    );

    logAuditEvent(req.user.id, 'coupon_created', 'coupon', couponId, { code: code.toUpperCase(), type, value }, req.ip);

    res.status(201).json({ success: true, data: { id: couponId }, message: 'Coupon created' });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/coupons/:id
 * Update coupon
 */
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const existing = db.prepare('SELECT * FROM coupons WHERE id = ?').get(id);
    if (!existing) throw new NotFoundError('Coupon not found');

    const updates = req.body;
    const fields = [];
    const values = [];

    const fieldMap = {
      description: 'description', type: 'type', value: 'value',
      minimumOrderAmount: 'minimum_order_amount', maximumDiscount: 'maximum_discount',
      usageLimit: 'usage_limit', perUserLimit: 'per_user_limit',
      startsAt: 'starts_at', expiresAt: 'expires_at', isActive: 'is_active'
    };

    for (const [key, dbField] of Object.entries(fieldMap)) {
      if (updates[key] !== undefined) {
        fields.push(`${dbField} = ?`);
        values.push(typeof updates[key] === 'boolean' ? (updates[key] ? 1 : 0) : updates[key]);
      }
    }

    if (fields.length) {
      fields.push('updated_at = datetime(\'now\')');
      values.push(id);
      db.prepare(`UPDATE coupons SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    logAuditEvent(req.user.id, 'coupon_updated', 'coupon', id, updates, req.ip);

    res.json({ success: true, message: 'Coupon updated' });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/coupons/:id
 * Delete coupon
 */
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const result = db.prepare('DELETE FROM coupons WHERE id = ?').run(id);
    if (result.changes === 0) throw new NotFoundError('Coupon not found');

    logAuditEvent(req.user.id, 'coupon_deleted', 'coupon', id, {}, req.ip);

    res.json({ success: true, message: 'Coupon deleted' });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/coupons/:id/usage
 * Get coupon usage history
 */
router.get('/:id/usage', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const usages = db.prepare(`
      SELECT cu.*, o.order_number, u.email, u.first_name, u.last_name
      FROM coupon_usages cu
      JOIN orders o ON cu.order_id = o.id
      LEFT JOIN users u ON cu.user_id = u.id
      WHERE cu.coupon_id = ?
      ORDER BY cu.created_at DESC
    `).all(id);

    res.json({
      success: true,
      data: usages.map(u => ({
        id: u.id,
        orderNumber: u.order_number,
        customer: u.email ? `${u.first_name} ${u.last_name} (${u.email})` : 'Guest',
        discountAmount: u.discount_amount,
        usedAt: u.created_at
      }))
    });

  } catch (error) {
    next(error);
  }
});

export default router;
