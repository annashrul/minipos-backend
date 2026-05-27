import { z } from "zod";

export const SubscriptionPlanSchema = z.enum(["FREE", "PRO", "ENTERPRISE"]);
export type SubscriptionPlanDto = z.infer<typeof SubscriptionPlanSchema>;

export const SubscriptionStatusSchema = z.enum([
  "PENDING",
  "PAID",
  "CANCELLED",
  "REFUNDED",
]);
export type SubscriptionStatusDto = z.infer<typeof SubscriptionStatusSchema>;

export const SubscriptionBillingTypeSchema = z.enum(["MONTHLY", "YEARLY"]);
export type SubscriptionBillingTypeDto = z.infer<
  typeof SubscriptionBillingTypeSchema
>;

export const ListSubscriptionsQuerySchema = z.object({
  status: SubscriptionStatusSchema.optional(),
  plan: SubscriptionPlanSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListSubscriptionsQueryDto = z.infer<
  typeof ListSubscriptionsQuerySchema
>;

export const CreateSubscriptionSchema = z.object({
  plan: z.enum(["PRO", "ENTERPRISE"]),
  amount: z.number().nonnegative(),
  durationMonths: z.number().int().positive(),
  billingType: SubscriptionBillingTypeSchema.optional().default("MONTHLY"),
  planStartDate: z.string().datetime(),
  planEndDate: z.string().datetime(),
  notes: z.string().nullable().optional(),
});
export type CreateSubscriptionDto = z.infer<typeof CreateSubscriptionSchema>;

export const MarkSubscriptionPaidSchema = z.object({
  paidAt: z.string().datetime().optional(),
  notes: z.string().nullable().optional(),
});
export type MarkSubscriptionPaidDto = z.infer<
  typeof MarkSubscriptionPaidSchema
>;

export type SubscriptionResponse = {
  id: string;
  companyId: string;
  plan: string;
  amount: number;
  durationMonths: number;
  billingType: string;
  status: string;
  planStartDate: string;
  planEndDate: string;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
};

// Replaced by PaginatedResponse<SubscriptionResponse> from @/common/types/response

export type CurrentSubscriptionResponse = {
  plan: string;
  planExpiresAt: string | null;
  isActive: boolean;
  subscription: SubscriptionResponse | null;
};
