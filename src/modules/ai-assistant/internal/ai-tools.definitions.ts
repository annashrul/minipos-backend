import type Groq from "groq-sdk";

export type AuthContext = {
  userId: string;
  userName: string;
  role: string;
  companyId: string | null;
};

export const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_top_products",
      description: "Mendapatkan produk terlaris berdasarkan penjualan.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Jumlah produk (default 10)" },
          days: { type: "number", description: "Hari ke belakang (default 30)" },
          branchId: { type: "string", description: "ID cabang" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_slow_products",
      description: "Mendapatkan produk yang lambat/tidak terjual.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Hari ke belakang (default 30)" },
          limit: { type: "number", description: "Jumlah (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description:
        "Ringkasan penjualan (revenue, transaksi) untuk periode tertentu.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "today/week/month/year" },
          branchId: { type: "string", description: "ID cabang" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock",
      description: "Produk yang stoknya menipis atau habis.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Jumlah (default 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cashier_performance",
      description: "Performa kasir (revenue, transaksi, rata-rata).",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "today/week/month" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_purchase_order",
      description: "Membuat Purchase Order baru ke supplier.",
      parameters: {
        type: "object",
        properties: {
          supplierId: { type: "string", description: "ID supplier" },
          items: {
            type: "array",
            description: "Daftar item",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                productName: { type: "string" },
                quantity: { type: "number" },
                unitPrice: { type: "number" },
              },
              required: ["productId", "productName", "quantity", "unitPrice"],
            },
          },
          notes: { type: "string", description: "Catatan" },
        },
        required: ["supplierId", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_restock_recommendation",
      description:
        "Rekomendasi restock berdasarkan data penjualan dan stok.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Analisa X hari terakhir (default 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Mencari produk berdasarkan nama atau kode.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Kata kunci" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_suppliers",
      description: "Daftar supplier aktif.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_category_sales",
      description: "Penjualan per kategori.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Jumlah hari (default 30)" },
        },
      },
    },
  },
];
