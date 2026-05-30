import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Groq from "groq-sdk";
import { toDateOnly } from "@/common/utils/date";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { WhatsappReceiptService } from "@/modules/whatsapp-receipt/whatsapp-receipt.service";
import {
  CUSTOMER_TOOLS,
  OWNER_TOOLS,
  executeCustomerTool,
  executeOwnerTool,
  type ToolContext,
} from "./whatsapp-chatbot.tools";
import { WhatsappChatbotRepository } from "./whatsapp-chatbot.repository";

const DEFAULT_PROMPT_CUSTOMER = `Kamu adalah asisten WhatsApp ramah untuk bengkel/toko ini.
Tugas: bantu customer dengan pertanyaan layanan, harga, produk (oli/sparepart/aksesoris), jam buka, lokasi, status booking, dan rekomendasi sederhana.
Gaya: bahasa Indonesia santai-sopan, ringkas (max 4-5 kalimat per balasan), pakai sapaan "Kak". Boleh pakai bullet list bila ada >2 item.

ATURAN HARGA & MENU (WAJIB, paling penting):
- Nama menu/produk dan HARGA HANYA boleh dari hasil tool (browse_menu / search_products / list_services). Kutip PERSIS apa adanya.
- DILARANG KERAS menyebut item atau harga dari INFO BISNIS, ingatan, atau pengetahuan umum seolah-olah itu menu/harga toko ini.
- Kalau item PERSIS yang diminta tidak ada DI HASIL TOOL, TAPI ada item MIRIP/relevan di hasil tool (mis. customer minta "mie goreng kampung", yang ada "Mie Goreng Jawa" atau "Nasi Goreng Kampung"), JANGAN bilang "tidak ada" — TAWARKAN alternatif yang mirip itu beserta harganya, lalu tanya mana yang dimaksud.
- Baru kalau hasil tool benar-benar KOSONG (tidak ada yang mirip sama sekali), katakan "belum tersedia" dan arahkan ke admin. JANGAN mengarang nama atau angka harga.
- Untuk daftar menu/harga, SELALU panggil browse_menu (jangan jawab dari INFO BISNIS).
- Saat customer ingin MEMESAN ("saya mau pesan X", "minta X rasa Y", "bungkus", "order"): panggil start_order dan BERIKAN LINK hasilnya apa adanya supaya customer checkout. PENTING: kalau customer SUDAH menyebut menu + jumlah (mis. "pesan 2 ayam bakar madu dan 1 es teh"), kirim daftar itu ke start_order lewat parameter 'items' (mis. items = [{name: ayam bakar madu, quantity: 2}, {name: es teh manis, quantity: 1}]) supaya keranjang otomatis TERISI saat customer buka link. Sebutkan ringkasan item+jumlah di balasan. Jangan mengarang link/menu.

Cara pilih tool sesuai pertanyaan:
- Pertanyaan "menu apa saja?" / "daftar harga" / "ada makanan/minuman apa?" → panggil browse_menu (sumber harga LIVE dari master)
- Pertanyaan tentang JASA/SERVICE (ganti oli, tune up, spooring, harga jasa) → panggil list_services
- Pertanyaan tentang PRODUK/ITEM spesifik (cari nama tertentu) → panggil search_products dengan kata kunci
- Pertanyaan "jual apa saja?" / "ada kategori apa?" → panggil list_categories
- Pertanyaan "ada meja kosong?" / "masih ada tempat?" / "meja untuk N orang" → panggil check_table_availability
- Pertanyaan "ada promo/diskon/voucher apa?" → panggil list_promotions
- Pertanyaan "booking saya" → panggil get_my_bookings
- Pertanyaan jam buka / alamat / kontak → jawab dari INFO BISNIS langsung, tanpa tool

Aturan rekomendasi (untuk pertanyaan seperti "rekomendasi oli untuk Ayla?"):
1. WAJIB panggil search_products dulu. Pakai query LUAS dulu (mis. query="oli mesin"), JANGAN spesifik nama mobil.
2. Kalau hasil kosong, CEK INFO BISNIS di system prompt — cari section "KATALOG" atau "REKOMENDASI". Pakai info dari sana (sebut "umumnya kami sarankan...").
3. Kalau di INFO BISNIS juga tidak ada info spesifik, kamu BOLEH kasih saran umum yang bersifat TEKNIS/EDUKATIF dari pengetahuanmu (mis. mobil city car → tipe oli 5W-30 atau 10W-30 sintetik). Sebut "rekomendasi umum". TAPI DILARANG menyebut nama produk/menu spesifik atau ANGKA HARGA seolah-olah tersedia di toko ini — itu hanya boleh dari hasil tool.
4. Baru sebagai langkah TERAKHIR, sarankan datang konsultasi langsung.
DILARANG langsung loncat ke step 4 tanpa coba step 2 dan 3.

Contoh flow yang BENAR:
User: "rekomendasi oli untuk Ayla?"
→ panggil search_products(query="oli mesin")
→ tool return kosong + instruction
→ CEK INFO BISNIS — temukan "Mobil city car (Ayla, Brio): 5W-30 sintetik..."
→ Jawab: "Untuk Ayla kak, umumnya kami sarankan oli 5W-30 atau 10W-30 sintetik. Brand seperti Pertamina Fastron, Shell Helix, atau Castrol Magnatec cocok. Kalau mau saya cek ketersediaan stok, kasih tau ya."

Contoh flow yang SALAH (jangan lakukan):
User: "rekomendasi oli untuk Ayla?"
→ search_products kosong
→ Jawab "Maaf belum ada data oli untuk Ayla, silakan datang langsung." ← INI SALAH karena skip INFO BISNIS dan general knowledge.

Aturan saat tool apapun kosong:
- JANGAN langsung bilang "tidak ada info / belum ada data".
- WAJIB cek INFO BISNIS dulu sebelum bilang tidak ada.

Aturan keamanan:
- Jangan kasih data internal (omset, jumlah stok pasti, harga modal). Untuk produk, hanya bilang "tersedia" / "habis".
- Untuk pertanyaan di luar domain otomotif/bengkel, sopan arahkan ke admin.
- Format Rupiah: "Rp 50.000" (pakai titik ribuan).

PENTING — format tool call:
Gunakan structured function call API. JANGAN tulis tool call sebagai teks (misal "<function=...>") dalam balasan. Tunggu hasil tool sebelum jawab user.`;

