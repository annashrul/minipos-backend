# Code Standard

Standar penulisan code untuk seluruh module di project ini.

---

## 1. Struktur Folder Module

Setiap module mengikuti struktur berikut:

```
src/modules/<module-name>/
├── <module-name>.module.ts        # NestJS module definition
├── <module-name>.controller.ts    # Route handlers
├── <module-name>.service.ts       # Business logic
├── <module-name>.repository.ts    # Prisma query layer
└── dto/
    └── <module-name>.dto.ts       # Zod schemas + inferred types
```

### Aturan

- Nama folder module menggunakan **kebab-case** (contoh: `closing-reports/`, `stock-opname/`).
- Satu module = satu folder. Tidak boleh ada module yang hanya berupa file tanpa folder.
- Semua file dalam module menggunakan nama module sebagai prefix (contoh: `users.controller.ts`, `users.service.ts`).
- DTO selalu di dalam subfolder `dto/` dengan satu file utama `<module-name>.dto.ts`.

### Nested Module (Kasus Khusus)

Untuk domain yang memiliki beberapa sub-module (contoh: `accounting`), gunakan barrel module:

```
src/modules/accounting/
├── accounting.module.ts           # Barrel: imports + exports sub-modules
├── dto/
│   └── accounting.dto.ts          # Shared DTO lintas sub-module
├── account-categories/
│   ├── account-categories.module.ts
│   ├── account-categories.controller.ts
│   ├── account-categories.service.ts
│   └── account-categories.repository.ts
├── accounts/
│   └── ...
└── journals/
    └── ...
```

Parent module **tidak** memiliki controller/service sendiri — hanya mengimpor dan mengekspor sub-module.

---

## 2. Repository Pattern

**Semua module wajib menggunakan repository pattern.**

### Repository (`*.repository.ts`)

Repository bertanggung jawab atas semua interaksi dengan Prisma. Service **tidak boleh** memanggil `PrismaService` secara langsung.

```ts
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// 1. Definisikan SELECT constant untuk shape data yang konsisten.
export const BRAND_SELECT = {
  id: true,
  name: true,
  companyId: true,
  createdAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.BrandSelect;

// 2. Export type hasil query dari SELECT.
export type RawBrand = Prisma.BrandGetPayload<{
  select: typeof BRAND_SELECT;
}>;

@Injectable()
export class BrandsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.BrandWhereInput,
    skip: number,
    take: number,
  ): Promise<RawBrand[]> {
    return this.prisma.brand.findMany({
      where,
      select: BRAND_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(where: Prisma.BrandWhereInput): Promise<number> {
    return this.prisma.brand.count({ where });
  }

  async findOne(where: Prisma.BrandWhereInput): Promise<RawBrand | null> {
    return this.prisma.brand.findFirst({ where, select: BRAND_SELECT });
  }

  async create(data: Prisma.BrandCreateInput): Promise<RawBrand> {
    return this.prisma.brand.create({ data, select: BRAND_SELECT });
  }

  async update(id: string, data: Prisma.BrandUpdateInput): Promise<RawBrand> {
    return this.prisma.brand.update({ where: { id }, data, select: BRAND_SELECT });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.brand.delete({ where: { id } });
  }
}
```

### Aturan Repository

- Nama constant SELECT: `UPPER_SNAKE_CASE` + `_SELECT` (contoh: `USER_SELECT`, `PURCHASE_ORDER_SELECT`).
- Nama type raw: `Raw` + nama model singular (contoh: `RawUser`, `RawBrand`).
- Gunakan `satisfies Prisma.XxxSelect` untuk type-safety.
- Repository **tidak** melakukan business logic — hanya query.
- Jika butuh query kompleks (raw SQL, transaction multi-tabel), boleh ada di repository.
- Export `SELECT` constant dan `Raw` type agar bisa dipakai di service untuk mapping.

### Service (`*.service.ts`)

Service bertanggung jawab atas business logic. Service **hanya** bergantung pada Repository, bukan PrismaService.

```ts
@Injectable()
export class BrandsService {
  constructor(private readonly repo: BrandsRepository) {}

  async list(companyId: string, query: ListBrandsQueryDto): Promise<PaginatedResponse<BrandResponse>> {
    const { search, page, perPage } = query;
    const where: Prisma.BrandWhereInput = { companyId };
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toBrandResponse), total, page, perPage);
  }
}
```

### Pengecualian

Service boleh mengakses `PrismaService` langsung **hanya** untuk:
- Transaction yang melibatkan **lebih dari satu model** (`prisma.$transaction`).
- Raw query (`prisma.$queryRaw`).

Dalam kasus ini, inject `PrismaService` sebagai dependensi tambahan di samping repository.

---

## 3. Naming Convention

### File & Folder

