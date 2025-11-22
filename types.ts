export interface Product {
  id: string;
  sku: string;
  name: string;
  slug: string;
  category: string;
  categoryId?: string;
  categorySlug?: string;
  price: number;
  compareAtPrice?: number;
  mg: number;
  description?: string;
  shortDescription?: string;
  imageUrl?: string;
  image?: string; // Alias for compatibility
  images?: string[];
  isActive: boolean;
  isFeatured?: boolean;
  hasVariations?: boolean;
  variations?: ProductVariation[];
  unit?: string;
  inStock?: boolean;
  stockQuantity?: number;
}

export interface ProductVariation {
  id: string;
  name: string;
  sku: string;
  priceModifier?: number;
  stockQuantity?: number;
  imageUrl?: string;
}

export interface CartItem {
  id: string;
  cartItemId?: string;
  productId: string;
  variationId?: string;
  name: string;
  variationName?: string;
  selectedVariation?: string;
  price: number;
  quantity: number;
  imageUrl?: string;
  image?: string;
  mg?: number;
  unit?: string;
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: 'customer' | 'admin' | 'super_admin' | 'manager';
  status: string;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  customer: {
    name: string;
    firstName?: string;
    lastName?: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    zip: string;
    country?: string;
  };
  items: CartItem[];
  subtotal: number;
  shippingFee?: number;
  shipping?: number;
  discount?: number;
  tax?: number;
  giftCardAmount?: number;
  total: number;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | 'refunded' | 'paid';
  paymentStatus?: string;
  fulfillmentStatus?: string;
  paymentMethod?: 'paypal' | 'card' | 'gift_card';
  trackingNumber?: string;
  shippingCarrier?: string;
  paypalTransactionId?: string;
  paypalPayerId?: string;
  couponCode?: string;
  giftCardCode?: string;
  customerNotes?: string;
  date: string;
  createdAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
}

export interface GiftCard {
  code: string;
  balance: number;
  isActive: boolean;
  expiresAt?: string;
}

export interface Coupon {
  code: string;
  type: 'percentage' | 'fixed_amount' | 'free_shipping';
  value: number;
  discount: number;
  description?: string;
  minimumOrderAmount?: number;
}

export enum ViewState {
  HOME = 'HOME',
  SHOP = 'SHOP',
  CHECKOUT = 'CHECKOUT',
  SUCCESS = 'SUCCESS',
  LOGIN = 'LOGIN',
  REGISTER = 'REGISTER',
  ACCOUNT = 'ACCOUNT',
  ORDERS = 'ORDERS',
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD',
  ADMIN_PRODUCTS = 'ADMIN_PRODUCTS',
  ADMIN_ORDERS = 'ADMIN_ORDERS',
  ADMIN_USERS = 'ADMIN_USERS',
  ADMIN_SETTINGS = 'ADMIN_SETTINGS'
}

export interface DashboardStats {
  revenue: {
    today: number;
    week: number;
    month: number;
    total: number;
  };
  orders: {
    today: number;
    week: number;
    month: number;
    total: number;
    pending: number;
  };
  customers: {
    today: number;
    month: number;
    total: number;
  };
  averageOrderValue: number;
  lowStockProducts: number;
  topProducts: Array<{
    id: string;
    name: string;
    imageUrl?: string;
    totalSold: number;
    revenue: number;
  }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    customer: string;
    total: number;
    status: string;
    createdAt: string;
  }>;
  charts?: {
    salesByDay: Array<{ date: string; revenue: number; orders: number }>;
    salesByCategory: Array<{ category: string; revenue: number }>;
  };
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  isLoading: boolean;
}

export interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  duration?: number;
}
