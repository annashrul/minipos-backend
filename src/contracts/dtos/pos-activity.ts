import { z } from "zod";

/**
 * Lightweight audit log used by the POS cashier to record cashier actions
 * (HOLD, RESUME, REPRINT, REDEEM_POINTS, APPLY_VOUCHER, ...).
 * Backed by the existing `AuditLog` Prisma model — no new table required.
 */
export const LogPosActivitySchema = z.object({
  action: z.string().min(1),
  entity: z.string().min(1),
  entityId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  branchId: z.string().optional(),
});
export type LogPosActivityDto = z.infer<typeof LogPosActivitySchema>;

export type LogPosActivityResponse = {
  success: true;
};
