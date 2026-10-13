// 2-3 sentences of commentary for the monthly summary. The numbers come from SQL; the
// model only puts them into words, and a reply that cites a number it was not given is dropped.

import { formatVnd, percentChange } from "../report/format";
import type { YearMonth } from "../time";
import type { Llm } from "./llm";

export interface MonthFacts {
  month: YearMonth;
  previousMonth: YearMonth;
  total: number;
  previousTotal: number;
  /** Plain (unescaped) display names. */
  members: { name: string; total: number; count: number }[];
  categories: { label: string; total: number; previousTotal: number }[];
}

const MAX_LENGTH = 600;

const SYSTEM_PROMPT = [
  "Bạn viết nhận xét ngắn cho bản tổng kết chi tiêu hằng tháng của một nhóm bạn ở Việt Nam.",
  "Viết 2-3 câu tiếng Việt, giọng thân thiện, nêu điều đáng chú ý nhất: loại chi tăng hoặc giảm nhiều, ai chi nhiều nhất, so với tháng trước.",
  "Chỉ dùng số liệu được cung cấp và chép số y nguyên (ví dụ 1.250.000đ, +20%). Không tự tính hay làm tròn số mới.",
  "Không dùng markdown, không gạch đầu dòng, không chào hỏi, không khuyên răn.",
].join("\n");

/** The facts as text: the model's only input, and the reference for checking its numbers. */
export function factsText(f: MonthFacts): string {
  const lines = [
    `Tháng ${f.month.month}/${f.month.year}. Tổng cả nhóm: ${formatVnd(f.total)}. ` +
      `Tháng ${f.previousMonth.month}/${f.previousMonth.year}: ${formatVnd(f.previousTotal)}. ` +
      `Thay đổi: ${percentChange(f.total, f.previousTotal)}.`,
    "Theo người:",
    ...f.members.map((m) => `- ${m.name}: ${formatVnd(m.total)}, ${m.count} lần`),
  ];
  if (f.categories.length > 0) {
    lines.push("Theo loại (tháng này; tháng trước; thay đổi):");
    for (const c of f.categories) {
      lines.push(`- ${c.label}: ${formatVnd(c.total)}; ${formatVnd(c.previousTotal)}; ${percentChange(c.total, c.previousTotal)}`);
    }
  }
  return lines.join("\n");
}

/** Plain-text commentary, or null when the LLM fails or its reply does not pass the checks. */
export async function writeCommentary(llm: Llm, facts: MonthFacts): Promise<string | null> {
  const factSheet = factsText(facts);
  try {
    const text = await llm.complete({ system: SYSTEM_PROMPT, user: factSheet, maxTokens: 300 });
    const cleaned = cleanCommentary(text);
    if (!cleaned) throw new Error("empty commentary");
    if (cleaned.length > MAX_LENGTH) throw new Error(`commentary too long (${cleaned.length} chars)`);
    const invented = unknownNumbers(cleaned, factSheet);
    if (invented.length > 0) throw new Error(`commentary cites numbers not in the facts: ${invented.join(", ")}`);
    return cleaned;
  } catch (err) {
    console.warn("commentary failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Strips markdown emphasis/headings and collapses whitespace. */
export function cleanCommentary(text: string): string {
  return text
    .replace(/\*\*|__|`/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Number tokens in `text` that do not appear in `facts` ("1.250.000", "20", ...).
 * An ordinal span ("thứ 2") is stripped before extraction only when its rank is
 * grounded in the facts; an ungrounded rank is a computed statistic and stays
 * detectable. Stripping the span (not just the number) keeps "gấp 2 lần" visible.
 */
export function unknownNumbers(text: string, facts: string): string[] {
  const known = new Set(facts.match(/\d+(?:[.,]\d+)*/g) ?? []);
  const scrubbed = text.replace(/(?<=^|\s)(?:thứ|top|hạng|#)\s*(\d{1,2})(?=\s|$|[.,;:!?])/gi, (m, n) =>
    known.has(n) ? " " : m,
  );
  return (scrubbed.match(/\d+(?:[.,]\d+)*/g) ?? []).filter((n) => !known.has(n));
}
