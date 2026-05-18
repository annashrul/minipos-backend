import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Update semua row WhatsappBotConfig yang masih pakai Llama-3 family
  // ke openai/gpt-oss-120b (tool-calling reliable).
  const before = await prisma.whatsappBotConfig.findMany({
    select: {
      company: { select: { name: true } },
      model: true,
    },
    where: {
      model: {
        in: [
          "llama-3.3-70b-versatile",
          "llama-3.1-70b-versatile",
          "llama-3.1-8b-instant",
          "llama3-70b-8192",
          "llama3-8b-8192",
        ],
      },
    },
  });

  if (before.length === 0) {
    console.log("Semua config sudah pakai non-Llama model. Nothing to do.");
    return;
  }

  console.log("Akan update config berikut:");
  for (const c of before) {
    console.log(`  ${c.company?.name}: ${c.model} → openai/gpt-oss-120b`);
  }

  const result = await prisma.whatsappBotConfig.updateMany({
    where: {
      model: {
        in: [
          "llama-3.3-70b-versatile",
          "llama-3.1-70b-versatile",
          "llama-3.1-8b-instant",
          "llama3-70b-8192",
          "llama3-8b-8192",
        ],
      },
    },
    data: { model: "openai/gpt-oss-120b" },
  });
  console.log(`\n${result.count} row updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
