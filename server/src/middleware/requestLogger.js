/**
 * Request Logging Middleware
 */

import { logger } from '../utils/logger.js';

export const requestLogger = (req, res, next) => {
  const startTime = Date.now();

  // Log request start
  const requestLog = {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || 'anonymous'
  };

  // Capture response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';

    logger[logLevel]('HTTP Request', {
      ...requestLog,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
};

export default requestLogger;
