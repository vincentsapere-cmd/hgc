import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Product, CartItem, ViewState, Order, User, DashboardStats, GiftCard, Coupon } from './types';
import { api } from './src/api/client';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

// --- Types for Window PayPal ---
declare global {
  interface Window {
    paypal: any;
  }
}

// --- Helpers ---
const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const parseError = (err: any): string => {
  if (!err) return "Unknown error";
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (err.error) return err.error;
  if (err.message) return err.message;
  return "An unexpected error occurred.";
};

// --- Components ---

const LoadingSpinner = () => (
  <div className="flex items-center justify-center p-8">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-green"></div>
  </div>
);

const Notification = ({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) => (
  <div className={`fixed top-4 right-4 z-[3000] p-4 rounded-lg shadow-lg max-w-sm animate-fade-in ${
    type === 'success' ? 'bg-green-500 text-white' :
    type === 'error' ? 'bg-red-500 text-white' :
    'bg-blue-500 text-white'
  }`}>
    <div className="flex items-center justify-between gap-4">
      <span>{message}</span>
      <button onClick={onClose} className="text-white hover:opacity-75">x</button>
    </div>
  </div>
);

const AgeVerificationModal = ({ onVerify }: { onVerify: () => void }) => (
  <div className="fixed inset-0 bg-black bg-opacity-90 z-[2000] flex items-center justify-center p-4">
    <div className="bg-gradient-to-br from-brand-green to-brand-lightGreen p-8 rounded-xl text-center max-w-md w-full border-2 border-brand-gold shadow-2xl">
      <img src="https://homegrowncreations.thepfps.xyz/imgs/o84h_vDe_400x400.gif" alt="Logo" className="w-32 h-32 mx-auto mb-6 rounded-full border-4 border-brand-gold object-cover" onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/150')} />
      <h2 className="text-3xl font-brand text-white mb-4">Age Verification</h2>
      <p className="text-white mb-8 text-lg">You must be 21 or older to enter this site. Are you 21+?</p>
      <div className="flex gap-4 justify-center">
        <button onClick={onVerify} className="bg-brand-gold hover:bg-brand-lime text-brand-green font-bold py-3 px-8 rounded-lg transition duration-200 shadow-lg">
          Yes, I am 21+
        </button>
        <button onClick={() => window.location.href = 'https://google.com'} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-8 rounded-lg transition duration-200">
          No, Exit
        </button>
      </div>
    </div>
  </div>
);

const AuthModal = ({
  mode,
  onSuccess,
  onCancel,
  onSwitchMode
}: {
  mode: 'login' | 'register';
  onSuccess: (user: User) => void;
  onCancel: () => void;
  onSwitchMode: () => void;
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const response = await api.login(email, password, requiresTwoFactor ? twoFactorCode : undefined);

        if (response.success) {
          if (response.data?.requiresTwoFactor) {
            setRequiresTwoFactor(true);
            setLoading(false);
            return;
          }
          if (response.data?.user) {
            onSuccess(response.data.user);
          }
        } else {
          setError(response.error || 'Login failed');
        }
      } else {
        const response = await api.register({ email, password, firstName, lastName, phone });

        if (response.success && response.data?.user) {
          onSuccess(response.data.user);
        } else {
          setError(response.error || 'Registration failed');
        }
      }
    } catch (err) {
      setError(parseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 z-[1500] flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md relative">
        <button onClick={onCancel} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800">x</button>
        <h2 className="text-2xl font-brand text-brand-green mb-6 text-center">
          {mode === 'login' ? 'Sign In' : 'Create Account'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">First Name</label>
                <input
                  type="text"
                  required
                  className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Last Name</label>
                <input
                  type="text"
                  required
                  className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus={mode === 'login'}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              minLength={8}
              className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {mode === 'register' && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Phone (Optional)</label>
              <input
                type="tel"
                className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          )}
          {requiresTwoFactor && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Two-Factor Code</label>
              <input
                type="text"
                required
                maxLength={6}
                className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                placeholder="Enter 6-digit code"
              />
            </div>
          )}
          {error && <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-green text-white font-bold py-3 rounded hover:bg-brand-lightGreen transition shadow-md disabled:opacity-50"
          >
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        <div className="text-center mt-4">
          <button onClick={onSwitchMode} className="text-brand-green hover:underline text-sm">
            {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
};

const PayPalButtonWrapper = React.memo(({
  orderId,
  total,
  onSuccess,
  disabled
}: {
  orderId: string;
  total: number;
  onSuccess: (details: any) => void;
  disabled: boolean;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const orderIdRef = useRef(orderId);
  const onSuccessRef = useRef(onSuccess);
  const isRenderedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { orderIdRef.current = orderId; }, [orderId]);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  useEffect(() => {
    if (disabled || isRenderedRef.current) return;

    let isCancelled = false;

    const initializePayPal = async () => {
      let attempts = 0;
      while (!window.paypal && attempts < 50) {
        if (isCancelled) return;
        await new Promise(r => setTimeout(r, 100));
        attempts++;
      }

      if (!window.paypal?.Buttons) {
        if (!isCancelled) setError("Payment system failed to load. Please refresh.");
        return;
      }

      try {
        if (!containerRef.current || isCancelled) return;
        containerRef.current.innerHTML = "";

        await window.paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'pay' },

          createOrder: async () => {
            try {
              const response = await api.createPayPalOrder(orderIdRef.current);
              if (response.success && response.data?.paypalOrderId) {
                return response.data.paypalOrderId;
              }
              throw new Error(response.error || 'Failed to create PayPal order');
            } catch (err) {
              setError(parseError(err));
              throw err;
            }
          },

          onApprove: async (data: any) => {
            try {
              const response = await api.capturePayPalOrder(data.orderID, orderIdRef.current);
              if (response.success) {
                onSuccessRef.current(response.data);
              } else {
                throw new Error(response.error || 'Payment capture failed');
              }
            } catch (err) {
              setError(parseError(err));
            }
          },

          onError: (err: any) => {
            const msg = parseError(err);
            if (msg && !isCancelled) setError(msg);
          }
        }).render(containerRef.current);

        isRenderedRef.current = true;
        setLoading(false);
      } catch (err) {
        console.error("PayPal Render Error:", err);
        setLoading(false);
      }
    };

    initializePayPal();

    return () => {
      isCancelled = true;
      isRenderedRef.current = false;
    };
  }, [disabled]);

  if (disabled) return null;

  return (
    <div className="w-full mt-4">
      {loading && <div className="text-center text-gray-500 py-4">Loading payment options...</div>}
      <div ref={containerRef} className="w-full z-0 relative" style={{ minHeight: loading ? '0' : '150px' }}></div>
      {error && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded">
          {error}
        </div>
      )}
    </div>
  );
});

