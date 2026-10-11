// One-off setup: registers the webhook and the command menu.
//
//   BOT_TOKEN=... WEBHOOK_SECRET=... WORKER_URL=https://spending-bot.<you>.workers.dev \
//   [ALLOWED_CHAT_ID=-100...] node scripts/setup-telegram.mjs
//
// Without ALLOWED_CHAT_ID the command menu is registered for all group chats;
// re-run with it once the group id is known to scope the menu to that group.

const { BOT_TOKEN, WEBHOOK_SECRET, WORKER_URL, ALLOWED_CHAT_ID } = process.env;
if (!BOT_TOKEN || !WEBHOOK_SECRET || !WORKER_URL) {
  console.error("BOT_TOKEN, WEBHOOK_SECRET and WORKER_URL are required");
  process.exit(1);
}

const COMMANDS = [
  { command: "add", description: "Ghi khoản chi: /add 50k cafe sáng" },
  { command: "check", description: "Tổng chi từ đầu tháng" },
  { command: "summary", description: "Tổng kết tháng: /summary 9" },
  { command: "undo", description: "Xoá khoản chi gần nhất, hoặc trả lời tin /add để xoá khoản đó" },
  { command: "daily", description: "Bật/tắt tổng kết hằng ngày: /daily on" },
  { command: "help", description: "Hướng dẫn" },
];

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.description}`);
  console.log(`${method}: ok`);
}

await call("setWebhook", {
  url: WORKER_URL,
  secret_token: WEBHOOK_SECRET,
  allowed_updates: ["message", "edited_message", "my_chat_member"],
  drop_pending_updates: true,
});

const scope = ALLOWED_CHAT_ID
  ? { type: "chat", chat_id: Number(ALLOWED_CHAT_ID) }
  : { type: "all_group_chats" };
await call("setMyCommands", { commands: COMMANDS, scope });
