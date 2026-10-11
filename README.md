# telegram-bot

Personal Telegram bots, one folder per service. They share no code. Each app has its own runtime, dependencies, deploy and README.

| App | What it does | Runtime | Schedule / trigger |
|---|---|---|---|
| [`apps/news-digest`](apps/news-digest) | Daily VN + global news digest, summarised by Gemini, sent to the spending-bot group | Python 3.11 on GitHub Actions, started by a Cloudflare Worker cron | 09:00 ICT daily (`apps/news-digest/trigger`) |
| [`apps/spending-bot`](apps/spending-bot) | Group spending tracker: `/add`, `/check`, `/summary`, `/undo`, `/daily` | TypeScript on Cloudflare Workers + D1 | Telegram webhook; crons at 21:00 ICT and 09:00 ICT on the 1st |

## Layout

```
.github/
  workflows/digest.yml               news-digest daily run (dispatched; guarded late fallback schedule)
  workflows/news-digest-trigger.yml  news-digest trigger Worker typecheck + tests, deploy on main
  workflows/spending-bot.yml         spending-bot typecheck + tests, deploy on main
  workflows/keepalive.yml            keeps scheduled workflows from being auto-paused
  dependabot.yml                     actions, pip (news-digest), npm (spending-bot, news-digest trigger)
apps/
  news-digest/
  spending-bot/
```

## Deploys

- **news-digest:** runs from GitHub Actions. The secrets are `GEMINI_API_KEY` and `TELEGRAM_BOT_TOKEN`; the group chat id is plain env in the workflow.
  Its trigger Worker (`apps/news-digest/trigger`) deploys like spending-bot and holds a `GITHUB_TOKEN` secret in Cloudflare.
- **spending-bot:** deploys from GitHub Actions on every push to `main` that touches `apps/spending-bot`, after tests pass.
  GitHub holds only the `CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` variable.
  The bot's own secrets live in Cloudflare (`wrangler secret put`), not in GitHub.
