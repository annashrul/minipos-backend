import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// Kata umum yang dibuang saat tokenisasi query pencarian produk — supaya
// kalimat seperti "saya mau pesan mie goreng kampung bumbunya pedas" tetap
// cocok ke produk lewat token "mie","goreng","kampung".
const SEARCH_STOPWORDS = new Set([
  "saya", "aku", "mau", "ingin", "pesan", "mesan", "order", "tolong", "minta",
  "beli", "ada", "punya", "yang", "dengan", "pakai", "buat", "untuk", "nya",
  "dong", "kak", "bang", "bumbu", "bumbunya", "rasa", "rasanya", "level",
  "porsi", "dan", "atau", "apakah", "apa", "aja", "saja", "menu", "harga",
  "berapa", "tersedia", "ada?",
]);

function tokenizeQuery(query: string): string[] {
  return Array.from(
    new Set(
      (query || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !SEARCH_STOPWORDS.has(t)),
    ),
  );
}

// ─── SELECT constants ────────────────────────────────────────────────

const COMPANY_BASIC_SELECT = {
  businessUnit: true,
  name: true,
} satisfies Prisma.CompanySelect;

const BOT_CONFIG_FULL_SELECT = {
  id: true,
  enabled: true,
  ownerPhones: true,
  knowledge: true,
  systemPromptCustomer: true,
  systemPromptOwner: true,
  model: true,
  replyThrottleSec: true,
} satisfies Prisma.WhatsappBotConfigSelect;

const MESSAGE_HISTORY_SELECT = {
  direction: true,
  content: true,
} satisfies Prisma.WhatsappMessageLogSelect;

// ─── Raw types ───────────────────────────────────────────────────────

export type RawCompanyBasic = Prisma.CompanyGetPayload<{
  select: typeof COMPANY_BASIC_SELECT;
}>;

export type RawBotConfig = Prisma.WhatsappBotConfigGetPayload<{
  select: typeof BOT_CONFIG_FULL_SELECT;
}>;

export type RawMessageHistory = Prisma.WhatsappMessageLogGetPayload<{
  select: typeof MESSAGE_HISTORY_SELECT;
}>;

// ─── Tool query types (owner + customer tools) ──────────────────────

export type RawTransactionGrandTotal = { grandTotal: number };

export type RawTransactionItemWithProduct = {
  quantity: number;
  subtotal: number;
  product: { name: string; code: string | null } | null;
};

export type RawProductLowStock = {
  name: string;
  code: string | null;
  stock: number;
  minStock: number;
  unit: string | null;
  sellingPrice: number;
};

export type RawProductStockSearch = {
  name: string;
  code: string | null;
  stock: number;
  minStock: number;
  unit: string | null;
  sellingPrice: number;
  itemType: string;
};

export type RawBooking = {
  customerName: string | null;
  customerPhone: string | null;
  customer: { name: string; phone: string | null } | null;
  scheduledAt: Date;
  status: string;
  serviceType: string | null;
  bookingType: string;
};

export type RawTransactionWithUser = {
  grandTotal: number;
  userId: string;
  user: { name: string };
};

export type RawDebt = {
  type: string;
  partyName: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  dueDate: Date | null;
  createdAt: Date;
};

export type RawTransactionWithCustomer = {
  grandTotal: number;
  customerId: string | null;
  customer: { name: string; phone: string | null; memberLevel: string } | null;
};

export type RawExpense = {
  category: string;
  amount: number;
  description: string | null;
  date: Date;
};

export type RawCashierShift = {
  openedAt: Date;
  closedAt: Date | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
  totalSales: number | null;
  totalTransactions: number | null;
  isOpen: boolean;
  user: { name: string };
  branch: { name: string } | null;
};

export type RawRecentTransaction = Prisma.TransactionGetPayload<{
  include: {
    user: { select: { name: true } };
    customer: { select: { name: true } };
  };
}>;

