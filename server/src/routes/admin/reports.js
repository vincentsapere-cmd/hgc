/**
 * Admin Reports Routes
 * Sales reports, inventory reports, customer reports
 */

import express from 'express';
import { getDatabase } from '../../database/init.js';

const router = express.Router();

/**
 * GET /admin/reports/sales
 * Sales report with date range
 */
router.get('/sales', async (req, res, next) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;
    const db = getDatabase();

    let dateFormat, groupByClause;
    switch (groupBy) {
      case 'week':
        dateFormat = "strftime('%Y-W%W', created_at)";
        groupByClause = dateFormat;
        break;
      case 'month':
        dateFormat = "strftime('%Y-%m', created_at)";
        groupByClause = dateFormat;
        break;
      default:
        dateFormat = "date(created_at)";
        groupByClause = dateFormat;
    }

    let whereClause = "WHERE payment_status = 'paid'";
    const params = [];

    if (startDate) {
      whereClause += ' AND date(created_at) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND date(created_at) <= ?';
      params.push(endDate);
    }

    const salesData = db.prepare(`
      SELECT
        ${dateFormat} as period,
        COUNT(*) as orders,
        SUM(grand_total) as revenue,
        SUM(subtotal) as subtotal,
        SUM(discount_total) as discounts,
        SUM(shipping_total) as shipping,
        SUM(tax_total) as tax,
        AVG(grand_total) as average_order_value
      FROM orders
      ${whereClause}
      GROUP BY ${groupByClause}
      ORDER BY period
    `).all(...params);

    const totals = db.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(grand_total) as total_revenue,
        SUM(discount_total) as total_discounts,
        AVG(grand_total) as average_order_value
      FROM orders
      ${whereClause}
    `).get(...params);

    res.json({
      success: true,
      data: {
        periods: salesData.map(d => ({
          period: d.period,
          orders: d.orders,
          revenue: d.revenue,
          subtotal: d.subtotal,
          discounts: d.discounts,
          shipping: d.shipping,
          tax: d.tax,
          averageOrderValue: d.average_order_value
        })),
        totals: {
          orders: totals.total_orders,
          revenue: totals.total_revenue,
          discounts: totals.total_discounts,
          averageOrderValue: totals.average_order_value
        }
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/reports/products
 * Product performance report
 */
router.get('/products', async (req, res, next) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const db = getDatabase();

    let whereClause = "WHERE o.payment_status = 'paid'";
    const params = [];

    if (startDate) {
      whereClause += ' AND date(o.created_at) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND date(o.created_at) <= ?';
      params.push(endDate);
    }

    const products = db.prepare(`
      SELECT
        p.id, p.sku, p.name, p.price, p.stock_quantity,
        c.name as category,
        COUNT(DISTINCT o.id) as order_count,
        SUM(oi.quantity) as units_sold,
        SUM(oi.total_price) as revenue,
        AVG(oi.unit_price) as average_price
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id ${whereClause.replace('WHERE', 'AND')}
      GROUP BY p.id
      ORDER BY revenue DESC NULLS LAST
      LIMIT ?
    `).all(...params, limit);

    res.json({
      success: true,
      data: products.map(p => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category,
        currentPrice: p.price,
        stockQuantity: p.stock_quantity,
        orderCount: p.order_count || 0,
        unitsSold: p.units_sold || 0,
        revenue: p.revenue || 0,
        averagePrice: p.average_price || p.price
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/reports/customers
 * Customer report
 */
router.get('/customers', async (req, res, next) => {
  try {
    const { startDate, endDate, limit = 50 } = req.query;
    const db = getDatabase();

    let whereClause = "WHERE o.payment_status = 'paid'";
    const params = [];

    if (startDate) {
      whereClause += ' AND date(o.created_at) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND date(o.created_at) <= ?';
      params.push(endDate);
    }

    const customers = db.prepare(`
      SELECT
        COALESCE(u.id, o.customer_email) as customer_id,
        COALESCE(u.email, o.customer_email) as email,
        COALESCE(u.first_name || ' ' || u.last_name, o.customer_first_name || ' ' || o.customer_last_name) as name,
        COUNT(o.id) as order_count,
        SUM(o.grand_total) as total_spent,
        AVG(o.grand_total) as average_order_value,
        MAX(o.created_at) as last_order_date,
        MIN(o.created_at) as first_order_date
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      ${whereClause}
      GROUP BY COALESCE(u.id, o.customer_email)
      ORDER BY total_spent DESC
      LIMIT ?
    `).all(...params, limit);

    res.json({
      success: true,
      data: customers.map(c => ({
        customerId: c.customer_id,
        email: c.email,
        name: c.name,
        orderCount: c.order_count,
        totalSpent: c.total_spent,
        averageOrderValue: c.average_order_value,
        firstOrderDate: c.first_order_date,
        lastOrderDate: c.last_order_date
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/reports/inventory
 * Inventory report
 */
router.get('/inventory', async (req, res, next) => {
  try {
    const { status, category } = req.query;
    const db = getDatabase();

    let whereConditions = ['p.is_active = 1', 'p.track_inventory = 1'];
    const params = [];

    if (status === 'low') {
      whereConditions.push('p.stock_quantity <= p.low_stock_threshold');
    } else if (status === 'out') {
      whereConditions.push('p.stock_quantity = 0');
    }

    if (category) {
      whereConditions.push('p.category_id = ?');
      params.push(category);
    }

    const products = db.prepare(`
      SELECT
        p.id, p.sku, p.name, p.price, p.cost_price,
        p.stock_quantity, p.low_stock_threshold,
        c.name as category,
        (p.stock_quantity * COALESCE(p.cost_price, p.price * 0.5)) as inventory_value
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY p.stock_quantity ASC
    `).all(...params);

    const totals = db.prepare(`
      SELECT
        SUM(stock_quantity) as total_units,
        SUM(stock_quantity * COALESCE(cost_price, price * 0.5)) as total_value,
        COUNT(CASE WHEN stock_quantity <= low_stock_threshold THEN 1 END) as low_stock_count,
        COUNT(CASE WHEN stock_quantity = 0 THEN 1 END) as out_of_stock_count
      FROM products
      WHERE is_active = 1 AND track_inventory = 1
    `).get();

    res.json({
      success: true,
      data: {
        products: products.map(p => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          category: p.category,
          price: p.price,
          costPrice: p.cost_price,
          stockQuantity: p.stock_quantity,
          lowStockThreshold: p.low_stock_threshold,
          inventoryValue: p.inventory_value,
          status: p.stock_quantity === 0 ? 'out_of_stock' : p.stock_quantity <= p.low_stock_threshold ? 'low_stock' : 'in_stock'
        })),
        summary: {
          totalUnits: totals.total_units,
          totalValue: totals.total_value,
          lowStockCount: totals.low_stock_count,
          outOfStockCount: totals.out_of_stock_count
        }
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/reports/categories
 * Category performance report
 */
router.get('/categories', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const db = getDatabase();

    let whereClause = "WHERE o.payment_status = 'paid'";
    const params = [];

    if (startDate) {
      whereClause += ' AND date(o.created_at) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ' AND date(o.created_at) <= ?';
      params.push(endDate);
    }

    const categories = db.prepare(`
      SELECT
        c.id, c.name,
        COUNT(DISTINCT p.id) as product_count,
        COUNT(DISTINCT o.id) as order_count,
        SUM(oi.quantity) as units_sold,
        SUM(oi.total_price) as revenue
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id
      LEFT JOIN order_items oi ON p.id = oi.product_id
      LEFT JOIN orders o ON oi.order_id = o.id ${whereClause.replace('WHERE', 'AND')}
      WHERE c.is_active = 1
      GROUP BY c.id
      ORDER BY revenue DESC NULLS LAST
    `).all(...params);

    res.json({
      success: true,
      data: categories.map(c => ({
        id: c.id,
        name: c.name,
        productCount: c.product_count,
        orderCount: c.order_count || 0,
        unitsSold: c.units_sold || 0,
        revenue: c.revenue || 0
      }))
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/reports/export/:type
 * Export report as CSV
 */
router.get('/export/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const { startDate, endDate } = req.query;
    const db = getDatabase();

    let data, filename, headers;

    switch (type) {
      case 'orders':
        data = db.prepare(`
          SELECT order_number, customer_email, customer_first_name, customer_last_name,
            subtotal, discount_total, shipping_total, tax_total, grand_total,
            status, payment_status, created_at
          FROM orders
          WHERE date(created_at) >= COALESCE(?, date('now', '-30 days'))
          AND date(created_at) <= COALESCE(?, date('now'))
          ORDER BY created_at DESC
        `).all(startDate, endDate);
        filename = 'orders-export.csv';
        headers = ['Order Number', 'Email', 'First Name', 'Last Name', 'Subtotal', 'Discount', 'Shipping', 'Tax', 'Total', 'Status', 'Payment Status', 'Date'];
        break;

      case 'products':
        data = db.prepare(`
          SELECT p.sku, p.name, c.name as category, p.price, p.stock_quantity, p.is_active
          FROM products p
          LEFT JOIN categories c ON p.category_id = c.id
          ORDER BY p.name
        `).all();
        filename = 'products-export.csv';
        headers = ['SKU', 'Name', 'Category', 'Price', 'Stock', 'Active'];
        break;

      case 'customers':
        data = db.prepare(`
          SELECT email, first_name, last_name, phone, role, status, created_at
          FROM users
          WHERE role = 'customer'
          ORDER BY created_at DESC
        `).all();
        filename = 'customers-export.csv';
        headers = ['Email', 'First Name', 'Last Name', 'Phone', 'Role', 'Status', 'Created'];
        break;

      default:
        throw new ValidationError('Invalid export type');
    }

    // Generate CSV
    const csvRows = [headers.join(',')];
    for (const row of data) {
      const values = Object.values(row).map(v => {
        if (v === null) return '';
        if (typeof v === 'string' && (v.includes(',') || v.includes('"'))) {
          return `"${v.replace(/"/g, '""')}"`;
        }
        return v;
      });
      csvRows.push(values.join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvRows.join('\n'));

  } catch (error) {
    next(error);
  }
});

export default router;
