import { PrismaClient } from "@prisma/client";

async function main() {
  const p = new PrismaClient();
  const row = await p.whatsappSession.findUnique({
    where: { companyId: "default-company-id" },
    select: {
      companyId: true,
      waServiceTenantId: true,
      waServiceApiKey: true,
      waServiceWebhookSecret: true,
      status: true,
      updatedAt: true,
    },
  });
  console.log(JSON.stringify(row, null, 2));
  await p.$disconnect();
}

main();
