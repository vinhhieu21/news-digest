from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from time import mktime

import feedparser
import httpx
import trafilatura
from tenacity import before_sleep_log, retry, retry_if_exception_type, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)

BODY_CHAR_LIMIT = 1500
USER_AGENT = "Mozilla/5.0 (compatible; news-digest/1.0)"


class TransientHTTPError(Exception):
    pass


@retry(
    reraise=True,
    before_sleep=before_sleep_log(log, logging.WARNING),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=10),
    retry=retry_if_exception_type((httpx.TransportError, TransientHTTPError)),
)
def _get(client: httpx.Client, url: str) -> httpx.Response:
    r = client.get(url)
    if r.status_code >= 500 or r.status_code == 429:
        raise TransientHTTPError(f"HTTP {r.status_code} for {url}")
    r.raise_for_status()
    return r


def _client() -> httpx.Client:
    return httpx.Client(timeout=20.0, follow_redirects=True, headers={"User-Agent": USER_AGENT})


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


def fetch_rss(client: httpx.Client, url: str, top_n: int, lookback_hours: int) -> list[Article]:
    feed = feedparser.parse(_get(client, url).content)
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
    with _client() as client:
        for url, cap in feeds:
            try:
                merged.extend(fetch_rss(client, url, cap, lookback_hours))
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


def _extract_body(client: httpx.Client, url: str) -> str:
    html = _get(client, url).text
    text = trafilatura.extract(
        html,
        url=url,
        include_comments=False,
        include_tables=False,
        no_fallback=False,
        favor_precision=True,
    )
    if not text:
        return ""
    return text[:BODY_CHAR_LIMIT]


def enrich_bodies(articles: list[Article], max_workers: int = 5) -> list[Article]:
    with _client() as client, ThreadPoolExecutor(max_workers=max_workers) as pool:
        futs = {pool.submit(_extract_body, client, a.url): a for a in articles}
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