const Navbar = ({
  cartCount,
  onViewChange,
  user,
  onAuthClick,
  onLogout
}: {
  cartCount: number;
  onViewChange: (v: ViewState) => void;
  user: User | null;
  onAuthClick: () => void;
  onLogout: () => void;
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  return (
    <header className="sticky top-0 bg-white shadow-md z-[1000] border-b-4 border-brand-green">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center cursor-pointer" onClick={() => onViewChange(ViewState.HOME)}>
          <div className="w-12 h-12 rounded-full bg-brand-green mr-3 flex items-center justify-center text-brand-gold font-bold border-2 border-brand-gold overflow-hidden">
            <img src="https://homegrowncreations.thepfps.xyz/imgs/o84h_vDe_400x400.gif" className="w-full h-full object-cover" alt="HG" onError={(e) => e.currentTarget.style.display = 'none'} />
          </div>
          <h1 className="text-2xl text-brand-green font-brand hidden sm:block">Home Grown Creations</h1>
        </div>

        <nav className="hidden md:flex items-center space-x-6">
          <button onClick={() => onViewChange(ViewState.HOME)} className="text-brand-green hover:text-brand-lime font-semibold">Home</button>
          <button onClick={() => onViewChange(ViewState.SHOP)} className="text-brand-green hover:text-brand-lime font-semibold">Shop</button>

          {user ? (
            <>
              {isAdmin && (
                <button onClick={() => onViewChange(ViewState.ADMIN_DASHBOARD)} className="text-red-600 hover:text-red-800 font-semibold border border-red-200 px-3 py-1 rounded bg-red-50">Dashboard</button>
              )}
              <div className="relative group">
                <button className="text-brand-green hover:text-brand-lime font-semibold">
                  Hi, {user.firstName}
                </button>
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg py-2 hidden group-hover:block">
                  <button onClick={() => onViewChange(ViewState.ORDERS)} className="block w-full text-left px-4 py-2 hover:bg-gray-100">My Orders</button>
                  <button onClick={onLogout} className="block w-full text-left px-4 py-2 hover:bg-gray-100 text-red-600">Sign Out</button>
                </div>
              </div>
            </>
          ) : (
            <button onClick={onAuthClick} className="text-brand-green hover:text-brand-lime font-semibold">Sign In</button>
          )}

          <button onClick={() => onViewChange(ViewState.CHECKOUT)} className="relative bg-brand-gold hover:bg-brand-lime text-brand-green font-bold py-2 px-4 rounded transition shadow-sm flex items-center gap-2">
            <i className="fas fa-shopping-cart"></i>
            <span>Cart ({cartCount})</span>
          </button>
        </nav>

        <button className="md:hidden text-brand-green text-2xl" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? 'x' : '='}
        </button>
      </div>

      {isMobileMenuOpen && (
        <nav className="md:hidden bg-brand-offWhite p-4 flex flex-col space-y-3 border-t shadow-inner">
          <button onClick={() => { onViewChange(ViewState.HOME); setIsMobileMenuOpen(false); }} className="text-left text-brand-green font-semibold p-2 hover:bg-gray-100 rounded">Home</button>
          <button onClick={() => { onViewChange(ViewState.SHOP); setIsMobileMenuOpen(false); }} className="text-left text-brand-green font-semibold p-2 hover:bg-gray-100 rounded">Shop</button>
          {user ? (
            <>
              {isAdmin && (
                <button onClick={() => { onViewChange(ViewState.ADMIN_DASHBOARD); setIsMobileMenuOpen(false); }} className="text-left text-red-600 font-semibold p-2 hover:bg-gray-100 rounded">Dashboard</button>
              )}
              <button onClick={() => { onViewChange(ViewState.ORDERS); setIsMobileMenuOpen(false); }} className="text-left text-brand-green font-semibold p-2 hover:bg-gray-100 rounded">My Orders</button>
              <button onClick={() => { onLogout(); setIsMobileMenuOpen(false); }} className="text-left text-red-600 font-semibold p-2 hover:bg-gray-100 rounded">Sign Out</button>
            </>
          ) : (
            <button onClick={() => { onAuthClick(); setIsMobileMenuOpen(false); }} className="text-left text-brand-green font-semibold p-2">Sign In</button>
          )}
          <button onClick={() => { onViewChange(ViewState.CHECKOUT); setIsMobileMenuOpen(false); }} className="text-left bg-brand-gold text-brand-green font-bold py-2 px-4 rounded w-full mt-2">
            View Cart ({cartCount})
          </button>
        </nav>
      )}
    </header>
  );
};

