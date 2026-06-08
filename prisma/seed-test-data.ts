import { PrismaClient, PromoType, DebtType, DebtStatus } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seed data uji untuk halaman PROMO, PENGELUARAN, dan HUTANG-PIUTANG.
 *
 * Jalankan:  npx tsx prisma/seed-test-data.ts ["Nama Company"]
 *  - Tanpa argumen → pakai company milik user sesi (email di bawah), atau
 *    company pertama bila tidak ketemu.
 *  - Dengan argumen → cari company yang namanya mengandung argumen tsb.
 *
 * Idempotent: semua record diberi marker "[Test]" dan dihapus dulu tiap run,
 * jadi aman dijalankan berulang tanpa menumpuk / bentrok voucherCode unik.
 */
const COMPANY_ARG = process.argv[2];
const SESSION_EMAIL = "rekrutmen.mvd@proton.me";
const MARK = "[Test]";

const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * 86_400_000);
const daysAhead = (n: number) => new Date(now + n * 86_400_000);

async function resolveCompany() {
  if (COMPANY_ARG) {
    const c = await prisma.company.findFirst({
      where: { name: { contains: COMPANY_ARG, mode: "insensitive" } },
    });
    if (c) return c;
    console.warn(`! Company "${COMPANY_ARG}" tidak ditemukan, pakai fallback.`);
  }
  const u = await prisma.user.findUnique({
    where: { email: SESSION_EMAIL },
    select: { companyId: true },
  });
  if (u?.companyId) {
    const c = await prisma.company.findUnique({ where: { id: u.companyId } });
    if (c) return c;
  }
  return prisma.company.findFirst();
}

