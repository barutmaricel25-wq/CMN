// Deterministic demo seed: 6 branches, users per role, ~60 products,
// customers of each type, plus 14 days of generated sales/movement history.
import {
  DB, Branch, User, Product, Customer, InventoryRow, StockMovement, Sale, SaleItem,
  OnlineOrder, Category, CustomerType, Attendance,
} from "./types";

// Small seeded PRNG so every fresh demo looks the same.
function mulberry32(a: number) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = (n: number) => Math.round(n * 100); // pesos -> centavos

const BRANCH_DEFS = [
  ["Main Branch", "123 Mabini St, Poblacion", 14.5995, 120.9842],
  ["Branch 2 - Market", "45 Public Market Rd", 14.6021, 120.9868],
  ["Branch 3 - Highway", "88 National Highway", 14.5958, 120.9812],
  ["Branch 4 - Plaza", "7 Plaza Rizal", 14.6042, 120.9825],
  ["Branch 5 - Terminal", "21 Terminal Ave", 14.5977, 120.9891],
  ["Branch 6 - Riverside", "9 Riverside Dr", 14.6008, 120.9799],
] as const;

// [sku, barcode, name, brand, category, unit, size, retail, wholesale, suki, cost, threshold]
type Row = [string, string, string, string, Category, string, string, number, number, number | null, number, number];
const PRODUCT_DEFS: Row[] = [
  // dry food
  ["DF001", "4800011230011", "Adult Beef & Vegetables Dry Dog Food", "Pedigree", "dry food", "sack", "10kg", 1650, 1520, 1580, 1380, 5],
  ["DF002", "4800011230028", "Adult Beef & Vegetables Dry Dog Food", "Pedigree", "dry food", "pack", "3kg", 545, 495, 520, 440, 10],
  ["DF003", "4800011230035", "Puppy Chicken & Milk Dry Food", "Pedigree", "dry food", "pack", "3kg", 575, 525, 550, 465, 10],
  ["DF004", "4806530190017", "Value Meal Beef & Liver Dog Food", "Vitality", "dry food", "sack", "20kg", 2150, 1980, 2050, 1800, 4],
  ["DF005", "4806530190024", "Classic Pro Adult Dog Food", "Vitality", "dry food", "sack", "15kg", 2380, 2200, 2280, 1990, 4],
  ["DF006", "8850477010013", "SmartHeart Power Pack Adult", "SmartHeart", "dry food", "sack", "20kg", 2480, 2300, 2380, 2080, 4],
  ["DF007", "4809015430012", "Nutri Chunks Premium Adult Chicken", "Nutri Chunks", "dry food", "sack", "8kg", 1150, 1050, 1100, 940, 6],
  ["DF008", "4806529210014", "Aozi Organic Adult Dog Food", "Aozi", "dry food", "sack", "8kg", 1680, 1550, 1600, 1400, 4],
  ["DF009", "7896029033012", "Monello Premium Adult Dog", "Monello", "dry food", "sack", "15kg", 2650, 2450, 2550, 2200, 3],
  ["DF010", "4800888120014", "Beefpro Adult Maintenance", "Beefpro", "dry food", "sack", "20kg", 1980, 1820, 1900, 1650, 4],
  ["DF011", "8850477020012", "Me-O Persian Adult Cat Food", "Me-O", "dry food", "pack", "1.1kg", 385, 350, 365, 305, 12],
  ["DF012", "8850477020029", "Me-O Tuna Adult Cat Food", "Me-O", "dry food", "sack", "7kg", 1550, 1430, 1480, 1280, 5],
  ["DF013", "4800011560019", "Whiskas Ocean Fish Adult", "Whiskas", "dry food", "pack", "1.2kg", 420, 385, 400, 335, 12],
  ["DF014", "4806529310011", "Special Cat Premium Adult", "Special Cat", "dry food", "sack", "8kg", 1180, 1080, 1130, 960, 6],
  ["DF015", "8850477030011", "SmartHeart Cat Seafood", "SmartHeart", "dry food", "pack", "1.2kg", 335, 305, 320, 265, 12],
  ["DF016", "4809015440011", "Cuchi Gourmet Adult Cat", "Cuchi", "dry food", "pack", "1kg", 295, 268, 280, 232, 12],
  // wet food
  ["WF001", "4800011340017", "Chicken & Liver Chunks in Gravy Can", "Pedigree", "wet food", "can", "400g", 92, 82, 87, 70, 24],
  ["WF002", "4800011340024", "Puppy Pouch Chicken in Gravy", "Pedigree", "wet food", "pouch", "130g", 42, 36, 39, 29, 48],
  ["WF003", "4800011570016", "Whiskas Tuna Can", "Whiskas", "wet food", "can", "400g", 98, 88, 93, 75, 24],
  ["WF004", "4800011570023", "Whiskas Tuna Pouch", "Whiskas", "wet food", "pouch", "80g", 32, 27, 30, 22, 48],
  ["WF005", "4806529220013", "Aozi Pure Organic Wet Dog Can", "Aozi", "wet food", "can", "430g", 105, 95, 100, 82, 24],
  ["WF006", "8853301004305", "Moochie Kitten Mousse Tuna", "Moochie", "wet food", "pouch", "70g", 35, 30, 33, 24, 48],
  ["WF007", "9556158010014", "Princess Wet Cat Food Sardine", "Princess", "wet food", "can", "400g", 68, 60, 64, 50, 24],
  ["WF008", "8850477040010", "Me-O Tuna & Chicken Pouch", "Me-O", "wet food", "pouch", "80g", 30, 26, 28, 21, 48],
  // treats
  ["TR001", "8852397001013", "Jerhigh Chicken Stick", "Jerhigh", "treats", "pack", "70g", 95, 85, 90, 72, 15],
  ["TR002", "8852397001020", "Jerhigh Milky Stick", "Jerhigh", "treats", "pack", "70g", 95, 85, 90, 72, 15],
  ["TR003", "4800011350016", "Dentastix Medium 3s", "Pedigree", "treats", "pack", "77g", 85, 75, 80, 64, 15],
  ["TR004", "8850477050019", "Me-O Creamy Treats Tuna 4s", "Me-O", "treats", "pack", "60g", 65, 57, 61, 47, 20],
  ["TR005", "4806529410018", "Papi Dog Biscuit Round", "Papi", "treats", "tub", "500g", 145, 130, 138, 112, 10],
  ["TR006", "8858781100017", "Temptations Seafood Medley", "Temptations", "treats", "pack", "85g", 165, 150, 158, 132, 10],
  // litter & accessories
  ["LT001", "8888300870015", "Clumping Cat Litter Lavender", "Kit Cat", "litter & accessories", "bag", "10L", 385, 350, 368, 305, 8],
  ["LT002", "8888300870022", "Clumping Cat Litter Charcoal", "Kit Cat", "litter & accessories", "bag", "10L", 385, 350, 368, 305, 8],
  ["LT003", "4806529510015", "Cat Litter Pan with Rim (Large)", "Petto", "litter & accessories", "pc", "Large", 320, 285, 300, 240, 5],
  ["LT004", "4806529510022", "Litter Scoop Plastic", "Petto", "litter & accessories", "pc", "Std", 45, 38, 42, 28, 10],
  // grooming/cleaning
  ["GR001", "4806528880018", "Madre de Cacao Dog & Cat Shampoo", "Saint Roche", "grooming/cleaning", "bottle", "1050ml", 480, 440, 460, 385, 8],
  ["GR002", "4806528880025", "Premium Organic Shampoo Sweet Embrace", "Saint Roche", "grooming/cleaning", "bottle", "628ml", 330, 300, 315, 260, 8],
  ["GR003", "4809014550012", "Papi Shampoo with Conditioner", "Papi", "grooming/cleaning", "bottle", "500ml", 165, 148, 156, 125, 10],
  ["GR004", "4806529610013", "Slicker Brush Medium", "Petto", "grooming/cleaning", "pc", "M", 130, 112, 120, 90, 6],
  ["GR005", "4806529610020", "Nail Clipper with Guard", "Petto", "grooming/cleaning", "pc", "Std", 110, 95, 102, 75, 6],
  ["GR006", "4806529610037", "Pet Wipes Antibacterial 80s", "Petto", "grooming/cleaning", "pack", "80 sheets", 120, 105, 112, 85, 10],
  // health
  ["HL001", "4809013340019", "LC-Vit Multivitamins Syrup", "LC-Vit", "health", "bottle", "120ml", 155, 140, 148, 118, 10],
  ["HL002", "4809013340026", "Coat Shine Syrup", "LC-Vit", "health", "bottle", "120ml", 165, 148, 156, 125, 10],
  ["HL003", "8853301220011", "Goat's Milk Replacer for Puppies", "PetLac", "health", "tin", "300g", 425, 390, 408, 340, 6],
  ["HL004", "8853301220028", "Goat's Milk Replacer for Kittens", "PetLac", "health", "tin", "300g", 425, 390, 408, 340, 6],
  ["HL005", "3661103049944", "Frontline Plus for Dogs 10-20kg", "Frontline", "health", "pipette", "1 dose", 495, 460, 478, 400, 8],
  ["HL006", "4809013350018", "Heartgard Plus Chewable Medium", "Heartgard", "health", "chew", "1 dose", 320, 295, 308, 255, 8],
  ["HL007", "4809013360017", "Doxycycline 100mg Capsule (Vet)", "VetRx", "health", "capsule", "100mg", 18, 15, 16, 11, 50],
  // carriers & cages
  ["CC001", "4806529710010", "Pet Carrier Plastic (Medium)", "Petto", "carriers & cages", "pc", "M", 850, 780, 815, 660, 3],
  ["CC002", "4806529710027", "Foldable Wire Cage (Large)", "Petto", "carriers & cages", "pc", "L", 1450, 1320, 1380, 1120, 3],
  ["CC003", "4806529710034", "Foldable Wire Cage (XL)", "Petto", "carriers & cages", "pc", "XL", 1950, 1780, 1860, 1520, 2],
  // collars/leash/harness
  ["CL001", "4806529810017", "Nylon Collar with Bell (Small)", "Petto", "collars/leash/harness", "pc", "S", 75, 64, 70, 48, 10],
  ["CL002", "4806529810024", "Nylon Leash 1.5m (Medium)", "Petto", "collars/leash/harness", "pc", "M", 120, 105, 112, 82, 10],
  ["CL003", "4806529810031", "Body Harness with Leash (Medium)", "Petto", "collars/leash/harness", "set", "M", 210, 185, 198, 150, 8],
  ["CL004", "4806529810048", "Retractable Leash 5m", "Petto", "collars/leash/harness", "pc", "5m", 340, 305, 322, 250, 5],
  // toys & scratchers
  ["TY001", "4806529910014", "Rubber Bone Chew Toy", "Petto", "toys & scratchers", "pc", "M", 95, 82, 88, 62, 10],
  ["TY002", "4806529910021", "Cat Teaser Wand Feather", "Petto", "toys & scratchers", "pc", "Std", 65, 55, 60, 40, 10],
  ["TY003", "4806529910038", "Corrugated Cat Scratcher Board", "Petto", "toys & scratchers", "pc", "Std", 150, 132, 141, 105, 8],
  ["TY004", "4806529910045", "Tennis Ball 2-pack for Dogs", "Petto", "toys & scratchers", "pack", "2 pcs", 85, 72, 78, 55, 10],
  // bowls & feeding
  ["BW001", "4806530010011", "Stainless Bowl (Medium)", "Petto", "bowls & feeding", "pc", "M", 95, 82, 88, 62, 12],
  ["BW002", "4806530010028", "Double Diner Plastic Bowl", "Petto", "bowls & feeding", "pc", "Std", 145, 128, 136, 102, 8],
  ["BW003", "4806530010035", "Gravity Water Dispenser 3.8L", "Petto", "bowls & feeding", "pc", "3.8L", 380, 345, 362, 285, 5],
  ["BW004", "4806530010042", "Slow Feeder Bowl", "Petto", "bowls & feeding", "pc", "M", 180, 160, 170, 130, 6],
  // cologne
  ["CG001", "4809014660018", "Puppy Cologne Baby Powder", "Happy Pets", "cologne", "bottle", "125ml", 130, 115, 122, 92, 10],
  ["CG002", "4809014660025", "Pet Cologne Bubble Gum", "Happy Pets", "cologne", "bottle", "125ml", 130, 115, 122, 92, 10],
  // other
  ["OT001", "4806530110018", "Training Pads 10s", "Petto", "other", "pack", "10 pcs", 220, 198, 209, 165, 8],
  ["OT002", "4806530110025", "Poop Bags Roll 3-pack", "Petto", "other", "pack", "3 rolls", 95, 82, 88, 60, 10],
];

