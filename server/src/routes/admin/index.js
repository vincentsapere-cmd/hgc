/**
 * Admin Routes Index
 * Full admin suite for e-commerce management
 */

import express from 'express';
import { authenticate, requireAdmin, requireSuperAdmin } from '../../middleware/auth.js';
import { adminIpAllowlist } from '../../middleware/ipAllowlist.js';
import dashboardRoutes from './dashboard.js';
import productsRoutes from './products.js';
import ordersRoutes from './orders.js';
import usersRoutes from './users.js';
import couponsRoutes from './coupons.js';
import giftCardsRoutes from './giftCards.js';
import settingsRoutes from './settings.js';
import reportsRoutes from './reports.js';
import uploadsRoutes from './uploads.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// IP allowlist check for admin routes (configurable via ADMIN_IP_ALLOWLIST env var)
router.use(adminIpAllowlist);

// Admin sub-routes
router.use('/dashboard', dashboardRoutes);
router.use('/products', productsRoutes);
router.use('/orders', ordersRoutes);
router.use('/users', usersRoutes);
router.use('/coupons', couponsRoutes);
router.use('/gift-cards', giftCardsRoutes);
router.use('/settings', settingsRoutes);
router.use('/reports', reportsRoutes);
router.use('/uploads', uploadsRoutes);

export default router;
