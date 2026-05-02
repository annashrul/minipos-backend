import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Append-only JSON Lines logger untuk debug alur Baileys WhatsApp.
 * Setiap event = 1 baris JSON. File ditulis ke `<cwd>/logs/whatsapp-debug.jsonl`.
 *
 * Pakai untuk diagnosa sequence event tanpa noise dari log Nest umum.
 */
const LOG_FILE = resolve(process.cwd(), "logs", "whatsapp-debug.jsonl");
let dirReady = false;

async function ensureDir(): Promise<void> {
  if (dirReady) return;
  await mkdir(dirname(LOG_FILE), { recursive: true });
  dirReady = true;
}

export type WaDebugEvent = {
  event: string;
  companyId?: string | null;
  [k: string]: unknown;
};

export async function waDebugLog(payload: WaDebugEvent): Promise<void> {
  try {
    await ensureDir();
    const line =
      JSON.stringify({ ts: new Date().toISOString(), ...payload }) + "\n";
    await appendFile(LOG_FILE, line, { encoding: "utf8" });
  } catch {
    // Logger tidak boleh menggagalkan flow apapun.
  }
}

/** Versi sync-fire-and-forget — tidak block caller. */
export function waDebugLogSync(payload: WaDebugEvent): void {
  void waDebugLog(payload);
}
