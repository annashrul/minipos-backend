import type { PaginatedResponse } from "../types/response";

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  perPage: number,
): PaginatedResponse<T> {
  return {
    items,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      count: items.length,
    },
  };
}
