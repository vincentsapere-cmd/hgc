/**
 * Admin Dashboard Routes
 * Analytics and overview statistics
 */

import express from 'express';
import { getDatabase } from '../../database/init.js';

const router = express.Router();

/**
 * GET /admin/dashboard
 * Get dashboard overview statistics
 */
router.get('/', async (req, res, next) => {
  try {
    const db = getDatabase();

    // Get date ranges
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Revenue statistics
    const revenueStats = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN date(created_at) = date('now') THEN grand_total ELSE 0 END), 0) as today_revenue,
        COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-7 days') THEN grand_total ELSE 0 END), 0) as week_revenue,
        COALESCE(SUM(CASE WHEN date(created_at) >= date('now', '-30 days') THEN grand_total ELSE 0 END), 0) as month_revenue,
        COALESCE(SUM(grand_total), 0) as total_revenue
      FROM orders
      WHERE payment_status = 'paid'
    `).get();

    // Order statistics
    const orderStats = db.prepare(`
      SELECT
        COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) as today_orders,
        COUNT(CASE WHEN date(created_at) >= date('now', '-7 days') THEN 1 END) as week_orders,
        COUNT(CASE WHEN date(created_at) >= date('now', '-30 days') THEN 1 END) as month_orders,
        COUNT(*) as total_orders
      FROM orders
      WHERE payment_status = 'paid'
    `).get();

    // Pending orders
    const pendingOrders = db.prepare(`
      SELECT COUNT(*) as count FROM orders WHERE status = 'pending' OR status = 'confirmed'
    `).get().count;

    // Low stock products
    const lowStockProducts = db.prepare(`
      SELECT COUNT(*) as count FROM products
      WHERE is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold
    `).get().count;

    // Customer statistics
    const customerStats = db.prepare(`
      SELECT
        COUNT(CASE WHEN date(created_at) = date('now') THEN 1 END) as today_customers,
        COUNT(CASE WHEN date(created_at) >= date('now', '-30 days') THEN 1 END) as month_customers,
        COUNT(*) as total_customers
      FROM users
      WHERE role = 'customer'
    `).get();

    // Average order value
    const avgOrderValue = db.prepare(`
      SELECT AVG(grand_total) as avg FROM orders WHERE payment_status = 'paid'
    `).get().avg || 0;

    // Top selling products (last 30 days)
    const topProducts = db.prepare(`
      SELECT p.id, p.name, p.image_url, SUM(oi.quantity) as total_sold, SUM(oi.total_price) as revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.payment_status = 'paid' AND o.created_at >= date('now', '-30 days')
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT 5
    `).all();

    // Recent orders
    const recentOrders = db.prepare(`
      SELECT id, order_number, customer_first_name, customer_last_name, grand_total, status, created_at
      FROM orders
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    // Sales by day (last 7 days)
    const salesByDay = db.prepare(`
      SELECT date(created_at) as date, SUM(grand_total) as revenue, COUNT(*) as orders
      FROM orders
      WHERE payment_status = 'paid' AND created_at >= date('now', '-7 days')
      GROUP BY date(created_at)
      ORDER BY date
    `).all();

    // Sales by category (last 30 days)
    const salesByCategory = db.prepare(`
      SELECT c.name as category, SUM(oi.total_price) as revenue
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN categories c ON p.category_id = c.id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.payment_status = 'paid' AND o.created_at >= date('now', '-30 days')
      GROUP BY c.id
      ORDER BY revenue DESC
      LIMIT 10
    `).all();

    res.json({
      success: true,
      data: {
        revenue: {
          today: revenueStats.today_revenue,
          week: revenueStats.week_revenue,
          month: revenueStats.month_revenue,
          total: revenueStats.total_revenue
        },
        orders: {
          today: orderStats.today_orders,
          week: orderStats.week_orders,
          month: orderStats.month_orders,
          total: orderStats.total_orders,
          pending: pendingOrders
        },
        customers: {
          today: customerStats.today_customers,
          month: customerStats.month_customers,
          total: customerStats.total_customers
        },
        averageOrderValue: avgOrderValue,
        lowStockProducts,
        topProducts: topProducts.map(p => ({
          id: p.id,
          name: p.name,
          imageUrl: p.image_url,
          totalSold: p.total_sold,
          revenue: p.revenue
        })),
        recentOrders: recentOrders.map(o => ({
          id: o.id,
          orderNumber: o.order_number,
          customer: `${o.customer_first_name} ${o.customer_last_name}`,
          total: o.grand_total,
          status: o.status,
          createdAt: o.created_at
        })),
        charts: {
          salesByDay,
          salesByCategory
        }
      }
    });

  } catch (error) {
    next(error);
  }
});

export default router;
