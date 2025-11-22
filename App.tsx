
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Product, CartItem, ViewState, Order, GiftCard, DashboardStats } from './types';
import { INITIAL_PRODUCTS, INITIAL_SHIPPING_FEE, VALID_GIFT_CARDS } from './constants';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

// --- Types for Window PayPal ---
declare global {
  interface Window {
    paypal: any;
  }
}

// --- Helpers ---
const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

const generateId = () => {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (e) {
    // Fallback
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Robust error parser
const parseError = (err: any): string => {
  try {
    if (!err) return "Unknown error";
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    
    if (typeof err === 'object') {
       // Filter out noise errors from the SDK
       if (err.message && (err.message.includes('Window not found') || err.message.includes('postMessage') || err.message.includes('Script error'))) {
           return ""; // Return empty to ignore
       }

       // PayPal specific error structures
       if (err.details && Array.isArray(err.details) && err.details.length > 0) {
           return err.details[0].issue || err.details[0].description || "Transaction declined";
       }
       if (err.debug_id) return `Transaction Error (ID: ${err.debug_id})`;
       
       // Attempt to stringify if it's a random object
       try {
           const json = JSON.stringify(err);
           if (json !== '{}') return "Payment Error: " + json.substring(0, 100);
       } catch {
           // ignore
       }
       
       return err.message || "Payment processing error";
    }
    return "An unexpected error occurred.";
  } catch (e) {
    return "System error during error parsing.";
  }
};

// --- Components ---

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

const AdminLoginModal = ({ onLogin, onCancel }: { onLogin: () => void, onCancel: () => void }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        // Hardcoded for demo purposes. In production, verify against backend hash.
        if (username === 'admin' && password === 'admin') {
            onLogin();
        } else {
            setError('Invalid credentials');
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 z-[1500] flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md relative">
                <button onClick={onCancel} className="absolute top-4 right-4 text-gray-500 hover:text-gray-800">✕</button>
                <h2 className="text-2xl font-brand text-brand-green mb-6 text-center">Admin Portal Access</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Username</label>
                        <input 
                            type="text" 
                            className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Password</label>
                        <input 
                            type="password" 
                            className="w-full border border-gray-300 p-3 rounded focus:outline-none focus:border-brand-green"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    {error && <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">{error}</div>}
                    <button type="submit" className="w-full bg-brand-green text-white font-bold py-3 rounded hover:bg-brand-lightGreen transition shadow-md">
                        Authenticate
                    </button>
                </form>
            </div>
        </div>
    );
};

/**
 * Enterprise-Grade PayPal Wrapper
 * Uses refs for amount to prevent re-renders of the PayPal buttons when cart totals change.
 * This prevents the "window host" and "unhandled exception" errors caused by React unmounting the iframe.
 */
const PayPalButtonWrapper = React.memo(({ 
    total, 
    onSuccess, 
    disabled 
}: { 
    total: number, 
    onSuccess: (details: any) => void, 
    disabled: boolean 
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const totalRef = useRef(total);
    const onSuccessRef = useRef(onSuccess);
    // We use a ref to track if buttons are currently rendered to avoid duplicate rendering
    const isRenderedRef = useRef(false);
    const [error, setError] = useState<string | null>(null);

    // Keep refs up to date. This does NOT trigger a re-render or effect.
    useEffect(() => { totalRef.current = total; }, [total]);
    useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

    useEffect(() => {
        // If disabled, do nothing.
        if (disabled) return;
        
        // If we have already rendered the buttons in this instance, do not re-render.
        if (isRenderedRef.current) return;

        let isCancelled = false;

        const initializePayPal = async () => {
             // 1. Wait for SDK
             let attempts = 0;
             while (!window.paypal && attempts < 50) {
                 if (isCancelled) return;
                 await new Promise(r => setTimeout(r, 100));
                 attempts++;
             }

             if (!window.paypal || !window.paypal.Buttons) {
                 if (!isCancelled) setError("Secure Payment System failed to load. Please refresh.");
                 return;
             }

             // 2. Render Buttons
             try {
                 if (!containerRef.current || isCancelled) return;
                 
                 // Clean container just in case
                 containerRef.current.innerHTML = "";

                 await window.paypal.Buttons({
                     style: {
                        layout: 'vertical',
                        color:  'gold',
                        shape:  'rect',
                        label:  'pay'
                     },
                     // CRITICAL: The SDK calls this function when the user CLICKS.
                     // We read the Ref here to get the LATEST total without re-rendering the component.
                     createOrder: (data: any, actions: any) => {
                        return actions.order.create({
                            purchase_units: [{
                                description: "Home Grown Creations Order",
                                amount: {
                                    currency_code: "USD",
                                    value: totalRef.current.toFixed(2)
                                }
                            }]
                        }).catch((err: any) => {
                            // Catch explicitly to avoid unhandled exception in SDK
                            console.error("Order Creation Error:", err);
                            throw err;
                        });
                     },
                     onApprove: (data: any, actions: any) => {
                        return actions.order.capture()
                        .then((details: any) => {
                            if (!isCancelled) onSuccessRef.current(details);
                        })
                        .catch((err: any) => {
                            const msg = parseError(err);
                            if (msg && !isCancelled) setError("Transaction Failed: " + msg);
                        });
                     },
                     onError: (err: any) => {
                        const msg = parseError(err);
                        // Only update state if we have a meaningful error message and aren't cancelled
                        if (msg && !isCancelled) {
                            console.error("PayPal Error Handler:", err);
                            setError(msg); 
                        }
                     }
                 }).render(containerRef.current);
                 
                 isRenderedRef.current = true;

             } catch (err) {
                 console.error("PayPal Render Error:", err);
             }
        };

        initializePayPal();

        return () => {
            isCancelled = true;
            // We do NOT call buttons.close() here. React removing the div is sufficient.
            // Calling close() explicitly often triggers the V5 exception in strict mode.
            isRenderedRef.current = false; 
        };
    }, [disabled]); // Only re-run if disabled state changes significantly

    if (disabled) return null;

    return (
        <div className="w-full mt-4">
             <div ref={containerRef} className="w-full z-0 relative" style={{ minHeight: '150px' }}></div>
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
    isAdmin, 
    onAdminClick 
}: { 
    cartCount: number, 
    onViewChange: (v: ViewState) => void, 
    isAdmin: boolean,
    onAdminClick: () => void
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 bg-white shadow-md z-[1000] border-b-4 border-brand-green">
      <div className="container mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center cursor-pointer" onClick={() => onViewChange(ViewState.HOME)}>
           <div className="w-12 h-12 rounded-full bg-brand-green mr-3 flex items-center justify-center text-brand-gold font-bold border-2 border-brand-gold overflow-hidden">
             <img src="https://homegrowncreations.thepfps.xyz/imgs/o84h_vDe_400x400.gif" className="w-full h-full object-cover" alt="HG" onError={(e) => e.currentTarget.style.display = 'none'} />
             <span className="absolute" style={{ display: 'none' }}>HG</span> 
           </div>
           <h1 className="text-2xl text-brand-green font-brand hidden sm:block">Home Grown Creations</h1>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center space-x-6">
          <button onClick={() => onViewChange(ViewState.HOME)} className="text-brand-green hover:text-brand-lime font-semibold">Home</button>
          <button onClick={() => onViewChange(ViewState.SHOP)} className="text-brand-green hover:text-brand-lime font-semibold">Shop</button>
          
          {isAdmin ? (
            <button onClick={() => onViewChange(ViewState.ADMIN_DASHBOARD)} className="text-red-600 hover:text-red-800 font-semibold border border-red-200 px-3 py-1 rounded bg-red-50">Dashboard</button>
          ) : (
             <button onClick={onAdminClick} className="text-gray-400 hover:text-brand-green text-xs">Admin</button>
          )}
          
          <button onClick={() => onViewChange(ViewState.CHECKOUT)} className="relative bg-brand-gold hover:bg-brand-lime text-brand-green font-bold py-2 px-4 rounded transition shadow-sm flex items-center gap-2">
            <i className="fas fa-shopping-cart"></i>
            <span>Cart ({cartCount})</span>
          </button>
        </nav>

        {/* Mobile Toggle */}
        <button className="md:hidden text-brand-green text-2xl" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          ☰
        </button>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <nav className="md:hidden bg-brand-offWhite p-4 flex flex-col space-y-3 border-t shadow-inner">
          <button onClick={() => { onViewChange(ViewState.HOME); setIsMobileMenuOpen(false); }} className="text-left text-brand-green font-semibold p-2 hover:bg-gray-100 rounded">Home</button>
          <button onClick={() => { onViewChange(ViewState.SHOP); setIsMobileMenuOpen(false); }} className="text-left text-brand-green font-semibold p-2 hover:bg-gray-100 rounded">Shop</button>
          {isAdmin ? (
            <button onClick={() => { onViewChange(ViewState.ADMIN_DASHBOARD); setIsMobileMenuOpen(false); }} className="text-left text-red-600 font-semibold p-2 hover:bg-gray-100 rounded">Dashboard</button>
          ) : (
             <button onClick={() => { onAdminClick(); setIsMobileMenuOpen(false); }} className="text-left text-gray-500 p-2">Admin Login</button>
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
         {/* Placeholder images if constants fail, but ideally served from assets */}
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

const Footer = ({ onAdminClick }: { onAdminClick: () => void }) => (
  <footer className="bg-brand-green text-white py-12 px-4 border-t-8 border-brand-gold">
    <div className="container mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 text-center md:text-left">
      <div>
        <h3 className="text-2xl mb-4 text-brand-gold font-brand">Contact Us</h3>
        <p className="mb-2"><span className="inline-block w-6">✉️</span> <a href="mailto:info@homegrowncreations.com" className="hover:text-brand-lime">info@homegrowncreations.com</a></p>
        <p><span className="inline-block w-6">📞</span> +1 (234) 567-890</p>
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
        <button onClick={onAdminClick} className="text-xs text-brand-green bg-brand-lime px-2 py-1 rounded hover:bg-white transition">Admin Access</button>
      </div>
    </div>
    <div className="text-center mt-8 text-xs text-gray-300 border-t border-green-800 pt-4">
        &copy; {new Date().getFullYear()} Home Grown Creations. All rights reserved.
    </div>
  </footer>
);

// --- Pages ---

const Shop = ({ products, addToCart }: { products: Product[], addToCart: (p: Product, qty: number, variant?: string) => void }) => {
  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map(p => p.category)))], [products]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [variantSelections, setVariantSelections] = useState<{[key: string]: string}>({});

  const filteredProducts = useMemo(() => {
      return activeCategory === 'All' 
        ? products 
        : products.filter(p => p.category === activeCategory);
  }, [activeCategory, products]);

  const handleAddToCart = (product: Product) => {
    if (product.hasVariations && !variantSelections[product.id]) {
        alert("Please select a flavor/variation before adding to cart.");
        return;
    }
    addToCart(product, 1, variantSelections[product.id]);
    
    // Optional: Visual feedback could be added here
  };

  return (
    <div className="container mx-auto px-4 py-8 min-h-screen">
      <h2 className="text-4xl text-brand-green text-center mb-8 font-brand border-b-2 border-brand-lime inline-block mx-auto px-10 pb-2">Our Menu</h2>
      
      {/* Filter */}
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

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {filteredProducts.filter(p => p.isActive).map(product => (
          <div key={product.id} className="bg-white rounded-2xl shadow-md hover:shadow-2xl transition duration-300 flex flex-col overflow-hidden border border-gray-100 group">
             <div className="h-56 bg-gray-100 relative overflow-hidden">
                <img 
                    src={product.image || `https://via.placeholder.com/300x200?text=${encodeURIComponent(product.name)}`} 
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
                <p className="text-sm text-gray-500 mb-4 font-medium">{product.category} {product.unit && `• ${product.unit}`}</p>
                
                {product.description && <p className="text-sm text-gray-600 mb-4 line-clamp-2">{product.description}</p>}
                
                <div className="flex-grow"></div>
                
                {product.hasVariations && (
                    <div className="mb-4">
                        <select 
                            className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:border-brand-green focus:outline-none"
                            onChange={(e) => setVariantSelections(prev => ({...prev, [product.id]: e.target.value}))}
                            value={variantSelections[product.id] || ""}
                        >
                            <option value="" disabled>Select Flavor</option>
                            {product.variations?.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </div>
                )}

                <div className="flex justify-between items-center mt-2 pt-4 border-t border-gray-100">
                  <span className="text-2xl font-bold text-brand-green">{formatCurrency(product.price)}</span>
                  <button 
                    onClick={() => handleAddToCart(product)}
                    className="bg-brand-green text-white px-5 py-2.5 rounded-xl hover:bg-brand-lightGreen active:bg-brand-green transition shadow-md text-sm font-bold flex items-center gap-2"
                  >
                    <span>Add</span>
                    <i className="fas fa-plus"></i>
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
  shippingFee, 
  onPlaceOrder, 
  giftCards 
}: { 
  cart: CartItem[], 
  updateQuantity: (id: string, delta: number, variant?: string) => void,
  shippingFee: number,
  onPlaceOrder: (orderData: any) => void,
  giftCards: GiftCard[]
}) => {
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', address: '', city: '', state: '', zip: ''
  });
  const [giftCardCode, setGiftCardCode] = useState('');
  const [appliedGiftCard, setAppliedGiftCard] = useState<GiftCard | null>(null);
  const [giftCardError, setGiftCardError] = useState('');

  const subtotal = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const discount = appliedGiftCard ? Math.min(subtotal + shippingFee, appliedGiftCard.balance) : 0;
  const total = Math.max(0, (subtotal + shippingFee) - discount);

  const isFormValid = useMemo(() => {
      return Boolean(
        formData.name.trim().length > 1 && 
        formData.email.includes('@') && 
        formData.phone.length > 5 && 
        formData.address.trim().length > 5 && 
        formData.city && formData.state && formData.zip
      );
  }, [formData]);

  const handleGiftCardApply = () => {
    const card = giftCards.find(gc => gc.code === giftCardCode && gc.isActive && gc.balance > 0);
    if (card) {
      setAppliedGiftCard(card);
      setGiftCardError('');
    } else {
      setGiftCardError('Invalid, inactive, or empty gift card code.');
      setAppliedGiftCard(null);
    }
  };

  // Stable callback for payment success
  const handlePaymentSuccess = useCallback((paypalOrder: any) => {
    onPlaceOrder({
        customer: formData,
        items: cart,
        subtotal,
        shippingFee,
        discount,
        total,
        giftCardCode: appliedGiftCard?.code,
        paypalTransactionId: paypalOrder.id,
        paypalPayerId: paypalOrder.payer?.payer_id,
        paymentMethod: 'paypal'
    });
  }, [formData, cart, subtotal, shippingFee, discount, total, appliedGiftCard, onPlaceOrder]);

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
            <div className="max-h-96 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                {cart.map((item, idx) => (
                <div key={`${item.id}-${item.selectedVariation}-${idx}`} className="flex justify-between items-center border-b border-gray-100 pb-4">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-gray-100 rounded-md overflow-hidden">
                            <img src={item.image || `https://via.placeholder.com/64?text=${item.name[0]}`} className="w-full h-full object-cover" alt="thumb" />
                        </div>
                        <div>
                        <p className="font-bold text-gray-800">{item.name}</p>
                        {item.selectedVariation && <p className="text-xs text-brand-green font-semibold bg-green-50 px-2 py-0.5 rounded w-fit mt-1">{item.selectedVariation}</p>}
                        <p className="text-sm text-gray-500 mt-1">{formatCurrency(item.price)} / ea</p>
                        </div>
                    </div>
                    <div className="flex items-center space-x-3 bg-gray-50 rounded-lg p-1">
                    <button onClick={() => updateQuantity(item.id, -1, item.selectedVariation)} className="w-8 h-8 flex items-center justify-center bg-white text-gray-600 rounded shadow-sm hover:bg-gray-200 transition font-bold">-</button>
                    <span className="font-mono font-bold w-6 text-center">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.id, 1, item.selectedVariation)} className="w-8 h-8 flex items-center justify-center bg-white text-brand-green rounded shadow-sm hover:bg-gray-200 transition font-bold">+</button>
                    </div>
                </div>
                ))}
            </div>
            
            <div className="pt-4 border-t-2 border-dashed border-gray-200 space-y-3">
               <div className="flex justify-between text-gray-600"><span>Subtotal:</span> <span>{formatCurrency(subtotal)}</span></div>
               <div className="flex justify-between text-gray-600"><span>Shipping (Flat Rate):</span> <span>{formatCurrency(shippingFee)}</span></div>
               {appliedGiftCard && (
                   <div className="flex justify-between text-brand-green font-semibold">
                       <span>Gift Card Credit:</span> 
                       <span>-{formatCurrency(discount)}</span>
                   </div>
               )}
               <div className="flex justify-between text-2xl font-bold text-brand-green pt-4 border-t">
                   <span>Total:</span> 
                   <span>{formatCurrency(total)}</span>
               </div>
            </div>
          </div>

          {/* Gift Card Input */}
          <div className="mt-6 bg-white p-6 border border-gray-200 rounded-xl shadow-md">
            <label className="block font-bold text-gray-700 mb-2 text-sm uppercase tracking-wide">Gift Card / Promo Code</label>
            <div className="flex gap-2">
              <input 
                type="text" 
                value={giftCardCode}
                onChange={(e) => setGiftCardCode(e.target.value)}
                placeholder="Enter Code (e.g. HGC-100-ABC)"
                className="border border-gray-300 p-3 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-brand-gold"
              />
              <button onClick={handleGiftCardApply} className="bg-gray-800 hover:bg-gray-900 text-white px-6 rounded-lg font-bold transition">Apply</button>
            </div>
            {giftCardError && <p className="text-red-500 text-sm mt-2 flex items-center gap-2"><i className="fas fa-exclamation-circle"></i> {giftCardError}</p>}
            {appliedGiftCard && <p className="text-green-600 text-sm mt-2 flex items-center gap-2"><i className="fas fa-check-circle"></i> Card applied! Balance remaining: {formatCurrency(appliedGiftCard.balance - discount)}</p>}
          </div>
        </div>

        {/* Shipping & Payment */}
        <div className="order-1 lg:order-2">
          <h3 className="text-xl font-bold mb-4 text-gray-800 flex items-center gap-2"><i className="fas fa-truck"></i> Shipping Details</h3>
          <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 space-y-5">
             <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Full Name</label>
                 <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
             </div>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email</label>
                    <input required type="email" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
                <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Phone</label>
                    <input required type="tel" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                </div>
             </div>
             <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Street Address</label>
                 <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg focus:ring-2 focus:ring-brand-green outline-none transition" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
             </div>
             <div className="grid grid-cols-3 gap-4">
               <div className="col-span-1">
                   <label className="block text-xs font-bold text-gray-500 uppercase mb-1">City</label>
                   <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} />
               </div>
               <div className="col-span-1">
                   <label className="block text-xs font-bold text-gray-500 uppercase mb-1">State</label>
                   <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})} />
               </div>
               <div className="col-span-1">
                   <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Zip</label>
                   <input required type="text" className="w-full border border-gray-300 p-3 rounded-lg" value={formData.zip} onChange={e => setFormData({...formData, zip: e.target.value})} />
               </div>
             </div>

             <div className="mt-8 border-t border-gray-200 pt-8">
               <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><i className="fas fa-credit-card"></i> Payment</h3>
               { !isFormValid ? (
                 <div className="bg-yellow-50 text-yellow-800 p-4 rounded-lg border border-yellow-200 flex items-start gap-3">
                     <i className="fas fa-info-circle mt-1"></i>
                     <div>
                        <p className="font-bold">Form Incomplete</p>
                        <p className="text-sm">Please complete all shipping details above to unlock the secure payment terminal.</p>
                     </div>
                 </div>
               ) : (
                 <div className="animate-fade-in">
                    {total <= 0 ? (
                        <button 
                            onClick={() => handlePaymentSuccess({id: 'GIFT_CARD_FULL_' + generateId(), payer: { payer_id: 'GIFT_CARD_USER' }})} 
                            className="w-full bg-brand-green text-white py-4 rounded-lg font-bold hover:bg-brand-lightGreen transition shadow-lg flex items-center justify-center gap-2"
                        >
                            <i className="fas fa-check-circle"></i> Place Order (Covered by Gift Card)
                        </button>
                    ) : (
                        <div className="p-1 bg-white rounded">
                            {/* We pass disabled={false} because we already checked isFormValid above. 
                                The component is rendered here, and will persist even if user types in form 
                                because the parent doesn't unmount this div, it just re-renders. 
                                The PayPalButtonWrapper uses React.memo and refs to survive parent re-renders. */}
                            <PayPalButtonWrapper total={total} onSuccess={handlePaymentSuccess} disabled={false} />
                        </div>
                    )}
                 </div>
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

const AdminDashboard = ({ stats, onViewChange }: { stats: DashboardStats, onViewChange: (v: ViewState) => void }) => {
    const data = [
      { name: 'Mon', uv: 4000 },
      { name: 'Tue', uv: 3000 },
      { name: 'Wed', uv: 2000 },
      { name: 'Thu', uv: 2780 },
      { name: 'Fri', uv: 1890 },
      { name: 'Sat', uv: 2390 },
      { name: 'Sun', uv: 3490 },
    ];

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
            <div className="text-3xl font-bold text-gray-800">{formatCurrency(stats.totalRevenue)}</div>
            <div className="text-green-500 text-xs mt-2"><i className="fas fa-arrow-up"></i> 12% from last week</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Total Orders</div>
            <div className="text-3xl font-bold text-gray-800">{stats.totalOrders}</div>
             <div className="text-green-500 text-xs mt-2"><i className="fas fa-arrow-up"></i> 5 new today</div>
          </div>
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Avg Order Value</div>
            <div className="text-3xl font-bold text-gray-800">{formatCurrency(stats.averageOrderValue)}</div>
          </div>
           <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md transition">
            <div className="text-gray-500 text-xs font-bold uppercase tracking-wider mb-1">Top Seller</div>
            <div className="text-lg font-bold text-brand-green truncate">{stats.topSellingItem}</div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-96">
          <h3 className="text-lg font-bold mb-4 text-gray-700">Weekly Sales Performance</h3>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} />
              <Tooltip cursor={{fill: '#f3f4f6'}} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}} />
              <Bar dataKey="uv" fill="#4A7043" radius={[4, 4, 0, 0]} barSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

