# Catatan Masalah Query Prisma

## Tujuan Dokumen

Dokumen ini berisi catatan umum tentang cara menulis query Prisma yang lebih bersih, aman, dan efisien.

Fokus utamanya adalah memindahkan logic yang seharusnya bisa ditangani oleh database ke query Prisma, bukan diproses secara berlebihan di service layer.

---

## Prinsip Utama

Gunakan database untuk melakukan pekerjaan yang memang cocok dilakukan oleh database, seperti:

- filtering data
- sorting data
- pagination
- pengecekan relasi
- aggregate
- count
- bulk operation
- transaction
- pencarian data
- validasi keberadaan data berdasarkan kondisi tertentu

Hindari mengambil terlalu banyak data lalu memproses semuanya secara manual di service.

---

# 1. Jangan Filter Data Manual di Service

## Masalah

Contoh yang kurang baik:

```ts
const users = await prisma.user.findMany();

const activeUsers = users.filter((user) => user.isActive);
```

Masalahnya, semua data user diambil dulu dari database, lalu baru difilter di aplikasi.

## Solusi

Gunakan `where` di query Prisma.

```ts
const activeUsers = await prisma.user.findMany({
  where: {
    isActive: true,
  },
});
```

## Prinsip

Jika data bisa difilter oleh database, gunakan `where`.

---

# 2. Gunakan Select untuk Mengambil Field yang Dibutuhkan

## Masalah

Contoh kurang baik:

```ts
const users = await prisma.user.findMany();
```

Query ini mengambil semua field, termasuk field yang mungkin tidak dibutuhkan.

## Solusi

Gunakan `select`.

```ts
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    email: true,
  },
});
```

## Prinsip

Ambil hanya field yang dibutuhkan.

---

# 3. Gunakan Include Hanya Jika Butuh Relasi

## Masalah

Contoh kurang baik:

```ts
const users = await prisma.user.findMany({
  include: {
    posts: true,
    profile: true,
    roles: true,
  },
});
```

Jika semua relasi tidak benar-benar dibutuhkan, query menjadi berat.

## Solusi

Gunakan `include` hanya untuk relasi yang memang diperlukan.

```ts
const users = await prisma.user.findMany({
  include: {
    profile: true,
  },
});
```

Atau lebih baik gunakan `select` di dalam relasi.

```ts
const users = await prisma.user.findMany({
  select: {
    id: true,
    name: true,
    profile: {
      select: {
        avatarUrl: true,
      },
    },
  },
});
```

## Prinsip

Jangan include relasi secara berlebihan.

---

# 4. Hindari N+1 Query

## Masalah

Contoh kurang baik:

```ts
const users = await prisma.user.findMany();

for (const user of users) {
  const posts = await prisma.post.findMany({
    where: {
      userId: user.id,
    },
  });
}
```

Masalahnya, jika ada 100 user maka query post akan dijalankan 100 kali.

## Solusi

Gunakan `include`, `select`, atau query relasi langsung.

```ts
const users = await prisma.user.findMany({
  include: {
    posts: true,
  },
});
```

Atau ambil posts dengan `userId in`.

```ts
const posts = await prisma.post.findMany({
  where: {
    userId: {
      in: userIds,
    },
  },
});
```

## Prinsip

Jangan menjalankan query berulang di dalam loop jika bisa digabungkan dalam satu query.

---

# 5. Gunakan Relation Filter untuk Mengecek Relasi

## Masalah

Contoh kurang baik:

```ts
const brands = await prisma.brand.findMany({
  include: {
    _count: {
      select: {
        products: true,
      },
    },
  },
});

const brandsWithProducts = brands.filter(
  (brand) => brand._count.products > 0,
);
```

Logic pengecekan relasi dilakukan di service.

## Solusi

Gunakan relation filter Prisma.

### Memiliki minimal satu relasi

```ts
const brandsWithProducts = await prisma.brand.findMany({
  where: {
    products: {
      some: {},
    },
  },
});
```

### Tidak memiliki relasi

```ts
const brandsWithoutProducts = await prisma.brand.findMany({
  where: {
    products: {
      none: {},
    },
  },
});
```

### Semua relasi memenuhi kondisi tertentu

```ts
const users = await prisma.user.findMany({
  where: {
    posts: {
      every: {
        published: true,
      },
    },
  },
});
```

## Prinsip

