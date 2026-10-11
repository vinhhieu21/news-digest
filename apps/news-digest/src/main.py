from __future__ import annotations

import logging
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from . import telegram
from .config import Config, load
from .fetch import enrich_bodies, fetch_multi
from .summarize import Locale, render_html, summarize

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
# httpx logs full request URLs at INFO, which include the Telegram bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("google_genai").setLevel(logging.WARNING)
log = logging.getLogger("digest")


def _run_bucket(cfg: Config, feeds: list[tuple[str, int]], locale: Locale, date: datetime, label: str) -> bool:
    log.info("[%s] fetching %d feeds", label, len(feeds))
    articles = fetch_multi(feeds, cfg.lookback_hours)
    if not articles:
        log.warning("[%s] no articles in lookback window; skipping", label)
        return False

    articles = enrich_bodies(articles)
    if not articles:
        log.warning("[%s] no articles with usable content after extraction; skipping", label)
        return False

    digest = summarize(articles, cfg.gemini_api_key, cfg.gemini_models, locale, cfg.top_n)
    html = render_html(digest, articles, date, locale)
    telegram.send(cfg.telegram_bot_token, cfg.telegram_chat_id, html)
    log.info("[%s] sent digest with %d of %d candidates", label, len(digest.items), len(articles))
    return True


def run() -> int:
    cfg = load()
    log.info("Config loaded: models=%s top_n=%d", ",".join(cfg.gemini_models), cfg.top_n)
    date = datetime.now(tz=ZoneInfo("Asia/Ho_Chi_Minh"))

    buckets: list[tuple[Locale, list[str], str]] = [
        ("vn", cfg.feeds_vn, "VN"),
        ("eng", cfg.feeds_eng, "ENG"),
    ]

    failures = 0
    for locale, feeds, label in buckets:
        try:
            _run_bucket(cfg, feeds, locale, date, label)
        except Exception:
            failures += 1
            log.exception("[%s] bucket failed", label)

    return 1 if failures == len(buckets) else 0


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception:
        log.exception("Digest run failed")
        sys.exit(1)
