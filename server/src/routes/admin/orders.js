/**
 * Admin Order Management Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../database/init.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../../utils/logger.js';
import { emailService } from '../../services/email.js';
import { paypalService } from '../../services/paypal.js';

const router = express.Router();

/**
 * GET /admin/orders
 * List all orders with filtering
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status, paymentStatus, startDate, endDate, sort = 'created_at', order = 'desc' } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();

    let whereConditions = [];
    const params = [];

    if (search) {
      whereConditions.push('(order_number LIKE ? OR customer_email LIKE ? OR customer_first_name LIKE ? OR customer_last_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('status = ?');
      params.push(status);
    }

    if (paymentStatus) {
      whereConditions.push('payment_status = ?');
      params.push(paymentStatus);
    }

    if (startDate) {
      whereConditions.push('date(created_at) >= ?');
      params.push(startDate);
    }

    if (endDate) {
      whereConditions.push('date(created_at) <= ?');
      params.push(endDate);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) as count FROM orders ${whereClause}`).get(...params).count;

    const orders = db.prepare(`
      SELECT * FROM orders ${whereClause}
      ORDER BY ${sort} ${order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // Get item counts
    const orderIds = orders.map(o => o.id);
    let itemCounts = {};
    if (orderIds.length) {
      const counts = db.prepare(`
        SELECT order_id, SUM(quantity) as count FROM order_items
        WHERE order_id IN (${orderIds.map(() => '?').join(',')})
        GROUP BY order_id
      `).all(...orderIds);
      itemCounts = counts.reduce((acc, c) => ({ ...acc, [c.order_id]: c.count }), {});
    }

    res.json({
      success: true,
      data: orders.map(o => ({
        id: o.id,
        orderNumber: o.order_number,
        customer: {
          name: `${o.customer_first_name} ${o.customer_last_name}`,
          email: o.customer_email,
          phone: o.customer_phone
        },
        status: o.status,
        paymentStatus: o.payment_status,
        fulfillmentStatus: o.fulfillment_status,
        subtotal: o.subtotal,
        discount: o.discount_total,
        shipping: o.shipping_total,
        tax: o.tax_total,
        total: o.grand_total,
        itemCount: itemCounts[o.id] || 0,
        paymentMethod: o.payment_method,
        createdAt: o.created_at,
        shippedAt: o.shipped_at
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/orders/:id
 * Get order details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ? OR order_number = ?').get(id, id);
    if (!order) throw new NotFoundError('Order not found');

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const history = db.prepare('SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at DESC').all(order.id);
    const transactions = db.prepare('SELECT * FROM payment_transactions WHERE order_id = ? ORDER BY created_at DESC').all(order.id);

    res.json({
      success: true,
      data: {
        ...order,
        items: items.map(i => ({
          id: i.id,
          productId: i.product_id,
          sku: i.sku,
          name: i.name,
          variationName: i.variation_name,
          quantity: i.quantity,
          unitPrice: i.unit_price,
          totalPrice: i.total_price,
          taxAmount: i.tax_amount,
          imageUrl: i.image_url,
          mg: i.mg,
          unit: i.unit,
          fulfilledQuantity: i.fulfilled_quantity
        })),
        statusHistory: history.map(h => ({
          previousStatus: h.previous_status,
          newStatus: h.new_status,
          notes: h.notes,
          createdAt: h.created_at
        })),
        transactions: transactions.map(t => ({
          id: t.id,
          provider: t.provider,
          type: t.type,
          status: t.status,
          amount: t.amount,
          transactionId: t.provider_transaction_id,
          createdAt: t.created_at
        }))
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/orders/:id/status
 * Update order status
 */
