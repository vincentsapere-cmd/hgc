# Home Grown Creations - E-Commerce Application

## Project Overview

Enterprise-grade e-commerce application with full PayPal SDK integration, MySQL database, and comprehensive admin suite. Frontend and backend are fully integrated with real-time API communication.

**Production URL:** https://homegrowncreations.thepfps.xyz

## Architecture

```
hgc/
├── App.tsx              # React SPA frontend (main application)
├── index.tsx            # React entry point
├── types.ts             # TypeScript interfaces
├── constants.ts         # Application constants
├── index.html           # Entry point with dynamic PayPal SDK loading
├── vite.config.ts       # Vite config with API proxy
├── src/
│   └── api/
│       └── client.ts    # API client for backend communication
└── server/              # Express.js backend
    ├── src/
    │   ├── index.js           # Server entry point (port 5000)
    │   ├── config/            # Environment configuration
    │   ├── database/
    │   │   ├── schema.sql     # Full database schema (25 tables)
    │   │   └── init.js        # Database initialization
    │   ├── middleware/
    │   │   ├── auth.js        # JWT authentication
    │   │   ├── validators.js  # Input validation
    │   │   ├── sanitizer.js   # XSS protection
    │   │   ├── securityHeaders.js
    │   │   ├── requestLogger.js
    │   │   └── errorHandler.js
    │   ├── routes/
    │   │   ├── auth.js        # Authentication & 2FA
    │   │   ├── products.js    # Product catalog
    │   │   ├── orders.js      # Order management
    │   │   ├── payments.js    # PayPal integration
    │   │   ├── cart.js        # Shopping cart
    │   │   ├── users.js       # User profiles
    │   │   ├── settings.js    # Public settings
    │   │   ├── webhooks.js    # PayPal webhooks
    │   │   └── admin/         # Admin suite (8 modules)
    │   │       ├── dashboard.js
    │   │       ├── products.js
    │   │       ├── orders.js
    │   │       ├── users.js
    │   │       ├── coupons.js
    │   │       ├── giftCards.js
    │   │       ├── settings.js
    │   │       └── reports.js
    │   ├── services/
    │   │   ├── paypal.js      # PayPal REST SDK integration
    │   │   └── email.js       # Nodemailer service
    │   └── utils/
    │       └── logger.js      # Winston logging
    ├── data/                  # SQLite database storage
    ├── logs/                  # Application logs
    ├── uploads/               # File uploads
    └── .env.example           # Configuration template
```

## Tech Stack

### Frontend
- **Framework:** React 19.2 + TypeScript
- **Build:** Vite 6.2
- **Charts:** Recharts 3.4

### Backend
- **Runtime:** Node.js >= 18.0.0
- **Framework:** Express.js 4.18
- **Database:** SQLite (better-sqlite3 9.4)
- **Auth:** JWT (jsonwebtoken 9.0) + bcryptjs 2.4
- **2FA:** speakeasy 2.0 + qrcode 1.5
- **Payments:** PayPal REST SDK + Checkout Server SDK
- **Email:** Nodemailer 6.9
- **Security:** helmet, hpp, xss-clean, csurf, express-rate-limit
- **Uploads:** multer + sharp (image processing)
- **Logging:** winston + winston-daily-rotate-file

## Commands

### Frontend
```bash
npm install        # Install dependencies
npm run dev        # Start dev server (port 3000)
npm run build      # Production build
npm run preview    # Preview production build
```

### Backend
```bash
cd server
npm install        # Install dependencies
npm run dev        # Start with nodemon (port 5000)
npm start          # Production start
npm run db:init    # Initialize database
npm run db:seed    # Seed sample data
npm run db:migrate # Run migrations
npm test           # Run tests with coverage
npm run lint       # ESLint
```

## Configuration

### Required Environment Variables
Copy `server/.env.example` to `server/.env` and configure:

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | 64+ character secret for JWT signing |
| `SESSION_SECRET` | Session encryption key |
| `PAYPAL_MODE` | `sandbox` or `live` |
| `PAYPAL_SANDBOX_CLIENT_ID` | PayPal sandbox credentials |
| `PAYPAL_SANDBOX_CLIENT_SECRET` | PayPal sandbox secret |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Email configuration |

