import { z } from "zod";
import {
  SubscriptionBillingTypeSchema,
  SubscriptionPlanSchema,
  SubscriptionStatusSchema,
  type SubscriptionResponse,
} from "../../subscriptions/dto/subscriptions.dto";

export const ListPlatformSubscriptionsQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  status: SubscriptionStatusSchema.optional(),
  plan: SubscriptionPlanSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListPlatformSubscriptionsQueryDto = z.infer<
  typeof ListPlatformSubscriptionsQuerySchema
>;

export const CreatePlatformSubscriptionSchema = z.object({
  companyId: z.string().uuid(),
  plan: z.enum(["PRO", "ENTERPRISE"]),
  amount: z.number().nonnegative(),
  durationMonths: z.number().int().positive(),
  billingType: SubscriptionBillingTypeSchema.optional().default("MONTHLY"),
  planStartDate: z.string().datetime().optional(),
  planEndDate: z.string().datetime().optional(),
  notes: z.string().nullable().optional(),
  // when true, immediately mark paid + activate company plan
  markPaid: z.boolean().optional().default(false),
});
export type CreatePlatformSubscriptionDto = z.infer<
  typeof CreatePlatformSubscriptionSchema
>;

export const MarkPlatformSubscriptionPaidSchema = z.object({
  paidAt: z.string().datetime().optional(),
  notes: z.string().nullable().optional(),
});
export type MarkPlatformSubscriptionPaidDto = z.infer<
  typeof MarkPlatformSubscriptionPaidSchema
>;

export const ListPlatformCompaniesQuerySchema = z.object({
  search: z.string().optional(),
  plan: SubscriptionPlanSchema.optional(),
  isActive: z.coerce.boolean().optional(),
});
export type ListPlatformCompaniesQueryDto = z.infer<
  typeof ListPlatformCompaniesQuerySchema
>;

export type PlatformSubscriptionResponse = SubscriptionResponse & {
  companyName: string;
  companySlug: string;
};

export type PlatformSubscriptionListResponse = {
  subscriptions: PlatformSubscriptionResponse[];
  total: number;
  totalPages: number;
};

export type PlatformCompanyResponse = {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  plan: string;
  planExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
  counts: {
    users: number;
    branches: number;
    products: number;
  };
};

export type PlatformSubscriptionStatsResponse = {
  totalCompanies: number;
  activeCompanies: number;
  byPlan: {
    FREE: number;
    PRO: number;
    ENTERPRISE: number;
  };
  activeSubscriptions: number;
  pendingSubscriptions: number;
  expiringSoon: number; // expiring within 30 days
  // monthly recurring revenue (sum of currently active PAID subs normalised to monthly amount)
  mrr: number;
  // total revenue from all PAID subs (lifetime)
  totalRevenue: number;
};
