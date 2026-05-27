import { z } from "zod";
import { InstallmentIntervalSchema } from "@/modules/debts/dto/debts.dto";

export const CreateInstallmentPlanSchema = z.object({
  debtId: z.string().min(1),
  downPayment: z.number().nonnegative().default(0),
  installmentCount: z.number().int().min(1).max(60),
  interval: InstallmentIntervalSchema,
});
export type CreateInstallmentPlanDto = z.infer<
  typeof CreateInstallmentPlanSchema
>;

export const PayInstallmentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().optional().default("CASH"),
  notes: z.string().nullable().optional(),
});
export type PayInstallmentDto = z.infer<typeof PayInstallmentSchema>;

export const UpcomingInstallmentsQuerySchema = z.object({
  daysAhead: z.coerce.number().int().min(0).max(365).default(7),
});
export type UpcomingInstallmentsQueryDto = z.infer<
  typeof UpcomingInstallmentsQuerySchema
>;

export const PreviewInstallmentScheduleSchema = z.object({
  totalAmount: z.number().positive(),
  downPayment: z.number().nonnegative().default(0),
  installmentCount: z.number().int().min(1).max(60),
  interval: InstallmentIntervalSchema,
});
export type PreviewInstallmentScheduleDto = z.infer<
  typeof PreviewInstallmentScheduleSchema
>;

export type InstallmentPaymentRecord = {
  id: string;
  amount: number;
  method: string;
  notes: string | null;
  paidAt: string;
};

export type InstallmentRecord = {
  id: string;
  debtId: string;
  installmentNo: number;
  amount: number;
  dueDate: string;
  paidAmount: number;
  paidAt: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InstallmentsByDebtResponse = {
  id: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  downPayment: number | null;
  installmentCount: number | null;
  installmentInterval: string | null;
  partyName: string;
  description: string | null;
  dueDate: string | null;
  installments: InstallmentRecord[];
  payments: InstallmentPaymentRecord[];
};

export type UpcomingInstallmentResponse = InstallmentRecord & {
  isOverdue: boolean;
  daysUntilDue: number;
  debt: {
    partyName: string;
    description: string | null;
    type: string;
    referenceType: string | null;
    referenceId: string | null;
  };
};

export type PreviewInstallmentEntry = {
  no: number;
  amount: number;
  dueDate: string;
};

export type UpdateOverdueInstallmentsResponse = {
  updated: number;
};