### Optional Configuration
- PostgreSQL support (uncomment in .env)
- SendGrid, Mailgun, AWS SES email providers
- Redis for caching/sessions
- Google Analytics, Sentry integration

## API Endpoints

Base URL: `http://localhost:5000/api/v1` (or via proxy at `http://localhost:3000/api/v1`)

### Public Routes
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | User registration |
| POST | `/auth/login` | JWT authentication |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/products` | Product catalog |
| GET | `/products/:id` | Product details |
| GET | `/settings/public` | Public settings |

### Protected Routes (require JWT)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users/profile` | Get user profile |
| PUT | `/users/profile` | Update profile |
| GET | `/cart` | Get cart contents |
| POST | `/cart/items` | Add to cart |
| POST | `/orders` | Create order |
| GET | `/orders` | User order history |
| POST | `/payments/paypal/create-order` | Create PayPal order |
| POST | `/payments/paypal/capture` | Capture payment |

### Admin Routes (require admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/dashboard` | Analytics dashboard |
| GET/POST/PUT/DELETE | `/admin/products` | Product CRUD |
| GET/PUT | `/admin/orders` | Order management |
| GET/PUT | `/admin/users` | User management |
| GET/POST/PUT/DELETE | `/admin/coupons` | Coupon management |
| GET/POST/PUT | `/admin/gift-cards` | Gift card management |
| GET/PUT | `/admin/settings` | System settings |
| GET | `/admin/reports` | Sales reports |

## Database Schema

SQLite database with 25 tables organized into modules:

### User Management
- `users` - Customer and admin accounts
- `user_addresses` - Shipping/billing addresses
- `user_sessions` - JWT refresh tokens

### Product Management
- `products` - Product catalog
- `categories` - Product categories
- `product_variations` - Size/flavor variants
- `product_reviews` - Customer reviews
- `inventory_transactions` - Stock audit trail

### Order Management
- `orders` - Order records
- `order_items` - Line items
- `order_status_history` - Status changes

### Shopping
- `carts` - Shopping carts
- `cart_items` - Cart contents
- `wishlists` - User wishlists

### Payments
- `payment_transactions` - Payment records
- `gift_cards` - Gift card balances
- `gift_card_transactions` - Gift card usage
- `coupons` - Discount codes
- `coupon_usages` - Coupon redemptions

### Configuration
- `tax_rates` - Tax by region
- `shipping_zones` - Shipping regions
- `shipping_methods` - Shipping options
- `settings` - System settings
- `email_templates` - Email templates
- `email_log` - Sent emails

### Analytics
- `admin_audit_log` - Admin actions
- `notifications` - User notifications
- `daily_sales_summary` - Pre-aggregated sales
- `product_performance` - Product analytics

## Security Features

- JWT access/refresh token flow
- Two-factor authentication (TOTP)
- Account lockout after 5 failed attempts
- bcrypt password hashing (12 rounds)
- Rate limiting (configurable)
- Helmet security headers
- CSRF protection
- XSS sanitization (xss-clean)
- HTTP Parameter Pollution protection (hpp)
- Input validation (express-validator)
- Audit logging for admin actions
- Server-side PayPal order verification

## Admin Access

Default admin credentials (change after first login):
- **Email:** `admin@homegrowncreations.com`
- **Password:** `Admin123!@#`

## API Response Format

Success:
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

Error:
```json
{
  "success": false,
  "error": "Error description"
}
```

## Development Workflow

1. Start backend: `cd server && npm run dev`
2. Start frontend: `npm run dev`
3. Access app: `http://localhost:3000`
4. API calls proxy to: `http://localhost:5000`

## Testing PayPal

1. Create PayPal Developer account
2. Get sandbox credentials from developer.paypal.com
3. Add credentials to `server/.env`
4. Use PayPal sandbox test accounts for checkout
