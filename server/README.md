# Home Grown Creations - Enterprise E-Commerce Backend

Enterprise-grade e-commerce backend API with full PayPal SDK integration, SQL database, and comprehensive admin suite.

## Quick Start

```bash
# Install dependencies
npm install

# Initialize database with seed data
npm run db:init

# Start development server
npm run dev

# Start production server
npm start
```

The server will start at `http://localhost:5000`

## Configuration

### Required Setup (Before Going Live)

1. **PayPal Credentials** - Edit `.env`:
   ```
   PAYPAL_SANDBOX_CLIENT_ID=your_sandbox_client_id
   PAYPAL_SANDBOX_CLIENT_SECRET=your_sandbox_client_secret
   PAYPAL_LIVE_CLIENT_ID=your_live_client_id
   PAYPAL_LIVE_CLIENT_SECRET=your_live_client_secret
   ```
   Get credentials at: https://developer.paypal.com/developer/applications

2. **Email Configuration** - Edit `.env`:
   ```
   SMTP_HOST=smtp.your-provider.com
   SMTP_PORT=587
   SMTP_USER=your_email_username
   SMTP_PASSWORD=your_email_password
   ```

3. **Security Keys** (MUST change for production):
   ```
   JWT_SECRET=your-64-character-minimum-secret
   SESSION_SECRET=your-session-secret
   ENCRYPTION_KEY=32-character-encryption-key
   ```

## API Endpoints

### Authentication
- `POST /api/v1/auth/register` - Create account
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/logout` - Logout
- `POST /api/v1/auth/refresh` - Refresh tokens
- `POST /api/v1/auth/forgot-password` - Request password reset
- `POST /api/v1/auth/reset-password` - Reset password
- `GET /api/v1/auth/me` - Get current user
- `POST /api/v1/auth/2fa/setup` - Setup 2FA
- `POST /api/v1/auth/2fa/verify` - Enable 2FA

### Products
- `GET /api/v1/products` - List products (with filtering/pagination)
- `GET /api/v1/products/featured` - Featured products
- `GET /api/v1/products/categories` - All categories
- `GET /api/v1/products/:id` - Product details

### Cart
- `GET /api/v1/cart` - Get cart
- `POST /api/v1/cart/items` - Add item
- `PUT /api/v1/cart/items/:id` - Update quantity
- `DELETE /api/v1/cart/items/:id` - Remove item
- `DELETE /api/v1/cart` - Clear cart

### Orders
- `POST /api/v1/orders` - Create order
- `GET /api/v1/orders` - Order history (auth required)
- `GET /api/v1/orders/:id` - Order details

### Payments
- `GET /api/v1/payments/config` - Get PayPal config
- `POST /api/v1/payments/paypal/create-order` - Create PayPal order
- `POST /api/v1/payments/paypal/capture` - Capture payment
- `POST /api/v1/payments/gift-card/validate` - Validate gift card
- `POST /api/v1/payments/coupon/validate` - Validate coupon

### User Account
- `PUT /api/v1/users/profile` - Update profile
- `PUT /api/v1/users/password` - Change password
- `GET /api/v1/users/addresses` - List addresses
- `POST /api/v1/users/addresses` - Add address
- `GET /api/v1/users/wishlist` - Get wishlist
- `POST /api/v1/users/wishlist` - Add to wishlist
- `POST /api/v1/users/reviews` - Submit review

### Admin (requires admin role)
- `GET /api/v1/admin/dashboard` - Dashboard stats
- `GET /api/v1/admin/products` - Manage products
- `GET /api/v1/admin/orders` - Manage orders
- `GET /api/v1/admin/users` - Manage users
- `GET /api/v1/admin/coupons` - Manage coupons
- `GET /api/v1/admin/gift-cards` - Manage gift cards
- `GET /api/v1/admin/settings` - Store settings
- `GET /api/v1/admin/reports/*` - Sales/inventory reports

### Webhooks
- `POST /api/v1/webhooks/paypal` - PayPal webhook handler

## Default Admin Credentials

After database initialization:
- **Email:** admin@homegrowncreations.com
- **Password:** admin123!@#

**⚠️ Change this immediately in production!**

## Database

Uses SQLite by default (easily portable to PostgreSQL/MySQL).

Database file: `./data/hgc_enterprise.db`

### Tables
- users, user_addresses, user_sessions
- products, product_variations, product_reviews
- categories
- orders, order_items, order_status_history
- carts, cart_items
- payment_transactions
- coupons, coupon_usages
- gift_cards, gift_card_transactions
- tax_rates, shipping_zones, shipping_methods
- settings, admin_audit_log, email_templates
- wishlists, notifications
- inventory_transactions
- daily_sales_summary, product_performance

## Security Features

- JWT authentication with refresh tokens
- Password hashing (bcrypt, 12 rounds)
- Two-factor authentication (TOTP)
- Rate limiting (global + auth endpoints)
- CSRF protection
- XSS prevention (input sanitization)
- SQL injection protection (parameterized queries)
- Security headers (Helmet)
- Audit logging
- Session management
- Account lockout after failed attempts

## PayPal Integration

Full server-side SDK integration:
- Order creation with full item details
- Payment capture with verification
- Refund processing
- Webhook signature verification
- Automatic inventory deduction
- Gift card balance deduction

## Email System

Nodemailer with support for:
- SMTP
- SendGrid
- Mailgun
- AWS SES

Templates:
- Order confirmation
- Shipping notification
- Password reset
- Welcome email
- Gift card delivery

In development mode, emails are logged to console.

## File Structure

```
server/
├── src/
│   ├── index.js           # Server entry point
│   ├── config/            # Configuration
│   ├── database/          # Schema & initialization
│   ├── middleware/        # Auth, validation, security
│   ├── routes/            # API routes
│   │   ├── admin/         # Admin routes
│   │   ├── auth.js
│   │   ├── products.js
│   │   ├── orders.js
│   │   ├── payments.js
│   │   └── ...
│   ├── services/          # PayPal, email services
│   └── utils/             # Logger, helpers
├── data/                  # Database files
├── logs/                  # Log files
├── uploads/               # Uploaded files
├── .env                   # Environment config
└── package.json
```

## Production Checklist

- [ ] Change all default passwords
- [ ] Update JWT_SECRET and SESSION_SECRET
- [ ] Configure PayPal live credentials
- [ ] Configure SMTP/email service
- [ ] Set PAYPAL_MODE=live
- [ ] Enable HTTPS
- [ ] Configure proper CORS origins
- [ ] Set up database backups
- [ ] Configure error monitoring (e.g., Sentry)
- [ ] Review rate limiting settings
- [ ] Set up log rotation