Gunakan `some`, `none`, dan `every` untuk filtering berdasarkan relasi.

---

# 6. Bulk Delete dengan Relation Filter

## Masalah

Contoh kurang baik:

```ts
const brands = await prisma.brand.findMany({
  where: {
    id: {
      in: ids,
    },
  },
  include: {
    _count: {
      select: {
        products: true,
      },
    },
  },
});

const deletable: string[] = [];
const skipped: string[] = [];

for (const brand of brands) {
  if (brand._count.products > 0) {
    skipped.push(brand.name);
  } else {
    deletable.push(brand.id);
  }
}

await prisma.brand.deleteMany({
  where: {
    id: {
      in: deletable,
    },
  },
});
```

Masalahnya, service melakukan pemisahan data secara manual.

## Solusi

Gunakan relation filter langsung pada query.

```ts
const skippedBrands = await prisma.brand.findMany({
  where: {
    companyId,
    id: {
      in: ids,
    },
    products: {
      some: {},
    },
  },
  select: {
    name: true,
  },
});

const deleteResult = await prisma.brand.deleteMany({
  where: {
    companyId,
    id: {
      in: ids,
    },
    products: {
      none: {},
    },
  },
});
```

## Dengan Transaction

```ts
const [skippedBrands, deleteResult] = await prisma.$transaction([
  prisma.brand.findMany({
    where: {
      companyId,
      id: {
        in: ids,
      },
      products: {
        some: {},
      },
    },
    select: {
      name: true,
    },
  }),

  prisma.brand.deleteMany({
    where: {
      companyId,
      id: {
        in: ids,
      },
      products: {
        none: {},
      },
    },
  }),
]);

return {
  count: deleteResult.count,
  skipped: skippedBrands.map((brand) => brand.name),
};
```

## Prinsip

Untuk bulk delete, gunakan `deleteMany` dengan kondisi yang lengkap di `where`.

---

# 7. Gunakan Count dari Database

## Masalah

Contoh kurang baik:

```ts
const users = await prisma.user.findMany({
  where: {
    isActive: true,
  },
});

const total = users.length;
```

Masalahnya, aplikasi mengambil semua data hanya untuk menghitung jumlahnya.

## Solusi

Gunakan `count`.

```ts
const total = await prisma.user.count({
  where: {
    isActive: true,
  },
});
```

## Prinsip

Jika hanya butuh jumlah data, gunakan `count`.

---

# 8. Gunakan Aggregate untuk Perhitungan

## Masalah

Contoh kurang baik:

```ts
const orders = await prisma.order.findMany();

const totalAmount = orders.reduce(
  (total, order) => total + order.amount,
  0,
);
```

Masalahnya, semua order diambil ke aplikasi hanya untuk dijumlahkan.

## Solusi

Gunakan `aggregate`.

```ts
const result = await prisma.order.aggregate({
  _sum: {
    amount: true,
  },
});

const totalAmount = result._sum.amount ?? 0;
```

## Contoh Lain

```ts
const result = await prisma.order.aggregate({
  _avg: {
    amount: true,
  },
  _min: {
    amount: true,
  },
  _max: {
    amount: true,
  },
});
```

## Prinsip

Gunakan database untuk menghitung sum, average, min, dan max.

---

# 9. Gunakan GroupBy untuk Rekap Data

## Masalah

Contoh kurang baik:

```ts
const orders = await prisma.order.findMany();

const grouped = orders.reduce((acc, order) => {
  acc[order.status] = (acc[order.status] ?? 0) + 1;
  return acc;
}, {});
```

## Solusi

Gunakan `groupBy`.

```ts
const grouped = await prisma.order.groupBy({
  by: ['status'],
  _count: {
    id: true,
  },
});
```

## Prinsip

Jika ingin mengelompokkan data, gunakan `groupBy`.

---

# 10. Pagination Harus Dilakukan di Query

## Masalah

Contoh kurang baik:

```ts
const users = await prisma.user.findMany();

const paginatedUsers = users.slice(skip, skip + take);
```

Masalahnya, semua data diambil dulu lalu dipotong di aplikasi.

## Solusi

Gunakan `skip` dan `take`.

```ts
const users = await prisma.user.findMany({
  skip,
  take,
  orderBy: {
    createdAt: 'desc',
  },
});
```

## Dengan Total Count