const CUSTOMER_DEFS: [string, string, CustomerType, string, string][] = [
  ["Aling Nena Sari-Sari Store", "09171234501", "wholesaler", "Blk 4 Lot 2, Poblacion", "Orders weekly, sacks only"],
  ["Kuya Ben Pet Shop", "09181234502", "wholesaler", "Stall 12, Public Market", "Prefers Vitality & SmartHeart"],
  ["Mang Tomas Agrivet", "09191234503", "wholesaler", "National Highway", "COD via own driver"],
  ["Maria Santos", "09201234504", "suki", "Unit 3B, Plaza Rizal Apts", "3 cats — Me-O & Whiskas"],
  ["Jun dela Cruz", "09211234505", "suki", "9 Riverside Dr", "Aspin owner, buys Pedigree 3kg"],
  ["Grace Lim", "09221234506", "suki", "Terminal Ave", "Persian cat, Kit Cat litter monthly"],
  ["Robert Tan", "09231234507", "suki", "Mabini St", "2 shih tzus, Saint Roche shampoo"],
  ["Ana Reyes", "09241234508", "retail", "", "Walk-in"],
  ["Paolo Garcia", "09251234509", "retail", "", "Occasional buyer"],
  ["Liza Mercado", "09261234510", "suki", "Poblacion", "Kitten milk replacer regular"],
];

