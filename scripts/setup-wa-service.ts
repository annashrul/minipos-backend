// One-shot setup script untuk wa-service credentials per company.
//
// Pakai:
//   pnpm exec tsx scripts/setup-wa-service.ts list
//     → list semua company + status wa-service-nya
//
//   pnpm exec tsx scripts/setup-wa-service.ts set <companyId> <tenantId> <apiKey> <webhookSecret>
//     → upsert credentials untuk company tertentu, validasi dulu via /api/me
//
//   pnpm exec tsx scripts/setup-wa-service.ts clear <companyId>
//     → kosongkan credentials untuk company

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function listCompanies() {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const sessions = await prisma.whatsappSession.findMany({
    where: {
      OR: [
        { waServiceTenantId: { not: null } },
        { waServiceApiKey: { not: null } },
      ],
    },
    select: {
      companyId: true,
      waServiceTenantId: true,
      status: true,
      phoneNumber: true,
    },
  });
  const sessMap = new Map(sessions.map((s) => [s.companyId, s]));

  console.log(
    `\n${companies.length} company(s) di DB minipos:\n`,
  );
  for (const c of companies) {
    const sess = sessMap.get(c.id);
    const tag = sess
      ? `[CONFIGURED → tenant ${sess.waServiceTenantId} · ${sess.status}${
          sess.phoneNumber ? ` · ${sess.phoneNumber}` : ""
        }]`
      : "[not set up]";
    console.log(`  ${c.id}  ${c.name.padEnd(40)} ${tag}`);
  }
  console.log();
}

async function setCredentials(
  companyId: string,
  tenantId: string,
  apiKey: string,
  webhookSecret: string,
) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true },
  });
  if (!company) {
    throw new Error(`Company ${companyId} tidak ditemukan di minipos DB`);
  }

  // Validasi via wa-service /api/me
  const waUrl = (process.env.WA_SERVICE_URL ?? "").replace(/\/$/, "");
  if (!waUrl) throw new Error("WA_SERVICE_URL belum di-set di .env");

  const res = await fetch(`${waUrl}/api/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(
      `Validasi gagal: wa-service /api/me return ${res.status} ${await res.text()}`,
    );
  }
  const me = (await res.json()).data as {
    id: string;
    name: string;
    status: string;
  };
  if (me.id !== tenantId) {
    throw new Error(
      `Tenant ID mismatch — apiKey milik tenant "${me.id}" (${me.name}), bukan "${tenantId}"`,
    );
  }
  if (me.status !== "ACTIVE") {
    throw new Error(
      `Tenant "${me.name}" status ${me.status} di wa-service. Activate dulu.`,
    );
  }

  await prisma.whatsappSession.upsert({
    where: { companyId },
    create: {
      companyId,
      waServiceTenantId: tenantId,
      waServiceApiKey: apiKey,
      waServiceWebhookSecret: webhookSecret,
    },
    update: {
      waServiceTenantId: tenantId,
      waServiceApiKey: apiKey,
      waServiceWebhookSecret: webhookSecret,
    },
  });

  console.log(
    `\n✓ Credentials wa-service ter-setup untuk company "${company.name}" (${companyId})`,
  );
  console.log(`  → tenant: ${me.name} (${tenantId})\n`);
}

async function clearCredentials(companyId: string) {
  await prisma.whatsappSession.updateMany({
    where: { companyId },
    data: {
      waServiceTenantId: null,
      waServiceApiKey: null,
      waServiceWebhookSecret: null,
    },
  });
  console.log(`\n✓ Credentials cleared untuk company ${companyId}\n`);
}

async function main() {
  const [, , cmd, ...args] = process.argv;
  switch (cmd) {
    case "list":
      await listCompanies();
      break;
    case "set":
      if (args.length !== 4) {
        console.error(
          "Usage: pnpm exec tsx scripts/setup-wa-service.ts set <companyId> <tenantId> <apiKey> <webhookSecret>",
        );
        process.exit(1);
      }
      await setCredentials(args[0]!, args[1]!, args[2]!, args[3]!);
      break;
    case "clear":
      if (args.length !== 1) {
        console.error(
          "Usage: pnpm exec tsx scripts/setup-wa-service.ts clear <companyId>",
        );
        process.exit(1);
      }
      await clearCredentials(args[0]!);
      break;
    default:
      console.log(
        "Commands: list | set <companyId> <tenantId> <apiKey> <webhookSecret> | clear <companyId>",
      );
      process.exit(cmd ? 1 : 0);
  }
}

main()
  .catch((err) => {
    console.error("✗", (err as Error).message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
