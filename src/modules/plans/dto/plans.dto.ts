import { z } from "zod";

export const PlanTierSchema = z.enum(["FREE", "PRO", "ENTERPRISE"]);
export type PlanTierDto = z.infer<typeof PlanTierSchema>;

export const ListPlanAccessQuerySchema = z.object({
  plan: PlanTierSchema.optional(),
});
export type ListPlanAccessQueryDto = z.infer<typeof ListPlanAccessQuerySchema>;

export const SetPlanMenuAccessItemSchema = z.object({
  menuKey: z.string().min(1),
  allowed: z.boolean(),
});
export type SetPlanMenuAccessItemDto = z.infer<
  typeof SetPlanMenuAccessItemSchema
>;

export const SetPlanMenuAccessSchema = z.object({
  plan: PlanTierSchema,
  items: z.array(SetPlanMenuAccessItemSchema).default([]),
});
export type SetPlanMenuAccessDto = z.infer<typeof SetPlanMenuAccessSchema>;

export const SetPlanActionAccessItemSchema = z.object({
  menuKey: z.string().min(1),
  actionKey: z.string().min(1),
  allowed: z.boolean(),
});
export type SetPlanActionAccessItemDto = z.infer<
  typeof SetPlanActionAccessItemSchema
>;

export const SetPlanActionAccessSchema = z.object({
  plan: PlanTierSchema,
  items: z.array(SetPlanActionAccessItemSchema).default([]),
});
export type SetPlanActionAccessDto = z.infer<typeof SetPlanActionAccessSchema>;

export const UpdatePlanAccessSchema = z.object({
  allowed: z.boolean(),
});
export type UpdatePlanAccessDto = z.infer<typeof UpdatePlanAccessSchema>;

export const PlanCheckQuerySchema = z
  .object({
    plan: PlanTierSchema,
    menuKey: z.string().min(1).optional(),
    actionKey: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.menuKey || d.actionKey), {
    message: "menuKey or actionKey is required",
  });
export type PlanCheckQueryDto = z.infer<typeof PlanCheckQuerySchema>;

export type PlanMenuAccessResponse = {
  id: string;
  plan: string;
  menuKey: string;
  allowed: boolean;
};

export type PlanActionAccessResponse = {
  id: string;
  plan: string;
  menuKey: string;
  actionKey: string;
  allowed: boolean;
};

export type PlanMenuAccessListResponse = {
  items: PlanMenuAccessResponse[];
};

export type PlanActionAccessListResponse = {
  items: PlanActionAccessResponse[];
};

export type PlanCheckResponse = {
  allowed: boolean;
};

export type PlanComparisonMenuRow = {
  menuId: string;
  key: string;
  name: string;
  group: string;
  byPlan: {
    FREE: boolean;
    PRO: boolean;
    ENTERPRISE: boolean;
  };
};

export type PlanComparisonActionRow = {
  menuActionId: string;
  menuKey: string;
  actionKey: string;
  name: string;
  byPlan: {
    FREE: boolean;
    PRO: boolean;
    ENTERPRISE: boolean;
  };
};

export type PlanComparisonResponse = {
  menus: PlanComparisonMenuRow[];
  actions: PlanComparisonActionRow[];
};
