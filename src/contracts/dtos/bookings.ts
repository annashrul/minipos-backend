import { z } from "zod";

export const BOOKING_TYPES = ["BENGKEL", "RESTAURANT", "CAFE"] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export const BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

const BookingBaseSchema = z.object({
  branchId: z.string().min(1, "Branch wajib dipilih"),
  bookingType: z.enum(BOOKING_TYPES),
  scheduledAt: z.string().datetime({ offset: true }),
  durationMin: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  customerPhone: z.string().nullable().optional(),
  // Bengkel
  vehicleId: z.string().nullable().optional(),
  serviceType: z.string().nullable().optional(),
  mechanicId: z.string().nullable().optional(),
  // Resto/Cafe
  partySize: z.number().int().positive().nullable().optional(),
  tableId: z.string().nullable().optional(),
});

export const CreateBookingSchema = BookingBaseSchema.refine(
  (v) =>
    v.bookingType !== "BENGKEL" ||
    Boolean(v.vehicleId) ||
    Boolean(v.serviceType),
  { message: "Bengkel: minimal pilih kendaraan atau jenis service" },
)
  .refine(
    (v) => v.bookingType === "BENGKEL" || Boolean(v.partySize),
    { message: "Resto/Cafe: jumlah orang wajib diisi" },
  )
  .refine(
    (v) => Boolean(v.customerId) || Boolean(v.customerName?.trim()),
    { message: "Pilih customer atau isi nama tamu" },
  );
export type CreateBookingDto = z.infer<typeof CreateBookingSchema>;

export const UpdateBookingSchema = BookingBaseSchema.partial().extend({
  cancelReason: z.string().nullable().optional(),
});
export type UpdateBookingDto = z.infer<typeof UpdateBookingSchema>;

export const TransitionBookingStatusSchema = z.object({
  status: z.enum(BOOKING_STATUSES),
  cancelReason: z.string().nullable().optional(),
});
export type TransitionBookingStatusDto = z.infer<typeof TransitionBookingStatusSchema>;

export const ListBookingsQuerySchema = z.object({
  search: z.string().optional(),
  branchId: z.string().optional(),
  bookingType: z.enum(BOOKING_TYPES).optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListBookingsQueryDto = z.infer<typeof ListBookingsQuerySchema>;

export type BookingResponse = {
  id: string;
  branchId: string;
  branch: { id: string; name: string } | null;
  bookingType: BookingType;
  status: BookingStatus;
  scheduledAt: string;
  durationMin: number | null;
  notes: string | null;
  customerId: string | null;
  customer: { id: string; name: string; phone: string | null } | null;
  customerName: string | null;
  customerPhone: string | null;
  vehicleId: string | null;
  vehicle: {
    id: string;
    plateNumber: string;
    brand: string | null;
    model: string | null;
  } | null;
  serviceType: string | null;
  mechanicId: string | null;
  mechanic: { id: string; name: string } | null;
  partySize: number | null;
  tableId: string | null;
  table: { id: string; number: number; name: string | null } | null;
  reminderSentAt: string | null;
  serviceOrderId: string | null;
  cancelReason: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookingListResponse = {
  items: BookingResponse[];
  total: number;
  page: number;
  limit: number;
};