const DEFAULT_PROMPT_OWNER = `Kamu adalah asisten WhatsApp untuk OWNER bisnis. User ini adalah pemilik usaha — boleh akses SEMUA data internal.
Tugas: bantu jawab APAPUN pertanyaan owner yang berkaitan dengan bisnis mereka.
Gaya: bahasa Indonesia ringkas (1-3 kalimat), to the point, pakai bullet list bila >2 item.

TOOL YANG TERSEDIA (panggil sesuai topik pertanyaan):

🎯 Quick overview:
- get_business_overview — snapshot bisnis hari ini (omset, transaksi, top 3 produk, low stock, shift, booking). Pakai untuk "bagaimana bisnis hari ini?"

📊 Penjualan & Produk:
- get_sales_summary — omset/revenue per periode
- get_top_products — produk terlaris per periode
- get_low_stock — produk yang stoknya menipis/habis
- search_product_stock — cari produk + cek stok & harga
- get_payment_breakdown — breakdown omset per metode bayar (CASH/QRIS/TRANSFER/dll)
- get_recent_transactions — N transaksi terbaru
- search_transaction — cari invoice tertentu by nomor

📅 Booking & Service:
- get_bookings — list booking per periode + filter status
- get_service_orders_summary — SO bengkel per status (ANTRIAN/DIKERJAKAN/SELESAI/dll)

👥 Kasir & Customer:
- get_cashier_performance — ranking performa kasir
- get_shift_status — shift kasir aktif/closed, kas masuk-keluar, selisih
- get_top_customers — pelanggan paling royal
- search_customer — cari info customer by nama/HP/email

💸 Keuangan:
- get_debts_summary — total hutang (PAYABLE) + piutang (RECEIVABLE), outstanding & jatuh tempo
- get_expenses_summary — total pengeluaran operasional per kategori
- get_refunds_summary — total refund / transaksi yang di-void
- get_purchase_orders_summary — PO ke supplier per status

Cara handle PERIODE (semua tool ber-period support):
period enum: today, yesterday, this_week, last_week, this_month, last_month, this_year, last_7_days, last_30_days, all_time
Atau pakai \`from\` + \`to\` (YYYY-MM-DD) untuk range custom.

Contoh interpretasi:
- "bagaimana bisnis hari ini?" → get_business_overview()
- "omset kemarin" → get_sales_summary(period="yesterday")
- "kasir terbaik bulan ini" → get_cashier_performance(period="this_month")
- "kasir mana yang masih buka?" → get_shift_status(status="OPEN")
- "ada selisih kas?" → get_shift_status(period="today")
- "transaksi terakhir 5" → get_recent_transactions(limit=5)
- "cek invoice INV-11052026-00012" → search_transaction(invoiceNumber="INV-11052026-00012")
- "paling banyak pakai QRIS atau cash?" → get_payment_breakdown(period="this_month")
- "SO yang lagi dikerjakan ada berapa?" → get_service_orders_summary(period="today")
- "berapa hutang kita" → get_debts_summary(type="PAYABLE")
- "siapa yang masih hutang ke kita" → get_debts_summary(type="RECEIVABLE")
- "pengeluaran bulan lalu" → get_expenses_summary(period="last_month")
- "refund bulan ini berapa?" → get_refunds_summary(period="this_month")
- "PO yang belum diterima?" → get_purchase_orders_summary(status="ORDERED")
- "pelanggan paling royal tahun ini" → get_top_customers(period="this_year")
- "info customer 0812xxx" → search_customer(query="0812xxx")
- "ada Pertamax di stok?" → search_product_stock(query="Pertamax")

Aturan KETAT:
- JANGAN PERNAH bilang "maaf saya tidak bisa memberikan informasi tentang X" tanpa cek dulu apakah ada tool yang relevan. Cek daftar tool di atas — sebagian besar topik bisnis SUDAH ada tool-nya.
- SELALU panggil tool yang relevan dulu — jangan jawab dari memori/asumsi.
- Kalau pertanyaan ambigu (mis. "performa", "laporan"), tanya balik secara singkat: "Mau lihat performa kasir atau produk?".
- Format angka Rp: "Rp 1.250.000".
- Kalau hasil 0/kosong dari tool, sebut periode-nya: "Tidak ada penjualan kemarin" (bukan "tool tidak bisa").
- Kalau pertanyaan benar-benar di luar scope (mis. cuaca, berita umum), baru bilang "info itu di luar scope sistem POS kami".

PENTING: Untuk memanggil tool, gunakan structured function call format yang disediakan API. JANGAN tulis tool call sebagai teks dalam balasan (misal "<function=...>" atau JSON code block). Tunggu hasil tool sebelum menjawab user.`;

