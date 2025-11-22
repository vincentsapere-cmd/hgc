/**
 * Admin User Management Routes
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../../database/init.js';
import { requireSuperAdmin } from '../../middleware/auth.js';
import { NotFoundError, ValidationError, ConflictError } from '../../middleware/errorHandler.js';
import { logAuditEvent, logSecurityEvent } from '../../utils/logger.js';
import { config } from '../../config/index.js';

const router = express.Router();

/**
 * GET /admin/users
 * List all users
 */
router.get('/', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, role, status, sort = 'created_at', order = 'desc' } = req.query;
    const offset = (page - 1) * limit;
    const db = getDatabase();

    let whereConditions = [];
    const params = [];

    if (search) {
      whereConditions.push('(email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (role) {
      whereConditions.push('role = ?');
      params.push(role);
    }

    if (status) {
      whereConditions.push('status = ?');
      params.push(status);
    }

    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) as count FROM users ${whereClause}`).get(...params).count;

    const users = db.prepare(`
      SELECT id, email, first_name, last_name, phone, role, status, email_verified,
        two_factor_enabled, last_login, created_at
      FROM users ${whereClause}
      ORDER BY ${sort} ${order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    // Get order counts
    const userIds = users.map(u => u.id);
    let orderCounts = {};
    if (userIds.length) {
      const counts = db.prepare(`
        SELECT user_id, COUNT(*) as count, SUM(grand_total) as total_spent
        FROM orders WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND payment_status = 'paid'
        GROUP BY user_id
      `).all(...userIds);
      orderCounts = counts.reduce((acc, c) => ({ ...acc, [c.user_id]: { orders: c.count, spent: c.total_spent } }), {});
    }

    res.json({
      success: true,
      data: users.map(u => ({
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        phone: u.phone,
        role: u.role,
        status: u.status,
        emailVerified: !!u.email_verified,
        twoFactorEnabled: !!u.two_factor_enabled,
        orders: orderCounts[u.id]?.orders || 0,
        totalSpent: orderCounts[u.id]?.spent || 0,
        lastLogin: u.last_login,
        createdAt: u.created_at
      })),
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / limit) }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/users/:id
 * Get user details
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const user = db.prepare(`
      SELECT id, email, first_name, last_name, phone, role, status, email_verified,
        two_factor_enabled, last_login, login_attempts, locked_until, created_at, updated_at
      FROM users WHERE id = ?
    `).get(id);

    if (!user) throw new NotFoundError('User not found');

    const addresses = db.prepare('SELECT * FROM user_addresses WHERE user_id = ?').all(id);
    const orders = db.prepare(`
      SELECT id, order_number, grand_total, status, created_at
      FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
    `).all(id);
    const reviews = db.prepare(`
      SELECT r.*, p.name as product_name FROM product_reviews r
      JOIN products p ON r.product_id = p.id WHERE r.user_id = ?
    `).all(id);

    res.json({
      success: true,
      data: {
        ...user,
        emailVerified: !!user.email_verified,
        twoFactorEnabled: !!user.two_factor_enabled,
        addresses: addresses.map(a => ({
          id: a.id,
          label: a.label,
          firstName: a.first_name,
          lastName: a.last_name,
          streetAddress: a.street_address,
          city: a.city,
          state: a.state,
          zipCode: a.zip_code,
          isDefault: !!a.is_default
        })),
        recentOrders: orders.map(o => ({
          id: o.id,
          orderNumber: o.order_number,
          total: o.grand_total,
          status: o.status,
          createdAt: o.created_at
        })),
        reviews: reviews.map(r => ({
          id: r.id,
          productName: r.product_name,
          rating: r.rating,
          isApproved: !!r.is_approved,
          createdAt: r.created_at
        }))
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/users
 * Create admin user (super admin only)
 */
router.post('/', requireSuperAdmin, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, role } = req.body;
    const db = getDatabase();

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existing) throw new ConflictError('Email already exists');

    const validRoles = ['admin', 'manager'];
    if (!validRoles.includes(role)) throw new ValidationError('Invalid role');

    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);
    const userId = uuidv4();

    db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, email_verified)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 1)
    `).run(userId, email.toLowerCase(), passwordHash, firstName, lastName, role);

    logAuditEvent(req.user.id, 'admin_user_created', 'user', userId, { email, role }, req.ip);

    res.status(201).json({ success: true, data: { id: userId }, message: 'Admin user created' });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/users/:id/status
 * Update user status (suspend/activate)
 */
router.put('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const db = getDatabase();

    const user = db.prepare('SELECT email, role FROM users WHERE id = ?').get(id);
    if (!user) throw new NotFoundError('User not found');

    // Cannot modify super_admin
    if (user.role === 'super_admin' && req.user.role !== 'super_admin') {
      throw new ValidationError('Cannot modify super admin');
    }

    const validStatuses = ['active', 'suspended'];
    if (!validStatuses.includes(status)) throw new ValidationError('Invalid status');

    db.prepare('UPDATE users SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, id);

    if (status === 'suspended') {
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);
      logSecurityEvent('user_suspended', { userId: id, reason, by: req.user.id });
    }

    logAuditEvent(req.user.id, 'user_status_changed', 'user', id, { status, reason }, req.ip);

    res.json({ success: true, message: `User ${status === 'suspended' ? 'suspended' : 'activated'}` });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/users/:id/role
 * Update user role (super admin only)
 */
router.put('/:id/role', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    const db = getDatabase();

    const validRoles = ['customer', 'manager', 'admin'];
    if (!validRoles.includes(role)) throw new ValidationError('Invalid role');

    db.prepare('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?').run(role, id);

    logAuditEvent(req.user.id, 'user_role_changed', 'user', id, { role }, req.ip);

    res.json({ success: true, message: 'User role updated' });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/users/:id/reset-password
 * Reset user password
 */
router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    const db = getDatabase();

    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(id);
    if (!user) throw new NotFoundError('User not found');

    const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(passwordHash, id);
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(id);

    logAuditEvent(req.user.id, 'user_password_reset', 'user', id, {}, req.ip);
    logSecurityEvent('admin_password_reset', { userId: id, by: req.user.id });

    res.json({ success: true, message: 'Password reset successfully' });

  } catch (error) {
    next(error);
  }
});

export default router;
