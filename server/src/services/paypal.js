/**
 * PayPal Integration Service
 * Full server-side SDK integration with verification and webhooks
 */

import { config } from '../config/index.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { PaymentError } from '../middleware/errorHandler.js';
import crypto from 'crypto';

/**
 * PayPal API client
 */
class PayPalService {
  constructor() {
    this.baseUrl = config.paypal.apiUrl;
    this.clientId = config.paypal.clientId;
    this.clientSecret = config.paypal.clientSecret;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Get OAuth access token
   */
  async getAccessToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('PayPal OAuth failed', { error });
      throw new PaymentError('Failed to authenticate with PayPal');
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    // Set expiry 5 minutes before actual expiry for safety
    this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

    return this.accessToken;
  }

  /**
   * Make authenticated API request
   */
  async apiRequest(method, endpoint, body = null) {
    const token = await this.getAccessToken();

    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': crypto.randomUUID()
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      logger.error('PayPal API error', {
        endpoint,
        status: response.status,
        error
      });
      throw new PaymentError(
        error.message || 'PayPal API request failed',
        { paypalError: error }
      );
    }

    return response.json();
  }

  /**
   * Create a PayPal order
   */
  async createOrder(orderData) {
    const { amount, currency = 'USD', items, shipping, description, internalOrderId } = orderData;

    const payload = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: internalOrderId,
        description: description || 'Home Grown Creations Order',
        custom_id: internalOrderId,
        amount: {
          currency_code: currency,
          value: amount.toFixed(2),
          breakdown: {
            item_total: {
              currency_code: currency,
              value: orderData.subtotal?.toFixed(2) || amount.toFixed(2)
            },
            shipping: {
              currency_code: currency,
              value: (orderData.shippingAmount || 0).toFixed(2)
            },
            tax_total: {
              currency_code: currency,
              value: (orderData.taxAmount || 0).toFixed(2)
            },
            discount: {
              currency_code: currency,
              value: (orderData.discountAmount || 0).toFixed(2)
            }
          }
        },
        items: items?.map(item => ({
          name: item.name.substring(0, 127),
          description: item.description?.substring(0, 127),
          sku: item.sku,
          unit_amount: {
            currency_code: currency,
            value: item.price.toFixed(2)
          },
          quantity: item.quantity.toString(),
          category: 'PHYSICAL_GOODS'
        })),
        shipping: shipping ? {
          name: {
            full_name: `${shipping.firstName} ${shipping.lastName}`
          },
          address: {
            address_line_1: shipping.line1,
            address_line_2: shipping.line2 || undefined,
            admin_area_2: shipping.city,
            admin_area_1: shipping.state,
            postal_code: shipping.zip,
            country_code: shipping.country || 'US'
          }
        } : undefined
      }],
      application_context: {
        brand_name: 'Home Grown Creations',
        landing_page: 'NO_PREFERENCE',
        shipping_preference: shipping ? 'SET_PROVIDED_ADDRESS' : 'GET_FROM_FILE',
        user_action: 'PAY_NOW',
        return_url: `${config.frontendUrl}/checkout/success`,
        cancel_url: `${config.frontendUrl}/checkout/cancel`
      }
    };

    logger.info('Creating PayPal order', { internalOrderId, amount });

    const order = await this.apiRequest('POST', '/v2/checkout/orders', payload);

    logger.info('PayPal order created', {
      paypalOrderId: order.id,
      internalOrderId,
      status: order.status
    });

    return order;
  }

  /**
   * Capture a PayPal order (complete payment)
   */
  async captureOrder(paypalOrderId) {
    logger.info('Capturing PayPal order', { paypalOrderId });

    const capture = await this.apiRequest(
      'POST',
      `/v2/checkout/orders/${paypalOrderId}/capture`
    );

    const captureDetails = capture.purchase_units?.[0]?.payments?.captures?.[0];

    logger.info('PayPal order captured', {
      paypalOrderId,
      captureId: captureDetails?.id,
      status: capture.status,
      amount: captureDetails?.amount?.value
    });

    return {
      orderId: capture.id,
      status: capture.status,
      captureId: captureDetails?.id,
      amount: parseFloat(captureDetails?.amount?.value || 0),
      currency: captureDetails?.amount?.currency_code,
      payerEmail: capture.payer?.email_address,
      payerId: capture.payer?.payer_id,
      payerName: capture.payer?.name
        ? `${capture.payer.name.given_name} ${capture.payer.name.surname}`
        : null,
      createTime: capture.create_time,
      updateTime: capture.update_time,
      raw: capture
    };
  }

  /**
   * Get order details
   */
  async getOrder(paypalOrderId) {
    return this.apiRequest('GET', `/v2/checkout/orders/${paypalOrderId}`);
  }

  /**
   * Refund a captured payment
   */
  async refundPayment(captureId, amount = null, reason = null) {
    logger.info('Processing PayPal refund', { captureId, amount, reason });

    const payload = {};
    if (amount) {
      payload.amount = {
        currency_code: 'USD',
        value: amount.toFixed(2)
      };
    }
    if (reason) {
      payload.note_to_payer = reason.substring(0, 255);
    }

    const refund = await this.apiRequest(
      'POST',
      `/v2/payments/captures/${captureId}/refund`,
      Object.keys(payload).length > 0 ? payload : undefined
    );

    logger.info('PayPal refund processed', {
      captureId,
      refundId: refund.id,
      status: refund.status,
      amount: refund.amount?.value
    });

    return {
      refundId: refund.id,
      status: refund.status,
      amount: parseFloat(refund.amount?.value || 0),
      currency: refund.amount?.currency_code
    };
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(headers, body) {
    const webhookId = config.paypal.webhookId;

    if (!webhookId) {
      logger.warn('PayPal webhook ID not configured');
      return false;
    }

    const payload = {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: typeof body === 'string' ? JSON.parse(body) : body
    };

    try {
      const result = await this.apiRequest(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        payload
      );

      const isValid = result.verification_status === 'SUCCESS';

      if (!isValid) {
        logSecurityEvent('paypal_webhook_verification_failed', {
          transmissionId: headers['paypal-transmission-id'],
          status: result.verification_status
        });
      }

      return isValid;
    } catch (error) {
      logger.error('Webhook verification error', { error: error.message });
      return false;
    }
  }

  /**
   * Process webhook event
   */
  async handleWebhookEvent(eventType, resource) {
    logger.info('Processing PayPal webhook', { eventType, resourceId: resource?.id });

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED':
        return this.handleCaptureCompleted(resource);

      case 'PAYMENT.CAPTURE.DENIED':
        return this.handleCaptureDenied(resource);

      case 'PAYMENT.CAPTURE.REFUNDED':
        return this.handleCaptureRefunded(resource);

      case 'CHECKOUT.ORDER.APPROVED':
        return this.handleOrderApproved(resource);

      case 'CHECKOUT.ORDER.COMPLETED':
        return this.handleOrderCompleted(resource);

      default:
        logger.info('Unhandled webhook event type', { eventType });
        return { handled: false, eventType };
    }
  }

  async handleCaptureCompleted(resource) {
    // Payment was successfully captured
    return {
      handled: true,
      action: 'capture_completed',
      captureId: resource.id,
      amount: parseFloat(resource.amount?.value || 0),
      customId: resource.custom_id
    };
  }

  async handleCaptureDenied(resource) {
    // Payment capture was denied
    logSecurityEvent('paypal_capture_denied', {
      captureId: resource.id,
      reason: resource.status_details
    });

    return {
      handled: true,
      action: 'capture_denied',
      captureId: resource.id,
      reason: resource.status_details
    };
  }

  async handleCaptureRefunded(resource) {
    return {
      handled: true,
      action: 'refund_processed',
      captureId: resource.id,
      amount: parseFloat(resource.amount?.value || 0)
    };
  }

  async handleOrderApproved(resource) {
    return {
      handled: true,
      action: 'order_approved',
      orderId: resource.id
    };
  }

  async handleOrderCompleted(resource) {
    return {
      handled: true,
      action: 'order_completed',
      orderId: resource.id
    };
  }

  /**
   * Validate PayPal client configuration
   */
  validateConfiguration() {
    const errors = [];

    if (!this.clientId || this.clientId.includes('REPLACE')) {
      errors.push('PayPal Client ID not configured');
    }

    if (!this.clientSecret || this.clientSecret.includes('REPLACE')) {
      errors.push('PayPal Client Secret not configured');
    }

    if (config.env === 'production' && config.paypal.mode !== 'live') {
      errors.push('PayPal is in sandbox mode but environment is production');
    }

    return {
      isValid: errors.length === 0,
      errors,
      mode: config.paypal.mode,
      clientIdConfigured: !this.clientId?.includes('REPLACE'),
      webhookConfigured: !!config.paypal.webhookId
    };
  }
}

// Export singleton instance
export const paypalService = new PayPalService();

export default paypalService;