| Item | Convention | Contoh |
|------|-----------|--------|
| Folder module | kebab-case | `closing-reports/`, `stock-opname/` |
| File module | kebab-case + suffix | `closing-reports.service.ts` |
| File DTO | kebab-case + `.dto.ts` | `closing-reports.dto.ts` |

### Class & Type

| Item | Convention | Contoh |
|------|-----------|--------|
| Service class | PascalCase + `Service` | `ClosingReportsService` |
| Repository class | PascalCase + `Repository` | `ClosingReportsRepository` |
| Controller class | PascalCase + `Controller` | `ClosingReportsController` |
| Module class | PascalCase + `Module` | `ClosingReportsModule` |
| DTO type (inferred) | PascalCase + `Dto` | `CreateBrandDto`, `ListBrandsQueryDto` |
| Response type | PascalCase + `Response` | `BrandResponse`, `PurchaseOrderDetailResponse` |
| Raw DB type | `Raw` + ModelName | `RawBrand`, `RawUser` |
| SELECT constant | UPPER_SNAKE + `_SELECT` | `BRAND_SELECT`, `USER_SELECT` |
| Zod schema | PascalCase + `Schema` | `CreateBrandSchema`, `ListBrandsQuerySchema` |

### Penamaan Service & Controller

- Gunakan **plural** untuk resource-based module: `UsersService`, `ProductsService`, `BrandsService`.
- Gunakan **singular** untuk domain/feature module: `CashierService`, `AnalyticsService`, `DashboardService`.

---

## 4. DTO & Validasi

### Struktur DTO File

Semua schema dan type dalam satu file `dto/<module-name>.dto.ts`:

```ts
import { z } from "zod";
import { PaginationQuerySchema } from "@/common/schemas/pagination.schema";

// ── Query Schemas ──────────────────────────────────────────

export const ListBrandsQuerySchema = PaginationQuerySchema.extend({
  search: z.string().optional(),
});
export type ListBrandsQueryDto = z.infer<typeof ListBrandsQuerySchema>;

// ── Mutation Schemas ───────────────────────────────────────

export const CreateBrandSchema = z.object({
  name: z.string().min(1).max(100),
});
export type CreateBrandDto = z.infer<typeof CreateBrandSchema>;

export const UpdateBrandSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});
export type UpdateBrandDto = z.infer<typeof UpdateBrandSchema>;

// ── Response Types ─────────────────────────────────────────

export type BrandResponse = {
  id: string;
  name: string;
  productCount: number;
  createdAt: string;
};
```

### Aturan

- Selalu pakai `PaginationQuerySchema.extend({...})` untuk list query.
- Response type adalah plain `type`, bukan Zod schema (response tidak perlu validasi).
- Gunakan `z.coerce.number()` untuk query params yang datang sebagai string.
- Boolean query params: `z.union([z.boolean(), z.enum(["true", "false"])]).transform(...)`.
- Urutan dalam file: Query schemas → Mutation schemas → Response types.

### Validasi di Controller

```ts
@Get()
async list(
  @CurrentCompany() companyId: string,
  @Query(new ZodValidationPipe(ListBrandsQuerySchema)) query: ListBrandsQueryDto,
) {
  const data = await this.service.list(companyId, query);
  return { data };
}

@Post()
async create(
  @CurrentCompany() companyId: string,
  @Body(new ZodValidationPipe(CreateBrandSchema)) dto: CreateBrandDto,
) {
  const data = await this.service.create(companyId, dto);
  return { data };
}
```

---

## 5. Import Path

**Selalu gunakan alias `@/` untuk semua import.**

```ts
// ✅ Benar
import { PrismaService } from "@/modules/prisma/prisma.service";
import { paginate } from "@/common/utils/pagination";
import type { PaginatedResponse } from "@/common/types/response";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import type { CreateBrandDto } from "./dto/brands.dto";

// ❌ Salah
import { PrismaService } from "../../prisma/prisma.service";
import { paginate } from "../../../common/utils/pagination";
```

### Aturan

- Import ke file **di luar module sendiri** → selalu pakai `@/`.
- Import ke file **di dalam module sendiri** (sesama folder) → boleh pakai `./` atau `../`.
- Gunakan `import type` untuk import yang hanya digunakan sebagai type.

---

## 6. Response Format

### Envelope

Semua response dibungkus dalam `{ data }`:

```ts
// Single item
{ data: { id: "...", name: "..." } }

// List + pagination
{ data: { items: [...], meta: { ... } } }

// Action result
{ data: { success: true } }
```

### Paginated Response

Gunakan helper `paginate()` dari `@/common/utils/pagination`:

