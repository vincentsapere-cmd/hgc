/**
 * Enterprise Error Handling Middleware
 */

import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

// Custom error classes
export class AppError extends Error {
  constructor(message, statusCode, code = 'INTERNAL_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, 'VALIDATION_ERROR');
    this.errors = errors;
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict') {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

export class PaymentError extends AppError {
  constructor(message, details = {}) {
    super(message, 402, 'PAYMENT_ERROR');
    this.details = details;
  }
}

// 404 Not Found Handler
export const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
  next(error);
};

// Global Error Handler
export const errorHandler = (err, req, res, next) => {
  // Default values
  err.statusCode = err.statusCode || 500;
  err.code = err.code || 'INTERNAL_ERROR';

  // Log error
  if (err.statusCode >= 500) {
    logger.error('Server Error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userId: req.user?.id
    });
  } else {
    logger.warn('Client Error', {
      error: err.message,
      code: err.code,
      path: req.path,
      method: req.method,
      ip: req.ip
    });
  }

  // Build error response
  const errorResponse = {
    success: false,
    error: {
      code: err.code,
      message: err.message
    }
  };

  // Include validation errors if present
  if (err.errors) {
    errorResponse.error.details = err.errors;
  }

  // Include payment details if present
  if (err.details) {
    errorResponse.error.details = err.details;
  }

  // Include stack trace in development
  if (config.env === 'development') {
    errorResponse.error.stack = err.stack;
  }

  // Send response
  res.status(err.statusCode).json(errorResponse);
};

export default {
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  PaymentError,
  notFoundHandler,
  errorHandler
};
