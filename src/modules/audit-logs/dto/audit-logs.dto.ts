import { z } from "zod";

// =====================
// AuditLog
// =====================

export const ListAuditLogsQuerySchema = z.object({
  search: z.string().optional(),
  userId: z.string().optional(),
  branchId: z.string().optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListAuditLogsQueryDto = z.infer<typeof ListAuditLogsQuerySchema>;

export const AuditSummaryQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  branchId: z.string().optional(),
});
export type AuditSummaryQueryDto = z.infer<typeof AuditSummaryQuerySchema>;

export type AuditLogResponse = {
  id: string;
  userId: string;
  user: { id: string; name: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type AuditLogListResponse = {
  logs: AuditLogResponse[];
  total: number;
  totalPages: number;
};

export type AuditLogSummaryResponse = {
  total: number;
  byAction: Array<{ action: string; count: number }>;
  byEntity: Array<{ entity: string; count: number }>;
  byUser: Array<{ userId: string; userName: string; count: number }>;
};

// =====================
// ActivityLog
// =====================

export const ListActivityLogsQuerySchema = z.object({
  search: z.string().optional(),
  userId: z.string().optional(),
  action: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListActivityLogsQueryDto = z.infer<
  typeof ListActivityLogsQuerySchema
>;

export const CreateActivityLogSchema = z.object({
  action: z.string().min(1),
  description: z.string().optional(),
  metadata: z.unknown().optional(),
});
export type CreateActivityLogDto = z.infer<typeof CreateActivityLogSchema>;

export type ActivityLogResponse = {
  id: string;
  userId: string;
  user: { id: string; name: string } | null;
  action: string;
  description: string | null;
  metadata: unknown;
  createdAt: string;
};

export type ActivityLogListResponse = {
  logs: ActivityLogResponse[];
  total: number;
  totalPages: number;
};
