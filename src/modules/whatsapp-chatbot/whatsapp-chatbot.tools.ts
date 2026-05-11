import type Groq from "groq-sdk";
import type { PrismaService } from "../prisma/prisma.service";

// ─── Tool catalog ────────────────────────────────────────────────────
// Definisi function calling untuk Groq. Dipisah per role:
// - OWNER tools: data internal sensitif (stok, omset, transaksi).
// - CUSTOMER tools: lookup publik aman (daftar layanan, booking by phone).
// Saat assemble system message, kita gabungkan tool list sesuai role
// pengirim — supaya customer tidak bisa "ngintip" dengan trick prompt.

// Period enum yang didukung — backend resolve string ini ke range tanggal.
// AI tinggal pakai keyword tanpa harus tahu tanggal sekarang.
const PERIOD_ENUM = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "this_year",
  "last_7_days",
  "last_30_days",
  "all_time",
];

export const OWNER_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description:
        "Ringkasan penjualan untuk periode tertentu: total transaksi, total omset, rata-rata per transaksi. Pakai untuk pertanyaan tentang omset (hari ini, kemarin, minggu ini, bulan ini, dll). Default `today` kalau period tidak di-pass.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: PERIOD_ENUM,
            description:
              "Periode: today, yesterday, this_week, last_week, this_month, last_month, this_year, last_7_days, last_30_days, all_time. Default `today`.",
          },
          from: {
            type: "string",
            description:
              "Tanggal mulai ISO (YYYY-MM-DD). Override period kalau diisi bersama `to`.",
          },
          to: {
            type: "string",
            description:
              "Tanggal akhir ISO (YYYY-MM-DD). Override period kalau diisi bersama `from`.",
          },
          branchId: {
            type: "string",
            description: "Filter cabang. Kosongkan untuk semua cabang.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_products",
      description:
        "Daftar produk terlaris berdasarkan kuantitas terjual. Bisa filter periode (default 7 hari terakhir).",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: PERIOD_ENUM,
            description:
              "Periode (default last_7_days). Override `days` kalau diisi.",
          },
          days: {
            type: "number",
            description: "Hari ke belakang (default 7) — alternatif period",
          },
          limit: { type: "number", description: "Jumlah hasil (default 5)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock",
      description:
        "Daftar produk dengan stok di bawah minStock atau habis. Hanya produk fisik (itemType=PRODUCT).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Jumlah hasil (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_product_stock",
      description:
        "Cari produk berdasarkan nama/kode untuk cek stok dan harga jualnya.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Nama produk atau kode/barcode",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bookings",
      description:
        "Daftar booking untuk periode tertentu. Pakai untuk pertanyaan tentang booking (hari ini, kemarin, minggu ini, dll).",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: PERIOD_ENUM,
            description: "Periode (default today).",
          },
          from: {
            type: "string",
            description: "Tanggal mulai ISO (YYYY-MM-DD).",
          },
          to: {
            type: "string",
            description: "Tanggal akhir ISO (YYYY-MM-DD).",
          },
          status: {
            type: "string",
            description:
              "Filter status: PENDING/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED. Kosongkan untuk semua.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cashier_performance",
      description:
        "Ranking performa kasir berdasarkan total transaksi & omset dalam periode tertentu. Pakai untuk pertanyaan 'kasir terbaik', 'performa kasir bulan ini', 'siapa kasir paling banyak transaksi'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default last_30_days)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
          limit: { type: "number", description: "Jumlah top kasir (default 5)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_debts_summary",
      description:
        "Ringkasan hutang (yang kita berhutang ke supplier) dan piutang (yang customer berhutang ke kita). Total outstanding, jumlah debitor, dan list yang jatuh tempo. Pakai untuk 'berapa hutang', 'siapa yang masih hutang', 'piutang yang jatuh tempo'.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["PAYABLE", "RECEIVABLE", "ALL"],
            description:
              "PAYABLE = hutang kita ke supplier, RECEIVABLE = piutang customer ke kita, ALL = keduanya (default ALL)",
          },
          status: {
            type: "string",
            enum: ["UNPAID", "PARTIAL", "PAID", "OVERDUE", "ALL"],
            description: "Filter status (default UNPAID atau PARTIAL = outstanding)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_customers",
      description:
        "Customer paling banyak transaksi / total spending tertinggi dalam periode tertentu. Pakai untuk 'pelanggan terbaik', 'top customer', 'customer paling royal'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default last_30_days)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
          limit: { type: "number", description: "Jumlah hasil (default 5)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_expenses_summary",
      description:
        "Ringkasan pengeluaran operasional (expenses) per kategori dalam periode tertentu. Pakai untuk 'berapa pengeluaran', 'biaya operasional bulan ini', 'expense kategori apa paling besar'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default this_month)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
          category: { type: "string", description: "Filter kategori expense" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_customer",
      description:
        "Cari customer berdasarkan nama/nomor HP/email. Return ringkasan customer: total spending, jumlah transaksi, member level, terakhir transaksi.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Nama, nomor HP, atau email customer",
          },
        },
        required: ["query"],
      },
    },
  },
];

