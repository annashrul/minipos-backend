import type Groq from "groq-sdk";
import { toDateOnly } from "@/common/utils/date";
import type { WhatsappChatbotRepository } from "./whatsapp-chatbot.repository";

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
  {
    type: "function",
    function: {
      name: "get_shift_status",
      description:
        "Status shift kasir hari ini: yang masih buka (active), yang sudah tutup, kas awal, kas akhir, deteksi selisih kas. Pakai untuk 'kasir mana yang masih buka', 'ada selisih kas?', 'shift hari ini berapa'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default today)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
          status: {
            type: "string",
            enum: ["OPEN", "CLOSED", "ALL"],
            description: "Filter status shift (default ALL)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recent_transactions",
      description:
        "Daftar transaksi terbaru (paling baru duluan). Pakai untuk 'transaksi terakhir', 'invoice baru', 'cek transaksi yang baru masuk'.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Jumlah transaksi (default 5)" },
          status: {
            type: "string",
            enum: ["COMPLETED", "VOID", "REFUNDED", "ALL"],
            description: "Filter status (default COMPLETED)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_transaction",
      description:
        "Cari transaksi berdasarkan nomor invoice. Return detail lengkap: kasir, customer, items, total, payment method.",
      parameters: {
        type: "object",
        properties: {
          invoiceNumber: {
            type: "string",
            description:
              "Nomor invoice (full atau parsial, mis. 'INV-11052026-00012')",
          },
        },
        required: ["invoiceNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payment_breakdown",
      description:
        "Breakdown omset per metode pembayaran (CASH, QRIS, transfer bank, e-wallet, debit, kartu kredit, termin). Pakai untuk 'paling banyak pakai metode apa', 'breakdown pembayaran'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default today)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_service_orders_summary",
      description:
        "Ringkasan service order (bengkel): jumlah per status (ANTRIAN, DIAGNOSA, DIKERJAKAN, SELESAI, DIBAYAR, DIBATALKAN). Pakai untuk 'SO yang lagi dikerjakan', 'antrian service ada berapa'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default last_30_days)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_refunds_summary",
      description:
        "Total refund/void transaction per periode. Pakai untuk 'berapa refund', 'transaksi yang di-void hari ini'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default this_month)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_purchase_orders_summary",
      description:
        "Ringkasan purchase order (PO) ke supplier: jumlah per status (DRAFT, ORDERED, RECEIVED, CLOSED, CANCELLED), total outstanding. Pakai untuk 'PO yang belum diterima', 'pembelian bulan ini'.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", enum: PERIOD_ENUM, description: "Periode (default this_month)" },
          from: { type: "string", description: "Tanggal mulai ISO" },
          to: { type: "string", description: "Tanggal akhir ISO" },
          status: { type: "string", description: "Filter status PO" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_business_overview",
      description:
        "Overview comprehensive bisnis hari ini: total omset, transaksi count, top 3 produk, stok menipis, shift aktif, booking hari ini. Pakai untuk pertanyaan general seperti 'bagaimana bisnis hari ini?', 'kondisi toko hari ini gimana?', 'summary hari ini'.",
      parameters: { type: "object", properties: {} },
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
  repo: WhatsappChatbotRepository;
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
  const { repo, companyId } = ctx;
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
      const dateRange = start && end ? { start, end } : null;
      const rows = await repo.findCompletedTransactions(companyId, dateRange, branchId);
      const total = rows.reduce((s, r) => s + r.grandTotal, 0);
      return {
        period: label,
        ...(start && end
          ? {
              from: toDateOnly(start),
              to: toDateOnly(end),
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
      const dateRange = start && end ? { start, end } : null;
      const items = await repo.findTransactionItems(companyId, dateRange);
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
      const products = await repo.findActiveProducts(companyId);
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
      const products = await repo.searchProducts(companyId, query);
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
      const dateRange = start && end ? { start, end } : null;
      const bookings = await repo.findBookings(companyId, dateRange, status);
      return {
        period: label,
        ...(start && end
          ? {
              from: toDateOnly(start),
              to: toDateOnly(end),
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
      const dateRange = start && end ? { start, end } : null;
      const txs = await repo.findTransactionsWithUser(companyId, dateRange);
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

      const typeFilter =
        type === "PAYABLE" || type === "RECEIVABLE"
          ? (type as "PAYABLE" | "RECEIVABLE")
          : undefined;
      const debts = await repo.findDebts(companyId, statusFilter, typeFilter);

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
        dueDate: d.dueDate ? toDateOnly(d.dueDate) : null,
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
      const dateRange = start && end ? { start, end } : null;
      const txs = await repo.findTransactionsWithCustomer(companyId, dateRange);
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
      const dateRange = start && end ? { start, end } : null;
      const expenses = await repo.findExpenses(companyId, dateRange, category);
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

    case "get_shift_status": {
      const { start, end, label } = resolvePeriod(
        args.period ?? "today",
        args.from,
        args.to,
      );
      const statusArg =
        typeof args.status === "string" ? args.status.toUpperCase() : "ALL";
      const dateRange = start && end ? { start, end } : null;
      const shifts = await repo.findCashierShifts(companyId, dateRange, statusArg);
      return {
        period: label,
        count: shifts.length,
        items: shifts.map((s) => ({
          kasir: s.user.name,
          cabang: s.branch?.name ?? "—",
          openedAt: s.openedAt.toISOString(),
          closedAt: s.closedAt?.toISOString() ?? null,
          status: s.isOpen ? "OPEN" : "CLOSED",
          openingCash: fmtRp(s.openingCash),
          closingCash: s.closingCash != null ? fmtRp(s.closingCash) : null,
          totalSales: s.totalSales != null ? fmtRp(s.totalSales) : null,
          totalTransactions: s.totalTransactions ?? null,
          selisih:
            s.cashDifference != null && s.cashDifference !== 0
              ? `${s.cashDifference > 0 ? "+" : ""}${fmtRp(s.cashDifference)}`
              : null,
        })),
      };
    }

    case "get_recent_transactions": {
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
      const statusArg =
        typeof args.status === "string" ? args.status.toUpperCase() : "COMPLETED";
      const txs = await repo.findRecentTransactions(companyId, limit, statusArg);
      return {
        count: txs.length,
        items: txs.map((t) => ({
          invoice: t.invoiceDisplayNumber ?? t.invoiceNumber,
          total: fmtRp(t.grandTotal),
          paymentMethod: t.paymentMethod,
          status: t.status,
          customer: t.customer?.name ?? "Walk-in",
          kasir: t.user.name,
          createdAt: t.createdAt.toISOString(),
        })),
      };
    }

    case "search_transaction": {
      const query = String(args.invoiceNumber || "").trim();
      if (!query) return { error: "Nomor invoice kosong" };
      const tx = await repo.findTransactionByInvoice(companyId, query);
      if (!tx) return { found: false, query };
      return {
        found: true,
        invoice: tx.invoiceDisplayNumber ?? tx.invoiceNumber,
        subtotal: fmtRp(tx.subtotal),
        discount: fmtRp(tx.discountAmount),
        tax: fmtRp(tx.taxAmount),
        grandTotal: fmtRp(tx.grandTotal),
        paymentMethod: tx.paymentMethod,
        paid: fmtRp(tx.paymentAmount),
        change: fmtRp(tx.changeAmount),
        status: tx.status,
        kasir: tx.user.name,
        customer: tx.customer?.name ?? "Walk-in",
        customerPhone: tx.customer?.phone ?? null,
        cabang: tx.branch?.name ?? "—",
        createdAt: tx.createdAt.toISOString(),
        items: tx.items.map((it) => ({
          name: it.name,
          qty: it.quantity,
          price: fmtRp(it.unitPrice),
          subtotal: fmtRp(it.subtotal),
        })),
      };
    }

    case "get_payment_breakdown": {
      const { start, end, label } = resolvePeriod(
        args.period ?? "today",
        args.from,
        args.to,
      );
      const dateRange = start && end ? { start, end } : null;
      const txs = await repo.findTransactionPayments(companyId, dateRange);
      const map = new Map<string, { total: number; count: number }>();
      for (const t of txs) {
        const key = t.paymentMethod || "OTHER";
        const e = map.get(key) ?? { total: 0, count: 0 };
        e.total += t.grandTotal;
        e.count += 1;
        map.set(key, e);
      }
      const breakdown = Array.from(map.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([method, v]) => ({
          method,
          total: fmtRp(v.total),
          transactionCount: v.count,
        }));
      const grand = txs.reduce((s, t) => s + t.grandTotal, 0);
      return {
        period: label,
        grandTotal: fmtRp(grand),
        transactionCount: txs.length,
        byMethod: breakdown,
      };
    }

    case "get_service_orders_summary": {
      const { start, end, label } = resolvePeriod(
        args.period ?? "last_30_days",
        args.from,
        args.to,
      );
      const dateRange = start && end ? { start, end } : null;
      const orders = await repo.findServiceOrders(companyId, dateRange);
      const map = new Map<string, { count: number; totalValue: number }>();
      for (const o of orders) {
        const e = map.get(o.status) ?? { count: 0, totalValue: 0 };
        e.count += 1;
        e.totalValue += o.finalAmount ?? o.estimateAmount ?? 0;
        map.set(o.status, e);
      }
      const items = Array.from(map.entries()).map(([status, v]) => ({
        status,
        count: v.count,
        totalValue: fmtRp(v.totalValue),
      }));
      return {
        period: label,
        totalOrders: orders.length,
        byStatus: items,
      };
    }

    case "get_refunds_summary": {
      const { start, end, label } = resolvePeriod(
        args.period ?? "this_month",
        args.from,
        args.to,
      );
      const dateRange = start && end ? { start, end } : null;
      const refunds = await repo.findRefunds(companyId, dateRange);
      const total = refunds.reduce((s, r) => s + r.amount, 0);
      return {
        period: label,
        totalAmount: fmtRp(total),
        count: refunds.length,
        recent: refunds.slice(0, 10).map((r) => ({
          invoice:
            r.transaction.invoiceDisplayNumber ??
            r.transaction.invoiceNumber,
          amount: fmtRp(r.amount),
          reason: r.reason ?? "—",
          date: toDateOnly(r.createdAt),
        })),
      };
    }

    case "get_purchase_orders_summary": {
      const { start, end, label } = resolvePeriod(
        args.period ?? "this_month",
        args.from,
        args.to,
      );
      const statusArg =
        typeof args.status === "string" ? args.status.toUpperCase() : null;
      const dateRange = start && end ? { start, end } : null;
      const pos = await repo.findPurchaseOrders(
        companyId,
        dateRange,
        statusArg ?? undefined,
      );
      const map = new Map<string, { count: number; totalValue: number }>();
      for (const p of pos) {
        const e = map.get(p.status) ?? { count: 0, totalValue: 0 };
        e.count += 1;
        e.totalValue += p.totalAmount ?? 0;
        map.set(p.status, e);
      }
      const items = Array.from(map.entries()).map(([status, v]) => ({
        status,
        count: v.count,
        totalValue: fmtRp(v.totalValue),
      }));
      return {
        period: label,
        totalPO: pos.length,
        byStatus: items,
      };
    }

    case "get_business_overview": {
      // Quick comprehensive snapshot untuk pertanyaan general "gimana bisnis
      // hari ini". Paralel beberapa query supaya cepat.
      const today = resolvePeriod("today", undefined, undefined);
      const todayRange = { start: today.start!, end: today.end! };
      const [txs, lowStockProducts, openShifts, bookings, topItems] =
        await Promise.all([
          repo.findCompletedTransactions(companyId, todayRange),
          repo.findProductStocks(companyId),
          repo.countOpenShifts(companyId),
          repo.countBookingsInRange(companyId, today.start!, today.end!),
          repo.findTransactionItemsWithQuantity(companyId, todayRange),
        ]);

      const totalRevenue = txs.reduce((s, t) => s + t.grandTotal, 0);
      const lowStockCount = lowStockProducts.filter(
        (p) => p.stock <= p.minStock,
      ).length;
      const topMap = new Map<string, number>();
      for (const it of topItems) {
        const n = it.product?.name ?? "(unknown)";
        topMap.set(n, (topMap.get(n) ?? 0) + it.quantity);
      }
      const top3 = Array.from(topMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, qty]) => ({ name, quantitySold: qty }));

      return {
        date: toDateOnly(today.start!),
        sales: {
          revenue: fmtRp(totalRevenue),
          transactionCount: txs.length,
        },
        operations: {
          openShifts,
          bookingsToday: bookings,
          lowStockItems: lowStockCount,
        },
        top3ProductsToday: top3,
      };
    }

    case "search_customer": {
      const query = String(args.query || "").trim();
      if (!query) return { error: "Query kosong" };
      const customers = await repo.searchCustomers(companyId, query);
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
                date: toDateOnly(c.transactions[0].createdAt),
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
  const { repo, companyId, senderPhone } = ctx;
  switch (name) {
    case "get_my_bookings": {
      if (!senderPhone) {
        return { error: "Nomor pengirim tidak terdeteksi" };
      }
      const variants = phoneVariants(senderPhone);
      const customer = await repo.findCustomerByPhone(companyId, variants);
      const statusFilter = { in: ["PENDING", "CONFIRMED", "IN_PROGRESS"] };
      const bookings = await repo.findCustomerBookings(
        companyId,
        customer?.id ?? null,
        variants,
        statusFilter,
      );
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
      const services = await repo.findServices(companyId, query);
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
      const products = await repo.searchProductsCatalog(
        companyId,
        query,
        category || undefined,
      );
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
      const categories = await repo.findCategories(companyId);
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
