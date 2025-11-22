export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  mg: number;
  description?: string;
  image?: string;
  isActive: boolean;
  hasVariations?: boolean;
  variations?: string[];
  unit?: string; // e.g., "22g", "1/4 cup"
}

export interface CartItem extends Product {
  quantity: number;
  selectedVariation?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface Order {
  id: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  };
  items: CartItem[];
  subtotal: number;
  shippingFee: number;
  discount: number;
  total: number;
  status: 'pending' | 'paid' | 'shipped' | 'cancelled';
  paymentMethod: 'paypal' | 'card';
  paypalTransactionId?: string;
  paypalPayerId?: string;
  giftCardCode?: string;
  date: string;
}

export interface GiftCard {
  code: string;
  balance: number;
  isActive: boolean;
}

export enum ViewState {
  HOME = 'HOME',
  SHOP = 'SHOP',
  CHECKOUT = 'CHECKOUT',
  SUCCESS = 'SUCCESS',
  ADMIN_DASHBOARD = 'ADMIN_DASHBOARD',
  ADMIN_PRODUCTS = 'ADMIN_PRODUCTS',
  ADMIN_ORDERS = 'ADMIN_ORDERS',
  LOGIN = 'LOGIN'
}

export interface DashboardStats {
  totalRevenue: number;
  totalOrders: number;
  averageOrderValue: number;
  topSellingItem: string;
}