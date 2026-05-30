import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiChatMessageDto, AiChatResponse } from "./dto/ai-assistant.dto";
import Groq from "groq-sdk";
import { AiAssistantToolsService } from "./ai-assistant-tools.service";

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
      description: "Mendapatkan produk yang lambat/tidak terjual.",
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
  ) {}

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
            input as { limit?: number; days?: number; branchId?: string },
          );
        case "get_slow_products":
          return await this.tools.executeGetSlowProducts(
            input as { days?: number; limit?: number },
          );
        case "get_sales_summary":
          return await this.tools.executeGetSalesSummary(
            input as { period?: string; branchId?: string },
          );
        case "get_low_stock":
          return await this.tools.executeGetLowStock(
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
            input as { days?: number },
          );
        case "search_products":
          return await this.tools.executeSearchProducts(
            auth,
            input as { query: string },
          );
        case "get_suppliers":
          return await this.tools.executeGetSuppliers();
        case "get_category_sales":
          return await this.tools.executeGetCategorySales(
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
3. Jika tidak ada tool yang cocok, jawab "Maaf, saya tidak punya akses ke data tersebut"
4. Bahasa Indonesia, ringkas, langsung ke jawabannya. JANGAN bertele-tele.
5. Format angka uang dengan Rp (contoh: Rp 150.000)
6. WAJIB pakai find_product_location saat user nanya LOKASI/POSISI produk ("dimana", "rak mana", "ada di mana", "letak", "cariin")
7. WAJIB pakai lookup_rack_contents saat user nanya ISI RAK ("apa isi rak X", "produk apa di rak Y", "tampilkan rak Z")
8. find_low_stock_with_location lebih baik daripada get_low_stock karena include lokasi rak
9. Saat buat PO, panggil get_restock_recommendation + get_suppliers dulu

CONTOH ALUR:
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

    if (!apiKey) {
      return {
        error:
          "GROQ_API_KEY belum dikonfigurasi. Dapatkan gratis di console.groq.com",
      };
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
            max_tokens: 4096,
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
              max_tokens: 4096,
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

        for (const toolCall of choice.message.tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            const result = await this.executeTool(
              auth,
              toolCall.function.name,
              args,
            );
            chatMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          } catch {
            chatMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: "Gagal menjalankan tool" }),
            });
          }
        }

        response = await callModel(chatMessages);

        iterations++;
      }

      const text = response.choices[0]?.message.content;
      return { response: text || "Maaf, tidak bisa memproses permintaan." };
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
          const groq = new Groq({ apiKey });
          const fallbackResponse = await groq.chat.completions.create({
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
          });
          return {
            response:
              fallbackResponse.choices[0]?.message.content ||
              "Maaf, AI sedang bermasalah. Coba buka halaman /products atau /racks untuk cari produk manual.",
          };
        } catch {
          return {
            error:
              "AI sedang bermasalah saat memanggil tool. Coba lagi atau buka halaman /products / /racks untuk cari manual.",
          };
        }
      }

      if (msg.includes("API") || msg.includes("key") || msg.includes("auth")) {
        return {
          error:
            "GROQ_API_KEY tidak valid. Dapatkan gratis di console.groq.com",
        };
      }
      if (msg.includes("429") || msg.includes("rate")) {
        return {
          error: "Rate limit tercapai. Coba lagi dalam beberapa detik.",
        };
      }
      if (msg.includes("decommissioned") || msg.includes("model")) {
        return {
          error:
            "Model AI sudah deprecated. Set GROQ_MODEL=openai/gpt-oss-120b di .env backend.",
        };
      }
      return { error: `Gagal memproses: ${msg}` };
    }
  }
}
