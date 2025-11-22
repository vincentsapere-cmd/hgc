/**
 * Enterprise Configuration Module
 * Centralized configuration with validation and defaults
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') });

// =============================================================================
// CONFIGURATION VALIDATION
// =============================================================================

/**
 * Patterns that indicate a placeholder/default value that should be changed
 */
const INSECURE_PATTERNS = [
  'REPLACE_WITH',
  'change-in-production',
  'change-me',
  'your-secret',
  'development-secret',
  'development-session',
  'secret-key-here',
  'encryption-key-here'
];

/**
 * Check if a value appears to be a placeholder
 */
const isPlaceholder = (value) => {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return INSECURE_PATTERNS.some(pattern => lower.includes(pattern.toLowerCase()));
};

/**
 * Comprehensive configuration validation
 */
const validateConfig = () => {
  const errors = [];
  const warnings = [];
  const isProduction = process.env.NODE_ENV === 'production';
  const isLivePayPal = process.env.PAYPAL_MODE === 'live';

  // ==========================================================================
  // CRITICAL SECURITY CHECKS (fail in production)
  // ==========================================================================

  // JWT Secret validation
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    errors.push('JWT_SECRET is required');
  } else if (jwtSecret.length < 64) {
    errors.push('JWT_SECRET must be at least 64 characters for security');
  } else if (isPlaceholder(jwtSecret)) {
    errors.push('JWT_SECRET contains a default/placeholder value - must be changed');
  }

  // Session Secret validation
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    errors.push('SESSION_SECRET is required');
  } else if (sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters');
  } else if (isPlaceholder(sessionSecret)) {
    errors.push('SESSION_SECRET contains a default/placeholder value - must be changed');
  }

  // Encryption key validation (if using encryption features)
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey && (encryptionKey.length !== 32 || isPlaceholder(encryptionKey))) {
    warnings.push('ENCRYPTION_KEY should be exactly 32 characters and not a placeholder');
  }

  // ==========================================================================
  // PAYPAL CONFIGURATION CHECKS
  // ==========================================================================

  if (isLivePayPal) {
    // In live mode, validate live credentials
    const liveClientId = process.env.PAYPAL_LIVE_CLIENT_ID;
    const liveClientSecret = process.env.PAYPAL_LIVE_CLIENT_SECRET;

    if (!liveClientId || isPlaceholder(liveClientId)) {
      errors.push('PAYPAL_LIVE_CLIENT_ID is required for live PayPal mode');
    }
    if (!liveClientSecret || isPlaceholder(liveClientSecret)) {
      errors.push('PAYPAL_LIVE_CLIENT_SECRET is required for live PayPal mode');
    }
    if (!process.env.PAYPAL_WEBHOOK_ID) {
      warnings.push('PAYPAL_WEBHOOK_ID is recommended for production webhook verification');
    }
  }

  // Production should not use sandbox mode
  if (isProduction && process.env.PAYPAL_MODE === 'sandbox') {
    warnings.push('PayPal is in sandbox mode but NODE_ENV is production');
  }

  // ==========================================================================
  // DATABASE CHECKS
  // ==========================================================================

  if (isProduction) {
    const dbPassword = process.env.DATABASE_PASSWORD;
    if (!dbPassword || dbPassword.length < 8) {
      warnings.push('DATABASE_PASSWORD should be set and at least 8 characters in production');
    }
  }

  // ==========================================================================
  // OUTPUT RESULTS
  // ==========================================================================

  // Always log warnings
  if (warnings.length > 0) {
    console.warn('\n⚠️  Configuration Warnings:');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('');
  }

  // In production, fail on errors
  if (errors.length > 0) {
    console.error('\n❌ Configuration Errors:');
    errors.forEach(e => console.error(`   - ${e}`));
    console.error('');

    if (isProduction) {
      throw new Error(
        `FATAL: ${errors.length} configuration error(s) detected. ` +
        `Server cannot start in production with insecure configuration. ` +
        `Errors: ${errors.join('; ')}`
      );
    } else {
      console.warn('⚠️  Running in development mode with insecure configuration.');
      console.warn('   These errors would prevent startup in production.\n');
    }
  }

  // Success message
  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ Configuration validation passed\n');
  }
};

// =============================================================================
// CONFIGURATION OBJECT
// =============================================================================