export function buildSeed(): DB {
  const rand = mulberry32(20260722);
  const now = Date.now();

  const branches: Branch[] = BRANCH_DEFS.map((b, i) => ({
    id: `b${i + 1}`,
    name: b[0],
    address: b[1],
    geofence_lat: b[2],
    geofence_lng: b[3],
    geofence_radius_m: 120,
    active: true,
  }));

  const users: User[] = [
    { id: "u-owner", name: "Carmen M. Nolasco", role: "owner", branch_id: null, pin: "9999", active: true },
  ];
  const managerNames = ["Rosa Vergara", "Dante Cruz", "Fe Ramos", "Nilo Bautista", "Tess Aquino", "Marlon Diaz"];
  const staffNames = [
    ["Joy Salazar", "Rico Ferrer"], ["Mika Ocampo", "Aldo Reyes"], ["Bea Torres", "Caloy Uy"],
    ["Dina Flores", "Erwin Go"], ["Faye Mateo", "Gino Silang"], ["Hana Perez", "Ivan Cruz"],
  ];
  branches.forEach((b, i) => {
    users.push({ id: `u-mgr-${i + 1}`, name: managerNames[i], role: "manager", branch_id: b.id, pin: String(1111 * (i + 1)).padStart(4, "0").slice(0, 4), active: true });
    staffNames[i].forEach((n, j) => {
      users.push({ id: `u-stf-${i + 1}-${j + 1}`, name: n, role: "staff", branch_id: b.id, pin: `${i + 1}${j + 1}${i + 1}${j + 1}`, active: true });
    });
  });

  const products: Product[] = PRODUCT_DEFS.map((r, i) => ({
    id: `p${i + 1}`,
    sku: r[0], barcode: r[1], name: r[2], brand: r[3], category: r[4], unit: r[5], size_variant: r[6],
    retail_price: P(r[7]), wholesale_price: P(r[8]), suki_price: r[9] === null ? null : P(r[9]),
    cost_price: P(r[10]), low_stock_threshold: r[11], image_url: null, active: true,
  }));

  const customers: Customer[] = CUSTOMER_DEFS.map((c, i) => ({
    id: `c${i + 1}`, name: c[0], phone: c[1], type: c[2], address: c[3], notes: c[4], active: true,
  }));

  // Inventory: stockroom + storefront rows per product per branch.
  const inventory: InventoryRow[] = [];
  const movements: StockMovement[] = [];
  branches.forEach((b) => {
    products.forEach((p) => {
      const base = p.low_stock_threshold;
      // A few items intentionally at/below threshold so low-stock screens have content.
      const lowItem = rand() < 0.12;
      const stockQty = lowItem ? Math.floor(rand() * base) : base * 2 + Math.floor(rand() * base * 3);
      const frontQty = lowItem ? Math.floor(rand() * 2) : Math.floor(base / 2) + Math.floor(rand() * base);
      inventory.push({ id: `inv-${b.id}-${p.id}-sr`, product_id: p.id, branch_id: b.id, location: "stockroom", qty: stockQty });
      inventory.push({ id: `inv-${b.id}-${p.id}-sf`, product_id: p.id, branch_id: b.id, location: "storefront", qty: frontQty });
    });
  });

  // 14 days of sales history per branch (writes sale + sale_items + sale movements).
  const sales: Sale[] = [];
  const sale_items: SaleItem[] = [];
  const receipt_counters: Record<string, number> = {};
  branches.forEach((b) => (receipt_counters[b.id] = 0));

  const payMethods = ["cash", "cash", "cash", "gcash", "bank_transfer"] as const;
  for (let day = 13; day >= 0; day--) {
    branches.forEach((b, bi) => {
      const nSales = 4 + Math.floor(rand() * 6);
      for (let s = 0; s < nSales; s++) {
        const ts = new Date(now - day * 86400000 - (9 - Math.floor(rand() * 9)) * 3600000 - Math.floor(rand() * 3600000));
        if (ts.getTime() > now) continue;
        const cust = rand() < 0.3 ? customers[Math.floor(rand() * customers.length)] : null;
        const tier: CustomerType = cust ? cust.type : "retail";
        const nItems = 1 + Math.floor(rand() * 3);
        let subtotal = 0;
        const saleId = `seed-sale-${b.id}-${day}-${s}`;
        const itemsForSale: SaleItem[] = [];
        for (let it = 0; it < nItems; it++) {
          const p = products[Math.floor(rand() * products.length)];
          const qty = p.retail_price > P(1000) ? 1 : 1 + Math.floor(rand() * 3);
          const price = tier === "wholesaler" ? p.wholesale_price : tier === "suki" ? (p.suki_price ?? p.retail_price) : p.retail_price;
          subtotal += price * qty;
          itemsForSale.push({ id: `${saleId}-i${it}`, sale_id: saleId, product_id: p.id, qty, unit_price: price, price_tier_applied: tier });
          movements.push({
            id: `${saleId}-m${it}`, product_id: p.id, branch_id: b.id,
            from_location: "storefront", to_location: null, qty,
            type: "sale", reference_id: saleId,
            performed_by: `u-stf-${bi + 1}-1`, approved_by: null, note: null,
            created_at: ts.toISOString(),
          });
        }
        receipt_counters[b.id]++;
        sales.push({
          id: saleId, branch_id: b.id, channel: rand() < 0.2 ? "online" : "onsite",
          customer_id: cust?.id ?? null, cashier_id: `u-stf-${bi + 1}-${1 + Math.floor(rand() * 2)}`,
          subtotal, discount: 0, total: subtotal,
          payment_method: payMethods[Math.floor(rand() * payMethods.length)],
          status: "completed", receipt_no: receipt_counters[b.id],
          voided_by: null, void_reason: null, created_at: ts.toISOString(),
        });
        sale_items.push(...itemsForSale);
      }
    });
  }

  // A few live online orders on the Main Branch board.
  const online_orders: OnlineOrder[] = [
    {
      id: "oo1", branch_id: "b1", customer_id: "c4", source: "messenger", status: "received",
      items: [{ product_id: "p11", qty: 2, unit_price: products[10].suki_price! }, { product_id: "p31", qty: 1, unit_price: products[30].suki_price! }],
      total: products[10].suki_price! * 2 + products[30].suki_price!,
      payment_method: "gcash", payment_proof_url: null, payment_verified_by: null,
      packed_photo_url: null, courier_note: "", sale_id: null,
      status_history: [{ status: "received", at: new Date(now - 3600000).toISOString(), by: "u-stf-1-1" }],
      created_at: new Date(now - 3600000).toISOString(),
    },
    {
      id: "oo2", branch_id: "b1", customer_id: "c1", source: "viber", status: "preparing",
      items: [{ product_id: "p4", qty: 5, unit_price: products[3].wholesale_price }],
      total: products[3].wholesale_price * 5,
      payment_method: "bank_transfer", payment_proof_url: null, payment_verified_by: null,
      packed_photo_url: null, courier_note: "Lalamove pickup 3pm", sale_id: null,
      status_history: [
        { status: "received", at: new Date(now - 7200000).toISOString(), by: "u-stf-1-1" },
        { status: "preparing", at: new Date(now - 5400000).toISOString(), by: "u-stf-1-2" },
      ],
      created_at: new Date(now - 7200000).toISOString(),
    },
    {
      id: "oo3", branch_id: "b1", customer_id: "c6", source: "call", status: "ready_awaiting_payment",
      items: [{ product_id: "p31", qty: 2, unit_price: products[30].suki_price! }],
      total: products[30].suki_price! * 2,
      payment_method: "gcash", payment_proof_url: null, payment_verified_by: null,
      packed_photo_url: null, courier_note: "", sale_id: null,
      status_history: [
        { status: "received", at: new Date(now - 10800000).toISOString(), by: "u-stf-1-1" },
        { status: "preparing", at: new Date(now - 9000000).toISOString(), by: "u-stf-1-1" },
        { status: "ready_awaiting_payment", at: new Date(now - 7200000).toISOString(), by: "u-stf-1-1" },
      ],
      created_at: new Date(now - 10800000).toISOString(),
    },
  ];

  // Today's attendance (clock-ins this morning at each branch).
  const attendance: Attendance[] = [];
  branches.forEach((b, bi) => {
    for (let j = 1; j <= 2; j++) {
      const inTime = new Date(now - (now % 86400000)); // approx midnight UTC; fine for demo
      attendance.push({
        id: `att-${b.id}-${j}`, user_id: `u-stf-${bi + 1}-${j}`, branch_id: b.id, type: "in",
        selfie_url: null, lat: b.geofence_lat + (rand() - 0.5) * 0.0008, lng: b.geofence_lng + (rand() - 0.5) * 0.0008,
        within_geofence: rand() > 0.15, flagged: false, reviewed_by: null,
        device_info: "Seeded demo record",
        created_at: new Date(now - 5 * 3600000 - Math.floor(rand() * 1800000)).toISOString(),
      });
    }
  });
  attendance.forEach((a) => { a.flagged = !a.within_geofence; });

  return {
    seeded_at: new Date(now).toISOString(),
    branches, users, products, customers, inventory,
    stock_movements: movements,
    deliveries: [], delivery_items: [],
    transfers: [], transfer_items: [],
    sales, sale_items, online_orders, attendance,
    audit_log: [],
    settings: {
      receipt_header: "CMN Trading Corporation",
      receipt_footer: "This serves as your official receipt.\nThank you! Balik po kayo!",
      paper_width: "58mm",
      tax_label: "VAT-inclusive",
      bank_details: "BDO 0012-3456-7890 (CMN Trading Corp)",
      gcash_details: "GCash 0917-123-4567 (C. Nolasco)",
      low_stock_default: 5,
      monthly_target: 50000000, // ₱500,000 per branch per month
    },
    receipt_counters,
  };
}