```ts
const [data, total] = await prisma.$transaction([
  prisma.user.findMany({
    skip,
    take,
    orderBy: {
      createdAt: 'desc',
    },
  }),

  prisma.user.count(),
]);
```

## Prinsip

Pagination harus dilakukan di level database.

---

# 11. Selalu Gunakan OrderBy Saat Pagination

## Masalah

Pagination tanpa `orderBy` bisa menghasilkan urutan data yang tidak konsisten.

```ts
const users = await prisma.user.findMany({
  skip,
  take,
});
```

## Solusi

Tambahkan `orderBy`.

```ts
const users = await prisma.user.findMany({
  skip,
  take,
  orderBy: {
    createdAt: 'desc',
  },
});
```

## Prinsip

Jika menggunakan pagination, selalu gunakan `orderBy`.

---

# 12. Search Menggunakan Contains

## Contoh

```ts
const users = await prisma.user.findMany({
  where: {
    name: {
      contains: keyword,
      mode: 'insensitive',
    },
  },
});
```

## Search di Banyak Field

```ts
const users = await prisma.user.findMany({
  where: {
    OR: [
      {
        name: {
          contains: keyword,
          mode: 'insensitive',
        },
      },
      {
        email: {
          contains: keyword,
          mode: 'insensitive',
        },
      },
    ],
  },
});
```

## Prinsip

Gunakan `contains` dan `OR` untuk pencarian sederhana.

---

# 13. Gunakan AND dan OR dengan Jelas

## Contoh AND

```ts
const users = await prisma.user.findMany({
  where: {
    AND: [
      {
        isActive: true,
      },
      {
        role: 'ADMIN',
      },
    ],
  },
});
```

## Contoh OR

```ts
const users = await prisma.user.findMany({
  where: {
    OR: [
      {
        role: 'ADMIN',
      },
      {
        role: 'SUPER_ADMIN',
      },
    ],
  },
});
```

## Kombinasi AND dan OR

```ts
const users = await prisma.user.findMany({
  where: {
    isActive: true,
    OR: [
      {
        name: {
          contains: keyword,
          mode: 'insensitive',
        },
      },
      {
        email: {
          contains: keyword,
          mode: 'insensitive',
        },
      },
    ],
  },
});
```

## Prinsip

Susun kondisi query dengan jelas agar mudah dibaca dan tidak salah logic.

---

# 14. Gunakan Transaction untuk Proses yang Saling Terkait

## Masalah

Contoh kurang baik:

```ts
await prisma.order.create({ data: orderData });
await prisma.orderItem.createMany({ data: items });
await prisma.cart.deleteMany({ where: { userId } });
```

Jika salah satu query gagal, data bisa tidak konsisten.

## Solusi

Gunakan transaction.

```ts
await prisma.$transaction([
  prisma.order.create({
    data: orderData,
  }),

  prisma.orderItem.createMany({
    data: items,
  }),

  prisma.cart.deleteMany({
    where: {
      userId,
    },
  }),
]);
```

## Prinsip

Gunakan transaction jika beberapa query harus berhasil atau gagal bersama-sama.

---

# 15. Gunakan Upsert Jika Create atau Update

## Masalah

Contoh kurang baik:

```ts
const existing = await prisma.profile.findUnique({
  where: {
    userId,
  },
});

if (existing) {
  await prisma.profile.update({
    where: {
      userId,
    },
    data,
  });
} else {
  await prisma.profile.create({
    data: {
      userId,
      ...data,
    },
  });
}
```

## Solusi

Gunakan `upsert`.

```ts
await prisma.profile.upsert({
  where: {
    userId,
  },
  update: data,
  create: {
    userId,
    ...data,
  },
});
```

## Prinsip

Jika logic-nya create jika belum ada dan update jika sudah ada, gunakan `upsert`.

---

# 16. Gunakan UpdateMany untuk Update Massal

## Masalah

Contoh kurang baik:

```ts
for (const id of ids) {
  await prisma.user.update({
    where: {
      id,
    },
    data: {
      isActive: false,
    },
  });
}
```

## Solusi

Gunakan `updateMany`.

```ts
await prisma.user.updateMany({
  where: {
    id: {
      in: ids,
    },
  },
  data: {
    isActive: false,
  },
});
```

## Prinsip

Untuk update banyak data dengan data yang sama, gunakan `updateMany`.

---

# 17. Gunakan CreateMany untuk Insert Massal

## Masalah

Contoh kurang baik:

