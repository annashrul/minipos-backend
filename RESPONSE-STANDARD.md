# API Response Standard

## Masalah Saat Ini

Setiap module mendefinisikan response list sendiri dengan field name berbeda-beda:

```ts
// categories
{ categories: [...], total: 10, totalPages: 2 }

// users
{ users: [...], total: 10, totalPages: 2 }

// brands
{ brands: [...], total: 10, totalPages: 2 }
```

Ini menyulitkan frontend karena harus tahu nama field spesifik untuk setiap endpoint.

---

## Standar yang Diusulkan

### 1. Envelope Response (Semua Endpoint)

Semua response dibungkus dalam envelope `{ data }` (sudah diterapkan saat ini):

```ts
// Single item
{ data: { id: "...", name: "..." } }

// List + pagination
{ data: { items: [...], meta: { ... } } }

// Action result
{ data: { success: true } }
```

### 2. Paginated Response (Endpoint List)

Semua endpoint list menggunakan **format yang sama**:

```ts
type PaginatedResponse<T> = {
  items: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    count: number;       // jumlah item di halaman ini (items.length)
  };
};
```

`count` berguna agar frontend tidak perlu hitung `items.length` sendiri — terutama di halaman terakhir yang jumlahnya bisa kurang dari `perPage`.

**Contoh response:**

```json
{
  "data": {
    "items": [
      { "id": "abc", "name": "Makanan" },
      { "id": "def", "name": "Minuman" }
    ],
    "meta": {
      "total": 50,
      "page": 1,
      "perPage": 20,
      "totalPages": 3,
      "count": 2
    }
  }
}
```

### 3. Query Pagination (Request)

Semua endpoint list menerima query parameter yang konsisten:

```ts
const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
```

### 4. Error Response

```ts
type ErrorResponse = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};
```

**Contoh:**

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Category not found"
  }
}
```

---

## Shared Types (di `src/common/types/response.ts`)

```ts
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
```

---

## Perubahan per Module

### Sebelum (contoh categories)

```ts
// DTO
export type CategoryListResponse = {
  categories: CategoryResponse[];
  total: number;
  totalPages: number;
};

// Service
return {
  categories: rows.map(toCategoryResponse),
  total,
  totalPages: Math.ceil(total / perPage),
};

// Controller
const data = await this.categories.list(companyId, query);
return { data };
```

### Sesudah

```ts
// DTO — tidak perlu lagi CategoryListResponse
// Cukup import PaginatedResponse dari common

// Service — pakai helper paginate()
return paginate(rows.map(toCategoryResponse), total, page, perPage);

// Controller (sama, tidak berubah)
const data = await this.categories.list(companyId, query);
return { data };
```

---

## Shared Pagination Query Schema

Buat reusable schema di `src/common/schemas/pagination.schema.ts`:

```ts
import { z } from "zod";

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
});
export type PaginationQueryDto = z.infer<typeof PaginationQuerySchema>;

export const SortQuerySchema = z.object({
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});
export type SortQueryDto = z.infer<typeof SortQuerySchema>;
```

Setiap module tinggal extend:

```ts
export const ListCategoriesQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
  parentId: z.string().nullable().optional(),
  kind: z.enum(["PRODUCT", "VEHICLE_MODEL"]).optional(),
});
```

---

## Helper Function

Buat helper di `src/common/utils/pagination.ts`:

```ts
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
```

Pemakaian di service:

```ts
import { paginate } from "@/common/utils/pagination";

async list(companyId: string, query: ListCategoriesQueryDto) {
  const { page, perPage } = query;
  // ... build where, orderBy ...

  const [rows, total] = await Promise.all([
    this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
    this.repo.count(where),
  ]);

  return paginate(rows.map(toCategoryResponse), total, page, perPage);
}
```

---

## Rencana Migrasi

| Tahap | Aksi |
|-------|------|
| 1 | Buat `common/types/response.ts`, `common/schemas/pagination.schema.ts`, `common/utils/pagination.ts` |
| 2 | Refactor module per module: ganti `XxxListResponse` → `PaginatedResponse<XxxResponse>` + pakai helper `paginate()` |
| 3 | Hapus type `XxxListResponse` yang sudah tidak dipakai |
| 4 | Frontend adjust: ubah `data.categories` → `data.items`, `data.total` → `data.meta.total` |

**Catatan**: Tahap 2 dan 4 harus dilakukan **bersamaan** atau dengan feature flag agar frontend tidak break.
