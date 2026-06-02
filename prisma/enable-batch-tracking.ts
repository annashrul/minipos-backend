import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Aktifkan Product.trackBatch untuk pengujian fitur batch/FEFO.
// Pakai: tsx prisma/enable-batch-tracking.ts [kodeProduk]
// - Tanpa argumen: ambil 1 produk fisik (itemType PRODUCT) pertama yang aktif.
// - Dengan argumen: cari produk dengan code = argumen.
async function main() {
  const code = process.argv[2];

  const product = code
    ? await prisma.product.findFirst({
        where: { code, deletedAt: null },
        select: { id: true, code: true, name: true, trackBatch: true },
      })
    : await prisma.product.findFirst({
        where: { itemType: "PRODUCT", isActive: true, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, code: true, name: true, trackBatch: true },
      });

  if (!product) {
    console.error("Produk tidak ditemukan.");
    process.exit(1);
  }

  await prisma.product.update({
    where: { id: product.id },
    data: { trackBatch: true },
  });

  console.log("trackBatch DIAKTIFKAN untuk produk:");
  console.log(`  id    : ${product.id}`);
  console.log(`  code  : ${product.code}`);
  console.log(`  name  : ${product.name}`);
  console.log(
    "\nLangkah berikutnya: terima barang (PO → penerimaan) untuk produk ini,",
  );
  console.log("lalu jual via POS, lalu buka halaman Batch & Kedaluwarsa.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
