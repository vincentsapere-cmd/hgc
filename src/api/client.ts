/**
 * API Client - Centralized HTTP client for backend communication
 */

// Use relative URL for Vite proxy in development, or full URL in production
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
}

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    // Try to restore token from localStorage
    this.accessToken = localStorage.getItem('accessToken');
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
    if (token) {
      localStorage.setItem('accessToken', token);
    } else {
      localStorage.removeItem('accessToken');
    }
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const { method = 'GET', body, headers = {} } = options;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (this.accessToken) {
      requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'include', // Include cookies for refresh tokens
      });

      const data = await response.json();

      // Handle token expiration
      if (response.status === 401 && data.error === 'Token expired') {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          // Retry the request with new token
          requestHeaders['Authorization'] = `Bearer ${this.accessToken}`;
          const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: requestHeaders,
            body: body ? JSON.stringify(body) : undefined,
            credentials: 'include',
          });
          return retryResponse.json();
        }
      }

      return data;
    } catch (error) {
      console.error('API request failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error',
      };
    }
  }

  private async refreshToken(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.tokens) {
          this.setAccessToken(data.tokens.accessToken);
          return true;
        }
      }

      // Refresh failed, clear token
      this.setAccessToken(null);
      return false;
    } catch {
      this.setAccessToken(null);
      return false;
    }
  }

  // ==========================================================================
  // AUTH ENDPOINTS
  // ==========================================================================

  async login(email: string, password: string, twoFactorCode?: string) {
    const response = await this.request<{
      user: any;
      tokens: { accessToken: string; refreshToken: string };
      requiresTwoFactor?: boolean;
    }>('/auth/login', {
      method: 'POST',
      body: { email, password, twoFactorCode },
    });

    if (response.success && response.data?.tokens) {
      this.setAccessToken(response.data.tokens.accessToken);
    }

    return response;
  }

  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) {
    const response = await this.request<{
      user: any;
      tokens: { accessToken: string; refreshToken: string };
    }>('/auth/register', {
      method: 'POST',
      body: data,
    });

    if (response.success && response.data?.tokens) {
      this.setAccessToken(response.data.tokens.accessToken);
    }

    return response;
  }

  async logout() {
    const response = await this.request('/auth/logout', { method: 'POST' });
    this.setAccessToken(null);
    return response;
  }

  async getCurrentUser() {
    return this.request<{ user: any }>('/auth/me');
  }

  async forgotPassword(email: string) {
    return this.request('/auth/forgot-password', {
      method: 'POST',
      body: { email },
    });
  }

  async resetPassword(token: string, password: string) {
    return this.request('/auth/reset-password', {
      method: 'POST',
      body: { token, password },
    });
  }

  // ==========================================================================
  // PRODUCT ENDPOINTS
  // ==========================================================================

  async getProducts(params?: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
    featured?: boolean;
    sort?: string;
    order?: 'asc' | 'desc';
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, String(value));
      });
    }
    const query = queryParams.toString();
    return this.request<any[]>(`/products${query ? `?${query}` : ''}`);
  }

  async getProduct(idOrSlug: string) {
    return this.request<any>(`/products/${idOrSlug}`);
  }

  async getCategories() {
    return this.request<any[]>('/products/categories');
  }

  async getFeaturedProducts(limit = 8) {
    return this.request<any[]>(`/products/featured?limit=${limit}`);
  }

  // ==========================================================================
  // CART ENDPOINTS
  // ==========================================================================

  async getCart() {
    return this.request<{ items: any[]; totals: any }>('/cart');
  }

  async addToCart(productId: string, quantity: number, variationId?: string) {
    return this.request('/cart/items', {
      method: 'POST',
      body: { productId, quantity, variationId },
    });
  }

  async updateCartItem(itemId: string, quantity: number) {
    return this.request(`/cart/items/${itemId}`, {
      method: 'PATCH',
      body: { quantity },
    });
  }

  async removeCartItem(itemId: string) {
    return this.request(`/cart/items/${itemId}`, {
      method: 'DELETE',
    });
  }

  async clearCart() {
    return this.request('/cart', { method: 'DELETE' });
  }

  // ==========================================================================
  // ORDER ENDPOINTS
  // ==========================================================================

  async createOrder(orderData: {
    items: Array<{ productId: string; quantity: number; variationId?: string }>;
    shippingAddress: {
      firstName: string;
      lastName: string;
      line1: string;
      line2?: string;
      city: string;
      state: string;
      zip: string;
    };
    email: string;
    phone?: string;
    couponCode?: string;
    giftCardCode?: string;
    customerNotes?: string;
  }) {
    return this.request<{
      orderId: string;
      orderNumber: string;
      total: number;
      subtotal: number;
      shipping: number;
      tax: number;
      discount: number;
    }>('/orders', {
      method: 'POST',
      body: orderData,
    });
  }

  async getOrders(page = 1, limit = 10) {
    return this.request<any[]>(`/orders?page=${page}&limit=${limit}`);
  }

  async getOrder(idOrNumber: string) {
    return this.request<any>(`/orders/${idOrNumber}`);
  }

  // ==========================================================================
  // PAYMENT ENDPOINTS
  // ==========================================================================

  async getPaymentConfig() {
    return this.request<{ paypal: { clientId: string; mode: string } }>('/payments/config');
  }

  async createPayPalOrder(orderId: string) {
    return this.request<{ paypalOrderId: string; status: string }>('/payments/paypal/create-order', {
      method: 'POST',
      body: { orderId },
    });
  }

  async capturePayPalOrder(paypalOrderId: string, internalOrderId: string) {
    return this.request<{
      orderId: string;
      orderNumber: string;
      status: string;
      captureId: string;
      amount: number;
    }>('/payments/paypal/capture', {
      method: 'POST',
      body: { orderId: paypalOrderId, internalOrderId },
    });
  }

  async validateGiftCard(code: string) {
    return this.request<{ code: string; balance: number; expiresAt?: string }>(
      '/payments/gift-card/validate',
      {
        method: 'POST',
        body: { code },
      }
    );
  }

  async validateCoupon(code: string, subtotal: number) {
    return this.request<{
      code: string;
      type: string;
      value: number;
      discount: number;
    }>('/payments/coupon/validate', {
      method: 'POST',
      body: { code, subtotal },
    });
  }

  // ==========================================================================
  // ADMIN ENDPOINTS
  // ==========================================================================

  async getAdminDashboard() {
    return this.request<any>('/admin/dashboard');
  }

  async getAdminProducts(params?: { page?: number; limit?: number; search?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, String(value));
      });
    }
    const query = queryParams.toString();
    return this.request<any[]>(`/admin/products${query ? `?${query}` : ''}`);
  }

  async createProduct(data: any) {
    return this.request('/admin/products', {
      method: 'POST',
      body: data,
    });
  }

  async updateProduct(id: string, data: any) {
    return this.request(`/admin/products/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  async toggleProductStatus(id: string) {
    return this.request(`/admin/products/${id}/toggle-status`, {
      method: 'PATCH',
    });
  }

  async getAdminOrders(params?: { page?: number; limit?: number; status?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, String(value));
      });
    }
    const query = queryParams.toString();
    return this.request<any[]>(`/admin/orders${query ? `?${query}` : ''}`);
  }

  async updateOrderStatus(orderId: string, status: string, notes?: string) {
    return this.request(`/admin/orders/${orderId}/status`, {
      method: 'PATCH',
      body: { status, notes },
    });
  }

  async getAdminUsers(params?: { page?: number; limit?: number; role?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, String(value));
      });
    }
    const query = queryParams.toString();
    return this.request<any[]>(`/admin/users${query ? `?${query}` : ''}`);
  }

  async getAdminReports(type: 'sales' | 'products' | 'customers' | 'inventory', params?: any) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, String(value));
      });
    }
    const query = queryParams.toString();
    return this.request<any>(`/admin/reports/${type}${query ? `?${query}` : ''}`);
  }

  async getAdminSettings() {
    return this.request<any>('/admin/settings');
  }

  async updateAdminSettings(settings: Record<string, any>) {
    return this.request('/admin/settings', {
      method: 'PUT',
      body: settings,
    });
  }

  // ==========================================================================
  // USER ENDPOINTS
  // ==========================================================================

  async updateProfile(data: { firstName?: string; lastName?: string; phone?: string }) {
    return this.request('/users/profile', {
      method: 'PUT',
      body: data,
    });
  }

  async changePassword(currentPassword: string, newPassword: string) {
    return this.request('/users/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  }

  async getAddresses() {
    return this.request<any[]>('/users/addresses');
  }

  async addAddress(address: any) {
    return this.request('/users/addresses', {
      method: 'POST',
      body: address,
    });
  }

  async getWishlist() {
    return this.request<any[]>('/users/wishlist');
  }

  async addToWishlist(productId: string) {
    return this.request('/users/wishlist', {
      method: 'POST',
      body: { productId },
    });
  }

  async removeFromWishlist(productId: string) {
    return this.request(`/users/wishlist/${productId}`, {
      method: 'DELETE',
    });
  }
}

// Export singleton instance
export const api = new ApiClient(API_BASE_URL);
export default api;