```ts
for (const item of items) {
  await prisma.product.create({
    data: item,
  });
}
```

## Solusi

Gunakan `createMany`.

```ts
await prisma.product.createMany({
  data: items,
});
```

## Dengan Skip Duplicate

```ts
await prisma.product.createMany({
  data: items,
  skipDuplicates: true,
});
```

## Prinsip

Untuk insert banyak data sekaligus, gunakan `createMany`.

---

# 18. Validasi Ownership di Query

## Masalah

Contoh kurang baik:

```ts
const brand = await prisma.brand.findUnique({
  where: {
    id,
  },
});

if (brand.companyId !== companyId) {
  throw new ForbiddenException();
}
```

Masalahnya, data diambil dulu baru dicek ownership-nya.

## Solusi

Masukkan `companyId` langsung ke query.

```ts
const brand = await prisma.brand.findFirst({
  where: {
    id,
    companyId,
  },
});
```

Untuk update:

```ts
await prisma.brand.updateMany({
  where: {
    id,
    companyId,
  },
  data,
});
```

Untuk delete:

```ts
await prisma.brand.deleteMany({
  where: {
    id,
    companyId,
  },
});
```

## Prinsip

Untuk multi-tenant app, selalu filter berdasarkan `companyId` langsung di query.

---

# 19. Soft Delete

## Masalah

Jika menggunakan soft delete, jangan lupa filter data yang belum dihapus.

## Contoh Query

```ts
const brands = await prisma.brand.findMany({
  where: {
    deletedAt: null,
  },
});
```

## Soft Delete Single Data

```ts
await prisma.brand.update({
  where: {
    id,
  },
  data: {
    deletedAt: new Date(),
  },
});
```

## Soft Delete dengan Ownership

```ts
await prisma.brand.updateMany({
  where: {
    id,
    companyId,
    deletedAt: null,
  },
  data: {
    deletedAt: new Date(),
  },
});
```

## Prinsip

Jika menggunakan soft delete, semua query list/detail harus memperhatikan `deletedAt: null`.

---

# 20. Jangan Gunakan FindUnique Jika Butuh Filter Tambahan

## Masalah

Contoh:

```ts
const brand = await prisma.brand.findUnique({
  where: {
    id,
  },
});
```

Lalu ownership dicek manual.

## Solusi

Jika perlu filter tambahan seperti `companyId` atau `deletedAt`, gunakan `findFirst`.

```ts
const brand = await prisma.brand.findFirst({
  where: {
    id,
    companyId,
    deletedAt: null,
  },
});
```

## Prinsip

Gunakan `findUnique` untuk unique constraint saja. Gunakan `findFirst` jika butuh kondisi tambahan.

---

# 21. Hindari Query Tanpa Batas

## Masalah

```ts
const products = await prisma.product.findMany();
```

Jika data sangat besar, query ini berbahaya.

## Solusi

Gunakan limit dengan `take`.

```ts
const products = await prisma.product.findMany({
  take: 50,
  orderBy: {
    createdAt: 'desc',
  },
});
```

## Prinsip

Untuk endpoint list, selalu pertimbangkan pagination atau limit.

---

# 22. Gunakan Exists Check yang Ringan

## Masalah

Jika hanya ingin tahu data ada atau tidak, jangan ambil semua field.

```ts
const user = await prisma.user.findFirst({
  where: {
    email,
  },
});
```

## Solusi

Ambil field minimal.

```ts
const user = await prisma.user.findFirst({
  where: {
    email,
  },
  select: {
    id: true,
  },
});
```

## Prinsip

Untuk cek keberadaan data, gunakan `select: { id: true }`.

---

# 23. Gunakan Distinct Jika Butuh Data Unik

## Contoh

```ts
const cities = await prisma.user.findMany({
  distinct: ['city'],
  select: {
    city: true,
  },
});
```

## Prinsip

Jika butuh data unik berdasarkan field tertentu, gunakan `distinct`.

---

# 24. Repository Pattern

## Tujuan

Repository pattern digunakan agar query Prisma tidak tersebar di service.

## Contoh Repository

```ts
class BrandRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByCompany(companyId: string) {
    return this.prisma.brand.findMany({
      where: {
        companyId,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
      },
    });
  }

  deleteManyWithoutProducts(companyId: string, ids: string[]) {
    return this.prisma.brand.deleteMany({
      where: {
        companyId,
        id: {
          in: ids,
        },
        products: {
          none: {},
        },
      },
    });
  }
}
```

