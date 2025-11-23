/**
 * Order Routes
 * Order creation, management, and history
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/init.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { createOrderValidation } from '../middleware/validators.js';
import { NotFoundError, ValidationError, ConflictError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { emailService } from '../services/email.js';
import { config } from '../config/index.js';

const router = express.Router();

/**
 * Generate unique order number
 */
const generateOrderNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `HGC-${timestamp}-${random}`;
};

/**
 * Calculate order totals
 */
const calculateOrderTotals = (items, shippingAddress, coupon, giftCardAmount = 0) => {
  const db = getDatabase();

  // Calculate subtotal
  let subtotal = 0;
  const orderItems = [];

  for (const item of items) {
    const product = db.prepare(`
      SELECT id, sku, name, price, mg, unit, image_url, stock_quantity, track_inventory, allow_backorder, is_taxable
      FROM products WHERE id = ? AND is_active = 1
    `).get(item.productId);

    if (!product) {
      throw new ValidationError(`Product not found: ${item.productId}`);
    }

    // Check stock
    if (product.track_inventory && !product.allow_backorder) {
      if (product.stock_quantity < item.quantity) {
        throw new ValidationError(`Insufficient stock for ${product.name}`);
      }
    }

    let unitPrice = product.price;
    let variationName = null;

    // Handle variation
    if (item.variationId) {
      const variation = db.prepare(`
        SELECT id, name, sku, price_modifier, stock_quantity
        FROM product_variations WHERE id = ? AND product_id = ? AND is_active = 1
      `).get(item.variationId, product.id);

      if (!variation) {
        throw new ValidationError(`Variation not found for ${product.name}`);
      }

      unitPrice += variation.price_modifier || 0;
      variationName = variation.name;
    }

    const totalPrice = unitPrice * item.quantity;
    subtotal += totalPrice;

    orderItems.push({
      productId: product.id,
      variationId: item.variationId || null,
      sku: product.sku,
      name: product.name,
      variationName,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
      taxAmount: 0,
      imageUrl: product.image_url,
      mg: product.mg,
      unit: product.unit,
      isTaxable: product.is_taxable
    });
  }

  // Calculate discount
  let discountTotal = 0;
  if (coupon) {
    const couponData = db.prepare(`
      SELECT * FROM coupons
      WHERE code = ? AND is_active = 1
      AND (starts_at IS NULL OR starts_at <= datetime('now'))
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND (usage_limit IS NULL OR usage_count < usage_limit)
    `).get(coupon);

    if (couponData) {
      if (subtotal >= (couponData.minimum_order_amount || 0)) {
        if (couponData.type === 'percentage') {
          discountTotal = subtotal * (couponData.value / 100);
          if (couponData.maximum_discount) {
            discountTotal = Math.min(discountTotal, couponData.maximum_discount);
          }
        } else if (couponData.type === 'fixed_amount') {
          discountTotal = Math.min(couponData.value, subtotal);
        }
      }
    }
  }

  // Calculate shipping
  let shippingTotal = config.shipping.flatRate;
  if (subtotal >= config.shipping.freeThreshold) {
    shippingTotal = 0;
  }

  // Calculate tax
  let taxTotal = 0;
  if (config.tax.enabled && shippingAddress?.state) {
    const taxRate = db.prepare(`
      SELECT rate FROM tax_rates
      WHERE country = 'US' AND (state = ? OR state = '*') AND is_active = 1
      ORDER BY state DESC LIMIT 1
    `).get(shippingAddress.state);

    if (taxRate) {
      const taxableAmount = orderItems
        .filter(item => item.isTaxable)
        .reduce((sum, item) => sum + item.totalPrice, 0);
      taxTotal = taxableAmount * (taxRate.rate / 100);

      // Update item tax amounts
      orderItems.forEach(item => {
        if (item.isTaxable) {
          item.taxAmount = item.totalPrice * (taxRate.rate / 100);
        }
      });
    }
  }

  // Apply gift card
  const effectiveGiftCard = Math.min(giftCardAmount, subtotal - discountTotal + shippingTotal + taxTotal);

  // Calculate grand total
  const grandTotal = Math.max(0, subtotal - discountTotal + shippingTotal + taxTotal - effectiveGiftCard);

  return {
    items: orderItems,
    subtotal,
    discountTotal,
    shippingTotal,
    taxTotal,
    giftCardAmount: effectiveGiftCard,
    grandTotal
  };
};

/**
 * POST /orders
 * Create a new order
 */
