import { z } from "zod";

export const MeMenusQuerySchema = z.object({}).passthrough();
export type MeMenusQueryDto = z.infer<typeof MeMenusQuerySchema>;

export const MeAccessMatrixQuerySchema = z.object({
  search: z.string().optional(),
});
export type MeAccessMatrixQueryDto = z.infer<typeof MeAccessMatrixQuerySchema>;

export type AccessMenuActionDto = {
  id: string;
  key: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  permissions: Record<string, boolean>;
};

export type AccessMenuDto = {
  id: string;
  key: string;
  name: string;
  path: string;
  group: string;
  subgroup: string | null;
  sortOrder: number;
  isActive: boolean;
  permissions: Record<string, boolean>;
  actions: AccessMenuActionDto[];
};

export type MeMenusResponse = {
  role: string;
  menus: AccessMenuDto[];
  roleColor: string | null;
};

export type MeAccessMatrixResponse = {
  role: string;
  roles: string[];
  menus: AccessMenuDto[];
};
