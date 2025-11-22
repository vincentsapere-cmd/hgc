/**
 * Admin Settings Routes
 * Store configuration, tax rates, shipping zones
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../database/init.js';
import { requireSuperAdmin } from '../../middleware/auth.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../../utils/logger.js';
import { paypalService } from '../../services/paypal.js';
import { emailService } from '../../services/email.js';

const router = express.Router();

/**
 * GET /admin/settings
 * Get all settings
 */
router.get('/', async (req, res, next) => {
  try {
    const db = getDatabase();
    const settings = await db.prepare('SELECT * FROM settings ORDER BY category, key').all();

    const grouped = settings.reduce((acc, s) => {
      if (!acc[s.category]) acc[s.category] = {};
      let value = s.value;
      if (s.type === 'number') value = parseFloat(value);
      else if (s.type === 'boolean') value = value === 'true';
      else if (s.type === 'json') value = JSON.parse(value);
      acc[s.category][s.key] = { value, type: s.type, description: s.description, isPublic: !!s.is_public };
      return acc;
    }, {});

    res.json({ success: true, data: grouped });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/settings
 * Update settings
 */
router.put('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const { settings } = req.body;
    const db = getDatabase();

    const updateSetting = db.prepare(`
      UPDATE settings SET value = ?, updated_by = ?, updated_at = datetime('now') WHERE key = ?
    `);

    const insertSetting = db.prepare(`
      INSERT OR REPLACE INTO settings (id, key, value, type, category, is_public, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const [key, data] of Object.entries(settings)) {
      const existing = await db.prepare('SELECT id FROM settings WHERE key = ?').get(key);
      const value = typeof data.value === 'object' ? JSON.stringify(data.value) : String(data.value);

      if (existing) {
        await updateSetting.run(value, req.user.id, key);
      } else {
        await insertSetting.run(uuidv4(), key, value, data.type || 'string', data.category || 'general', data.isPublic ? 1 : 0, req.user.id);
      }
    }

    logAuditEvent(req.user.id, 'settings_updated', 'settings', null, { keys: Object.keys(settings) }, req.ip);

    res.json({ success: true, message: 'Settings updated' });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/settings/tax-rates
 * Get all tax rates
 */
router.get('/tax-rates', async (req, res, next) => {
  try {
    const db = getDatabase();
    const rates = await db.prepare('SELECT * FROM tax_rates ORDER BY country, state, city').all();

    res.json({
      success: true,
      data: rates.map(r => ({
        id: r.id,
        country: r.country,
        state: r.state,
        city: r.city,
        zipCode: r.zip_code,
        rate: r.rate,
        name: r.name,
        isActive: !!r.is_active,
        priority: r.priority
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/settings/tax-rates
 * Create tax rate
 */
router.post('/tax-rates', async (req, res, next) => {
  try {
    const { country, state, city, zipCode, rate, name, priority } = req.body;
    const db = getDatabase();

    const rateId = uuidv4();
    await db.prepare(`
      INSERT INTO tax_rates (id, country, state, city, zip_code, rate, name, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(rateId, country || 'US', state, city || null, zipCode || null, rate, name || null, priority || 0);

    logAuditEvent(req.user.id, 'tax_rate_created', 'tax_rate', rateId, { state, rate }, req.ip);

    res.status(201).json({ success: true, data: { id: rateId } });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/settings/tax-rates/:id
 * Update tax rate
 */
router.put('/tax-rates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rate, name, isActive } = req.body;
    const db = getDatabase();

    const existing = await db.prepare('SELECT id FROM tax_rates WHERE id = ?').get(id);
    if (!existing) throw new NotFoundError('Tax rate not found');

    await db.prepare(`
      UPDATE tax_rates SET rate = ?, name = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?
    `).run(rate, name, isActive ? 1 : 0, id);

    logAuditEvent(req.user.id, 'tax_rate_updated', 'tax_rate', id, { rate }, req.ip);

    res.json({ success: true, message: 'Tax rate updated' });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /admin/settings/tax-rates/:id
 * Delete tax rate
 */
router.delete('/tax-rates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    await db.prepare('DELETE FROM tax_rates WHERE id = ?').run(id);

    res.json({ success: true, message: 'Tax rate deleted' });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/settings/shipping-zones
 * Get shipping zones
 */
router.get('/shipping-zones', async (req, res, next) => {
  try {
    const db = getDatabase();
    const zones = await db.prepare('SELECT * FROM shipping_zones ORDER BY name').all();

    const zoneIds = zones.map(z => z.id);
    let methodsMap = {};

    if (zoneIds.length) {
      const methods = await db.prepare(`
        SELECT * FROM shipping_methods WHERE zone_id IN (${zoneIds.map(() => '?').join(',')}) OR zone_id IS NULL
        ORDER BY sort_order
      `).all(...zoneIds);

      methodsMap = methods.reduce((acc, m) => {
        const key = m.zone_id || 'global';
        if (!acc[key]) acc[key] = [];
        acc[key].push(m);
        return acc;
      }, {});
    }

    res.json({
      success: true,
      data: zones.map(z => ({
        id: z.id,
        name: z.name,
        countries: z.countries ? JSON.parse(z.countries) : [],
        states: z.states ? JSON.parse(z.states) : [],
        zipCodes: z.zip_codes ? JSON.parse(z.zip_codes) : [],
        isActive: !!z.is_active,
        methods: (methodsMap[z.id] || []).map(m => ({
          id: m.id,
          name: m.name,
          description: m.description,
          type: m.type,
          cost: m.cost,
          freeShippingThreshold: m.free_shipping_threshold,
          estimatedDaysMin: m.estimated_days_min,
          estimatedDaysMax: m.estimated_days_max,
          isActive: !!m.is_active
        }))
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/settings/shipping-zones
 * Create shipping zone
 */
router.post('/shipping-zones', async (req, res, next) => {
  try {
    const { name, countries, states, zipCodes } = req.body;
    const db = getDatabase();

    const zoneId = uuidv4();
    await db.prepare(`
      INSERT INTO shipping_zones (id, name, countries, states, zip_codes)
      VALUES (?, ?, ?, ?, ?)
    `).run(zoneId, name, JSON.stringify(countries || []), JSON.stringify(states || []), JSON.stringify(zipCodes || []));

    logAuditEvent(req.user.id, 'shipping_zone_created', 'shipping_zone', zoneId, { name }, req.ip);

    res.status(201).json({ success: true, data: { id: zoneId } });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/settings/shipping-methods
 * Create shipping method
 */
router.post('/shipping-methods', async (req, res, next) => {
  try {
    const { zoneId, name, description, type, cost, freeShippingThreshold, minOrderAmount, maxOrderAmount, estimatedDaysMin, estimatedDaysMax } = req.body;
    const db = getDatabase();

    const methodId = uuidv4();
    await db.prepare(`
      INSERT INTO shipping_methods (id, zone_id, name, description, type, cost, free_shipping_threshold,
        min_order_amount, max_order_amount, estimated_days_min, estimated_days_max)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(methodId, zoneId || null, name, description || null, type, cost || 0, freeShippingThreshold || null,
      minOrderAmount || null, maxOrderAmount || null, estimatedDaysMin || null, estimatedDaysMax || null);

    res.status(201).json({ success: true, data: { id: methodId } });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/settings/integrations
 * Get integration status
 */
router.get('/integrations', async (req, res, next) => {
  try {
    const paypalStatus = paypalService.validateConfiguration();
    const emailStatus = emailService.validateConfiguration();

    res.json({
      success: true,
      data: {
        paypal: paypalStatus,
        email: emailStatus
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/settings/audit-log
 * Get audit log
 */
router.get('/audit-log', requireSuperAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, entityType, userId, startDate, endDate } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();

    let whereConditions = [];
    const params = [];

    if (action) {
      whereConditions.push('a.action = ?');
      params.push(action);
    }

    if (entityType) {
      whereConditions.push('a.entity_type = ?');
      params.push(entityType);
    }

    if (userId) {
      whereConditions.push('a.user_id = ?');
      params.push(userId);
    }

    if (startDate) {
      whereConditions.push('date(a.created_at) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      whereConditions.push('date(a.created_at) <= ?');
      params.push(endDate);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const totalResult = await db.prepare(`SELECT COUNT(*) as count FROM admin_audit_log a ${whereClause}`).get(...params);
    const total = totalResult.count;

    const logs = await db.prepare(`
      SELECT a.*, u.email, u.first_name, u.last_name
      FROM admin_audit_log a
      JOIN users u ON a.user_id = u.id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      success: true,
      data: logs.map(l => ({
        id: l.id,
        action: l.action,
        entityType: l.entity_type,
        entityId: l.entity_id,
        changes: l.new_values ? JSON.parse(l.new_values) : null,
        user: `${l.first_name} ${l.last_name} (${l.email})`,
        ipAddress: l.ip_address,
        createdAt: l.created_at
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    next(error);
  }
});

export default router;
