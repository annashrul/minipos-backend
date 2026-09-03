import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// ID model yang sudah DIHAPUS provider (Groq balas HTTP 404/400). Row
// WhatsappBotConfig yang masih menyimpan salah satu ID ini membuat chatbot WA
// gagal balas — sekarang backend punya fallback otomatis, tapi lebih baik
// datanya ikut dibersihkan supaya UI tidak menampilkan pilihan mati.
//
// Verifikasi: GET https://api.groq.com/openai/v1/models
const DEAD_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-70b-8192",
  "llama3-8b-8192",
  "qwen/qwen3-32b",
  "moonshotai/kimi-k2-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
];
const TARGET_MODEL = "openai/gpt-oss-120b";

async function main() {
  // Update semua row WhatsappBotConfig yang masih pakai model mati ke
  // openai/gpt-oss-120b (masih hidup & tool-calling reliable).
  const before = await prisma.whatsappBotConfig.findMany({
    select: {
      company: { select: { name: true } },
      model: true,
    },
    where: { model: { in: DEAD_MODELS } },
  });

  if (before.length === 0) {
    console.log("Semua config sudah pakai model yang masih hidup. Nothing to do.");
    return;
  }

  console.log("Akan update config berikut:");
  for (const c of before) {
    console.log(`  ${c.company?.name}: ${c.model} → ${TARGET_MODEL}`);
  }

  const result = await prisma.whatsappBotConfig.updateMany({
    where: { model: { in: DEAD_MODELS } },
    data: { model: TARGET_MODEL },
  });
  console.log(`\n${result.count} row updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
