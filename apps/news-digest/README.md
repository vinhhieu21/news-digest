# news-digest

Daily news digest, posted as two Telegram messages to the same group chat as spending-bot:
- **VN** - Vietnamese news (VnExpress per-topic RSS)
- **ENG** - global news (BBC per-topic RSS)

Topic focus (both buckets): **finance · tech · politics · health**.

Runs on GitHub Actions, scheduled for 09:00 Asia/Ho_Chi_Minh.
It sends as `@nth1bot`, the same bot as spending-bot, which is already in the group.

## Architecture

```
cron 02:00 UTC
  ├── VN bucket
  │     feedparser × 4 topic feeds (kinh-doanh, so-hoa, thoi-su, suc-khoe)
  │     → 2 per feed → merge → dedupe by URL → cap TOP_N
  │     → httpx + trafilatura (concurrent body extraction, retries on 5xx/429)
  │     → Gemini 2.5 Flash (Vietnamese prompt, JSON output)
  │     → Telegram HTML message (chunked if >4000 chars)
  └── ENG bucket (same flow, BBC business/tech/world/health, English prompt)
```

Buckets isolated: one failure doesn't block the other.

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

## Config (env vars)

| Var | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | - | required |
| `TELEGRAM_BOT_TOKEN` | - | required |
| `TELEGRAM_CHAT_ID` | - | required; the group id in CI |
| `RSS_URLS_VN` | VnExpress kinh-doanh/so-hoa/thoi-su/suc-khoe | comma-separated, optional `url\|cap` |
| `RSS_URLS_ENG` | BBC business/technology/world/health + HN | comma-separated, optional `url\|cap` |
| `TOP_N` | 7 | cap per bucket after merge |
| `GEMINI_MODEL` | `gemini-2.5-flash` | free tier |
| `LOOKBACK_HOURS` | 24 | window size |

## Default feeds

**VN (VnExpress):**
- `https://vnexpress.net/rss/kinh-doanh.rss` - finance/business
- `https://vnexpress.net/rss/so-hoa.rss` - tech
- `https://vnexpress.net/rss/thoi-su.rss` - politics/current affairs
- `https://vnexpress.net/rss/suc-khoe.rss` - health

**ENG (BBC + Hacker News):**
- `http://feeds.bbci.co.uk/news/business/rss.xml` (finance, 2)
- `http://feeds.bbci.co.uk/news/technology/rss.xml` (tech, 1)
- `https://news.ycombinator.com/rss` (HN front page, 1)
- `http://feeds.bbci.co.uk/news/world/rss.xml` (politics, 2)
- `http://feeds.bbci.co.uk/news/health/rss.xml` (health, 1)

## Notes

- GitHub Actions cron can lag by minutes to hours under load; delivery time is best effort.
- Two Gemini calls per day, well within the free tier.
- No cross-day dedupe yet; daily 24h window naturally minimizes overlap.
- To customize: set `RSS_URLS_VN` or `RSS_URLS_ENG` in `.env` or workflow env.
