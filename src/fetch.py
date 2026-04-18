from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import mktime

import feedparser
import trafilatura

log = logging.getLogger(__name__)

BODY_CHAR_LIMIT = 1500


@dataclass
class Article:
    title: str
    url: str
    published: datetime
    summary_rss: str
    body: str


def _parse_published(entry) -> datetime:
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            return datetime.fromtimestamp(mktime(t), tz=timezone.utc)
    return datetime.now(tz=timezone.utc)


def fetch_rss(url: str, top_n: int, lookback_hours: int) -> list[Article]:
    feed = feedparser.parse(url)
    if feed.bozo and not feed.entries:
        raise RuntimeError(f"Failed to parse RSS feed: {url} ({feed.bozo_exception})")

    cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=lookback_hours)
    recent: list[Article] = []
    for e in feed.entries:
        published = _parse_published(e)
        if published < cutoff:
            continue
        recent.append(
            Article(
                title=e.get("title", "").strip(),
                url=e.get("link", "").strip(),
                published=published,
                summary_rss=e.get("summary", "").strip(),
                body="",
            )
        )

    recent.sort(key=lambda a: a.published, reverse=True)
    selected = recent[:top_n]
    log.info("RSS %s: %d entries, %d in window, %d selected", url, len(feed.entries), len(recent), len(selected))
    return selected


def fetch_multi(feeds: list[tuple[str, int]], overall_top: int, lookback_hours: int) -> list[Article]:
    merged: list[Article] = []
    for url, cap in feeds:
        try:
            merged.extend(fetch_rss(url, cap, lookback_hours))
        except Exception as exc:
            log.warning("feed %s failed: %s", url, exc)

    seen: set[str] = set()
    deduped: list[Article] = []
    for a in merged:
        if not a.url or a.url in seen:
            continue
        seen.add(a.url)
        deduped.append(a)

    return deduped[:overall_top]


def _extract_body(url: str) -> str:
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        return ""
    text = trafilatura.extract(
        downloaded,
        include_comments=False,
        include_tables=False,
        no_fallback=False,
        favor_precision=True,
    )
    if not text:
        return ""
    return text[:BODY_CHAR_LIMIT]


def enrich_bodies(articles: list[Article], max_workers: int = 5) -> list[Article]:
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(_extract_body, a.url): a for a in articles}
        for fut in as_completed(futs):
            art = futs[fut]
            try:
                art.body = fut.result()
            except Exception as exc:
                log.warning("body extract failed for %s: %s", art.url, exc)
                art.body = ""
    kept = [a for a in articles if a.body or a.summary_rss]
    log.info("Enriched: %d/%d articles with usable content", len(kept), len(articles))
    return kept
