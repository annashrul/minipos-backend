import { z } from "zod";

export const CashMovementTypeSchema = z.enum(["CASH_IN", "CASH_OUT"]);
export type CashMovementTypeDto = z.infer<typeof CashMovementTypeSchema>;

export const ListShiftsQuerySchema = z.object({
  userId: z.string().optional(),
  branchId: z.string().optional(),
  isOpen: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z
    .enum([
      "user",
      "openedAt",
      "closedAt",
      "openingCash",
      "closingCash",
      "cashDifference",
    ])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListShiftsQueryDto = z.infer<typeof ListShiftsQuerySchema>;

export const OpenShiftSchema = z.object({
  branchId: z.string().nullable().optional(),
  openingCash: z.number().nonnegative(),
  notes: z.string().nullable().optional(),
});
export type OpenShiftDto = z.infer<typeof OpenShiftSchema>;

export const CloseShiftSchema = z.object({
  closingCash: z.number().nonnegative(),
  notes: z.string().nullable().optional(),
});
export type CloseShiftDto = z.infer<typeof CloseShiftSchema>;

export const CashMovementSchema = z.object({
  type: CashMovementTypeSchema,
  amount: z.number().positive(),
  reason: z.string().min(1),
  reference: z.string().nullable().optional(),
});
export type CashMovementDto = z.infer<typeof CashMovementSchema>;

export type CashMovementResponse = {
  id: string;
  shiftId: string;
  type: string;
  amount: number;
  reason: string;
  reference: string | null;
  createdAt: string;
};

export type ShiftResponse = {
  id: string;
  userId: string;
  user: { id: string; name: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCash: number | null;
  expectedCash: number | null;
  cashDifference: number | null;
  totalSales: number | null;
  totalTransactions: number | null;
  notes: string | null;
  isOpen: boolean;
};

export type ShiftDetailResponse = ShiftResponse & {
  cashMovements: CashMovementResponse[];
};

/**
 * Catatan kesesuaian buka kasir terhadap jadwal karyawan hari ini.
 * - on-time   : terjadwal & buka tepat/lebih awal dari jam mulai.
 * - late      : terjadwal tapi buka lewat dari jam mulai (lateMinutes > 0).
 * - unscheduled: tidak ada jadwal hari ini.
 * - off       : jadwal hari ini berstatus LEAVE/ABSENT (cuti/tidak masuk).
 */
export type ShiftScheduleNotice = {
  level: "on-time" | "late" | "unscheduled" | "off";
  scheduled: boolean;
  message: string;
  shiftLabel: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  lateMinutes: number;
};

export type OpenShiftResponse = ShiftResponse & {
  scheduleNotice: ShiftScheduleNotice | null;
};

export type ShiftListResponse = {
  shifts: ShiftResponse[];
  total: number;
  totalPages: number;
};
