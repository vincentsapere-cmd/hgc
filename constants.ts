import { Product, GiftCard } from './types';

export const INITIAL_SHIPPING_FEE = 15.00;

// Hardcoded "Database" of products based on user prompt
export const INITIAL_PRODUCTS: Product[] = [
  // Cookies
  { id: 'c1', name: 'Lemon Clouds w/ Strawberries', category: 'Cookies', price: 8.50, mg: 50, isActive: true },
  { id: 'c2', name: 'Lemon Clouds w/ Blueberries', category: 'Cookies', price: 8.50, mg: 50, isActive: true },
  { id: 'c3', name: 'Honey Orange Ginger', category: 'Cookies', price: 8.50, mg: 50, isActive: true },
  { id: 'c4', name: 'Carrot Cake Sandwich', category: 'Cookies', price: 12.00, mg: 60, isActive: true },
  { id: 'c5', name: 'Peanut Chocolate Pinwheel', category: 'Cookies', price: 8.50, mg: 50, isActive: true },
  { id: 'c6', name: 'Oatmeal Cream Pies', category: 'Cookies', price: 11.00, mg: 50, isActive: true },
  { id: 'c7', name: 'Black & White', category: 'Cookies', price: 15.00, mg: 100, isActive: true },
  
  // Live Rosin Infused Cookies
  { id: 'rc1', name: 'Pistachio Shortbread Cookie', category: 'Rosin Cookies', price: 9.00, mg: 50, isActive: true },
  { id: 'rc2', name: 'Butter Cookies', category: 'Rosin Cookies', price: 9.00, mg: 50, isActive: true },
  { id: 'rc3', name: 'Coconut Almond Macaroons', category: 'Rosin Cookies', price: 9.50, mg: 65, isActive: true },
  { id: 'rc4', name: 'Fudge Rounds *GF*', category: 'Rosin Cookies', price: 15.00, mg: 75, isActive: true },
  { id: 'rc5', name: 'Twix - Caramel', category: 'Rosin Cookies', price: 12.00, mg: 50, isActive: true },
  { id: 'rc6', name: 'Twix - Peanut Butter', category: 'Rosin Cookies', price: 12.00, mg: 50, isActive: true },

  // Chocolates
  { id: 'ch1', name: 'Dubai Bar (Pistachio)', category: 'Chocolates', price: 15.00, mg: 45, isActive: true },
  { id: 'ch2', name: 'Italian Hazelnut Cream Filled', category: 'Chocolates', price: 10.00, mg: 25, isActive: true },
  { id: 'ch3', name: 'Strawberry Pistachio Chocolate', category: 'Chocolates', price: 12.00, mg: 50, isActive: true },
  
  // Chocolate Bars
  { id: 'cb1', name: 'Sugar Free Chocolate', unit: '22g', category: 'Chocolates', price: 11.00, mg: 50, isActive: true },
  { id: 'cb2', name: '54.5% Dark Chocolate', unit: '22g', category: 'Chocolates', price: 10.00, mg: 50, isActive: true },
  { id: 'cb3', name: '54.5% Dark Chocolate', unit: '51g', category: 'Chocolates', price: 25.00, mg: 250, isActive: true },
  { id: 'cb4', name: '54.5% Dark Chocolate', unit: '51g', category: 'Chocolates', price: 50.00, mg: 500, isActive: true },
  { id: 'cb5', name: 'Milk Chocolate', unit: '22g', category: 'Chocolates', price: 10.00, mg: 50, isActive: true },

  // Pastries (Variations)
  { id: 'p1', name: 'Babka Bread', category: 'Pastries', price: 45.00, mg: 425, isActive: true, hasVariations: true, variations: ['Blueberry', 'Callebaut Chocolate', 'Apple Cinnamon'] },
  { id: 'p2', name: 'Brioche Knot Chocolate', category: 'Pastries', price: 10.00, mg: 40, isActive: true },
  { id: 'p3', name: 'Giant 4in Muffin', category: 'Pastries', price: 12.00, mg: 50, isActive: true, hasVariations: true, variations: ['Blueberry', 'Chocolate Chip', 'Banana Nut'] },
  { id: 'p4', name: 'Doughnut Hash Holes', category: 'Pastries', price: 15.00, mg: 60, isActive: true, hasVariations: true, variations: ['Chocolate', 'Plain', 'Glazed'] },

  // Beverages
  { id: 'b1', name: 'Blackberry Bellini', unit: '10mg', category: 'Beverages', price: 6.00, mg: 10, isActive: true },
  { id: 'b2', name: 'Blackberry Bellini', unit: '25mg', category: 'Beverages', price: 10.00, mg: 25, isActive: true },
  { id: 'b3', name: 'Herbal Tea Box Sampler', category: 'Beverages', price: 80.00, mg: 100, isActive: true },
  
  // Syrups
  { id: 's1', name: 'Pumpkin Spice Latte Syrup', category: 'Syrups', price: 20.00, mg: 80, isActive: true },
  { id: 's2', name: 'Apple Cinnamon Simple Syrup', category: 'Syrups', price: 20.00, mg: 80, isActive: true },

  // Candy
  { id: 'cn1', name: 'Raspberry Bubble Gum', category: 'Candy', price: 9.00, mg: 20, isActive: true },
  { id: 'cn2', name: 'Roasted Strawberry Lollipop', category: 'Candy', price: 10.00, mg: 35, isActive: true },
  { id: 'cn3', name: 'Small Lozenge Candies', category: 'Candy', price: 25.00, mg: 120, isActive: true, hasVariations: true, variations: ['Strawberry', 'Blueberry', 'Cherry'] },

  // Crackers
  { id: 'cr1', name: 'Cheddar Crackers', category: 'Snacks', price: 20.00, mg: 150, isActive: true },
  { id: 'cr2', name: 'Gluten-Free Cheddar Crackers', category: 'Snacks', price: 23.00, mg: 150, isActive: true },

  // Infusions
  { id: 'i1', name: 'Infused Peanut Butter', unit: '1/4 cup', category: 'Infusions', price: 38.00, mg: 460, isActive: true },
  { id: 'i2', name: 'Infused Honey', unit: '1/2 cup', category: 'Infusions', price: 50.00, mg: 400, isActive: true },

  // Topicals
  { id: 't1', name: 'Muscle Rub Salve', unit: '1 oz', category: 'Topicals', price: 40.00, mg: 150, isActive: true },

  // Ice Cream
  { id: 'ic1', name: 'Choco Tacos', category: 'Ice Cream', price: 15.00, mg: 30, isActive: true }
];

// Mock Secure Gift Card Database (In production this is a hashed SQL table)
export const VALID_GIFT_CARDS: GiftCard[] = [
  { code: 'HGC-100-ABC', balance: 100.00, isActive: true },
  { code: 'HGC-50-XYZ', balance: 50.00, isActive: true },
  { code: 'HGC-25-TEST', balance: 25.00, isActive: true }
];
