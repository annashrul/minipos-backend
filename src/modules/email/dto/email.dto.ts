import { z } from "zod";

export const TestEmailSchema = z.object({
  to: z.string().email("Alamat email tujuan tidak valid"),
  subject: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(5000).optional(),
});
export type TestEmailDto = z.infer<typeof TestEmailSchema>;

const ReceiptItemSchema = z.object({
  name: z.string().min(1),
  qty: z.number(),
  price: z.number(),
  subtotal: z.number(),
});

/** Data struk terstruktur untuk dikirim via email (HTML dibangun di server). */
export const EmailReceiptSchema = z.object({
  to: z.string().email("Alamat email tujuan tidak valid"),
  invoiceNumber: z.string().min(1),
  date: z.string().min(1),
  cashier: z.string().optional(),
  customer: z.string().optional(),
  items: z.array(ReceiptItemSchema).min(1),
  subtotal: z.number(),
  discount: z.number().default(0),
  tax: z.number().default(0),
  grandTotal: z.number(),
  paymentMethod: z.string().optional(),
  paymentAmount: z.number().optional(),
  change: z.number().optional(),
  storeName: z.string().optional(),
  storeAddress: z.string().optional(),
  storePhone: z.string().optional(),
  footerText: z.string().optional(),
  thankYouMessage: z.string().optional(),
});
export type EmailReceiptDto = z.infer<typeof EmailReceiptSchema>;

/** Kirim struk transaksi yang sudah tersimpan (by id) ke email. */
export const EmailTransactionReceiptSchema = z.object({
  to: z.string().email("Alamat email tujuan tidak valid"),
});
export type EmailTransactionReceiptDto = z.infer<
  typeof EmailTransactionReceiptSchema
>;
