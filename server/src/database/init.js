/**
 * Database Initialization Module
 * Handles database setup, schema creation, and migrations
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

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
 * Initialize the database
 */
export const initializeDatabase = async () => {
  try {
    // Ensure data directory exists
    const dataDir = path.dirname(config.database.path);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Create database connection
    db = new Database(config.database.path, {
      verbose: config.env === 'development' ? console.log : null
    });

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Enable WAL mode for better performance
    db.pragma('journal_mode = WAL');

    // Set busy timeout
    db.pragma('busy_timeout = 5000');

    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Split schema into individual statements and execute
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    const transaction = db.transaction(() => {
      for (const statement of statements) {
        try {
          db.exec(statement + ';');
        } catch (err) {
          // Ignore errors for CREATE INDEX IF NOT EXISTS on already existing indexes
          if (!err.message.includes('already exists')) {
            console.warn(`Warning executing statement: ${err.message}`);
          }
        }
      }
    });

    transaction();

    // Seed default data if tables are empty
    await seedDefaultData();

    console.log('Database initialized successfully');
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
  const db = getDatabase();

  // Check if we already have data
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count > 0) {
    console.log('Database already seeded, skipping...');
    return;
  }

  console.log('Seeding default data...');

  const { v4: uuidv4 } = await import('uuid');
  const bcrypt = await import('bcryptjs');

  // Create super admin user
  const adminId = uuidv4();
  const adminPasswordHash = await bcrypt.hash('admin123!@#', config.security.bcryptRounds);

  db.prepare(`
    INSERT INTO users (id, email, password_hash, first_name, last_name, role, status, email_verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(adminId, 'admin@homegrowncreations.com', adminPasswordHash, 'Admin', 'User', 'super_admin', 'active', 1);

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
    { name: 'Ice Cream', slug: 'ice-cream', description: 'Frozen treats', sortOrder: 11 }
  ];

  const categoryInsert = db.prepare(`
    INSERT INTO categories (id, name, slug, description, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  const categoryIds = {};
  for (const cat of categories) {
    const id = uuidv4();
    categoryIds[cat.slug] = id;
    categoryInsert.run(id, cat.name, cat.slug, cat.description, cat.sortOrder);
  }

  // Import products from constants
  const products = [
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
    { sku: 'ROSC-004', name: 'Rosin Double Chocolate', slug: 'rosin-double-chocolate', category: 'rosin-cookies', price: 15.00, mg: 75, description: 'Rosin-infused double chocolate' },
    { sku: 'ROSC-005', name: 'Rosin Oatmeal', slug: 'rosin-oatmeal', category: 'rosin-cookies', price: 15.00, mg: 75, description: 'Premium rosin oatmeal cookie' },
    { sku: 'ROSC-006', name: 'Rosin Sugar Cookie', slug: 'rosin-sugar-cookie', category: 'rosin-cookies', price: 15.00, mg: 75, description: 'Rosin-infused sugar cookie' },

    // Chocolates
    { sku: 'CHOC-001', name: 'Dark Chocolate Bar', slug: 'dark-chocolate-bar', category: 'chocolates', price: 15.00, mg: 100, description: '70% dark chocolate bar' },
    { sku: 'CHOC-002', name: 'Milk Chocolate Bar', slug: 'milk-chocolate-bar', category: 'chocolates', price: 15.00, mg: 100, description: 'Creamy milk chocolate bar' },
    { sku: 'CHOC-003', name: 'White Chocolate Bar', slug: 'white-chocolate-bar', category: 'chocolates', price: 15.00, mg: 100, description: 'Smooth white chocolate bar' },
    { sku: 'CHOC-004', name: 'Chocolate Truffles (6pc)', slug: 'chocolate-truffles-6pc', category: 'chocolates', price: 25.00, mg: 150, description: 'Assorted chocolate truffles' },
    { sku: 'CHOC-005', name: 'Peanut Butter Cups (4pc)', slug: 'peanut-butter-cups-4pc', category: 'chocolates', price: 18.00, mg: 100, description: 'Chocolate peanut butter cups' },
    { sku: 'CHOC-006', name: 'Chocolate Covered Pretzels', slug: 'chocolate-covered-pretzels', category: 'chocolates', price: 12.00, mg: 75, description: 'Salty sweet chocolate pretzels' },
    { sku: 'CHOC-007', name: 'Chocolate Covered Strawberries', slug: 'chocolate-covered-strawberries', category: 'chocolates', price: 20.00, mg: 100, description: 'Fresh strawberries dipped in chocolate' },
    { sku: 'CHOC-008', name: 'Mega Chocolate Bar', slug: 'mega-chocolate-bar', category: 'chocolates', price: 25.00, mg: 250, description: 'Extra large chocolate bar' },

    // Pastries
    { sku: 'PAST-001', name: 'Babka Bread', slug: 'babka-bread', category: 'pastries', price: 35.00, mg: 300, description: 'Traditional twisted babka', hasVariations: true, variations: ['Blueberry', 'Callebaut Chocolate', 'Apple Cinnamon'] },
    { sku: 'PAST-002', name: 'Giant 4in Muffin', slug: 'giant-4in-muffin', category: 'pastries', price: 15.00, mg: 100, description: 'Oversized gourmet muffin', hasVariations: true, variations: ['Blueberry', 'Chocolate Chip', 'Banana Nut'] },
    { sku: 'PAST-003', name: 'Doughnut Hash Holes', slug: 'doughnut-hash-holes', category: 'pastries', price: 12.00, mg: 100, description: 'Bite-sized doughnut holes', hasVariations: true, variations: ['Chocolate', 'Plain', 'Glazed'] },
    { sku: 'PAST-004', name: 'Cinnamon Roll', slug: 'cinnamon-roll', category: 'pastries', price: 10.00, mg: 75, description: 'Warm cinnamon roll with icing' },

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

  const productInsert = db.prepare(`
    INSERT INTO products (id, sku, name, slug, description, category_id, price, mg, unit, has_variations, is_active, stock_quantity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 100)
  `);

  const variationInsert = db.prepare(`
    INSERT INTO product_variations (id, product_id, name, sku, is_active, sort_order)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  for (const product of products) {
    const productId = uuidv4();
    productInsert.run(
      productId,
      product.sku,
      product.name,
      product.slug,
      product.description,
      categoryIds[product.category],
      product.price,
      product.mg,
      product.unit || null,
      product.hasVariations ? 1 : 0
    );

    // Add variations if any
    if (product.variations) {
      product.variations.forEach((variation, index) => {
        variationInsert.run(
          uuidv4(),
          productId,
          variation,
          `${product.sku}-${variation.toUpperCase().replace(/\s+/g, '-')}`,
          index
        );
      });
    }
  }

  // Create default shipping zone
  const zoneId = uuidv4();
  db.prepare(`
    INSERT INTO shipping_zones (id, name, countries, is_active)
    VALUES (?, ?, ?, 1)
  `).run(zoneId, 'United States', JSON.stringify(['US']));

  // Create default shipping method
  db.prepare(`
    INSERT INTO shipping_methods (id, zone_id, name, type, cost, free_shipping_threshold, estimated_days_min, estimated_days_max, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(uuidv4(), zoneId, 'Standard Shipping', 'flat_rate', 15.00, 100.00, 3, 7);

  // Create default tax rate
  db.prepare(`
    INSERT INTO tax_rates (id, country, state, rate, name, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(uuidv4(), 'US', '*', 8.25, 'Default Tax');

  // Create sample gift cards
  const giftCards = [
    { code: 'HGC-100-ABC', balance: 100.00 },
    { code: 'HGC-50-XYZ', balance: 50.00 },
    { code: 'HGC-25-TEST', balance: 25.00 }
  ];

  const giftCardInsert = db.prepare(`
    INSERT INTO gift_cards (id, code, initial_balance, current_balance, status)
    VALUES (?, ?, ?, ?, 'active')
  `);

  for (const gc of giftCards) {
    giftCardInsert.run(uuidv4(), gc.code, gc.balance, gc.balance);
  }

  // Insert default settings
  const settings = [
    { key: 'store_name', value: 'Home Grown Creations', category: 'general', isPublic: 1 },
    { key: 'store_email', value: 'info@homegrowncreations.com', category: 'general', isPublic: 1 },
    { key: 'store_phone', value: '+1 (234) 567-890', category: 'general', isPublic: 1 },
    { key: 'store_address', value: '123 Main Street, City, State 12345', category: 'general', isPublic: 1 },
    { key: 'currency', value: 'USD', category: 'general', isPublic: 1 },
    { key: 'tax_enabled', value: 'true', type: 'boolean', category: 'tax', isPublic: 0 },
    { key: 'default_tax_rate', value: '8.25', type: 'number', category: 'tax', isPublic: 0 },
    { key: 'flat_shipping_rate', value: '15.00', type: 'number', category: 'shipping', isPublic: 1 },
    { key: 'free_shipping_threshold', value: '100.00', type: 'number', category: 'shipping', isPublic: 1 },
    { key: 'age_verification_required', value: 'true', type: 'boolean', category: 'compliance', isPublic: 1 },
    { key: 'minimum_age', value: '21', type: 'number', category: 'compliance', isPublic: 1 }
  ];

  const settingsInsert = db.prepare(`
    INSERT INTO settings (id, key, value, type, category, is_public)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const setting of settings) {
    settingsInsert.run(
      uuidv4(),
      setting.key,
      setting.value,
      setting.type || 'string',
      setting.category,
      setting.isPublic
    );
  }

  // Create default email templates
  const emailTemplates = [
    {
      name: 'order_confirmation',
      subject: 'Order Confirmation - {{order_number}}',
      htmlBody: `
        <h1>Thank you for your order!</h1>
        <p>Hi {{customer_name}},</p>
        <p>We've received your order #{{order_number}} and are preparing it for shipment.</p>
        <h2>Order Details</h2>
        {{order_items}}
        <p><strong>Subtotal:</strong> ${{subtotal}}</p>
        <p><strong>Shipping:</strong> ${{shipping}}</p>
        <p><strong>Tax:</strong> ${{tax}}</p>
        <p><strong>Total:</strong> ${{total}}</p>
        <p>We'll send you another email when your order ships.</p>
        <p>Thanks,<br>Home Grown Creations Team</p>
      `,
      variables: JSON.stringify(['order_number', 'customer_name', 'order_items', 'subtotal', 'shipping', 'tax', 'total'])
    },
    {
      name: 'order_shipped',
      subject: 'Your Order Has Shipped - {{order_number}}',
      htmlBody: `
        <h1>Your order is on its way!</h1>
        <p>Hi {{customer_name}},</p>
        <p>Great news! Your order #{{order_number}} has been shipped.</p>
        <p><strong>Tracking Number:</strong> {{tracking_number}}</p>
        <p><strong>Carrier:</strong> {{carrier}}</p>
        <p>Thanks for shopping with us!</p>
        <p>Home Grown Creations Team</p>
      `,
      variables: JSON.stringify(['order_number', 'customer_name', 'tracking_number', 'carrier'])
    },
    {
      name: 'password_reset',
      subject: 'Password Reset Request',
      htmlBody: `
        <h1>Password Reset</h1>
        <p>Hi {{customer_name}},</p>
        <p>We received a request to reset your password. Click the link below to set a new password:</p>
        <p><a href="{{reset_link}}">Reset Password</a></p>
        <p>This link will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
        <p>Home Grown Creations Team</p>
      `,
      variables: JSON.stringify(['customer_name', 'reset_link'])
    },
    {
      name: 'welcome',
      subject: 'Welcome to Home Grown Creations!',
      htmlBody: `
        <h1>Welcome, {{customer_name}}!</h1>
        <p>Thanks for creating an account with Home Grown Creations.</p>
        <p>You now have access to:</p>
        <ul>
          <li>Order tracking and history</li>
          <li>Saved addresses for faster checkout</li>
          <li>Wishlist to save your favorites</li>
          <li>Exclusive member offers</li>
        </ul>
        <p>Start shopping now!</p>
        <p>Home Grown Creations Team</p>
      `,
      variables: JSON.stringify(['customer_name'])
    }
  ];

  const templateInsert = db.prepare(`
    INSERT INTO email_templates (id, name, subject, html_body, variables, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `);

  for (const template of emailTemplates) {
    templateInsert.run(uuidv4(), template.name, template.subject, template.htmlBody, template.variables);
  }

  console.log('Default data seeded successfully');
};

/**
 * Close database connection
 */
export const closeDatabase = () => {
  if (db) {
    db.close();
    db = null;
  }
};

export default {
  initializeDatabase,
  getDatabase,
  closeDatabase
};
