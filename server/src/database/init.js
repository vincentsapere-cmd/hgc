/**
 * Database Initialization Module
 * Supports MySQL (production) and SQLite (development)
 */

import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;
let dbType = config.database.type;

/**
 * Database wrapper for consistent API across MySQL and SQLite
 */
class DatabaseWrapper {
  constructor(connection, type) {
    this.connection = connection;
    this.type = type;
  }

  /**
   * Prepare and run a query - returns the result for SELECT, or run info for INSERT/UPDATE/DELETE
   */
  prepare(sql) {
    const self = this;
    return {
      get: async (...params) => {
        if (self.type === 'sqlite') {
          return self.connection.prepare(sql).get(...params);
        }
        const [rows] = await self.connection.execute(self.convertPlaceholders(sql), params);
        return rows[0] || null;
      },
      all: async (...params) => {
        if (self.type === 'sqlite') {
          return self.connection.prepare(sql).all(...params);
        }
        const [rows] = await self.connection.execute(self.convertPlaceholders(sql), params);
        return rows;
      },
      run: async (...params) => {
        if (self.type === 'sqlite') {
          return self.connection.prepare(sql).run(...params);
        }
        const [result] = await self.connection.execute(self.convertPlaceholders(sql), params);
        return { changes: result.affectedRows, lastInsertRowid: result.insertId };
      }
    };
  }

  /**
   * Convert SQLite ? placeholders - MySQL uses ? too so this is mostly for compatibility
   */
  convertPlaceholders(sql) {
    // Replace datetime('now') with NOW() for MySQL
    if (this.type === 'mysql') {
      sql = sql.replace(/datetime\('now'\)/gi, 'NOW()');
      sql = sql.replace(/datetime\('now', '([^']+)'\)/gi, (match, interval) => {
        // Convert SQLite interval to MySQL
        if (interval.startsWith('-')) {
          return `DATE_SUB(NOW(), INTERVAL ${interval.slice(1).replace(' days', ' DAY').replace(' hours', ' HOUR')})`;
        }
        return `DATE_ADD(NOW(), INTERVAL ${interval.replace(' days', ' DAY').replace(' hours', ' HOUR')})`;
      });
      sql = sql.replace(/date\('now'\)/gi, 'CURDATE()');
      sql = sql.replace(/date\('now', '([^']+)'\)/gi, (match, interval) => {
        if (interval.startsWith('-')) {
          return `DATE_SUB(CURDATE(), INTERVAL ${interval.slice(1).replace(' days', ' DAY')})`;
        }
        return `DATE_ADD(CURDATE(), INTERVAL ${interval.replace(' days', ' DAY')})`;
      });
    }
    return sql;
  }

  /**
   * Execute raw SQL
   */
  async exec(sql) {
    if (this.type === 'sqlite') {
      return this.connection.exec(sql);
    }
    // Split by semicolon and execute each statement
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        await this.connection.execute(stmt);
      }
    }
  }

  /**
   * Transaction support
   */
  transaction(fn) {
    if (this.type === 'sqlite') {
      return this.connection.transaction(fn);
    }
    // For MySQL, we return an async function
    return async () => {
      await this.connection.beginTransaction();
      try {
        await fn();
        await this.connection.commit();
      } catch (error) {
        await this.connection.rollback();
        throw error;
      }
    };
  }

  /**
   * Close the connection
   */
  async close() {
    if (this.type === 'sqlite') {
      this.connection.close();
    } else {
      await this.connection.end();
    }
  }
}

/**
 * Get database instance (singleton)
 */
export const getDatabase = () => {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
};

/**
 * Get raw database connection for special operations
 */
export const getRawConnection = () => {
  if (!db) {
    throw new Error('Database not initialized.');
  }
  return db.connection;
};

/**
 * Initialize the database
 */
