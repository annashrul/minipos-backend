import fs from "node:fs";

const TOKEN = fs.readFileSync("D:/tmp/token.txt", "utf8").trim();
const BASE = "http://localhost:4000/api";
const BRANCH_ID = "bcbcd874-c654-48aa-82c3-cf1bc6bf02b2"; // Cabang Utama
const COMPANY_ID = "9488e252-50bd-445a-b80f-94619b64b2af";
const CAT_MAKANAN = "31c40317-a5a3-47e3-b155-06d4d31f4df9";

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const POST = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  return r.json();
};
const PATCH = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "PATCH", headers: H, body: JSON.stringify(body) });
  return r.json();
};
const PUT = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
  return r.json();
};
const GET = async (path) => {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  return r.json();
};

// ─── STEP 1: tambah 7 ingredient baru ───
const newIngredients = [
  { name: "Jeruk Peras",       purchasePrice: 18000, unit: "kg",    stock: 20, minStock: 3 },
  { name: "Singkong",          purchasePrice: 8000,  unit: "kg",    stock: 30, minStock: 5 },
  { name: "Tepung Ketan Rose Brand", purchasePrice: 20000, unit: "kg", stock: 15, minStock: 3 },
  { name: "Keju Mozzarella",   purchasePrice: 95000, unit: "kg",    stock: 5,  minStock: 1 },
  { name: "Sosis Sapi",        purchasePrice: 60000, unit: "kg",    stock: 5,  minStock: 1, notes: "proxy pepperoni" },
  { name: "Saus Tomat Pizza",  purchasePrice: 35000, unit: "botol", stock: 10, minStock: 2 },
  { name: "Margarin Blueband", purchasePrice: 28000, unit: "kg",    stock: 10, minStock: 2 },
];

console.log("=== STEP 1: insert ingredient baru ===");
const newIngIds = {};
for (const ing of newIngredients) {
  const resp = await POST("/products", {
    name: ing.name,
    categoryId: CAT_MAKANAN,
    purchasePrice: ing.purchasePrice,
    sellingPrice: 0,
    unit: ing.unit,
    stock: ing.stock,
    minStock: ing.minStock,
    itemType: "INGREDIENT",
    isActive: true,
  });
  if (resp.data) {
    newIngIds[ing.name] = resp.data.id;
    console.log(`  OK  [${resp.data.code}] ${ing.name}  stock=${ing.stock}`);
  } else {
    console.log(`  ERR ${ing.name} → ${JSON.stringify(resp)}`);
  }
}

// ─── STEP 2: assign branchSkus Cabang Utama untuk 7 ingredient baru ───
console.log("\n=== STEP 2: assign ingredient baru ke Cabang Utama ===");
for (const [name, id] of Object.entries(newIngIds)) {
  const ing = newIngredients.find((x) => x.name === name);
  const resp = await PATCH(`/products/${id}`, {
    branchSkus: [
      {
        branchId: BRANCH_ID,
        sellingPrice: 0,
        purchasePrice: ing.purchasePrice,
        stock: ing.stock,
        minStock: ing.minStock,
        isActive: true,
      },
    ],
  });
  console.log(`  ${resp.data ? "OK" : "ERR"}  ${name}`);
}

// ─── STEP 3: refresh ingredient lookup ───
console.log("\n=== STEP 3: refresh ingredient lookup ===");
const ingResp = await GET("/products?itemType=INGREDIENT&perPage=200");
const ings = Object.fromEntries(
  ingResp.data.items.map((p) => [p.name, { id: p.id, unit: p.unit }]),
);
const menuResp = await GET("/products?itemType=PRODUCT&perPage=200");
const menus = Object.fromEntries(
  menuResp.data.items.map((p) => [p.name, { id: p.id, unit: p.unit }]),
);
console.log(`  ingredient=${Object.keys(ings).length}, menu=${Object.keys(menus).length}`);

const I = (name, quantity, notes) => {
  const i = ings[name];
  if (!i) throw new Error(`Ingredient missing: ${name}`);
  return { ingredientId: i.id, quantity, unit: i.unit, notes: notes ?? null };
};

