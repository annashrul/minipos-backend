// Generator no transaksi format konsisten lintas-module:
//   XX-YYYYMMDD-NNNN
// XX = prefix (BL, GR, INV, OP, TR, dll), NNNN = sequence 4-digit
// zero-padded yang reset per (company, tanggal). Caller wires-in fungsi
// `countToday` (untuk hitung jumlah row hari ini) dan opsional `exists`
// (untuk verifikasi unique pre-insert) supaya utility ini agnostic
// terhadap Prisma model spesifik.

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad4(n: number): string {
  return n.toString().padStart(4, "0");
}

function todayCompactStr(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

function randomHex(length: number): string {
  const chars = "0123456789ABCDEF";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export interface NextDocumentNumberParams {
  /** Prefix (mis. "BL", "GR", "INV", "OP", "TR"). */
  prefix: string;
  /** Tanggal yang dipakai di middle bagian. Default: today. */
  date?: Date;
  /**
   * Function balikkan COUNT dokumen di tabel target untuk (company, today).
   * Dipakai sebagai seed sequence. Caller wire ke Prisma count query yg sesuai.
   */
  countToday: () => Promise<number>;
  /**
   * Optional. Cek apakah candidate sudah ada (unique check) sebelum return.
   * Berguna untuk handle race condition. Kalau tidak di-pass, langsung return
   * `prefix-date-(count+1)` tanpa verifikasi.
   */
  exists?: (candidate: string) => Promise<boolean>;
  /** Max retry kalau collision (default 5). */
  maxRetry?: number;
}

/**
 * Generate next document number dengan format `XX-YYYYMMDD-NNNN`.
 * Sequence per company per tanggal — caller harus scope `countToday` &
 * `exists` ke (companyId, today range).
 *
 * @example
 * await nextDocumentNumber({
 *   prefix: "BL",
 *   countToday: () => prisma.purchaseOrder.count({
 *     where: { companyId, createdAt: { gte: startOfDay, lt: endOfDay } },
 *   }),
 *   exists: (n) => prisma.purchaseOrder.findFirst({
 *     where: { companyId, purchaseTransactionNumber: n },
 *     select: { id: true },
 *   }).then((r) => !!r),
 * });
 */
export async function nextDocumentNumber({
  prefix,
  date = new Date(),
  countToday,
  exists,
  maxRetry = 5,
}: NextDocumentNumberParams): Promise<string> {
  const yyyymmdd = todayCompactStr(date);
  const cleanPrefix = prefix.replace(/[^A-Z0-9]/gi, "").toUpperCase() || "DOC";
  const baseCount = await countToday();
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    const seq = baseCount + 1 + attempt;
    const candidate = `${cleanPrefix}-${yyyymmdd}-${pad4(seq)}`;
    if (!exists) return candidate;
    const isExisting = await exists(candidate);
    if (!isExisting) return candidate;
  }
  // Fallback: append randomHex untuk kasus extreme race / count drift.
  return `${cleanPrefix}-${yyyymmdd}-${randomHex(4)}`;
}

/**
 * Helper untuk dapatkan rentang start..end of day (UTC-safe local) dari
 * tanggal yang di-pass. Dipakai oleh caller yg butuh `where.createdAt`.
 */
export function dayRange(date: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  );
  return { start, end };
}
