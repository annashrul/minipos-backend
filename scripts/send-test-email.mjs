// Kirim email tes memakai kredensial OAuth2 di .env (Gmail API, HTTP).
// Jalankan: node -r dotenv/config scripts/send-test-email.mjs <tujuan>
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const to = process.argv[2] || "bagoy1997@gmail.com";
const {
  GMAIL_SENDER,
  GMAIL_SENDER_NAME,
  GMAIL_OAUTH_CLIENT_ID,
  GMAIL_OAUTH_CLIENT_SECRET,
  GMAIL_OAUTH_REFRESH_TOKEN,
} = process.env;

if (
  !GMAIL_SENDER ||
  !GMAIL_OAUTH_CLIENT_ID ||
  !GMAIL_OAUTH_CLIENT_SECRET ||
  !GMAIL_OAUTH_REFRESH_TOKEN
) {
  console.error("ENV email belum lengkap. Cek .env.");
  process.exit(1);
}

async function getToken() {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GMAIL_OAUTH_CLIENT_ID,
      client_secret: GMAIL_OAUTH_CLIENT_SECRET,
      refresh_token: GMAIL_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Refresh token gagal ${res.status}: ${text}`);
  return JSON.parse(text).access_token;
}

function buildRaw() {
  const from = GMAIL_SENDER_NAME
    ? `${GMAIL_SENDER_NAME} <${GMAIL_SENDER}>`
    : GMAIL_SENDER;
  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#1a1a1a">` +
    `<h2 style="margin:0 0 12px">Halo dari MenoPOS 👋</h2>` +
    `<p>Ini email tes pengiriman via <b>Gmail API</b> dari MenoPOS yang berjalan di Google Cloud Run.</p>` +
    `<p>Kalau kamu menerima email ini, berarti konfigurasi email sudah berhasil. 🎉</p>` +
    `<hr style="border:none;border-top:1px solid #eee;margin:16px 0" />` +
    `<p style="color:#888;font-size:12px">Email otomatis — mohon tidak membalas.</p>` +
    `</div>`;
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: Tes Email MenoPOS`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const b64 = Buffer.from(html, "utf8").toString("base64");
  const body = (b64.match(/.{1,76}/g) ?? []).join("\r\n");
  const mime = headers.join("\r\n") + "\r\n\r\n" + body;
  return Buffer.from(mime, "utf8").toString("base64url");
}

const token = await getToken();
const res = await fetch(SEND_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ raw: buildRaw() }),
});
const text = await res.text();
if (!res.ok) {
  console.error(`Gmail API gagal ${res.status}: ${text}`);
  process.exit(1);
}
console.log(`Terkirim ke ${to}. messageId=${JSON.parse(text).id}`);
