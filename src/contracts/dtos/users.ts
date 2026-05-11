import { z } from "zod";

export const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  // Password otorisasi untuk aksi sensitif (void, refund, hapus transaksi).
  // Berbeda dari `password` login. Optional di create — bisa diset belakangan
  // via profile/edit. Min 4 digit (boleh PIN angka pendek supaya mudah ingat).
  authorizationPassword: z.string().min(4).optional().nullable(),
  role: z.string().min(1),
  // Legacy single-branch (primary). Backward-compat. Auto-set ke branchIds[0]
  // kalau branchIds dikirim & branchId tidak.
  branchId: z.string().nullable().optional(),
  // Multi-branch: 1 user bisa di-assign ke beberapa cabang. Kosong = global
  // (akses semua cabang). branchIds[0] otomatis jadi primary branchId.
  branchIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional().default(true),
  isMechanic: z.boolean().optional().default(false),
});
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  // Set null untuk clear password otorisasi (akan disable gate untuk user ini).
  authorizationPassword: z.string().min(4).optional().nullable(),
  role: z.string().min(1).optional(),
  branchId: z.string().nullable().optional(),
  // Kalau dikirim, backend replace daftar branch assignment (deleteMany +
  // createMany). Empty array = unassign semua = akses global semua cabang.
  branchIds: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  isMechanic: z.boolean().optional(),
});
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

// Verify password otorisasi. Backend return ok=true kalau cocok, ok=false
// kalau salah. Frontend pakai untuk gate aksi sensitif.
export const VerifyAuthorizationSchema = z.object({
  authorizationPassword: z.string().min(1),
});
export type VerifyAuthorizationDto = z.infer<typeof VerifyAuthorizationSchema>;

export const ListUsersQuerySchema = z.object({
  search: z.string().optional(),
  role: z.string().optional(),
  branchId: z.string().optional(),
  isMechanic: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(10),
});
export type ListUsersQueryDto = z.infer<typeof ListUsersQuerySchema>;

export type UserResponse = {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  // Semua cabang yang user bisa akses (M2M via UserBranch). Empty = global.
  branches: Array<{ id: string; name: string }>;
  isActive: boolean;
  isMechanic: boolean;
  createdAt: string;
  transactionCount: number;
};

export type UserListResponse = {
  users: UserResponse[];
  total: number;
  totalPages: number;
};
