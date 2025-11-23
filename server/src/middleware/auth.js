/**
 * Authentication & Authorization Middleware
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/index.js';
import { getDatabase } from '../database/init.js';
import { AuthenticationError, AuthorizationError } from './errorHandler.js';
import { logger, logSecurityEvent } from '../utils/logger.js';

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if strings are equal
 */
const safeCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  // Ensure both strings are the same length for constant-time comparison
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Still do comparison to maintain constant time, but result will be false
    const bufPadded = Buffer.alloc(bufA.length);
    crypto.timingSafeEqual(bufA, bufPadded);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
};

/**
 * Verify JWT token and attach user to request
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from header or cookie
    let token = null;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw new AuthenticationError('Access token required');
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, config.security.jwtSecret);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        throw new AuthenticationError('Token expired');
      }
      throw new AuthenticationError('Invalid token');
    }

    // Get user from database
    const db = getDatabase();
    const user = db.prepare(`
      SELECT id, email, first_name, last_name, role, status, two_factor_enabled
      FROM users WHERE id = ?
    `).get(decoded.userId);

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    if (user.status !== 'active') {
      logSecurityEvent('blocked_access_attempt', {
        userId: user.id,
        reason: 'account_suspended',
        ip: req.ip
      });
      throw new AuthenticationError('Account suspended');
    }

    // Check if session is valid - always validate for security
    const session = db.prepare(`
      SELECT id FROM user_sessions
      WHERE user_id = ? AND expires_at > datetime('now')
      ORDER BY created_at DESC LIMIT 1
    `).get(user.id);

    if (!session) {
      // Log the issue regardless of environment
      logSecurityEvent('session_not_found', {
        userId: user.id,
        ip: req.ip,
        environment: config.env
      });

      // In development, warn but allow (for easier testing)
      // In production or any other mode, enforce session validation
      if (config.env === 'development') {
        logger.warn('Session validation bypassed in development mode', { userId: user.id });
      } else {
        throw new AuthenticationError('Session expired');
      }
    }

    // Attach user to request
    req.user = user;
    req.token = token;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res, next) => {
  try {
    let token = null;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, config.security.jwtSecret);
        const db = getDatabase();
        const user = db.prepare(`
          SELECT id, email, first_name, last_name, role, status
          FROM users WHERE id = ? AND status = 'active'
        `).get(decoded.userId);

        if (user) {
          req.user = user;
        }
      } catch (err) {
        // Token invalid, continue as guest
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Require specific roles
 */
export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      logSecurityEvent('unauthorized_access_attempt', {
        userId: req.user.id,
        requiredRoles: roles,
        userRole: req.user.role,
        path: req.path,
        ip: req.ip
      });
      return next(new AuthorizationError('Insufficient permissions'));
    }

    next();
  };
};

/**
 * Admin role shortcuts
 */
export const requireAdmin = requireRole('admin', 'super_admin');
export const requireSuperAdmin = requireRole('super_admin');
export const requireManager = requireRole('admin', 'super_admin', 'manager');

/**
 * Verify CSRF token using constant-time comparison
 */
export const verifyCsrf = (req, res, next) => {
  // Skip for GET, HEAD, OPTIONS
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const csrfToken = req.headers['x-csrf-token'] || req.body._csrf;
  const storedToken = req.cookies?.csrfToken;

  // Validate both tokens exist and are strings
  if (!csrfToken || !storedToken) {
    logSecurityEvent('csrf_validation_failed', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      reason: 'missing_token'
    });
    return next(new AuthorizationError('CSRF token validation failed'));
  }

  // Use constant-time comparison to prevent timing attacks
  if (!safeCompare(csrfToken, storedToken)) {
    logSecurityEvent('csrf_validation_failed', {
      ip: req.ip,
      path: req.path,
      method: req.method,
      reason: 'token_mismatch'
    });
    return next(new AuthorizationError('CSRF token validation failed'));
  }

  next();
};

/**
 * Generate new tokens
 */
export const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId, type: 'access' },
    config.security.jwtSecret,
    { expiresIn: config.security.jwtExpiresIn }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    config.security.jwtSecret,
    { expiresIn: config.security.jwtRefreshExpiresIn }
  );

  return { accessToken, refreshToken };
};

export default {
  authenticate,
  optionalAuth,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireManager,
  verifyCsrf,
  generateTokens
};
