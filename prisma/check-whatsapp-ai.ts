import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const configs = await prisma.whatsappBotConfig.findMany({
    select: {
      enabled: true,
      model: true,
      replyThrottleSec: true,
      ownerPhones: true,
      knowledge: true,
      updatedAt: true,
      company: { select: { name: true, businessUnit: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (configs.length === 0) {
    console.log("Belum ada WhatsApp bot config tersimpan di DB.");
    console.log(
      "Default model yang akan dipakai: env WHATSAPP_BOT_MODEL (fallback openai/gpt-oss-20b)",
    );
    return;
  }

  console.log(`\nTotal config: ${configs.length}\n`);
  console.log("=".repeat(90));

  // Group by model untuk lihat distribusi
  const byModel = new Map<string, number>();
  for (const c of configs) {
    byModel.set(c.model, (byModel.get(c.model) ?? 0) + 1);
  }

  console.log("Distribusi model:");
  for (const [m, n] of byModel) {
    console.log(`  ${m.padEnd(45)} : ${n} company`);
  }
  console.log("=".repeat(90));
  console.log("\nDetail per company:");

  for (const c of configs) {
    console.log(`\n[${c.company?.name ?? "??"} · ${c.company?.businessUnit ?? "-"}]`);
    console.log(`  enabled       : ${c.enabled ? "✓ ON" : "✗ off"}`);
    console.log(`  model         : ${c.model}`);
    console.log(`  throttle      : ${c.replyThrottleSec}s`);
    console.log(`  owner phones  : ${c.ownerPhones.length > 0 ? c.ownerPhones.join(", ") : "(none)"}`);
    console.log(
      `  knowledge     : ${
        c.knowledge ? `${c.knowledge.length} chars` : "(empty)"
      }`,
    );
    console.log(`  updated       : ${c.updatedAt.toISOString().slice(0, 16)}`);
  }

  // Cross-reference: cek apakah model yang dipakai masih ADA di Groq dan bisa
  // tool-calling reliable.
  //
  // Daftar di bawah diverifikasi lewat GET https://api.groq.com/openai/v1/models.
  // Kalau Groq menambah/menghapus model lagi, update di sini + di
  // backend/src/common/ai/ai-models.ts (DEFAULTS) + .env.
  const TOOL_RELIABLE = new Set([
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
  ]);
  // Ada di Groq, tapi reasoning model — untuk tool-calling wajib
  // reasoning_effort="none" (sudah ditangani safeReasoningEffort()).
  const TOOL_QUIRKY = new Set(["qwen/qwen3.8-27b", "qwen/qwen3.6-27b"]);
  // Sudah DIHAPUS Groq — request-nya balas HTTP 404/400.
  const DECOMMISSIONED = new Set([
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "llama3-8b-8192",
    "qwen/qwen3-32b",
    "moonshotai/kimi-k2-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
  ]);

  const warnings: string[] = [];
  for (const c of configs) {
    if (DECOMMISSIONED.has(c.model)) {
      warnings.push(
        `⚠️  ${c.company?.name}: model "${c.model}" sudah DIHAPUS Groq (HTTP 404). Ganti ke openai/gpt-oss-120b.`,
      );
    } else if (TOOL_QUIRKY.has(c.model)) {
      warnings.push(
        `ℹ️  ${c.company?.name}: model "${c.model}" adalah reasoning model — pastikan reasoning_effort="none". Recommended: openai/gpt-oss-120b.`,
      );
    } else if (!TOOL_RELIABLE.has(c.model)) {
      warnings.push(
        `ℹ️  ${c.company?.name}: model "${c.model}" tidak ada di daftar terverifikasi. Cek GET https://api.groq.com/openai/v1/models.`,
      );
    }
  }
  if (warnings.length > 0) {
    console.log("\n" + "=".repeat(90));
    console.log("Warnings:");
    for (const w of warnings) console.log(`  ${w}`);
  }
}

main().finally(() => prisma.$disconnect());
