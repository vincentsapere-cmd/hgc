/**
 * Authentication Routes
 * Complete auth system with JWT, 2FA, and session management
 */

import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { config } from '../config/index.js';
import { getDatabase } from '../database/init.js';
import { generateTokens, authenticate } from '../middleware/auth.js';
import { registerValidation, loginValidation, passwordResetValidation, passwordUpdateValidation } from '../middleware/validators.js';
import { ValidationError, AuthenticationError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { logger, logSecurityEvent } from '../utils/logger.js';
import { emailService } from '../services/email.js';

const router = express.Router();

/**
 * POST /auth/register
 * Create new user account
 */
router.post('/register', registerValidation, async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone } = req.body;
    const db = getDatabase();

    // Check if email exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existingUser) {
      throw new ConflictError('An account with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    // Create user
    const userId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone,
        email_verification_token, email_verification_expires, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_verification')
    `).run(userId, email.toLowerCase(), passwordHash, firstName, lastName, phone || null,
      verificationToken, verificationExpires);

    // Generate tokens
    const tokens = generateTokens(userId);

    // Create session
    const sessionId = uuidv4();
    const refreshTokenHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO user_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, userId, refreshTokenHash, req.ip, req.get('User-Agent'), expiresAt);

    // Send welcome email
    await emailService.sendWelcome({ email, first_name: firstName, last_name: lastName });

    logSecurityEvent('user_registered', { userId, email, ip: req.ip });

    // Set cookies
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      user: {
        id: userId,
        email,
        firstName,
        lastName,
        role: 'customer'
      },
      tokens
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/login
 * Authenticate user
 */
router.post('/login', loginValidation, async (req, res, next) => {
  try {
    const { email, password, twoFactorCode } = req.body;
    const db = getDatabase();

    // Get user
    const user = db.prepare(`
      SELECT id, email, password_hash, first_name, last_name, role, status,
        two_factor_enabled, two_factor_secret, login_attempts, locked_until
      FROM users WHERE email = ?
    `).get(email.toLowerCase());

    if (!user) {
      logSecurityEvent('login_failed_unknown_email', { email, ip: req.ip });
      throw new AuthenticationError('Invalid email or password');
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
      throw new AuthenticationError(`Account locked. Try again in ${remainingMinutes} minutes.`);
    }

    // Check account status
    if (user.status === 'suspended') {
      logSecurityEvent('login_attempt_suspended_account', { userId: user.id, ip: req.ip });
      throw new AuthenticationError('Account has been suspended');
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      // Increment login attempts
      const attempts = (user.login_attempts || 0) + 1;
      let lockUntil = null;

      if (attempts >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // Lock for 15 minutes
        logSecurityEvent('account_locked', { userId: user.id, attempts, ip: req.ip });
      }

      db.prepare(`
        UPDATE users SET login_attempts = ?, locked_until = ? WHERE id = ?
      `).run(attempts, lockUntil, user.id);

      logSecurityEvent('login_failed_wrong_password', { userId: user.id, attempts, ip: req.ip });
      throw new AuthenticationError('Invalid email or password');
    }

    // Check 2FA if enabled
    if (user.two_factor_enabled) {
      if (!twoFactorCode) {
        return res.json({
          success: true,
          requiresTwoFactor: true,
          message: 'Two-factor authentication required'
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.two_factor_secret,
        encoding: 'base32',
        token: twoFactorCode,
        window: 2
      });

      if (!verified) {
        logSecurityEvent('2fa_failed', { userId: user.id, ip: req.ip });
        throw new AuthenticationError('Invalid two-factor code');
      }
    }

    // Reset login attempts and update last login
    db.prepare(`
      UPDATE users SET login_attempts = 0, locked_until = NULL, last_login = datetime('now')
      WHERE id = ?
    `).run(user.id);

    // Generate tokens
    const tokens = generateTokens(user.id);

    // Create session
    const sessionId = uuidv4();
    const refreshTokenHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO user_sessions (id, user_id, refresh_token_hash, ip_address, user_agent, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sessionId, user.id, refreshTokenHash, req.ip, req.get('User-Agent'), expiresAt);

    logSecurityEvent('login_success', { userId: user.id, ip: req.ip });

    // Set cookies
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        role: user.role
      },
      tokens
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/logout
 * Logout user and invalidate session
 */
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const db = getDatabase();

    // Delete all sessions for user (or just current one)
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(req.user.id);

    // Clear cookies
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');

    logSecurityEvent('logout', { userId: req.user.id, ip: req.ip });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/refresh
 * Refresh access token
 */
router.post('/refresh', async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      throw new AuthenticationError('Refresh token required');
    }

    const db = getDatabase();
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');

    // Find valid session
    const session = db.prepare(`
      SELECT s.*, u.id as user_id, u.email, u.first_name, u.last_name, u.role, u.status
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.refresh_token_hash = ? AND s.expires_at > datetime('now')
    `).get(tokenHash);

    if (!session) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    if (session.status !== 'active') {
      throw new AuthenticationError('Account is not active');
    }

    // Generate new tokens
    const tokens = generateTokens(session.user_id);

    // Update session with new refresh token
    const newTokenHash = crypto.createHash('sha256').update(tokens.refreshToken).digest('hex');
    db.prepare(`
      UPDATE user_sessions SET refresh_token_hash = ?, last_used = datetime('now')
      WHERE id = ?
    `).run(newTokenHash, session.id);

    // Set cookies
    res.cookie('accessToken', tokens.accessToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      tokens
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/forgot-password
 * Request password reset
 */
router.post('/forgot-password', passwordResetValidation, async (req, res, next) => {
  try {
    const { email } = req.body;
    const db = getDatabase();

    const user = db.prepare('SELECT id, email, first_name, last_name FROM users WHERE email = ?')
      .get(email.toLowerCase());

    // Always return success (don't reveal if email exists)
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

      db.prepare(`
        UPDATE users SET password_reset_token = ?, password_reset_expires = ?
        WHERE id = ?
      `).run(resetToken, resetExpires, user.id);

      await emailService.sendPasswordReset(user, resetToken);
      logSecurityEvent('password_reset_requested', { userId: user.id, ip: req.ip });
    }

    res.json({
      success: true,
      message: 'If an account with that email exists, we sent a password reset link.'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/reset-password
 * Reset password with token
 */
router.post('/reset-password', passwordUpdateValidation, async (req, res, next) => {
  try {
    const { token, password } = req.body;
    const db = getDatabase();

    const user = db.prepare(`
      SELECT id FROM users
      WHERE password_reset_token = ? AND password_reset_expires > datetime('now')
    `).get(token);

    if (!user) {
      throw new ValidationError('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(password, config.security.bcryptRounds);

    db.prepare(`
      UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL
      WHERE id = ?
    `).run(passwordHash, user.id);

    // Invalidate all sessions
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);

    logSecurityEvent('password_reset_completed', { userId: user.id, ip: req.ip });

    res.json({
      success: true,
      message: 'Password reset successfully. Please log in with your new password.'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * GET /auth/me
 * Get current user info
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const db = getDatabase();

    const user = db.prepare(`
      SELECT id, email, first_name, last_name, phone, role, status,
        email_verified, two_factor_enabled, created_at, last_login
      FROM users WHERE id = ?
    `).get(req.user.id);

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        emailVerified: !!user.email_verified,
        twoFactorEnabled: !!user.two_factor_enabled,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/2fa/setup
 * Setup two-factor authentication
 */
router.post('/2fa/setup', authenticate, async (req, res, next) => {
  try {
    const secret = speakeasy.generateSecret({
      name: `${config.twoFactor.issuer}:${req.user.email}`,
      issuer: config.twoFactor.issuer
    });

    // Generate QR code
    const qrCode = await QRCode.toDataURL(secret.otpauth_url);

    res.json({
      success: true,
      secret: secret.base32,
      qrCode
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/2fa/verify
 * Verify and enable two-factor authentication
 */
router.post('/2fa/verify', authenticate, async (req, res, next) => {
  try {
    const { secret, code } = req.body;

    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: code,
      window: 2
    });

    if (!verified) {
      throw new ValidationError('Invalid verification code');
    }

    const db = getDatabase();
    db.prepare(`
      UPDATE users SET two_factor_enabled = 1, two_factor_secret = ?
      WHERE id = ?
    `).run(secret, req.user.id);

    logSecurityEvent('2fa_enabled', { userId: req.user.id, ip: req.ip });

    res.json({
      success: true,
      message: 'Two-factor authentication enabled'
    });

  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/2fa/disable
 * Disable two-factor authentication
 */
router.post('/2fa/disable', authenticate, async (req, res, next) => {
  try {
    const { password, code } = req.body;
    const db = getDatabase();

    const user = db.prepare('SELECT password_hash, two_factor_secret FROM users WHERE id = ?')
      .get(req.user.id);

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      throw new AuthenticationError('Invalid password');
    }

    // Verify 2FA code
    const verified = speakeasy.totp.verify({
      secret: user.two_factor_secret,
      encoding: 'base32',
      token: code,
      window: 2
    });

    if (!verified) {
      throw new ValidationError('Invalid two-factor code');
    }

    db.prepare(`
      UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL
      WHERE id = ?
    `).run(req.user.id);

    logSecurityEvent('2fa_disabled', { userId: req.user.id, ip: req.ip });

    res.json({
      success: true,
      message: 'Two-factor authentication disabled'
    });

  } catch (error) {
    next(error);
  }
});

export default router;
