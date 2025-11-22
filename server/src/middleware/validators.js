/**
 * Request Validation Middleware using express-validator
 */

import { body, param, query, validationResult } from 'express-validator';
import { ValidationError } from './errorHandler.js';

/**
 * Validate request and return errors
 */
export const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => ({
      field: err.path,
      message: err.msg
    }));
    return next(new ValidationError('Validation failed', errorMessages));
  }
  next();
};

// =============================================================================
// AUTH VALIDATORS
// =============================================================================

export const registerValidation = [
  body('email')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email too long'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('Password must include uppercase, lowercase, number, and special character'),
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('First name is required'),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Last name is required'),
  body('phone')
    .optional()
    .isMobilePhone().withMessage('Invalid phone number'),
  validate
];

export const loginValidation = [
  body('email')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  body('password')
    .notEmpty().withMessage('Password is required'),
  validate
];

export const passwordResetValidation = [
  body('email')
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
  validate
];

export const passwordUpdateValidation = [
  body('token')
    .notEmpty().withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/)
    .withMessage('Password must include uppercase, lowercase, number, and special character'),
  validate
];

// =============================================================================
// PRODUCT VALIDATORS
// =============================================================================

export const createProductValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Product name is required'),
  body('sku')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('SKU is required')
    .matches(/^[A-Za-z0-9-_]+$/).withMessage('SKU can only contain letters, numbers, hyphens, and underscores'),
  body('price')
    .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('categoryId')
    .optional()
    .isUUID().withMessage('Invalid category ID'),
  body('description')
    .optional()
    .isLength({ max: 5000 }).withMessage('Description too long'),
  body('mg')
    .optional()
    .isInt({ min: 0 }).withMessage('MG must be a positive integer'),
  body('stockQuantity')
    .optional()
    .isInt({ min: 0 }).withMessage('Stock quantity must be a positive integer'),
  validate
];

export const updateProductValidation = [
  param('id').isUUID().withMessage('Invalid product ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Product name cannot be empty'),
  body('price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('stockQuantity')
    .optional()
    .isInt({ min: 0 }).withMessage('Stock quantity must be a positive integer'),
  validate
];

// =============================================================================
// ORDER VALIDATORS
// =============================================================================

export const createOrderValidation = [
  body('items')
    .isArray({ min: 1 }).withMessage('Order must have at least one item'),
  body('items.*.productId')
    .isUUID().withMessage('Invalid product ID'),
  body('items.*.quantity')
    .isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('shippingAddress.firstName')
    .trim()
    .isLength({ min: 1 }).withMessage('First name is required'),
  body('shippingAddress.lastName')
    .trim()
    .isLength({ min: 1 }).withMessage('Last name is required'),
  body('shippingAddress.line1')
    .trim()
    .isLength({ min: 1 }).withMessage('Address is required'),
  body('shippingAddress.city')
    .trim()
    .isLength({ min: 1 }).withMessage('City is required'),
  body('shippingAddress.state')
    .trim()
    .isLength({ min: 2, max: 2 }).withMessage('State must be 2-letter code'),
  body('shippingAddress.zip')
    .trim()
    .matches(/^\d{5}(-\d{4})?$/).withMessage('Invalid ZIP code'),
  body('email')
    .isEmail().withMessage('Invalid email address'),
  body('phone')
    .optional()
    .isMobilePhone().withMessage('Invalid phone number'),
  validate
];

// =============================================================================
// PAYMENT VALIDATORS
// =============================================================================

export const paypalCaptureValidation = [
  body('orderId')
    .notEmpty().withMessage('PayPal order ID is required'),
  body('internalOrderId')
    .optional()
    .isUUID().withMessage('Invalid internal order ID'),
  validate
];

// =============================================================================
// COUPON VALIDATORS
// =============================================================================

export const createCouponValidation = [
  body('code')
    .trim()
    .isLength({ min: 3, max: 50 }).withMessage('Coupon code must be 3-50 characters')
    .matches(/^[A-Za-z0-9-_]+$/).withMessage('Coupon code can only contain letters, numbers, hyphens'),
  body('type')
    .isIn(['percentage', 'fixed_amount', 'free_shipping']).withMessage('Invalid coupon type'),
  body('value')
    .isFloat({ min: 0 }).withMessage('Value must be a positive number'),
  body('minimumOrderAmount')
    .optional()
    .isFloat({ min: 0 }).withMessage('Minimum order amount must be positive'),
  body('expiresAt')
    .optional()
    .isISO8601().withMessage('Invalid expiration date'),
  validate
];

// =============================================================================
// GIFT CARD VALIDATORS
// =============================================================================

export const createGiftCardValidation = [
  body('initialBalance')
    .isFloat({ min: 1, max: 1000 }).withMessage('Gift card balance must be between $1 and $1000'),
  body('recipientEmail')
    .optional()
    .isEmail().withMessage('Invalid recipient email'),
  body('recipientName')
    .optional()
    .isLength({ max: 100 }).withMessage('Recipient name too long'),
  body('personalMessage')
    .optional()
    .isLength({ max: 500 }).withMessage('Personal message too long'),
  validate
];

export const applyGiftCardValidation = [
  body('code')
    .trim()
    .notEmpty().withMessage('Gift card code is required')
    .isLength({ max: 50 }).withMessage('Invalid gift card code'),
  validate
];

// =============================================================================
// ADDRESS VALIDATORS
// =============================================================================

export const addressValidation = [
  body('firstName')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('First name is required'),
  body('lastName')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Last name is required'),
  body('streetAddress')
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Street address is required'),
  body('city')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('City is required'),
  body('state')
    .trim()
    .isLength({ min: 2, max: 2 }).withMessage('State must be 2-letter code'),
  body('zipCode')
    .trim()
    .matches(/^\d{5}(-\d{4})?$/).withMessage('Invalid ZIP code'),
  validate
];

// =============================================================================
// REVIEW VALIDATORS
// =============================================================================

export const reviewValidation = [
  body('productId')
    .isUUID().withMessage('Invalid product ID'),
  body('rating')
    .isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('title')
    .optional()
    .isLength({ max: 200 }).withMessage('Title too long'),
  body('content')
    .optional()
    .isLength({ max: 2000 }).withMessage('Review too long'),
  validate
];

// =============================================================================
// PAGINATION VALIDATORS
// =============================================================================

export const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('sort')
    .optional()
    .isLength({ max: 50 }).withMessage('Invalid sort field'),
  query('order')
    .optional()
    .isIn(['asc', 'desc', 'ASC', 'DESC']).withMessage('Order must be asc or desc'),
  validate
];

export default {
  validate,
  registerValidation,
  loginValidation,
  passwordResetValidation,
  passwordUpdateValidation,
  createProductValidation,
  updateProductValidation,
  createOrderValidation,
  paypalCaptureValidation,
  createCouponValidation,
  createGiftCardValidation,
  applyGiftCardValidation,
  addressValidation,
  reviewValidation,
  paginationValidation
};
