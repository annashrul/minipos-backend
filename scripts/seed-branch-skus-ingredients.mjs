import fs from "node:fs";

const TOKEN = fs.readFileSync("D:/tmp/token.txt", "utf8").trim();
const BASE = "http://localhost:4000/api";
const BRANCH_ID = "bcbcd874-c654-48aa-82c3-cf1bc6bf02b2"; // Cabang Utama

// Fetch all INGREDIENT items with current price/stock.
const listResp = await fetch(
  `${BASE}/products?itemType=INGREDIENT&perPage=200`,
  { headers: { Authorization: `Bearer ${TOKEN}` } },
);
const listJson = await listResp.json();
const items = listJson.data.items;
console.log(`Found ${items.length} INGREDIENT items`);

let ok = 0,
  err = 0;
for (const p of items) {
  const body = {
    branchSkus: [
      {
        branchId: BRANCH_ID,
        sellingPrice: p.sellingPrice ?? 0,
        purchasePrice: p.purchasePrice,
        stock: p.stock,
        minStock: p.minStock ?? 5,
        isActive: true,
      },
    ],
  };
  const resp = await fetch(`${BASE}/products/${p.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (json.data) {
    ok++;
    console.log(`  OK  ${p.name.padEnd(34)} stock=${p.stock}`);
  } else {
    err++;
    console.log(`  ERR ${p.name} → ${JSON.stringify(json)}`);
  }
}
console.log(`\nTotal: OK=${ok} ERR=${err}`);