// ─── STEP 4: insert 15 resep ───
const recipes = {
  // Minuman
  "Kopi Hitam Sachet": [
    I("Kopi Bubuk Robusta", 0.012),
    I("Gula Pasir", 0.012),
  ],
  "Es Kopi Susu Gula Aren": [
    I("Kopi Bubuk Robusta", 0.015),
    I("Susu Kental Manis Frisian Flag", 0.1, "~10% kaleng"),
    I("Gula Pasir", 0.02),
    I("Es Batu Kristal 5kg", 0.04),
  ],
  "Cappuccino Hot": [
    I("Kopi Bubuk Robusta", 0.018),
    I("Susu Kental Manis Frisian Flag", 0.12),
    I("Gula Pasir", 0.015),
  ],
  "Teh Manis Hangat": [
    I("Teh Celup Sariwangi", 0.04, "1 kantong dari 25 isi"),
    I("Gula Pasir", 0.015),
  ],
  "Es Teh Manis": [
    I("Teh Celup Sariwangi", 0.04),
    I("Gula Pasir", 0.015),
    I("Es Batu Kristal 5kg", 0.03),
  ],
  "Es Jeruk Segar": [
    I("Jeruk Peras", 0.15, "~3 jeruk peras"),
    I("Gula Pasir", 0.02),
    I("Es Batu Kristal 5kg", 0.04),
  ],

  // Roti & Pizza
  "Roti'O Original": [
    I("Tepung Terigu Segitiga", 0.05),
    I("Telur Ayam Ras", 0.005),
    I("Gula Pasir", 0.01),
    I("Margarin Blueband", 0.005),
    I("Susu Kental Manis Frisian Flag", 0.02),
    I("Kopi Bubuk Robusta", 0.002, "olesan topping kopi"),
  ],
  "Pizza Pepperoni Personal": [
    I("Tepung Terigu Segitiga", 0.12, "adonan dough"),
    I("Margarin Blueband", 0.01),
    I("Telur Ayam Ras", 0.02),
    I("Saus Tomat Pizza", 0.1),
    I("Keju Mozzarella", 0.08),
    I("Sosis Sapi", 0.06, "proxy pepperoni"),
    I("Bawang Putih", 0.003),
    I("Garam Halus", 0.002),
  ],

  // Oleh-oleh (made in-house version)
  "Telur Asin Brebes (6 pcs)": [
    I("Telur Ayam Ras", 0.3, "6 butir ~50g"),
    I("Garam Halus", 0.05),
  ],
  "Tahu Bakso Semarang (12 pcs)": [
    I("Tahu Putih", 0.4, "12 tahu putih"),
    I("Bakso Sapi Frozen", 0.12, "digiling jadi adonan isi"),
    I("Tepung Terigu Segitiga", 0.03),
    I("Telur Ayam Ras", 0.02),
    I("Bawang Putih", 0.005),
    I("Garam Halus", 0.003),
    I("Minyak Goreng Bimoli 2L", 0.015),
  ],
  "Lumpia Semarang (5 pcs)": [
    I("Tepung Terigu Segitiga", 0.08, "kulit lumpia"),
    I("Telur Ayam Ras", 0.02),
    I("Ayam Potong Segar", 0.05, "isian (proxy udang)"),
    I("Kol Putih", 0.03),
    I("Wortel", 0.02),
    I("Daun Bawang", 0.005),
    I("Bawang Putih", 0.005),
    I("Kecap Manis ABC 600ml", 0.01),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.02),
  ],
  "Wingko Babat (10 pcs)": [
    I("Tepung Ketan Rose Brand", 0.15),
    I("Kelapa Parut", 0.1),
    I("Gula Pasir", 0.08),
    I("Telur Ayam Ras", 0.04),
    I("Margarin Blueband", 0.02),
    I("Garam Halus", 0.002),
  ],
  "Peuyeum Bandung 1 kg": [
    I("Singkong", 1.0, "1 kg singkong segar"),
    I("Gula Pasir", 0.01, "untuk fermentasi"),
  ],
  "Moci Sukabumi (12 pcs)": [
    I("Tepung Ketan Rose Brand", 0.2),
    I("Gula Pasir", 0.08),
    I("Kelapa Parut", 0.04, "taburan"),
    I("Margarin Blueband", 0.01),
    I("Garam Halus", 0.001),
  ],
  "Keripik Tempe Malang 250g": [
    I("Tempe Mendoan", 0.18, "1 papan tempe diiris tipis"),
    I("Tepung Terigu Segitiga", 0.05),
    I("Bawang Putih", 0.005),
    I("Garam Halus", 0.003),
    I("Minyak Goreng Bimoli 2L", 0.05, "deep fry"),
  ],
};

console.log(`\n=== STEP 4: insert ${Object.keys(recipes).length} resep ===`);
let ok = 0,
  err = 0;
for (const [name, ingredients] of Object.entries(recipes)) {
  const m = menus[name];
  if (!m) {
    console.log(`  SKIP (menu hilang): ${name}`);
    err++;
    continue;
  }
  const resp = await PUT(`/products/${m.id}/recipe`, {
    yieldQty: 1,
    ingredients,
  });
  if (resp.data) {
    const cost = Math.round(resp.data.costPerPortion).toLocaleString("id-ID");
    console.log(`  OK  ${name.padEnd(34)} ${ingredients.length} bhn  cost/porsi Rp ${cost}`);
    ok++;
  } else {
    console.log(`  ERR ${name} → ${JSON.stringify(resp)}`);
    err++;
  }
}
console.log(`\nTotal resep: OK=${ok} ERR=${err}`);
