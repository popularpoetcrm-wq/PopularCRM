#!/usr/bin/env node
/**
 * Local Telegram poller: forwards getUpdates to /api/v1/webhooks/telegram
 * (Telegram cannot reach localhost webhook).
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

let offset = 0;
console.log("Polling @" + (process.env.TELEGRAM_BOT_USERNAME || "bot"));
console.log("Forward →", base + "/api/v1/webhooks/telegram");

// clear webhook so getUpdates works
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
