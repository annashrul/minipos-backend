import { z } from "zod";

const VEHICLE_TYPES = ["MOTOR", "MOBIL"] as const;

export const CreateVehicleSchema = z.object({
  customerId: z.string().min(1, "Customer wajib dipilih"),
  plateNumber: z.string().min(1, "Plat nomor wajib diisi"),
  type: z.enum(VEHICLE_TYPES).default("MOTOR"),
  brandId: z.string().nullable().optional(),
  modelId: z.string().nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  color: z.string().nullable().optional(),
  vin: z.string().nullable().optional(),
  engineNumber: z.string().nullable().optional(),
  engineCapacity: z.string().nullable().optional(),
  transmission: z.string().nullable().optional(),
  fuelType: z.string().nullable().optional(),
  mileage: z.number().int().min(0).nullable().optional(),
  photoUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateVehicleDto = z.infer<typeof CreateVehicleSchema>;

export const UpdateVehicleSchema = CreateVehicleSchema.partial().extend({
  isActive: z.boolean().optional(),
  lastServicedAt: z.string().datetime().nullable().optional(),
  nextServiceKm: z.number().int().min(0).nullable().optional(),
  nextServiceDate: z.string().datetime().nullable().optional(),
});
export type UpdateVehicleDto = z.infer<typeof UpdateVehicleSchema>;

export const ListVehiclesQuerySchema = z.object({
  search: z.string().optional(),
  customerId: z.string().optional(),
  type: z.enum(VEHICLE_TYPES).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListVehiclesQueryDto = z.infer<typeof ListVehiclesQuerySchema>;

export type VehicleResponse = {
  id: string;
  customerId: string;
  customer: { id: string; name: string; phone: string | null } | null;
  plateNumber: string;
  type: string;
  brandId: string | null;
  brand: { id: string; name: string } | null;
  modelId: string | null;
  model: { id: string; name: string } | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  engineNumber: string | null;
  engineCapacity: string | null;
  transmission: string | null;
  fuelType: string | null;
  mileage: number | null;
  photoUrl: string | null;
  notes: string | null;
  isActive: boolean;
  lastServicedAt: string | null;
  nextServiceKm: number | null;
  nextServiceDate: string | null;
  serviceOrderCount: number;
  createdAt: string;
  updatedAt: string;
};

export type VehicleListResponse = {
  items: VehicleResponse[];
  total: number;
  page: number;
  limit: number;
};
