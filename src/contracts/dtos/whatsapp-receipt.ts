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

export const WhatsAppBaileysConnectBodySchema = z
  .object({
    forceReconnect: z.boolean().optional(),
  })
  .default({});
export type WhatsAppBaileysConnectBodyDto = z.infer<
  typeof WhatsAppBaileysConnectBodySchema
>;

export const WhatsAppBaileysSendTextBodySchema = z.object({
  phone: z.string().min(1),
  message: z.string().min(1),
});
export type WhatsAppBaileysSendTextBodyDto = z.infer<
  typeof WhatsAppBaileysSendTextBodySchema
>;

export const WhatsAppBaileysSendReceiptBodySchema = z.object({
  transactionId: z.string().min(1),
  phone: z.string().min(1),
});
export type WhatsAppBaileysSendReceiptBodyDto = z.infer<
  typeof WhatsAppBaileysSendReceiptBodySchema
>;

export type WhatsAppBaileysSessionResponse = {
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED";
  phoneNumber: string | null;
  deviceName: string | null;
  qrCode: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
};

export type WhatsAppBaileysSendResponse = {
  success: true;
  messageId?: string;
};