const Hero = ({ onShopNow }: { onShopNow: () => void }) => (
  <div className="bg-gradient-to-br from-brand-green to-brand-lightGreen text-white py-20 px-4 text-center relative overflow-hidden">
    <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
    <div className="max-w-4xl mx-auto relative z-10">
      <h1 className="text-5xl md:text-7xl mb-6 drop-shadow-lg font-brand tracking-wide">Elevate Your Sweets</h1>
      <p className="text-xl md:text-2xl mb-10 font-light max-w-2xl mx-auto">Handmade Cannabis Edibles crafted with passion and home-grown love.</p>

      <div className="flex justify-center gap-6 mb-12 flex-wrap">
        <div className="w-48 h-32 bg-white bg-opacity-20 rounded-lg shadow-xl backdrop-blur-sm flex items-center justify-center overflow-hidden transform hover:scale-105 transition duration-300">
          <img src="https://homegrowncreations.thepfps.xyz/imgs/GqTpE3TWwAArt6B.jpg" alt="Cookies" className="w-full h-full object-cover" onError={(e) => e.currentTarget.src='https://via.placeholder.com/200?text=Cookies'} />
        </div>
        <div className="w-48 h-32 bg-white bg-opacity-20 rounded-lg shadow-xl backdrop-blur-sm flex items-center justify-center overflow-hidden transform hover:scale-105 transition duration-300">
          <img src="https://homegrowncreations.thepfps.xyz/imgs/GqTpE0mWcAA2uoC.jpg" alt="Brownies" className="w-full h-full object-cover" onError={(e) => e.currentTarget.src='https://via.placeholder.com/200?text=Brownies'} />
        </div>
        <div className="w-48 h-32 bg-white bg-opacity-20 rounded-lg shadow-xl backdrop-blur-sm flex items-center justify-center overflow-hidden transform hover:scale-105 transition duration-300">
          <img src="https://homegrowncreations.thepfps.xyz/imgs/GqTpE1-XAAAWLRF.jpg" alt="Gummies" className="w-full h-full object-cover" onError={(e) => e.currentTarget.src='https://via.placeholder.com/200?text=Gummies'} />
        </div>
      </div>

      <button onClick={onShopNow} className="bg-brand-gold text-brand-green font-bold text-xl py-4 px-10 rounded-full shadow-xl hover:bg-brand-lime hover:scale-105 transition duration-300 flex items-center gap-3 mx-auto">
        <span>Shop Collection</span>
        <i className="fas fa-arrow-right"></i>
      </button>
    </div>
  </div>
);

const Footer = () => (
  <footer className="bg-brand-green text-white py-12 px-4 border-t-8 border-brand-gold">
    <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
      <div>
        <h3 className="text-2xl mb-4 text-brand-gold font-brand">Contact Us</h3>
        <p className="mb-2"><span className="inline-block w-6">@</span> <a href="mailto:info@homegrowncreations.com" className="hover:text-brand-lime">info@homegrowncreations.com</a></p>
        <p><span className="inline-block w-6">#</span> +1 (234) 567-890</p>
      </div>
      <div>
        <h3 className="text-2xl mb-4 text-brand-gold font-brand">Follow Us</h3>
        <div className="flex justify-center md:justify-start space-x-6 text-2xl">
          <span className="cursor-pointer hover:text-brand-lime transition transform hover:scale-110"><i className="fab fa-instagram"></i></span>
          <span className="cursor-pointer hover:text-brand-lime transition transform hover:scale-110"><i className="fab fa-twitter"></i></span>
          <span className="cursor-pointer hover:text-brand-lime transition transform hover:scale-110"><i className="fab fa-facebook"></i></span>
        </div>
      </div>
      <div>
        <h3 className="text-2xl mb-4 text-brand-gold font-brand">Legal</h3>
        <p className="text-sm text-gray-200 mb-2">Must be 21+ to purchase.</p>
        <p className="text-sm text-gray-200 mb-4">Consume responsibly.</p>
      </div>
    </div>
    <div className="text-center mt-8 text-xs text-gray-300 border-t border-green-800 pt-4">
      &copy; {new Date().getFullYear()} Home Grown Creations. All rights reserved.
    </div>
  </footer>
);

// --- Pages ---

