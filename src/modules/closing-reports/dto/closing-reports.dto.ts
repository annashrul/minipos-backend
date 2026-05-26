import { z } from "zod";

export const ListClosingReportsQuerySchema = z.object({
  search: z.string().optional(),
  branchId: z.string().optional(),
  cashierUserId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListClosingReportsQueryDto = z.infer<
  typeof ListClosingReportsQuerySchema
>;

export const UpdateClosingReportSchema = z.object({
  notes: z.string().nullable().optional(),
});
export type UpdateClosingReportDto = z.infer<typeof UpdateClosingReportSchema>;

export const RecloseShiftSchema = z.object({
  closingCash: z.number().nonnegative(),
  notes: z.string().nullable().optional(),
});
export type RecloseShiftDto = z.infer<typeof RecloseShiftSchema>;

export type PaymentSummaryEntry = {
  method: string;
  count: number;
  total: number;
};

export type ClosingReportResponse = {
  id: string;
  shiftId: string;
  cashierUserId: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  companyId: string | null;
  cashierName: string;
  date: string;
  openedAt: string | null;
  closedAt: string | null;
  openingCash: number;
  closingCash: number;
  expectedCash: number;
  cashDifference: number;
  totalTransactions: number;
  totalSales: number;
  totalDiscount: number;
  totalTax: number;
  totalCashSales: number;
  totalNonCashSales: number;
  cashMovementIn: number;
  cashMovementOut: number;
  voidCount: number;
  refundCount: number;
  paymentSummary: PaymentSummaryEntry[] | null;
  notes: string | null;
  allowReopen: boolean;
  createdAt: string;
};

export type ClosingReportListResponse = {
  items: ClosingReportResponse[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    count: number;
  };
};