type ChatMessage = Groq.Chat.ChatCompletionMessageParam;

@Injectable()
export class WhatsappChatbotService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappChatbotService.name);
  // Throttle: nomor → epoch ms terakhir reply. In-memory cukup karena hanya
  // anti spam loop dalam window detikan.
  private readonly lastReplyAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: WhatsappChatbotRepository,
    private readonly config: ConfigService,
    private readonly waReceipt: WhatsappReceiptService,
  ) {}

  onModuleInit(): void {
    // Daftarkan handler ke whatsapp-receipt — dipanggil setiap pesan inbound
    // sukses di-persist. Single-instance handler cukup karena Nest provider
    // ini singleton.
    this.waReceipt.registerInboundHandler((p) => this.handleIncoming(p));
    this.logger.log("[bot] inbound handler registered");
  }

  /**
   * Handler inbound — dipanggil dari whatsapp-receipt setelah persist
   * pesan baru. Idempotent dan fail-safe: error apapun di sini tidak
   * boleh meledak ke event handler Baileys.
   */
  async handleIncoming(params: {
    companyId: string;
    fromNumber: string | null;
    remoteJid: string;
    content: string | null;
    fromMe: boolean;
    isGroup: boolean;
  }): Promise<void> {
    if (params.fromMe) return;
    if (params.isGroup) return;
    if (!params.content || params.content.trim().length === 0) return;

    // fromNumber bisa null untuk kontak LID (privasi WA — pengirim belum
    // simpan nomor bisnis). Pakai remoteJid sebagai identitas/throttle key
    // supaya bot tetap membalas; balasan dikirim ke remoteJid (lihat
    // sendTextToJid yang mendukung @lid).
    const senderKey = params.fromNumber ?? params.remoteJid;
    if (!senderKey) return;

    const config = await this.repo.findBotConfigFull(params.companyId);
    if (!config || !config.enabled) return;

    // Anti-loop: throttle per pengirim.
    const now = Date.now();
    const last = this.lastReplyAt.get(senderKey) ?? 0;
    if (now - last < config.replyThrottleSec * 1000) return;
    this.lastReplyAt.set(senderKey, now);

    const role = this.detectRole(config.ownerPhones, params.fromNumber ?? "");
    const reply = await this.generateReply({
      companyId: params.companyId,
      senderPhone: params.fromNumber,
      content: params.content,
      role,
      config,
    });

    if (!reply) return;

    // Kalau balasan memuat link order online (/table/<token>), kirim sebagai
    // pesan tombol "Pesan Sekarang" (best-effort) — wa-service auto-fallback ke
    // teks kalau tombol gagal/tak render. Teks tetap memuat URL.
    const orderUrl = extractOrderUrl(reply);

    try {
      // sendTextToJid/sendOrderButton pakai remoteJid lengkap supaya kompatibel
      // dengan @lid (kontak yang belum tersimpan).
      if (orderUrl) {
        await this.waReceipt.sendOrderButton(
          params.companyId,
          params.remoteJid,
          { text: reply, buttonText: "🛒 Pesan Sekarang", url: orderUrl },
        );
      } else {
        await this.waReceipt.sendTextToJid(
          params.companyId,
          params.remoteJid,
          reply,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[bot] gagal kirim balasan ke ${params.remoteJid}: ${
          err instanceof Error ? err.message : "unknown"
        }`,
      );
    }
  }

  private businessUnitLabel(unit: string): string {
    switch (unit) {
      case "BENGKEL":
        return "Bengkel/servis kendaraan (motor & mobil) — istilah: service, ganti oli, kampas rem, sparepart, booking servis";
      case "RESTAURANT":
        return "Restoran — istilah: menu makanan, pesanan, reservasi meja, take away, delivery";
      case "CAFE":
        return "Cafe/kedai kopi — istilah: menu minuman & makanan ringan, kopi, dessert, suasana santai";
      case "RETAIL":
      default:
        return "Toko retail — istilah: produk, stok, harga, promo";
    }
  }

  private detectRole(
    ownerPhones: string[],
    senderPhone: string,
  ): "OWNER" | "CUSTOMER" {
    const normalized = senderPhone.replace(/\D/g, "");
    for (const owner of ownerPhones) {
      const oNorm = owner.replace(/\D/g, "");
      if (oNorm === normalized) return "OWNER";
      // Toleransi 0 vs 62 prefix.
      if (oNorm.startsWith("62") && normalized === "0" + oNorm.slice(2))
        return "OWNER";
      if (normalized.startsWith("62") && oNorm === "0" + normalized.slice(2))
        return "OWNER";
    }
    return "CUSTOMER";
  }

  /**
   * Generate balasan via Groq dengan tool calling. Dipakai oleh handler
   * inbound dan juga endpoint test (POST /whatsapp-bot/test).
   */
  async generateReply(params: {
    companyId: string;
    senderPhone: string | null;
    content: string;
    role: "OWNER" | "CUSTOMER";
    // Bisa null saat dipanggil dari endpoint test tanpa load config dulu.
    config: {
      knowledge: string | null;
      systemPromptCustomer: string | null;
      systemPromptOwner: string | null;
      model: string;
    } | null;
  }): Promise<string | null> {
    const apiKey = this.config.get<string>("GROQ_API_KEY");
    if (!apiKey) {
      this.logger.warn("GROQ_API_KEY belum diset — bot tidak bisa balas");
      return null;
    }

    const config = params.config;
    // Default model: openai/gpt-oss-20b — ringan & latensi konsisten (penting
    // untuk balasan WA realtime ke pelanggan), tetap sekeluarga gpt-oss jadi
    // tool-calling tetap reliable. Eskalasi ke 120b lalu llama saat rate-limit.
    // Bisa override per-company via WhatsappBotConfig.model.
    const model = config?.model || "openai/gpt-oss-20b";
    const groq = new Groq({ apiKey });

    // Rantai fallback model Groq: tiap model punya kuota TPD (token-per-day)
    // sendiri, jadi kalau model utama kena rate-limit harian kita coba model
    // lain yang sama-sama support tool-calling sebelum lompat ke Gemini.
    const groqModels = [
      model,
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    // Fallback terakhir ke Google AI Studio (Gemini) saat SEMUA model Groq kena
    // rate-limit/quota harian. Pakai endpoint OpenAI-compatible Gemini via fetch
    // langsung (bukan SDK Groq) supaya path URL tidak ter-mangle jadi 404, dan
    // body error (mis. quota=0) ikut terbaca. Aktif kalau GEMINI_API_KEY ada.
    const geminiKey = this.config.get<string>("GEMINI_API_KEY");
    const geminiModel =
      this.config.get<string>("GEMINI_MODEL") || "gemini-2.0-flash";
    const callGemini = async (
      msgs: ChatMessage[],
    ): Promise<Groq.Chat.ChatCompletion> => {
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
            tools,
            tool_choice: "auto",
            max_tokens: 1024,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 300)}`);
      }
      return (await res.json()) as Groq.Chat.ChatCompletion;
    };

    const basePrompt =
      params.role === "OWNER"
        ? config?.systemPromptOwner || DEFAULT_PROMPT_OWNER
        : config?.systemPromptCustomer || DEFAULT_PROMPT_CUSTOMER;

    // Inject business unit ke prompt — supaya bot tahu konteks bisnis
    // tanpa user harus rewrite manual saat switch unit. Company punya
    // field businessUnit: RETAIL / BENGKEL / RESTAURANT / CAFE.
    const company = await this.repo.findCompany(params.companyId);
    const bizContext = company
      ? `\n\n=== KONTEKS BISNIS ===\nNama bisnis: ${company.name}\nJenis usaha: ${this.businessUnitLabel(company.businessUnit)}\nGunakan istilah dan gaya bahasa yang sesuai jenis usaha ini.`
      : "";

    // Inject tanggal & waktu sekarang supaya AI bisa interpret istilah relatif
    // ("kemarin", "minggu lalu", "tanggal 5") dengan akurat. Format Indonesia.
    const now = new Date();
    const dateContext = `\n\n=== WAKTU SAAT INI ===\n${now.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    })}, ${now.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    })} WIB (ISO: ${toDateOnly(now)}).`;

    const knowledge = config?.knowledge?.trim();
    const fullPrompt = knowledge
      ? `${basePrompt}${bizContext}${dateContext}\n\n=== INFO BISNIS ===\n${knowledge}`
      : `${basePrompt}${bizContext}${dateContext}`;

    const tools = params.role === "OWNER" ? OWNER_TOOLS : CUSTOMER_TOOLS;

    // Riwayat pendek dari WhatsappMessageLog supaya bot ingat konteks
    // 5 pesan terakhir antara nomor pengirim dan session ini.
    const history = await this.fetchRecentHistory(
      params.companyId,
      params.senderPhone,
    );

    const messages: ChatMessage[] = [
      { role: "system", content: fullPrompt },
      ...history,
      { role: "user", content: params.content },
    ];

    const ctx: ToolContext = {
      repo: this.repo,
      companyId: params.companyId,
      senderPhone: params.senderPhone,
    };

    // Helper: panggil Groq + handle `tool_use_failed` (Groq server reject
    // response karena model output inline tool call malformed). Saat error,
    // kita extract `failed_generation` dari error body, parse inline calls,
    // dan kembalikan synthetic ChatCompletion supaya loop bisa lanjut.
    const callGroq = async (
      msgs: ChatMessage[],
    ): Promise<Groq.Chat.ChatCompletion> => {
      let lastErr: unknown;
      for (const m of groqModels) {
        try {
          return await groq.chat.completions.create({
            model: m,
            messages: msgs,
            tools,
            tool_choice: "auto",
            // gpt-oss reasoning model — "low" memangkas waktu "berpikir" supaya
            // balasan WA ke pelanggan jauh lebih cepat tanpa menurunkan kualitas
            // tool-calling untuk percakapan order/menu yang lugas.
            reasoning_effort: "low",
            max_tokens: 1024,
          });
        } catch (err) {
          lastErr = err;
          // Rate-limit / quota harian model ini habis — coba model Groq lain
          // (tiap model punya jatah TPD terpisah) sebelum lompat ke Gemini.
          if (isRateLimitError(err)) {
            this.logger.warn(
              `[bot] Groq model ${m} rate-limited — coba model alternatif`,
            );
            continue;
          }
          // Groq SDK error structure tidak konsisten — code & failed_generation
          // bisa ada di:
          //   - err.error?.code, err.error?.failed_generation (typed APIError)
          //   - err.message JSON-stringified (kasus paling sering di log)
          // Coba semua jalur.
          const failed = extractFailedGeneration(err);
          if (failed !== null) {
            this.logger.warn(
              "[bot] Groq tool_use_failed — fallback ke inline parse",
            );
            return {
              id: "synthetic_" + Date.now(),
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model: m,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: failed,
                    refusal: null,
                    tool_calls: [],
                  },
                  finish_reason: "stop",
                  logprobs: null,
                },
              ],
              usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
              },
            } as unknown as Groq.Chat.ChatCompletion;
          }
          throw err;
        }
      }
      // Semua model Groq kena rate-limit harian — fallback terakhir ke Gemini.
      if (geminiKey) {
        this.logger.warn(
          "[bot] Semua model Groq rate-limited — fallback ke Gemini (Google AI Studio)",
        );
        try {
          return await callGemini(msgs);
        } catch (gerr) {
          this.logger.warn(
            `[bot] Gemini fallback gagal: ${(gerr as Error).message}`,
          );
        }
      }
      throw lastErr;
    };

    try {
      let response = await callGroq(messages);

      let iterations = 0;
      while (iterations < 4) {
        const choice = response.choices[0];
        const toolCalls = choice?.message.tool_calls;
        const rawContent = choice?.message.content ?? "";

        // Fallback: beberapa model Llama (dan kadang versatile-70b) gagal
        // pakai structured tool_calls dan malah inline tool sebagai text
        // <function=NAME>{...}</function>. Parse manual + execute supaya
        // user tidak lihat raw markup di balasan WA.
        const inlineCalls = (!toolCalls || toolCalls.length === 0)
          ? parseInlineToolCalls(rawContent)
          : [];

        if ((!toolCalls || toolCalls.length === 0) && inlineCalls.length === 0)
          break;

        // Saat dari synthetic response (failed_generation), JANGAN push
        // assistant message dengan content yang berisi raw markup — model
        // bisa keulang. Push assistant tanpa content (tool_calls dummy).
        if (toolCalls && toolCalls.length > 0) {
          messages.push(choice.message);
        } else {
          // Strip markup dari natural-text part supaya model tidak ngulang
          // pola yang sama saat lihat history.
          const cleaned = stripInlineToolMarkup(rawContent);
          messages.push({
            role: "assistant",
            content: cleaned || "(memanggil tool)",
          });
        }

        const callsToRun = toolCalls && toolCalls.length > 0
          ? toolCalls.map((tc) => ({
              id: tc.id,
              name: tc.function.name,
              args: tc.function.arguments || "{}",
            }))
          : inlineCalls;

        for (const tc of callsToRun) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.args) as Record<string, unknown>;
          } catch {
            args = {};
          }
          let result: unknown;
          try {
            result =
              params.role === "OWNER"
                ? await executeOwnerTool(ctx, tc.name, args)
                : await executeCustomerTool(ctx, tc.name, args);
          } catch (err) {
            result = {
              error: err instanceof Error ? err.message : "Tool error",
            };
          }
          // Saat structured tool_calls, kita pakai role:tool dengan
          // tool_call_id. Saat inline (synthetic), append result sebagai
          // user message dengan prefix supaya model tau itu hasil tool
          // (role:tool butuh tool_call_id matching dari assistant message
          // sebelumnya — kalau pakai dummy, Groq juga reject).
          if (toolCalls && toolCalls.length > 0) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify(result),
            });
          } else {
            messages.push({
              role: "user",
              content: `[Hasil tool ${tc.name}]: ${JSON.stringify(result)}\n\nGunakan hasil di atas untuk menjawab pertanyaan saya sebelumnya. Jangan panggil tool lagi kecuali memang perlu.`,
            });
          }
        }

        response = await callGroq(messages);
        iterations++;
      }

      let text = response.choices[0]?.message.content?.trim() ?? null;
      // Defense in depth: kalau model masih nyisain markup di final answer
      // (mis. tool sudah di-execute tapi text-nya masih nyebut tag), strip.
      if (text) text = stripInlineToolMarkup(text);
      return text || null;
    } catch (err) {
      this.logger.error(
        `[bot] Groq error: ${err instanceof Error ? err.message : "unknown"}`,
      );
      return null;
    }
  }

  private async fetchRecentHistory(
    companyId: string,
    fromNumber: string | null,
  ): Promise<ChatMessage[]> {
    if (!fromNumber) return [];
    const session = await this.repo.findSession(companyId);
    if (!session) return [];
    // Ambil 6 pesan terakhir antara session ↔ nomor ini, lalu reverse jadi
    // urutan kronologis. Skip pesan dengan content kosong (image, sticker).
    const rows = await this.repo.findRecentMessages(session.id, fromNumber);
    return rows
      .reverse()
      .filter((r) => r.content && r.content.trim().length > 0)
      .map<ChatMessage>((r) =>
        r.direction === "INBOUND"
          ? { role: "user", content: r.content as string }
          : { role: "assistant", content: r.content as string },
      );
  }

  // ─── Config CRUD ─────────────────────────────────────────────────

  async getConfig(companyId: string) {
    const company = await this.repo.findCompany(companyId);
    const businessUnit = company?.businessUnit ?? "RETAIL";

    const c = await this.repo.findBotConfigFull(companyId);
    if (c) return this.toConfigResponse(c, businessUnit);

    // Auto-create default kalau belum ada. Knowledge di-pre-fill dengan
    // template sesuai businessUnit company supaya user tidak mulai dari
    // textarea kosong — tinggal edit detail spesifik (alamat, harga real).
    const knowledge = company
      ? this.defaultKnowledgeForBusinessUnit(
          company.businessUnit,
          company.name,
        )
      : null;
    const created = await this.repo.createBotConfig({
      companyId,
      knowledge,
    });
    return this.toConfigResponse(created, businessUnit);
  }

  /**
   * Knowledge template default per business unit — jadi placeholder yang
   * user bisa edit. Bukan final answer, harus diisi detail bisnis (alamat,
   * jam buka real, harga, dst). Auto-applied saat config baru dibuat.
   */
  private defaultKnowledgeForBusinessUnit(
    unit: string,
    companyName: string,
  ): string {
    const header = `${companyName}\nAlamat: (isi alamat)\nJam buka: (isi jam buka)\nTelp: (isi nomor telepon)\n\n`;
    switch (unit) {
      case "BENGKEL":
        return (
          header +
          `=== LAYANAN & HARGA ===
Daftar layanan/jasa & harga diambil OTOMATIS dari sistem (master) secara live — jangan tulis harga manual di sini.

=== PANDUAN OLI (saran tipe umum, BUKAN daftar harga/stok) ===
- Mobil city car (Ayla, Brio, Calya): 5W-30 atau 10W-30 sintetik
- Motor matic <125cc: 10W-30
- Motor sport >150cc: 10W-40 sintetik
- Mobil diesel: oli khusus diesel
Catatan: ini saran tipe oli umum; ketersediaan & harga produk dicek lewat sistem.

=== KATA KUNCI POPULER ===
oli mesin, kampas rem, aki, busi, filter udara, ban, spooring, balancing, AC, tune up.`
        );
      case "RESTAURANT":
        return (
          header +
          `=== MENU & HARGA ===
Menu dan harga diambil OTOMATIS dari sistem (master produk) secara live. Jangan tulis menu/harga manual di sini.

=== LAYANAN ===
- Dine-in
- Take away
- Delivery (GoFood / GrabFood / ShopeeFood)
- Reservasi meja untuk grup >= 6 orang

=== RESERVASI ===
Customer bisa reservasi via WhatsApp ini. Sebut: nama, jumlah orang, tanggal & jam, request khusus.

=== KATA KUNCI POPULER ===
menu, harga, reservasi, take away, delivery, paket keluarga, halal, vegetarian.`
        );
      case "CAFE":
        return (
          header +
          `Suasana: cozy, ada outdoor seating, free WiFi, ramah laptop warriors.

=== MENU & HARGA ===
Menu dan harga diambil OTOMATIS dari sistem (master produk) secara live. Jangan tulis menu/harga manual di sini.

=== LAYANAN ===
- Dine-in dengan free WiFi & outlet di tiap meja
- Take away
- Booking acara kecil (ulang tahun, gathering 10-30 orang)

=== KATA KUNCI POPULER ===
menu, kopi, harga, wifi, outlet, parkir, booking acara, dine-in.`
        );
      case "RETAIL":
      default:
        return (
          header +
          `=== KATEGORI PRODUK ===
- (isi kategori produk yang dijual)

=== LAYANAN ===
- Belanja di toko langsung
- (opsional) Antar / delivery untuk area sekitar
- (opsional) Pre-order produk grosir

=== KATA KUNCI POPULER ===
harga, stok, ada nggak, jam buka, antar.`
        );
    }
  }

  /**
   * Reset knowledge ke template default sesuai businessUnit. Dipakai dari
   * endpoint reset di UI — tombol "Pakai template default".
   */
  async resetKnowledgeToDefault(companyId: string) {
    const company = await this.repo.findCompany(companyId);
    if (!company) {
      throw new Error("Company tidak ditemukan");
    }
    const knowledge = this.defaultKnowledgeForBusinessUnit(
      company.businessUnit,
      company.name,
    );
    const updated = await this.repo.upsertBotConfig(
      companyId,
      { companyId, knowledge },
      { knowledge },
    );
    return this.toConfigResponse(updated, company.businessUnit);
  }

  async updateConfig(
    companyId: string,
    dto: {
      enabled?: boolean;
      ownerPhones?: string[];
      knowledge?: string | null;
      systemPromptCustomer?: string | null;
      systemPromptOwner?: string | null;
      model?: string;
      replyThrottleSec?: number;
    },
  ) {
    // Normalisasi owner phones ke 62xxx supaya konsisten dengan deteksi role.
    const ownerPhones = dto.ownerPhones?.map((p) => {
      const digits = p.replace(/\D/g, "");
      if (digits.startsWith("0")) return "62" + digits.slice(1);
      if (digits.startsWith("62")) return digits;
      return digits;
    });

    const updated = await this.repo.upsertBotConfig(
      companyId,
      {
        companyId,
        enabled: dto.enabled ?? false,
        ownerPhones: ownerPhones ?? [],
        knowledge: dto.knowledge ?? null,
        systemPromptCustomer: dto.systemPromptCustomer ?? null,
        systemPromptOwner: dto.systemPromptOwner ?? null,
        model: dto.model ?? "openai/gpt-oss-120b",
        replyThrottleSec: dto.replyThrottleSec ?? 3,
      },
      {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(ownerPhones !== undefined ? { ownerPhones } : {}),
        ...(dto.knowledge !== undefined ? { knowledge: dto.knowledge } : {}),
        ...(dto.systemPromptCustomer !== undefined
          ? { systemPromptCustomer: dto.systemPromptCustomer }
          : {}),
        ...(dto.systemPromptOwner !== undefined
          ? { systemPromptOwner: dto.systemPromptOwner }
          : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
        ...(dto.replyThrottleSec !== undefined
          ? { replyThrottleSec: dto.replyThrottleSec }
          : {}),
      },
    );
    const company = await this.repo.findCompany(companyId);
    return this.toConfigResponse(updated, company?.businessUnit ?? "RETAIL");
  }

  async testReply(
    companyId: string,
    message: string,
    asOwner: boolean,
  ): Promise<{ reply: string | null }> {
    const config = await this.repo.findBotConfigFull(companyId);
    const reply = await this.generateReply({
      companyId,
      senderPhone: null,
      content: message,
      role: asOwner ? "OWNER" : "CUSTOMER",
      config,
    });
    return { reply };
  }

  private toConfigResponse(
    c: {
      id: string;
      enabled: boolean;
      ownerPhones: string[];
      knowledge: string | null;
      systemPromptCustomer: string | null;
      systemPromptOwner: string | null;
      model: string;
      replyThrottleSec: number;
    },
    businessUnit: string,
  ) {
    return {
      id: c.id,
      enabled: c.enabled,
      ownerPhones: c.ownerPhones,
      knowledge: c.knowledge,
      systemPromptCustomer: c.systemPromptCustomer,
      systemPromptOwner: c.systemPromptOwner,
      model: c.model,
      replyThrottleSec: c.replyThrottleSec,
      businessUnit,
    };
  }
}

