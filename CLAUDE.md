# Home Grown Creations - E-Commerce Application

## Project Overview

Enterprise-grade e-commerce application with full PayPal SDK integration, SQL database, and comprehensive admin suite.

## Architecture

```
hgc/
├── App.tsx              # React SPA frontend (requires backend integration)
├── types.ts             # TypeScript interfaces
├── constants.ts         # Product catalog (migrate to database)
├── index.html           # Entry point with PayPal SDK
└── server/              # Express.js backend
    ├── src/
    │   ├── index.js           # Server entry point
    │   ├── config/            # Environment configuration
    │   ├── database/          # SQLite schema & initialization
    │   ├── middleware/        # Auth, validation, security
    │   ├── routes/            # API endpoints
    │   │   ├── auth.js        # Authentication & 2FA
    │   │   ├── products.js    # Product catalog
    │   │   ├── orders.js      # Order management
    │   │   ├── payments.js    # PayPal integration
    │   │   ├── cart.js        # Shopping cart
    │   │   ├── users.js       # User profiles
    │   │   └── admin/         # Admin suite (8 modules)
    │   ├── services/          # PayPal, email services
    │   └── utils/             # Logger, helpers
    └── .env.example           # Configuration template
```

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Node.js + Express.js
- **Database:** SQLite (better-sqlite3)
- **Auth:** JWT + bcrypt + speakeasy (2FA)
- **Payments:** PayPal REST SDK v2
- **Email:** Nodemailer

## Getting Started

### Backend Setup
```bash
cd server
cp .env.example .env
# Edit .env with your credentials
npm install
npm run dev
```

### Required Configuration
Edit `server/.env`:
- `JWT_SECRET` - 64+ character random string
- `PAYPAL_CLIENT_ID` - Your PayPal client ID
- `PAYPAL_CLIENT_SECRET` - Your PayPal secret
- `SMTP_*` - Email configuration

## API Base URL

Development: `http://localhost:3001/api/v1`

## Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/register` | POST | User registration |
| `/auth/login` | POST | Authentication |
| `/products` | GET | Product catalog |
| `/orders` | POST | Create order |
| `/payments/paypal/create-order` | POST | Initialize PayPal |
| `/payments/paypal/capture/:id` | POST | Capture payment |
| `/admin/*` | * | Admin suite (requires auth) |

## Database

SQLite database at `server/data/ecommerce.db` with 30+ tables covering:
- Users & authentication
- Products & categories
- Orders & payments
- Coupons & gift cards
- Settings & audit logs

## Security Features

- JWT access/refresh tokens
- Two-factor authentication (TOTP)
- Account lockout (5 failed attempts)
- bcrypt password hashing (12 rounds)
- Rate limiting
- CSRF protection
- Input sanitization
- Audit logging

## Known Issues

1. **Frontend not integrated with backend** - App.tsx uses hardcoded auth and in-memory state
2. **Hardcoded admin credentials** - Remove `admin/admin` check in App.tsx
3. **PayPal sandbox ID** - Update `sb` in index.html for production

## Development Notes

- Backend runs on port 3001
- Frontend runs on port 5173 (Vite default)
- Admin default: `admin@homegrowncreations.com` / `Admin123!@#`
- All API responses follow `{ success: boolean, data/error, message }`

## Testing Payments

Use PayPal sandbox credentials for testing. Set `PAYPAL_MODE=sandbox` in `.env`.
