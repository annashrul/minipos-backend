import type { ConfigService } from "@nestjs/config";

/**
 * Klien justDoWorker — relay AI gateway (New API) yang OpenAI-compatible.
 *
 * Dipakai sebagai provider tambahan untuk fitur AI product search:
 *   - vision (cari produk dari foto)
 *   - normalisasi hasil voice-to-text
 *   - fallback tool-calling untuk AI assistant chat
 *
 * CATATAN PENTING: relay ini HANYA melayani path `/v1/chat/completions`.
 * `groq-sdk` TIDAK bisa dipakai dengan `baseURL` override karena SDK selalu
 * menambahkan prefix `/openai/v1` — path itu dijawab HTML dashboard (HTTP 200)
 * sehingga error-nya senyap. Karena itu dipanggil via `fetch` langsung, sama
 * seperti provider OpenRouter/Gemini di ai-assistant.service.ts.
 */

const DEFAULT_BASE_URL = "https://api.justwoker.icu";
const DEFAULT_MODEL = "claude-opus-5";

export type JustDoWorkerSettings = {
  apiKey: string;
  baseUrl: string;
  /** Model teks (normalisasi voice, chat). */
  model: string;
  /** Model vision (cari produk dari foto). Default = `model`. */
  visionModel: string;
};

/**
 * Baca konfigurasi justDoWorker dari env. `null` kalau API key belum diset —
 * pemanggil wajib memperlakukan itu sebagai "provider tidak aktif" (skip).
 */
export function getJustDoWorkerSettings(
  config: ConfigService,
): JustDoWorkerSettings | null {
  const apiKey = (config.get<string>("JUSTDOWORKER_API_KEY") ?? "").trim();
  if (!apiKey) return null;

  const baseUrl = (config.get<string>("JUSTDOWORKER_BASE_URL") || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, "");
  const model = (config.get<string>("JUSTDOWORKER_MODEL") || DEFAULT_MODEL).trim();
  const visionModel = (
    config.get<string>("JUSTDOWORKER_VISION_MODEL") || model
  ).trim();

  return { apiKey, baseUrl, model, visionModel };
}

/** Bentuk minimal respons chat completion yang dipakai di sini. */
export type JustDoWorkerChatCompletion = {
  choices?: {
    message?: { content?: string | null };
    finish_reason?: string;
  }[];
  error?: { message?: string };
};

/**
 * POST /v1/chat/completions ke relay. Body dikirim apa adanya (format OpenAI),
 * jadi bisa dipakai untuk teks, vision (`image_url`), maupun tools.
 *
 * Throw kalau HTTP error ATAU respons bukan JSON — relay membalas halaman HTML
 * untuk path/route yang tidak dikenal, dan itu tidak boleh lolos sebagai sukses.
 */
export async function justDoWorkerChat<T = JustDoWorkerChatCompletion>(
  settings: JustDoWorkerSettings,
  body: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<T> {
  const res = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(
      `respons bukan JSON (HTTP ${res.status}) — cek JUSTDOWORKER_BASE_URL: ${raw
        .slice(0, 120)
        .replace(/\s+/g, " ")}`,
    );
  }

  const errMsg = (data as JustDoWorkerChatCompletion).error?.message;
  if (!res.ok) throw new Error(errMsg ?? `HTTP ${res.status}`);
  return data as T;
}

/**
 * Ambil teks jawaban pertama. Relay kadang membungkus JSON dalam code fence
 * markdown; pembersihan fence dilakukan di sini supaya parser pemanggil
 * (mis. `JSON.parse`) tidak ikut memikirkannya.
 */
export function justDoWorkerContent(res: JustDoWorkerChatCompletion): string {
  const out = res.choices?.[0]?.message?.content ?? "";
  return out
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}
