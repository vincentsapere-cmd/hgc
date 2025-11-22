/**
 * API Routes Index
 * Central routing configuration
 */

import express from 'express';
import authRoutes from './auth.js';
import productRoutes from './products.js';
import orderRoutes from './orders.js';
import paymentRoutes from './payments.js';
import cartRoutes from './cart.js';
import userRoutes from './users.js';
import adminRoutes from './admin/index.js';
import webhookRoutes from './webhooks.js';
import settingsRoutes from './settings.js';

const router = express.Router();

// Public routes
router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/cart', cartRoutes);
router.use('/settings', settingsRoutes);

// Protected routes
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);
router.use('/users', userRoutes);

// Admin routes
router.use('/admin', adminRoutes);

// Webhooks (special handling)
router.use('/webhooks', webhookRoutes);

// API Info
router.get('/', (req, res) => {
  res.json({
    name: 'Home Grown Creations API',
    version: '1.0.0',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

export default router;
