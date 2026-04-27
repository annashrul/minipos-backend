import { z } from "zod";

export const ApprovalStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);
export type ApprovalStatusDto = z.infer<typeof ApprovalStatusSchema>;

export const ListApprovalsQuerySchema = z.object({
  type: z.string().min(1).optional(),
  status: ApprovalStatusSchema.optional(),
  referenceType: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  requestedBy: z.string().min(1).optional(),
  search: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListApprovalsQueryDto = z.infer<typeof ListApprovalsQuerySchema>;

export const CreateApprovalSchema = z.object({
  type: z.string().min(1),
  referenceType: z.string().min(1).nullable().optional(),
  referenceId: z.string().min(1).nullable().optional(),
  requestedReason: z.string().min(1),
  amount: z.number().nullable().optional(),
  branchId: z.string().min(1).nullable().optional(),
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).nullable().optional(),
  details: z.string().nullable().optional(),
});
export type CreateApprovalDto = z.infer<typeof CreateApprovalSchema>;

export const ReviewApprovalSchema = z.object({
  reviewNotes: z.string().nullable().optional(),
});
export type ReviewApprovalDto = z.infer<typeof ReviewApprovalSchema>;

export const RejectApprovalSchema = z.object({
  reviewNotes: z.string().min(1),
});
export type RejectApprovalDto = z.infer<typeof RejectApprovalSchema>;

export type ApprovalUserSummary = {
  id: string;
  name: string;
  email: string | null;
};

export type ApprovalBranchSummary = {
  id: string;
  name: string;
};

export type ApprovalResponse = {
  id: string;
  type: string;
  referenceType: string | null;
  referenceId: string | null;
  requestedReason: string;
  amount: number | null;
  status: string;
  requestedBy: string;
  requester: ApprovalUserSummary | null;
  reviewedBy: string | null;
  reviewer: ApprovalUserSummary | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  branchId: string | null;
  branch: ApprovalBranchSummary | null;
  companyId: string | null;
  expiresAt: string | null;
  details: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApprovalListResponse = {
  approvals: ApprovalResponse[];
  total: number;
  totalPages: number;
};

export type ApprovalPendingCountResponse = {
  count: number;
};
