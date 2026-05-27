import { z } from "zod";

export const ListPlatformActivityLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().optional(),
  action: z.string().optional(),
  entity: z.string().optional(),
});
export type ListPlatformActivityLogsQueryDto = z.infer<
  typeof ListPlatformActivityLogsQuerySchema
>;

export type PlatformActivityLogResponse = {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: string | null;
  userName: string;
  userEmail: string;
  userRole: string;
  companyName: string;
  createdAt: string;
};

// PlatformActivityLogListResponse removed — use PaginatedResponse<PlatformActivityLogResponse> instead

export type PlatformNotificationItem = {
  id: string;
  action: string;
  entity: string;
  details: string | null;
  userName: string;
  companyName: string;
  createdAt: string;
};

export type PlatformNotificationListResponse = {
  notifications: PlatformNotificationItem[];
  unreadCount: number;
};
