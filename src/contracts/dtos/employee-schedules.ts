import { z } from "zod";

// Schema actual (packages/db/prisma/schema.prisma:1438) memakai
// `date` (DateTime @db.Date) + `shiftStart` + `shiftEnd` + `shiftLabel`.
// Unique = [userId, date]. Tidak ada `companyId` — multi-tenancy lewat
// relasi user.companyId. Status: SCHEDULED|CONFIRMED|ABSENT|LEAVE
// (legacy) — DTO menerima superset {SCHEDULED|CONFIRMED|COMPLETED|MISSED|
// CANCELLED|ABSENT|LEAVE} agar kompatibel dgn data lama & request baru.

const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format harus HH:mm");

export const ShiftTypeSchema = z.enum([
  "MORNING",
  "AFTERNOON",
  "EVENING",
  "NIGHT",
  "FULL_DAY",
]);
export type ShiftTypeDto = z.infer<typeof ShiftTypeSchema>;

export const ScheduleStatusSchema = z.enum([
  "SCHEDULED",
  "CONFIRMED",
  "COMPLETED",
  "MISSED",
  "CANCELLED",
  "ABSENT",
  "LEAVE",
]);
export type ScheduleStatusDto = z.infer<typeof ScheduleStatusSchema>;

export const ListEmployeeSchedulesQuerySchema = z.object({
  search: z.string().optional(),
  userId: z.string().optional(),
  branchId: z.string().optional(),
  status: ScheduleStatusSchema.optional(),
  shiftType: ShiftTypeSchema.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type ListEmployeeSchedulesQueryDto = z.infer<
  typeof ListEmployeeSchedulesQuerySchema
>;

export const CreateEmployeeScheduleSchema = z.object({
  userId: z.string().min(1),
  branchId: z.string().nullable().optional(),
  // Akses lewat shiftDate (alias) atau date — keduanya diterima.
  shiftDate: z.string().optional(),
  date: z.string().optional(),
  startTime: TimeSchema.optional(),
  endTime: TimeSchema.optional(),
  shiftStart: TimeSchema.optional(),
  shiftEnd: TimeSchema.optional(),
  shiftType: ShiftTypeSchema.optional(),
  shiftLabel: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: ScheduleStatusSchema.optional(),
});
export type CreateEmployeeScheduleDto = z.infer<
  typeof CreateEmployeeScheduleSchema
>;

export const BulkCreateEmployeeSchedulesSchema = z.object({
  schedules: z.array(CreateEmployeeScheduleSchema).min(1),
});
export type BulkCreateEmployeeSchedulesDto = z.infer<
  typeof BulkCreateEmployeeSchedulesSchema
>;

export const UpdateEmployeeScheduleSchema = z.object({
  branchId: z.string().nullable().optional(),
  shiftDate: z.string().optional(),
  date: z.string().optional(),
  startTime: TimeSchema.optional(),
  endTime: TimeSchema.optional(),
  shiftStart: TimeSchema.optional(),
  shiftEnd: TimeSchema.optional(),
  shiftType: ShiftTypeSchema.optional(),
  shiftLabel: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: ScheduleStatusSchema.optional(),
});
export type UpdateEmployeeScheduleDto = z.infer<
  typeof UpdateEmployeeScheduleSchema
>;

export const UpdateScheduleStatusSchema = z.object({
  status: ScheduleStatusSchema,
});
export type UpdateScheduleStatusDto = z.infer<
  typeof UpdateScheduleStatusSchema
>;

export type EmployeeScheduleResponse = {
  id: string;
  userId: string;
  user: { id: string; name: string; email: string; role: string } | null;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  date: string; // ISO date "YYYY-MM-DD"
  shiftDate: string; // alias
  shiftStart: string; // "HH:mm"
  shiftEnd: string; // "HH:mm"
  startTime: string; // alias
  endTime: string; // alias
  shiftLabel: string | null;
  shiftType: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeScheduleListResponse = {
  schedules: EmployeeScheduleResponse[];
  total: number;
  totalPages: number;
};

export type BulkCreateEmployeeScheduleResponse = {
  created: number;
};