export type RawTransactionDetail = {
  invoiceDisplayNumber: string | null;
  invoiceNumber: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paymentMethod: string;
  paymentAmount: number;
  changeAmount: number;
  status: string;
  createdAt: Date;
  user: { name: string };
  customer: { name: string; phone: string | null } | null;
  branch: { name: string } | null;
  items: {
    name: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  }[];
};

export type RawTransactionPayment = {
  paymentMethod: string;
  grandTotal: number;
};

export type RawServiceOrder = {
  status: string;
  finalAmount: number | null;
  estimateAmount: number | null;
};

export type RawRefund = {
  amount: number;
  reason: string | null;
  createdAt: Date;
  transaction: {
    invoiceDisplayNumber: string | null;
    invoiceNumber: string;
  };
};

export type RawPurchaseOrder = {
  status: string;
  totalAmount: number | null;
  supplier: { name: string } | null;
};

export type RawProductStock = {
  stock: number;
  minStock: number;
};

export type RawTransactionItemQuantity = {
  quantity: number;
  product: { name: string } | null;
};

export type RawCustomerSearch = {
  name: string;
  phone: string | null;
  email: string | null;
  memberLevel: string;
  totalSpending: number;
  points: number;
  _count: { transactions: number };
  transactions: { createdAt: Date; grandTotal: number }[];
};

// Customer tools
export type RawCustomerBooking = {
  scheduledAt: Date;
  status: string;
  serviceType: string | null;
  branch: { name: string } | null;
};

export type RawService = {
  name: string;
  sellingPrice: number;
  description: string | null;
};

export type RawProductSearch = {
  name: string;
  sellingPrice: number;
  stock: number;
  unit: string | null;
  description: string | null;
  category: { name: string } | null;
  brand: { name: string } | null;
};

export type RawCategory = {
  name: string;
  _count: { products: number };
};

export type RawTableInfo = {
  number: number;
  name: string | null;
  capacity: number;
  status: string;
  section: string | null;
};

export type RawActiveTableSession = {
  status: string;
  customerName: string | null;
  subtotal: number;
  openedAt: Date;
  table: { number: number; name: string | null; section: string | null };
};

export type RawPromotionInfo = {
  name: string;
  type: string;
  value: number;
  minPurchase: number | null;
  maxDiscount: number | null;
  description: string | null;
  voucherCode: string | null;
  startDate: Date;
  endDate: Date;
};

// ─── Repository ──────────────────────────────────────────────────────

