import os
from dataclasses import dataclass


Feed = tuple[str, int]  # (url, max_articles_to_pull)


# Topic targets per bucket: 2 finance + 2 tech + 2 politics + 1 health = 7
DEFAULT_VN_FEEDS: list[Feed] = [
    ("https://vnexpress.net/rss/kinh-doanh.rss", 2),  # finance
    ("https://vnexpress.net/rss/so-hoa.rss", 2),      # tech
    ("https://vnexpress.net/rss/thoi-su.rss", 2),     # politics
    ("https://vnexpress.net/rss/suc-khoe.rss", 1),    # health
]

DEFAULT_ENG_FEEDS: list[Feed] = [
    ("http://feeds.bbci.co.uk/news/business/rss.xml", 2),           # finance
    ("http://feeds.bbci.co.uk/news/technology/rss.xml", 1),         # tech (mainstream)
    ("https://hnrss.org/frontpage?points=100&count=20", 1),         # tech (HN community)
    ("http://feeds.bbci.co.uk/news/world/rss.xml", 2),              # politics
    ("http://feeds.bbci.co.uk/news/health/rss.xml", 1),             # health
]

# Fallback cap when user overrides feed list via env without specifying caps.
OVERRIDE_DEFAULT_CAP = 2


@dataclass(frozen=True)
class Config:
    gemini_api_key: str
    telegram_bot_token: str
    telegram_chat_id: str
    feeds_vn: list[Feed]
    feeds_eng: list[Feed]
    top_n: int
    gemini_model: str
    lookback_hours: int


def _feeds(env_name: str, default: list[Feed]) -> list[Feed]:
    """Parse CSV override. Each entry is `url` or `url|cap` (cap defaults to 2)."""
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
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
        lookback_hours=int(os.environ.get("LOOKBACK_HOURS", "24")),
    )
