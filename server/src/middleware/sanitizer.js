/**
 * Input Sanitization Middleware
 * Protects against XSS and injection attacks
 */

/**
 * Sanitize a string value
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;

  return str
    // Remove null bytes
    .replace(/\0/g, '')
    // Encode HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    // Remove script tags (additional layer)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove event handlers
    .replace(/on\w+\s*=/gi, '')
    // Trim whitespace
    .trim();
};

/**
 * Recursively sanitize an object
 */
const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    // Sanitize both key and value
    const sanitizedKey = sanitizeString(key);
    sanitized[sanitizedKey] = sanitizeObject(value);
  }
  return sanitized;
};

/**
 * Sanitize input middleware
 */
export const sanitizeInput = (req, res, next) => {
  // Sanitize body
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body);
  }

  // Sanitize query parameters
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query);
  }

  // Sanitize URL parameters
  if (req.params && typeof req.params === 'object') {
    req.params = sanitizeObject(req.params);
  }

  next();
};

/**
 * SQL injection prevention - parameter binding validator
 */
export const validateSqlParams = (params) => {
  const dangerousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
    /(--|#|\/\*|\*\/)/g,
    /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
    /(\bAND\b\s+\d+\s*=\s*\d+)/gi,
    /(;|\|\||&&)/g
  ];

  const check = (value) => {
    if (typeof value !== 'string') return true;
    return !dangerousPatterns.some(pattern => pattern.test(value));
  };

  if (typeof params === 'string') {
    return check(params);
  }

  if (Array.isArray(params)) {
    return params.every(check);
  }

  if (typeof params === 'object' && params !== null) {
    return Object.values(params).every(value => validateSqlParams(value));
  }

  return true;
};

export default {
  sanitizeInput,
  sanitizeString,
  sanitizeObject,
  validateSqlParams
};
