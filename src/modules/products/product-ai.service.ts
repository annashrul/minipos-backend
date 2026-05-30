import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Groq from "groq-sdk";
import { PrismaService } from "@/modules/prisma/prisma.service";

/**
 * Mini AI helper: generate deskripsi produk yang SPESIFIK ke item-nya,
 * BUKAN definisi umum produk. Pakai Groq Llama-3 — fast & gratis-tier.
 *
 * Strategi prompt:
 *   - Few-shot dengan contoh BAGUS vs JELEK
 *   - Larangan eksplisit: no definisi, no "X adalah...", no marketing fluff
 *   - Fokus: kompatibilitas, use-case, spec actionable, alasan beli
 *   - Tone: faktual, seperti ngomong ke konsumen yang nanya "kenapa pilih ini?"
 */

// Deteksi error rate-limit / quota habis (Groq 429 / Gemini RESOURCE_EXHAUSTED).
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
export class ProductAiService {
  private readonly logger = new Logger(ProductAiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async generateDescription(params: {
    productName: string;
    categoryId?: string | null;
    brandId?: string | null;
    unit?: string | null;
  }): Promise<{ description: string }> {
    const { productName, categoryId, brandId, unit } = params;
    if (!productName?.trim()) {
      throw new BadRequestException("Nama produk wajib diisi");
    }

    const apiKey = this.config.get<string>("GROQ_API_KEY");
    const model =
      this.config.get<string>("GROQ_MODEL") || "openai/gpt-oss-120b";

    if (!apiKey) {
      throw new InternalServerErrorException(
        "GROQ_API_KEY belum dikonfigurasi. Dapatkan gratis di console.groq.com",
      );
    }

    // Resolve nama kategori & brand dari DB supaya konteks kaya.
    const [category, brand] = await Promise.all([
      categoryId
        ? this.prisma.category.findUnique({
            where: { id: categoryId },
            select: { name: true },
          })
        : Promise.resolve(null),
      brandId
        ? this.prisma.brand.findUnique({
            where: { id: brandId },
            select: { name: true },
          })
        : Promise.resolve(null),
    ]);

    const contextLines: string[] = [];
    if (category?.name) contextLines.push(`Kategori: ${category.name}`);
    if (brand?.name) contextLines.push(`Brand/Merek: ${brand.name}`);
    if (unit) contextLines.push(`Satuan: ${unit}`);
    const contextStr =
      contextLines.length > 0 ? `\n${contextLines.join("\n")}` : "";

    const systemPrompt = `Kamu copywriter produk untuk toko spare-part / bengkel motor & mobil di Indonesia.

TUGAS: Tulis deskripsi SPESIFIK untuk SATU varian produk berdasarkan nama lengkapnya. Pembaca = mekanik / pemilik kendaraan yang lagi pertimbangin beli item ini.

ATURAN KETAT (WAJIB DIIKUTI):
1. JANGAN tulis definisi umum produk. Pembaca sudah tahu "oli itu apa", "ban itu apa", dsb.
   ❌ JELEK: "Oli mesin adalah cairan pelumas yang penting untuk mesin..."
   ❌ JELEK: "Aki adalah komponen yang menyuplai listrik untuk kendaraan..."
2. JANGAN mulai dengan frasa generik: "Produk ini...", "Item ini adalah...", "Merupakan...".
3. FOKUS ke 3 hal:
   (a) Cocok untuk motor/mobil apa (parse dari nama: Vario, NMAX, PCX, Avanza, dst).
   (b) Use case kapan/kenapa dipilih (matic harian, sport touring, banjir, perjalanan jauh, dll).
   (c) 1 spec/keunggulan teknis yang relevan dari nama (sintetik vs mineral, tubeless vs tube-type, MF vs basah, iridium vs nikel, dll).
4. JANGAN sebut harga, stok, diskon, promo.
5. JANGAN emoji, markdown (no **bold**, no bullet, no heading).
6. Panjang: 2-3 kalimat, total 30-60 kata. Padat & informatif.
7. Bahasa Indonesia natural. Boleh pakai istilah teknis (CC, FA, MF, viskositas, dll) — pembaca tahu.
8. Output HANYA teks deskripsi. Tanpa preamble "Berikut deskripsi:" atau penutup.

CONTOH BAGUS:
Input: "AHM Oil SPX2 Matic 0.8L" / Kategori: Oli / Brand: AHM
Output: "Oli matic semi-sintetik direkomendasikan Honda untuk skutik 110-125cc seperti Beat dan Scoopy. Cocok dipakai harian di kondisi stop-and-go perkotaan. Ganti tiap 2.500-3.000 km untuk performa CVT yang optimal."

Input: "Ban FDR Sport XR Evo 80/80-14"
Output: "Ban tubeless ukuran 80/80-14 untuk roda depan motor matic 110-125cc seperti Beat, Scoopy, dan Mio. Compound dual-tread memberikan grip stabil di aspal kering dan tahan slip saat hujan. Pattern bisa atasi genangan tipis."

Input: "NGK Iridium CR8EIX" / Kategori: Busi
Output: "Busi iridium elektroda 0.6mm untuk motor 150-250cc seperti Vario 150, PCX, dan CB150R. Pembakaran lebih sempurna dibanding busi standar, irit BBM, dan tarikan responsif. Usia pakai 2-3x lebih lama dari busi nikel biasa."

Input: "Aki Motor GS Astra GTZ5S MF (Beat/Vario)"
Output: "Aki kering MF (Maintenance Free) 12V 3.5Ah untuk Honda Beat, Vario 110/125, dan Scoopy. Tidak perlu isi air aki, plug-and-play langsung pakai. Cocok pengguna harian yang malas urus perawatan basah."`;

    const userPrompt = `Nama produk: ${productName.trim()}${contextStr}

Tulis deskripsinya (ikuti aturan ketat di atas, lihat contoh).`;

    try {
      const groq = new Groq({ apiKey });
      const candidateModels = Array.from(
        new Set([model, "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]),
      );
      let lastError: unknown = null;
      let bestPartialDescription = "";

      for (const candidateModel of candidateModels) {
        try {
          const response = await groq.chat.completions.create({
            model: candidateModel,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            // GPT-OSS can spend part of the budget on reasoning. Keep enough
            // room so the final answer is not returned as empty content.
            max_tokens: 700,
            temperature: 0.5,
          });

          const text = response.choices[0]?.message?.content?.trim() ?? "";
          if (!text) {
            lastError = new Error(
              `AI tidak mengembalikan deskripsi (${candidateModel})`,
            );
            this.logger.warn((lastError as Error).message);
            continue;
          }

          const cleaned = text.replace(/^["'`]+|["'`]+$/g, "").trim();
          bestPartialDescription ||= cleaned;
          if (!/[.!?]$/.test(cleaned)) {
            lastError = new Error(
              `AI mengembalikan deskripsi yang belum selesai (${candidateModel})`,
            );
            this.logger.warn((lastError as Error).message);
            continue;
          }

          return { description: cleaned };
        } catch (err) {
          lastError = err;
          if (
            err instanceof Error &&
            /api[_ ]?key|unauthorized|401/i.test(err.message)
          ) {
            throw err;
          }
          this.logger.warn(
            `Generate description failed with ${candidateModel}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // Semua model Groq gagal karena rate-limit/quota harian → fallback ke
      // Gemini (Google AI Studio) via endpoint OpenAI-compatible. Tanpa tools,
      // jadi cukup plain text generation.
      const geminiKey = this.config.get<string>("GEMINI_API_KEY");
      if (geminiKey && isRateLimitError(lastError)) {
        this.logger.warn(
          "[ProductAI] Semua model Groq rate-limited — fallback ke Gemini",
        );
        try {
          const geminiModel =
            this.config.get<string>("GEMINI_MODEL") || "gemini-2.0-flash";
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
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPrompt },
                ],
                max_tokens: 700,
                temperature: 0.5,
              }),
            },
          );
          if (res.ok) {
            const data = (await res.json()) as {
              choices?: { message?: { content?: string } }[];
            };
            const text = data.choices?.[0]?.message?.content?.trim() ?? "";
            const cleaned = text.replace(/^["'`]+|["'`]+$/g, "").trim();
            if (cleaned) {
              return {
                description: /[.!?]$/.test(cleaned)
                  ? cleaned
                  : `${cleaned.replace(/[,\s]+$/g, "")}.`,
              };
            }
          } else {
            const body = await res.text().catch(() => "");
            this.logger.warn(
              `[ProductAI] Gemini fallback gagal: HTTP ${res.status} ${body.slice(0, 200)}`,
            );
          }
        } catch (gerr) {
          this.logger.warn(
            `[ProductAI] Gemini fallback error: ${(gerr as Error).message}`,
          );
        }
      }

      if (bestPartialDescription) {
        return { description: `${bestPartialDescription.replace(/[,\s]+$/g, "")}.` };
      }

      throw lastError instanceof Error
        ? lastError
        : new Error("AI tidak mengembalikan deskripsi");
    } catch (err) {
      this.logger.error("Failed to generate description", err);
      if (err instanceof Error && /api[_ ]?key|unauthorized|401/i.test(err.message)) {
        throw new InternalServerErrorException("GROQ_API_KEY tidak valid");
      }
      throw new InternalServerErrorException(
        "Gagal generate deskripsi: " + (err as Error).message,
      );
    }
  }
}