export const CUSTOMER_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_my_bookings",
      description:
        "Lihat booking aktif milik customer berdasarkan nomor WhatsApp pengirim. Tidak perlu input — backend pakai nomor pengirim otomatis.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_services",
      description:
        "Daftar jasa/service yang ditawarkan beserta harganya (untuk bisnis bengkel/jasa). HANYA produk tipe SERVICE.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Filter nama service (opsional)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description:
        "Cari produk fisik di katalog toko (oli, sparepart, aksesoris, dll). Pakai ini untuk pertanyaan customer seperti 'ada oli apa saja?', 'punya kampas rem motor honda?', 'jual aki kering nggak?'. Return nama, harga, deskripsi, dan ketersediaan (tersedia/habis — tidak expose jumlah stok).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Kata kunci nama produk (mis. 'oli', 'kampas rem', 'aki'). Wajib diisi untuk hasil relevan.",
          },
          category: {
            type: "string",
            description:
              "Filter nama kategori (opsional, mis. 'oli mesin', 'rem')",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_categories",
      description:
        "Daftar kategori produk yang dijual toko. Pakai saat customer bertanya 'jual apa saja?' atau ingin tahu jenis-jenis produk yang tersedia.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ─── Implementations ─────────────────────────────────────────────────

const fmtRp = (n: number) =>
  `Rp ${Math.round(n).toLocaleString("id-ID")}`;

/**
 * Resolve period keyword + optional from/to ISO ke range tanggal absolut.
 * AI tinggal pakai keyword ("yesterday", "this_month", dll) dan backend
 * yang compute boundaries — biar AI tidak perlu tahu tanggal sekarang.
 *
 * Return `null` untuk period "all_time" (caller skip date filter).
 */
function resolvePeriod(
  period: unknown,
  fromArg: unknown,
  toArg: unknown,
): { start: Date | null; end: Date | null; label: string } {
  // Custom range (from + to) menang atas period keyword.
  if (typeof fromArg === "string" && typeof toArg === "string") {
    const start = new Date(fromArg + "T00:00:00.000");
    const end = new Date(toArg + "T23:59:59.999");
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return {
        start,
        end,
        label: `${fromArg} s/d ${toArg}`,
      };
    }
  }

  const now = new Date();
  const p = typeof period === "string" ? period.toLowerCase() : "today";

  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  const endOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  };

  switch (p) {
    case "today": {
      return { start: startOfDay(now), end: endOfDay(now), label: "hari ini" };
    }
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y), label: "kemarin" };
    }
    case "this_week": {
      // Minggu Senin-Minggu (id-ID convention).
      const start = startOfDay(now);
      const dow = start.getDay(); // 0=Min, 1=Sen, ..., 6=Sab
      const monOffset = dow === 0 ? -6 : 1 - dow;
      start.setDate(start.getDate() + monOffset);
      return { start, end: endOfDay(now), label: "minggu ini" };
    }
    case "last_week": {
      const end = startOfDay(now);
      const dow = end.getDay();
      const monOffset = dow === 0 ? -6 : 1 - dow;
      end.setDate(end.getDate() + monOffset - 1); // Sunday minggu lalu
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return {
        start: startOfDay(start),
        end: endOfDay(end),
        label: "minggu lalu",
      };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { start, end: endOfDay(now), label: "bulan ini" };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return { start, end, label: "bulan lalu" };
    }
    case "this_year": {
      const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      return { start, end: endOfDay(now), label: "tahun ini" };
    }
    case "last_7_days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return {
        start: startOfDay(start),
        end: endOfDay(now),
        label: "7 hari terakhir",
      };
    }
    case "last_30_days": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return {
        start: startOfDay(start),
        end: endOfDay(now),
        label: "30 hari terakhir",
      };
    }
    case "all_time": {
      return { start: null, end: null, label: "semua waktu" };
    }
    default: {
      return { start: startOfDay(now), end: endOfDay(now), label: "hari ini" };
    }
  }
}

