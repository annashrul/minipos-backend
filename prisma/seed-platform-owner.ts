import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "owner@platform.local";
  const password = "Owner@2026";
  const name = "Platform Owner";

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: "PLATFORM_OWNER",
      name,
      password: hashed,
      companyId: null,
      branchId: null,
      isActive: true,
      emailVerified: true,
    },
    create: {
      email,
      name,
      password: hashed,
      role: "PLATFORM_OWNER",
      companyId: null,
      branchId: null,
      isActive: true,
      emailVerified: true,
    },
  });

  console.log("\n========================================");
  console.log("PLATFORM OWNER ACCOUNT READY");
  console.log("========================================");
  console.log(`ID         : ${user.id}`);
  console.log(`Email      : ${email}`);
  console.log(`Password   : ${password}`);
  console.log(`Role       : ${user.role}`);
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
