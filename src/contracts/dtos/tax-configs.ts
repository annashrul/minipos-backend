import { z } from "zod";

// =============================================
// Query / List
// =============================================

export const ListTaxConfigsQuerySchema = z.object({
  search: z.string().optional(),
  taxType: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListTaxConfigsQueryDto = z.infer<typeof ListTaxConfigsQuerySchema>;

// =============================================
// Create / Update
// =============================================

export const CreateTaxConfigSchema = z.object({
  taxType: z.string().min(1, "Tipe pajak wajib diisi"),
  name: z.string().min(1, "Nama pajak wajib diisi"),
  rate: z.coerce.number().min(0, "Rate tidak boleh negatif"),
  accountId: z.string().min(1, "Akun wajib diisi"),
  isActive: z.boolean().optional(),
});
export type CreateTaxConfigDto = z.infer<typeof CreateTaxConfigSchema>;

export const UpdateTaxConfigSchema = CreateTaxConfigSchema.partial();
export type UpdateTaxConfigDto = z.infer<typeof UpdateTaxConfigSchema>;

// =============================================
// Responses
// =============================================

export type TaxConfigResponse = {
  id: string;
  taxType: string;
  name: string;
  rate: number;
  accountId: string;
  account: {
    id: string;
    code: string;
    name: string;
  } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type TaxConfigListResponse = {
  taxConfigs: TaxConfigResponse[];
  total: number;
  totalPages: number;
};
