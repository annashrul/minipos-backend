import { z } from "zod";

export const ListModifierGroupsQuerySchema = z.object({
  search: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
  sortBy: z
    .enum(["name", "sortOrder", "createdAt"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListModifierGroupsQueryDto = z.infer<
  typeof ListModifierGroupsQuerySchema
>;

export const ModifierOptionInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  priceAdjustment: z.number().default(0),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
  // Conditional modifier: list parent option IDs yang men-trigger option ini
  // jadi visible di POS picker. Empty/undefined = tanpa constraint (selalu
  // visible). Parent harus dari group LAIN dalam product yang sama.
  enabledByOptionIds: z.array(z.string()).optional(),
});
export type ModifierOptionInputDto = z.infer<typeof ModifierOptionInputSchema>;

export const CreateModifierGroupSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().optional().default(false),
  minSelect: z.number().int().min(0).optional().default(0),
  maxSelect: z.number().int().min(1).optional().default(1),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
  options: z.array(ModifierOptionInputSchema).optional().default([]),
});
export type CreateModifierGroupDto = z.infer<typeof CreateModifierGroupSchema>;

export const UpdateModifierGroupSchema = CreateModifierGroupSchema.partial();
export type UpdateModifierGroupDto = z.infer<typeof UpdateModifierGroupSchema>;

export const AttachProductModifierSchema = z.object({
  productId: z.string().min(1),
  modifierGroupIds: z.array(z.string().min(1)),
});
export type AttachProductModifierDto = z.infer<
  typeof AttachProductModifierSchema
>;

export type ModifierOptionResponse = {
  id: string;
  name: string;
  priceAdjustment: number;
  isActive: boolean;
  sortOrder: number;
  /** Parent option IDs yang harus dipilih agar option ini visible di POS.
   *  Empty = tanpa constraint (selalu visible). */
  enabledByOptionIds: string[];
};

export type ModifierGroupResponse = {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  isActive: boolean;
  options: ModifierOptionResponse[];
  createdAt: string;
  updatedAt: string;
};

export type ModifierGroupListResponse = {
  groups: ModifierGroupResponse[];
  total: number;
  totalPages: number;
};
