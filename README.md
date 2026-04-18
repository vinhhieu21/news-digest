# news-digest

Daily news digest, split into two Telegram messages:
- **VN** — Vietnamese news (VnExpress per-topic RSS)
- **ENG** — global news (BBC per-topic RSS)

Topic focus (both buckets): **finance · tech · politics · health**.

Runs on GitHub Actions at 09:00 Asia/Ho_Chi_Minh.

## Architecture

```
cron 02:00 UTC
  ├── VN bucket
  │     feedparser × 4 topic feeds (kinh-doanh, so-hoa, thoi-su, suc-khoe)
  │     → 2 per feed → merge → dedupe by URL → cap TOP_N
  │     → trafilatura (concurrent body extraction)
  │     → Gemini 2.5 Flash Lite (Vietnamese prompt, JSON output)
  │     → Telegram HTML message (chunked if >4000 chars)
  └── ENG bucket (same flow, BBC business/tech/world/health, English prompt)
```

Buckets isolated: one failure doesn't block the other.

## Setup

### 1. Telegram bot + chat id

```bash
# /newbot in @BotFather to get TOKEN
# DM your bot any message first
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[-1].message.chat.id'
```

### 2. Gemini API key

Get one free at https://aistudio.google.com/app/apikey.

### 3. Local test

```bash
cd news-digest
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # fill in 3 secrets
set -a && source .env && set +a
python -m src.main
```

### 4. Deploy to GitHub Actions

```bash
git init && git add . && git commit -m "init news-digest"
gh repo create news-digest --private --source=. --push
gh secret set GEMINI_API_KEY --body "$GEMINI_API_KEY"
gh secret set TELEGRAM_BOT_TOKEN --body "$TELEGRAM_BOT_TOKEN"
gh secret set TELEGRAM_CHAT_ID --body "$TELEGRAM_CHAT_ID"
gh workflow run daily-news-digest
```

## Config (env vars)

| Var | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — | required |
| `TELEGRAM_BOT_TOKEN` | — | required |
| `TELEGRAM_CHAT_ID` | — | required |
| `RSS_URLS_VN` | VnExpress kinh-doanh/so-hoa/thoi-su/suc-khoe | comma-separated |
| `RSS_URLS_ENG` | BBC business/technology/world/health | comma-separated |
| `PER_FEED_TOP` | 2 | max articles pulled per feed |
| `TOP_N` | 8 | cap per bucket after merge |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | free tier |
| `LOOKBACK_HOURS` | 24 | window size |

## Default feeds

**VN (VnExpress):**
- `https://vnexpress.net/rss/kinh-doanh.rss` — finance/business
- `https://vnexpress.net/rss/so-hoa.rss` — tech
- `https://vnexpress.net/rss/thoi-su.rss` — politics/current affairs
- `https://vnexpress.net/rss/suc-khoe.rss` — health

**ENG (BBC + Hacker News):**
- `http://feeds.bbci.co.uk/news/business/rss.xml` (finance, 2)
- `http://feeds.bbci.co.uk/news/technology/rss.xml` (tech, 1)
- `https://hnrss.org/frontpage?points=100&count=20` (tech community, 1)
- `http://feeds.bbci.co.uk/news/world/rss.xml` (politics, 2)
- `http://feeds.bbci.co.uk/news/health/rss.xml` (health, 1)

## Notes

- GitHub Actions cron can lag 5–15 min. Fine for a digest.
- Free Gemini tier (`gemini-2.5-flash-lite`): 1500 RPD. Two calls/day = ample.
- No cross-day dedupe yet; daily 24h window naturally minimizes overlap.
- To customize: set `RSS_URLS_VN` or `RSS_URLS_ENG` in `.env` or workflow env.
