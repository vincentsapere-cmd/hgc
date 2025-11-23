/**
 * Payment Routes
 * PayPal integration and payment processing
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/init.js';
import { optionalAuth } from '../middleware/auth.js';
import { paypalCaptureValidation, applyGiftCardValidation } from '../middleware/validators.js';
import { NotFoundError, PaymentError, ValidationError } from '../middleware/errorHandler.js';
import { paypalService } from '../services/paypal.js';
import { emailService } from '../services/email.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { config } from '../config/index.js';
import { createGiftCardFromOrder } from './giftcards.js';

const router = express.Router();

/**
 * GET /payments/config
 * Get PayPal client configuration for frontend
 */
router.get('/config', (req, res) => {
  const paypalConfig = paypalService.validateConfiguration();

  res.json({
    success: true,
    data: {
      paypal: {
        clientId: config.paypal.clientId,
        mode: config.paypal.mode,
        currency: 'USD',
        isConfigured: paypalConfig.clientIdConfigured
      }
    }
  });
});

/**
 * POST /payments/paypal/create-order
 * Create a PayPal order
 */
router.post('/paypal/create-order', optionalAuth, async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const db = getDatabase();

    // Get order
    const order = db.prepare(`
      SELECT * FROM orders WHERE id = ? AND payment_status = 'pending'
    `).get(orderId);

    if (!order) {
      throw new NotFoundError('Order not found or already paid');
    }

    // Get order items
    const items = await db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

    // Create PayPal order
    const paypalOrder = await paypalService.createOrder({
      amount: order.grand_total,
      subtotal: order.subtotal,
      shippingAmount: order.shipping_total,
      taxAmount: order.tax_total,
      discountAmount: order.discount_total + order.gift_card_amount,
      internalOrderId: order.id,
      description: `Order ${order.order_number}`,
      items: items.map(i => ({
        name: i.name + (i.variation_name ? ` (${i.variation_name})` : ''),
        sku: i.sku,
        price: i.unit_price,
        quantity: i.quantity
      })),
      shipping: {
        firstName: order.customer_first_name,
        lastName: order.customer_last_name,
        line1: order.shipping_address_line1,
        line2: order.shipping_address_line2,
        city: order.shipping_city,
        state: order.shipping_state,
        zip: order.shipping_zip
      }
    });

    logger.info('PayPal order created', {
      orderId: order.id,
      paypalOrderId: paypalOrder.id
    });

    res.json({
      success: true,
      data: {
        paypalOrderId: paypalOrder.id,
        status: paypalOrder.status
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /payments/paypal/capture
 * Capture PayPal payment
 */
router.post('/paypal/capture', optionalAuth, paypalCaptureValidation, async (req, res, next) => {
  try {
    const { orderId: paypalOrderId, internalOrderId } = req.body;
    const db = getDatabase();

    // Capture the payment
    const capture = await paypalService.captureOrder(paypalOrderId);

    if (capture.status !== 'COMPLETED') {
      throw new PaymentError('Payment capture failed', { status: capture.status });
    }

    // Get our internal order
    let order;
    if (internalOrderId) {
      order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(internalOrderId);
    } else {
      // Try to find by PayPal order ID in custom_id
      const paypalOrderDetails = await paypalService.getOrder(paypalOrderId);
      const customId = paypalOrderDetails.purchase_units?.[0]?.custom_id;
      if (customId) {
        order = await db.prepare('SELECT * FROM orders WHERE id = ?').get(customId);
      }
    }

    if (!order) {
      logger.error('Order not found for PayPal capture', { paypalOrderId, internalOrderId });
      throw new NotFoundError('Order not found');
    }

    // Update order status
    db.prepare(`
      UPDATE orders SET
        status = 'confirmed',
        payment_status = 'paid',
        payment_method = 'paypal',
        payment_provider = 'paypal',
        payment_transaction_id = ?,
        payment_payer_id = ?,
        paid_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(capture.captureId, capture.payerId, order.id);

    // Record payment transaction
    db.prepare(`
      INSERT INTO payment_transactions (id, order_id, provider, type, status, amount, currency,
        provider_transaction_id, provider_payer_id, provider_response)
      VALUES (?, ?, 'paypal', 'capture', 'completed', ?, 'USD', ?, ?, ?)
    `).run(
      uuidv4(), order.id, capture.amount, capture.captureId, capture.payerId,
      JSON.stringify(capture.raw)
    );

    // Deduct gift card balance if used
    if (order.gift_card_code && order.gift_card_amount > 0) {
      const giftCard = await db.prepare('SELECT * FROM gift_cards WHERE code = ?').get(order.gift_card_code);
      if (giftCard) {
        const newBalance = giftCard.current_balance - order.gift_card_amount;
        const newStatus = newBalance <= 0 ? 'depleted' : 'active';

        await db.prepare(`
          UPDATE gift_cards SET current_balance = ?, status = ?, last_used_at = datetime('now')
          WHERE id = ?
        `).run(Math.max(0, newBalance), newStatus, giftCard.id);

        await db.prepare(`
          INSERT INTO gift_card_transactions (id, gift_card_id, order_id, type, amount, balance_before, balance_after)
          VALUES (?, ?, ?, 'redemption', ?, ?, ?)
        `).run(uuidv4(), giftCard.id, order.id, order.gift_card_amount, giftCard.current_balance, newBalance);
      }
    }

    // Update inventory and create gift cards
    const orderItems = await db.prepare('SELECT oi.*, p.is_gift_card, p.track_inventory FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?').all(order.id);
    const createdGiftCards = [];

    for (const item of orderItems) {
      // Create gift cards for gift card products
      if (item.is_gift_card) {
        for (let i = 0; i < item.quantity; i++) {
          try {
            const giftCard = await createGiftCardFromOrder(item, order, req.user?.id);
            createdGiftCards.push(giftCard);
          } catch (gcError) {
            logger.error('Failed to create gift card', { error: gcError.message, itemId: item.id });
          }
        }
      }

      // Update inventory for non-gift-card items
      if (item.track_inventory) {
        await db.prepare(`
          UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ? AND track_inventory = 1
        `).run(item.quantity, item.product_id);

        if (item.variation_id) {
          await db.prepare(`
            UPDATE product_variations SET stock_quantity = stock_quantity - ? WHERE id = ?
          `).run(item.quantity, item.variation_id);
        }

        // Record inventory transaction
        const product = await db.prepare('SELECT stock_quantity FROM products WHERE id = ?').get(item.product_id);
        await db.prepare(`
          INSERT INTO inventory_transactions (id, product_id, variation_id, type, quantity, previous_quantity, new_quantity, reference_type, reference_id)
          VALUES (?, ?, ?, 'sale', ?, ?, ?, 'order', ?)
        `).run(
          uuidv4(), item.product_id, item.variation_id, -item.quantity,
          (product?.stock_quantity || 0) + item.quantity, product?.stock_quantity || 0, order.id
        );
      }
    }

    // Log status change
    await db.prepare(`
      INSERT INTO order_status_history (id, order_id, previous_status, new_status, notes)
      VALUES (?, ?, 'pending', 'confirmed', 'Payment captured via PayPal')
    `).run(uuidv4(), order.id);

    // Get full order for email
    const fullOrder = await db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    fullOrder.items = orderItems;

    // Send confirmation emails
    await emailService.sendOrderConfirmation(fullOrder);
    await emailService.sendAdminNewOrderNotification(fullOrder);

    logSecurityEvent('payment_captured', {
      orderId: order.id,
      amount: capture.amount,
      paypalOrderId,
      captureId: capture.captureId
    });

    logger.info('Payment captured successfully', {
      orderId: order.id,
      orderNumber: order.order_number,
      amount: capture.amount
    });

    res.json({
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.order_number,
        status: 'paid',
        captureId: capture.captureId,
        amount: capture.amount
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /payments/gift-card/validate
 * Validate gift card code
 */
router.post('/gift-card/validate', applyGiftCardValidation, async (req, res, next) => {
  try {
    const { code } = req.body;
    const db = getDatabase();

    const giftCard = db.prepare(`
      SELECT code, current_balance, status, expires_at
      FROM gift_cards
      WHERE code = ? AND status = 'active' AND current_balance > 0
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get(code.toUpperCase());

    if (!giftCard) {
      throw new ValidationError('Invalid, expired, or depleted gift card');
    }

    res.json({
      success: true,
      data: {
        code: giftCard.code,
        balance: giftCard.current_balance,
        expiresAt: giftCard.expires_at
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /payments/coupon/validate
 * Validate coupon code
 */
router.post('/coupon/validate', async (req, res, next) => {
  try {
    const { code, subtotal } = req.body;
    const db = getDatabase();

    const coupon = db.prepare(`
      SELECT * FROM coupons
      WHERE code = ? AND is_active = 1
      AND (starts_at IS NULL OR starts_at <= datetime('now'))
      AND (expires_at IS NULL OR expires_at > datetime('now'))
      AND (usage_limit IS NULL OR usage_count < usage_limit)
    `).get(code.toUpperCase());

    if (!coupon) {
      throw new ValidationError('Invalid or expired coupon');
    }

    if (coupon.minimum_order_amount && subtotal < coupon.minimum_order_amount) {
      throw new ValidationError(`Minimum order amount is $${coupon.minimum_order_amount.toFixed(2)}`);
    }

    // Calculate discount
    let discount = 0;
    if (coupon.type === 'percentage') {
      discount = subtotal * (coupon.value / 100);
      if (coupon.maximum_discount) {
        discount = Math.min(discount, coupon.maximum_discount);
      }
    } else if (coupon.type === 'fixed_amount') {
      discount = Math.min(coupon.value, subtotal);
    } else if (coupon.type === 'free_shipping') {
      discount = 0; // Handled in order calculation
    }

    res.json({
      success: true,
      data: {
        code: coupon.code,
        type: coupon.type,
        value: coupon.value,
        discount: discount,
        description: coupon.description,
        minimumOrderAmount: coupon.minimum_order_amount
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /payments/refund
 * Process refund (admin only, handled in admin routes)
 */

export default router;
