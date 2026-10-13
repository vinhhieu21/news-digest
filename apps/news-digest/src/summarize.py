from __future__ import annotations

import logging
from datetime import datetime
from typing import Literal

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel, Field
from tenacity import before_sleep_log, retry, retry_if_exception, stop_after_attempt, wait_exponential

from .fetch import Article

log = logging.getLogger(__name__)

Locale = Literal["vn", "eng"]
Topic = Literal["finance", "tech", "politics", "health", "other"]

# With low thinking a healthy call takes ~5-15s. Cap each attempt so a
# stalled request is retried instead of eating the whole CI job budget.
GEMINI_TIMEOUT_MS = 90_000


class DigestItem(BaseModel):
    index: int = Field(description="Number of the source article in the ARTICLES list")
    topic: Topic
    headline: str
    summary: str


class Digest(BaseModel):
    overview: str
    items: list[DigestItem]


TOPIC_EMOJI: dict[str, str] = {
    "finance": "💰",
    "tech": "💻",
    "politics": "🏛",
    "health": "🩺",
    "other": "📌",
}


PROMPT_VN = """Bạn là biên tập viên trưởng của một bản tin buổi sáng cho người bận rộn.
Dưới đây là {count} bài báo trong 24 giờ qua. Hãy CHỌN đúng {top_n} tin quan trọng nhất và tóm tắt bằng tiếng Việt.

CÁCH CHỌN:
- Ưu tiên tin có tác động rộng: chính sách, kinh tế vĩ mô, thị trường, doanh nghiệp lớn, công nghệ, an toàn y tế cộng đồng.
- Cố gắng cân bằng chủ đề: khoảng 2 tài chính, 2 công nghệ, 2 chính trị/thời sự, 1 y tế. Được lệch nếu ngày đó một chủ đề thực sự nổi bật hơn.
- BỎ QUA: tin người nổi tiếng, mẹo làm đẹp/sống khoẻ, quảng cáo, đánh giá sản phẩm, sự kiện giải trí, tai nạn nhỏ mang tính địa phương.
- Nếu hai bài cùng một sự kiện, chỉ chọn một.
- Sắp xếp theo mức độ quan trọng giảm dần.

CÁCH VIẾT:
- "overview": 1 câu nêu cụ thể 2-3 sự kiện lớn nhất hôm nay (tên, con số), không viết chung chung.
- "headline": ngắn gọn, tối đa 12 từ, nêu điều mới xảy ra.
- "summary": 1-2 câu, tối đa 45 từ. Câu đầu: chuyện gì xảy ra kèm con số/tên riêng quan trọng. Câu sau (nếu cần): vì sao đáng chú ý.
- "topic": chọn theo nội dung thực tế của bài, không theo chuyên mục nguồn.
- "index": số thứ tự của bài trong danh sách.
- Chỉ dùng thông tin trong bài, KHÔNG bịa. KHÔNG thêm link.

BÀI BÁO:
{articles_block}
"""


PROMPT_ENG = """You are the editor-in-chief of a morning brief for busy readers.
Below are {count} articles from the last 24 hours. PICK exactly the {top_n} most important and summarize them in English.

HOW TO PICK:
- Favor stories with broad impact: policy, macroeconomics, markets, major companies, technology shifts, public health.
- Aim for topic balance: about 2 finance, 2 tech, 2 politics/world, 1 health. Deviate only if one topic genuinely dominates the day.
- SKIP: celebrity news, lifestyle or wellness advice, promotional pieces, product reviews, entertainment, minor local incidents.
- If two articles cover the same event, pick one.
- Order items by importance, most important first.

HOW TO WRITE:
- "overview": one sentence naming the 2-3 biggest stories concretely (names, numbers). No generic filler.
- "headline": at most 12 words, stating what is new.
- "summary": 1-2 sentences, at most 45 words. First sentence: what happened, with the key name or figure. Second (optional): why it matters.
- "topic": based on what the article is actually about, not the source section.
- "index": the article's number in the list.
- Use only facts from the articles. Do NOT invent. Do NOT include URLs.

ARTICLES:
{articles_block}
"""


def _format_articles(articles: list[Article]) -> str:
    blocks = []
    for i, a in enumerate(articles, 1):
        body = a.body or a.summary_rss
        blocks.append(f"[{i}] {a.title}\nSource: {a.url}\nContent: {body}\n")
    return "\n---\n".join(blocks)