export const initializeDatabase = async () => {
  try {
    if (dbType === 'mysql') {
      // Create MySQL connection pool
      const pool = mysql.createPool({
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password,
        database: config.database.name,
        waitForConnections: true,
        connectionLimit: config.database.connectionLimit,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0
      });

      // Test connection
      const connection = await pool.getConnection();
      console.log('MySQL connection established');
      connection.release();

      db = new DatabaseWrapper(pool, 'mysql');

      // Read and execute MySQL schema
      const schemaPath = path.join(__dirname, 'schema.mysql.sql');
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        const statements = schema
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        for (const statement of statements) {
          try {
            await pool.execute(statement);
          } catch (err) {
            // Ignore "table already exists" errors
            if (!err.message.includes('already exists') && !err.message.includes('Duplicate')) {
              console.warn(`Warning executing statement: ${err.message}`);
            }
          }
        }
      }
    } else {
      // SQLite fallback
      const dataDir = path.dirname(config.database.path);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const sqliteDb = new Database(config.database.path, {
        verbose: config.env === 'development' ? console.log : null
      });

      sqliteDb.pragma('foreign_keys = ON');
      sqliteDb.pragma('journal_mode = WAL');
      sqliteDb.pragma('busy_timeout = 5000');

      db = new DatabaseWrapper(sqliteDb, 'sqlite');

      // Read and execute SQLite schema
      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        const statements = schema
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));

        const transaction = sqliteDb.transaction(() => {
          for (const statement of statements) {
            try {
              sqliteDb.exec(statement + ';');
            } catch (err) {
              if (!err.message.includes('already exists')) {
                console.warn(`Warning: ${err.message}`);
              }
            }
          }
        });
        transaction();
      }
    }

    // Seed default data
    await seedDefaultData();

    console.log(`Database initialized successfully (${dbType})`);
    return db;

  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
};

/**
 * Seed default data into the database
 */
