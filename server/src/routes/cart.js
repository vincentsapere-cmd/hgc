/**
 * Shopping Cart Routes
 * Cart management for guest and authenticated users
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database/init.js';
import { optionalAuth } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const router = express.Router();

/**
 * Get or create cart
 */
const getOrCreateCart = async (userId, sessionId, db) => {
  let cart;

  if (userId) {
    cart = await db.prepare(`
      SELECT * FROM carts WHERE user_id = ? AND status = 'active'
    `).get(userId);
  } else if (sessionId) {
    cart = await db.prepare(`
      SELECT * FROM carts WHERE session_id = ? AND status = 'active'
    `).get(sessionId);
  }

  if (!cart) {
    const cartId = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.prepare(`
      INSERT INTO carts (id, user_id, session_id, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(cartId, userId || null, sessionId || null, expiresAt);

    cart = { id: cartId, user_id: userId, session_id: sessionId };
  }

  return cart;
};

/**
 * GET /cart
 * Get current cart
 */
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const sessionId = req.cookies?.cartSession || req.headers['x-cart-session'];
    const db = getDatabase();

    const cart = await getOrCreateCart(req.user?.id, sessionId, db);

    // Get cart items with product details
    const items = await db.prepare(`
      SELECT ci.id, ci.quantity,
        p.id as product_id, p.sku, p.name, p.price, p.mg, p.unit, p.image_url,
        p.stock_quantity, p.track_inventory, p.allow_backorder,
        pv.id as variation_id, pv.name as variation_name, pv.price_modifier
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      LEFT JOIN product_variations pv ON ci.variation_id = pv.id
      WHERE ci.cart_id = ? AND p.is_active = 1
    `).all(cart.id);

    // Calculate totals
    let subtotal = 0;
    const formattedItems = items.map(item => {
      const price = item.price + (item.price_modifier || 0);
      const total = price * item.quantity;
      subtotal += total;

      return {
        id: item.id,
        productId: item.product_id,
        sku: item.sku,
        name: item.name,
        variationId: item.variation_id,
        variationName: item.variation_name,
        price,
        quantity: item.quantity,
        total,
        mg: item.mg,
        unit: item.unit,
        imageUrl: item.image_url,
        inStock: !item.track_inventory || item.stock_quantity > 0 || item.allow_backorder,
        stockQuantity: item.track_inventory ? item.stock_quantity : null
      };
    });

    // Set cart session cookie if not present
    if (!sessionId && !req.user) {
      res.cookie('cartSession', cart.session_id || cart.id, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      });
    }

    res.json({
      success: true,
      data: {
        cartId: cart.id,
        items: formattedItems,
        itemCount: formattedItems.reduce((sum, i) => sum + i.quantity, 0),
        subtotal
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /cart/items
 * Add item to cart
 */
router.post('/items', optionalAuth, async (req, res, next) => {
  try {
    const { productId, variationId, quantity = 1 } = req.body;
    const sessionId = req.cookies?.cartSession || req.headers['x-cart-session'] || uuidv4();
    const db = getDatabase();

    // Validate product
    const product = await db.prepare(`
      SELECT id, name, stock_quantity, track_inventory, allow_backorder
      FROM products WHERE id = ? AND is_active = 1
    `).get(productId);

    if (!product) {
      throw new NotFoundError('Product not found');
    }

    // Validate variation if provided
    if (variationId) {
      const variation = await db.prepare(`
        SELECT id FROM product_variations WHERE id = ? AND product_id = ? AND is_active = 1
      `).get(variationId, productId);

      if (!variation) {
        throw new NotFoundError('Product variation not found');
      }
    }

    // Check stock
    if (product.track_inventory && !product.allow_backorder && product.stock_quantity < quantity) {
      throw new ValidationError(`Only ${product.stock_quantity} items available`);
    }

    const cart = await getOrCreateCart(req.user?.id, sessionId, db);

    // Check if item already exists in cart
    const existingItem = await db.prepare(`
      SELECT id, quantity FROM cart_items
      WHERE cart_id = ? AND product_id = ? AND (variation_id = ? OR (variation_id IS NULL AND ? IS NULL))
    `).get(cart.id, productId, variationId, variationId);

    if (existingItem) {
      // Update quantity
      const newQuantity = existingItem.quantity + quantity;
      await db.prepare(`
        UPDATE cart_items SET quantity = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(newQuantity, existingItem.id);
    } else {
      // Add new item
      await db.prepare(`
        INSERT INTO cart_items (id, cart_id, product_id, variation_id, quantity)
        VALUES (?, ?, ?, ?, ?)
      `).run(uuidv4(), cart.id, productId, variationId || null, quantity);
    }

    // Update cart timestamp
    await db.prepare(`UPDATE carts SET updated_at = datetime('now') WHERE id = ?`).run(cart.id);

    // Set cart session cookie
    if (!req.cookies?.cartSession && !req.user) {
      res.cookie('cartSession', sessionId, {
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
    }

    res.json({
      success: true,
      message: 'Item added to cart'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * PUT /cart/items/:id
 * Update cart item quantity
 */
router.put('/items/:id', optionalAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { quantity } = req.body;
    const sessionId = req.cookies?.cartSession || req.headers['x-cart-session'];
    const db = getDatabase();

    if (quantity < 1) {
      throw new ValidationError('Quantity must be at least 1');
    }

    const cart = await getOrCreateCart(req.user?.id, sessionId, db);

    const item = await db.prepare(`
      SELECT ci.*, p.stock_quantity, p.track_inventory, p.allow_backorder
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.id = ? AND ci.cart_id = ?
    `).get(id, cart.id);

    if (!item) {
      throw new NotFoundError('Cart item not found');
    }

    // Check stock
    if (item.track_inventory && !item.allow_backorder && item.stock_quantity < quantity) {
      throw new ValidationError(`Only ${item.stock_quantity} items available`);
    }

    await db.prepare(`
      UPDATE cart_items SET quantity = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(quantity, id);

    res.json({
      success: true,
      message: 'Cart updated'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /cart/items/:id
 * Remove item from cart
 */
router.delete('/items/:id', optionalAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const sessionId = req.cookies?.cartSession || req.headers['x-cart-session'];
    const db = getDatabase();

    const cart = await getOrCreateCart(req.user?.id, sessionId, db);

    const result = await db.prepare('DELETE FROM cart_items WHERE id = ? AND cart_id = ?').run(id, cart.id);

    if (result.changes === 0) {
      throw new NotFoundError('Cart item not found');
    }

    res.json({
      success: true,
      message: 'Item removed from cart'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /cart
 * Clear entire cart
 */
router.delete('/', optionalAuth, async (req, res, next) => {
  try {
    const sessionId = req.cookies?.cartSession || req.headers['x-cart-session'];
    const db = getDatabase();

    const cart = await getOrCreateCart(req.user?.id, sessionId, db);

    await db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);

    res.json({
      success: true,
      message: 'Cart cleared'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /cart/merge
 * Merge guest cart into user cart (after login)
 */
router.post('/merge', optionalAuth, async (req, res, next) => {
  try {
    if (!req.user) {
      return res.json({ success: true, message: 'No user to merge' });
    }

    const sessionId = req.cookies?.cartSession || req.headers['x-cart-session'];
    if (!sessionId) {
      return res.json({ success: true, message: 'No guest cart to merge' });
    }

    const db = getDatabase();

    // Get guest cart
    const guestCart = await db.prepare(`
      SELECT * FROM carts WHERE session_id = ? AND status = 'active' AND user_id IS NULL
    `).get(sessionId);

    if (!guestCart) {
      return res.json({ success: true, message: 'No guest cart found' });
    }

    // Get or create user cart
    const userCart = await getOrCreateCart(req.user.id, null, db);

    // Get guest cart items
    const guestItems = await db.prepare('SELECT * FROM cart_items WHERE cart_id = ?').all(guestCart.id);

    // Merge items
    for (const item of guestItems) {
      const existingItem = await db.prepare(`
        SELECT id, quantity FROM cart_items
        WHERE cart_id = ? AND product_id = ? AND (variation_id = ? OR (variation_id IS NULL AND ? IS NULL))
      `).get(userCart.id, item.product_id, item.variation_id, item.variation_id);

      if (existingItem) {
        await db.prepare('UPDATE cart_items SET quantity = quantity + ? WHERE id = ?')
          .run(item.quantity, existingItem.id);
      } else {
        await db.prepare(`
          INSERT INTO cart_items (id, cart_id, product_id, variation_id, quantity)
          VALUES (?, ?, ?, ?, ?)
        `).run(uuidv4(), userCart.id, item.product_id, item.variation_id, item.quantity);
      }
    }

    // Delete guest cart
    await db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(guestCart.id);
    await db.prepare('DELETE FROM carts WHERE id = ?').run(guestCart.id);

    // Clear guest cart cookie
    res.clearCookie('cartSession');

    res.json({
      success: true,
      message: 'Cart merged successfully'
    });

  } catch (error) {
    next(error);
  }
});

export default router;
