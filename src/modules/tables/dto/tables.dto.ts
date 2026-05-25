import { z } from "zod";

export const TableStatusSchema = z.enum([
  "AVAILABLE",
  "OCCUPIED",
  "RESERVED",
  "CLEANING",
]);
export type TableStatusDto = z.infer<typeof TableStatusSchema>;

export const ListTablesQuerySchema = z.object({
  branchId: z.string().optional(),
  status: TableStatusSchema.optional(),
  section: z.string().optional(),
  isActive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(100),
});
export type ListTablesQueryDto = z.infer<typeof ListTablesQuerySchema>;

export const TableSummaryQuerySchema = z.object({
  branchId: z.string().optional(),
});
export type TableSummaryQueryDto = z.infer<typeof TableSummaryQuerySchema>;

export const CreateTableSchema = z.object({
  number: z.number().int().min(1),
  name: z.string().nullable().optional(),
  capacity: z.number().int().min(1).optional().default(4),
  branchId: z.string().nullable().optional(),
  section: z.string().nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});
export type CreateTableDto = z.infer<typeof CreateTableSchema>;

export const UpdateTableSchema = CreateTableSchema.partial();
export type UpdateTableDto = z.infer<typeof UpdateTableSchema>;

export const UpdateTableStatusSchema = z.object({
  status: TableStatusSchema,
});
export type UpdateTableStatusDto = z.infer<typeof UpdateTableStatusSchema>;

export type TableResponse = {
  id: string;
  number: number;
  name: string | null;
  capacity: number;
  status: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  section: string | null;
  sortOrder: number;
  isActive: boolean;
  qrToken: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TableListResponse = {
  tables: TableResponse[];
  total: number;
  totalPages: number;
};
