import { z } from "zod";

export const WhatsappBotConfigUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  ownerPhones: z.array(z.string().trim().min(1)).optional(),
  knowledge: z.string().nullable().optional(),
  systemPromptCustomer: z.string().nullable().optional(),
  systemPromptOwner: z.string().nullable().optional(),
  model: z.string().min(1).optional(),
  replyThrottleSec: z.number().int().min(0).max(300).optional(),
});
export type WhatsappBotConfigUpdateDto = z.infer<
  typeof WhatsappBotConfigUpdateSchema
>;

export type WhatsappBotConfigResponse = {
  id: string;
  enabled: boolean;
  ownerPhones: string[];
  knowledge: string | null;
  systemPromptCustomer: string | null;
  systemPromptOwner: string | null;
  model: string;
  replyThrottleSec: number;
  // Business unit dari company user — RETAIL / BENGKEL / RESTAURANT / CAFE.
  // Frontend pakai untuk adaptasi UI (contoh placeholder, label, etc).
  businessUnit: string;
};

export const WhatsappBotTestSchema = z.object({
  message: z.string().trim().min(1),
  asOwner: z.boolean().default(false),
});
export type WhatsappBotTestDto = z.infer<typeof WhatsappBotTestSchema>;

export type WhatsappBotTestResponse = {
  reply?: string;
  error?: string;
  toolsUsed?: string[];
};
