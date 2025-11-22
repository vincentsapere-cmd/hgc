/**
 * Password Service
 * Handles password validation, history tracking, and security policies
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/index.js';
import { getDatabase } from '../database/init.js';
import { logger } from '../utils/logger.js';

/**
 * Number of previous passwords to check against
 */
const PASSWORD_HISTORY_COUNT = 5;

/**
 * Check if password meets complexity requirements
 */
export const validatePasswordComplexity = (password) => {
  const errors = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[@$!%*?&#]/.test(password)) {
    errors.push('Password must contain at least one special character (@$!%*?&#)');
  }

  // Check for common passwords (basic check)
  const commonPasswords = [
    'password', 'password1', '12345678', 'qwerty', 'abc12345',
    'monkey', 'letmein', 'trustno1', 'dragon', 'baseball'
  ];

  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Password is too common. Please choose a more unique password.');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Check if password has been used recently
 */
export const checkPasswordHistory = async (userId, newPassword) => {
  const db = getDatabase();

  // Get recent password hashes
  const history = db.prepare(`
    SELECT password_hash FROM password_history
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, PASSWORD_HISTORY_COUNT);

  // Also check current password
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (user) {
    history.unshift({ password_hash: user.password_hash });
  }

  // Check if new password matches any historical password
  for (const entry of history) {
    const matches = await bcrypt.compare(newPassword, entry.password_hash);
    if (matches) {
      return {
        isReused: true,
        message: `Password has been used recently. Please choose a password you haven't used in your last ${PASSWORD_HISTORY_COUNT} passwords.`
      };
    }
  }

  return { isReused: false };
};

/**
 * Add password to history
 */
export const addToPasswordHistory = (userId, passwordHash) => {
  const db = getDatabase();

  // Add new entry
  db.prepare(`
    INSERT INTO password_history (id, user_id, password_hash)
    VALUES (?, ?, ?)
  `).run(uuidv4(), userId, passwordHash);

  // Clean up old entries (keep only last N)
  db.prepare(`
    DELETE FROM password_history
    WHERE user_id = ? AND id NOT IN (
      SELECT id FROM password_history
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    )
  `).run(userId, userId, PASSWORD_HISTORY_COUNT);

  logger.info('Password added to history', { userId });
};

/**
 * Hash password with bcrypt
 */
export const hashPassword = async (password) => {
  return bcrypt.hash(password, config.security.bcryptRounds);
};

/**
 * Verify password against hash
 */
export const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Full password change flow with validation and history check
 */
export const changePassword = async (userId, currentPassword, newPassword) => {
  const db = getDatabase();

  // Get user
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
  if (!user) {
    throw new Error('User not found');
  }

  // Verify current password
  const validCurrent = await bcrypt.compare(currentPassword, user.password_hash);
  if (!validCurrent) {
    return {
      success: false,
      error: 'Current password is incorrect'
    };
  }

  // Validate new password complexity
  const complexity = validatePasswordComplexity(newPassword);
  if (!complexity.isValid) {
    return {
      success: false,
      error: complexity.errors[0],
      errors: complexity.errors
    };
  }

  // Check password history
  const historyCheck = await checkPasswordHistory(userId, newPassword);
  if (historyCheck.isReused) {
    return {
      success: false,
      error: historyCheck.message
    };
  }

  // Hash and update password
  const newHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);

  // Save current password to history before updating
  addToPasswordHistory(userId, user.password_hash);

  // Update user's password
  db.prepare(`
    UPDATE users SET password_hash = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newHash, userId);

  return { success: true };
};

export default {
  validatePasswordComplexity,
  checkPasswordHistory,
  addToPasswordHistory,
  hashPassword,
  verifyPassword,
  changePassword
};
