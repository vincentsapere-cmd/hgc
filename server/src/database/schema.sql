-- =============================================================================
-- HOME GROWN CREATIONS - ENTERPRISE E-COMMERCE DATABASE SCHEMA
-- =============================================================================
-- This schema supports SQLite (default) and is compatible with PostgreSQL
-- =============================================================================

-- =============================================================================
-- USER MANAGEMENT
-- =============================================================================

-- Users table (customers and admins)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'super_admin', 'manager')),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending_verification', 'deleted')),
    email_verified INTEGER DEFAULT 0,
    email_verification_token TEXT,
    email_verification_expires TEXT,
    password_reset_token TEXT,
    password_reset_expires TEXT,
    two_factor_enabled INTEGER DEFAULT 0,
    two_factor_secret TEXT,
    last_login TEXT,
    login_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- User addresses
CREATE TABLE IF NOT EXISTS user_addresses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT DEFAULT 'Home',
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    street_address TEXT NOT NULL,
    street_address_2 TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    country TEXT DEFAULT 'US',
    phone TEXT,
    is_default INTEGER DEFAULT 0,
    is_billing INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- User sessions (for JWT refresh tokens)
CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash TEXT NOT NULL,
    device_info TEXT,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    last_used TEXT DEFAULT (datetime('now'))
);

-- Password history (prevent password reuse)
CREATE TABLE IF NOT EXISTS password_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_password_history_user ON password_history(user_id);

-- =============================================================================
-- PRODUCT MANAGEMENT
-- =============================================================================

-- Product categories
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    image_url TEXT,
    parent_id TEXT REFERENCES categories(id),
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Products
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    short_description TEXT,
    category_id TEXT REFERENCES categories(id),
    price REAL NOT NULL CHECK (price >= 0),
    compare_at_price REAL,
    cost_price REAL,
    mg INTEGER DEFAULT 0,
    unit TEXT,
    weight REAL,
    weight_unit TEXT DEFAULT 'oz',
    image_url TEXT,
    images TEXT, -- JSON array of additional images
    has_variations INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    is_featured INTEGER DEFAULT 0,
    is_taxable INTEGER DEFAULT 1,
    requires_shipping INTEGER DEFAULT 1,
    stock_quantity INTEGER DEFAULT 0,
    low_stock_threshold INTEGER DEFAULT 5,
    track_inventory INTEGER DEFAULT 1,
    allow_backorder INTEGER DEFAULT 0,
    meta_title TEXT,
    meta_description TEXT,
    tags TEXT, -- JSON array of tags
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Product variations (flavors, sizes, etc.)
CREATE TABLE IF NOT EXISTS product_variations (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT UNIQUE NOT NULL,
    price_modifier REAL DEFAULT 0,
    stock_quantity INTEGER DEFAULT 0,
    image_url TEXT,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Product reviews
CREATE TABLE IF NOT EXISTS product_reviews (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id TEXT REFERENCES orders(id),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    title TEXT,
    content TEXT,
    is_verified_purchase INTEGER DEFAULT 0,
    is_approved INTEGER DEFAULT 0,
    helpful_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(product_id, user_id)
);

-- =============================================================================
-- INVENTORY MANAGEMENT
-- =============================================================================

-- Inventory transactions (audit trail)
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    variation_id TEXT REFERENCES product_variations(id),
    type TEXT NOT NULL CHECK (type IN ('purchase', 'sale', 'adjustment', 'return', 'damage', 'transfer')),
    quantity INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    reference_type TEXT, -- 'order', 'manual', 'import'
    reference_id TEXT,
    notes TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- ORDER MANAGEMENT
-- =============================================================================

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    user_id TEXT REFERENCES users(id),
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending', 'confirmed', 'processing', 'shipped', 'delivered',
        'cancelled', 'refunded', 'on_hold', 'failed'
    )),
    payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN (
        'pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed', 'cancelled'
    )),
    fulfillment_status TEXT DEFAULT 'unfulfilled' CHECK (fulfillment_status IN (
        'unfulfilled', 'partially_fulfilled', 'fulfilled', 'returned'
    )),

    -- Customer info (denormalized for order history)
    customer_email TEXT NOT NULL,
    customer_first_name TEXT NOT NULL,
    customer_last_name TEXT NOT NULL,
    customer_phone TEXT,

    -- Shipping address
    shipping_address_line1 TEXT NOT NULL,
    shipping_address_line2 TEXT,
    shipping_city TEXT NOT NULL,
    shipping_state TEXT NOT NULL,
    shipping_zip TEXT NOT NULL,
    shipping_country TEXT DEFAULT 'US',

    -- Billing address
    billing_address_line1 TEXT,
    billing_address_line2 TEXT,
    billing_city TEXT,
    billing_state TEXT,
    billing_zip TEXT,
    billing_country TEXT DEFAULT 'US',
    billing_same_as_shipping INTEGER DEFAULT 1,

    -- Totals
    subtotal REAL NOT NULL,
    discount_total REAL DEFAULT 0,
    shipping_total REAL DEFAULT 0,
    tax_total REAL DEFAULT 0,
    grand_total REAL NOT NULL,

    -- Shipping
    shipping_method TEXT,
    shipping_carrier TEXT,
    tracking_number TEXT,
    shipped_at TEXT,
    delivered_at TEXT,

    -- Payment
    payment_method TEXT,
    payment_provider TEXT,
    payment_transaction_id TEXT,
    payment_payer_id TEXT,
    paid_at TEXT,

    -- Discounts
    coupon_code TEXT,
    gift_card_code TEXT,
    gift_card_amount REAL DEFAULT 0,

    -- Notes
    customer_notes TEXT,
    admin_notes TEXT,
    internal_notes TEXT,

    -- Metadata
    ip_address TEXT,
    user_agent TEXT,
    source TEXT DEFAULT 'web', -- web, mobile, admin

    -- Timestamps
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    cancelled_at TEXT,
    cancelled_reason TEXT
);

