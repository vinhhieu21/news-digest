# Telegram Spending Bot (v1)

A Telegram bot for one friend group. Members log spending with `/add`, check totals with `/check` and `/summary`, and get an automatic monthly summary. A nightly recap is optional. It runs on one Cloudflare Worker with D1 storage and costs nothing on the free tiers.

| Command | Example | What it does |
|---|---|---|
| `/add <amount> [note] [hôm qua \| dd/mm]` | `/add 50k cafe sáng` | Saves an expense for the sender. Editing the message updates it |
| `/check` | | Each member's total from the 1st of the month to today, plus today's group total, plus what is left of the budget when one is set |
| `/budget [amount\|off]` | `/budget 5tr` | Sets the group's monthly budget, shows spent and remaining this month, or removes it |
| `/summary [month] [year]` | `/summary 9` | Full summary for one month, with the change vs. the previous month and a breakdown by category |
| `/undo` | reply `/undo` to your `/add` | Soft-deletes the sender's most recent expense, or, sent as a reply to one of their own `/add` messages, that expense |
| `/daily on\|off` | | Turns the 21:00 ICT nightly recap on or off |
| `/help` | | Lists the commands |

Amounts: `50k`, `32.5k`, `1tr2` (1,200,000), `1.5tr`, `2m`, `1.250.000`, `50000`.
A space before the unit also works, e.g. `50 nghìn`, `2 tr`, `1,5 triệu`.
A bare number under 1,000 is rejected.
The valid range is 1,000đ to 100,000,000đ.

## Layout

```
wrangler.toml            D1 binding "DB", cron triggers, vars
migrations/*.sql
src/
  index.ts               fetch() = webhook, scheduled() = cron
  router.ts              chat filter, /cmd@Bot stripping, dispatch
  telegram.ts            sendMessage / leaveChat over fetch
  db.ts                  all SQL
  time.ts                ICT (UTC+7) date helpers
  parse/{amount,date,add}.ts
  commands/*.ts
  report/format.ts       VND formatting, HTML escaping, message templates
  jobs/{daily,monthly}.ts
  ai/llm.ts              Workers AI client (the only place that calls a model)
  ai/categories.ts       the fixed category list
  ai/categorize.ts       note -> category, cached per note in note_categories
  ai/commentary.ts       monthly commentary, checked against the SQL numbers
scripts/setup-telegram.mjs   setWebhook + setMyCommands
test/                    Vitest (unit + integration on local D1)
```

## Develop

```sh
npm install
npm test            # unit + integration (local D1, Telegram API mocked)
npm run typecheck
npm run types       # regenerate worker-configuration.d.ts after editing wrangler.toml
```

## Deploy

1. Create the bot with @BotFather (`/newbot`). Leave `/setprivacy` **Enabled**.
2. `npx wrangler login`
3. `npx wrangler d1 create spending-bot-db`, then paste the `database_id` into `wrangler.toml`.
4. `npm run db:migrate:remote` (run it again after pulling new files in `migrations/`)
5. `npx wrangler secret put BOT_TOKEN` and `npx wrangler secret put WEBHOOK_SECRET` (use 32+ random characters, e.g. `openssl rand -hex 32`).
6. Set `BOT_USERNAME` in `wrangler.toml` (without the `@`). Leave `ALLOWED_CHAT_ID` empty for now.
7. `npm run deploy`
8. Register the webhook and command menu:
   ```sh
   BOT_TOKEN=... WEBHOOK_SECRET=... WORKER_URL=https://spending-bot.<subdomain>.workers.dev npm run setup:telegram
   ```
   After upgrading an existing bot, re-run this once.
   Telegram only delivers message edits to webhooks registered with `edited_message`.
9. Run `npx wrangler tail`, add the bot to the group, and send `/help`. The log prints the group's `chat_id`, which is a negative number.
10. Put that id in `ALLOWED_CHAT_ID` in `wrangler.toml` and run `npm run deploy` again. Re-run step 8 with `ALLOWED_CHAT_ID=...` to scope the command menu to the group.

