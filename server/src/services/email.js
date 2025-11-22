/**
 * Email Service
 * Full email integration with Nodemailer, templates, and multiple provider support
 */

import nodemailer from 'nodemailer';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { getDatabase } from '../database/init.js';
import { v4 as uuidv4 } from 'uuid';

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = false;
  }

  /**
   * Initialize email transporter
   */
  async initialize() {
    try {
      if (config.email.provider === 'smtp') {
        this.transporter = nodemailer.createTransport({
          host: config.email.smtp.host,
          port: config.email.smtp.port,
          secure: config.email.smtp.secure,
          auth: {
            user: config.email.smtp.user,
            pass: config.email.smtp.password
          },
          tls: {
            rejectUnauthorized: config.env === 'production'
          }
        });
      }

      // Verify connection in non-development
      if (config.env !== 'development' && this.transporter) {
        await this.transporter.verify();
        this.isConfigured = true;
        logger.info('Email service initialized successfully');
      } else {
        // In development, log emails instead of sending
        this.isConfigured = false;
        logger.info('Email service running in development mode (logging only)');
      }
    } catch (error) {
      logger.error('Email service initialization failed', { error: error.message });
      this.isConfigured = false;
    }
  }

  /**
   * Get email template from database
   */
  getTemplate(name) {
    try {
      const db = getDatabase();
      return db.prepare(`
        SELECT * FROM email_templates WHERE name = ? AND is_active = 1
      `).get(name);
    } catch (error) {
      logger.error('Failed to get email template', { name, error: error.message });
      return null;
    }
  }

  /**
   * Render template with variables
   */
  renderTemplate(template, variables) {
    let html = template.html_body;
    let subject = template.subject;

    // Replace all variables
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      html = html.replace(regex, value || '');
      subject = subject.replace(regex, value || '');
    }

    return { html, subject };
  }

  /**
   * Log email to database
   */
  logEmail(templateId, recipient, subject, status, error = null, providerId = null) {
    try {
      const db = getDatabase();
      db.prepare(`
        INSERT INTO email_log (id, template_id, recipient_email, subject, status, provider_message_id, error_message, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(uuidv4(), templateId, recipient, subject, status, providerId, error);
    } catch (err) {
      logger.error('Failed to log email', { error: err.message });
    }
  }

  /**
   * Send email
   */
  async sendEmail({ to, subject, html, text, template, variables, attachments }) {
    // If template is specified, load and render it
    if (template) {
      const templateData = this.getTemplate(template);
      if (templateData) {
        const rendered = this.renderTemplate(templateData, variables || {});
        html = rendered.html;
        subject = rendered.subject;
      }
    }

    const mailOptions = {
      from: `"${config.email.fromName}" <${config.email.from}>`,
      to,
      subject,
      html,
      text: text || this.htmlToText(html),
      attachments
    };

    // Development mode - log only
    if (!this.isConfigured || config.env === 'development') {
      logger.info('📧 Email (Dev Mode)', {
        to,
        subject,
        template,
        preview: html?.substring(0, 200)
      });
      this.logEmail(null, to, subject, 'sent');
      return { success: true, mode: 'development' };
    }

    try {
      const result = await this.transporter.sendMail(mailOptions);
      logger.info('Email sent successfully', {
        to,
        subject,
        messageId: result.messageId
      });
      this.logEmail(null, to, subject, 'sent', null, result.messageId);
      return { success: true, messageId: result.messageId };
    } catch (error) {
      logger.error('Failed to send email', {
        to,
        subject,
        error: error.message
      });
      this.logEmail(null, to, subject, 'failed', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Convert HTML to plain text
   */
  htmlToText(html) {
    if (!html) return '';
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ==========================================================================
  // TRANSACTIONAL EMAIL METHODS
  // ==========================================================================

  /**
   * Send order confirmation email
   */
  async sendOrderConfirmation(order) {
    const itemsHtml = order.items.map(item => `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #eee;">
          ${item.name}${item.variation_name ? ` (${item.variation_name})` : ''}
        </td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: right;">$${item.total_price.toFixed(2)}</td>
      </tr>
    `).join('');

    const orderItemsTable = `
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 10px; text-align: left;">Item</th>
            <th style="padding: 10px; text-align: center;">Qty</th>
            <th style="padding: 10px; text-align: right;">Price</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>
    `;

    return this.sendEmail({
      to: order.customer_email,
      template: 'order_confirmation',
      variables: {
        order_number: order.order_number,
        customer_name: `${order.customer_first_name} ${order.customer_last_name}`,
        order_items: orderItemsTable,
        subtotal: order.subtotal.toFixed(2),
        shipping: order.shipping_total.toFixed(2),
        tax: order.tax_total.toFixed(2),
        total: order.grand_total.toFixed(2)
      }
    });
  }

  /**
   * Send order shipped notification
   */
  async sendOrderShipped(order, trackingNumber, carrier) {
    return this.sendEmail({
      to: order.customer_email,
      template: 'order_shipped',
      variables: {
        order_number: order.order_number,
        customer_name: `${order.customer_first_name} ${order.customer_last_name}`,
        tracking_number: trackingNumber,
        carrier: carrier
      }
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordReset(user, resetToken) {
    const resetLink = `${config.frontendUrl}/reset-password?token=${resetToken}`;

    return this.sendEmail({
      to: user.email,
      template: 'password_reset',
      variables: {
        customer_name: `${user.first_name} ${user.last_name}`,
        reset_link: resetLink
      }
    });
  }

  /**
   * Send welcome email
   */
  async sendWelcome(user) {
    return this.sendEmail({
      to: user.email,
      template: 'welcome',
      variables: {
        customer_name: `${user.first_name} ${user.last_name}`
      }
    });
  }

  /**
   * Send admin notification for new order
   */
  async sendAdminNewOrderNotification(order) {
    const html = `
      <h2>New Order Received</h2>
      <p><strong>Order Number:</strong> ${order.order_number}</p>
      <p><strong>Customer:</strong> ${order.customer_first_name} ${order.customer_last_name}</p>
      <p><strong>Email:</strong> ${order.customer_email}</p>
      <p><strong>Total:</strong> $${order.grand_total.toFixed(2)}</p>
      <p><strong>Items:</strong> ${order.items.length}</p>
      <p>
        <a href="${config.frontendUrl}/admin/orders/${order.id}"
           style="background: #4A7043; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">
          View Order
        </a>
      </p>
    `;

    return this.sendEmail({
      to: config.email.ordersEmail,
      subject: `New Order #${order.order_number} - $${order.grand_total.toFixed(2)}`,
      html
    });
  }

  /**
   * Send gift card email
   */
  async sendGiftCard(giftCard) {
    const html = `
      <div style="text-align: center; padding: 40px;">
        <h1 style="color: #4A7043;">🎁 You've Received a Gift Card!</h1>
        ${giftCard.recipient_name ? `<p>Dear ${giftCard.recipient_name},</p>` : ''}
        <p>Someone special sent you a Home Grown Creations gift card!</p>
        ${giftCard.personal_message ? `<p style="font-style: italic; padding: 20px; background: #f5f5f5; border-radius: 8px;">"${giftCard.personal_message}"</p>` : ''}
        <div style="background: linear-gradient(135deg, #4A7043, #7FB069); color: white; padding: 30px; border-radius: 12px; margin: 20px 0;">
          <p style="font-size: 14px; margin: 0;">Gift Card Value</p>
          <p style="font-size: 48px; font-weight: bold; margin: 10px 0;">$${giftCard.initial_balance.toFixed(2)}</p>
          <p style="font-size: 18px; letter-spacing: 2px; margin: 0;">${giftCard.code}</p>
        </div>
        <p>Use this code at checkout to redeem your gift card.</p>
        <p><a href="${config.frontendUrl}" style="color: #4A7043;">Shop Now →</a></p>
      </div>
    `;

    return this.sendEmail({
      to: giftCard.recipient_email,
      subject: 'You\'ve Received a Home Grown Creations Gift Card! 🎁',
      html
    });
  }

  /**
   * Validate email configuration
   */
  validateConfiguration() {
    const errors = [];

    if (config.email.smtp.host?.includes('your-email-provider')) {
      errors.push('SMTP host not configured');
    }

    if (config.email.smtp.user?.includes('REPLACE')) {
      errors.push('SMTP username not configured');
    }

    if (config.email.smtp.password?.includes('REPLACE')) {
      errors.push('SMTP password not configured');
    }

    return {
      isValid: errors.length === 0,
      isConfigured: this.isConfigured,
      errors,
      provider: config.email.provider
    };
  }
}

// Export singleton instance
export const emailService = new EmailService();

// Initialize on import
emailService.initialize().catch(err => {
  logger.error('Email service failed to initialize', { error: err.message });
});

export default emailService;
