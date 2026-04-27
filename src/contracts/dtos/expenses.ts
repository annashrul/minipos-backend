import { z } from "zod";

export const ListExpensesQuerySchema = z.object({
  search: z.string().optional(),
  category: z.string().optional(),
  branchId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListExpensesQueryDto = z.infer<typeof ListExpensesQuerySchema>;

export const CreateExpenseSchema = z.object({
  category: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  date: z.string().datetime().optional(),
  branchId: z.string().nullable().optional(),
});
export type CreateExpenseDto = z.infer<typeof CreateExpenseSchema>;

export const UpdateExpenseSchema = CreateExpenseSchema.partial();
export type UpdateExpenseDto = z.infer<typeof UpdateExpenseSchema>;

export type ExpenseResponse = {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExpenseListResponse = {
  expenses: ExpenseResponse[];
  total: number;
  totalPages: number;
};

export type ExpenseSummaryResponse = {
  total: number;
  count: number;
  byCategory: Array<{ category: string; total: number; count: number }>;
};
