import { z } from "zod";

export const ListRolesQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRolesQueryDto = z.infer<typeof ListRolesQuerySchema>;

export const RoleMenuPermissionInputSchema = z.object({
  menuId: z.string().min(1),
  canView: z.boolean(),
});
export type RoleMenuPermissionInputDto = z.infer<
  typeof RoleMenuPermissionInputSchema
>;

export const RoleActionPermissionInputSchema = z.object({
  menuActionId: z.string().min(1),
  allowed: z.boolean(),
});
export type RoleActionPermissionInputDto = z.infer<
  typeof RoleActionPermissionInputSchema
>;

export const CreateRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  menuPermissions: z.array(RoleMenuPermissionInputSchema).default([]),
  actionPermissions: z.array(RoleActionPermissionInputSchema).default([]),
});
export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  menuPermissions: z.array(RoleMenuPermissionInputSchema).optional(),
  actionPermissions: z.array(RoleActionPermissionInputSchema).optional(),
});
export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;

export type RoleMenuPermissionResponse = {
  menuId: string;
  canView: boolean;
};

export type RoleActionPermissionResponse = {
  menuActionId: string;
  allowed: boolean;
};

export type RoleResponse = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  isActive: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RoleDetailResponse = RoleResponse & {
  menuPermissions: RoleMenuPermissionResponse[];
  actionPermissions: RoleActionPermissionResponse[];
};

export type RoleListResponse = {
  roles: RoleResponse[];
  total: number;
  totalPages: number;
};

export type MenuActionTreeItem = {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuTreeItem = {
  id: string;
  key: string;
  name: string;
  path: string;
  group: string;
  sortOrder: number;
  isActive: boolean;
  actions: MenuActionTreeItem[];
};

export type MenuTreeResponse = {
  menus: MenuTreeItem[];
};

export const ToggleRoleMenuPermissionSchema = z.object({
  role: z.string().min(1),
  menuId: z.string().min(1),
  allowed: z.boolean(),
});
export type ToggleRoleMenuPermissionDto = z.infer<
  typeof ToggleRoleMenuPermissionSchema
>;

export const ToggleRoleActionPermissionSchema = z.object({
  role: z.string().min(1),
  menuActionId: z.string().min(1),
  allowed: z.boolean(),
});
export type ToggleRoleActionPermissionDto = z.infer<
  typeof ToggleRoleActionPermissionSchema
>;
