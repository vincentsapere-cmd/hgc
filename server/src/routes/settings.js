/**
 * Public Settings Routes
 * Store configuration accessible to frontend
 */

import express from 'express';
import { getDatabase } from '../database/init.js';
import { config } from '../config/index.js';

const router = express.Router();

/**
 * GET /settings/public
 * Get public store settings
 */
router.get('/public', async (req, res, next) => {
  try {
    const db = getDatabase();

    // Get public settings
    const settings = db.prepare(`
      SELECT key, value, type FROM settings WHERE is_public = 1
    `).all();

    // Convert to object with proper types
    const settingsObj = {};
    for (const s of settings) {
      let value = s.value;
      if (s.type === 'number') value = parseFloat(value);
      else if (s.type === 'boolean') value = value === 'true';
      else if (s.type === 'json') value = JSON.parse(value);
      settingsObj[s.key] = value;
    }

    // Get active categories count
    const categoryCount = db.prepare('SELECT COUNT(*) as count FROM categories WHERE is_active = 1')
      .get().count;

    // Get active products count
    const productCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE is_active = 1')
      .get().count;

    res.json({
      success: true,
      data: {
        store: {
          name: settingsObj.store_name || config.business.name,
          email: settingsObj.store_email || config.business.supportEmail,
          phone: settingsObj.store_phone || config.business.phone,
          address: settingsObj.store_address || config.business.address,
          currency: settingsObj.currency || 'USD'
        },
        shipping: {
          flatRate: settingsObj.flat_shipping_rate || config.shipping.flatRate,
          freeThreshold: settingsObj.free_shipping_threshold || config.shipping.freeThreshold
        },
        compliance: {
          ageVerificationRequired: settingsObj.age_verification_required !== false,
          minimumAge: settingsObj.minimum_age || 21
        },
        catalog: {
          categoryCount,
          productCount
        }
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /settings/shipping-rates
 * Get shipping rates for checkout
 */
router.get('/shipping-rates', async (req, res, next) => {
  try {
    const { state, subtotal } = req.query;
    const db = getDatabase();

    // Get applicable shipping methods
    const methods = db.prepare(`
      SELECT sm.*, sz.name as zone_name
      FROM shipping_methods sm
      LEFT JOIN shipping_zones sz ON sm.zone_id = sz.id
      WHERE sm.is_active = 1
      AND (sm.zone_id IS NULL OR sz.states LIKE ? OR sz.states = '["*"]')
      AND (sm.min_order_amount IS NULL OR sm.min_order_amount <= ?)
      AND (sm.max_order_amount IS NULL OR sm.max_order_amount >= ?)
      ORDER BY sm.sort_order, sm.cost
    `).all(`%${state}%`, subtotal || 999999, subtotal || 0);

    res.json({
      success: true,
      data: methods.map(m => ({
        id: m.id,
        name: m.name,
        description: m.description,
        cost: m.type === 'free' || (m.free_shipping_threshold && subtotal >= m.free_shipping_threshold) ? 0 : m.cost,
        estimatedDays: m.estimated_days_min && m.estimated_days_max
          ? `${m.estimated_days_min}-${m.estimated_days_max} business days`
          : null,
        isFree: m.type === 'free' || (m.free_shipping_threshold && subtotal >= m.free_shipping_threshold)
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /settings/tax-rate
 * Get tax rate for location
 */
router.get('/tax-rate', async (req, res, next) => {
  try {
    const { state, city, zip } = req.query;
    const db = getDatabase();

    if (!config.tax.enabled) {
      return res.json({
        success: true,
        data: { rate: 0, enabled: false }
      });
    }

    // Find applicable tax rate (most specific first)
    let taxRate = null;

    // Try ZIP code first
    if (zip) {
      taxRate = db.prepare(`
        SELECT rate, name FROM tax_rates
        WHERE country = 'US' AND zip_code = ? AND is_active = 1
      `).get(zip);
    }

    // Try city
    if (!taxRate && city && state) {
      taxRate = db.prepare(`
        SELECT rate, name FROM tax_rates
        WHERE country = 'US' AND state = ? AND city = ? AND is_active = 1
      `).get(state, city);
    }

    // Try state
    if (!taxRate && state) {
      taxRate = db.prepare(`
        SELECT rate, name FROM tax_rates
        WHERE country = 'US' AND state = ? AND city IS NULL AND zip_code IS NULL AND is_active = 1
      `).get(state);
    }

    // Fall back to default
    if (!taxRate) {
      taxRate = db.prepare(`
        SELECT rate, name FROM tax_rates
        WHERE country = 'US' AND state = '*' AND is_active = 1
      `).get();
    }

    res.json({
      success: true,
      data: {
        rate: taxRate?.rate || config.tax.defaultRate,
        name: taxRate?.name || 'Sales Tax',
        enabled: true
      }
    });

  } catch (error) {
    next(error);
  }
});

export default router;
