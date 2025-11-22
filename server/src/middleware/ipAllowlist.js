/**
 * IP Allowlist Middleware
 * Restricts admin access to specific IP addresses or ranges
 */

import { config } from '../config/index.js';
import { AuthorizationError } from './errorHandler.js';
import { logSecurityEvent, logger } from '../utils/logger.js';

/**
 * Parse IP allowlist from environment or config
 * Supports individual IPs and CIDR notation
 */
const parseAllowlist = () => {
  const allowlistEnv = process.env.ADMIN_IP_ALLOWLIST;

  if (!allowlistEnv) {
    return null; // Allowlist not configured, allow all
  }

  return allowlistEnv
    .split(',')
    .map(ip => ip.trim())
    .filter(ip => ip.length > 0);
};

/**
 * Check if IP is in CIDR range
 */
const isIpInCidr = (ip, cidr) => {
  // Simple check for exact match first
  if (!cidr.includes('/')) {
    return ip === cidr;
  }

  const [range, bits] = cidr.split('/');
  const mask = parseInt(bits, 10);

  // Convert IPs to numbers for comparison
  const ipToLong = (ip) => {
    const parts = ip.split('.');
    if (parts.length !== 4) return 0;
    return parts.reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0;
  };

  const ipLong = ipToLong(ip);
  const rangeLong = ipToLong(range);
  const maskLong = mask === 0 ? 0 : (~0 << (32 - mask)) >>> 0;

  return (ipLong & maskLong) === (rangeLong & maskLong);
};

/**
 * Get client IP, handling proxies
 */
const getClientIp = (req) => {
  // Trust X-Forwarded-For header only if behind trusted proxy
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      // Get first IP in chain (original client)
      return forwarded.split(',')[0].trim();
    }
  }

  // Direct connection IP
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress;
};

/**
 * Normalize IP address (handle IPv6-mapped IPv4)
 */
const normalizeIp = (ip) => {
  if (!ip) return null;

  // Remove IPv6 prefix from IPv4 addresses
  if (ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }

  // Handle localhost
  if (ip === '::1') {
    return '127.0.0.1';
  }

  return ip;
};

/**
 * Check if IP is allowed
 */
const isIpAllowed = (ip, allowlist) => {
  if (!allowlist || allowlist.length === 0) {
    return true; // No allowlist configured, allow all
  }

  const normalizedIp = normalizeIp(ip);

  // Always allow localhost in development
  if (config.env === 'development' &&
      (normalizedIp === '127.0.0.1' || normalizedIp === 'localhost')) {
    return true;
  }

  // Check against allowlist
  for (const allowed of allowlist) {
    if (allowed === '*') {
      return true; // Wildcard allows all
    }

    if (isIpInCidr(normalizedIp, allowed)) {
      return true;
    }
  }

  return false;
};

/**
 * IP Allowlist middleware for admin routes
 */
export const adminIpAllowlist = (req, res, next) => {
  const allowlist = parseAllowlist();

  // Skip if no allowlist configured
  if (!allowlist) {
    return next();
  }

  const clientIp = getClientIp(req);
  const normalizedIp = normalizeIp(clientIp);

  if (!isIpAllowed(clientIp, allowlist)) {
    logSecurityEvent('admin_ip_blocked', {
      ip: normalizedIp,
      path: req.path,
      userId: req.user?.id,
      userAgent: req.get('User-Agent')
    });

    logger.warn('Admin access blocked by IP allowlist', {
      ip: normalizedIp,
      allowlist
    });

    return next(new AuthorizationError('Access denied from this IP address'));
  }

  // Log successful admin access
  logger.debug('Admin access allowed', { ip: normalizedIp });
  next();
};

/**
 * Create IP allowlist middleware with custom allowlist
 */
export const createIpAllowlist = (customAllowlist) => {
  return (req, res, next) => {
    const clientIp = getClientIp(req);

    if (!isIpAllowed(clientIp, customAllowlist)) {
      logSecurityEvent('ip_blocked_custom', {
        ip: normalizeIp(clientIp),
        path: req.path
      });

      return next(new AuthorizationError('Access denied from this IP address'));
    }

    next();
  };
};

export default {
  adminIpAllowlist,
  createIpAllowlist,
  isIpAllowed,
  getClientIp,
  normalizeIp
};