def _valid_items(digest: Digest, article_count: int, top_n: int) -> list[DigestItem]:
    """Drop items pointing at unknown or already-used articles, keep model order."""
    seen: set[int] = set()
    out: list[DigestItem] = []
    for it in digest.items:
        if not 1 <= it.index <= article_count or it.index in seen:
            log.warning("Dropping item with invalid or duplicate index %d", it.index)
            continue
        seen.add(it.index)
        out.append(it)
    return out[:top_n]


def _thinking_config(model_name: str) -> types.ThinkingConfig:
    """Keep thinking light: default thinking is ~10x slower for near-identical picks.

    Gemini 2.x only takes a token budget; 3.x only takes a level.
    """
    if model_name.startswith("gemini-2."):
        return types.ThinkingConfig(thinking_budget=1024)
    return types.ThinkingConfig(thinking_level="low")


class BadModelOutput(RuntimeError):
    """Stochastic model failure (truncated JSON, unusable picks) - worth retrying."""


def _retryable_gemini(exc: BaseException) -> bool:
    """Retry rate limits, server flakiness, transport failures, and stochastic
    bad model output. Only deterministic client errors fail fast.
    """
    if isinstance(exc, BadModelOutput):
        return True
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, genai_errors.ServerError):
        return True
    if isinstance(exc, genai_errors.APIError):
        return exc.code == 429
    return False


@retry(
    reraise=True,
    before_sleep=before_sleep_log(log, logging.WARNING),
    stop=stop_after_attempt(3),
    # 503 "high demand" spells on Flash models last tens of seconds, so short
    # backoffs burn every attempt inside the same spell.
    wait=wait_exponential(multiplier=10, min=10, max=60),
    retry=retry_if_exception(_retryable_gemini),
)
def _call_gemini(client: genai.Client, model_name: str, prompt: str, article_count: int, top_n: int) -> Digest:
    resp = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=Digest,
            thinking_config=_thinking_config(model_name),
        ),
    )
    digest = resp.parsed
    if not isinstance(digest, Digest):
        raise BadModelOutput(f"Gemini response did not match schema: {(resp.text or '')[:300]}")
    digest.items = _valid_items(digest, article_count, top_n)
    if not digest.items:
        raise BadModelOutput("Gemini returned no usable items")
    return digest


def summarize(articles: list[Article], api_key: str, models: list[str], locale: Locale, top_n: int) -> Digest:
    """Try each model in order; move to the next once one exhausts its retries."""
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS))
    template = PROMPT_VN if locale == "vn" else PROMPT_ENG
    top_n = min(top_n, len(articles))
    prompt = template.format(count=len(articles), top_n=top_n, articles_block=_format_articles(articles))
    for i, model_name in enumerate(models):
        try:
            digest = _call_gemini(client, model_name, prompt, len(articles), top_n)
            log.info("Summarized with %s", model_name)
            return digest
        except Exception as exc:
            if i == len(models) - 1:
                raise
            log.warning("Model %s failed (%s), falling back to %s", model_name, str(exc)[:200], models[i + 1])
    raise ValueError("No Gemini models configured")


def render_html(digest: Digest, articles: list[Article], date: datetime, locale: Locale) -> str:
    # Caps keep every model-supplied field short enough that _chunk always splits
    # on paragraph boundaries: a hard cut mid-tag would produce invalid HTML and
    # fail the whole send.
    MAX_OVERVIEW_CHARS = 500
    MAX_HEADLINE_CHARS = 200
    MAX_SUMMARY_CHARS = 1500

    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

    def clip(text: str, limit: int) -> str:
        # Clip the raw text first: cutting after escaping could split an entity.
        text = text.strip()
        return text if len(text) <= limit else text[:limit].rstrip() + "…"

    if locale == "vn":
        header = f"<b>📰 Bản tin sáng {date.strftime('%d/%m/%Y')}</b>"
    else:
        header = f"<b>🌍 Morning Brief {date.strftime('%d/%m/%Y')}</b>"

    lines = [header]
    overview = esc(clip(digest.overview, MAX_OVERVIEW_CHARS))
    if overview:
        lines.append(f"<i>{overview}</i>")

    for item in digest.items:
        art = articles[item.index - 1]
        headline = esc(clip(item.headline or art.title, MAX_HEADLINE_CHARS))
        summary = esc(clip(item.summary, MAX_SUMMARY_CHARS))
        emoji = TOPIC_EMOJI.get(item.topic, TOPIC_EMOJI["other"])
        lines.append(f"{emoji} <b><a href=\"{esc(art.url)}\">{headline}</a></b>\n{summary}")

    return "\n\n".join(lines)