export const config = {
  // Environment
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiVersion: process.env.API_VERSION || 'v1',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',

  // CORS Origins
  corsOrigins: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],

  // Database
  database: {
    type: process.env.DATABASE_TYPE || 'mysql',
    path: process.env.DATABASE_PATH || path.join(__dirname, '../../data/hgc_enterprise.db'),
    // MySQL/PostgreSQL options
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT, 10) || 3306,
    name: process.env.DATABASE_NAME || 'hgc_enterprise',
    user: process.env.DATABASE_USER || 'root',
    password: process.env.DATABASE_PASSWORD || '',
    ssl: process.env.DATABASE_SSL === 'true',
    connectionLimit: parseInt(process.env.DATABASE_POOL_SIZE, 10) || 10
  },

  // Security
  security: {
    jwtSecret: process.env.JWT_SECRET || 'development-secret-change-in-production-64-chars-minimum-required',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    sessionSecret: process.env.SESSION_SECRET || 'development-session-secret-change-me',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
    encryptionKey: process.env.ENCRYPTION_KEY || '32-character-encryption-key-here',
    encryptionIv: process.env.ENCRYPTION_IV || '16-char-iv-here!'
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
    loginWindowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 10) || 5 * 60 * 1000, // 5 minutes
    loginMax: parseInt(process.env.LOGIN_RATE_LIMIT_MAX, 10) || 5
  },

  // PayPal Configuration
  paypal: {
    mode: process.env.PAYPAL_MODE || 'sandbox',
    sandboxClientId: process.env.PAYPAL_SANDBOX_CLIENT_ID || 'REPLACE_WITH_YOUR_PAYPAL_SANDBOX_CLIENT_ID',
    sandboxClientSecret: process.env.PAYPAL_SANDBOX_CLIENT_SECRET || 'REPLACE_WITH_YOUR_PAYPAL_SANDBOX_CLIENT_SECRET',
    liveClientId: process.env.PAYPAL_LIVE_CLIENT_ID || 'REPLACE_WITH_YOUR_PAYPAL_LIVE_CLIENT_ID',
    liveClientSecret: process.env.PAYPAL_LIVE_CLIENT_SECRET || 'REPLACE_WITH_YOUR_PAYPAL_LIVE_CLIENT_SECRET',
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    businessEmail: process.env.PAYPAL_BUSINESS_EMAIL || 'business@homegrowncreations.com',
    // Get active credentials based on mode
    get clientId() {
      return this.mode === 'live' ? this.liveClientId : this.sandboxClientId;
    },
    get clientSecret() {
      return this.mode === 'live' ? this.liveClientSecret : this.sandboxClientSecret;
    },
    get apiUrl() {
      return this.mode === 'live'
        ? 'https://api-m.paypal.com'
        : 'https://api-m.sandbox.paypal.com';
    }
  },

  // Email Configuration
  email: {
    provider: process.env.EMAIL_PROVIDER || 'smtp',
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.your-email-provider.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER || 'REPLACE_WITH_YOUR_EMAIL_USERNAME',
      password: process.env.SMTP_PASSWORD || 'REPLACE_WITH_YOUR_EMAIL_PASSWORD'
    },
    sendgrid: {
      apiKey: process.env.SENDGRID_API_KEY || ''
    },
    mailgun: {
      apiKey: process.env.MAILGUN_API_KEY || '',
      domain: process.env.MAILGUN_DOMAIN || ''
    },
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      region: process.env.AWS_REGION || 'us-east-1'
    },
    from: process.env.EMAIL_FROM || 'noreply@homegrowncreations.com',
    fromName: process.env.EMAIL_FROM_NAME || 'Home Grown Creations',
    replyTo: process.env.EMAIL_REPLY_TO || 'support@homegrowncreations.com',
    adminEmail: process.env.ADMIN_EMAIL || 'admin@homegrowncreations.com',
    ordersEmail: process.env.ORDERS_EMAIL || 'orders@homegrowncreations.com'
  },

  // Business Configuration
  business: {
    name: process.env.BUSINESS_NAME || 'Home Grown Creations',
    address: process.env.BUSINESS_ADDRESS || '123 Main Street, City, State 12345',
    phone: process.env.BUSINESS_PHONE || '+1 (234) 567-890',
    supportEmail: process.env.BUSINESS_SUPPORT_EMAIL || 'support@homegrowncreations.com',
    website: process.env.BUSINESS_WEBSITE || 'https://homegrowncreations.com'
  },

  // Tax Configuration
  tax: {
    enabled: process.env.TAX_ENABLED !== 'false',
    defaultRate: parseFloat(process.env.DEFAULT_TAX_RATE) || 8.25
  },

  // Shipping Configuration
  shipping: {
    flatRate: parseFloat(process.env.SHIPPING_FLAT_RATE) || 15.00,
    freeThreshold: parseFloat(process.env.FREE_SHIPPING_THRESHOLD) || 100.00
  },

  // File Upload
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'),
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024, // 5MB
  allowedFileTypes: process.env.ALLOWED_FILE_TYPES
    ? process.env.ALLOWED_FILE_TYPES.split(',')
    : ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || path.join(__dirname, '../../logs'),
    maxSize: process.env.LOG_MAX_SIZE || '20m',
    maxFiles: process.env.LOG_MAX_FILES || '14d'
  },

  // Two-Factor Authentication
  twoFactor: {
    enabled: process.env.TWO_FACTOR_ENABLED !== 'false',
    issuer: process.env.TWO_FACTOR_ISSUER || 'HomeGrownCreations'
  }
};

// Validate configuration on load
validateConfig();

export default config;
