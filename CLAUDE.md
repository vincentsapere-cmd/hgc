# Home Grown Creations - E-Commerce Application

## Project Overview

Enterprise-grade e-commerce application with full PayPal SDK integration, SQL database, and comprehensive admin suite. Frontend and backend are fully integrated.

## Architecture

```
hgc/
├── App.tsx              # React SPA frontend (integrated with backend)
├── types.ts             # TypeScript interfaces
├── index.html           # Entry point with dynamic PayPal SDK loading
├── vite.config.ts       # Vite config with API proxy
├── src/
│   └── api/
│       └── client.ts    # API client for backend communication
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

### 1. Backend Setup
```bash
cd server
cp .env.example .env
# Edit .env with your credentials
npm install
npm run dev
```

### 2. Frontend Setup
```bash
# From project root
npm install
npm run dev
```

### Required Backend Configuration
Edit `server/.env`:
- `JWT_SECRET` - 64+ character random string
- `PAYPAL_CLIENT_ID` - Your PayPal client ID
- `PAYPAL_CLIENT_SECRET` - Your PayPal secret
- `SMTP_*` - Email configuration

## Integration Points

The frontend connects to the backend via the API client (`src/api/client.ts`):

| Frontend Action | Backend Endpoint | Description |
|-----------------|------------------|-------------|
| Login | `POST /auth/login` | JWT authentication |
| Register | `POST /auth/register` | User registration |
| Load Products | `GET /products` | Product catalog |
| Add to Cart | `POST /cart/items` | Cart management |
| Create Order | `POST /orders` | Order creation |
| PayPal Create | `POST /payments/paypal/create-order` | Server-side PayPal |
| PayPal Capture | `POST /payments/paypal/capture` | Payment verification |
| Admin Dashboard | `GET /admin/dashboard` | Analytics data |

## Development URLs

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`
- API (via proxy): `http://localhost:3000/api/v1`

## Database

SQLite database at `server/data/ecommerce.db` with 30+ tables:
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
- Server-side PayPal verification

## Admin Access

Default admin credentials (change after first login):
- Email: `admin@homegrowncreations.com`
- Password: `Admin123!@#`

Access admin panel by signing in and clicking "Dashboard" in the navbar.

## PayPal Configuration

1. Create a PayPal Developer account at https://developer.paypal.com
2. Create a REST API app
3. Copy Client ID and Secret to `server/.env`
4. For production, set `PAYPAL_MODE=live` and use live credentials

The PayPal SDK loads dynamically from the backend configuration.

## Testing

1. Start backend: `cd server && npm run dev`
2. Start frontend: `npm run dev`
3. Visit `http://localhost:3000`
4. Create account or use admin credentials
5. Add products to cart
6. Complete checkout with PayPal sandbox

## API Response Format

All API responses follow this structure:
```json
{
  "success": true,
  "data": { ... },
  "message": "Optional message"
}
```

Error responses:
```json
{
  "success": false,
  "error": "Error description"
}
```
