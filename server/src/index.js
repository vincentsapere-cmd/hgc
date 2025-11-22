/**
 * Home Grown Creations - Enterprise E-Commerce Server
 * Main entry point with enterprise-grade security and configuration
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import rateLimit from 'express-rate-limit';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { sanitizeInput } from './middleware/sanitizer.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { initializeDatabase } from './database/init.js';
import routes from './routes/index.js';

const app = express();

// =============================================================================
// SECURITY MIDDLEWARE (Order matters!)
// =============================================================================

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Helmet - Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://www.paypal.com", "https://www.paypalobjects.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "https://www.paypal.com", "https://api.paypal.com", "https://api-m.paypal.com"],
      frameSrc: ["'self'", "https://www.paypal.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: config.env === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// Custom security headers
app.use(securityHeaders);

// CORS configuration
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page']
}));

// Compression
app.use(compression());

// Cookie parser
app.use(cookieParser(config.security.sessionSecret));

// Body parsers with size limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Prevent HTTP Parameter Pollution
app.use(hpp({
  whitelist: ['sort', 'fields', 'page', 'limit', 'category', 'price', 'status']
}));

// Input sanitization (XSS protection)
app.use(sanitizeInput);

// Request logging
app.use(requestLogger);

// =============================================================================
// RATE LIMITING
// =============================================================================

// Global rate limiter
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
    retryAfter: Math.ceil(config.rateLimit.windowMs / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next, options) => {
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      userAgent: req.get('User-Agent')
    });
    res.status(429).json(options.message);
  }
});

app.use('/api', globalLimiter);

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: config.rateLimit.loginWindowMs,
  max: config.rateLimit.loginMax,
  message: {
    success: false,
    error: 'Too many login attempts. Please try again in 5 minutes.',
    retryAfter: 300
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true
});

app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);

// Payment endpoint rate limiter
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: {
    success: false,
    error: 'Too many payment requests. Please wait before trying again.'
  }
});

app.use('/api/v1/payments', paymentLimiter);
app.use('/api/v1/orders', paymentLimiter);

// =============================================================================
// STATIC FILES
// =============================================================================

app.use('/uploads', express.static(config.uploadDir, {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// =============================================================================
// API ROUTES
// =============================================================================

app.use('/api/v1', routes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.env
  });
});

// API documentation redirect
app.get('/api', (req, res) => {
  res.json({
    message: 'Home Grown Creations Enterprise API',
    version: config.apiVersion,
    documentation: '/api/v1/docs',
    endpoints: {
      auth: '/api/v1/auth',
      products: '/api/v1/products',
      orders: '/api/v1/orders',
      cart: '/api/v1/cart',
      payments: '/api/v1/payments',
      admin: '/api/v1/admin',
      webhooks: '/api/v1/webhooks'
    }
  });
});

// =============================================================================
// ERROR HANDLING
// =============================================================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

const gracefulShutdown = (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(() => {
    logger.info('HTTP server closed');

    // Close database connections
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// =============================================================================
// SERVER STARTUP
// =============================================================================

let server;

const startServer = async () => {
  try {
    // Initialize database
    logger.info('Initializing database...');
    await initializeDatabase();
    logger.info('Database initialized successfully');

    // Start server
    server = app.listen(config.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🌿 HOME GROWN CREATIONS ENTERPRISE SERVER                  ║
║                                                              ║
║   Environment: ${config.env.padEnd(43)}║
║   Port: ${String(config.port).padEnd(51)}║
║   API Version: ${config.apiVersion.padEnd(43)}║
║                                                              ║
║   Server is ready to accept connections                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
      `);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