// ─── Inline tool-call fallback ───────────────────────────────────────
// Model open-source kadang gagal pakai structured tool_calls dan inline
// tool sebagai text. Banyak variasi malformed yang muncul di field
// `failed_generation` dari Groq saat tool_use_failed:
//   1. <function=NAME>{"k":"v"}</function>          ← proper Hermes
//   2. <function=NAME={"k":"v"}</function>           ← malformed (no `>`)
//   3. <function=NAME>{"k":"v"}<function/>           ← malformed close tag
//   4. <function_call>{"name":"NAME","arguments":{}}</function_call>
// Parser ini greedy-permissive: tangkap nama function + isi JSON-like
// di antara delimiter, validate dengan parse-or-fallback.

// Format-1 dan format-2 (Llama family — paling umum di Groq).
// `<function=` lalu nama, optional `>`, lalu body JSON sampai `</function`
// atau `<function/`. Body bisa "={...}" atau ">{...}" — kita ekstrak JSON
// pertama dari body.
const INLINE_FN_RE_LOOSE =
  /<function[=:]?\s*([a-zA-Z0-9_]+)\s*[=>]?\s*([\s\S]*?)\s*<\/?\s*function\s*\/?\s*>/gi;

type ParsedInlineCall = { id: string; name: string; args: string };

