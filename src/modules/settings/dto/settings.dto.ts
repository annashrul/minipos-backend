import { z } from "zod";

export const ListSettingsQuerySchema = z.object({
  group: z.string().optional(),
  branchId: z.string().nullable().optional(),
  keys: z.string().optional(),
});
export type ListSettingsQueryDto = z.infer<typeof ListSettingsQuerySchema>;

export const UpsertSettingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  label: z.string().nullable().optional(),
  group: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
});
export type UpsertSettingDto = z.infer<typeof UpsertSettingSchema>;

export const UpsertSettingsBulkSchema = z.object({
  settings: z.array(UpsertSettingSchema).min(1),
});
export type UpsertSettingsBulkDto = z.infer<typeof UpsertSettingsBulkSchema>;

export type SettingResponse = {
  id: string;
  key: string;
  value: string;
  label: string | null;
  group: string | null;
  branchId: string | null;
  updatedAt: string;
};

export type SettingListResponse = {
  settings: SettingResponse[];
};
