export type JwtPayload = {
  sub: string;
  role: string;
  companyId: string | null;
  branchId: string | null;
};

export type AuthUser = {
  id: string;
  role: string;
  companyId: string | null;
  branchId: string | null;
};