const Shop = ({
  onAddToCart,
  showNotification
}: {
  onAddToCart: (productId: string, quantity: number, variationId?: string) => Promise<void>;
  showNotification: (msg: string, type: 'success' | 'error') => void;
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [activeCategory, setActiveCategory] = useState('All');
  const [variantSelections, setVariantSelections] = useState<{[key: string]: string}>({});
  const [loading, setLoading] = useState(true);
  const [addingToCart, setAddingToCart] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [productsRes, categoriesRes] = await Promise.all([
          api.getProducts({ limit: 100 }),
          api.getCategories()
        ]);

        if (productsRes.success && productsRes.data) {
          setProducts(productsRes.data.map((p: any) => ({
            ...p,
            image: p.imageUrl,
            category: p.category?.name || p.categoryName || 'Uncategorized',
            isActive: p.inStock !== false
          })));
        }

        if (categoriesRes.success && categoriesRes.data) {
          setCategories(['All', ...categoriesRes.data.map((c: any) => c.name)]);
        }
      } catch (err) {
        console.error('Failed to fetch products:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filteredProducts = useMemo(() => {
    return activeCategory === 'All'
      ? products
      : products.filter(p => p.category === activeCategory);
  }, [activeCategory, products]);

  const handleAddToCart = async (product: Product) => {
    if (product.hasVariations && product.variations?.length && !variantSelections[product.id]) {
      showNotification("Please select a flavor/variation before adding to cart.", 'error');
      return;
    }

    setAddingToCart(product.id);
    try {
      const variationId = product.variations?.find(v => v.name === variantSelections[product.id])?.id;
      await onAddToCart(product.id, 1, variationId);
      showNotification(`${product.name} added to cart!`, 'success');
    } catch (err) {
      showNotification(parseError(err), 'error');
    } finally {
      setAddingToCart(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen">
      <h2 className="text-4xl text-brand-green text-center mb-8 font-brand border-b-2 border-brand-lime inline-block mx-auto px-10 pb-2">Our Menu</h2>

      <div className="flex flex-wrap justify-center gap-2 mb-10 sticky top-20 z-10 bg-brand-offWhite py-2 shadow-sm md:shadow-none">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-5 py-2 rounded-full text-sm font-bold transition duration-200 shadow-sm ${
              activeCategory === cat
                ? 'bg-brand-green text-white transform scale-105'
                : 'bg-white text-gray-600 hover:bg-brand-lime hover:text-brand-green'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {filteredProducts.filter(p => p.isActive).map(product => (
          <div key={product.id} className="bg-white rounded-2xl shadow-md hover:shadow-2xl transition duration-300 flex flex-col overflow-hidden border border-gray-100 group">
            <div className="h-56 bg-gray-100 relative overflow-hidden">
              <img
                src={product.image || product.imageUrl || `https://via.placeholder.com/300x200?text=${encodeURIComponent(product.name)}`}
                alt={product.name}
                className="w-full h-full object-cover group-hover:scale-110 transition duration-700"
                onError={(e) => e.currentTarget.src='https://via.placeholder.com/300x200?text=No+Image'}
              />
              <div className="absolute top-3 right-3 bg-brand-gold text-brand-green font-bold text-xs px-3 py-1 rounded-full shadow-md">
                {product.mg}mg THC
              </div>
            </div>

            <div className="p-6 flex flex-col flex-grow">
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-lg text-gray-800 leading-tight">{product.name}</h3>
              </div>
              <p className="text-sm text-gray-500 mb-4 font-medium">{product.category} {product.unit && `| ${product.unit}`}</p>

              {product.description && <p className="text-sm text-gray-600 mb-4 line-clamp-2">{product.description}</p>}

              <div className="flex-grow"></div>

              {product.hasVariations && product.variations && product.variations.length > 0 && (
                <div className="mb-4">
                  <select
                    className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:border-brand-green focus:outline-none"
                    onChange={(e) => setVariantSelections(prev => ({...prev, [product.id]: e.target.value}))}
                    value={variantSelections[product.id] || ""}
                  >
                    <option value="" disabled>Select Flavor</option>
                    {product.variations.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                  </select>
                </div>
              )}

              <div className="flex justify-between items-center mt-2 pt-4 border-t border-gray-100">
                <span className="text-2xl font-bold text-brand-green">{formatCurrency(product.price)}</span>
                <button
                  onClick={() => handleAddToCart(product)}
                  disabled={addingToCart === product.id}
                  className="bg-brand-green text-white px-5 py-2.5 rounded-xl hover:bg-brand-lightGreen active:bg-brand-green transition shadow-md text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                >
                  {addingToCart === product.id ? 'Adding...' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Checkout = ({
  cart,
  updateQuantity,
  removeItem,
  shippingFee,
  onPlaceOrder,
  user,
  showNotification
}: {
  cart: CartItem[];
  updateQuantity: (itemId: string, quantity: number) => Promise<void>;
  removeItem: (itemId: string) => Promise<void>;
  shippingFee: number;
  onPlaceOrder: (orderData: any) => Promise<{ orderId: string; total: number } | null>;
  user: User | null;
  showNotification: (msg: string, type: 'success' | 'error') => void;
}) => {
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    address: '',
    city: '',
    state: '',
    zip: ''
  });
  const [couponCode, setCouponCode] = useState('');
  const [giftCardCode, setGiftCardCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [appliedGiftCard, setAppliedGiftCard] = useState<GiftCard | null>(null);
  const [couponError, setCouponError] = useState('');
  const [giftCardError, setGiftCardError] = useState('');
  const [createdOrder, setCreatedOrder] = useState<{ orderId: string; total: number } | null>(null);
  const [placingOrder, setPlacingOrder] = useState(false);

  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const couponDiscount = appliedCoupon?.discount || 0;
  const giftCardDiscount = appliedGiftCard ? Math.min(subtotal + shippingFee - couponDiscount, appliedGiftCard.balance) : 0;
  const total = Math.max(0, subtotal + shippingFee - couponDiscount - giftCardDiscount);

  const isFormValid = useMemo(() => {
    return Boolean(
      formData.firstName.trim().length > 0 &&
      formData.lastName.trim().length > 0 &&
      formData.email.includes('@') &&
      formData.address.trim().length > 5 &&
      formData.city && formData.state && formData.zip
    );
  }, [formData]);

  const handleCouponApply = async () => {
    setCouponError('');
    try {
      const response = await api.validateCoupon(couponCode, subtotal);
      if (response.success && response.data) {
        setAppliedCoupon(response.data);
        showNotification('Coupon applied!', 'success');
      } else {
        setCouponError(response.error || 'Invalid coupon');
      }
    } catch (err) {
      setCouponError(parseError(err));
    }
  };

  const handleGiftCardApply = async () => {
    setGiftCardError('');
    try {
      const response = await api.validateGiftCard(giftCardCode);
      if (response.success && response.data) {
        setAppliedGiftCard({
          code: response.data.code,
          balance: response.data.balance,
          isActive: true,
          expiresAt: response.data.expiresAt
        });
        showNotification('Gift card applied!', 'success');
      } else {
        setGiftCardError(response.error || 'Invalid gift card');
      }
    } catch (err) {
      setGiftCardError(parseError(err));
    }
  };

  const handleCreateOrder = async () => {
    if (!isFormValid) return;

    setPlacingOrder(true);
    try {
      const result = await onPlaceOrder({
        items: cart.map(item => ({
          productId: item.productId || item.id,
          quantity: item.quantity,
          variationId: item.variationId
        })),
        shippingAddress: {
          firstName: formData.firstName,
          lastName: formData.lastName,
          line1: formData.address,
          city: formData.city,
          state: formData.state,
          zip: formData.zip
        },
        email: formData.email,
        phone: formData.phone,
        couponCode: appliedCoupon?.code,
        giftCardCode: appliedGiftCard?.code
      });

      if (result) {
        setCreatedOrder(result);
      }
    } catch (err) {
      showNotification(parseError(err), 'error');
    } finally {
      setPlacingOrder(false);
    }
  };

  const handlePaymentSuccess = useCallback((details: any) => {
    showNotification('Payment successful!', 'success');
    window.location.href = '/?view=success&order=' + details.orderNumber;
  }, [showNotification]);

  if (cart.length === 0) {
    return (
      <div className="container mx-auto text-center py-32 px-4">
        <div className="text-6xl text-gray-300 mb-4"><i className="fas fa-shopping-basket"></i></div>
        <h3 className="text-2xl font-bold text-gray-600 mb-4">Your cart is empty.</h3>
        <p className="text-gray-500">Looks like you haven't added any treats yet.</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-6xl min-h-screen">
      <h2 className="text-3xl text-brand-green font-brand mb-10 text-center border-b-2 border-brand-gold pb-4 inline-block w-full">Secure Checkout</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        {/* Order Summary */}
        <div className="order-2 lg:order-1">
          <h3 className="text-xl font-bold mb-4 text-gray-800 flex items-center gap-2"><i className="fas fa-list"></i> Your Items</h3>
          <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100 space-y-6">
            <div className="max-h-96 overflow-y-auto pr-2 space-y-4">
              {cart.map((item) => (
                <div key={item.cartItemId || `${item.id}-${item.variationId}`} className="flex justify-between items-center border-b border-gray-100 pb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-gray-100 rounded-md overflow-hidden">
                      <img src={item.image || item.imageUrl || `https://via.placeholder.com/64?text=${item.name[0]}`} className="w-full h-full object-cover" alt="thumb" />
                    </div>
                    <div>
                      <p className="font-bold text-gray-800">{item.name}</p>
                      {(item.selectedVariation || item.variationName) && (
                        <p className="text-xs text-brand-green font-semibold bg-green-50 px-2 py-0.5 rounded w-fit mt-1">
                          {item.selectedVariation || item.variationName}
                        </p>
                      )}
                      <p className="text-sm text-gray-500 mt-1">{formatCurrency(item.price)} / ea</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 bg-gray-50 rounded-lg p-1">
                    <button
                      onClick={() => item.quantity > 1 ? updateQuantity(item.cartItemId || item.id, item.quantity - 1) : removeItem(item.cartItemId || item.id)}
                      className="w-8 h-8 flex items-center justify-center bg-white text-gray-600 rounded shadow-sm hover:bg-gray-200 transition font-bold"
                    >
                      -
                    </button>
                    <span className="font-mono font-bold w-6 text-center">{item.quantity}</span>
                    <button
                      onClick={() => updateQuantity(item.cartItemId || item.id, item.quantity + 1)}
                      className="w-8 h-8 flex items-center justify-center bg-white text-brand-green rounded shadow-sm hover:bg-gray-200 transition font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t-2 border-dashed border-gray-200 space-y-3">
              <div className="flex justify-between text-gray-600"><span>Subtotal:</span> <span>{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between text-gray-600"><span>Shipping:</span> <span>{formatCurrency(shippingFee)}</span></div>
              {appliedCoupon && (
                <div className="flex justify-between text-brand-green font-semibold">
                  <span>Coupon ({appliedCoupon.code}):</span>
                  <span>-{formatCurrency(couponDiscount)}</span>
                </div>
              )}
              {appliedGiftCard && (
                <div className="flex justify-between text-brand-green font-semibold">
                  <span>Gift Card:</span>
                  <span>-{formatCurrency(giftCardDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-2xl font-bold text-brand-green pt-4 border-t">
                <span>Total:</span>
                <span>{formatCurrency(total)}</span>
              </div>
            </div>
          </div>

          {/* Coupon Input */}
          <div className="mt-6 bg-white p-4 border border-gray-200 rounded-xl shadow-sm">
            <label className="block font-bold text-gray-700 mb-2 text-sm">Coupon Code</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="Enter coupon code"
                className="border border-gray-300 p-2 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
              <button onClick={handleCouponApply} className="bg-gray-800 hover:bg-gray-900 text-white px-4 rounded-lg font-bold transition">Apply</button>
            </div>
            {couponError && <p className="text-red-500 text-sm mt-2">{couponError}</p>}
          </div>

          {/* Gift Card Input */}
          <div className="mt-4 bg-white p-4 border border-gray-200 rounded-xl shadow-sm">
            <label className="block font-bold text-gray-700 mb-2 text-sm">Gift Card</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={giftCardCode}
                onChange={(e) => setGiftCardCode(e.target.value)}
                placeholder="Enter gift card code"
                className="border border-gray-300 p-2 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
              <button onClick={handleGiftCardApply} className="bg-gray-800 hover:bg-gray-900 text-white px-4 rounded-lg font-bold transition">Apply</button>
            </div>
            {giftCardError && <p className="text-red-500 text-sm mt-2">{giftCardError}</p>}
            {appliedGiftCard && <p className="text-green-600 text-sm mt-2">Applied! Remaining balance: {formatCurrency(Math.max(0, appliedGiftCard.balance - giftCardDiscount))}</p>}
          </div>
        </div>

        {/* Shipping & Payment */}
        <div className="order-1 lg:order-2">
          <h3 className="text-xl font-bold mb-4 text-gray-800 flex items-center gap-2"><i className="fas fa-truck"></i> Shipping Details</h3>
          <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">First Name</label>
                <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Last Name</label>
                <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                <input required type="email" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
                <input type="tel" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Street Address</label>
              <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">City</label>
                <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
                <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})} />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zip</label>
                <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg" value={formData.zip} onChange={e => setFormData({...formData, zip: e.target.value})} />
              </div>
            </div>

            <div className="mt-8 border-t border-gray-200 pt-8">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><i className="fas fa-credit-card"></i> Payment</h3>
              {!isFormValid ? (
                <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg border border-yellow-200 flex items-start gap-3">
                  <i className="fas fa-info-circle mt-1"></i>
                  <div>
                    <p className="font-bold">Form Incomplete</p>
                    <p className="text-sm">Please complete all shipping details above to proceed.</p>
                  </div>
                </div>
              ) : !createdOrder ? (
                <button
                  onClick={handleCreateOrder}
                  disabled={placingOrder}
                  className="w-full bg-brand-green text-white py-4 rounded-lg font-bold hover:bg-brand-lightGreen transition shadow-lg disabled:opacity-50"
                >
                  {placingOrder ? 'Creating Order...' : 'Continue to Payment'}
                </button>
              ) : total <= 0 ? (
                <button
                  onClick={() => handlePaymentSuccess({ orderNumber: createdOrder.orderId })}
                  className="w-full bg-brand-green text-white py-4 rounded-lg font-bold hover:bg-brand-lightGreen transition shadow-lg flex items-center justify-center gap-2"
                >
                  <i className="fas fa-check-circle"></i> Complete Order (Covered by Gift Card)
                </button>
              ) : (
                <PayPalButtonWrapper
                  orderId={createdOrder.orderId}
                  total={createdOrder.total}
                  onSuccess={handlePaymentSuccess}
                  disabled={false}
                />
              )}
              <div className="flex justify-center items-center gap-2 text-xs text-gray-400 mt-4">
                <i className="fas fa-lock"></i> <span>256-bit SSL Secure Checkout</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdminDashboard = ({ onViewChange }: { onViewChange: (v: ViewState) => void }) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await api.getAdminDashboard();
        if (response.success && response.data) {
          setStats(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  if (loading) return <LoadingSpinner />;

  const chartData = stats?.charts?.salesByDay?.map(d => ({
    name: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
    revenue: d.revenue
  })) || [];

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-64 bg-gray-900 text-white flex flex-col shadow-xl z-20">
        <div className="p-6 text-2xl font-brand text-brand-gold border-b border-gray-800">Admin Panel</div>
        <nav className="flex-1 py-6 space-y-1">
          <button onClick={() => onViewChange(ViewState.ADMIN_DASHBOARD)} className="w-full text-left py-3 px-6 bg-brand-green border-l-4 border-brand-gold font-semibold flex items-center gap-3"><i className="fas fa-chart-line"></i> Dashboard</button>
          <button onClick={() => onViewChange(ViewState.ADMIN_PRODUCTS)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3"><i className="fas fa-box"></i> Products</button>
          <button onClick={() => onViewChange(ViewState.ADMIN_ORDERS)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3"><i className="fas fa-shopping-bag"></i> Orders</button>
          <button onClick={() => onViewChange(ViewState.HOME)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3 mt-8 border-t border-gray-800 pt-4"><i className="fas fa-sign-out-alt"></i> Exit</button>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 p-8 overflow-auto bg-gray-50">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Total Revenue</div>
            <div className="text-3xl font-bold text-gray-800">{formatCurrency(stats?.revenue?.total || 0)}</div>
            <div className="text-green-500 text-xs mt-2">Month: {formatCurrency(stats?.revenue?.month || 0)}</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Total Orders</div>
            <div className="text-3xl font-bold text-gray-800">{stats?.orders?.total || 0}</div>
            <div className="text-yellow-500 text-xs mt-2">{stats?.orders?.pending || 0} pending</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Avg Order Value</div>
            <div className="text-3xl font-bold text-gray-800">{formatCurrency(stats?.averageOrderValue || 0)}</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Low Stock Items</div>
            <div className="text-3xl font-bold text-gray-800">{stats?.lowStockProducts || 0}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-80">
            <h3 className="text-lg font-bold mb-4 text-gray-700">Weekly Sales</h3>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip cursor={{fill: '#f3f4f6'}} />
                <Bar dataKey="revenue" fill="#4A7043" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold mb-4 text-gray-700">Recent Orders</h3>
            <div className="space-y-3 max-h-64 overflow-y-auto">
              {stats?.recentOrders?.slice(0, 5).map(order => (
                <div key={order.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-semibold text-gray-800">{order.customer}</p>
                    <p className="text-xs text-gray-500">{order.orderNumber}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-brand-green">{formatCurrency(order.total)}</p>
                    <span className={`text-xs px-2 py-1 rounded ${order.status === 'paid' || order.status === 'confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdminOrders = ({ onViewChange }: { onViewChange: (v: ViewState) => void }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      try {
        const response = await api.getAdminOrders({ limit: 50 });
        if (response.success && response.data) {
          setOrders(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchOrders();
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="flex h-screen bg-gray-100">
      <div className="w-64 bg-gray-900 text-white flex flex-col shadow-xl z-20">
        <div className="p-6 text-2xl font-brand text-brand-gold border-b border-gray-800">Admin Panel</div>
        <nav className="flex-1 py-6 space-y-1">
          <button onClick={() => onViewChange(ViewState.ADMIN_DASHBOARD)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3"><i className="fas fa-chart-line"></i> Dashboard</button>
          <button onClick={() => onViewChange(ViewState.ADMIN_PRODUCTS)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3"><i className="fas fa-box"></i> Products</button>
          <button onClick={() => onViewChange(ViewState.ADMIN_ORDERS)} className="w-full text-left py-3 px-6 bg-brand-green border-l-4 border-brand-gold font-semibold flex items-center gap-3"><i className="fas fa-shopping-bag"></i> Orders</button>
          <button onClick={() => onViewChange(ViewState.HOME)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3 mt-8 border-t border-gray-800 pt-4"><i className="fas fa-sign-out-alt"></i> Exit</button>
        </nav>
      </div>
      <div className="flex-1 p-8 overflow-auto bg-gray-50">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">Order Management</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {orders.length === 0 ? (
            <div className="p-12 text-center text-gray-400">No orders found.</div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="p-4 text-xs font-bold text-gray-500 uppercase">Order</th>
                  <th className="p-4 text-xs font-bold text-gray-500 uppercase">Customer</th>
                  <th className="p-4 text-xs font-bold text-gray-500 uppercase">Total</th>
                  <th className="p-4 text-xs font-bold text-gray-500 uppercase">Status</th>
                  <th className="p-4 text-xs font-bold text-gray-500 uppercase">Date</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.id} className="border-b hover:bg-gray-50 transition">
                    <td className="p-4 font-mono text-sm font-bold">{order.orderNumber}</td>
                    <td className="p-4">
                      <div className="font-semibold">{order.customer?.firstName} {order.customer?.lastName}</div>
                      <div className="text-xs text-gray-500">{order.customer?.email}</div>
                    </td>
                    <td className="p-4 font-bold">{formatCurrency(order.total || order.grandTotal)}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        order.status === 'paid' || order.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                        order.status === 'shipped' ? 'bg-blue-100 text-blue-800' :
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-gray-500">{new Date(order.createdAt || order.date).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

const AdminProducts = ({ onViewChange }: { onViewChange: (v: ViewState) => void }) => {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await api.getAdminProducts({ limit: 100 });
        if (response.success && response.data) {
          setProducts(response.data);
        }
      } catch (err) {
        console.error('Failed to fetch products:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProducts();
  }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="flex h-screen bg-gray-100">
      <div className="w-64 bg-gray-900 text-white flex flex-col shadow-xl z-20">
        <div className="p-6 text-2xl font-brand text-brand-gold border-b border-gray-800">Admin Panel</div>
        <nav className="flex-1 py-6 space-y-1">
          <button onClick={() => onViewChange(ViewState.ADMIN_DASHBOARD)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3"><i className="fas fa-chart-line"></i> Dashboard</button>
          <button onClick={() => onViewChange(ViewState.ADMIN_PRODUCTS)} className="w-full text-left py-3 px-6 bg-brand-green border-l-4 border-brand-gold font-semibold flex items-center gap-3"><i className="fas fa-box"></i> Products</button>
          <button onClick={() => onViewChange(ViewState.ADMIN_ORDERS)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3"><i className="fas fa-shopping-bag"></i> Orders</button>
          <button onClick={() => onViewChange(ViewState.HOME)} className="w-full text-left py-3 px-6 hover:bg-gray-800 text-gray-300 hover:text-white transition flex items-center gap-3 mt-8 border-t border-gray-800 pt-4"><i className="fas fa-sign-out-alt"></i> Exit</button>
        </nav>
      </div>
      <div className="flex-1 p-8 overflow-auto bg-gray-50">
        <h2 className="text-3xl font-bold text-gray-800 mb-6">Product Management</h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">Product</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">SKU</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">Price</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">Stock</th>
                <th className="p-4 text-xs font-bold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id} className="border-b hover:bg-gray-50 transition">
                  <td className="p-4">
                    <div className="font-bold text-gray-800">{p.name}</div>
                    <div className="text-xs text-gray-500">{p.category?.name || p.categoryName}</div>
                  </td>
                  <td className="p-4 font-mono text-sm">{p.sku}</td>
                  <td className="p-4 font-bold">{formatCurrency(p.price)}</td>
                  <td className="p-4">{p.stockQuantity ?? 'N/A'}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded text-xs font-bold ${p.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// --- Main App Component ---

const App: React.FC = () => {
  const [ageVerified, setAgeVerified] = useState(false);
  const [view, setView] = useState<ViewState>(ViewState.HOME);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const [user, setUser] = useState<User | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [loading, setLoading] = useState(true);

  const shippingFee = 15.00; // Could be fetched from settings API

  // Initialize app - check auth and load cart
  useEffect(() => {
    const initApp = async () => {
      // Check age verification
      const verified = sessionStorage.getItem('ageVerified');
      if (verified === 'true') setAgeVerified(true);

      // Check if user is logged in
      if (api.getAccessToken()) {
        try {
          const response = await api.getCurrentUser();
          if (response.success && response.data?.user) {
            setUser(response.data.user);
          }
        } catch (err) {
          console.error('Failed to get current user:', err);
        }
      }

      // Load cart
      try {
        const cartResponse = await api.getCart();
        if (cartResponse.success && cartResponse.data?.items) {
          setCart(cartResponse.data.items.map((item: any) => ({
            id: item.productId,
            cartItemId: item.id,
            productId: item.productId,
            variationId: item.variationId,
            name: item.name,
            variationName: item.variationName,
            price: item.price,
            quantity: item.quantity,
            imageUrl: item.imageUrl,
            mg: item.mg,
            unit: item.unit
          })));
        }
      } catch (err) {
        console.error('Failed to load cart:', err);
      }

      setLoading(false);
    };

    initApp();
  }, []);

  const showNotification = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  const handleAgeVerify = () => {
    sessionStorage.setItem('ageVerified', 'true');
    setAgeVerified(true);
  };

  const handleAuthSuccess = (loggedInUser: User) => {
    setUser(loggedInUser);
    setShowAuthModal(false);
    showNotification(`Welcome, ${loggedInUser.firstName}!`, 'success');
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setCart([]);
    setView(ViewState.HOME);
    showNotification('Signed out successfully', 'info');
  };

  const handleAddToCart = async (productId: string, quantity: number, variationId?: string) => {
    const response = await api.addToCart(productId, quantity, variationId);
    if (response.success) {
      // Refresh cart
      const cartResponse = await api.getCart();
      if (cartResponse.success && cartResponse.data?.items) {
        setCart(cartResponse.data.items.map((item: any) => ({
          id: item.productId,
          cartItemId: item.id,
          productId: item.productId,
          variationId: item.variationId,
          name: item.name,
          variationName: item.variationName,
          price: item.price,
          quantity: item.quantity,
          imageUrl: item.imageUrl,
          mg: item.mg,
          unit: item.unit
        })));
      }
    } else {
      throw new Error(response.error || 'Failed to add to cart');
    }
  };

  const handleUpdateCartQuantity = async (itemId: string, quantity: number) => {
    const response = await api.updateCartItem(itemId, quantity);
    if (response.success) {
      setCart(prev => prev.map(item =>
        item.cartItemId === itemId ? { ...item, quantity } : item
      ));
    }
  };

  const handleRemoveCartItem = async (itemId: string) => {
    const response = await api.removeCartItem(itemId);
    if (response.success) {
      setCart(prev => prev.filter(item => item.cartItemId !== itemId));
    }
  };

  const handlePlaceOrder = async (orderData: any): Promise<{ orderId: string; total: number } | null> => {
    const response = await api.createOrder(orderData);
    if (response.success && response.data) {
      return { orderId: response.data.orderId, total: response.data.total };
    }
    throw new Error(response.error || 'Failed to create order');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-offWhite">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-offWhite flex flex-col font-sans">
      {!ageVerified && <AgeVerificationModal onVerify={handleAgeVerify} />}

      {notification && (
        <Notification
          message={notification.message}
          type={notification.type}
          onClose={() => setNotification(null)}
        />
      )}

      {showAuthModal && (
        <AuthModal
          mode={authMode}
          onSuccess={handleAuthSuccess}
          onCancel={() => setShowAuthModal(false)}
          onSwitchMode={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
        />
      )}

      {!view.startsWith('ADMIN') && (
        <Navbar
          cartCount={cart.reduce((a, b) => a + b.quantity, 0)}
          onViewChange={setView}
          user={user}
          onAuthClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
          onLogout={handleLogout}
        />
      )}

      <main className="flex-grow">
        {view === ViewState.HOME && (
          <>
            <Hero onShopNow={() => setView(ViewState.SHOP)} />
            <div className="container mx-auto py-16 px-4 text-center">
              <h2 className="text-3xl text-brand-green mb-12 font-brand">The Home Grown Difference</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
                <div className="p-8 bg-white rounded-xl shadow-lg border-b-4 border-brand-gold hover:-translate-y-2 transition duration-300">
                  <div className="text-4xl mb-4">*</div>
                  <h3 className="text-xl font-bold mb-2 text-gray-800">Cultivated Purity</h3>
                  <p className="text-gray-600">Grown in small batches in our private, climate-controlled gardens.</p>
                </div>
                <div className="p-8 bg-white rounded-xl shadow-lg border-b-4 border-brand-green hover:-translate-y-2 transition duration-300">
                  <div className="text-4xl mb-4">~</div>
                  <h3 className="text-xl font-bold mb-2 text-gray-800">Handmade Daily</h3>
                  <p className="text-gray-600">Baked fresh every morning by our expert culinary team.</p>
                </div>
                <div className="p-8 bg-white rounded-xl shadow-lg border-b-4 border-brand-lime hover:-translate-y-2 transition duration-300">
                  <div className="text-4xl mb-4">+</div>
                  <h3 className="text-xl font-bold mb-2 text-gray-800">Lab Verified</h3>
                  <p className="text-gray-600">Every batch is tested for consistent potency and safety.</p>
                </div>
              </div>
            </div>
          </>
        )}

        {view === ViewState.SHOP && (
          <Shop onAddToCart={handleAddToCart} showNotification={showNotification} />
        )}

        {view === ViewState.CHECKOUT && (
          <Checkout
            cart={cart}
            updateQuantity={handleUpdateCartQuantity}
            removeItem={handleRemoveCartItem}
            shippingFee={shippingFee}
            onPlaceOrder={handlePlaceOrder}
            user={user}
            showNotification={showNotification}
          />
        )}

        {view === ViewState.SUCCESS && (
          <div className="container mx-auto text-center py-24 px-4">
            <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 text-5xl shadow-lg">OK</div>
            <h2 className="text-4xl font-brand text-brand-green mb-4">Order Received!</h2>
            <p className="text-xl text-gray-600 mb-8 max-w-md mx-auto">Thank you for choosing Home Grown Creations. We've sent a confirmation email with your order details.</p>
            <button onClick={() => setView(ViewState.HOME)} className="bg-brand-gold px-10 py-3 rounded-full font-bold text-brand-green hover:bg-brand-lime transition shadow-md">Return to Home</button>
          </div>
        )}

        {view === ViewState.ORDERS && user && (
          <div className="container mx-auto px-4 py-12">
            <h2 className="text-3xl font-brand text-brand-green mb-8">My Orders</h2>
            <p className="text-gray-500">Your order history will appear here.</p>
          </div>
        )}

        {/* Admin Views */}
        {view === ViewState.ADMIN_DASHBOARD && <AdminDashboard onViewChange={setView} />}
        {view === ViewState.ADMIN_PRODUCTS && <AdminProducts onViewChange={setView} />}
        {view === ViewState.ADMIN_ORDERS && <AdminOrders onViewChange={setView} />}
      </main>

      {!view.startsWith('ADMIN') && <Footer />}
    </div>
  );
};

export default App;