-- Order items
CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    variation_id TEXT REFERENCES product_variations(id),
    sku TEXT NOT NULL,
    name TEXT NOT NULL,
    variation_name TEXT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    tax_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    image_url TEXT,
    mg INTEGER,
    unit TEXT,
    fulfilled_quantity INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Order status history
CREATE TABLE IF NOT EXISTS order_status_history (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by TEXT REFERENCES users(id),
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- SHOPPING CART
-- =============================================================================

-- Shopping carts (for guest and logged-in users)
CREATE TABLE IF NOT EXISTS carts (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'converted', 'abandoned')),
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Cart items
CREATE TABLE IF NOT EXISTS cart_items (
    id TEXT PRIMARY KEY,
    cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id),
    variation_id TEXT REFERENCES product_variations(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(cart_id, product_id, variation_id)
);

-- =============================================================================
-- WISHLIST
-- =============================================================================

CREATE TABLE IF NOT EXISTS wishlists (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, product_id)
);

-- =============================================================================
-- PAYMENT & TRANSACTIONS
-- =============================================================================

-- Payment transactions
CREATE TABLE IF NOT EXISTS payment_transactions (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    provider TEXT NOT NULL, -- 'paypal', 'stripe', 'gift_card'
    type TEXT NOT NULL CHECK (type IN ('authorization', 'capture', 'refund', 'void')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    provider_transaction_id TEXT,
    provider_payer_id TEXT,
    provider_response TEXT, -- JSON response from provider
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- DISCOUNTS & PROMOTIONS
-- =============================================================================

-- Coupons
CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed_amount', 'free_shipping', 'buy_x_get_y')),
    value REAL NOT NULL,
    minimum_order_amount REAL DEFAULT 0,
    maximum_discount REAL,
    usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    per_user_limit INTEGER DEFAULT 1,
    applicable_products TEXT, -- JSON array of product IDs or 'all'
    applicable_categories TEXT, -- JSON array of category IDs or 'all'
    excluded_products TEXT, -- JSON array of excluded product IDs
    starts_at TEXT,
    expires_at TEXT,
    is_active INTEGER DEFAULT 1,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Coupon usage tracking
CREATE TABLE IF NOT EXISTS coupon_usages (
    id TEXT PRIMARY KEY,
    coupon_id TEXT NOT NULL REFERENCES coupons(id),
    user_id TEXT REFERENCES users(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    discount_amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Gift cards
CREATE TABLE IF NOT EXISTS gift_cards (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    initial_balance REAL NOT NULL,
    current_balance REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'disabled', 'expired')),
    purchaser_email TEXT,
    recipient_email TEXT,
    recipient_name TEXT,
    personal_message TEXT,
    purchased_order_id TEXT REFERENCES orders(id),
    expires_at TEXT,
    last_used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Gift card transactions
CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id TEXT PRIMARY KEY,
    gift_card_id TEXT NOT NULL REFERENCES gift_cards(id),
    order_id TEXT REFERENCES orders(id),
    type TEXT NOT NULL CHECK (type IN ('purchase', 'redemption', 'refund', 'adjustment')),
    amount REAL NOT NULL,
    balance_before REAL NOT NULL,
    balance_after REAL NOT NULL,
    notes TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- TAX & SHIPPING
-- =============================================================================

-- Tax rates by state/region
CREATE TABLE IF NOT EXISTS tax_rates (
    id TEXT PRIMARY KEY,
    country TEXT DEFAULT 'US',
    state TEXT NOT NULL,
    city TEXT,
    zip_code TEXT,
    rate REAL NOT NULL,
    name TEXT,
    is_active INTEGER DEFAULT 1,
    priority INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Shipping zones
CREATE TABLE IF NOT EXISTS shipping_zones (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    countries TEXT, -- JSON array
    states TEXT, -- JSON array
    zip_codes TEXT, -- JSON array or ranges
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Shipping methods
CREATE TABLE IF NOT EXISTS shipping_methods (
    id TEXT PRIMARY KEY,
    zone_id TEXT REFERENCES shipping_zones(id),
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN ('flat_rate', 'free', 'weight_based', 'price_based', 'carrier')),
    cost REAL DEFAULT 0,
    free_shipping_threshold REAL,
    min_order_amount REAL,
    max_order_amount REAL,
    estimated_days_min INTEGER,
    estimated_days_max INTEGER,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- ADMIN & SETTINGS
-- =============================================================================

-- System settings
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    type TEXT DEFAULT 'string' CHECK (type IN ('string', 'number', 'boolean', 'json')),
    category TEXT DEFAULT 'general',
    description TEXT,
    is_public INTEGER DEFAULT 0, -- Can be exposed to frontend
    updated_by TEXT REFERENCES users(id),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Admin activity/audit log
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL, -- 'product', 'order', 'user', 'coupon', etc.
    entity_id TEXT,
    old_values TEXT, -- JSON
    new_values TEXT, -- JSON
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    subject TEXT NOT NULL,
    html_body TEXT NOT NULL,
    text_body TEXT,
    variables TEXT, -- JSON array of available variables
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Email log
CREATE TABLE IF NOT EXISTS email_log (
    id TEXT PRIMARY KEY,
    template_id TEXT REFERENCES email_templates(id),
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
    provider_message_id TEXT,
    error_message TEXT,
    metadata TEXT, -- JSON
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- NOTIFICATIONS
-- =============================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT, -- JSON additional data
    is_read INTEGER DEFAULT 0,
    read_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- ANALYTICS & REPORTING
-- =============================================================================

-- Daily sales summary (pre-aggregated for performance)
CREATE TABLE IF NOT EXISTS daily_sales_summary (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    total_orders INTEGER DEFAULT 0,
    total_revenue REAL DEFAULT 0,
    total_tax REAL DEFAULT 0,
    total_shipping REAL DEFAULT 0,
    total_discounts REAL DEFAULT 0,
    average_order_value REAL DEFAULT 0,
    total_items_sold INTEGER DEFAULT 0,
    new_customers INTEGER DEFAULT 0,
    returning_customers INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Product performance
CREATE TABLE IF NOT EXISTS product_performance (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL REFERENCES products(id),
    date TEXT NOT NULL,
    views INTEGER DEFAULT 0,
    add_to_cart INTEGER DEFAULT 0,
    purchases INTEGER DEFAULT 0,
    revenue REAL DEFAULT 0,
    UNIQUE(product_id, date)
);

-- =============================================================================
-- INDEXES FOR PERFORMANCE
-- =============================================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

-- Products
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_is_featured ON products(is_featured);

-- Orders
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- Order items
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);

-- Gift cards
CREATE INDEX IF NOT EXISTS idx_gift_cards_code ON gift_cards(code);
CREATE INDEX IF NOT EXISTS idx_gift_cards_status ON gift_cards(status);

-- Coupons
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_is_active ON coupons(is_active);

-- Audit log
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON admin_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON admin_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at);

-- Cart
CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);
CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id);

-- Sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON user_sessions(expires_at);
