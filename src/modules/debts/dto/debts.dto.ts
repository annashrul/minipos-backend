import { z } from "zod";

export const DebtTypeSchema = z.enum(["PAYABLE", "RECEIVABLE"]);
export type DebtTypeDto = z.infer<typeof DebtTypeSchema>;

export const DebtStatusSchema = z.enum([
  "UNPAID",
  "PARTIAL",
  "PAID",
  "OVERDUE",
]);
export type DebtStatusDto = z.infer<typeof DebtStatusSchema>;

export const DebtPartyTypeSchema = z.enum(["CUSTOMER", "SUPPLIER", "OTHER"]);
export type DebtPartyTypeDto = z.infer<typeof DebtPartyTypeSchema>;

export const InstallmentIntervalSchema = z.enum(["WEEKLY", "MONTHLY"]);
export type InstallmentIntervalDto = z.infer<typeof InstallmentIntervalSchema>;

export const InstallmentConfigSchema = z.object({
  downPayment: z.number().nonnegative().optional().default(0),
  installmentCount: z.number().int().min(1),
  interval: InstallmentIntervalSchema,
});
export type InstallmentConfigDto = z.infer<typeof InstallmentConfigSchema>;

export const ListDebtsQuerySchema = z.object({
  type: DebtTypeSchema.optional(),
  status: DebtStatusSchema.optional(),
  partyType: DebtPartyTypeSchema.optional(),
  partyId: z.string().optional(),
  branchId: z.string().optional(),
  overdue: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => (typeof v === "boolean" ? v : v === "true"))
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListDebtsQueryDto = z.infer<typeof ListDebtsQuerySchema>;

export const CreateDebtSchema = z.object({
  type: DebtTypeSchema,
  referenceType: z.string().nullable().optional(),
  referenceId: z.string().nullable().optional(),
  partyType: DebtPartyTypeSchema,
  partyId: z.string().nullable().optional(),
  partyName: z.string().min(1),
  description: z.string().nullable().optional(),
  totalAmount: z.number().positive(),
  dueDate: z.string().datetime().nullable().optional(),
  branchId: z.string().nullable().optional(),
  installment: InstallmentConfigSchema.nullable().optional(),
});
export type CreateDebtDto = z.infer<typeof CreateDebtSchema>;

export const PayDebtSchema = z.object({
  amount: z.number().positive(),
  method: z.string().optional().default("CASH"),
  notes: z.string().nullable().optional(),
  paidAt: z.string().datetime().optional(),
});
export type PayDebtDto = z.infer<typeof PayDebtSchema>;

export type InstallmentResponse = {
  id: string;
  debtId: string;
  installmentNo: number;
  amount: number;
  dueDate: string;
  paidAmount: number;
  paidAt: string | null;
  status: string;
  notes: string | null;
};

export type DebtPaymentResponse = {
  id: string;
  debtId: string;
  amount: number;
  method: string;
  notes: string | null;
  paidBy: string;
  paidAt: string;
};

export type DebtResponse = {
  id: string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  partyType: string;
  partyId: string | null;
  partyName: string;
  description: string | null;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  dueDate: string | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  downPayment: number | null;
  installmentCount: number | null;
  installmentInterval: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type DebtDetailResponse = DebtResponse & {
  payments: DebtPaymentResponse[];
  installments: InstallmentResponse[];
};

export type DebtListResponse = {
  debts: DebtResponse[];
  total: number;
  totalPages: number;
};

export type DebtSummaryResponse = {
  payable: { total: number; remaining: number; count: number };
  receivable: { total: number; remaining: number; count: number };
  overdue: { count: number; remaining: number };
  byStatus: { total: number; unpaid: number; partial: number; paid: number; overdue: number };
};
