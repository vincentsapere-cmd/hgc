/**
 * Gift Card Routes
 * Purchase, validate, and manage gift cards
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDatabase } from '../database/init.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { createGiftCardValidation, applyGiftCardValidation } from '../middleware/validators.js';
import { ValidationError, NotFoundError } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import { emailService } from '../services/email.js';

const router = express.Router();

/**
 * Generate unique gift card code
 */
const generateGiftCardCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'HGC-';
  for (let i = 0; i < 4; i++) {
    if (i > 0) code += '-';
    for (let j = 0; j < 4; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return code;
};

/**
 * POST /gift-cards/validate
 * Validate a gift card code and get balance
 */
router.post('/validate', applyGiftCardValidation, async (req, res, next) => {
  try {
    const { code } = req.body;
    const db = getDatabase();

    const giftCard = await db.prepare(`
      SELECT code, current_balance, status, expires_at
      FROM gift_cards
      WHERE code = ? AND status = 'active' AND current_balance > 0
      AND (expires_at IS NULL OR expires_at > NOW())
    `).get(code.toUpperCase().trim());

    if (!giftCard) {
      throw new ValidationError('Invalid, expired, or depleted gift card');
    }

    res.json({
      success: true,
      data: {
        code: giftCard.code,
        balance: parseFloat(giftCard.current_balance),
        expiresAt: giftCard.expires_at
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /gift-cards/check/:code
 * Quick balance check (public)
 */
router.get('/check/:code', async (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDatabase();

    const giftCard = await db.prepare(`
      SELECT code, current_balance, status, expires_at
      FROM gift_cards
      WHERE code = ?
    `).get(code.toUpperCase().trim());

    if (!giftCard) {
      throw new NotFoundError('Gift card not found');
    }

    res.json({
      success: true,
      data: {
        code: giftCard.code,
        balance: parseFloat(giftCard.current_balance),
        status: giftCard.status,
        expiresAt: giftCard.expires_at,
        isUsable: giftCard.status === 'active' && giftCard.current_balance > 0
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /gift-cards/my-cards
 * Get user's purchased and received gift cards
 */
router.get('/my-cards', authenticate, async (req, res, next) => {
  try {
    const db = getDatabase();
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);

    // Get gift cards purchased by or received by this user
    const giftCards = await db.prepare(`
      SELECT gc.*,
        u.first_name as purchaser_first_name,
        u.last_name as purchaser_last_name
      FROM gift_cards gc
      LEFT JOIN users u ON gc.purchaser_user_id = u.id
      WHERE gc.purchaser_user_id = ? OR gc.recipient_email = ?
      ORDER BY gc.created_at DESC
    `).all(req.user.id, user.email);

    res.json({
      success: true,
      data: giftCards.map(gc => ({
        id: gc.id,
        code: gc.code,
        initialBalance: parseFloat(gc.initial_balance),
        currentBalance: parseFloat(gc.current_balance),
        status: gc.status,
        isPurchased: gc.purchaser_user_id === req.user.id,
        isReceived: gc.recipient_email === user.email,
        recipientEmail: gc.recipient_email,
        recipientName: gc.recipient_name,
        personalMessage: gc.personal_message,
        expiresAt: gc.expires_at,
        createdAt: gc.created_at
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /gift-cards/:id/transactions
 * Get transaction history for a gift card
 */
router.get('/:id/transactions', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    // Verify ownership
    const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.id);
    const giftCard = await db.prepare(`
      SELECT * FROM gift_cards
      WHERE id = ? AND (purchaser_user_id = ? OR recipient_email = ?)
    `).get(id, req.user.id, user.email);

    if (!giftCard) {
      throw new NotFoundError('Gift card not found');
    }

    const transactions = await db.prepare(`
      SELECT gct.*, o.order_number
      FROM gift_card_transactions gct
      LEFT JOIN orders o ON gct.order_id = o.id
      WHERE gct.gift_card_id = ?
      ORDER BY gct.created_at DESC
    `).all(id);

    res.json({
      success: true,
      data: {
        giftCard: {
          code: giftCard.code,
          initialBalance: parseFloat(giftCard.initial_balance),
          currentBalance: parseFloat(giftCard.current_balance),
          status: giftCard.status
        },
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: parseFloat(t.amount),
          balanceBefore: parseFloat(t.balance_before),
          balanceAfter: parseFloat(t.balance_after),
          orderNumber: t.order_number,
          notes: t.notes,
          createdAt: t.created_at
        }))
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * Create gift card from order item (internal use)
 */
export const createGiftCardFromOrder = async (orderItem, order, userId = null) => {
  const db = getDatabase();
  const code = generateGiftCardCode();

  // Ensure code is unique
  let existingCard = await db.prepare('SELECT id FROM gift_cards WHERE code = ?').get(code);
  let attempts = 0;
  let finalCode = code;
  while (existingCard && attempts < 10) {
    finalCode = generateGiftCardCode();
    existingCard = await db.prepare('SELECT id FROM gift_cards WHERE code = ?').get(finalCode);
    attempts++;
  }

  const giftCardId = uuidv4();
  const amount = parseFloat(orderItem.unit_price);

  // Get gift card details from order item
  const recipientEmail = orderItem.gift_card_recipient_email || order.customer_email;
  const recipientName = orderItem.gift_card_recipient_name || `${order.customer_first_name} ${order.customer_last_name}`;
  const personalMessage = orderItem.gift_card_message || null;

  // Create gift card - expires in 1 year
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  await db.prepare(`
    INSERT INTO gift_cards (
      id, code, initial_balance, current_balance, currency, status,
      purchaser_user_id, purchaser_email, recipient_email, recipient_name, personal_message,
      purchased_order_id, purchased_order_item_id, expires_at
    ) VALUES (?, ?, ?, ?, 'USD', 'active', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    giftCardId, finalCode, amount, amount,
    userId, order.customer_email, recipientEmail, recipientName, personalMessage,
    order.id, orderItem.id, expiresAt.toISOString()
  );

  // Record initial transaction
  await db.prepare(`
    INSERT INTO gift_card_transactions (id, gift_card_id, order_id, type, amount, balance_before, balance_after, notes)
    VALUES (?, ?, ?, 'purchase', ?, 0, ?, 'Gift card purchased')
  `).run(uuidv4(), giftCardId, order.id, amount, amount);

  // Send gift card email to recipient
  try {
    await emailService.sendGiftCard({
      code: finalCode,
      initial_balance: amount,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      personal_message: personalMessage
    });
  } catch (emailError) {
    logger.error('Failed to send gift card email', { error: emailError.message, giftCardId });
  }

  logger.info('Gift card created', { giftCardId, code: finalCode, amount, orderId: order.id });

  return {
    id: giftCardId,
    code: finalCode,
    amount,
    recipientEmail
  };
};

/**
 * POST /gift-cards/send
 * Re-send gift card email
 */
router.post('/:id/send', authenticate, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    const db = getDatabase();

    const giftCard = await db.prepare(`
      SELECT * FROM gift_cards WHERE id = ? AND purchaser_user_id = ?
    `).get(id, req.user.id);

    if (!giftCard) {
      throw new NotFoundError('Gift card not found');
    }

    const recipientEmail = email || giftCard.recipient_email;

    // Update recipient if changed
    if (email && email !== giftCard.recipient_email) {
      await db.prepare('UPDATE gift_cards SET recipient_email = ? WHERE id = ?').run(email, id);
    }

    await emailService.sendGiftCard({
      code: giftCard.code,
      initial_balance: parseFloat(giftCard.initial_balance),
      recipient_email: recipientEmail,
      recipient_name: giftCard.recipient_name,
      personal_message: giftCard.personal_message
    });

    res.json({
      success: true,
      message: `Gift card sent to ${recipientEmail}`
    });

  } catch (error) {
    next(error);
  }
});

export default router;
