/**
 * User Routes
 * User profile, addresses, wishlist, and account management
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/init.js';
import { authenticate } from '../middleware/auth.js';
import { addressValidation, reviewValidation } from '../middleware/validators.js';
import { NotFoundError, ValidationError, ConflictError, AuthenticationError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * PUT /users/profile
 * Update user profile
 */
router.put('/profile', async (req, res, next) => {
  try {
    const { firstName, lastName, phone } = req.body;
    const db = getDatabase();

    db.prepare(`
      UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(firstName, lastName, phone || null, req.user.id);

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /users/password
 * Change password
 */
router.put('/password', async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = getDatabase();

    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);

    const validPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!validPassword) {
      throw new AuthenticationError('Current password is incorrect');
    }

    // Validate new password
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      throw new ValidationError('Password must be at least 8 characters with uppercase, lowercase, number, and special character');
    }

    const newHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(newHash, req.user.id);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /users/addresses
 * Get user addresses
 */
router.get('/addresses', async (req, res, next) => {
  try {
    const db = getDatabase();

    const addresses = db.prepare(`
      SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC
    `).all(req.user.id);

    res.json({
      success: true,
      data: addresses.map(a => ({
        id: a.id,
        label: a.label,
        firstName: a.first_name,
        lastName: a.last_name,
        streetAddress: a.street_address,
        streetAddress2: a.street_address_2,
        city: a.city,
        state: a.state,
        zipCode: a.zip_code,
        country: a.country,
        phone: a.phone,
        isDefault: !!a.is_default,
        isBilling: !!a.is_billing
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /users/addresses
 * Add new address
 */
router.post('/addresses', addressValidation, async (req, res, next) => {
  try {
    const {
      label, firstName, lastName, streetAddress, streetAddress2,
      city, state, zipCode, country, phone, isDefault, isBilling
    } = req.body;
    const db = getDatabase();

    const addressId = uuidv4();

    // If this is default, unset other defaults
    if (isDefault) {
      db.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }

    db.prepare(`
      INSERT INTO user_addresses (id, user_id, label, first_name, last_name, street_address,
        street_address_2, city, state, zip_code, country, phone, is_default, is_billing)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      addressId, req.user.id, label || 'Home', firstName, lastName, streetAddress,
      streetAddress2 || null, city, state, zipCode, country || 'US', phone || null,
      isDefault ? 1 : 0, isBilling ? 1 : 0
    );

    res.status(201).json({
      success: true,
      data: { id: addressId },
      message: 'Address added successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /users/addresses/:id
 * Update address
 */
router.put('/addresses/:id', addressValidation, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      label, firstName, lastName, streetAddress, streetAddress2,
      city, state, zipCode, country, phone, isDefault, isBilling
    } = req.body;
    const db = getDatabase();

    // Verify ownership
    const address = db.prepare('SELECT id FROM user_addresses WHERE id = ? AND user_id = ?')
      .get(id, req.user.id);

    if (!address) {
      throw new NotFoundError('Address not found');
    }

    // If this is default, unset other defaults
    if (isDefault) {
      db.prepare('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    }

    db.prepare(`
      UPDATE user_addresses SET
        label = ?, first_name = ?, last_name = ?, street_address = ?, street_address_2 = ?,
        city = ?, state = ?, zip_code = ?, country = ?, phone = ?, is_default = ?, is_billing = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      label, firstName, lastName, streetAddress, streetAddress2 || null,
      city, state, zipCode, country || 'US', phone || null,
      isDefault ? 1 : 0, isBilling ? 1 : 0, id
    );

    res.json({
      success: true,
      message: 'Address updated successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /users/addresses/:id
 * Delete address
 */
router.delete('/addresses/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    const result = db.prepare('DELETE FROM user_addresses WHERE id = ? AND user_id = ?')
      .run(id, req.user.id);

    if (result.changes === 0) {
      throw new NotFoundError('Address not found');
    }

    res.json({
      success: true,
      message: 'Address deleted successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /users/wishlist
 * Get user wishlist
 */
router.get('/wishlist', async (req, res, next) => {
  try {
    const db = getDatabase();

    const items = db.prepare(`
      SELECT w.id, w.created_at,
        p.id as product_id, p.name, p.slug, p.price, p.compare_at_price,
        p.image_url, p.mg, p.stock_quantity, p.track_inventory
      FROM wishlists w
      JOIN products p ON w.product_id = p.id
      WHERE w.user_id = ? AND p.is_active = 1
      ORDER BY w.created_at DESC
    `).all(req.user.id);

    res.json({
      success: true,
      data: items.map(i => ({
        id: i.id,
        productId: i.product_id,
        name: i.name,
        slug: i.slug,
        price: i.price,
        compareAtPrice: i.compare_at_price,
        imageUrl: i.image_url,
        mg: i.mg,
        inStock: !i.track_inventory || i.stock_quantity > 0,
        addedAt: i.created_at
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /users/wishlist
 * Add item to wishlist
 */
router.post('/wishlist', async (req, res, next) => {
  try {
    const { productId } = req.body;
    const db = getDatabase();

    // Verify product exists
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(productId);
    if (!product) {
      throw new NotFoundError('Product not found');
    }

    // Check if already in wishlist
    const existing = db.prepare('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?')
      .get(req.user.id, productId);

    if (existing) {
      throw new ConflictError('Product already in wishlist');
    }

    const wishlistId = uuidv4();
    db.prepare('INSERT INTO wishlists (id, user_id, product_id) VALUES (?, ?, ?)')
      .run(wishlistId, req.user.id, productId);

    res.status(201).json({
      success: true,
      data: { id: wishlistId },
      message: 'Added to wishlist'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /users/wishlist/:productId
 * Remove item from wishlist
 */
router.delete('/wishlist/:productId', async (req, res, next) => {
  try {
    const { productId } = req.params;
    const db = getDatabase();

    const result = db.prepare('DELETE FROM wishlists WHERE user_id = ? AND product_id = ?')
      .run(req.user.id, productId);

    if (result.changes === 0) {
      throw new NotFoundError('Item not in wishlist');
    }

    res.json({
      success: true,
      message: 'Removed from wishlist'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /users/reviews
 * Submit product review
 */
router.post('/reviews', reviewValidation, async (req, res, next) => {
  try {
    const { productId, rating, title, content } = req.body;
    const db = getDatabase();

    // Verify product exists
    const product = db.prepare('SELECT id FROM products WHERE id = ? AND is_active = 1').get(productId);
    if (!product) {
      throw new NotFoundError('Product not found');
    }

    // Check if user already reviewed
    const existing = db.prepare('SELECT id FROM product_reviews WHERE user_id = ? AND product_id = ?')
      .get(req.user.id, productId);

    if (existing) {
      throw new ConflictError('You have already reviewed this product');
    }

    // Check if verified purchase
    const purchase = db.prepare(`
      SELECT o.id FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.user_id = ? AND oi.product_id = ? AND o.status IN ('confirmed', 'shipped', 'delivered')
      LIMIT 1
    `).get(req.user.id, productId);

    const reviewId = uuidv4();
    db.prepare(`
      INSERT INTO product_reviews (id, product_id, user_id, order_id, rating, title, content, is_verified_purchase, is_approved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(reviewId, productId, req.user.id, purchase?.id || null, rating, title || null, content || null, purchase ? 1 : 0);

    res.status(201).json({
      success: true,
      data: { id: reviewId },
      message: 'Review submitted for approval'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /users/notifications
 * Get user notifications
 */
router.get('/notifications', async (req, res, next) => {
  try {
    const db = getDatabase();

    const notifications = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(req.user.id);

    const unreadCount = db.prepare(`
      SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0
    `).get(req.user.id).count;

    res.json({
      success: true,
      data: {
        notifications: notifications.map(n => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          data: n.data ? JSON.parse(n.data) : null,
          isRead: !!n.is_read,
          createdAt: n.created_at
        })),
        unreadCount
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /users/notifications/:id/read
 * Mark notification as read
 */
router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDatabase();

    db.prepare(`
      UPDATE notifications SET is_read = 1, read_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(id, req.user.id);

    res.json({ success: true });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /users/notifications/read-all
 * Mark all notifications as read
 */
router.put('/notifications/read-all', async (req, res, next) => {
  try {
    const db = getDatabase();

    db.prepare(`
      UPDATE notifications SET is_read = 1, read_at = datetime('now')
      WHERE user_id = ? AND is_read = 0
    `).run(req.user.id);

    res.json({ success: true });

  } catch (error) {
    next(error);
  }
});

export default router;
