/**
 * Idempotent seed: create / refresh kedua akun admin tingkat tertinggi:
 *  1. PLATFORM_OWNER  → owner@platform.local
 *  2. SUPER_ADMIN     → admin@pos.local (terkait Company "Demo Store")
 *
 * Jalankan: pnpm tsx prisma/seed-admin-accounts.ts
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PLATFORM_OWNER_EMAIL = "owner@platform.local";
const PLATFORM_OWNER_PASSWORD = "Owner@2026";
const SUPER_ADMIN_EMAIL = "admin@pos.local";
const SUPER_ADMIN_PASSWORD = "Admin@2026";

async function ensurePlatformOwner() {
  const hashed = await bcrypt.hash(PLATFORM_OWNER_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: PLATFORM_OWNER_EMAIL },
    update: {
      role: "PLATFORM_OWNER",
      name: "Platform Owner",
      password: hashed,
      companyId: null,
      branchId: null,
      isActive: true,
      emailVerified: true,
    },
    create: {
      email: PLATFORM_OWNER_EMAIL,
      name: "Platform Owner",
      password: hashed,
      role: "PLATFORM_OWNER",
      companyId: null,
      branchId: null,
      isActive: true,
      emailVerified: true,
    },
  });
  return user;
}

async function ensureDemoCompany() {
  return prisma.company.upsert({
    where: { slug: "demo-store" },
    update: {},
    create: {
      name: "Demo Store",
      slug: "demo-store",
      email: "contact@demo-store.local",
      phone: "021-1234567",
      address: "Jakarta, Indonesia",
      isActive: true,
    },
  });
}

async function ensureSuperAdmin(companyId: string) {
  const hashed = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: {
      role: "SUPER_ADMIN",
      name: "Super Admin",
      password: hashed,
      companyId,
      branchId: null,
      isActive: true,
      emailVerified: true,
    },
    create: {
      email: SUPER_ADMIN_EMAIL,
      name: "Super Admin",
      password: hashed,
      role: "SUPER_ADMIN",
      companyId,
      branchId: null,
      isActive: true,
      emailVerified: true,
    },
  });
  return user;
}

async function main() {
  const [platformOwner, company] = await Promise.all([
    ensurePlatformOwner(),
    ensureDemoCompany(),
  ]);
  const superAdmin = await ensureSuperAdmin(company.id);

  console.log("\n========================================");
  console.log(" PLATFORM OWNER");
  console.log("========================================");
  console.log(` ID         : ${platformOwner.id}`);
  console.log(` Email      : ${PLATFORM_OWNER_EMAIL}`);
  console.log(` Password   : ${PLATFORM_OWNER_PASSWORD}`);
  console.log(` Role       : ${platformOwner.role}`);
  console.log("\n========================================");
  console.log(" SUPER ADMIN");
  console.log("========================================");
  console.log(` ID         : ${superAdmin.id}`);
  console.log(` Email      : ${SUPER_ADMIN_EMAIL}`);
  console.log(` Password   : ${SUPER_ADMIN_PASSWORD}`);
  console.log(` Role       : ${superAdmin.role}`);
  console.log(` Company    : ${company.name} (${company.slug})`);
  console.log(` CompanyId  : ${company.id}`);
  console.log("========================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
