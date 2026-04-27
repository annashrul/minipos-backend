import { z } from "zod";

export const OrderQueueStatusSchema = z.enum([
  "NEW",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
]);
export type OrderQueueStatusDto = z.infer<typeof OrderQueueStatusSchema>;

export const OrderQueueItemStatusSchema = z.enum([
  "PENDING",
  "PREPARING",
  "DONE",
]);
export type OrderQueueItemStatusDto = z.infer<typeof OrderQueueItemStatusSchema>;

export const ListOrderQueuesQuerySchema = z.object({
  branchId: z.string().optional(),
  status: OrderQueueStatusSchema.optional(),
  tableId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListOrderQueuesQueryDto = z.infer<typeof ListOrderQueuesQuerySchema>;

export const CreateOrderQueueItemSchema = z.object({
  productName: z.string().min(1),
  quantity: z.number().int().min(1),
  notes: z.string().nullable().optional(),
});
export type CreateOrderQueueItemDto = z.infer<typeof CreateOrderQueueItemSchema>;

export const CreateOrderQueueSchema = z.object({
  transactionId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  tableId: z.string().nullable().optional(),
  priority: z.number().int().optional().default(0),
  notes: z.string().nullable().optional(),
  items: z.array(CreateOrderQueueItemSchema).min(1),
});
export type CreateOrderQueueDto = z.infer<typeof CreateOrderQueueSchema>;

export const UpdateOrderQueueStatusSchema = z.object({
  status: OrderQueueStatusSchema,
});
export type UpdateOrderQueueStatusDto = z.infer<
  typeof UpdateOrderQueueStatusSchema
>;

export const UpdateOrderQueueItemStatusSchema = z.object({
  status: OrderQueueItemStatusSchema,
});
export type UpdateOrderQueueItemStatusDto = z.infer<
  typeof UpdateOrderQueueItemStatusSchema
>;

export type OrderQueueItemResponse = {
  id: string;
  productName: string;
  quantity: number;
  notes: string | null;
  status: string;
};

export type OrderQueueResponse = {
  id: string;
  queueNumber: number;
  transactionId: string | null;
  transaction: { id: string; invoiceNumber: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  tableId: string | null;
  table: { id: string; number: number; name: string | null } | null;
  status: string;
  priority: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  servedAt: string | null;
  items: OrderQueueItemResponse[];
};

export type OrderQueueListResponse = {
  orders: OrderQueueResponse[];
  total: number;
  totalPages: number;
};

export const CreateOrderQueueFromTransactionSchema = z.object({
  transactionId: z.string().min(1),
  priority: z.number().int().optional().default(0),
  notes: z.string().nullable().optional(),
  tableId: z.string().nullable().optional(),
});
export type CreateOrderQueueFromTransactionDto = z.infer<
  typeof CreateOrderQueueFromTransactionSchema
>;
