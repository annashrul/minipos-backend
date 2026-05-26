import { z } from "zod";

export const AutoJournalRefTypeSchema = z.enum([
  "TRANSACTION",
  "PURCHASE",
  "RETURN",
  "DEBT_PAYMENT",
  "EXPENSE",
]);
export type AutoJournalRefTypeDto = z.infer<typeof AutoJournalRefTypeSchema>;

export const CreateAutoJournalSchema = z.object({
  referenceType: AutoJournalRefTypeSchema,
  referenceId: z.string().min(1),
  branchId: z.string().nullable().optional(),
});
export type CreateAutoJournalDto = z.infer<typeof CreateAutoJournalSchema>;

export type AutoJournalResponse = {
  entryId: string;
  entryNumber: string;
  totalDebit: number;
  totalCredit: number;
};
