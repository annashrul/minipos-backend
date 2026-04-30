import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Groq from "groq-sdk";
import type { AiChatMessageDto, AiChatResponse } from "@/contracts";
import { AiToolExecutor } from "./ai-tool-executor.service";
import { TOOLS, type AuthContext } from "./ai-tools.definitions";

const MAX_TOOL_ITERATIONS = 5;
const DEFAULT_MODEL = "llama3-70b-8192";
const MAX_TOKENS = 4096;

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly executor: AiToolExecutor,
  ) {}

  async chat(
    auth: AuthContext,
    messages: AiChatMessageDto[],
  ): Promise<AiChatResponse> {
    const apiKey = this.config.get<string>("GROQ_API_KEY");
    const model = this.config.get<string>("GROQ_MODEL") || DEFAULT_MODEL;

    if (!apiKey) {
      return {
        error:
          "GROQ_API_KEY belum dikonfigurasi. Dapatkan gratis di console.groq.com",
      };
    }

    const groq = new Groq({ apiKey });
    const systemPrompt = buildSystemPrompt(auth);

    try {
      const chatMessages: Groq.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      let response = await groq.chat.completions.create({
        model,
        messages: chatMessages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: MAX_TOKENS,
      });

      let iterations = 0;
      while (iterations < MAX_TOOL_ITERATIONS) {
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
            const result = await this.executor.dispatch(
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

        response = await groq.chat.completions.create({
          model,
          messages: chatMessages,
          tools: TOOLS,
          tool_choice: "auto",
          max_tokens: MAX_TOKENS,
        });

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
      return { error: `Gagal memproses: ${msg}` };
    }
  }
}

function buildSystemPrompt(auth: AuthContext): string {
  return `Kamu adalah asisten AI untuk aplikasi POS "NusaPOS". Kamu WAJIB menggunakan tools/functions yang tersedia untuk menjawab pertanyaan tentang data toko. JANGAN PERNAH mengarang data — selalu panggil tool yang sesuai terlebih dahulu untuk mendapatkan data real-time dari database.

ATURAN KETAT:
1. Jika user bertanya tentang produk, penjualan, stok, kasir, supplier, atau kategori → WAJIB panggil tool dulu, baru jawab berdasarkan hasilnya
2. JANGAN mengarang angka, nama produk, atau data apapun tanpa memanggil tool
3. Jika tidak ada tool yang cocok, jawab "Maaf, saya tidak memiliki akses ke data tersebut"
4. Jawab dalam Bahasa Indonesia
5. Format angka uang dengan Rp (contoh: Rp 150.000)
6. Berikan analisis yang ringkas dan actionable
7. Saat diminta membuat PO, panggil get_restock_recommendation atau search_products dan get_suppliers dulu sebelum create_purchase_order

Contoh alur:
- User: "Produk apa yang laris?" → Panggil get_top_products → Jawab berdasarkan data
- User: "Stok apa yang menipis?" → Panggil get_low_stock → Jawab berdasarkan data
- User: "Buatkan PO" → Panggil get_restock_recommendation + get_suppliers → create_purchase_order

Info user: ${auth.userName} (${auth.role})`;
}