// Deteksi error rate-limit / quota (Groq harian) untuk memicu fallback Gemini.
function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 429) return true;
  const msg = (e.message ?? "").toLowerCase();
  return /rate.?limit|quota|too many requests|resource_exhausted|daily limit|limit reached|insufficient_quota|(^|\D)429(\D|$)/.test(
    msg,
  );
}

// Ekstrak URL order online (mengandung /table/<token>) dari teks balasan,
// buang tanda baca penutup. Dipakai untuk memutuskan kirim pesan tombol.
function extractOrderUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>)\]]+\/table\/[^\s<>)\]]+/i);
  if (!m) return null;
  return m[0].replace(/[).,;]+$/, "");
}

// Set nama tool yang valid — dipakai untuk mengenali tool-call JSON polos
// yang bocor ke content (mis. gpt-oss kadang emit {"name":"...","arguments":{}}).
const KNOWN_TOOL_NAMES = new Set(
  [...OWNER_TOOLS, ...CUSTOMER_TOOLS]
    .map((t) => t.function?.name)
    .filter((n): n is string => typeof n === "string"),
);

// Ekstrak objek JSON balanced `{...}` top-level dari teks (brace-aware,
// string-aware) — regex tidak cukup karena args punya nested braces.
function extractBalancedJsonObjects(text: string): string[] {
  const objs: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          objs.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  return objs;
}

