import fs from "node:fs";

const TOKEN = fs.readFileSync("D:/tmp/token.txt", "utf8").trim();
const BASE = "http://localhost:4000/api";

const loadTsv = (path) =>
  Object.fromEntries(
    fs
      .readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const [id, name, unit] = line.split("\t");
        return [name, { id, unit }];
      }),
  );

const menus = loadTsv("D:/tmp/menu.tsv");
const ings = loadTsv("D:/tmp/ing.tsv");

const I = (name, quantity, notes) => {
  const i = ings[name];
  if (!i) throw new Error(`Ingredient missing: ${name}`);
  return { ingredientId: i.id, quantity, unit: i.unit, notes: notes ?? null };
};

const recipes = {
  "Ayam Krispi Original": [
    I("Ayam Potong Segar", 0.15),
    I("Tepung Terigu Segitiga", 0.05),
    I("Telur Ayam Ras", 0.03),
    I("Bawang Putih", 0.005),
    I("Garam Halus", 0.003),
    I("Minyak Goreng Bimoli 2L", 0.03),
  ],
  "Burger Beef Double": [
    I("Daging Sapi Has Dalam", 0.12, "2 patty"),
    I("Tepung Terigu Segitiga", 0.06, "bun"),
    I("Telur Ayam Ras", 0.02),
    I("Kol Putih", 0.02),
    I("Tomat Merah", 0.02),
    I("Saos Sambal Botol 1L", 0.012),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.005),
  ],
  "Kentang Goreng Medium": [
    I("Kentang Granola", 0.15),
    I("Minyak Goreng Bimoli 2L", 0.02),
    I("Garam Halus", 0.002),
  ],
  "Donat Cokelat Glazed": [
    I("Tepung Terigu Segitiga", 0.06),
    I("Telur Ayam Ras", 0.02),
    I("Gula Pasir", 0.015),
    I("Minyak Goreng Bimoli 2L", 0.008),
  ],
  "Donat Mix (6 pcs)": [
    I("Tepung Terigu Segitiga", 0.35),
    I("Telur Ayam Ras", 0.12),
    I("Gula Pasir", 0.09),
    I("Minyak Goreng Bimoli 2L", 0.045),
  ],
};

let ok = 0,
  err = 0;
for (const [name, ingredients] of Object.entries(recipes)) {
  const m = menus[name];
  if (!m) {
    console.log(`SKIP (menu hilang): ${name}`);
    err++;
    continue;
  }
  const resp = await fetch(`${BASE}/products/${m.id}/recipe`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ yieldQty: 1, ingredients }),
  });
  const json = await resp.json();
  if (json.data) {
    const cost = Math.round(json.data.costPerPortion).toLocaleString("id-ID");
    console.log(`  OK  ${name.padEnd(28)} ${ingredients.length} bhn  cost/porsi Rp ${cost}`);
    ok++;
  } else {
    console.log(`  ERR ${name} → ${JSON.stringify(json)}`);
    err++;
  }
}
console.log(`\nTotal: OK=${ok} ERR=${err} (dari ${Object.keys(recipes).length} menu)`);
