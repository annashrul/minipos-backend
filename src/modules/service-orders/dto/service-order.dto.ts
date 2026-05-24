import { z } from "zod";

export const SERVICE_ORDER_STATUSES = [
  "ANTRIAN",
  "DIAGNOSA",
  "MENUNGGU_APPROVAL",
  "DIKERJAKAN",
  "SELESAI",
  "DIBAYAR",
  "DIBATALKAN",
] as const;
export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number];

export const ServiceOrderItemInputSchema = z.object({
  productId: z.string().nullable().optional(),
  itemType: z.enum(["PRODUCT", "SERVICE"]).default("SERVICE"),
  name: z.string().min(1),
  quantity: z.number().positive().default(1),
  unitPrice: z.number().min(0),
  discount: z.number().min(0).default(0),
  mechanicId: z.string().nullable().optional(),
  commissionPct: z.number().min(0).max(100).default(0),
  notes: z.string().nullable().optional(),
});
export type ServiceOrderItemInputDto = z.infer<typeof ServiceOrderItemInputSchema>;

export const CreateServiceOrderSchema = z.object({
  vehicleId: z.string().min(1, "Kendaraan wajib dipilih"),
  customerId: z.string().min(1, "Customer wajib dipilih"),
  branchId: z.string().min(1, "Branch wajib dipilih"),
  mechanicId: z.string().nullable().optional(),
  complaint: z.string().nullable().optional(),
  diagnose: z.string().nullable().optional(),
  estimateAmount: z.number().min(0).nullable().optional(),
  mileageIn: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  items: z.array(ServiceOrderItemInputSchema).default([]),
});
export type CreateServiceOrderDto = z.infer<typeof CreateServiceOrderSchema>;

export const UpdateServiceOrderSchema = CreateServiceOrderSchema.partial().extend({
  status: z.enum(SERVICE_ORDER_STATUSES).optional(),
  cancelReason: z.string().nullable().optional(),
  mileageOut: z.number().int().min(0).nullable().optional(),
});
export type UpdateServiceOrderDto = z.infer<typeof UpdateServiceOrderSchema>;

export const ListServiceOrdersQuerySchema = z.object({
  search: z.string().optional(),
  status: z.enum(SERVICE_ORDER_STATUSES).optional(),
  branchId: z.string().optional(),
  vehicleId: z.string().optional(),
  customerId: z.string().optional(),
  mechanicId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListServiceOrdersQueryDto = z.infer<
  typeof ListServiceOrdersQuerySchema
>;

export const TransitionStatusSchema = z.object({
  status: z.enum(SERVICE_ORDER_STATUSES),
  cancelReason: z.string().nullable().optional(),
  mileageOut: z.number().int().min(0).nullable().optional(),
});
export type TransitionStatusDto = z.infer<typeof TransitionStatusSchema>;

export const FinalizeServiceOrderSchema = z.object({
  paymentMethod: z.enum([
    "CASH",
    "TRANSFER",
    "QRIS",
    "EWALLET",
    "DEBIT",
    "CREDIT_CARD",
  ]).default("CASH"),
  paymentAmount: z.number().min(0).optional(),
});
export type FinalizeServiceOrderDto = z.infer<typeof FinalizeServiceOrderSchema>;

export type ServiceOrderItemResponse = {
  id: string;
  productId: string | null;
  itemType: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
  mechanicId: string | null;
  mechanic: { id: string; name: string } | null;
  commissionPct: number;
  commissionAmount: number;
  notes: string | null;
};

export type ServiceOrderResponse = {
  id: string;
  orderNumber: string;
  status: ServiceOrderStatus;
  branchId: string;
  branch: { id: string; name: string } | null;
  vehicleId: string;
  vehicle: {
    id: string;
    plateNumber: string;
    type: string;
    brand: string | null;
    model: string | null;
  } | null;
  customerId: string;
  customer: { id: string; name: string; phone: string | null } | null;
  mechanicId: string | null;
  mechanic: { id: string; name: string } | null;
  complaint: string | null;
  diagnose: string | null;
  estimateAmount: number | null;
  finalAmount: number | null;
  mileageIn: number | null;
  mileageOut: number | null;
  approvedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  notes: string | null;
  transactionId: string | null;
  items: ServiceOrderItemResponse[];
  createdAt: string;
  updatedAt: string;
};

export type ServiceOrderListResponse = {
  items: ServiceOrderResponse[];
  total: number;
  page: number;
  limit: number;
};