function parseInlineToolCalls(content: string): ParsedInlineCall[] {
  if (!content) return [];
  const out: ParsedInlineCall[] = [];

  // Format-1: markup <function=NAME>{...}</function> (Llama family).
  if (content.includes("<function")) {
    let m: RegExpExecArray | null;
    INLINE_FN_RE_LOOSE.lastIndex = 0;
    while ((m = INLINE_FN_RE_LOOSE.exec(content)) !== null) {
      const name = m[1];
      const rawBody = (m[2] ?? "").trim();
      const jsonMatch = rawBody.match(/\{[\s\S]*\}/);
      const args = jsonMatch ? jsonMatch[0] : "{}";
      if (name) {
        out.push({ id: `inline_${out.length}_${Date.now()}`, name, args });
      }
    }
  }

  // Format-2: JSON polos {"name":"tool","arguments":{...}} — gpt-oss-120b
  // kadang emit tool call sebagai teks JSON, bukan structured tool_calls.
  // Tanpa ini, JSON mentah ikut terkirim ke customer & tool tak dieksekusi.
  if (
    out.length === 0 &&
    content.includes('"name"') &&
    content.includes('"arguments"')
  ) {
    for (const obj of extractBalancedJsonObjects(content)) {
      try {
        const parsed = JSON.parse(obj) as {
          name?: unknown;
          arguments?: unknown;
        };
        if (
          typeof parsed.name === "string" &&
          KNOWN_TOOL_NAMES.has(parsed.name)
        ) {
          const args =
            parsed.arguments && typeof parsed.arguments === "object"
              ? JSON.stringify(parsed.arguments)
              : "{}";
          out.push({
            id: `inline_${out.length}_${Date.now()}`,
            name: parsed.name,
            args,
          });
        }
      } catch {
        /* bukan JSON valid — skip */
      }
    }
  }
  return out;
}