router.post('/', optionalAuth, createOrderValidation, async (req, res, next) => {
  try {
    const {
      items,
      shippingAddress,
      billingAddress,
      email,
      phone,
      couponCode,
      giftCardCode,
      customerNotes
    } = req.body;

    const db = getDatabase();

    // Validate and apply gift card
    let giftCardAmount = 0;
    let giftCard = null;
    if (giftCardCode) {
      giftCard = db.prepare(`
        SELECT * FROM gift_cards
        WHERE code = ? AND status = 'active' AND current_balance > 0
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      `).get(giftCardCode);

      if (!giftCard) {
        throw new ValidationError('Invalid or expired gift card');
      }
      giftCardAmount = giftCard.current_balance;
    }

    // Calculate totals
    const totals = calculateOrderTotals(items, shippingAddress, couponCode, giftCardAmount);

    // Create order
    const orderId = uuidv4();
    const orderNumber = generateOrderNumber();

    db.prepare(`
      INSERT INTO orders (
        id, order_number, user_id, status, payment_status, fulfillment_status,
        customer_email, customer_first_name, customer_last_name, customer_phone,
        shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_zip,
        billing_address_line1, billing_address_line2, billing_city, billing_state, billing_zip,
        billing_same_as_shipping,
        subtotal, discount_total, shipping_total, tax_total, grand_total,
        coupon_code, gift_card_code, gift_card_amount,
        customer_notes, ip_address, user_agent
      ) VALUES (?, ?, ?, 'pending', 'pending', 'unfulfilled',
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?)
    `).run(
      orderId, orderNumber, req.user?.id || null,
      email, shippingAddress.firstName, shippingAddress.lastName, phone || null,
      shippingAddress.line1, shippingAddress.line2 || null, shippingAddress.city, shippingAddress.state, shippingAddress.zip,
      billingAddress?.line1 || null, billingAddress?.line2 || null, billingAddress?.city || null, billingAddress?.state || null, billingAddress?.zip || null,
      billingAddress ? 0 : 1,
      totals.subtotal, totals.discountTotal, totals.shippingTotal, totals.taxTotal, totals.grandTotal,
      couponCode || null, giftCardCode || null, totals.giftCardAmount,
      customerNotes || null, req.ip, req.get('User-Agent')
    );

    // Create order items
    const itemInsert = db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, variation_id, sku, name, variation_name,
        quantity, unit_price, total_price, tax_amount, discount_amount, image_url, mg, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);

    for (const item of totals.items) {
      itemInsert.run(
        uuidv4(), orderId, item.productId, item.variationId, item.sku, item.name, item.variationName,
        item.quantity, item.unitPrice, item.totalPrice, item.taxAmount, item.imageUrl, item.mg, item.unit
      );
    }

    // Update coupon usage
    if (couponCode) {
      await db.prepare('UPDATE coupons SET usage_count = usage_count + 1 WHERE code = ?').run(couponCode);
    }

    // Log order creation
    await db.prepare(`
      INSERT INTO order_status_history (id, order_id, new_status, notes)
      VALUES (?, ?, 'pending', 'Order created')
    `).run(uuidv4(), orderId);

    logger.info('Order created', { orderId, orderNumber, total: totals.grandTotal });

    res.status(201).json({
      success: true,
      data: {
        orderId,
        orderNumber,
        subtotal: totals.subtotal,
        discount: totals.discountTotal,
        shipping: totals.shippingTotal,
        tax: totals.taxTotal,
        giftCardAmount: totals.giftCardAmount,
        total: totals.grandTotal,
        items: totals.items
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /orders
 * Get user's order history
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();

    const orders = db.prepare(`
      SELECT id, order_number, status, payment_status, fulfillment_status,
        subtotal, discount_total, shipping_total, tax_total, grand_total,
        created_at, shipped_at, delivered_at
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(req.user.id, limit, offset);

    const total = db.prepare('SELECT COUNT(*) as count FROM orders WHERE user_id = ?')
      .get(req.user.id).count;

    res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id,
        orderNumber: o.order_number,
        status: o.status,
        paymentStatus: o.payment_status,
        fulfillmentStatus: o.fulfillment_status,
        subtotal: o.subtotal,
        discount: o.discount_total,
        shipping: o.shipping_total,
        tax: o.tax_total,
        total: o.grand_total,
        createdAt: o.created_at,
        shippedAt: o.shipped_at,
        deliveredAt: o.delivered_at
      })),
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
 * GET /orders/:id
 * Get order details
 */
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const order = db.prepare(`
      SELECT * FROM orders WHERE id = ? OR order_number = ?
    `).get(id, id);

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Check authorization (user can only view their own orders, or guest by order number)
    if (req.user && order.user_id && order.user_id !== req.user.id) {
      throw new NotFoundError('Order not found');
    }

    // Get order items
    const items = db.prepare(`
      SELECT * FROM order_items WHERE order_id = ?
    `).all(order.id);

    // Get status history
    const history = db.prepare(`
      SELECT new_status, notes, created_at FROM order_status_history
      WHERE order_id = ? ORDER BY created_at DESC
    `).all(order.id);

    res.json({
      success: true,
      data: {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        paymentStatus: order.payment_status,
        fulfillmentStatus: order.fulfillment_status,
        customer: {
          email: order.customer_email,
          firstName: order.customer_first_name,
          lastName: order.customer_last_name,
          phone: order.customer_phone
        },
        shippingAddress: {
          line1: order.shipping_address_line1,
          line2: order.shipping_address_line2,
          city: order.shipping_city,
          state: order.shipping_state,
          zip: order.shipping_zip,
          country: order.shipping_country
        },
        items: items.map(i => ({
          id: i.id,
          productId: i.product_id,
          sku: i.sku,
          name: i.name,
          variationName: i.variation_name,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
          imageUrl: i.image_url,
          mg: i.mg,
          unit: i.unit
        })),
        subtotal: order.subtotal,
        discount: order.discount_total,
        shipping: order.shipping_total,
        tax: order.tax_total,
        giftCardAmount: order.gift_card_amount,
        total: order.grand_total,
        shippingMethod: order.shipping_method,
        trackingNumber: order.tracking_number,
        shippingCarrier: order.shipping_carrier,
        paymentMethod: order.payment_method,
        couponCode: order.coupon_code,
        customerNotes: order.customer_notes,
        statusHistory: history,
        createdAt: order.created_at,
        shippedAt: order.shipped_at,
        deliveredAt: order.delivered_at
      }
    });

  } catch (error) {
    next(error);
  }
});

export default router;
