export type PaginationMeta = {
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  count: number;
};

export type PaginatedResponse<T> = {
  items: T[];
  meta: PaginationMeta;
};

export type SuccessResponse = {
  success: true;
};
