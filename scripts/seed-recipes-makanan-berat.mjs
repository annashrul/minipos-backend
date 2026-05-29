import fs from "node:fs";

const TOKEN = fs.readFileSync("/tmp/token.txt", "utf8").trim();
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

const menus = loadTsv("/tmp/menu.tsv");
const ings = loadTsv("/tmp/ing.tsv");

const I = (name, quantity, notes) => {
  const i = ings[name];
  if (!i) throw new Error(`Ingredient missing: ${name}`);
  return { ingredientId: i.id, quantity, unit: i.unit, notes: notes ?? null };
};

// MAKANAN BERAT (per 1 porsi) — referensi SajianSedap/Cookpad
const recipes = {
  "Nasi Padang Rendang": [
    I("Beras Premium", 0.1),
    I("Daging Sapi Has Dalam", 0.1),
    I("Santan Kara 200ml", 1),
    I("Bumbu Rendang Jadi", 0.2),
    I("Bawang Merah", 0.008),
    I("Bawang Putih", 0.004),
    I("Cabai Merah Keriting", 0.01),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.005),
  ],
  "Nasi Padang Ayam Pop": [
    I("Beras Premium", 0.1),
    I("Ayam Potong Segar", 0.2),
    I("Bawang Putih", 0.006),
    I("Santan Kara 200ml", 0.5),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.015),
  ],
  "Soto Ayam": [
    I("Ayam Potong Segar", 0.08),
    I("Bihun Jagung", 0.04),
    I("Bumbu Soto Jadi", 0.25),
    I("Telur Ayam Ras", 0.05),
    I("Kol Putih", 0.03),
    I("Daun Bawang", 0.005),
    I("Bawang Merah", 0.005),
    I("Bawang Putih", 0.003),
    I("Garam Halus", 0.002),
  ],
  "Sop Buntut": [
    I("Beras Premium", 0.1),
    I("Daging Sapi Has Dalam", 0.2),
    I("Wortel", 0.05),
    I("Kentang Granola", 0.05),
    I("Tomat Merah", 0.03),
    I("Daun Bawang", 0.008),
    I("Bawang Merah", 0.005),
    I("Bawang Putih", 0.003),
    I("Garam Halus", 0.003),
  ],
  "Rawon Daging": [
    I("Beras Premium", 0.1),
    I("Daging Sapi Has Dalam", 0.12),
    I("Bumbu Rendang Jadi", 0.15, "proxy bumbu rawon"),
    I("Bawang Merah", 0.008),
    I("Bawang Putih", 0.005),
    I("Daun Bawang", 0.005),
    I("Garam Halus", 0.002),
  ],
  "Ayam Goreng Kremes": [
    I("Beras Premium", 0.1),
    I("Ayam Potong Segar", 0.2),
    I("Tepung Terigu Segitiga", 0.05),
    I("Telur Ayam Ras", 0.05),
    I("Bawang Putih", 0.005),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.025),
  ],
  "Ayam Bakar Madu": [
    I("Beras Premium", 0.1),
    I("Ayam Potong Segar", 0.2),
    I("Kecap Manis ABC 600ml", 0.03),
    I("Bawang Putih", 0.006),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.008),
  ],
  "Nasi Goreng Spesial": [
    I("Beras Premium", 0.1),
    I("Telur Ayam Ras", 0.05),
    I("Ayam Potong Segar", 0.05),
    I("Kecap Manis ABC 600ml", 0.025),
    I("Bawang Merah", 0.008),
    I("Bawang Putih", 0.004),
    I("Cabai Merah Keriting", 0.005),
    I("Kol Putih", 0.02),
    I("Daun Bawang", 0.005),
    I("Tomat Merah", 0.01),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.01),
  ],
  "Mie Goreng Jawa": [
    I("Mie Telur Kering", 0.1),
    I("Telur Ayam Ras", 0.05),
    I("Ayam Potong Segar", 0.04),
    I("Kecap Manis ABC 600ml", 0.025),
    I("Bawang Merah", 0.008),
    I("Bawang Putih", 0.004),
    I("Cabai Rawit", 0.005),
    I("Kol Putih", 0.02),
    I("Daun Bawang", 0.005),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.01),
  ],
  "Kwetiau Goreng Seafood": [
    I("Kwetiau Basah", 0.15),
    I("Ikan Tongkol", 0.05),
    I("Telur Ayam Ras", 0.05),
    I("Kecap Manis ABC 600ml", 0.025),
    I("Kol Putih", 0.03),
    I("Daun Bawang", 0.005),
    I("Bawang Merah", 0.008),
    I("Bawang Putih", 0.004),
    I("Garam Halus", 0.002),
    I("Minyak Goreng Bimoli 2L", 0.012),
  ],
  "Sate Ayam (10 tusuk)": [
    I("Ayam Potong Segar", 0.25),
    I("Kecap Manis ABC 600ml", 0.05),
    I("Bawang Merah", 0.015),
    I("Bawang Putih", 0.008),
    I("Garam Halus", 0.003),
    I("Minyak Goreng Bimoli 2L", 0.008),
  ],
  "Sate Kambing (10 tusuk)": [
    I("Daging Kambing", 0.25),
    I("Kecap Manis ABC 600ml", 0.05),
    I("Tomat Merah", 0.04),
    I("Bawang Merah", 0.015),
    I("Bawang Putih", 0.008),
    I("Garam Halus", 0.003),
  ],
  "Bakso Urat Spesial": [
    I("Bakso Sapi Frozen", 0.12),
    I("Mie Telur Kering", 0.05),
    I("Bihun Jagung", 0.03),
    I("Daun Bawang", 0.005),
    I("Bawang Putih", 0.004),
    I("Saos Sambal Botol 1L", 0.015),
    I("Garam Halus", 0.002),
  ],
  "Mie Ayam Bakso": [
    I("Mie Telur Kering", 0.1),
    I("Ayam Potong Segar", 0.06),
    I("Bakso Sapi Frozen", 0.05),
    I("Kecap Manis ABC 600ml", 0.015),
    I("Daun Bawang", 0.005),
    I("Bawang Putih", 0.004),
    I("Garam Halus", 0.002),
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
