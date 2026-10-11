import os
from dataclasses import dataclass


Feed = tuple[str, int]  # (url, max_candidates_to_pull)


# Each feed contributes up to `cap` recent candidates. Gemini then picks the
# TOP_N most significant across all of them, aiming for topic balance.
DEFAULT_VN_FEEDS: list[Feed] = [
    ("https://vnexpress.net/rss/kinh-doanh.rss", 8),  # finance
    ("https://vnexpress.net/rss/so-hoa.rss", 8),      # tech
    ("https://vnexpress.net/rss/thoi-su.rss", 8),     # politics
    ("https://vnexpress.net/rss/suc-khoe.rss", 6),    # health
]

DEFAULT_ENG_FEEDS: list[Feed] = [
    ("http://feeds.bbci.co.uk/news/business/rss.xml", 8),           # finance
    ("http://feeds.bbci.co.uk/news/technology/rss.xml", 6),         # tech (mainstream)
    ("https://news.ycombinator.com/rss", 6),                         # tech (HN front page)
    ("http://feeds.bbci.co.uk/news/world/rss.xml", 8),              # politics
    ("http://feeds.bbci.co.uk/news/health/rss.xml", 6),             # health
]

# Tried in order; the next one is used once a model exhausts its retries.
# 3.8 Flash is the best free model but often returns 503 under load.
DEFAULT_GEMINI_MODELS = "gemini-3.8-flash,gemini-3.6-flash,gemini-2.5-flash"

# Fallback cap when user overrides feed list via env without specifying caps.
OVERRIDE_DEFAULT_CAP = 6


@dataclass(frozen=True)
class Config:
    gemini_api_key: str
    telegram_bot_token: str
    telegram_chat_id: str
    feeds_vn: list[Feed]
    feeds_eng: list[Feed]
    top_n: int
    gemini_models: list[str]
    lookback_hours: int


def _feeds(env_name: str, default: list[Feed]) -> list[Feed]:
    """Parse CSV override. Each entry is `url` or `url|cap` (cap defaults to OVERRIDE_DEFAULT_CAP)."""
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        return default
    out: list[Feed] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if "|" in item:
            url, cap = item.split("|", 1)
            out.append((url.strip(), int(cap.strip())))
        else:
            out.append((item, OVERRIDE_DEFAULT_CAP))
    return out


def load() -> Config:
    def req(name: str) -> str:
        v = os.environ.get(name)
        if not v:
            raise RuntimeError(f"Missing required env var: {name}")
        return v

    return Config(
        gemini_api_key=req("GEMINI_API_KEY"),
        telegram_bot_token=req("TELEGRAM_BOT_TOKEN"),
        telegram_chat_id=req("TELEGRAM_CHAT_ID"),
        feeds_vn=_feeds("RSS_URLS_VN", DEFAULT_VN_FEEDS),
        feeds_eng=_feeds("RSS_URLS_ENG", DEFAULT_ENG_FEEDS),
        top_n=int(os.environ.get("TOP_N", "7")),
        gemini_models=[m.strip() for m in os.environ.get("GEMINI_MODELS", DEFAULT_GEMINI_MODELS).split(",") if m.strip()],
        lookback_hours=int(os.environ.get("LOOKBACK_HOURS", "24")),
    )