function stripInlineToolMarkup(text: string): string {
  // Strip variasi tag <function...>...</function> / <function/>.
  let out = text
    .replace(INLINE_FN_RE_LOOSE, "")
    .replace(/<\/?\s*function[^>]*\/?>/gi, "");
  // Buang objek JSON tool-call yang bocor ke teks final (defense in depth).
  if (out.includes('"name"') && out.includes('"arguments"')) {
    for (const obj of extractBalancedJsonObjects(out)) {
      try {
        const parsed = JSON.parse(obj) as { name?: unknown };
        if (
          typeof parsed.name === "string" &&
          KNOWN_TOOL_NAMES.has(parsed.name)
        ) {
          out = out.replace(obj, "");
        }
      } catch {
        /* ignore */
      }
    }
  }
  return out.trim();
}

/**
 * Coba extract `failed_generation` dari error Groq SDK. Error bisa hadir
 * dalam beberapa shape:
 *   1. Typed: err.error.code === "tool_use_failed", err.error.failed_generation
 *   2. err.message berisi JSON-stringified body: '400 {"error":{"code":..."}}'
 *   3. err.error stringified
 * Return null kalau bukan tool_use_failed atau tidak ada failed_generation.
 */
function extractFailedGeneration(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;

  // Path 1: typed property access.
  const errorObj = (e.error ?? null) as Record<string, unknown> | null;
  if (errorObj && typeof errorObj === "object") {
    if (
      errorObj.code === "tool_use_failed" &&
      typeof errorObj.failed_generation === "string"
    ) {
      return errorObj.failed_generation;
    }
  }

  // Path 2: parse err.message JSON. Kadang Groq SDK lempar Error dengan
  // message = "STATUS_CODE BODY_JSON" atau langsung BODY_JSON.
  if (typeof e.message === "string") {
    const msg = e.message;
    // Cari JSON object pertama di message.
    const jsonStart = msg.indexOf("{");
    if (jsonStart >= 0) {
      const jsonStr = msg.slice(jsonStart);
      try {
        const parsed = JSON.parse(jsonStr) as {
          error?: {
            code?: string;
            failed_generation?: string;
          };
        };
        if (
          parsed.error?.code === "tool_use_failed" &&
          typeof parsed.error.failed_generation === "string"
        ) {
          return parsed.error.failed_generation;
        }
      } catch {
        // ignore parse fail
      }
    }
  }

  return null;
}
