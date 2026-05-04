import { z } from "zod";

export const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.string().min(1),
  branchId: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  isMechanic: z.boolean().optional().default(false),
});
export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.string().min(1).optional(),
  branchId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  isMechanic: z.boolean().optional(),
});
export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;

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
