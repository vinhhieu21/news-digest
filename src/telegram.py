from __future__ import annotations

import logging

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)

MAX_LEN = 4000  # Telegram hard limit is 4096; leave headroom.
API = "https://api.telegram.org/bot{token}/sendMessage"


def _chunk(text: str, limit: int = MAX_LEN) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind("\n\n", 0, limit)
        if cut == -1:
            cut = remaining.rfind("\n", 0, limit)
        if cut == -1:
            cut = limit
        chunks.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=10),
    retry=retry_if_exception_type((httpx.HTTPError, RuntimeError)),
)
def _post(url: str, payload: dict) -> None:
    with httpx.Client(timeout=20.0) as client:
        r = client.post(url, json=payload)
        if r.status_code >= 500 or r.status_code == 429:
            raise RuntimeError(f"Telegram {r.status_code}: {r.text}")
        if r.status_code >= 400:
            raise RuntimeError(f"Telegram client error {r.status_code}: {r.text}")


def send(token: str, chat_id: str, html: str) -> None:
    url = API.format(token=token)
    for i, part in enumerate(_chunk(html), 1):
        payload = {
            "chat_id": chat_id,
            "text": part,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        _post(url, payload)
        log.info("Telegram: sent chunk %d (%d chars)", i, len(part))
