import type Groq from "groq-sdk";
import type { PrismaService } from "../prisma/prisma.service";

// ─── Tool catalog ────────────────────────────────────────────────────
// Definisi function calling untuk Groq. Dipisah per role:
// - OWNER tools: data internal sensitif (stok, omset, transaksi).
// - CUSTOMER tools: lookup publik aman (daftar layanan, booking by phone).
// Saat assemble system message, kita gabungkan tool list sesuai role
// pengirim — supaya customer tidak bisa "ngintip" dengan trick prompt.

export const OWNER_TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_today_sales",
      description:
        "Ringkasan penjualan hari ini untuk perusahaan: total transaksi, total omset, dan rata-rata per transaksi.",
      parameters: {
        type: "object",
        properties: {
          branchId: {
            type: "string",
            description:
              "Filter cabang tertentu. Kosongkan untuk semua cabang.",
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
        "Daftar produk terlaris berdasarkan kuantitas terjual dalam N hari terakhir.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Hari ke belakang (default 7)",
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
      name: "get_today_bookings",
      description:
        "Daftar booking hari ini untuk perusahaan (semua cabang) — nama customer, jadwal, status.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description:
              "Filter status: PENDING/CONFIRMED/IN_PROGRESS/COMPLETED. Kosongkan untuk semua.",
          },
        },
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
    case "get_today_sales": {
      const branchId =
        typeof args.branchId === "string" ? args.branchId : undefined;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const rows = await prisma.transaction.findMany({
        where: {
          companyId,
          status: "COMPLETED",
          createdAt: { gte: start, lte: end },
          ...(branchId ? { branchId } : {}),
        },
        select: { grandTotal: true },
      });
      const total = rows.reduce((s, r) => s + r.grandTotal, 0);
      return {
        date: start.toISOString().slice(0, 10),
        transactionCount: rows.length,
        totalRevenue: fmtRp(total),
        averagePerTransaction:
          rows.length > 0 ? fmtRp(total / rows.length) : fmtRp(0),
      };
    }

    case "get_top_products": {
      const days = Math.max(1, Math.min(90, Number(args.days) || 7));
      const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));
      const since = new Date();
      since.setDate(since.getDate() - days);
      const items = await prisma.transactionItem.findMany({
        where: {
          transaction: {
            companyId,
            status: "COMPLETED",
            createdAt: { gte: since },
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
        const name = it.product?.name ?? "(unknown)";
        const e = map.get(name) ?? {
          qty: 0,
          revenue: 0,
          code: it.product?.code ?? "",
        };
        e.qty += it.quantity;
        e.revenue += it.subtotal;
        map.set(name, e);
      }
      const sorted = Array.from(map.entries())
        .sort((a, b) => b[1].qty - a[1].qty)
        .slice(0, limit)
        .map(([name, e]) => ({
          name,
          code: e.code,
          quantitySold: e.qty,
          revenue: fmtRp(e.revenue),
        }));
      return { period: `${days} hari terakhir`, items: sorted };
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

    case "get_today_bookings": {
      const status =
        typeof args.status === "string" ? args.status.toUpperCase() : undefined;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      const bookings = await prisma.booking.findMany({
        where: {
          companyId,
          scheduledAt: { gte: start, lte: end },
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
        date: start.toISOString().slice(0, 10),
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
