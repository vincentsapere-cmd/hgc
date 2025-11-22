/**
 * Webhook Routes
 * PayPal and other webhook handlers
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/init.js';
import { paypalService } from '../services/paypal.js';
import { emailService } from '../services/email.js';
import { logger, logSecurityEvent } from '../utils/logger.js';

const router = express.Router();

/**
 * POST /webhooks/paypal
 * Handle PayPal webhooks
 */
router.post('/paypal', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const headers = {
      'paypal-auth-algo': req.headers['paypal-auth-algo'],
      'paypal-cert-url': req.headers['paypal-cert-url'],
      'paypal-transmission-id': req.headers['paypal-transmission-id'],
      'paypal-transmission-sig': req.headers['paypal-transmission-sig'],
      'paypal-transmission-time': req.headers['paypal-transmission-time']
    };

    // Parse body
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Verify webhook signature
    const isValid = await paypalService.verifyWebhookSignature(headers, body);

    if (!isValid) {
      logSecurityEvent('webhook_verification_failed', {
        provider: 'paypal',
        transmissionId: headers['paypal-transmission-id']
      });
      return res.status(401).json({ error: 'Webhook verification failed' });
    }

    // Process webhook
    const { event_type, resource, id: eventId, create_time } = body;

    logger.info('PayPal webhook received', { eventType: event_type, eventId });

    const result = await paypalService.handleWebhookEvent(event_type, resource);

    // Handle specific events
    if (result.handled) {
      const db = getDatabase();

      switch (result.action) {
        case 'capture_completed':
          // Payment captured - update order if not already updated
          if (resource.custom_id) {
            const order = db.prepare('SELECT id, payment_status FROM orders WHERE id = ?')
              .get(resource.custom_id);

            if (order && order.payment_status !== 'paid') {
              db.prepare(`
                UPDATE orders SET payment_status = 'paid', paid_at = datetime('now')
                WHERE id = ?
              `).run(order.id);

              db.prepare(`
                INSERT INTO order_status_history (id, order_id, previous_status, new_status, notes)
                VALUES (?, ?, ?, 'paid', 'Payment confirmed via webhook')
              `).run(uuidv4(), order.id, order.payment_status);
            }
          }
          break;

        case 'capture_denied':
          // Payment denied
          if (resource.custom_id) {
            db.prepare(`
              UPDATE orders SET payment_status = 'failed', status = 'failed'
              WHERE id = ?
            `).run(resource.custom_id);
          }
          break;

        case 'refund_processed':
          // Refund completed
          logger.info('Refund processed via webhook', { captureId: result.captureId });
          break;
      }
    }

    // Always return 200 to acknowledge receipt
    res.json({ received: true, eventId });

  } catch (error) {
    logger.error('PayPal webhook error', { error: error.message });
    // Still return 200 to prevent retries for parsing errors
    res.json({ received: true, error: error.message });
  }
});

export default router;
