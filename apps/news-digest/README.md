# news-digest

Daily news digest, posted as two Telegram messages to the same group chat as spending-bot:
- **VN** - Vietnamese news (VnExpress per-topic RSS)
- **ENG** - global news (BBC per-topic RSS)

Topic focus (both buckets): **finance · tech · politics · health**.

Runs on GitHub Actions at 09:00 Asia/Ho_Chi_Minh, started by a Cloudflare Worker cron (`trigger/`).
It sends as `@nth1bot`, the same bot as spending-bot, which is already in the group.

## Architecture

```
Cloudflare cron 02:00 UTC (trigger/)
  → GitHub API workflow_dispatch → digest.yml (starts within seconds)
  ├── VN bucket
  │     feedparser × 4 topic feeds (kinh-doanh, so-hoa, thoi-su, suc-khoe)
  │     → up to 6-8 recent candidates per feed → merge → dedupe by URL
  │     → httpx + trafilatura (concurrent body extraction, retries on 5xx/429)
  │     → Gemini 3.8 Flash (falls back to 3.6 / 2.5 Flash) picks the TOP_N most important, topic-balanced,
  │       and summarizes them (Vietnamese prompt, schema-enforced JSON)
  │     → Telegram HTML message (chunked if >4000 chars)
  └── ENG bucket (same flow, BBC business/tech/world/health, English prompt)
```

Buckets isolated: one failure doesn't block the other.

### Why a Cloudflare trigger

GitHub's own `schedule:` ran 5.5-6.5 hours late every day, so the digest landed around 15:00 ICT.
Cloudflare crons fire on time, and a dispatched run starts within seconds.
`digest.yml` still has a `schedule:` at 02:30 UTC as a fallback.
Its `guard` job skips the run if a run on `main` today (ICT) already succeeded or is in progress, so a working trigger never causes a duplicate post.
If the dispatch fails or the dispatched run fails, the fallback still posts, just late.

## Setup

### 1. Telegram bot + chat id

The digest posts to the spending-bot group (`ALLOWED_CHAT_ID` in `apps/spending-bot/wrangler.toml`).
The chat id is set as plain env in `.github/workflows/digest.yml`, since it is not a secret.
`TELEGRAM_BOT_TOKEN` is spending-bot's token (`@nth1bot`); sending messages does not interfere with its webhook.

For local runs, use your own chat id so tests don't land in the group:

```bash
# DM the bot any message first
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
```

### 2. Gemini API key

Get one free at https://aistudio.google.com/app/apikey.

### 3. Local test

```bash
cd apps/news-digest
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # fill in the key, token and your own chat id
set -a && source .env && set +a
python -m src.main
```

### 4. Deploy to GitHub Actions

```bash
# Workflow lives at the repo root: .github/workflows/digest.yml
gh secret set GEMINI_API_KEY --body "$GEMINI_API_KEY"
gh secret set TELEGRAM_BOT_TOKEN --body "$TELEGRAM_BOT_TOKEN"
gh workflow run daily-news-digest
```

### 5. Trigger Worker

`trigger/` is a Cloudflare Worker that deploys from `.github/workflows/news-digest-trigger.yml` on every push to `main` that touches it, after tests pass.
It needs one secret: a fine-grained GitHub token limited to this repo, with **Actions: Read and write**.

```bash
cd apps/news-digest/trigger
npm ci
npx wrangler secret put GITHUB_TOKEN    # paste the fine-grained token
npm test
```

Check it in the Cloudflare dashboard under Workers → news-digest-trigger → Logs, or run `npx wrangler tail`.
To try it locally, put a token in `.dev.vars`, run `npm run dev`, then open `http://localhost:8787/__scheduled`.
This dispatches the real workflow, which posts to the group.

## Config (env vars)

| Var | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | - | required |
| `TELEGRAM_BOT_TOKEN` | - | required |
| `TELEGRAM_CHAT_ID` | - | required; the group id in CI |
| `RSS_URLS_VN` | VnExpress kinh-doanh/so-hoa/thoi-su/suc-khoe | comma-separated, optional `url\|cap` (cap = candidates pulled, default 6) |
| `RSS_URLS_ENG` | BBC business/technology/world/health + HN | comma-separated, optional `url\|cap` |
| `TOP_N` | 7 | stories Gemini picks per bucket |
| `GEMINI_MODELS` | `gemini-3.8-flash,gemini-3.6-flash,gemini-2.5-flash` | tried in order, next one after 3 failed attempts (3.8 Flash often returns 503 under load); all free tier, Pro models have no free quota |
| `LOOKBACK_HOURS` | 24 | window size |

## Default feeds

**VN (VnExpress):**
- `https://vnexpress.net/rss/kinh-doanh.rss` (finance, 8)
- `https://vnexpress.net/rss/so-hoa.rss` (tech, 8)
- `https://vnexpress.net/rss/thoi-su.rss` (politics/current affairs, 8)
- `https://vnexpress.net/rss/suc-khoe.rss` (health, 6)

**ENG (BBC + Hacker News):**
- `http://feeds.bbci.co.uk/news/business/rss.xml` (finance, 8)
- `http://feeds.bbci.co.uk/news/technology/rss.xml` (tech, 6)
- `https://news.ycombinator.com/rss` (HN front page, 6)
- `http://feeds.bbci.co.uk/news/world/rss.xml` (politics, 8)
- `http://feeds.bbci.co.uk/news/health/rss.xml` (health, 6)

The number is how many recent candidates each feed contributes.
Gemini then picks the most important `TOP_N` across all of them, aiming for about 2 finance, 2 tech, 2 politics and 1 health, and skipping celebrity, lifestyle and promotional pieces.

## Notes

- When the fine-grained token expires, dispatches fail with 401 and the late fallback takes over; rotate it with `wrangler secret put GITHUB_TOKEN`.
- Two Gemini calls per day (more on retries or fallback), well within the free tier.
- No cross-day dedupe yet; daily 24h window naturally minimizes overlap.
- To customize: set `RSS_URLS_VN` or `RSS_URLS_ENG` in `.env` or workflow env.
