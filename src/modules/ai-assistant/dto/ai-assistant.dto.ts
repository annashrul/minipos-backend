import { z } from "zod";

export const AiChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type AiChatMessageDto = z.infer<typeof AiChatMessageSchema>;

export const AiChatRequestSchema = z.object({
  messages: z.array(AiChatMessageSchema).min(1),
});
export type AiChatRequestDto = z.infer<typeof AiChatRequestSchema>;

// Blok data terstruktur hasil tool — dikirim ke frontend supaya jawaban bisa
// dirender sebagai tabel/kartu (bukan cuma teks). `tool` = nama tool yang
// menghasilkan, `data` = hasil mentah tool itu.
export type AiChatDataBlock = {
  tool: string;
  data: unknown;
};

export type AiChatResponse = {
  response?: string;
  error?: string;
  blocks?: AiChatDataBlock[];
};

// Normalisasi hasil voice-to-text -> kata kunci pencarian yang benar.
export const NormalizeSearchSchema = z.object({
  transcript: z.string().min(1),
  // Alternatif hasil STT (N-best). AI memilih yang paling tepat thd katalog.
  alternatives: z.array(z.string()).max(10).optional(),
  candidates: z.array(z.string()).max(300).optional(),
});
export type NormalizeSearchDto = z.infer<typeof NormalizeSearchSchema>;

export type NormalizeSearchResponse = {
  query: string;
};

// Cari produk berdasarkan FOTO (vision) -> kata kunci pencarian.
export const SearchByImageSchema = z.object({
  // data URL: "data:image/jpeg;base64,...." (resolusi dinaikkan utk akurasi)
  image: z.string().min(1).max(3_000_000),
  candidates: z.array(z.string()).max(300).optional(),
});
export type SearchByImageDto = z.infer<typeof SearchByImageSchema>;

export type SearchByImageResponse = {
  query: string;
  similar: string[];
  error?: string;
};

// Query audit log percakapan AI (untuk halaman/endpoint audit).
export const AiLogsQuerySchema = z.object({
  status: z.enum(["ANSWERED", "UNANSWERED", "ERROR"]).optional(),
  days: z.coerce.number().int().positive().max(365).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type AiLogsQueryDto = z.infer<typeof AiLogsQuerySchema>;