Test this in a private group with two accounts before you add the bot to the real group.

### Continuous deploy

After the first deploy, `.github/workflows/spending-bot.yml` applies remote D1 migrations and runs `wrangler deploy` on every push to `main` that touches this app, once typecheck and tests pass.
You can also start it by hand from the Actions tab (`workflow_dispatch`).
It needs, in the repo's `production` environment or repo settings:

- `CLOUDFLARE_API_TOKEN` secret: a Cloudflare API token with **Account > Workers Scripts > Edit** and **Account > D1 > Edit**.
- `CLOUDFLARE_ACCOUNT_ID` variable: the account id from `npx wrangler whoami`.

## LLM features (free, optional)

Two features use [Workers AI](https://developers.cloudflare.com/workers-ai/) through the `AI` binding. It needs no API key, and the Workers Free plan includes a daily allowance (10,000 Neurons, reset at 00:00 UTC). Past the allowance, requests fail instead of being billed. On Workers Paid, usage above the allowance is billed.

- **Categories.** After each `/add` the bot replies first. Then it asks the model to put the note into one of the fixed categories in `src/ai/categories.ts`. The answer is cached per note, so `cafe` is classified only once. If the call fails, the expense stays uncategorised and the daily cron retries it. `/summary` and the monthly summary show totals per category; anything not classified yet is listed as "Chưa phân loại".
- **Monthly commentary.** The monthly summary ends with 2–3 sentences from the model. The model only receives the totals computed in SQL. A reply that cites a number not in those totals is dropped. If the commentary fails, the summary is still sent, with a line saying the commentary is unavailable. `/summary` never calls the model for commentary.

The model is `LLM_MODEL` in `wrangler.toml` (default: `@cf/aisingapore/gemma-sea-lion-v4-27b-it`, a model tuned for Southeast Asian languages). Set it to `""` to switch both features off. Expense notes, member first names and totals are sent to Workers AI.

Tests stub `env.AI.run` (`remoteBindings: false` in `vitest.config.ts`), so they need no Cloudflare account. `wrangler dev` calls the real Workers AI and needs `wrangler login`.

## Behaviour notes

- Any request without the correct `X-Telegram-Bot-Api-Secret-Token` gets a 401. Once the secret is valid, the Worker always answers 200, so Telegram never retries and creates duplicates. Duplicate updates are also skipped through `processed_updates`, which the daily cron prunes after 7 days.
- Until `ALLOWED_CHAT_ID` is set, the bot only logs chat ids. After that it leaves every other group and answers DMs with a one-line notice.
- Cron schedules are in UTC: `0 14 * * *` is 21:00 ICT (the daily recap, sent only when it is on and there was spending today). `0 2 1 * *` is 09:00 ICT on the 1st (the monthly summary, always sent).
- Editing an `/add` message updates that expense (amount, note and date).
  Relative dates count from the day the message was sent, not the day it was edited.
  The expense is re-categorised when the note changed.
  If the original `/add` was rejected, the fixed edit records it.
  An invalid edit is answered with the error and the old entry is kept.
  An expense removed with `/undo` stays removed, and the bot says so.
  An edit that turns a plain message or another command into a valid `/add` records it.
  Any other edit that does not result in an `/add` (for example an `/add` changed into another command) is ignored.
- Defaults chosen from the plan's open decisions: replies in Vietnamese, any member can run `/daily`, and `/undo` removes your last entry whatever its age.
- A reply `/undo` only deletes an expense the sender recorded. Replying to anything else (someone else's `/add`, a non-expense message, an already deleted one) deletes nothing and says so. In forum topics, the implicit reply to the topic's opening message counts as a plain `/undo`.
- Monthly budget (`/budget`): only expenses dated in the current ICT month count.
  At 80% and 100% of the budget the bot posts one separate warning per level per month, after the `/add` reply.
  One expense that jumps past both levels gives a single 100% warning.
  Changing the budget treats levels already reached under the new amount as announced and re-arms the rest.
  `/budget off` clears everything, including the warning state.
  `/undo` does not re-arm warnings.
