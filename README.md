# Home Grown Creations - Enterprise E-Commerce Platform

<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

## Overview

Enterprise-grade, security-safe e-commerce application with complete backend API, SQL database, full PayPal SDK integration, and comprehensive admin suite.

## Architecture

```
hgc/
├── Frontend (React + TypeScript + Vite)
│   ├── App.tsx              # Main React application
│   ├── constants.ts         # Product catalog
│   ├── types.ts             # TypeScript interfaces
│   └── index.html           # HTML entry point
│
└── Backend (Node.js + Express + SQLite)
    └── server/
        ├── src/
        │   ├── index.js           # Server entry
        │   ├── config/            # Configuration
        │   ├── database/          # SQL schema
        │   ├── middleware/        # Security & auth
        │   ├── routes/            # API endpoints
        │   └── services/          # PayPal, email
        └── .env                   # Environment config
```

## Quick Start

### Frontend Only (Development)
```bash
npm install
npm run dev
```

### Full Stack (Frontend + Backend)

**Terminal 1 - Backend:**
```bash
cd server
npm install
npm run dev
```

**Terminal 2 - Frontend:**
```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000

## Configuration Required

Before deploying to production, update these in `server/.env`:

### 1. PayPal Credentials
```env
PAYPAL_SANDBOX_CLIENT_ID=your_sandbox_client_id
PAYPAL_SANDBOX_CLIENT_SECRET=your_sandbox_client_secret
PAYPAL_LIVE_CLIENT_ID=your_live_client_id
PAYPAL_LIVE_CLIENT_SECRET=your_live_client_secret
```
Get credentials: https://developer.paypal.com/developer/applications

### 2. Email Configuration
```env
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your_email_username
SMTP_PASSWORD=your_email_password
```

### 3. Security Keys (MUST CHANGE)
```env
JWT_SECRET=your-64-character-minimum-secret-key
SESSION_SECRET=your-secure-session-secret
ENCRYPTION_KEY=32-character-encryption-key
```

## Features

### E-Commerce
- ✅ Product catalog with categories and variations
- ✅ Shopping cart (guest + authenticated)
- ✅ Checkout with shipping/billing addresses
- ✅ PayPal payment processing
- ✅ Gift card system with balance tracking
- ✅ Coupon/discount codes
- ✅ Tax calculation by location
- ✅ Shipping zones and methods
- ✅ Order confirmation emails
- ✅ Inventory management with low stock alerts

### Customer Features
- ✅ User registration and login
- ✅ Two-factor authentication (TOTP)
- ✅ Password reset via email
- ✅ Address book management
- ✅ Order history
- ✅ Wishlist
- ✅ Product reviews

### Admin Suite
- ✅ Dashboard with analytics
- ✅ Product management (CRUD + inventory)
- ✅ Order management (status, shipping, refunds)
- ✅ Customer management
- ✅ Coupon management
- ✅ Gift card management
- ✅ Tax rate configuration
- ✅ Shipping zone configuration
- ✅ Store settings
- ✅ Sales reports with export
- ✅ Audit logging

### Security
- ✅ JWT authentication with refresh tokens
- ✅ Password hashing (bcrypt, 12 rounds)
- ✅ Rate limiting (global + auth endpoints)
- ✅ CSRF protection
- ✅ XSS prevention (input sanitization)
- ✅ SQL injection protection
- ✅ Security headers (Helmet)
- ✅ Account lockout after failed attempts
- ✅ Session management
- ✅ Audit trail logging

## Default Admin Login

After starting the backend:
- **Email:** admin@homegrowncreations.com
- **Password:** admin123!@#

⚠️ **Change this immediately in production!**

## API Documentation

Full API documentation available at `http://localhost:5000/api` after starting the server.

Key endpoints:
- `POST /api/v1/auth/login` - Authentication
- `GET /api/v1/products` - Product catalog
- `POST /api/v1/orders` - Create order
- `POST /api/v1/payments/paypal/capture` - Process payment
- `GET /api/v1/admin/dashboard` - Admin dashboard

See `server/README.md` for complete API reference.

## Database

SQLite database with full schema including:
- Users & authentication
- Products & categories
- Orders & order items
- Shopping carts
- Payment transactions
- Gift cards & coupons
- Tax rates & shipping zones
- Audit logs & email templates

Database file: `server/data/hgc_enterprise.db`

## Production Deployment Checklist

- [ ] Update all placeholder credentials in `.env`
- [ ] Set `NODE_ENV=production`
- [ ] Set `PAYPAL_MODE=live` with live credentials
- [ ] Configure proper SMTP credentials
- [ ] Enable HTTPS
- [ ] Set up database backups
- [ ] Configure reverse proxy (nginx/Apache)
- [ ] Set up monitoring and error tracking
- [ ] Review and adjust rate limits
- [ ] Change default admin password

## Tech Stack

**Frontend:**
- React 19.2
- TypeScript
- Vite
- Tailwind CSS
- Recharts

**Backend:**
- Node.js 18+
- Express.js
- SQLite (better-sqlite3)
- JWT (jsonwebtoken)
- bcryptjs
- Nodemailer
- PayPal SDK

## License

Proprietary - Home Grown Creations