const seedDefaultData = async () => {
  const { v4: uuidv4 } = await import('uuid');
  const bcrypt = await import('bcryptjs');

  // Check if we already have data
  const userCount = await db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount && userCount.count > 0) {
    console.log('Database already seeded, skipping...');
    return;
  }

  console.log('Seeding default data...');

  // Create super admin user (with must_change_password flag)
  const adminId = uuidv4();
  const adminPasswordHash = await bcrypt.hash('Admin123!@#', config.security.bcryptRounds);

  await db.prepare(`
    INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, email_verified, must_change_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(adminId, 'admin@homegrowncreations.com', adminPasswordHash, 'Admin', 'User', 'super_admin', 'active', true, true);

  // Create categories
  const categories = [
    { name: 'Cookies', slug: 'cookies', description: 'Delicious homemade cookies', sortOrder: 1 },
    { name: 'Rosin Cookies', slug: 'rosin-cookies', description: 'Premium rosin-infused cookies', sortOrder: 2 },
    { name: 'Chocolates', slug: 'chocolates', description: 'Artisan chocolate creations', sortOrder: 3 },
    { name: 'Pastries', slug: 'pastries', description: 'Fresh baked pastries', sortOrder: 4 },
    { name: 'Beverages', slug: 'beverages', description: 'Refreshing infused drinks', sortOrder: 5 },
    { name: 'Syrups', slug: 'syrups', description: 'Versatile infused syrups', sortOrder: 6 },
    { name: 'Candy', slug: 'candy', description: 'Sweet infused candies', sortOrder: 7 },
    { name: 'Snacks', slug: 'snacks', description: 'Savory and sweet snacks', sortOrder: 8 },
    { name: 'Infusions', slug: 'infusions', description: 'Pure infusion products', sortOrder: 9 },
    { name: 'Topicals', slug: 'topicals', description: 'Topical applications', sortOrder: 10 },
    { name: 'Ice Cream', slug: 'ice-cream', description: 'Frozen treats', sortOrder: 11 },
    { name: 'Gift Cards', slug: 'gift-cards', description: 'Perfect for any occasion', sortOrder: 12 }
  ];

  const categoryIds = {};
  for (const cat of categories) {
    const id = uuidv4();
    categoryIds[cat.slug] = id;
    await db.prepare(`
      INSERT INTO categories (id, name, slug, description, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, cat.name, cat.slug, cat.description, cat.sortOrder, true);
  }

  // Products including gift cards
  const products = [
    // Gift Cards
    { sku: 'GC-025', name: 'Gift Card - $25', slug: 'gift-card-25', category: 'gift-cards', price: 25.00, mg: 0, description: 'Give the gift of choice! Perfect for any occasion.', isGiftCard: true, trackInventory: false, requiresShipping: false, isTaxable: false },
    { sku: 'GC-050', name: 'Gift Card - $50', slug: 'gift-card-50', category: 'gift-cards', price: 50.00, mg: 0, description: 'Give the gift of choice! Perfect for any occasion.', isGiftCard: true, trackInventory: false, requiresShipping: false, isTaxable: false },
    { sku: 'GC-100', name: 'Gift Card - $100', slug: 'gift-card-100', category: 'gift-cards', price: 100.00, mg: 0, description: 'Give the gift of choice! Perfect for any occasion.', isGiftCard: true, trackInventory: false, requiresShipping: false, isTaxable: false },
    { sku: 'GC-250', name: 'Gift Card - $250', slug: 'gift-card-250', category: 'gift-cards', price: 250.00, mg: 0, description: 'Give the gift of choice! Perfect for any occasion.', isGiftCard: true, trackInventory: false, requiresShipping: false, isTaxable: false },

    // Cookies
    { sku: 'COOK-001', name: 'Chocolate Chip Cookie', slug: 'chocolate-chip-cookie', category: 'cookies', price: 8.50, mg: 50, description: 'Classic chocolate chip cookie with premium chocolate' },
    { sku: 'COOK-002', name: 'Double Chocolate Chunk', slug: 'double-chocolate-chunk', category: 'cookies', price: 10.00, mg: 75, description: 'Rich double chocolate cookie with chunks' },
    { sku: 'COOK-003', name: 'Peanut Butter Cookie', slug: 'peanut-butter-cookie', category: 'cookies', price: 8.50, mg: 50, description: 'Creamy peanut butter cookie' },
    { sku: 'COOK-004', name: 'Snickerdoodle', slug: 'snickerdoodle', category: 'cookies', price: 8.50, mg: 50, description: 'Cinnamon sugar coated classic' },
    { sku: 'COOK-005', name: 'Oatmeal Raisin', slug: 'oatmeal-raisin', category: 'cookies', price: 8.50, mg: 50, description: 'Hearty oatmeal with plump raisins' },
    { sku: 'COOK-006', name: 'Sugar Cookie', slug: 'sugar-cookie', category: 'cookies', price: 8.50, mg: 50, description: 'Classic soft sugar cookie' },
    { sku: 'COOK-007', name: 'White Chocolate Macadamia', slug: 'white-chocolate-macadamia', category: 'cookies', price: 12.00, mg: 75, description: 'Premium white chocolate with macadamia nuts' },

    // Rosin Cookies
    { sku: 'ROSC-001', name: 'Rosin Chocolate Chip', slug: 'rosin-chocolate-chip', category: 'rosin-cookies', price: 15.00, mg: 75, description: 'Premium rosin-infused chocolate chip' },
    { sku: 'ROSC-002', name: 'Rosin Peanut Butter', slug: 'rosin-peanut-butter', category: 'rosin-cookies', price: 15.00, mg: 75, description: 'Rosin-infused peanut butter cookie' },
    { sku: 'ROSC-003', name: 'Rosin Snickerdoodle', slug: 'rosin-snickerdoodle', category: 'rosin-cookies', price: 15.00, mg: 75, description: 'Premium rosin snickerdoodle' },

    // Chocolates
    { sku: 'CHOC-001', name: 'Dark Chocolate Bar', slug: 'dark-chocolate-bar', category: 'chocolates', price: 15.00, mg: 100, description: '70% dark chocolate bar' },
    { sku: 'CHOC-002', name: 'Milk Chocolate Bar', slug: 'milk-chocolate-bar', category: 'chocolates', price: 15.00, mg: 100, description: 'Creamy milk chocolate bar' },
    { sku: 'CHOC-003', name: 'White Chocolate Bar', slug: 'white-chocolate-bar', category: 'chocolates', price: 15.00, mg: 100, description: 'Smooth white chocolate bar' },
    { sku: 'CHOC-004', name: 'Chocolate Truffles (6pc)', slug: 'chocolate-truffles-6pc', category: 'chocolates', price: 25.00, mg: 150, description: 'Assorted chocolate truffles' },
    { sku: 'CHOC-005', name: 'Peanut Butter Cups (4pc)', slug: 'peanut-butter-cups-4pc', category: 'chocolates', price: 18.00, mg: 100, description: 'Chocolate peanut butter cups' },

    // Pastries
    { sku: 'PAST-001', name: 'Babka Bread', slug: 'babka-bread', category: 'pastries', price: 35.00, mg: 300, description: 'Traditional twisted babka', hasVariations: true, variations: ['Blueberry', 'Callebaut Chocolate', 'Apple Cinnamon'] },
    { sku: 'PAST-002', name: 'Giant 4in Muffin', slug: 'giant-4in-muffin', category: 'pastries', price: 15.00, mg: 100, description: 'Oversized gourmet muffin', hasVariations: true, variations: ['Blueberry', 'Chocolate Chip', 'Banana Nut'] },
    { sku: 'PAST-003', name: 'Cinnamon Roll', slug: 'cinnamon-roll', category: 'pastries', price: 10.00, mg: 75, description: 'Warm cinnamon roll with icing' },

    // Beverages
    { sku: 'BEV-001', name: 'Infused Lemonade', slug: 'infused-lemonade', category: 'beverages', price: 8.00, mg: 25, description: 'Refreshing infused lemonade' },
    { sku: 'BEV-002', name: 'Infused Iced Tea', slug: 'infused-iced-tea', category: 'beverages', price: 8.00, mg: 25, description: 'Classic infused iced tea' },
    { sku: 'BEV-003', name: 'Infused Coffee (Cold Brew)', slug: 'infused-cold-brew', category: 'beverages', price: 10.00, mg: 50, description: 'Smooth infused cold brew coffee' },

    // Syrups
    { sku: 'SYR-001', name: 'Simple Syrup', slug: 'simple-syrup', category: 'syrups', price: 20.00, mg: 500, unit: '8oz', description: 'Versatile infused simple syrup' },
    { sku: 'SYR-002', name: 'Maple Syrup', slug: 'maple-syrup', category: 'syrups', price: 25.00, mg: 500, unit: '8oz', description: 'Pure infused maple syrup' },

    // Candy
    { sku: 'CAND-001', name: 'Gummy Bears (10pc)', slug: 'gummy-bears-10pc', category: 'candy', price: 15.00, mg: 100, description: 'Assorted fruit gummy bears' },
    { sku: 'CAND-002', name: 'Small Lozenge Candies', slug: 'small-lozenge-candies', category: 'candy', price: 12.00, mg: 50, description: 'Hard candy lozenges', hasVariations: true, variations: ['Strawberry', 'Blueberry', 'Cherry'] },
    { sku: 'CAND-003', name: 'Caramels (8pc)', slug: 'caramels-8pc', category: 'candy', price: 18.00, mg: 80, description: 'Soft buttery caramels' },

    // Snacks
    { sku: 'SNCK-001', name: 'Trail Mix', slug: 'trail-mix', category: 'snacks', price: 15.00, mg: 100, unit: '4oz', description: 'Premium nut and fruit trail mix' },
    { sku: 'SNCK-002', name: 'Granola Bites', slug: 'granola-bites', category: 'snacks', price: 12.00, mg: 75, description: 'Crunchy granola bites' },

    // Infusions
    { sku: 'INF-001', name: 'Infused Coconut Oil', slug: 'infused-coconut-oil', category: 'infusions', price: 40.00, mg: 500, unit: '4oz', description: 'Versatile infused coconut oil' },
    { sku: 'INF-002', name: 'Infused Butter', slug: 'infused-butter', category: 'infusions', price: 35.00, mg: 500, unit: '4oz', description: 'Premium infused butter' },

    // Topicals
    { sku: 'TOP-001', name: 'Relief Balm', slug: 'relief-balm', category: 'topicals', price: 45.00, mg: 500, unit: '2oz', description: 'Soothing topical relief balm' },

    // Ice Cream
    { sku: 'ICE-001', name: 'Vanilla Ice Cream', slug: 'vanilla-ice-cream', category: 'ice-cream', price: 18.00, mg: 100, unit: 'pint', description: 'Creamy vanilla ice cream' }
  ];

  for (const product of products) {
    const productId = uuidv4();
    await db.prepare(`
      INSERT INTO products (id, sku, name, slug, description, category_id, price, mg, unit, has_variations, is_active, is_gift_card, track_inventory, requires_shipping, is_taxable, stock_quantity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      productId,
      product.sku,
      product.name,
      product.slug,
      product.description,
      categoryIds[product.category],
      product.price,
      product.mg,
      product.unit || null,
      product.hasVariations ? true : false,
      true,
      product.isGiftCard ? true : false,
      product.trackInventory !== false,
      product.requiresShipping !== false,
      product.isTaxable !== false,
      product.isGiftCard ? 0 : 100
    );

    // Add variations if any
    if (product.variations) {
      for (let i = 0; i < product.variations.length; i++) {
        const variation = product.variations[i];
        await db.prepare(`
          INSERT INTO product_variations (id, product_id, name, sku, is_active, sort_order)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          uuidv4(),
          productId,
          variation,
          `${product.sku}-${variation.toUpperCase().replace(/\s+/g, '-')}`,
          true,
          i
        );
      }
    }
  }

  // Create default shipping zone and method
  const zoneId = uuidv4();
  await db.prepare(`
    INSERT INTO shipping_zones (id, name, countries, is_active)
    VALUES (?, ?, ?, ?)
  `).run(zoneId, 'United States', JSON.stringify(['US']), true);

  await db.prepare(`
    INSERT INTO shipping_methods (id, zone_id, name, type, cost, free_shipping_threshold, estimated_days_min, estimated_days_max, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), zoneId, 'Standard Shipping', 'flat_rate', 15.00, 100.00, 3, 7, true);

  // Create default tax rate
  await db.prepare(`
    INSERT INTO tax_rates (id, country, state, rate, name, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), 'US', '*', 8.25, 'Default Tax', true);

  // Create sample coupons
  const coupons = [
    { code: 'WELCOME10', type: 'percentage', value: 10, description: '10% off your first order', minimumOrderAmount: 25 },
    { code: 'SAVE20', type: 'fixed_amount', value: 20, description: '$20 off orders over $100', minimumOrderAmount: 100 },
    { code: 'FREESHIP', type: 'free_shipping', value: 0, description: 'Free shipping on any order', minimumOrderAmount: 0 }
  ];

  for (const coupon of coupons) {
    await db.prepare(`
      INSERT INTO coupons (id, code, type, value, description, minimum_order_amount, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), coupon.code, coupon.type, coupon.value, coupon.description, coupon.minimumOrderAmount, true, adminId);
  }

  // Insert default settings
  const settings = [
    { key: 'store_name', value: 'Home Grown Creations', category: 'general', isPublic: true },
    { key: 'store_email', value: 'info@homegrowncreations.com', category: 'general', isPublic: true },
    { key: 'store_phone', value: '+1 (234) 567-890', category: 'general', isPublic: true },
    { key: 'store_address', value: '123 Main Street, City, State 12345', category: 'general', isPublic: true },
    { key: 'currency', value: 'USD', category: 'general', isPublic: true },
    { key: 'tax_enabled', value: 'true', type: 'boolean', category: 'tax', isPublic: false },
    { key: 'default_tax_rate', value: '8.25', type: 'number', category: 'tax', isPublic: false },
    { key: 'flat_shipping_rate', value: '15.00', type: 'number', category: 'shipping', isPublic: true },
    { key: 'free_shipping_threshold', value: '100.00', type: 'number', category: 'shipping', isPublic: true },
    { key: 'age_verification_required', value: 'true', type: 'boolean', category: 'compliance', isPublic: true },
    { key: 'minimum_age', value: '21', type: 'number', category: 'compliance', isPublic: true },
    { key: 'paypal_mode', value: 'sandbox', category: 'payment', isPublic: false },
    { key: 'order_prefix', value: 'HGC', category: 'orders', isPublic: false },
    { key: 'low_stock_threshold', value: '5', type: 'number', category: 'inventory', isPublic: false }
  ];

  for (const setting of settings) {
    await db.prepare(`
      INSERT INTO settings (id, setting_key, setting_value, setting_type, category, is_public)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      setting.key,
      setting.value,
      setting.type || 'string',
      setting.category,
      setting.isPublic
    );
  }

  // Create email templates
  const emailTemplates = [
    {
      name: 'order_confirmation',
      subject: 'Order Confirmation - {{order_number}}',
      htmlBody: `<h1>Thank you for your order!</h1><p>Hi {{customer_name}},</p><p>We've received your order #{{order_number}} and are preparing it for shipment.</p><h2>Order Details</h2>{{order_items}}<p><strong>Subtotal:</strong> ${{subtotal}}</p><p><strong>Shipping:</strong> ${{shipping}}</p><p><strong>Tax:</strong> ${{tax}}</p><p><strong>Total:</strong> ${{total}}</p><p>We'll send you another email when your order ships.</p><p>Thanks,<br>Home Grown Creations Team</p>`
    },
    {
      name: 'order_shipped',
      subject: 'Your Order Has Shipped - {{order_number}}',
      htmlBody: `<h1>Your order is on its way!</h1><p>Hi {{customer_name}},</p><p>Great news! Your order #{{order_number}} has been shipped.</p><p><strong>Tracking Number:</strong> {{tracking_number}}</p><p><strong>Carrier:</strong> {{carrier}}</p><p>Thanks for shopping with us!</p><p>Home Grown Creations Team</p>`
    },
    {
      name: 'password_reset',
      subject: 'Password Reset Request',
      htmlBody: `<h1>Password Reset</h1><p>Hi {{customer_name}},</p><p>We received a request to reset your password. Click the link below:</p><p><a href="{{reset_link}}">Reset Password</a></p><p>This link expires in 1 hour.</p><p>Home Grown Creations Team</p>`
    },
    {
      name: 'welcome',
      subject: 'Welcome to Home Grown Creations!',
      htmlBody: `<h1>Welcome, {{customer_name}}!</h1><p>Thanks for creating an account with Home Grown Creations.</p><p>Start shopping now!</p><p>Home Grown Creations Team</p>`
    },
    {
      name: 'gift_card_received',
      subject: "You've Received a Gift Card!",
      htmlBody: `<div style="text-align:center;padding:40px;"><h1 style="color:#4A7043;">🎁 You've Received a Gift Card!</h1>{{#recipient_name}}<p>Dear {{recipient_name}},</p>{{/recipient_name}}<p>Someone special sent you a Home Grown Creations gift card!</p>{{#personal_message}}<p style="font-style:italic;padding:20px;background:#f5f5f5;border-radius:8px;">"{{personal_message}}"</p>{{/personal_message}}<div style="background:linear-gradient(135deg,#4A7043,#7FB069);color:white;padding:30px;border-radius:12px;margin:20px 0;"><p style="font-size:14px;margin:0;">Gift Card Value</p><p style="font-size:48px;font-weight:bold;margin:10px 0;">${{amount}}</p><p style="font-size:18px;letter-spacing:2px;margin:0;">{{code}}</p></div><p>Use this code at checkout to redeem your gift card.</p></div>`
    }
  ];

  for (const template of emailTemplates) {
    await db.prepare(`
      INSERT INTO email_templates (id, name, subject, html_body, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), template.name, template.subject, template.htmlBody, true);
  }

  console.log('Default data seeded successfully');
};

/**
 * Close database connection
 */
export const closeDatabase = async () => {
  if (db) {
    await db.close();
    db = null;
  }
};

/**
 * Get database type
 */
export const getDatabaseType = () => dbType;

export default {
  initializeDatabase,
  getDatabase,
  getRawConnection,
  closeDatabase,
  getDatabaseType
};
