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
 * Handle PayPal webhooks with proper error handling
 */
router.post('/paypal', express.raw({ type: 'application/json' }), async (req, res, next) => {
  const transmissionId = req.headers['paypal-transmission-id'] || 'unknown';

  try {
    // Validate required headers
    const requiredHeaders = [
      'paypal-auth-algo',
      'paypal-cert-url',
      'paypal-transmission-id',
      'paypal-transmission-sig',
      'paypal-transmission-time'
    ];

    const missingHeaders = requiredHeaders.filter(h => !req.headers[h]);
    if (missingHeaders.length > 0) {
      logSecurityEvent('webhook_missing_headers', {
        provider: 'paypal',
        missingHeaders,
        ip: req.ip
      });
      return res.status(400).json({ error: 'Missing required PayPal headers' });
    }

    const headers = {
      'paypal-auth-algo': req.headers['paypal-auth-algo'],
      'paypal-cert-url': req.headers['paypal-cert-url'],
      'paypal-transmission-id': req.headers['paypal-transmission-id'],
      'paypal-transmission-sig': req.headers['paypal-transmission-sig'],
      'paypal-transmission-time': req.headers['paypal-transmission-time']
    };

    // Parse body with error handling
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // Validate body is an object with required fields
      if (!body || typeof body !== 'object' || !body.event_type) {
        throw new Error('Invalid webhook payload structure');
      }
    } catch (parseError) {
      logSecurityEvent('webhook_parse_error', {
        provider: 'paypal',
        transmissionId,
        error: parseError.message,
        ip: req.ip
      });
      return res.status(400).json({ error: 'Invalid webhook payload' });
    }

    // Verify webhook signature
    const isValid = await paypalService.verifyWebhookSignature(headers, body);

    if (!isValid) {
      logSecurityEvent('webhook_verification_failed', {
        provider: 'paypal',
        transmissionId,
        eventType: body.event_type,
        ip: req.ip
      });
      return res.status(401).json({ error: 'Webhook verification failed' });
    }

    // Process webhook
    const { event_type, resource, id: eventId } = body;

    logger.info('PayPal webhook received and verified', {
      eventType: event_type,
      eventId,
      transmissionId
    });

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

              logger.info('Order payment status updated via webhook', {
                orderId: order.id,
                eventId
              });
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

            logSecurityEvent('payment_capture_denied', {
              orderId: resource.custom_id,
              eventId,
              reason: resource.status_details
            });
          }
          break;

        case 'refund_processed':
          // Refund completed
          logger.info('Refund processed via webhook', {
            captureId: result.captureId,
            eventId
          });
          break;
      }
    }

    // Return 200 only for successfully processed webhooks
    res.json({ received: true, eventId, handled: result.handled });

  } catch (error) {
    // Log the full error for debugging
    logger.error('PayPal webhook processing error', {
      error: error.message,
      stack: error.stack,
      transmissionId,
      ip: req.ip
    });

    // For internal processing errors (after signature verification),
    // return 500 so PayPal knows to retry
    // This is appropriate for transient errors like database issues
    return res.status(500).json({
      error: 'Webhook processing failed',
      retryable: true
    });
  }
});

export default router;
