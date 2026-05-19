/**
 * Top-up sisa rak Ahhas biar genap 50. Filter rak per kategori pakai
 * STRICT name-match (bukan code-prefix yang kena false positive kalau
 * 2 kategori berbagi prefix 2 huruf, mis. AK-01 Aki vs AK-02 Aksesoris).
 *
 * Usage: npx tsx prisma/seed-ahhas-racks-topup.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGETS: Record<string, { prefix: string; target: number }> = {
  Aki: { prefix: "AK", target: 6 },
  Aksesoris: { prefix: "AS", target: 8 },
  Ban: { prefix: "BA", target: 6 },
  Busi: { prefix: "BU", target: 6 },
  Filter: { prefix: "FI", target: 6 },
  "Kampas Rem": { prefix: "KA", target: 6 },
  Lampu: { prefix: "LA", target: 6 },
  Oli: { prefix: "OL", target: 6 },
};

const SUB_NAMES: Record<string, string[]> = {
  Aki: ["Motor Bebek/Matic", "Motor Sport/Big", "Aki Kering MF", "Mobil Standar", "Mobil Premium", "Cadangan"],
  Aksesoris: ["Helm", "Jas Hujan & Sarung Tangan", "Body & Spakbor", "Spion & Kunci", "Karpet & Stiker", "Klakson & Elektrik", "Touring & Bag", "Lainnya"],
  Ban: ["Ban Matic 14\"", "Ban Sport 17\"", "Ban Premium", "Ban Dalam", "Ban Mobil", "Cadangan"],
  Busi: ["Busi Motor Matic", "Busi Motor Sport", "Busi Iridium", "Busi MotoDX", "Busi Mobil", "Cadangan"],
  Filter: ["Filter Udara Motor", "Filter Oli Motor", "Filter Bensin", "Filter Udara Mobil", "Filter AC Mobil", "Cadangan"],
  "Kampas Rem": ["Depan Matic", "Belakang Matic", "Depan Sport", "Tromol", "Kampas Mobil", "Kopling"],
  Lampu: ["LED Motor Matic", "LED Motor Sport", "Halogen Motor", "Sein & Rem", "HID Mobil", "Cadangan"],
  Oli: ["Matic 0.8L", "Manual/Gear", "Sintetik/Premium", "Final Drive", "Mobil", "Cadangan"],
};

async function main() {
  const ahhas = await prisma.company.findFirst({
    where: { name: { contains: "Ahhas", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!ahhas) return;
  const branch = await prisma.branch.findFirst({
    where: { companyId: ahhas.id, isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!branch) return;

  let totalAdded = 0;

  for (const [categoryName, cfg] of Object.entries(TARGETS)) {
    // STRICT match: rak yang code prefix EXACT (mis. "AS-") atau name
    // contains kategori AND code starts dengan prefix-nya kategori.
    const existing = await prisma.rack.findMany({
      where: {
        companyId: ahhas.id,
        branchId: branch.id,
        OR: [
          { code: { startsWith: `${cfg.prefix}-` } },
          // Untuk rak lama yang mungkin pakai naming pattern lain
          // (mis. "Rak Aki" tanpa prefix yang konsisten).
          {
            AND: [
              { name: { startsWith: "Rak " } },
              { name: { contains: categoryName, mode: "insensitive" } },
              { name: { not: { contains: "—" } } }, // exclude sub-named (sudah migrate)
            ],
          },
        ],
      },
      select: { code: true },
    });

    // De-dupe via code, dan filter strict: code yang BENAR-BENAR prefix cfg.prefix
    // OR name yang explicitly cocok kategori.
    const dedup = Array.from(new Set(existing.map((r) => r.code)));
    const current = dedup.length;

    if (current >= cfg.target) {
      console.log(`${categoryName}: ${current}/${cfg.target} — sudah cukup`);
      continue;
    }

    const used = new Set(dedup);
    let idx = 1;
    while (dedup.length < cfg.target) {
      let code: string;
      do {
        code = `${cfg.prefix}-${String(idx).padStart(2, "0")}`;
        idx++;
      } while (used.has(code));
      used.add(code);

      const subs = SUB_NAMES[categoryName] ?? [];
      const subName = subs[dedup.length] ?? `Slot ${dedup.length + 1}`;

      await prisma.rack.create({
        data: {
          branchId: branch.id,
          companyId: ahhas.id,
          code,
          name: `Rak ${categoryName} — ${subName}`,
          location: `Section ${cfg.prefix}`,
          isActive: true,
        },
      });
      dedup.push(code);
      totalAdded++;
      console.log(`  + ${code} (${categoryName} — ${subName})`);
    }
  }

  const finalCount = await prisma.rack.count({ where: { companyId: ahhas.id } });
  console.log(`\nTotal racks now: ${finalCount}`);
  console.log(`Added in this run: ${totalAdded}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
