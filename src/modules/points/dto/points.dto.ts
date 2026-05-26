import { z } from "zod";

export const PointHistoryTypeSchema = z.enum([
  "EARN",
  "REDEEM",
  "EXPIRED",
  "ADJUST",
]);
export type PointHistoryTypeDto = z.infer<typeof PointHistoryTypeSchema>;

export const ListPointHistoryQuerySchema = z.object({
  customerId: z.string().optional(),
  type: PointHistoryTypeSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListPointHistoryQueryDto = z.infer<
  typeof ListPointHistoryQuerySchema
>;

export const EarnPointsSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive(),
  reference: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type EarnPointsDto = z.infer<typeof EarnPointsSchema>;

export const RedeemPointsSchema = z.object({
  customerId: z.string().min(1),
  points: z.number().int().positive(),
  reference: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
export type RedeemPointsDto = z.infer<typeof RedeemPointsSchema>;

export const AdjustPointsSchema = z.object({
  customerId: z.string().min(1),
  delta: z.number().int(),
  description: z.string().min(1),
});
export type AdjustPointsDto = z.infer<typeof AdjustPointsSchema>;

export type CustomerPointsResponse = {
  customerId: string;
  currentPoints: number;
  totalEarned: number;
  totalRedeemed: number;
};

export type PointHistoryResponse = {
  id: string;
  customerId: string;
  points: number;
  type: string;
  reference: string | null;
  description: string | null;
  createdAt: string;
};

export type PointHistoryListResponse = {
  histories: PointHistoryResponse[];
  total: number;
  totalPages: number;
};

export type EarnResultResponse = {
  earned: number;
};

export type RedeemResultResponse = {
  valueIDR: number;
};
