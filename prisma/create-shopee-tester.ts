import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const EMAIL = "shopee-tester@menopos.com";
const NAME = "Shopee Tester";
const PASSWORD = "ShopeeTest!AMpvKdU9q9TS26rm";
const ROLE = "SUPER_ADMIN";

async function main() {
  const company = await prisma.company.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (!company) {
    throw new Error(
      "Tidak ada Company di DB. Seed dulu (pnpm db:seed) sebelum create tester.",
    );
  }

  const hashed = await bcrypt.hash(PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {
      password: hashed,
      role: ROLE,
      isActive: true,
      companyId: company.id,
    },
    create: {
      name: NAME,
      email: EMAIL,
      password: hashed,
      role: ROLE,
      companyId: company.id,
      isActive: true,
    },
  });

  console.log("=".repeat(60));
  console.log("Shopee tester account siap.");
  console.log("=".repeat(60));
  console.log("Email   :", user.email);
  console.log("Password:", PASSWORD);
  console.log("Role    :", user.role);
  console.log("Company :", company.name, `(${company.id})`);
  console.log("User ID :", user.id);
  console.log("=".repeat(60));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