router.put('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const db = getDatabase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new NotFoundError('Order not found');

    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'on_hold'];
    if (!validStatuses.includes(status)) throw new ValidationError('Invalid status');

    db.prepare('UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);

    db.prepare(`
      INSERT INTO order_status_history (id, order_id, previous_status, new_status, notes, changed_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), id, order.status, status, notes || null, req.user.id);

    logAuditEvent(req.user.id, 'order_status_changed', 'order', id, { from: order.status, to: status }, req.ip);

    res.json({ success: true, message: 'Order status updated' });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/orders/:id/ship
 * Mark order as shipped
 */
router.put('/:id/ship', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { trackingNumber, carrier, notes } = req.body;
    const db = getDatabase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new NotFoundError('Order not found');

    db.prepare(`
      UPDATE orders SET status = 'shipped', fulfillment_status = 'fulfilled',
        tracking_number = ?, shipping_carrier = ?, shipped_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(trackingNumber || null, carrier || null, id);

    db.prepare(`
      INSERT INTO order_status_history (id, order_id, previous_status, new_status, notes, changed_by)
      VALUES (?, ?, ?, 'shipped', ?, ?)
    `).run(uuidv4(), id, order.status, notes || `Shipped via ${carrier || 'carrier'}`, req.user.id);

    // Update fulfilled quantity
    db.prepare('UPDATE order_items SET fulfilled_quantity = quantity WHERE order_id = ?').run(id);

    // Send shipping notification
    await emailService.sendOrderShipped(order, trackingNumber, carrier);

    logAuditEvent(req.user.id, 'order_shipped', 'order', id, { trackingNumber, carrier }, req.ip);

    res.json({ success: true, message: 'Order marked as shipped' });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/orders/:id/refund
 * Process refund
 */
router.post('/:id/refund', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, reason, restockItems } = req.body;
    const db = getDatabase();

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) throw new NotFoundError('Order not found');

    if (order.payment_status !== 'paid') throw new ValidationError('Order has not been paid');

    const refundAmount = amount || order.grand_total;

    // Process PayPal refund if applicable
    if (order.payment_provider === 'paypal' && order.payment_transaction_id) {
      const transaction = db.prepare(`
        SELECT provider_transaction_id FROM payment_transactions
        WHERE order_id = ? AND type = 'capture' AND status = 'completed'
        ORDER BY created_at DESC LIMIT 1
      `).get(id);

      if (transaction) {
        await paypalService.refundPayment(transaction.provider_transaction_id, refundAmount, reason);
      }
    }

    // Update order
    const newPaymentStatus = refundAmount >= order.grand_total ? 'refunded' : 'partially_refunded';
    db.prepare(`
      UPDATE orders SET payment_status = ?, status = 'refunded', updated_at = datetime('now')
      WHERE id = ?
    `).run(newPaymentStatus, id);

    // Record refund transaction
    db.prepare(`
      INSERT INTO payment_transactions (id, order_id, provider, type, status, amount, currency)
      VALUES (?, ?, ?, 'refund', 'completed', ?, 'USD')
    `).run(uuidv4(), id, order.payment_provider || 'manual', refundAmount);

    // Restock items if requested
    if (restockItems) {
      const items = db.prepare('SELECT product_id, variation_id, quantity FROM order_items WHERE order_id = ?').all(id);
      for (const item of items) {
        db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?').run(item.quantity, item.product_id);
        if (item.variation_id) {
          db.prepare('UPDATE product_variations SET stock_quantity = stock_quantity + ? WHERE id = ?').run(item.quantity, item.variation_id);
        }
      }
    }

    db.prepare(`
      INSERT INTO order_status_history (id, order_id, previous_status, new_status, notes, changed_by)
      VALUES (?, ?, ?, 'refunded', ?, ?)
    `).run(uuidv4(), id, order.status, `Refund of $${refundAmount.toFixed(2)}: ${reason || 'No reason provided'}`, req.user.id);

    logAuditEvent(req.user.id, 'order_refunded', 'order', id, { amount: refundAmount, reason }, req.ip);

    res.json({ success: true, message: 'Refund processed successfully' });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/orders/:id/notes
 * Update admin notes
 */
router.put('/:id/notes', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adminNotes, internalNotes } = req.body;
    const db = getDatabase();

    const fields = [];
    const values = [];

    if (adminNotes !== undefined) {
      fields.push('admin_notes = ?');
      values.push(adminNotes);
    }

    if (internalNotes !== undefined) {
      fields.push('internal_notes = ?');
      values.push(internalNotes);
    }

    if (fields.length) {
      fields.push('updated_at = datetime(\'now\')');
      values.push(id);
      db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    }

    res.json({ success: true, message: 'Notes updated' });

  } catch (error) {
    next(error);
  }
});

export default router;
