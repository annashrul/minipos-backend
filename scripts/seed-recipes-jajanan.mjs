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
  "Tahu Sumedang (10 pcs)": [
    I("Tahu Putih", 0.25),
    I("Tepung Terigu Segitiga", 0.04),
    I("Bawang Putih", 0.005),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.025),
  ],
  "Tempe Mendoan (5 pcs)": [
    I("Tempe Mendoan", 0.18),
    I("Tepung Terigu Segitiga", 0.05),
    I("Daun Bawang", 0.005),
    I("Bawang Putih", 0.005),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.025),
  ],
  "Bakwan Sayur (5 pcs)": [
    I("Tepung Terigu Segitiga", 0.08),
    I("Kol Putih", 0.04),
    I("Wortel", 0.03),
    I("Daun Bawang", 0.005),
    I("Bawang Putih", 0.005),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.025),
  ],
  "Cireng Bumbu Rujak": [
    I("Tepung Terigu Segitiga", 0.1, "proxy kanji"),
    I("Bawang Putih", 0.005),
    I("Cabai Merah Keriting", 0.008),
    I("Cabai Rawit", 0.005),
    I("Gula Pasir", 0.01),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.025),
  ],
  "Batagor Bandung": [
    I("Tahu Putih", 0.06),
    I("Ikan Tongkol", 0.04),
    I("Tepung Terigu Segitiga", 0.04),
    I("Bawang Putih", 0.005),
    I("Saos Sambal Botol 1L", 0.012),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.02),
  ],
  "Siomay Bandung": [
    I("Ikan Tongkol", 0.06),
    I("Tahu Putih", 0.05),
    I("Kentang Granola", 0.04),
    I("Kol Putih", 0.03),
    I("Tepung Terigu Segitiga", 0.02),
    I("Bawang Putih", 0.005),
    I("Saos Sambal Botol 1L", 0.012),
    I("Garam Halus", 0.002),
  ],
  "Kebab Daging Sapi": [
    I("Daging Sapi Has Dalam", 0.08),
    I("Tepung Terigu Segitiga", 0.05, "tortilla"),
    I("Kol Putih", 0.02),
    I("Tomat Merah", 0.02),
    I("Bawang Merah", 0.005),
    I("Saos Sambal Botol 1L", 0.012),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.005),
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