## Prinsip

Service mengatur alur bisnis. Repository mengatur detail query.

---

# 25. Service Layer

## Contoh Service yang Baik

```ts
async bulkDelete(companyId: string, ids: string[]) {
  const [skippedBrands, deleteResult] = await this.prisma.$transaction([
    this.repo.findManyWithProducts(companyId, ids),
    this.repo.deleteManyWithoutProducts(companyId, ids),
  ]);

  return {
    count: deleteResult.count,
    skipped: skippedBrands.map((brand) => brand.name),
  };
}
```

## Prinsip

Service boleh melakukan formatting response, tetapi jangan memindahkan logic query yang bisa dilakukan database ke service.

---

# Checklist Query Prisma

Gunakan checklist ini sebelum menulis atau mereview query.

## Filtering

- [ ] Apakah filtering sudah dilakukan di `where`?
- [ ] Apakah masih ada `.filter()` yang seharusnya bisa masuk ke query?
- [ ] Apakah ownership seperti `companyId` sudah masuk ke query?
- [ ] Apakah soft delete seperti `deletedAt: null` sudah diterapkan?

## Field Selection

- [ ] Apakah sudah menggunakan `select`?
- [ ] Apakah field yang diambil hanya yang dibutuhkan?
- [ ] Apakah `include` digunakan hanya jika perlu?

## Relasi

- [ ] Apakah pengecekan relasi sudah memakai `some`, `none`, atau `every`?
- [ ] Apakah ada loop untuk mengecek relasi yang bisa diganti relation filter?
- [ ] Apakah query relasi berpotensi menjadi N+1 query?

## Bulk Operation

- [ ] Apakah insert massal memakai `createMany`?
- [ ] Apakah update massal memakai `updateMany`?
- [ ] Apakah delete massal memakai `deleteMany`?
- [ ] Apakah kondisi `where` pada bulk operation sudah lengkap?

## Pagination

- [ ] Apakah endpoint list memakai `skip` dan `take`?
- [ ] Apakah pagination memakai `orderBy`?
- [ ] Apakah total data dihitung dengan `count`?

## Transaction

- [ ] Apakah beberapa query yang saling terkait sudah dibungkus transaction?
- [ ] Apakah data bisa menjadi tidak konsisten jika salah satu query gagal?

## Aggregate

- [ ] Apakah perhitungan jumlah data memakai `count`?
- [ ] Apakah total, average, min, max memakai `aggregate`?
- [ ] Apakah rekap data memakai `groupBy`?

---

# Ringkasan Aturan

1. Jangan ambil semua data lalu filter manual di service.
2. Gunakan `where` untuk filtering.
3. Gunakan `select` untuk membatasi field.
4. Gunakan `include` hanya jika benar-benar butuh relasi.
5. Gunakan `some`, `none`, dan `every` untuk filter berdasarkan relasi.
6. Gunakan `count`, `aggregate`, dan `groupBy` untuk perhitungan data.
7. Gunakan `createMany`, `updateMany`, dan `deleteMany` untuk operasi massal.
8. Gunakan `transaction` untuk proses yang harus konsisten.
9. Gunakan `companyId` langsung di query untuk validasi ownership.
10. Gunakan pagination dan `orderBy` untuk endpoint list.
11. Jangan lakukan query di dalam loop jika bisa digabungkan.
12. Service boleh formatting response, tetapi query logic sebaiknya tetap di repository atau Prisma query.

---

# Prompt Singkat untuk AI Assistant

Gunakan prompt berikut jika ingin meminta AI assistant mereview atau memperbaiki query Prisma.

```text
Review query Prisma saya.

Fokus pada:
- apakah filtering sudah dilakukan di query, bukan manual di service
- apakah perlu menggunakan select atau include
- apakah ada potensi N+1 query
- apakah pengecekan relasi bisa memakai some, none, atau every
- apakah bulk operation bisa memakai createMany, updateMany, atau deleteMany
- apakah perlu transaction
- apakah pagination sudah menggunakan skip, take, dan orderBy
- apakah count, aggregate, atau groupBy lebih cocok daripada proses manual di JavaScript
- apakah companyId atau ownership sudah difilter langsung di query

Berikan versi query yang lebih clean, aman, dan efisien menggunakan Prisma.
```
