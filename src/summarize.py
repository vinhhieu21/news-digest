from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Literal

import google.generativeai as genai
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .fetch import Article

log = logging.getLogger(__name__)

Locale = Literal["vn", "eng"]


PROMPT_VN = """Bạn là biên tập viên tin tức. Tóm tắt các bài báo dưới đây thành bản tin buổi sáng bằng tiếng Việt.

ƯU TIÊN CHỦ ĐỀ: tài chính / kinh doanh, công nghệ, chính trị / thời sự, y tế / sức khoẻ.
Nếu bài ngoài các chủ đề trên, chỉ đưa vào khi thực sự nổi bật.

YÊU CẦU:
- Mở đầu bằng 1 câu tổng quan về chủ đề nổi bật trong ngày.
- Với mỗi bài, viết 2-3 câu ngắn gọn, trung tính, giữ tên riêng/số liệu.
- KHÔNG bịa thông tin. Chỉ dùng nội dung trong bài.
- KHÔNG thêm link (hệ thống tự gắn).
- Trả về JSON đúng cấu trúc.

ĐỊNH DẠNG JSON:
{{
  "overview": "câu tổng quan",
  "items": [
    {{"index": 1, "topic": "tài chính|công nghệ|chính trị|y tế|khác", "headline": "tiêu đề ngắn gọn", "summary": "tóm tắt 2-3 câu"}}
  ]
}}

BÀI BÁO:
{articles_block}
"""


PROMPT_ENG = """You are a news editor. Summarize the articles below into an English morning brief.

TOPIC PRIORITY: finance / business, technology, politics / world affairs, health.
Include items outside these topics only if genuinely significant.

REQUIREMENTS:
- Lead with one sentence capturing the dominant theme of the day.
- For each article: 2-3 tight, neutral sentences. Keep names, figures, and places.
- Do NOT invent facts. Use only the article content provided.
- Do NOT include URLs (the system attaches them).
- Return JSON matching the schema exactly.

JSON SCHEMA:
{{
  "overview": "one-sentence overview",
  "items": [
    {{"index": 1, "topic": "finance|tech|politics|health|other", "headline": "short headline", "summary": "2-3 sentence summary"}}
  ]
}}

ARTICLES:
{articles_block}
"""


def _format_articles(articles: list[Article]) -> str:
    blocks = []
    for i, a in enumerate(articles, 1):
        body = a.body or a.summary_rss
        blocks.append(f"[{i}] {a.title}\nSource: {a.url}\nContent: {body}\n")
    return "\n---\n".join(blocks)


@retry(
    reraise=True,
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=2, min=2, max=20),
    retry=retry_if_exception_type(Exception),
)
def _call_gemini(model: genai.GenerativeModel, prompt: str) -> str:
    resp = model.generate_content(
        prompt,
        generation_config={
            "temperature": 0.3,
            "response_mime_type": "application/json",
        },
    )
    if not resp.text:
        raise RuntimeError("Empty response from Gemini")
    return resp.text


def summarize(articles: list[Article], api_key: str, model_name: str, locale: Locale) -> dict:
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(model_name)
    template = PROMPT_VN if locale == "vn" else PROMPT_ENG
    prompt = template.format(articles_block=_format_articles(articles))
    raw = _call_gemini(model, prompt)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        log.error("Gemini returned non-JSON: %s", raw[:500])
        raise RuntimeError("Gemini response was not valid JSON") from exc
    return data


def render_html(summary: dict, articles: list[Article], date: datetime, locale: Locale) -> str:
    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    if locale == "vn":
        header = f"<b>📰 Bản tin sáng {date.strftime('%d/%m/%Y')} · VN</b>"
    else:
        header = f"<b>🌍 Morning Brief {date.strftime('%d/%m/%Y')} · ENG</b>"

    overview = esc(summary.get("overview", "").strip())
    lines = [header]
    if overview:
        lines.append(f"\n<i>{overview}</i>")

    items_by_index = {it["index"]: it for it in summary.get("items", [])}
    for i, art in enumerate(articles, 1):
        item = items_by_index.get(i)
        if not item:
            continue
        headline = esc(item.get("headline", art.title).strip())
        body = esc(item.get("summary", "").strip())
        topic = esc(item.get("topic", "").strip())
        topic_tag = f" <i>[{topic}]</i>" if topic else ""
        lines.append(f"\n<b>{i}. <a href=\"{esc(art.url)}\">{headline}</a></b>{topic_tag}\n{body}")

    return "\n".join(lines)