export type ToolContext = {
  prisma: PrismaService;
  companyId: string;
  // Nomor WA pengirim (normalized 62xxx). Dipakai oleh customer-tools
  // supaya `get_my_bookings` tidak butuh argumen.
  senderPhone: string | null;
};

export async function executeOwnerTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { prisma, companyId } = ctx;
  switch (name) {
    // Alias backward-compat: kalau model masih panggil get_today_sales,
    // forward ke get_sales_summary tanpa period (default today).
    case "get_today_sales":
    case "get_sales_summary": {
      const branchId =
        typeof args.branchId === "string" ? args.branchId : undefined;
      const { start, end, label } = resolvePeriod(
        args.period,
        args.from,
        args.to,
      );
      const rows = await prisma.transaction.findMany({
        where: {
          companyId,
          status: "COMPLETED",
          ...(start && end ? { createdAt: { gte: start, lte: end } } : {}),
          ...(branchId ? { branchId } : {}),
        },
        select: { grandTotal: true },
      });
      const total = rows.reduce((s, r) => s + r.grandTotal, 0);
      return {
        period: label,
        ...(start && end
          ? {
              from: start.toISOString().slice(0, 10),
              to: end.toISOString().slice(0, 10),
            }
          : {}),
        transactionCount: rows.length,
        totalRevenue: fmtRp(total),
        averagePerTransaction:
          rows.length > 0 ? fmtRp(total / rows.length) : fmtRp(0),
      };
    }

    case "get_top_products": {
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
      // Prefer period kalau di-pass; fallback ke `days` legacy param.
      let start: Date | null;
      let end: Date | null;
      let label: string;
      if (args.period || (args.from && args.to)) {
        const r = resolvePeriod(args.period, args.from, args.to);
        start = r.start;
        end = r.end;
        label = r.label;
      } else {
        const days = Math.max(1, Math.min(365, Number(args.days) || 7));
        start = new Date();
        start.setDate(start.getDate() - days);
        start.setHours(0, 0, 0, 0);
        end = new Date();
        end.setHours(23, 59, 59, 999);
        label = `${days} hari terakhir`;
      }
      const items = await prisma.transactionItem.findMany({
        where: {
          transaction: {
            companyId,
            status: "COMPLETED",
            ...(start && end
              ? { createdAt: { gte: start, lte: end } }
              : {}),
          },
        },
        select: {
          quantity: true,
          subtotal: true,
          product: { select: { name: true, code: true } },
        },
        take: 5000,
      });
      const map = new Map<string, { qty: number; revenue: number; code: string }>();
      for (const it of items) {
        const n = it.product?.name ?? "(unknown)";
        const e = map.get(n) ?? {
          qty: 0,
          revenue: 0,
          code: it.product?.code ?? "",
        };
        e.qty += it.quantity;
        e.revenue += it.subtotal;
        map.set(n, e);
      }
      const sorted = Array.from(map.entries())
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, limit)
        .map(([n, e]) => ({
          name: n,
          code: e.code,
          quantitySold: e.qty,
          revenue: fmtRp(e.revenue),
        }));
      return { period: label, items: sorted };
    }

    case "get_low_stock": {
      const limit = Math.max(1, Math.min(50, Number(args.limit) || 10));
      const products = await prisma.product.findMany({
        where: {
          companyId,
          isActive: true,
          itemType: "PRODUCT",
          deletedAt: null,
        },
        select: {
          name: true,
          code: true,
          stock: true,
          minStock: true,
          unit: true,
          sellingPrice: true,
        },
      });
      const low = products
        .filter((p) => p.stock <= p.minStock)
        .sort((a, b) => a.stock - b.stock)
        .slice(0, limit)
        .map((p) => ({
          name: p.name,
          code: p.code,
          stock: p.stock,
          minStock: p.minStock,
          unit: p.unit,
          status: p.stock === 0 ? "HABIS" : "MENIPIS",
        }));
      return { count: low.length, items: low };
    }

    case "search_product_stock": {
      const query = String(args.query || "").trim();
      if (!query) return { error: "Query kosong" };
      const products = await prisma.product.findMany({
        where: {
          companyId,
          isActive: true,
          deletedAt: null,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { code: { contains: query, mode: "insensitive" } },
            { barcode: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          name: true,
          code: true,
          stock: true,
          minStock: true,
          unit: true,
          sellingPrice: true,
          itemType: true,
        },
        take: 10,
      });
      return {
        items: products.map((p) => ({
          name: p.name,
          code: p.code,
          type: p.itemType === "SERVICE" ? "JASA" : "PRODUK",
          stock: p.itemType === "SERVICE" ? null : p.stock,
          unit: p.unit,
          sellingPrice: fmtRp(p.sellingPrice),
        })),
      };
    }

    // Alias backward-compat untuk get_today_bookings.
    case "get_today_bookings":
    case "get_bookings": {
      const status =
        typeof args.status === "string" ? args.status.toUpperCase() : undefined;
      const { start, end, label } = resolvePeriod(
        args.period,
        args.from,
        args.to,
      );
      const bookings = await prisma.booking.findMany({
        where: {
          companyId,
          ...(start && end
            ? { scheduledAt: { gte: start, lte: end } }
            : {}),
          ...(status ? { status } : {}),
        },
        select: {
          customerName: true,
          customerPhone: true,
          customer: { select: { name: true, phone: true } },
          scheduledAt: true,
          status: true,
          serviceType: true,
          bookingType: true,
        },
        orderBy: { scheduledAt: "asc" },
        take: 30,
      });
      return {
        period: label,
        ...(start && end
          ? {
              from: start.toISOString().slice(0, 10),
              to: end.toISOString().slice(0, 10),
            }
          : {}),
        count: bookings.length,
        items: bookings.map((b) => ({
          customer: b.customer?.name ?? b.customerName ?? "—",
          phone: b.customer?.phone ?? b.customerPhone ?? null,
          scheduledAt: b.scheduledAt.toISOString(),
          status: b.status,
          service: b.serviceType ?? null,
          type: b.bookingType,
        })),
      };
    }

    case "get_cashier_performance": {
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
      const { start, end, label } = resolvePeriod(
        args.period ?? "last_30_days",
        args.from,
        args.to,
      );
      const txs = await prisma.transaction.findMany({
        where: {
          companyId,
          status: "COMPLETED",
          ...(start && end ? { createdAt: { gte: start, lte: end } } : {}),
        },
        select: {
          grandTotal: true,
          userId: true,
          user: { select: { name: true } },
        },
        take: 10000,
      });
      const map = new Map<
        string,
        { name: string; transactionCount: number; totalSales: number }
      >();
      for (const t of txs) {
        const e = map.get(t.userId) ?? {
          name: t.user.name,
          transactionCount: 0,
          totalSales: 0,
        };
        e.transactionCount += 1;
        e.totalSales += t.grandTotal;
        map.set(t.userId, e);
      }
      const ranked = Array.from(map.values())
        .sort((a, b) => b.totalSales - a.totalSales)
        .slice(0, limit)
        .map((e) => ({
          name: e.name,
          transactionCount: e.transactionCount,
          totalSales: fmtRp(e.totalSales),
          avgPerTransaction:
            e.transactionCount > 0
              ? fmtRp(e.totalSales / e.transactionCount)
              : fmtRp(0),
        }));
      return { period: label, count: ranked.length, items: ranked };
    }

    case "get_debts_summary": {
      const type =
        typeof args.type === "string" ? args.type.toUpperCase() : "ALL";
      const statusArg =
        typeof args.status === "string" ? args.status.toUpperCase() : null;
      // Default: tampilkan yang masih outstanding (UNPAID + PARTIAL + OVERDUE).
      const statusFilter =
        statusArg && statusArg !== "ALL"
          ? { status: statusArg as "UNPAID" | "PARTIAL" | "PAID" | "OVERDUE" }
          : { status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] as ("UNPAID" | "PARTIAL" | "OVERDUE")[] } };

      const debts = await prisma.debt.findMany({
        where: {
          companyId,
          ...statusFilter,
          ...(type === "PAYABLE" || type === "RECEIVABLE"
            ? { type: type as "PAYABLE" | "RECEIVABLE" }
            : {}),
        },
        select: {
          type: true,
          partyName: true,
          totalAmount: true,
          paidAmount: true,
          remainingAmount: true,
          status: true,
          dueDate: true,
          createdAt: true,
        },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 100,
      });

      const totalPayable = debts
        .filter((d) => d.type === "PAYABLE")
        .reduce((s, d) => s + d.remainingAmount, 0);
      const totalReceivable = debts
        .filter((d) => d.type === "RECEIVABLE")
        .reduce((s, d) => s + d.remainingAmount, 0);
      const now = Date.now();
      const overdue = debts.filter(
        (d) => d.dueDate && d.dueDate.getTime() < now,
      );

      const top10 = debts.slice(0, 10).map((d) => ({
        type: d.type === "PAYABLE" ? "Hutang" : "Piutang",
        party: d.partyName,
        total: fmtRp(d.totalAmount),
        paid: fmtRp(d.paidAmount),
        remaining: fmtRp(d.remainingAmount),
        status: d.status,
        dueDate: d.dueDate ? d.dueDate.toISOString().slice(0, 10) : null,
      }));
      return {
        summary: {
          totalPayable: fmtRp(totalPayable),
          totalReceivable: fmtRp(totalReceivable),
          netPosition: fmtRp(totalReceivable - totalPayable),
          totalRecords: debts.length,
          overdueCount: overdue.length,
        },
        details: top10,
      };
    }

    case "get_top_customers": {
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
      const { start, end, label } = resolvePeriod(
        args.period ?? "last_30_days",
        args.from,
        args.to,
      );
      const txs = await prisma.transaction.findMany({
        where: {
          companyId,
          status: "COMPLETED",
          customerId: { not: null },
          ...(start && end ? { createdAt: { gte: start, lte: end } } : {}),
        },
        select: {
          grandTotal: true,
          customerId: true,
          customer: {
            select: { name: true, phone: true, memberLevel: true },
          },
        },
        take: 10000,
      });
      const map = new Map<
        string,
        {
          name: string;
          phone: string | null;
          memberLevel: string;
          transactionCount: number;
          totalSpending: number;
        }
      >();
      for (const t of txs) {
        if (!t.customerId || !t.customer) continue;
        const e = map.get(t.customerId) ?? {
          name: t.customer.name,
          phone: t.customer.phone,
          memberLevel: t.customer.memberLevel,
          transactionCount: 0,
          totalSpending: 0,
        };
        e.transactionCount += 1;
        e.totalSpending += t.grandTotal;
        map.set(t.customerId, e);
      }
      const ranked = Array.from(map.values())
        .sort((a, b) => b.totalSpending - a.totalSpending)
        .slice(0, limit)
        .map((e) => ({
          name: e.name,
          phone: e.phone,
          memberLevel: e.memberLevel,
          transactionCount: e.transactionCount,
          totalSpending: fmtRp(e.totalSpending),
        }));
      return { period: label, count: ranked.length, items: ranked };
    }

    case "get_expenses_summary": {
      const { start, end, label } = resolvePeriod(
        args.period ?? "this_month",
        args.from,
        args.to,
      );
      const category =
        typeof args.category === "string" ? args.category : undefined;
      const expenses = await prisma.expense.findMany({
        where: {
          companyId,
          ...(start && end ? { date: { gte: start, lte: end } } : {}),
          ...(category
            ? { category: { contains: category, mode: "insensitive" } }
            : {}),
        },
        select: { category: true, amount: true, description: true, date: true },
        take: 5000,
        orderBy: { date: "desc" },
      });
      const total = expenses.reduce((s, e) => s + e.amount, 0);
      const byCategory = new Map<string, { total: number; count: number }>();
      for (const e of expenses) {
        const c = byCategory.get(e.category) ?? { total: 0, count: 0 };
        c.total += e.amount;
        c.count += 1;
        byCategory.set(e.category, c);
      }
      const categories = Array.from(byCategory.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([cat, v]) => ({
          category: cat,
          total: fmtRp(v.total),
          count: v.count,
        }));
      return {
        period: label,
        totalAmount: fmtRp(total),
        totalRecords: expenses.length,
        byCategory: categories,
      };
    }

    case "search_customer": {
      const query = String(args.query || "").trim();
      if (!query) return { error: "Query kosong" };
      const customers = await prisma.customer.findMany({
        where: {
          companyId,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { phone: { contains: query } },
            { email: { contains: query, mode: "insensitive" } },
          ],
        },
        select: {
          name: true,
          phone: true,
          email: true,
          memberLevel: true,
          totalSpending: true,
          points: true,
          _count: { select: { transactions: true } },
          transactions: {
            select: { createdAt: true, grandTotal: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
        take: 10,
      });
      return {
        count: customers.length,
        items: customers.map((c) => ({
          name: c.name,
          phone: c.phone,
          email: c.email,
          memberLevel: c.memberLevel,
          totalSpending: fmtRp(c.totalSpending),
          loyaltyPoints: c.points,
          transactionCount: c._count.transactions,
          lastTransaction: c.transactions[0]
            ? {
                date: c.transactions[0].createdAt.toISOString().slice(0, 10),
                amount: fmtRp(c.transactions[0].grandTotal),
              }
            : null,
        })),
      };
    }
  }
  return { error: `Tool ${name} tidak dikenal` };
}

