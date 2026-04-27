import { SetMetadata } from "@nestjs/common";

export const REQUIRE_ACCESS_KEY = "requireAccess";

export type RequireAccessMeta = {
  menuKey: string;
  actionKey: string;
};

export const RequireAccess = (menuKey: string, actionKey: string = "view") =>
  SetMetadata(REQUIRE_ACCESS_KEY, { menuKey, actionKey } as RequireAccessMeta);
