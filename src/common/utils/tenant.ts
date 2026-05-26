export type TenantPath =
  | "direct"
  | "branch"
  | "fromBranch"
  | "toBranch"
  | "supplier"
  | "customer"
  | "user"
  | "category"
  | "purchaseOrder"
  | "purchaseOrder.supplier"
  | "transaction.user"
  | "period";

const PATH_MAP: Record<TenantPath, (companyId: string) => Record<string, unknown>> = {
  direct: (companyId) => ({ companyId }),
  branch: (companyId) => ({ branch: { companyId } }),
  fromBranch: (companyId) => ({ fromBranch: { companyId } }),
  toBranch: (companyId) => ({ toBranch: { companyId } }),
  supplier: (companyId) => ({ supplier: { companyId } }),
  customer: (companyId) => ({ customer: { companyId } }),
  user: (companyId) => ({ user: { companyId } }),
  category: (companyId) => ({ category: { companyId } }),
  purchaseOrder: (companyId) => ({ purchaseOrder: { companyId } }),
  "purchaseOrder.supplier": (companyId) => ({
    purchaseOrder: { supplier: { companyId } },
  }),
  "transaction.user": (companyId) => ({
    transaction: { user: { companyId } },
  }),
  period: (companyId) => ({ period: { companyId } }),
};

export function tenantWhere(
  companyId: string,
  ...paths: TenantPath[]
): Record<string, unknown> {
  if (paths.length === 0) return { companyId };
  if (paths.length === 1) return PATH_MAP[paths[0]!](companyId);
  return { OR: paths.map((p) => PATH_MAP[p](companyId)) };
}
