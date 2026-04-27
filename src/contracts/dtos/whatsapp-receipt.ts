import { z } from "zod";

/**
 * WhatsApp digital-receipt module.
 * Generates the printable receipt text for a transaction and a wa.me link
 * that the client can open. The actual sending happens client-side by
 * opening the wa.me URL.
 */

export const WhatsAppReceiptTextParamsSchema = z.object({
  transactionId: z.string().min(1),
});
export type WhatsAppReceiptTextParamsDto = z.infer<
  typeof WhatsAppReceiptTextParamsSchema
>;

export type WhatsAppReceiptTextResponse = {
  text: string;
};

export const WhatsAppReceiptLinkQuerySchema = z.object({
  transactionId: z.string().min(1),
  phone: z.string().min(1),
});
export type WhatsAppReceiptLinkQueryDto = z.infer<
  typeof WhatsAppReceiptLinkQuerySchema
>;

export type WhatsAppReceiptLinkResponse = {
  url: string;
};
