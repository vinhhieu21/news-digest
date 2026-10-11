# telegram-bot

Personal Telegram bots, one folder per service. They share no code. Each app has its own runtime, dependencies, deploy and README.

| App | What it does | Runtime | Schedule / trigger |
|---|---|---|---|
| [`apps/news-digest`](apps/news-digest) | Daily VN + global news digest, summarised by Gemini, sent to a private chat | Python 3.11 on GitHub Actions | 09:00 ICT daily (`.github/workflows/digest.yml`) |
| [`apps/spending-bot`](apps/spending-bot) | Group spending tracker: `/add`, `/check`, `/summary`, `/undo`, `/daily` | TypeScript on Cloudflare Workers + D1 | Telegram webhook; crons at 21:00 ICT and 09:00 ICT on the 1st |

## Layout

```
.github/
  workflows/digest.yml        news-digest daily run
  workflows/spending-bot.yml  spending-bot typecheck + tests, deploy on main
  workflows/keepalive.yml     keeps scheduled workflows from being auto-paused
  dependabot.yml              actions, pip (news-digest), npm (spending-bot)
apps/
  news-digest/
  spending-bot/
```

## Deploys

- **news-digest:** runs from GitHub Actions. The secrets are `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- **spending-bot:** deploys from GitHub Actions on every push to `main` that touches `apps/spending-bot`, after tests pass.
  GitHub holds only the `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` variable.
  The bot's own secrets live in Cloudflare (`wrangler secret put`), not in GitHub.