```ts
import { paginate } from "@/common/utils/pagination";

async list(companyId: string, query: ListBrandsQueryDto) {
  const { page, perPage } = query;
  const [rows, total] = await Promise.all([
    this.repo.findMany(where, (page - 1) * perPage, perPage),
    this.repo.count(where),
  ]);
  return paginate(rows.map(toBrandResponse), total, page, perPage);
}
```

### Response Mapping

Gunakan fungsi `toXxxResponse()` di luar class (module-level function) untuk mapping `Raw` type ke response type:

```ts
function toBrandResponse(brand: RawBrand): BrandResponse {
  return {
    id: brand.id,
    name: brand.name,
    productCount: brand._count.products,
    createdAt: brand.createdAt.toISOString(),
  };
}
```

### Aturan

- **Jangan** return raw Prisma object langsung — selalu mapping via `toXxxResponse()`.
- Date di-return sebagai ISO string (`.toISOString()`).
- `_count` di-flatten ke field yang bermakna (`productCount`, bukan `_count.products`).
- Nullable field tetap dipertahankan (`null`, bukan dihilangkan).

---

## 7. Controller Pattern

```ts
import { Controller, Get, Post, Patch, Delete, Query, Param, Body } from "@nestjs/common";
import { RequireAccess } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";

@Controller("brands")
export class BrandsController {
  constructor(private readonly service: BrandsService) {}

  @Get()
  @RequireAccess("brands", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBrandsQuerySchema)) query: ListBrandsQueryDto,
  ) {
    const data = await this.service.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("brands", "view")
  async findById(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("brands", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBrandSchema)) dto: CreateBrandDto,
  ) {
    const data = await this.service.create(companyId, dto);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("brands", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBrandSchema)) dto: UpdateBrandDto,
  ) {
    const data = await this.service.update(companyId, id, dto);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("brands", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.delete(companyId, id);
    return { data };
  }
}
```

### Aturan

- Controller **tidak** berisi business logic — hanya routing, validasi, dan `return { data }`.
- Selalu pakai `@RequireAccess()` untuk authorization.
- Selalu pakai `@CurrentCompany()` untuk mendapatkan `companyId`.
- Selalu pakai `ZodValidationPipe` untuk validasi input.
- **Tidak boleh** inject `PrismaService` di controller.

---

## 8. Error Handling

### Di Service

Gunakan NestJS built-in exceptions:

```ts
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

// Data tidak ditemukan
throw new NotFoundException("Brand tidak ditemukan");

// Validasi bisnis gagal
throw new BadRequestException("Brand masih memiliki produk terkait");

// Duplikat (unique constraint)
throw new ConflictException("Nama brand sudah digunakan");
```

### Prisma Error Handling

```ts
try {
  const created = await this.repo.create(data);
  return toBrandResponse(created);
} catch (err) {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Nama brand sudah digunakan");
  }
  throw err;
}
```

### Aturan

- **Jangan** catch generic error kecuali untuk re-throw sebagai HttpException.
- Prisma error code `P2002` (unique violation) → `ConflictException`.
- Prisma error code `P2025` (not found) → `NotFoundException`.
- Pesan error dalam **Bahasa Indonesia** untuk user-facing.

---

## 9. Multi-Tenant (companyId)

### Aturan

- **Semua** query harus di-scope dengan `companyId` untuk data isolation.
- `companyId` masuk ke `where` clause, **bukan** di-cek setelah fetch.
- Gunakan `findFirst` dengan `companyId` di `where`, bukan `findUnique` + manual check.

```ts
// ✅ Benar
const brand = await this.repo.findOne({ id, companyId });
if (!brand) throw new NotFoundException("Brand tidak ditemukan");

// ❌ Salah
const brand = await this.repo.findById(id);
if (brand.companyId !== companyId) throw new ForbiddenException();
```

---

## 10. Module Registration

### Module File

```ts
import { Module } from "@nestjs/common";
import { BrandsController } from "./brands.controller";
import { BrandsService } from "./brands.service";
import { BrandsRepository } from "./brands.repository";

@Module({
  controllers: [BrandsController],
  providers: [BrandsService, BrandsRepository],
  exports: [BrandsService],
})
export class BrandsModule {}
```

### Aturan

- Export **hanya** Service (bukan Repository/Controller) — service adalah public API module.
- Repository adalah internal implementation detail.
- Jika module lain perlu akses, inject via Service yang di-export.

---

## 11. Database Naming Convention

### Prinsip Utama

Semua identifier di database menggunakan **camelCase** untuk kolom dan **snake_case** untuk nama tabel.

### Tabel

Nama tabel menggunakan **snake_case** via `@@map` di Prisma schema:

```prisma
model PurchaseOrder {
  id        String   @id @default(uuid())
  companyId String
  status    String
  createdAt DateTime @default(now())

  @@map("purchase_orders")
}
```