const ProductForm = ({ 
    product, 
    onSave, 
    onCancel 
}: { 
    product?: Product, 
    onSave: (p: Product) => void, 
    onCancel: () => void 
}) => {
    const [formData, setFormData] = useState<Partial<Product>>(product || {
        name: '',
        category: 'Cookies',
        price: 0,
        mg: 0,
        unit: '',
        image: '',
        isActive: true,
        hasVariations: false,
        variations: []
    });
    const [varString, setVarString] = useState(product?.variations?.join(', ') || '');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const finalProduct = {
            ...formData,
            id: product?.id || generateId(),
            variations: formData.hasVariations ? varString.split(',').map(s => s.trim()).filter(Boolean) : undefined
        } as Product;
        onSave(finalProduct);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg overflow-y-auto max-h-[90vh] animate-fade-in-up">
                <h3 className="text-2xl font-bold mb-6 text-gray-800 border-b pb-2">{product ? 'Edit Product' : 'Add New Product'}</h3>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Product Name</label>
                        <input required className="w-full border border-gray-300 p-2 rounded focus:ring-2 focus:ring-brand-green outline-none" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                    </div>
                    
                    <div>
                         <label className="text-xs font-bold text-gray-500 uppercase">Category</label>
                        <select className="w-full border border-gray-300 p-2 rounded focus:ring-2 focus:ring-brand-green outline-none" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                            <option value="Cookies">Cookies</option>
                            <option value="Chocolates">Chocolates</option>
                            <option value="Pastries">Pastries</option>
                            <option value="Beverages">Beverages</option>
                            <option value="Syrups">Syrups</option>
                            <option value="Candy">Candy</option>
                            <option value="Snacks">Snacks</option>
                            <option value="Infusions">Infusions</option>
                            <option value="Topicals">Topicals</option>
                            <option value="Ice Cream">Ice Cream</option>
                        </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Price ($)</label>
                            <input required type="number" step="0.01" className="w-full border border-gray-300 p-2 rounded" value={formData.price} onChange={e => setFormData({...formData, price: parseFloat(e.target.value)})} />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Potency (mg)</label>
                            <input required type="number" className="w-full border border-gray-300 p-2 rounded" value={formData.mg} onChange={e => setFormData({...formData, mg: parseFloat(e.target.value)})} />
                        </div>
                    </div>
                    
                    <div>
                         <label className="text-xs font-bold text-gray-500 uppercase">Unit (Optional)</label>
                         <input placeholder="e.g. 22g, 1oz" className="w-full border border-gray-300 p-2 rounded" value={formData.unit} onChange={e => setFormData({...formData, unit: e.target.value})} />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Image URL</label>
                        <input className="w-full border border-gray-300 p-2 rounded" value={formData.image} onChange={e => setFormData({...formData, image: e.target.value})} />
                    </div>
                    
                    <div className="bg-gray-50 p-4 rounded border">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input type="checkbox" className="w-5 h-5 text-brand-green rounded focus:ring-brand-green" checked={formData.hasVariations} onChange={e => setFormData({...formData, hasVariations: e.target.checked})} />
                            <span className="font-semibold text-gray-700">Has Variations/Flavors?</span>
                        </label>
                        
                        {formData.hasVariations && (
                            <div className="mt-3">
                                <label className="text-xs font-bold text-gray-500 uppercase">Variations (Comma separated)</label>
                                <input placeholder="e.g. Chocolate, Vanilla, Strawberry" className="w-full border border-gray-300 p-2 rounded mt-1" value={varString} onChange={e => setVarString(e.target.value)} />
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 mt-8 pt-4 border-t">
                        <button type="button" onClick={onCancel} className="px-6 py-2 text-gray-600 hover:bg-gray-100 rounded font-semibold transition">Cancel</button>
                        <button type="submit" className="px-6 py-2 bg-brand-green text-white rounded font-bold hover:bg-brand-lightGreen shadow-md transition">Save Product</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const AdminProducts = ({ 
    products, 
    setProducts,
    updateShippingFee, 
    currentFee, 
    onViewChange 
}: any) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Product | undefined>(undefined);
    const [searchTerm, setSearchTerm] = useState('');

    const toggleStatus = (id: string) => {
        setProducts((prev: Product[]) => prev.map(p => p.id === id ? { ...p, isActive: !p.isActive } : p));
    };

    const handleSave = (p: Product) => {
        setProducts((prev: Product[]) => {
            const exists = prev.find(prod => prod.id === p.id);
            if (exists) {
                return prev.map(prod => prod.id === p.id ? p : prod);
            }
            return [...prev, p];
        });
        setIsEditing(false);
        setEditingProduct(undefined);
    };

    const filtered = products.filter((p: Product) => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.category.toLowerCase().includes(searchTerm.toLowerCase()));

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
        <div className="flex-1 p-8 overflow-auto relative bg-gray-50">
            {isEditing && <ProductForm product={editingProduct} onSave={handleSave} onCancel={() => { setIsEditing(false); setEditingProduct(undefined); }} />}
            
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-3xl font-bold text-gray-800">Inventory</h2>
                    <p className="text-gray-500">Manage products, prices, and availability.</p>
                </div>
                <button onClick={() => { setEditingProduct(undefined); setIsEditing(true); }} className="bg-brand-green text-white px-6 py-3 rounded-lg font-bold shadow-lg hover:bg-brand-lightGreen transition flex items-center gap-2">
                    <i className="fas fa-plus"></i> Add Item
                </button>
            </div>
            
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 mb-8 flex items-center gap-6">
                <div className="flex-1 relative">
                    <i className="fas fa-search absolute left-3 top-3 text-gray-400"></i>
                    <input 
                        type="text" 
                        placeholder="Search products..." 
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-green outline-none"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border">
                    <label className="font-bold text-sm whitespace-nowrap">Flat Shipping Fee:</label>
                    <div className="relative">
                        <span className="absolute left-2 top-2 text-gray-500">$</span>
                        <input type="number" value={currentFee} onChange={(e) => updateShippingFee(Number(e.target.value))} className="border p-2 pl-6 rounded w-24" />
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b">
                        <tr>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Product</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Category</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Price</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Status</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((p: Product) => (
                            <tr key={p.id} className="border-b hover:bg-gray-50 transition">
                                <td className="p-4">
                                    <div className="font-bold text-gray-800">{p.name}</div>
                                    {p.unit && <div className="text-xs text-gray-400">{p.unit}</div>}
                                </td>
                                <td className="p-4 text-sm">{p.category}</td>
                                <td className="p-4 font-mono text-sm font-bold">{formatCurrency(p.price)}</td>
                                <td className="p-4">
                                    <span className={`px-2 py-1 rounded-full text-xs font-bold border ${p.isActive ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                        {p.isActive ? 'Active' : 'Paused'}
                                    </span>
                                </td>
                                <td className="p-4 flex gap-2 justify-end">
                                    <button 
                                        onClick={() => { setEditingProduct(p); setIsEditing(true); }}
                                        className="text-gray-400 hover:text-blue-600 p-2 transition"
                                        title="Edit"
                                    >
                                        <i className="fas fa-edit"></i>
                                    </button>
                                    <button 
                                        onClick={() => toggleStatus(p.id)}
                                        className={`p-2 transition rounded ${p.isActive ? 'text-gray-400 hover:text-red-600' : 'text-green-600 hover:text-green-800'}`}
                                        title={p.isActive ? "Pause" : "Activate"}
                                    >
                                        <i className={`fas ${p.isActive ? 'fa-pause-circle' : 'fa-play-circle'}`}></i>
                                    </button>
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

const AdminOrders = ({ orders, onViewChange }: { orders: Order[], onViewChange: (v: ViewState) => void }) => (
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
                <div className="p-12 text-center text-gray-400 flex flex-col items-center">
                    <i className="fas fa-inbox text-4xl mb-4 opacity-20"></i>
                    <p>No active orders found.</p>
                </div>
            ) : (
                <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b">
                        <tr>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Order ID</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Customer Details</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Items</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Total</th>
                            <th className="p-4 text-xs font-bold text-gray-500 uppercase">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => (
                            <tr key={order.id} className="border-b hover:bg-gray-50 transition">
                                <td className="p-4 align-top">
                                    <span className="font-mono text-sm font-bold text-gray-700">#{order.id.substring(0,8)}</span>
                                    <div className="text-xs text-gray-400 mt-1">{new Date(order.date).toLocaleDateString()}</div>
                                </td>
                                <td className="p-4 align-top">
                                    <div className="font-bold text-gray-800">{order.customer.name}</div>
                                    <div className="text-sm text-gray-600">{order.customer.email}</div>
                                    <div className="text-xs text-gray-500 mt-1">{order.customer.city}, {order.customer.state}</div>
                                </td>
                                <td className="p-4 align-top">
                                    <div className="text-sm space-y-1">
                                        {order.items.map((item, i) => (
                                            <div key={i} className="text-gray-600">{item.quantity}x {item.name} {item.selectedVariation && `(${item.selectedVariation})`}</div>
                                        ))}
                                    </div>
                                </td>
                                <td className="p-4 align-top font-bold text-gray-800">{formatCurrency(order.total)}</td>
                                <td className="p-4 align-top">
                                    <span className="bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-bold uppercase border border-green-200">{order.status}</span>
                                    <div className="text-xs text-gray-400 mt-2">{order.paymentMethod}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
      </div>
    </div>
);

// --- Main App Component ---

const App: React.FC = () => {
  const [ageVerified, setAgeVerified] = useState(false);
  const [view, setView] = useState<ViewState>(ViewState.HOME);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  
  // Application State "Database"
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [giftCards, setGiftCards] = useState<GiftCard[]>(VALID_GIFT_CARDS);
  const [orders, setOrders] = useState<Order[]>([]);
  
  const [cart, setCart] = useState<CartItem[]>([]);
  const [shippingFee, setShippingFee] = useState(INITIAL_SHIPPING_FEE);
  const [isAdmin, setIsAdmin] = useState(false);
  
  // Stats Calculation
  const stats: DashboardStats = useMemo(() => {
    const totalRevenue = orders.reduce((acc, o) => acc + o.total, 0);
    const totalOrders = orders.length;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    const itemCounts: {[key: string]: number} = {};
    orders.forEach(o => o.items.forEach(i => {
        itemCounts[i.name] = (itemCounts[i.name] || 0) + i.quantity;
    }));
    const topSellingItem = Object.keys(itemCounts).reduce((a, b) => (itemCounts[a] || 0) > (itemCounts[b] || 0) ? a : b, 'N/A');

    return { totalRevenue, totalOrders, averageOrderValue, topSellingItem };
  }, [orders]);

  useEffect(() => {
    const verified = sessionStorage.getItem('ageVerified');
    if (verified === 'true') setAgeVerified(true);
  }, []);

  const handleAgeVerify = () => {
    sessionStorage.setItem('ageVerified', 'true');
    setAgeVerified(true);
  };

  const addToCart = (product: Product, quantity: number, variant?: string) => {
    setCart(prev => {
      const existing = prev.find(p => p.id === product.id && p.selectedVariation === variant);
      if (existing) {
        return prev.map(p => (p.id === product.id && p.selectedVariation === variant) ? { ...p, quantity: p.quantity + quantity } : p);
      }
      return [...prev, { ...product, quantity, selectedVariation: variant }];
    });
  };

  const updateCartQuantity = (id: string, delta: number, variant?: string) => {
    setCart(prev => prev.map(item => {
      if (item.id === id && item.selectedVariation === variant) {
        return { ...item, quantity: Math.max(0, item.quantity + delta) };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const handlePlaceOrder = (orderData: any) => {
    // Enterprise Grade Logic: Double Spend Protection
    if (orderData.giftCardCode && orderData.discount > 0) {
        const cardIndex = giftCards.findIndex(gc => gc.code === orderData.giftCardCode);
        
        // Concurrent Check (simulated)
        if (cardIndex === -1 || giftCards[cardIndex].balance < orderData.discount) {
            alert("Critical Error: Gift card balance insufficient or already used. Transaction cancelled.");
            return;
        }

        // Deduct Balance (Atomic-like operation in state)
        const updatedCards = [...giftCards];
        updatedCards[cardIndex].balance -= orderData.discount;
        if (updatedCards[cardIndex].balance <= 0) {
            updatedCards[cardIndex].isActive = false;
        }
        setGiftCards(updatedCards);
    }

    const newOrder: Order = {
        id: generateId(),
        ...orderData,
        status: 'paid',
        date: new Date().toISOString(),
    };
    
    setOrders(prev => [newOrder, ...prev]);
    setCart([]);
    setView(ViewState.SUCCESS);
    
    // Simulated Backend Notifications
    console.log(`[MAILER] Sending confirmation to ${orderData.customer.email}`);
    console.log(`[ADMIN] New Order Alert: ${newOrder.id}`);
  };

  const performAdminLogin = () => {
    setIsAdmin(true);
    setShowAdminLogin(false);
    setView(ViewState.ADMIN_DASHBOARD);
  };

  return (
    <div className="min-h-screen bg-brand-offWhite flex flex-col font-sans">
      {!ageVerified && <AgeVerificationModal onVerify={handleAgeVerify} />}
      
      {showAdminLogin && (
          <AdminLoginModal 
            onLogin={performAdminLogin} 
            onCancel={() => setShowAdminLogin(false)} 
          />
      )}
      
      {!view.startsWith('ADMIN') && (
        <Navbar 
            cartCount={cart.reduce((a, b) => a + b.quantity, 0)} 
            onViewChange={setView} 
            isAdmin={isAdmin}
            onAdminClick={() => isAdmin ? setView(ViewState.ADMIN_DASHBOARD) : setShowAdminLogin(true)}
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
                    <div className="text-4xl mb-4">🌿</div>
                    <h3 className="text-xl font-bold mb-2 text-gray-800">Cultivated Purity</h3>
                    <p className="text-gray-600">Grown in small batches in our private, climate-controlled gardens.</p>
                  </div>
                  <div className="p-8 bg-white rounded-xl shadow-lg border-b-4 border-brand-green hover:-translate-y-2 transition duration-300">
                    <div className="text-4xl mb-4">🥣</div>
                    <h3 className="text-xl font-bold mb-2 text-gray-800">Handmade Daily</h3>
                    <p className="text-gray-600">Baked fresh every morning by our expert culinary team.</p>
                  </div>
                   <div className="p-8 bg-white rounded-xl shadow-lg border-b-4 border-brand-lime hover:-translate-y-2 transition duration-300">
                    <div className="text-4xl mb-4">🔬</div>
                    <h3 className="text-xl font-bold mb-2 text-gray-800">Lab Verified</h3>
                    <p className="text-gray-600">Every batch is tested for consistent potency and safety.</p>
                  </div>
               </div>
            </div>
          </>
        )}

        {view === ViewState.SHOP && (
          <Shop products={products} addToCart={addToCart} />
        )}

        {view === ViewState.CHECKOUT && (
          <Checkout 
            cart={cart} 
            updateQuantity={updateCartQuantity} 
            shippingFee={shippingFee}
            onPlaceOrder={handlePlaceOrder}
            giftCards={giftCards}
          />
        )}

        {view === ViewState.SUCCESS && (
          <div className="container mx-auto text-center py-24 px-4">
            <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 text-5xl shadow-lg animate-bounce">✓</div>
            <h2 className="text-4xl font-brand text-brand-green mb-4">Order Received!</h2>
            <p className="text-xl text-gray-600 mb-8 max-w-md mx-auto">Thank you for choosing Home Grown Creations. We've sent a confirmation email with your tracking details.</p>
            <button onClick={() => setView(ViewState.HOME)} className="bg-brand-gold px-10 py-3 rounded-full font-bold text-brand-green hover:bg-brand-lime transition shadow-md">Return to Home</button>
          </div>
        )}

        {/* Admin Views */}
        {view === ViewState.ADMIN_DASHBOARD && <AdminDashboard stats={stats} onViewChange={setView} />}
        {view === ViewState.ADMIN_PRODUCTS && <AdminProducts products={products} setProducts={setProducts} updateShippingFee={setShippingFee} currentFee={shippingFee} onViewChange={setView} />}
        {view === ViewState.ADMIN_ORDERS && <AdminOrders orders={orders} onViewChange={setView} />}
      </main>

      {!view.startsWith('ADMIN') && <Footer onAdminClick={() => isAdmin ? setView(ViewState.ADMIN_DASHBOARD) : setShowAdminLogin(true)} />}
    </div>
  );
};

export default App;
