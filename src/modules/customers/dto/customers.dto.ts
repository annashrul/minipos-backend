import { z } from "zod";

export const MemberLevelSchema = z.enum([
  "REGULAR",
  "SILVER",
  "GOLD",
  "PLATINUM",
]);
export type MemberLevelDto = z.infer<typeof MemberLevelSchema>;

export const ListCustomersQuerySchema = z.object({
  search: z.string().optional(),
  memberLevel: MemberLevelSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  sortBy: z
    .enum([
      "name",
      "phone",
      "email",
      "memberLevel",
      "totalSpending",
      "points",
      "createdAt",
    ])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type ListCustomersQueryDto = z.infer<typeof ListCustomersQuerySchema>;

export const CreateCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  address: z.string().nullable().optional(),
  memberLevel: MemberLevelSchema.optional().default("REGULAR"),
  memberCardCode: z.string().nullable().optional(),
  dateOfBirth: z.string().datetime().nullable().optional(),
  creditLimit: z.number().nonnegative().optional().default(0),
  creditTermDays: z.number().int().min(0).optional().default(30),
});
export type CreateCustomerDto = z.infer<typeof CreateCustomerSchema>;

export const UpdateCustomerSchema = CreateCustomerSchema.partial();
export type UpdateCustomerDto = z.infer<typeof UpdateCustomerSchema>;

export type CustomerResponse = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  memberLevel: string;
  totalSpending: number;
  points: number;
  memberCardCode: string | null;
  dateOfBirth: string | null;
  creditLimit: number;
  creditTermDays: number;
  createdAt: string;
  updatedAt: string;
};

export type CustomerCreditStatusResponse = {
  customerId: string;
  creditLimit: number;
  /** Total sisa piutang (RECEIVABLE) yang belum lunas untuk customer ini. */
  outstanding: number;
  /** Sisa limit yang masih bisa dipakai = creditLimit - outstanding. */
  available: number;
  /** True jika creditLimit > 0 (batas kredit aktif). 0 = tanpa batas. */
  hasLimit: boolean;
};

export type CustomerListResponse = {
  customers: CustomerResponse[];
  total: number;
  totalPages: number;
};
