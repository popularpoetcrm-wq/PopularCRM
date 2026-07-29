#!/usr/bin/env node
/**
 * Local Telegram poller — ONLY for localhost dev.
 * On production, setWebhook to https://popularcrm.vercel.app/api/v1/webhooks/telegram
 * and do NOT run this script (it deletes the webhook).
 *
 * Usage: node --env-file=.env.local scripts/tg-poll.mjs
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const token = process.env.TELEGRAM_BOT_TOKEN;
const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN missing");
  process.exit(1);
}

if (!base.includes("localhost") && !base.includes("127.0.0.1")) {
  console.error(
    "Refusing to poll: NEXT_PUBLIC_APP_URL is not localhost.\n" +
      "Production must use setWebhook, not this poller.",
  );
  process.exit(1);
}

let offset = 0;
console.log("Polling @" + (process.env.TELEGRAM_BOT_USERNAME || "bot"));
console.log("Forward →", base + "/api/v1/webhooks/telegram");
console.warn("NOTE: deleteWebhook — stop this before enabling prod webhook.");

await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ drop_pending_updates: false }),
});

while (true) {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`,
  );
  const json = await res.json();
  if (!json.ok) {
    console.error(json);
    await new Promise((r) => setTimeout(r, 2000));
    continue;
  }
  for (const update of json.result ?? []) {
    offset = update.update_id + 1;
    console.log("update", update.update_id, update.message?.text);
    const fwd = await fetch(`${base}/api/v1/webhooks/telegram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    const body = await fwd.text();
    console.log("→", fwd.status, body.slice(0, 200));
  }
}
