import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiChatMessageDto, AiChatResponse } from "./dto/ai-assistant.dto";
import Groq from "groq-sdk";
import { AiAssistantToolsService } from "./ai-assistant-tools.service";
import { AiAssistantRepository } from "./ai-assistant.repository";

// Pola jawaban "tidak terjawab" — AI merespons sopan tapi tidak punya
// data/akses. Dipakai untuk menandai status UNANSWERED di audit log supaya
// owner bisa lihat pertanyaan yang belum bisa dijawab AI.
const UNANSWERED_RE =
  /tidak (punya akses|bisa|dapat|tahu|menemukan|tersedia)|belum (bisa|ada)|tidak ada data|di luar (kemampuan|akses)|maaf,?\s*(saya|aku)?\s*tidak/i;

// OpenAI-compatible tool definitions for Groq
const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_top_products",
      description: "Mendapatkan produk terlaris berdasarkan penjualan.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Jumlah produk (default 10)" },
          days: {
            type: "number",
            description: "Hari ke belakang (default 30)",
          },
          branchId: { type: "string", description: "ID cabang" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_slow_products",
      description:
        "Produk slow-moving (tidak bergerak) dalam N hari. Sudah RECIPE-AWARE: bahan baku yang terpakai lewat resep produk jadi yang terjual TIDAK dianggap slow-moving. Tiap item punya field itemType ('Produk jadi' / 'Bahan baku') — sebutkan bedanya saat menjawab.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Hari ke belakang (default 30)",
          },
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
          period: {
            type: "string",
            description: "today/yesterday/week/month/year ('kemarin'=yesterday)",
          },
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
          period: {
            type: "string",
            description: "today/yesterday/week/month ('kemarin'=yesterday)",
          },
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
      description: "Rekomendasi restock berdasarkan data penjualan dan stok.",
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
  {
    type: "function",
    function: {
      name: "find_product_location",
      description:
        "Cari LOKASI FISIK produk di rak. WAJIB dipakai saat user nanya 'dimana letak X', 'rak mana barang Y', 'cariin oli vario', 'mekanik minta aki PCX dimana taruhnya'. Return: kode rak, nama rak, lokasi fisik, qty di tiap rak, total stok per cabang.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Nama atau kode produk yang dicari (mis. 'oli matic', 'AKI-005', 'busi vario')",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_rack_contents",
      description:
        "Lihat isi rak. Pakai saat user nanya 'apa isi rak AK-01', 'produk apa di rak roller', 'tampilkan stok rak X'. Bisa cari by kode rak atau nama rak.",
      parameters: {
        type: "object",
        properties: {
          rackQuery: {
            type: "string",
            description:
              "Kode rak (mis. 'AK-01') atau nama rak (mis. 'rak roller', 'oli matic')",
          },
        },
        required: ["rackQuery"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_low_stock_with_location",
      description:
        "Produk stok menipis BERIKUT lokasi rak-nya. Dipakai saat user nanya 'stok apa yang habis dan dimana letaknya', 'produk hampir habis di rak mana'.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Jumlah produk (default 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_dashboard_overview",
      description:
        "Ringkasan data dashboard: total omzet/pendapatan, jumlah transaksi, rata-rata per transaksi, diskon, pajak, perbandingan dengan periode sebelumnya (naik/turun %), metode bayar teratas, dan produk teratas. WAJIB dipakai saat user nanya 'gimana penjualan hari ini', 'ringkasan dashboard', 'omzet bulan ini', 'performa toko', 'lagi naik atau turun'.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description:
              "today / yesterday / week / month / year (default month). 'kemarin' = yesterday",
          },
          branchId: { type: "string", description: "ID cabang (opsional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payment_method_breakdown",
      description:
        "Rincian penjualan per METODE PEMBAYARAN (Tunai, QRIS, Transfer, E-Wallet, Debit, Kredit, dll): jumlah transaksi, total nominal, dan persentase tiap metode + metode paling ramai. WAJIB dipakai saat user nanya 'metode pembayaran paling banyak', 'pembayaran paling ramai pakai apa', 'berapa persen QRIS', 'orang lebih sering bayar cash atau transfer'.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description:
              "today / yesterday / week / month / year (default month). 'kemarin' = yesterday",
          },
          branchId: { type: "string", description: "ID cabang (opsional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_table_status",
      description:
        "Status MEJA saat ini (untuk restoran/cafe): total meja, jumlah per status (tersedia/terisi/reserved/cleaning), dan daftar meja yang sedang terisi beserta nama customer, tagihan berjalan, dan jam buka sesi. Dipakai saat user nanya 'meja mana yang kosong', 'meja yang terisi', 'kondisi meja sekarang', 'ada berapa meja available'.",
      parameters: {
        type: "object",
        properties: {
          branchId: { type: "string", description: "ID cabang (opsional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_busiest_tables",
      description:
        "Meja PALING RAMAI berdasarkan omzet & jumlah transaksi dalam satu periode. Dipakai saat user nanya 'meja mana yang paling ramai', 'meja paling sering dipakai', 'meja penyumbang omzet terbesar'.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description:
              "today / yesterday / week / month / year (default month). 'kemarin' = yesterday",
          },
          limit: { type: "number", description: "Jumlah meja (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_trend",
      description:
        "Tren penjualan HARIAN beberapa hari terakhir (omzet + jumlah transaksi per tanggal) plus hari paling ramai. Dipakai saat user nanya 'tren penjualan', 'hari apa paling ramai', 'grafik penjualan minggu ini', 'penjualan naik atau turun belakangan'.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Jumlah hari ke belakang (default 14)",
          },
          branchId: { type: "string", description: "ID cabang (opsional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_profit_summary",
      description:
        "Ringkasan LABA KOTOR (estimasi): omzet, modal/COGS, laba kotor, dan margin %. Modal dihitung dari harga beli produk saat ini. Dipakai saat user nanya 'berapa untung/laba', 'margin keuntungan', 'profit bulan ini', 'omzet vs modal'.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            description:
              "today / yesterday / week / month / year (default month). 'kemarin' = yesterday",
          },
          branchId: { type: "string", description: "ID cabang (opsional)" },
        },
      },
    },
  },
];

type AuthContext = {
  userId: string;
  userName: string;
  role: string;
  companyId: string | null;
};

// Deteksi error rate-limit / quota habis dari Groq (429) maupun Gemini
// (RESOURCE_EXHAUSTED). Dipakai untuk memicu fallback antar-model & ke Gemini.
function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 429) return true;
  const msg = (e.message ?? "").toLowerCase();
  return /rate.?limit|quota|too many requests|resource_exhausted|daily limit|limit reached|insufficient_quota|(^|\D)429(\D|$)/.test(
    msg,
  );
}

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tools: AiAssistantToolsService,
    private readonly repo: AiAssistantRepository,
  ) {}

  // List audit log percakapan AI untuk owner — default tampilkan yang TIDAK
  // terjawab (UNANSWERED + ERROR) supaya gampang lihat gap pengetahuan AI.
  async listLogs(
    auth: AuthContext,
    query: {
      status?: "ANSWERED" | "UNANSWERED" | "ERROR";
      days?: number;
      limit?: number;
      offset?: number;
    },
  ) {
    const limit = Math.min(query.limit ?? 50, 200);
    const offset = query.offset ?? 0;
    const { rows, total } = await this.repo.listConversationLogs(
      auth.companyId,
      { status: query.status, days: query.days, limit, offset },
    );
    return { total, limit, offset, items: rows };
  }

  // Catat interaksi AI ke audit log (best-effort). Status:
  //   ERROR      → ada error/exception
  //   UNANSWERED → AI menjawab tapi tidak punya data/akses (audit utama)
  //   ANSWERED   → AI menjawab dengan data
  private async persistLog(
    auth: AuthContext,
    question: string,
    toolsUsed: string[],
    startedAt: number,
    result: AiChatResponse,
  ): Promise<void> {
    const answer = result.response ?? null;
    const errorMessage = result.error ?? null;
    let status: "ERROR" | "UNANSWERED" | "ANSWERED";
    if (errorMessage) status = "ERROR";
    else if (answer && UNANSWERED_RE.test(answer)) status = "UNANSWERED";
    else status = "ANSWERED";

    await this.repo.createConversationLog({
      companyId: auth.companyId,
      userId: auth.userId,
      userName: auth.userName,
      role: auth.role,
      question,
      answer,
      status,
      toolsUsed: Array.from(new Set(toolsUsed)),
      errorMessage,
      durationMs: Date.now() - startedAt,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool dispatcher
  // ─────────────────────────────────────────────────────────────────────────────

  private async executeTool(
    auth: AuthContext,
    name: string,
    input: Record<string, unknown>,
  ) {
    try {
      switch (name) {
        case "get_top_products":
          return await this.tools.executeGetTopProducts(
            auth,
            input as { limit?: number; days?: number; branchId?: string },
          );
        case "get_slow_products":
          return await this.tools.executeGetSlowProducts(
            auth,
            input as { days?: number; limit?: number },
          );
        case "get_sales_summary":
          return await this.tools.executeGetSalesSummary(
            auth,
            input as { period?: string; branchId?: string },
          );
        case "get_low_stock":
          return await this.tools.executeGetLowStock(
            auth,
            input as { limit?: number },
          );
        case "get_cashier_performance":
          return await this.tools.executeGetCashierPerformance(
            auth,
            input as { period?: string },
          );
        case "create_purchase_order":
          return await this.tools.executeCreatePurchaseOrder(
            auth,
            input as {
              supplierId: string;
              items: {
                productId: string;
                productName: string;
                quantity: number;
                unitPrice: number;
              }[];
              notes?: string;
            },
          );
        case "get_restock_recommendation":
          return await this.tools.executeGetRestockRecommendation(
            auth,
            input as { days?: number },
          );
        case "search_products":
          return await this.tools.executeSearchProducts(
            auth,
            input as { query: string },
          );
        case "get_suppliers":
          return await this.tools.executeGetSuppliers(auth);
        case "get_category_sales":
          return await this.tools.executeGetCategorySales(
            auth,
            input as { days?: number },
          );
        case "find_product_location":
          return await this.tools.executeFindProductLocation(
            auth,
            input as { query: string },
          );
        case "lookup_rack_contents":
          return await this.tools.executeLookupRackContents(
            auth,
            input as { rackQuery: string },
          );
        case "find_low_stock_with_location":
          return await this.tools.executeFindLowStockWithLocation(
            auth,
            input as { limit?: number },
          );
        case "get_dashboard_overview":
          return await this.tools.executeGetDashboardOverview(
            auth,
            input as { period?: string; branchId?: string },
          );
        case "get_payment_method_breakdown":
          return await this.tools.executeGetPaymentBreakdown(
            auth,
            input as { period?: string; branchId?: string },
          );
        case "get_table_status":
          return await this.tools.executeGetTableStatus(
            auth,
            input as { branchId?: string },
          );
        case "get_busiest_tables":
          return await this.tools.executeGetBusiestTables(
            auth,
            input as { period?: string; limit?: number },
          );
        case "get_sales_trend":
          return await this.tools.executeGetSalesTrend(
            auth,
            input as { days?: number; branchId?: string },
          );
        case "get_profit_summary":
          return await this.tools.executeGetProfitSummary(
            auth,
            input as { period?: string; branchId?: string },
          );
        default:
          return { error: `Tool '${name}' not found` };
      }
    } catch (error) {
      this.logger.error(
        `[AI Tool Error] ${name}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        error: `Gagal menjalankan tool '${name}': ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────────

  async chat(
    auth: AuthContext,
    messages: AiChatMessageDto[],
  ): Promise<AiChatResponse> {
    const systemPrompt = `Kamu adalah asisten AI untuk aplikasi POS/Bengkel "NusaPOS". Kamu WAJIB pakai tools yang tersedia untuk menjawab pertanyaan tentang data toko. JANGAN PERNAH mengarang data.

ATURAN KETAT:
1. Pertanyaan tentang produk, stok, lokasi rak, penjualan, kasir, supplier, kategori -> WAJIB panggil tool dulu
2. JANGAN mengarang angka, nama produk, kode rak, atau data apapun tanpa tool call
3. Bedakan DUA kondisi (PENTING):
   (a) TIDAK ADA tool yang cocok untuk pertanyaan -> jawab "Maaf, saya belum bisa menjawab pertanyaan itu."
   (b) Tool SUDAH dipanggil tapi hasilnya KOSONG / nol / array kosong -> JANGAN bilang "tidak punya akses". Sampaikan apa adanya bahwa datanya nihil, mis. "Tidak ada produk dengan stok menipis saat ini", "Belum ada penjualan pada periode itu", "Semua meja kosong". Angka 0 / data kosong adalah jawaban yang VALID dan harus disampaikan dengan jelas, BUKAN ditolak.
4. Bahasa Indonesia, ringkas, langsung ke jawabannya. JANGAN bertele-tele.
5. Format angka uang dengan Rp (contoh: Rp 150.000)
6. WAJIB pakai find_product_location saat user nanya LOKASI/POSISI produk ("dimana", "rak mana", "ada di mana", "letak", "cariin")
7. WAJIB pakai lookup_rack_contents saat user nanya ISI RAK ("apa isi rak X", "produk apa di rak Y", "tampilkan rak Z")
8. find_low_stock_with_location lebih baik daripada get_low_stock karena include lokasi rak
9. Saat buat PO, panggil get_restock_recommendation + get_suppliers dulu
10. Pertanyaan soal DASHBOARD / ringkasan penjualan / omzet / performa toko / naik-turun -> get_dashboard_overview
11. Pertanyaan soal METODE PEMBAYARAN paling ramai / persentase cash-QRIS-transfer -> get_payment_method_breakdown
12. Pertanyaan soal MEJA: kondisi/kosong/terisi sekarang -> get_table_status; meja paling ramai (periode) -> get_busiest_tables
13. Pertanyaan soal TREN / hari paling ramai -> get_sales_trend; soal LABA/UNTUNG/MARGIN -> get_profit_summary
14. Untuk semua tool periode, default "month" kalau user tidak sebut. Format uang Rp. Saat laba, sebutkan bahwa angkanya ESTIMASI (sesuai field note).
15. PEMETAAN PERIODE waktu (parameter period) WAJIB dari kata user:
    "hari ini"->today, "kemarin"/"hari kemarin"->yesterday, "minggu ini"/"7 hari"->week, "bulan ini"->month, "tahun ini"->year.
    Kalau user bilang "kemarin", WAJIB panggil tool dengan period="yesterday" — JANGAN balik nanya periode.
16. Untuk pertanyaan "siapa kasir yang jaga (kemarin/hari ini/...)", pakai get_cashier_performance dengan period yang sesuai, lalu sebutkan nama-nama kasir yang ada transaksinya.
17. BAHAN BAKU vs PRODUK JADI: ada 2 jenis item (field itemType). Bahan baku (mis. beras, gula, kopi bubuk) tidak dijual langsung — terpakai lewat resep saat produk jadi (mis. Nasi Padang) terjual. get_slow_products SUDAH recipe-aware (bahan baku yg terpakai via resep tidak masuk slow-moving). Saat menjawab slow-moving, BEDAKAN dan beri label: "Produk jadi" vs "Bahan baku", dan jangan menyarankan menghentikan bahan baku yang sebenarnya terpakai di resep.

CONTOH ALUR:
- "Gimana penjualan bulan ini?" -> get_dashboard_overview(month) -> sebut omzet, jml transaksi, rata-rata, naik/turun vs bulan lalu
- "Pembayaran paling ramai pakai apa?" -> get_payment_method_breakdown -> "QRIS paling ramai (45% omzet), disusul Tunai (30%)..."
- "Meja mana yang masih kosong?" -> get_table_status -> sebut jumlah available + daftar meja terisi
- "Meja paling ramai minggu ini?" -> get_busiest_tables(week)
- "Berapa laba bulan ini?" -> get_profit_summary(month) -> sebut omzet, modal, laba kotor, margin (catatan: estimasi)
- "Hari apa paling ramai?" -> get_sales_trend -> sebut tanggal dengan omzet tertinggi
- "Dimana oli Yamalube?" -> find_product_location("oli yamalube") -> "Oli Yamalube Power Matic ada di rak OL-02 (Sintetik/Premium). Tersedia 25 botol."
- "Mekanik minta aki Vario, dimana?" -> find_product_location("aki vario") -> Jawab dengan kode rak + qty
- "Apa isi rak BU-01?" -> lookup_rack_contents("BU-01") -> Daftar produk di rak itu
- "Produk apa yang hampir habis?" -> find_low_stock_with_location -> Sertakan lokasi rak
- "Cari oli matic" -> find_product_location("oli matic")
- "Berapa stok busi NGK CR8E?" -> find_product_location("busi NGK CR8E")

FORMAT JAWABAN UNTUK LOOKUP LOKASI:
Sertakan: nama produk, kode rak, sub-section/nama rak, qty. Format ringkas.
Contoh: "AHM Oil SPX2 Matic 0.8L (OLI-007) - Rak OL-01 (Matic 0.8L), tersedia 40 botol."

Info user: ${auth.userName} (${auth.role})`;

    const apiKey = this.config.get<string>("GROQ_API_KEY");
    const model =
      this.config.get<string>("GROQ_MODEL") || "openai/gpt-oss-120b";

    // Pertanyaan terakhir user + timer + daftar tool, untuk audit log.
    const question =
      [...messages].reverse().find((m) => m.role === "user")?.content ??
      messages[messages.length - 1]?.content ??
      "";
    const toolsUsed: string[] = [];
    const startedAt = Date.now();

    if (!apiKey) {
      const result: AiChatResponse = {
        error:
          "GROQ_API_KEY belum dikonfigurasi. Dapatkan gratis di console.groq.com",
      };
      await this.persistLog(auth, question, toolsUsed, startedAt, result);
      return result;
    }

    const groq = new Groq({ apiKey });

    // Rantai fallback model Groq (tiap model punya kuota TPD sendiri) lalu
    // fallback terakhir ke Google AI Studio (Gemini) saat SEMUA model Groq
    // kena rate-limit/quota harian — sama seperti wa-bot. Gemini dipanggil via
    // fetch ke endpoint OpenAI-compatible (path tidak ter-mangle, error terbaca).
    const groqModels = [
      model,
      "openai/gpt-oss-20b",
      "llama-3.3-70b-versatile",
    ].filter((m, i, arr) => arr.indexOf(m) === i);
    const geminiKey = this.config.get<string>("GEMINI_API_KEY");
    const geminiModel =
      this.config.get<string>("GEMINI_MODEL") || "gemini-2.0-flash";

    const callModel = async (
      msgs: Groq.Chat.ChatCompletionMessageParam[],
    ): Promise<Groq.Chat.ChatCompletion> => {
      let lastErr: unknown;
      for (const m of groqModels) {
        try {
          return await groq.chat.completions.create({
            model: m,
            messages: msgs,
            tools: TOOLS,
            tool_choice: "auto",
            // gpt-oss adalah reasoning model — default-nya "berpikir" panjang
            // sebelum menjawab (penyebab utama latensi 16s+). "low" memangkas
            // reasoning drastis tanpa banyak menurunkan kualitas tool-calling.
            reasoning_effort: "low",
            // 2048 cukup untuk tabel ringkas; menahan output bertele-tele.
            max_tokens: 2048,
          });
        } catch (err) {
          lastErr = err;
          // Hanya rate-limit yang memicu pindah model; error lain (mis.
          // tool_use_failed) dilempar ke catch luar yang sudah menanganinya.
          if (isRateLimitError(err)) {
            this.logger.warn(
              `[AI Assistant] Groq model ${m} rate-limited — coba model alternatif`,
            );
            continue;
          }
          throw err;
        }
      }
      // Semua model Groq kena rate-limit harian — fallback ke Gemini.
      if (geminiKey) {
        this.logger.warn(
          "[AI Assistant] Semua model Groq rate-limited — fallback ke Gemini (Google AI Studio)",
        );
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${geminiKey}`,
            },
            body: JSON.stringify({
              model: geminiModel,
              messages: msgs,
              tools: TOOLS,
              tool_choice: "auto",
              max_tokens: 2048,
            }),
          },
        );
        if (res.ok) return (await res.json()) as Groq.Chat.ChatCompletion;
        const body = await res.text().catch(() => "");
        this.logger.warn(
          `[AI Assistant] Gemini fallback gagal: HTTP ${res.status} ${body.slice(0, 200)}`,
        );
      }
      throw lastErr;
    };

    let result: AiChatResponse = { error: "Gagal memproses permintaan." };
    try {
      const chatMessages: Groq.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      let response = await callModel(chatMessages);

      // Handle tool calls in a loop (max 5 iterations)
      let iterations = 0;
      while (iterations < 5) {
        const choice = response.choices[0];
        if (
          !choice?.message.tool_calls ||
          choice.message.tool_calls.length === 0
        )
          break;

        chatMessages.push(choice.message);

        // Jalankan SEMUA tool call dalam satu giliran secara paralel — kalau
        // model minta beberapa tool sekaligus (mis. restock + suppliers),
        // jangan tunggu berurutan. Urutan pesan tool tetap mengikuti urutan
        // tool_calls (Promise.all mempertahankan urutan array).
        const toolResults = await Promise.all(
          choice.message.tool_calls.map(async (toolCall) => {
            toolsUsed.push(toolCall.function.name);
            try {
              const args = JSON.parse(toolCall.function.arguments || "{}");
              const result = await this.executeTool(
                auth,
                toolCall.function.name,
                args,
              );
              return {
                tool_call_id: toolCall.id,
                content: JSON.stringify(result),
              };
            } catch {
              return {
                tool_call_id: toolCall.id,
                content: JSON.stringify({ error: "Gagal menjalankan tool" }),
              };
            }
          }),
        );
        for (const r of toolResults) {
          chatMessages.push({
            role: "tool",
            tool_call_id: r.tool_call_id,
            content: r.content,
          });
        }

        response = await callModel(chatMessages);

        iterations++;
      }

      const text = response.choices[0]?.message.content;
      result = { response: text || "Maaf, tidak bisa memproses permintaan." };
    } catch (err) {
      this.logger.error(
        `[AI Assistant] ${(err as Error).message}`,
        (err as Error).stack,
      );
      const msg = err instanceof Error ? err.message : "Unknown error";

      // Fallback: kalau model error karena tool calling validation (Llama-3
      // family quirk), retry tanpa tools — minta model jawab seadanya saja.
      // Ini menjamin user tetap dapat respons walau data terbatas.
      if (
        msg.includes("tool_use_failed") ||
        msg.includes("tool call validation")
      ) {
        this.logger.warn(
          "Tool calling failed — retrying without tools for fallback response",
        );
        try {
          const groqFb = new Groq({ apiKey });
          const fallbackResponse = await groqFb.chat.completions.create({
            model,
            messages: [
              {
                role: "system",
                content:
                  "Kamu asisten AI. User nanya tentang data toko, tapi kamu sedang tidak bisa akses tool/database. Minta maaf, sarankan user buka halaman terkait (mis. /products buat cari produk, /racks buat lihat rak) atau coba lagi sebentar. Singkat, dalam Bahasa Indonesia.",
              },
              ...messages.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            ],
            max_tokens: 256,
            temperature: 0.3,
            reasoning_effort: "low",
          });
          result = {
            response:
              fallbackResponse.choices[0]?.message.content ||
              "Maaf, AI sedang bermasalah. Coba buka halaman /products atau /racks untuk cari produk manual.",
          };
        } catch {
          result = {
            error:
              "AI sedang bermasalah saat memanggil tool. Coba lagi atau buka halaman /products / /racks untuk cari manual.",
          };
        }
      } else if (
        msg.includes("API") ||
        msg.includes("key") ||
        msg.includes("auth")
      ) {
        result = {
          error: "GROQ_API_KEY tidak valid. Dapatkan gratis di console.groq.com",
        };
      } else if (msg.includes("429") || msg.includes("rate")) {
        result = {
          error: "Rate limit tercapai. Coba lagi dalam beberapa detik.",
        };
      } else if (msg.includes("decommissioned") || msg.includes("model")) {
        result = {
          error:
            "Model AI sudah deprecated. Set GROQ_MODEL=openai/gpt-oss-120b di .env backend.",
        };
      } else {
        result = { error: `Gagal memproses: ${msg}` };
      }
    }

    await this.persistLog(auth, question, toolsUsed, startedAt, result);
    return result;
  }
}