async function main() {
  const company = await resolveCompany();
  if (!company) {
    console.error("Tidak ada company di database. Batal.");
    process.exit(1);
  }
  const companyId = company.id;

  const user = await prisma.user.findFirst({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  if (!user) {
    console.error(`Company "${company.name}" tidak punya user. Batal.`);
    process.exit(1);
  }
  const branch = await prisma.branch.findFirst({
    where: { companyId },
    select: { id: true },
  });
  const branchId = branch?.id ?? null;
  // Suffix unik per company untuk voucherCode (yang unik global).
  const suffix = companyId.replace(/-/g, "").slice(0, 5).toUpperCase();

  console.log(
    `→ Seed ke company "${company.name}" (${companyId}) · user ${user.name} · branch ${branchId ?? "-"}`,
  );

  // ─── Bersihkan data uji lama ─────────────────────────────────────────
  await prisma.promotion.deleteMany({
    where: { companyId, name: { startsWith: MARK } },
  });
  await prisma.expense.deleteMany({
    where: { companyId, description: { startsWith: MARK } },
  });
  // payments cascade saat debt dihapus
  await prisma.debt.deleteMany({
    where: { companyId, description: { startsWith: MARK } },
  });

  // ─── PROMO ───────────────────────────────────────────────────────────
  const promos = [
    {
      name: `${MARK} Diskon 10% Semua Item`,
      type: PromoType.DISCOUNT_PERCENT,
      value: 10,
      minPurchase: 50_000,
      maxDiscount: 20_000,
      startDate: daysAgo(7),
      endDate: daysAhead(30),
    },
    {
      name: `${MARK} Potongan Rp15.000`,
      type: PromoType.DISCOUNT_AMOUNT,
      value: 15_000,
      minPurchase: 100_000,
      startDate: daysAgo(3),
      endDate: daysAhead(14),
    },
    {
      name: `${MARK} Voucher HEMAT25`,
      type: PromoType.VOUCHER,
      value: 25_000,
      minPurchase: 75_000,
      voucherCode: `HEMAT25${suffix}`,
      usageLimit: 100,
      usageCount: 12,
      startDate: daysAgo(5),
      endDate: daysAhead(20),
    },
    {
      name: `${MARK} Beli 2 Gratis 1`,
      type: PromoType.BUY_X_GET_Y,
      value: 0,
      buyQty: 2,
      getQty: 1,
      startDate: daysAgo(2),
      endDate: daysAhead(10),
    },
    {
      name: `${MARK} Paket Bundle Hemat`,
      type: PromoType.BUNDLE,
      value: 30_000,
      minPurchase: 150_000,
      startDate: daysAgo(1),
      endDate: daysAhead(25),
    },
    {
      name: `${MARK} Diskon 30% (Kedaluwarsa)`,
      type: PromoType.DISCOUNT_PERCENT,
      value: 30,
      minPurchase: 0,
      startDate: daysAgo(40),
      endDate: daysAgo(5), // sudah lewat → tampil sebagai expired
    },
  ];
  for (const p of promos) {
    await prisma.promotion.create({
      data: {
        companyId,
        scope: "all",
        isActive: true,
        description: `${MARK} promo data uji`,
        ...(branchId ? { branchId } : {}),
        ...p,
      },
    });
  }

  // ─── PENGELUARAN ─────────────────────────────────────────────────────
  const expenses: Array<{ category: string; amount: number; days: number }> = [
    { category: "Listrik", amount: 850_000, days: 1 },
    { category: "Air", amount: 220_000, days: 2 },
    { category: "Gaji Karyawan", amount: 6_500_000, days: 3 },
    { category: "Sewa Tempat", amount: 4_000_000, days: 5 },
    { category: "ATK", amount: 175_000, days: 6 },
    { category: "Transportasi", amount: 320_000, days: 8 },
    { category: "Internet", amount: 400_000, days: 10 },
    { category: "Pemeliharaan Mesin", amount: 1_250_000, days: 12 },
    { category: "Bahan Bakar", amount: 500_000, days: 15 },
    { category: "Lain-lain", amount: 95_000, days: 20 },
  ];
  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        companyId,
        category: e.category,
        description: `${MARK} ${e.category} bulan ini`,
        amount: e.amount,
        date: daysAgo(e.days),
        createdBy: user.id,
        ...(branchId ? { branchId } : {}),
      },
    });
  }

  // ─── HUTANG / PIUTANG ────────────────────────────────────────────────
  type DebtSeed = {
    type: DebtType;
    partyType: string;
    partyName: string;
    total: number;
    paid: number;
    status: DebtStatus;
    dueDays: number; // negatif = sudah lewat
    withPayment?: boolean;
  };
  const debts: DebtSeed[] = [
    // Piutang (orang berhutang ke kita)
    { type: DebtType.RECEIVABLE, partyType: "CUSTOMER", partyName: `${MARK} Budi Santoso`, total: 500_000, paid: 0, status: DebtStatus.UNPAID, dueDays: 14 },
    { type: DebtType.RECEIVABLE, partyType: "CUSTOMER", partyName: `${MARK} Siti Aminah`, total: 1_000_000, paid: 400_000, status: DebtStatus.PARTIAL, dueDays: 7, withPayment: true },
    { type: DebtType.RECEIVABLE, partyType: "CUSTOMER", partyName: `${MARK} Warung Bu Tini`, total: 750_000, paid: 0, status: DebtStatus.OVERDUE, dueDays: -10 },
    { type: DebtType.RECEIVABLE, partyType: "CUSTOMER", partyName: `${MARK} Toko Maju Jaya`, total: 300_000, paid: 300_000, status: DebtStatus.PAID, dueDays: -3, withPayment: true },
    // Hutang (kita berhutang ke supplier)
    { type: DebtType.PAYABLE, partyType: "SUPPLIER", partyName: `${MARK} CV Sumber Rejeki`, total: 2_000_000, paid: 0, status: DebtStatus.UNPAID, dueDays: 21 },
    { type: DebtType.PAYABLE, partyType: "SUPPLIER", partyName: `${MARK} PT Distributor Pangan`, total: 1_500_000, paid: 500_000, status: DebtStatus.PARTIAL, dueDays: 5, withPayment: true },
    { type: DebtType.PAYABLE, partyType: "SUPPLIER", partyName: `${MARK} Toko Grosir Murah`, total: 900_000, paid: 0, status: DebtStatus.OVERDUE, dueDays: -7 },
    { type: DebtType.PAYABLE, partyType: "SUPPLIER", partyName: `${MARK} UD Berkah`, total: 600_000, paid: 600_000, status: DebtStatus.PAID, dueDays: -15, withPayment: true },
  ];
  for (const d of debts) {
    const debt = await prisma.debt.create({
      data: {
        companyId,
        type: d.type,
        partyType: d.partyType,
        partyName: d.partyName,
        description: `${MARK} ${d.type === DebtType.RECEIVABLE ? "piutang" : "hutang"} data uji`,
        totalAmount: d.total,
        paidAmount: d.paid,
        remainingAmount: d.total - d.paid,
        status: d.status,
        dueDate: daysAhead(d.dueDays),
        createdBy: user.id,
        referenceType: "OTHER",
        ...(branchId ? { branchId } : {}),
      },
      select: { id: true },
    });
    if (d.withPayment && d.paid > 0) {
      await prisma.debtPayment.create({
        data: {
          debtId: debt.id,
          amount: d.paid,
          method: "CASH",
          notes: `${MARK} pembayaran data uji`,
          paidBy: user.id,
          paidAt: daysAgo(2),
        },
      });
    }
  }

  console.log(
    `✓ Selesai: ${promos.length} promo · ${expenses.length} pengeluaran · ${debts.length} hutang/piutang`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