| Item | Convention | Contoh |
|------|-----------|--------|
| Model Prisma | PascalCase | `PurchaseOrder`, `TransactionItem` |
| Tabel DB | snake_case (via `@@map`) | `purchase_orders`, `transaction_items` |

### Kolom

Nama kolom menggunakan **camelCase** — sama persis dengan nama field di Prisma schema. **Tidak boleh** menggunakan `@map` pada field.

```prisma
// ✅ Benar — kolom DB = "companyId", "branchId", "createdAt"
model Booking {
  companyId  String
  branchId   String?
  createdAt  DateTime @default(now())
  
  @@map("bookings")
}

// ❌ Salah — jangan pakai @map pada field
model Booking {
  companyId  String   @map("company_id")    // DILARANG
  branchId   String?  @map("branch_id")     // DILARANG
  createdAt  DateTime @map("created_at")    // DILARANG
}
```

### Index & Constraint

```prisma
@@unique([companyId, name])     // Prisma auto-generate nama
@@index([companyId])
@@index([branchId, status])
```

### Enum

Enum menggunakan **PascalCase** untuk nama dan **UPPER_SNAKE_CASE** untuk value:

```prisma
enum TransactionStatus {
  PENDING
  COMPLETED
  REFUNDED
  VOIDED
  CANCELLED
}
```

### View

View menggunakan prefix `vw_` + snake_case untuk nama view, dan **camelCase** (double-quoted) untuk alias kolom output:

```sql
CREATE VIEW vw_sales_item_facts AS
SELECT
  ti.id AS "itemId",
  t."branchId",
  u.name AS "cashierName",
  ti."productId",
  p."purchasePrice",
  t."createdAt" AS "txCreatedAt"
FROM transaction_items ti
JOIN transactions t ON t.id = ti."transactionId"
...
```

| Item | Convention | Contoh |
|------|-----------|--------|
| Nama view | `vw_` + snake_case | `vw_product_branch`, `vw_sales_item_facts` |
| Alias kolom view | camelCase (double-quoted) | `"productId"`, `"cashierName"`, `"txCreatedAt"` |

### Raw SQL di Backend

Saat menulis raw SQL (`$queryRaw`, `$queryRawUnsafe`):

```ts
// ✅ Benar — kolom camelCase harus double-quoted di PostgreSQL
const rows = await this.prisma.$queryRaw`
  SELECT "companyId", "branchId", "grandTotal"
  FROM transactions
  WHERE "companyId" = ${companyId}
`;

// ✅ Benar — tabel tetap snake_case (tanpa quote boleh)
const rows = await this.prisma.$queryRaw`
  SELECT * FROM purchase_orders WHERE id = ${id}
`;

// ❌ Salah — camelCase tanpa quote akan jadi lowercase di PostgreSQL
SELECT companyId FROM transactions  // PostgreSQL baca sebagai "companyid" → error
```

### Aturan Penting

1. **Kolom camelCase di PostgreSQL WAJIB double-quoted** — PostgreSQL fold unquoted identifiers ke lowercase.
2. **Tabel snake_case tidak perlu di-quote** — sudah lowercase.
3. **Jangan gunakan `@map` pada field** — nama field Prisma = nama kolom DB.
4. **`@@map` pada model WAJIB** — untuk mapping PascalCase model ke snake_case tabel.
5. **SELECT alias di raw SQL harus camelCase** — konsisten dengan response format.
6. **Enum values tetap UPPER_SNAKE_CASE** — ini standard PostgreSQL enum.

### Migration

Saat membuat migrasi baru:

```prisma
// Tambah field baru — langsung camelCase, tanpa @map
model Product {
  lastSyncedAt DateTime?    // kolom DB = "lastSyncedAt"
}
```

Jangan pernah membuat kolom baru dengan snake_case. Jika menemukan kolom lama yang masih snake_case, rename ke camelCase dan hapus `@map`.

---

## 12. Query Pattern

Ikuti standar lengkap di [`QUERY-STANDARD.md`](./QUERY-STANDARD.md). Ringkasan:

1. Filtering di `where`, bukan manual `.filter()` di service.
2. Gunakan `select` untuk field yang dibutuhkan saja.
3. Hindari N+1 — jangan query di dalam loop.
4. Gunakan `some`, `none`, `every` untuk filter relasi.
5. Bulk operation: `createMany`, `updateMany`, `deleteMany`.
6. Transaction untuk proses yang saling terkait.
7. Pagination: `skip` + `take` + `orderBy`.
8. Aggregate: `count`, `aggregate`, `groupBy` — bukan `.reduce()` manual.
9. Ownership (`companyId`) selalu di query.
10. Lookup berulang: konversi array ke `Map` sebelum loop.
