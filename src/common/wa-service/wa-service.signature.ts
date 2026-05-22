import { createHmac, timingSafeEqual } from "crypto";

// Verifikasi HMAC SHA-256 signature dari header X-Wa-Signature.
// Format: "sha256=<hex>" — sama dengan yang di-emit wa-service.
// Wajib pakai raw body (string mentah), bukan parsed object,
// karena parsing JSON tidak deterministic untuk byte equality.
export function verifyWaSignature(
  rawBody: string,
  header: string | undefined,
  secret: string,
): boolean {
  if (!header) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