export async function executeCustomerTool(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { prisma, companyId, senderPhone } = ctx;
  switch (name) {
    case "get_my_bookings": {
      if (!senderPhone) {
        return { error: "Nomor pengirim tidak terdeteksi" };
      }
      const variants = phoneVariants(senderPhone);
      const customer = await prisma.customer.findFirst({
        where: { companyId, phone: { in: variants } },
        select: { id: true },
      });
      const statusFilter = { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] };
      const bookings = await prisma.booking.findMany({
        where: customer
          ? {
              companyId,
              OR: [
                { customerId: customer.id },
                { customerPhone: { in: variants } },
              ],
              status: statusFilter,
            }
          : {
              companyId,
              customerPhone: { in: variants },
              status: statusFilter,
            },
        select: {
          scheduledAt: true,
          status: true,
          serviceType: true,
          branch: { select: { name: true } },
        },
        orderBy: { scheduledAt: "asc" },
        take: 5,
      });
      return {
        count: bookings.length,
        items: bookings.map((b) => ({
          scheduledAt: b.scheduledAt.toISOString(),
          status: b.status,
          service: b.serviceType ?? null,
          branch: b.branch?.name ?? null,
        })),
      };
    }

    case "list_services": {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const services = await prisma.product.findMany({
        where: {
          companyId,
          isActive: true,
          itemType: "SERVICE",
          deletedAt: null,
          ...(query
            ? { name: { contains: query, mode: "insensitive" as const } }
            : {}),
        },
        select: {
          name: true,
          sellingPrice: true,
          description: true,
        },
        take: 20,
        orderBy: { name: "asc" },
      });
      if (services.length === 0) {
        return {
          count: 0,
          items: [],
          instruction:
            "JASA TIDAK DITEMUKAN DI MASTER. WAJIB ikuti urutan ini sebelum jawab user:\n" +
            "1. CEK INFO BISNIS di system prompt — cari section 'HARGA LAYANAN' atau 'JASA'. KALAU ADA, JAWAB DARI SANA (sebut 'harga estimasi').\n" +
            "2. BARU sebagai langkah terakhir, sarankan customer hubungi admin untuk konfirmasi harga.\n" +
            "JANGAN langsung jawab 'tidak ada'.",
        };
      }
      return {
        count: services.length,
        items: services.map((s) => ({
          name: s.name,
          price: fmtRp(s.sellingPrice),
          description: s.description ?? null,
        })),
      };
    }

    case "search_products": {
      const query = String(args.query || "").trim();
      const category =
        typeof args.category === "string" ? args.category.trim() : "";
      if (!query) {
        return {
          error:
            "Query kosong. Beri kata kunci nama produk (mis. 'oli', 'kampas rem').",
        };
      }
      const products = await prisma.product.findMany({
        where: {
          companyId,
          isActive: true,
          itemType: "PRODUCT",
          deletedAt: null,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { description: { contains: query, mode: "insensitive" } },
            { barcode: { contains: query, mode: "insensitive" } },
          ],
          ...(category
            ? {
                category: {
                  name: { contains: category, mode: "insensitive" as const },
                },
              }
            : {}),
        },
        select: {
          name: true,
          sellingPrice: true,
          stock: true,
          unit: true,
          description: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
        },
        take: 15,
        orderBy: [{ stock: "desc" }, { name: "asc" }],
      });
      if (products.length === 0) {
        return {
          count: 0,
          items: [],
          instruction:
            "PRODUK TIDAK DITEMUKAN DI KATALOG. WAJIB ikuti urutan ini sebelum jawab user:\n" +
            "1. CEK INFO BISNIS di system prompt — cari section 'KATALOG' atau 'REKOMENDASI' atau info terkait. KALAU ADA, JAWAB DARI SANA (sebut 'umumnya kami sarankan...').\n" +
            "2. KALAU INFO BISNIS JUGA TIDAK ADA, kamu boleh kasih rekomendasi UMUM dari pengetahuan otomotifmu (mis. untuk mobil city car: oli 5W-30 atau 10W-30 sintetik). Sebut 'rekomendasi umum'.\n" +
            "3. BARU sebagai langkah TERAKHIR, sarankan datang ke bengkel atau hubungi admin.\n" +
            "JANGAN langsung loncat ke step 3.",
        };
      }
      return {
        count: products.length,
        items: products.map((p) => ({
          name: p.name,
          brand: p.brand?.name ?? null,
          category: p.category?.name ?? null,
          price: fmtRp(p.sellingPrice),
          unit: p.unit,
          // Customer hanya tahu tersedia/habis, tidak jumlah pasti.
          availability: p.stock > 0 ? "tersedia" : "habis",
          description: p.description ?? null,
        })),
      };
    }

    case "list_categories": {
      const categories = await prisma.category.findMany({
        where: { companyId },
        select: {
          name: true,
          _count: { select: { products: true } },
        },
        take: 50,
        orderBy: { name: "asc" },
      });
      const withProducts = categories.filter((c) => c._count.products > 0);
      return {
        count: withProducts.length,
        items: withProducts.map((c) => ({
          name: c.name,
          productCount: c._count.products,
        })),
      };
    }
  }
  return { error: `Tool ${name} tidak dikenal` };
}

function phoneVariants(phone: string): string[] {
  const trimmed = phone.replace(/\D/g, "");
  const out = new Set<string>();
  out.add(phone);
  out.add(trimmed);
  if (trimmed.startsWith("62")) {
    out.add("0" + trimmed.slice(2));
    out.add("+" + trimmed);
  } else if (trimmed.startsWith("0")) {
    out.add("62" + trimmed.slice(1));
    out.add("+62" + trimmed.slice(1));
  }
  return Array.from(out);
}