@Injectable()
export class WhatsappChatbotRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Company ─────────────────────────────────────────────────────

  findCompany(companyId: string): Promise<RawCompanyBasic | null> {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_BASIC_SELECT,
    });
  }

  // ─── Bot Config ──────────────────────────────────────────────────

  findBotConfig(companyId: string): Promise<RawBotConfig | null> {
    return this.prisma.whatsappBotConfig.findUnique({
      where: { companyId },
      select: BOT_CONFIG_FULL_SELECT,
    });
  }

  findBotConfigFull(companyId: string) {
    return this.prisma.whatsappBotConfig.findUnique({
      where: { companyId },
    });
  }

  createBotConfig(data: Prisma.WhatsappBotConfigUncheckedCreateInput) {
    return this.prisma.whatsappBotConfig.create({ data });
  }

  upsertBotConfig(
    companyId: string,
    create: Prisma.WhatsappBotConfigUncheckedCreateInput,
    update: Prisma.WhatsappBotConfigUncheckedUpdateInput,
  ) {
    return this.prisma.whatsappBotConfig.upsert({
      where: { companyId },
      create,
      update,
    });
  }

  // ─── Chat History ────────────────────────────────────────────────

  findSession(companyId: string): Promise<{ id: string } | null> {
    return this.prisma.whatsappSession.findUnique({
      where: { companyId },
      select: { id: true },
    });
  }

  findRecentMessages(
    sessionId: string,
    fromNumber: string,
  ): Promise<RawMessageHistory[]> {
    return this.prisma.whatsappMessageLog.findMany({
      where: {
        sessionId,
        OR: [{ fromNumber }, { toNumber: fromNumber }],
        messageType: "text",
        content: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: MESSAGE_HISTORY_SELECT,
    });
  }

  // ═══ Owner tool queries ════════════════════════════════════════════

  findCompletedTransactions(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
    branchId?: string,
  ): Promise<RawTransactionGrandTotal[]> {
    return this.prisma.transaction.findMany({
      where: {
        companyId,
        status: "COMPLETED",
        ...(dateRange
          ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
          : {}),
        ...(branchId ? { branchId } : {}),
      },
      select: { grandTotal: true },
    });
  }

  findTransactionItems(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
  ): Promise<RawTransactionItemWithProduct[]> {
    return this.prisma.transactionItem.findMany({
      where: {
        transaction: {
          companyId,
          status: "COMPLETED",
          ...(dateRange
            ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
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
  }

  findActiveProducts(companyId: string): Promise<RawProductLowStock[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        itemType: "PRODUCT",
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
  }

  searchProducts(
    companyId: string,
    query: string,
  ): Promise<RawProductStockSearch[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
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
  }

  findBookings(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
    status?: string,
  ): Promise<RawBooking[]> {
    return this.prisma.booking.findMany({
      where: {
        companyId,
        ...(dateRange
          ? { scheduledAt: { gte: dateRange.start, lte: dateRange.end } }
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
  }

  findTransactionsWithUser(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
  ): Promise<RawTransactionWithUser[]> {
    return this.prisma.transaction.findMany({
      where: {
        companyId,
        status: "COMPLETED",
        ...(dateRange
          ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
          : {}),
      },
      select: {
        grandTotal: true,
        userId: true,
        user: { select: { name: true } },
      },
      take: 10000,
    });
  }

  findDebts(
    companyId: string,
    statusFilter: Prisma.DebtWhereInput,
    typeFilter?: "PAYABLE" | "RECEIVABLE",
  ): Promise<RawDebt[]> {
    return this.prisma.debt.findMany({
      where: {
        companyId,
        ...statusFilter,
        ...(typeFilter ? { type: typeFilter } : {}),
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
  }

  findTransactionsWithCustomer(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
  ): Promise<RawTransactionWithCustomer[]> {
    return this.prisma.transaction.findMany({
      where: {
        companyId,
        status: "COMPLETED",
        customerId: { not: null },
        ...(dateRange
          ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
          : {}),
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
  }

  findExpenses(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
    category?: string,
  ): Promise<RawExpense[]> {
    return this.prisma.expense.findMany({
      where: {
        companyId,
        ...(dateRange
          ? { date: { gte: dateRange.start, lte: dateRange.end } }
          : {}),
        ...(category
          ? { category: { contains: category, mode: "insensitive" as const } }
          : {}),
      },
      select: { category: true, amount: true, description: true, date: true },
      take: 5000,
      orderBy: { date: "desc" },
    });
  }

  findCashierShifts(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
    statusArg: string,
  ): Promise<RawCashierShift[]> {
    return this.prisma.cashierShift.findMany({
      where: {
        user: { companyId },
        ...(dateRange
          ? { openedAt: { gte: dateRange.start, lte: dateRange.end } }
          : {}),
        ...(statusArg === "OPEN"
          ? { isOpen: true }
          : statusArg === "CLOSED"
            ? { isOpen: false }
            : {}),
      },
      select: {
        openedAt: true,
        closedAt: true,
        openingCash: true,
        closingCash: true,
        expectedCash: true,
        cashDifference: true,
        totalSales: true,
        totalTransactions: true,
        isOpen: true,
        user: { select: { name: true } },
        branch: { select: { name: true } },
      },
      orderBy: { openedAt: "desc" },
      take: 30,
    });
  }

  findRecentTransactions(
    companyId: string,
    limit: number,
    statusArg: string,
  ): Promise<RawRecentTransaction[]> {
    const where: Prisma.TransactionWhereInput = { companyId };
    if (statusArg !== "ALL") {
      (where as { status?: unknown }).status = statusArg;
    }
    return this.prisma.transaction.findMany({
      where,
      include: {
        user: { select: { name: true } },
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  findTransactionByInvoice(
    companyId: string,
    query: string,
  ): Promise<RawTransactionDetail | null> {
    return this.prisma.transaction.findFirst({
      where: {
        companyId,
        OR: [
          { invoiceDisplayNumber: { contains: query, mode: "insensitive" } },
          { invoiceNumber: { contains: query, mode: "insensitive" } },
        ],
      },
      select: {
        invoiceDisplayNumber: true,
        invoiceNumber: true,
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        grandTotal: true,
        paymentMethod: true,
        paymentAmount: true,
        changeAmount: true,
        status: true,
        createdAt: true,
        user: { select: { name: true } },
        customer: { select: { name: true, phone: true } },
        branch: { select: { name: true } },
        items: {
          select: {
            name: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
          },
        },
      },
    });
  }

  findTransactionPayments(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
  ): Promise<RawTransactionPayment[]> {
    return this.prisma.transaction.findMany({
      where: {
        companyId,
        status: "COMPLETED",
        ...(dateRange
          ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
          : {}),
      },
      select: { paymentMethod: true, grandTotal: true },
    });
  }

  findServiceOrders(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
  ): Promise<RawServiceOrder[]> {
    return this.prisma.serviceOrder.findMany({
      where: {
        companyId,
        ...(dateRange
          ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
          : {}),
      },
      select: { status: true, finalAmount: true, estimateAmount: true },
    });
  }

  findRefunds(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
  ): Promise<RawRefund[]> {
    return this.prisma.refund.findMany({
      where: {
        transaction: {
          companyId,
          ...(dateRange
            ? { createdAt: { gte: dateRange.start, lte: dateRange.end } }
            : {}),
        },
      },
      select: {
        amount: true,
        reason: true,
        createdAt: true,
        transaction: {
          select: { invoiceDisplayNumber: true, invoiceNumber: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  findPurchaseOrders(
    companyId: string,
    dateRange: { start: Date; end: Date } | null,
    status?: string,
  ): Promise<RawPurchaseOrder[]> {
    const where: Prisma.PurchaseOrderWhereInput = { companyId };
    if (dateRange) {
      where.createdAt = { gte: dateRange.start, lte: dateRange.end };
    }
    if (status) {
      (where as { status?: unknown }).status = status;
    }
    return this.prisma.purchaseOrder.findMany({
      where,
      select: {
        status: true,
        totalAmount: true,
        supplier: { select: { name: true } },
      },
    });
  }

  // Business overview queries (parallelized by caller)

  findProductStocks(companyId: string): Promise<RawProductStock[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        itemType: "PRODUCT",
      },
      select: { stock: true, minStock: true },
    });
  }

  countOpenShifts(companyId: string): Promise<number> {
    return this.prisma.cashierShift.count({
      where: { user: { companyId }, isOpen: true },
    });
  }

  countBookingsInRange(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    return this.prisma.booking.count({
      where: {
        companyId,
        scheduledAt: { gte: start, lte: end },
      },
    });
  }

  findTransactionItemsWithQuantity(
    companyId: string,
    dateRange: { start: Date; end: Date },
  ): Promise<RawTransactionItemQuantity[]> {
    return this.prisma.transactionItem.findMany({
      where: {
        transaction: {
          companyId,
          status: "COMPLETED",
          createdAt: { gte: dateRange.start, lte: dateRange.end },
        },
      },
      select: {
        quantity: true,
        product: { select: { name: true } },
      },
      take: 500,
    });
  }

  searchCustomers(
    companyId: string,
    query: string,
  ): Promise<RawCustomerSearch[]> {
    return this.prisma.customer.findMany({
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
  }

  // ═══ Customer tool queries ═════════════════════════════════════════

  findCustomerByPhone(
    companyId: string,
    phoneVariants: string[],
  ): Promise<{ id: string } | null> {
    return this.prisma.customer.findFirst({
      where: { companyId, phone: { in: phoneVariants } },
      select: { id: true },
    });
  }

  findCustomerBookings(
    companyId: string,
    customerId: string | null,
    phoneVariants: string[],
    statusFilter: { in: string[] },
  ): Promise<RawCustomerBooking[]> {
    return this.prisma.booking.findMany({
      where: customerId
        ? {
            companyId,
            OR: [
              { customerId },
              { customerPhone: { in: phoneVariants } },
            ],
            status: statusFilter,
          }
        : {
            companyId,
            customerPhone: { in: phoneVariants },
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
  }

  findServices(companyId: string, query: string): Promise<RawService[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        itemType: "SERVICE",
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
  }

  async searchProductsCatalog(
    companyId: string,
    query: string,
    category?: string,
  ): Promise<RawProductSearch[]> {
    const tokens = tokenizeQuery(query);
    // Cocokkan per-token (OR) supaya "mie goreng kampung" tetap menemukan
    // "Mie Goreng Jawa" & "Nasi Goreng Kampung" — lalu di-ranking by overlap.
    const orConds: Prisma.ProductWhereInput[] =
      tokens.length > 0
        ? tokens.flatMap((t) => [
            { name: { contains: t, mode: "insensitive" as const } },
            { description: { contains: t, mode: "insensitive" as const } },
          ])
        : [
            { name: { contains: query, mode: "insensitive" as const } },
            { description: { contains: query, mode: "insensitive" as const } },
            { barcode: { contains: query, mode: "insensitive" as const } },
          ];

    const rows = await this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        itemType: "PRODUCT",
        OR: orConds,
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
      take: 30,
    });

    if (tokens.length === 0) {
      return rows
        .sort((a, b) => b.stock - a.stock || a.name.localeCompare(b.name))
        .slice(0, 15);
    }

    // Ranking: token cocok di nama bobotnya lebih besar daripada di deskripsi.
    const scored = rows.map((p) => {
      const name = p.name.toLowerCase();
      const desc = (p.description ?? "").toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += 2;
        else if (desc.includes(t)) score += 1;
      }
      return { p, score };
    });
    scored.sort((a, b) => b.score - a.score || b.p.stock - a.p.stock);
    return scored.slice(0, 12).map((s) => s.p);
  }

  findCategories(companyId: string): Promise<RawCategory[]> {
    return this.prisma.category.findMany({
      where: { companyId },
      select: {
        name: true,
        _count: { select: { products: true } },
      },
      take: 50,
      orderBy: { name: "asc" },
    });
  }

  // Daftar menu/produk aktif TANPA perlu kata kunci — untuk pertanyaan
  // "menu apa saja / ada apa aja". Sumber kebenaran = master produk (live).
  browseMenuProducts(
    companyId: string,
    category?: string,
  ): Promise<RawProductSearch[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        itemType: "PRODUCT",
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
      take: 60,
      orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    });
  }

  // ─── Meja (restoran/cafe) ────────────────────────────────────────
  findTables(
    companyId: string,
    opts: { section?: string; minCapacity?: number; status?: string } = {},
  ): Promise<RawTableInfo[]> {
    return this.prisma.restaurantTable.findMany({
      where: {
        branch: { companyId },
        isActive: true,
        ...(opts.section
          ? { section: { contains: opts.section, mode: "insensitive" } }
          : {}),
        ...(opts.minCapacity ? { capacity: { gte: opts.minCapacity } } : {}),
        ...(opts.status ? { status: opts.status } : {}),
      },
      select: {
        number: true,
        name: true,
        capacity: true,
        status: true,
        section: true,
      },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
      take: 200,
    });
  }

  findActiveTableSessions(
    companyId: string,
  ): Promise<RawActiveTableSession[]> {
    return this.prisma.tableSession.findMany({
      where: {
        branch: { companyId },
        status: { in: ["OPEN", "AWAITING_PAYMENT"] },
      },
      select: {
        status: true,
        customerName: true,
        subtotal: true,
        openedAt: true,
        table: { select: { number: true, name: true, section: true } },
      },
      orderBy: { openedAt: "asc" },
      take: 100,
    });
  }

  // ─── Order online (link katalog WhatsApp) ────────────────────────
  // Cari qrToken meja untuk dijadikan link pesan online. Prioritaskan meja
  // yang ditandai online/whatsapp; fallback meja pertama yang punya qrToken.
  async findOnlineOrderToken(companyId: string): Promise<string | null> {
    // Prioritas: meja yang ditandai isOnline (meja virtual WhatsApp).
    const online = await this.prisma.restaurantTable.findFirst({
      where: {
        branch: { companyId },
        isActive: true,
        isOnline: true,
        qrToken: { not: null },
      },
      select: { qrToken: true },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    });
    if (online?.qrToken) return online.qrToken;

    const preferred = await this.prisma.restaurantTable.findFirst({
      where: {
        branch: { companyId },
        isActive: true,
        qrToken: { not: null },
        OR: [
          { section: { contains: "online", mode: "insensitive" } },
          { section: { contains: "whatsapp", mode: "insensitive" } },
          { name: { contains: "online", mode: "insensitive" } },
          { name: { contains: "whatsapp", mode: "insensitive" } },
        ],
      },
      select: { qrToken: true },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    });
    if (preferred?.qrToken) return preferred.qrToken;

    const any = await this.prisma.restaurantTable.findFirst({
      where: {
        branch: { companyId },
        isActive: true,
        qrToken: { not: null },
      },
      select: { qrToken: true },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    });
    return any?.qrToken ?? null;
  }

  // Resolve nama menu (dari chat) ke produk untuk pre-fill keranjang order.
  // Pakai pencarian per-token + ranking overlap (mis. "ayam bakar madu").
  async resolveOrderProductByName(
    companyId: string,
    name: string,
  ): Promise<{ id: string; name: string; sellingPrice: number } | null> {
    const tokens = tokenizeQuery(name);
    const orConds: Prisma.ProductWhereInput[] =
      tokens.length > 0
        ? tokens.map((t) => ({
            name: { contains: t, mode: "insensitive" as const },
          }))
        : [{ name: { contains: name, mode: "insensitive" as const } }];
    const rows = await this.prisma.product.findMany({
      where: {
        companyId,
        isActive: true,
        itemType: "PRODUCT",
        OR: orConds,
      },
      select: { id: true, name: true, sellingPrice: true },
      take: 15,
    });
    if (rows.length === 0) return null;
    if (tokens.length === 0) return rows[0] ?? null;
    let best = rows[0]!;
    let bestScore = -1;
    for (const r of rows) {
      const n = r.name.toLowerCase();
      const score = tokens.filter((t) => n.includes(t)).length;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    return best;
  }

  // ─── Promo aktif ─────────────────────────────────────────────────
  findActivePromotions(companyId: string): Promise<RawPromotionInfo[]> {
    const now = new Date();
    return this.prisma.promotion.findMany({
      where: {
        companyId,
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: {
        name: true,
        type: true,
        value: true,
        minPurchase: true,
        maxDiscount: true,
        description: true,
        voucherCode: true,
        startDate: true,
        endDate: true,
      },
      orderBy: { endDate: "asc" },
      take: 20,
    });
  }
}
