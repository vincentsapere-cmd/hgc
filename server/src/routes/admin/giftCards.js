/**
 * Admin Gift Card Management Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { getDatabase } from '../../database/init.js';
import { createGiftCardValidation } from '../../middleware/validators.js';
import { NotFoundError, ValidationError } from '../../middleware/errorHandler.js';
import { logAuditEvent } from '../../utils/logger.js';
import { emailService } from '../../services/email.js';

const router = express.Router();

/**
 * Generate unique gift card code
 */
const generateGiftCardCode = () => {
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `HGC-${random.slice(0, 4)}-${random.slice(4)}`;
};

/**
 * GET /admin/gift-cards
 * List all gift cards
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, status } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();

    let whereConditions = [];
    const params = [];

    if (search) {
      whereConditions.push('(code LIKE ? OR recipient_email LIKE ? OR recipient_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      whereConditions.push('status = ?');
      params.push(status);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const totalResult = await db.prepare(`SELECT COUNT(*) as count FROM gift_cards ${whereClause}`).get(...params);
    const total = totalResult.count;

    const giftCards = await db.prepare(`
      SELECT * FROM gift_cards ${whereClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      success: true,
      data: giftCards.map(gc => ({
        id: gc.id,
        code: gc.code,
        initialBalance: gc.initial_balance,
        currentBalance: gc.current_balance,
        status: gc.status,
        purchaserEmail: gc.purchaser_email,
        recipientEmail: gc.recipient_email,
        recipientName: gc.recipient_name,
        expiresAt: gc.expires_at,
        lastUsedAt: gc.last_used_at,
        createdAt: gc.created_at
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/gift-cards
 * Create gift card
 */
router.post('/', createGiftCardValidation, async (req, res, next) => {
  try {
    const { initialBalance, recipientEmail, recipientName, personalMessage, expiresAt, sendEmail } = req.body;
    const db = getDatabase();

    const giftCardId = uuidv4();
    const code = generateGiftCardCode();

    await db.prepare(`
      INSERT INTO gift_cards (id, code, initial_balance, current_balance, recipient_email, recipient_name, personal_message, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(giftCardId, code, initialBalance, initialBalance, recipientEmail || null, recipientName || null, personalMessage || null, expiresAt || null);

    // Record transaction
    await db.prepare(`
      INSERT INTO gift_card_transactions (id, gift_card_id, type, amount, balance_before, balance_after, created_by)
      VALUES (?, ?, 'purchase', ?, 0, ?, ?)
    `).run(uuidv4(), giftCardId, initialBalance, initialBalance, req.user.id);

    // Send email if requested
    if (sendEmail && recipientEmail) {
      await emailService.sendGiftCard({
        code,
        initial_balance: initialBalance,
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        personal_message: personalMessage
      });
    }

    logAuditEvent(req.user.id, 'gift_card_created', 'gift_card', giftCardId, { code, initialBalance }, req.ip);

    res.status(201).json({
      success: true,
      data: { id: giftCardId, code },
      message: 'Gift card created'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/gift-cards/:id
 * Get gift card details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const giftCard = await db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
    if (!giftCard) throw new NotFoundError('Gift card not found');

    const transactions = await db.prepare(`
      SELECT gt.*, o.order_number, u.email as user_email
      FROM gift_card_transactions gt
      LEFT JOIN orders o ON gt.order_id = o.id
      LEFT JOIN users u ON gt.created_by = u.id
      WHERE gt.gift_card_id = ?
      ORDER BY gt.created_at DESC
    `).all(id);

    res.json({
      success: true,
      data: {
        ...giftCard,
        transactions: transactions.map(t => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          balanceBefore: t.balance_before,
          balanceAfter: t.balance_after,
          orderNumber: t.order_number,
          notes: t.notes,
          createdBy: t.user_email,
          createdAt: t.created_at
        }))
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/gift-cards/:id/status
 * Update gift card status
 */
router.put('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const db = getDatabase();

    const validStatuses = ['active', 'disabled'];
    if (!validStatuses.includes(status)) throw new ValidationError('Invalid status');

    const giftCard = await db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
    if (!giftCard) throw new NotFoundError('Gift card not found');

    await db.prepare('UPDATE gift_cards SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);

    logAuditEvent(req.user.id, 'gift_card_status_changed', 'gift_card', id, { status, reason }, req.ip);

    res.json({ success: true, message: `Gift card ${status === 'disabled' ? 'disabled' : 'activated'}` });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/gift-cards/:id/adjust
 * Adjust gift card balance
 */
router.post('/:id/adjust', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { adjustment, reason } = req.body;
    const db = getDatabase();

    const giftCard = await db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
    if (!giftCard) throw new NotFoundError('Gift card not found');

    const newBalance = giftCard.current_balance + adjustment;
    if (newBalance < 0) throw new ValidationError('Cannot reduce balance below 0');

    const newStatus = newBalance <= 0 ? 'depleted' : 'active';

    await db.prepare('UPDATE gift_cards SET current_balance = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newBalance, newStatus, id);

    await db.prepare(`
      INSERT INTO gift_card_transactions (id, gift_card_id, type, amount, balance_before, balance_after, notes, created_by)
      VALUES (?, ?, 'adjustment', ?, ?, ?, ?, ?)
    `).run(uuidv4(), id, adjustment, giftCard.current_balance, newBalance, reason || null, req.user.id);

    logAuditEvent(req.user.id, 'gift_card_adjusted', 'gift_card', id, { adjustment, reason }, req.ip);

    res.json({
      success: true,
      data: { previousBalance: giftCard.current_balance, newBalance },
      message: 'Gift card balance adjusted'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/gift-cards/:id/resend
 * Resend gift card email
 */
router.post('/:id/resend', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    const db = getDatabase();

    const giftCard = await db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
    if (!giftCard) throw new NotFoundError('Gift card not found');

    const recipientEmail = email || giftCard.recipient_email;
    if (!recipientEmail) throw new ValidationError('No recipient email specified');

    await emailService.sendGiftCard({
      code: giftCard.code,
      initial_balance: giftCard.initial_balance,
      recipient_email: recipientEmail,
      recipient_name: giftCard.recipient_name,
      personal_message: giftCard.personal_message
    });

    res.json({ success: true, message: 'Gift card email sent' });

  } catch (error) {
    next(error);
  }
});

export default router;
