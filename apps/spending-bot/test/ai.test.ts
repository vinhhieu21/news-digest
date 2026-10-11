import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { categorizePending, classifyNotes, noteKey } from "../src/ai/categorize";
import { cleanCommentary, factsText, unknownNumbers, writeCommentary, type MonthFacts } from "../src/ai/commentary";
import { extractText, parseJsonObject, type Llm, type LlmRequest } from "../src/ai/llm";
import { summaryMessage, type MemberTotal } from "../src/report/format";

const CHAT = -100123;
const NOW = "2026-10-08T03:00:00.000Z";

/** Fake LLM: records requests and answers with `reply`. */
function fakeLlm(reply: (req: LlmRequest) => string | Promise<string>): Llm & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req) {
      calls.push(req);
      return reply(req);
    },
  };
}

/** Answers a categorisation prompt: notes containing "cafe" are food, everything else "khac". */
function keywordClassifier(req: LlmRequest): string {
  const answer: Record<string, string> = {};
  for (const line of req.user.split("\n")) {
    const [, n, note] = /^(\d+)\. (.*)$/.exec(line) ?? [];
    if (n) answer[n] = note!.includes("cafe") ? "an_uong" : note!.includes("grab") ? "di_chuyen" : "khac";
  }
  return JSON.stringify(answer);
}

async function insertExpenses(notes: string[]): Promise<void> {
  await env.DB.prepare("INSERT INTO members (user_id, first_name, updated_at) VALUES (1, 'An', ?) ON CONFLICT DO NOTHING")
    .bind(NOW)
    .run();
  for (const note of notes) {
    await env.DB.prepare(
      "INSERT INTO expenses (chat_id, user_id, amount, note, spent_on, created_at) VALUES (?, 1, 50000, ?, '2026-10-08', ?)",
    )
      .bind(CHAT, note, NOW)
      .run();
  }
}

async function categories(): Promise<(string | null)[]> {
  const { results } = await env.DB.prepare("SELECT category FROM expenses ORDER BY id").all<{ category: string | null }>();
  return results.map((r) => r.category);
}

describe("llm helpers", () => {
  it("extracts text from the Workers AI response shapes", () => {
    expect(extractText("hi")).toBe("hi");
    expect(extractText({ response: "hi" })).toBe("hi");
    expect(extractText({ response: { a: 1 } })).toBe('{"a":1}');
    expect(extractText({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
    expect(() => extractText({})).toThrow();
  });

  it("parses a JSON object, even inside a code fence", () => {
    expect(parseJsonObject('```json\n{"1": "an_uong"}\n```')).toEqual({ 1: "an_uong" });
    expect(() => parseJsonObject("không biết")).toThrow();
    expect(() => parseJsonObject("[1, 2]")).toThrow();
  });
});

describe("categorisation", () => {
  it("normalises notes into cache keys", () => {
    expect(noteKey("  Cafe   SÁNG ")).toBe("cafe sáng");
    expect(noteKey("")).toBe("");
  });

  it("maps answers outside the list to khac and leaves skipped notes out", async () => {
    const llm = fakeLlm(() => '{"1": "an_uong", "2": "bitcoin"}');
    const result = await classifyNotes(llm, ["cafe", "lạ", "bỏ sót"]);
    expect([...result]).toEqual([
      ["cafe", "an_uong"],
      ["lạ", "khac"],
    ]);
  });

  it("classifies new notes in one call, then reuses the cache", async () => {
    await insertExpenses(["cafe sáng", "grab", "", "cafe sáng"]);
    const llm = fakeLlm(keywordClassifier);
    expect(await categorizePending(env.DB, llm, CHAT, NOW)).toBe(4);
    expect(await categories()).toEqual(["an_uong", "di_chuyen", "khac", "an_uong"]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.user).toBe("1. cafe sáng\n2. grab"); // de-duplicated, empty note skipped

    await insertExpenses(["CAFE  sáng"]);
    expect(await categorizePending(env.DB, llm, CHAT, NOW)).toBe(1);
    expect(llm.calls).toHaveLength(1); // served from note_categories
    expect((await categories()).at(-1)).toBe("an_uong");
  });

  it("leaves expenses uncategorised when the LLM fails, and retries later", async () => {
    await insertExpenses(["cafe", ""]);
    expect(await categorizePending(env.DB, fakeLlm(() => Promise.reject(new Error("quota"))), CHAT, NOW)).toBe(1);
    expect(await categories()).toEqual([null, "khac"]);

    expect(await categorizePending(env.DB, fakeLlm(keywordClassifier), CHAT, NOW)).toBe(1);
    expect(await categories()).toEqual(["an_uong", "khac"]);
  });

  it("does not give the old category to a note edited during the LLM call", async () => {
    await insertExpenses(["cafe"]);
    const llm = fakeLlm(async (req) => {
      await env.DB.prepare("UPDATE expenses SET note = 'grab', category = NULL").run();
      return keywordClassifier(req);
    });
    await categorizePending(env.DB, llm, CHAT, NOW);
    expect(await categories()).toEqual([null]);
  });

  it("without an LLM only uses the cache", async () => {
    await insertExpenses(["cafe"]);
    expect(await categorizePending(env.DB, null, CHAT, NOW)).toBe(0);
    expect(await categories()).toEqual([null]);
  });
});

describe("commentary", () => {
  const facts: MonthFacts = {
    month: { year: 2026, month: 9 },
    previousMonth: { year: 2026, month: 8 },
    total: 350_000,
    previousTotal: 100_000,
    members: [{ name: "An", total: 300_000, count: 1 }],
    categories: [{ label: "Ăn uống", total: 300_000, previousTotal: 100_000 }],
  };

  it("builds the fact sheet from SQL numbers", () => {
    expect(factsText(facts)).toBe(
      [
        "Tháng 9/2026. Tổng cả nhóm: 350.000đ. Tháng 8/2026: 100.000đ. Thay đổi: +250%.",
        "Theo người:",
        "- An: 300.000đ, 1 lần",
        "Theo loại (tháng này; tháng trước; thay đổi):",
        "- Ăn uống: 300.000đ; 100.000đ; +200%",
      ].join("\n"),
    );
  });

  it("accepts commentary that only cites given numbers, and strips markdown", async () => {
    const llm = fakeLlm(() => "**Ăn uống** tăng +200%, lên 300.000đ.\n\nAn chi nhiều nhất.");
    expect(await writeCommentary(llm, facts)).toBe("Ăn uống tăng +200%, lên 300.000đ. An chi nhiều nhất.");
    expect(llm.calls[0]!.user).toBe(factsText(facts));
  });

  it("drops commentary with invented numbers, oversized or failed replies", async () => {
    expect(await writeCommentary(fakeLlm(() => "Ăn uống tăng 3 lần, khoảng 1,2 triệu."), facts)).toBeNull();
    expect(await writeCommentary(fakeLlm(() => "Rất dài. ".repeat(100)), facts)).toBeNull();
    expect(await writeCommentary(fakeLlm(() => "   "), facts)).toBeNull();
    expect(await writeCommentary(fakeLlm(() => Promise.reject(new Error("quota"))), facts)).toBeNull();
  });

  it("finds numbers that are not in the facts", () => {
    expect(unknownNumbers("tăng +250%, 350.000đ trong tháng 9", factsText(facts))).toEqual([]);
    expect(unknownNumbers("khoảng 400.000đ", factsText(facts))).toEqual(["400.000"]);
    expect(cleanCommentary("# Tiêu đề\n`x`  __y__")).toBe("Tiêu đề x y");
  });
});

describe("summaryMessage with categories and commentary", () => {
  const members: MemberTotal[] = [{ user_id: 1, first_name: "An", last_name: null, total: 350_000, count: 2, max_amount: 300_000 }];
  const base = { month: { year: 2026, month: 9 }, members, previousTotal: 100_000 };

  it("adds the category section with changes vs last month", () => {
    const text = summaryMessage({
      ...base,
      categories: [
        { category: "an_uong", total: 300_000 },
        { category: null, total: 50_000 },
      ],
      previousCategories: [{ category: "an_uong", total: 100_000 }],
      commentary: "Ăn uống <tăng>.",
    });
    expect(text).toBe(
      [
        "<b>Tổng kết tháng 9/2026</b>",
        "1. An: 350.000đ (2 lần, lớn nhất 300.000đ)",
        "Cả nhóm: 350.000đ · so với tháng 8: +250%",
        "",
        "<b>Theo loại</b>",
        "Ăn uống: 300.000đ (+200%)",
        "Chưa phân loại: 50.000đ",
        "",
        "<b>Nhận xét</b>",
        "Ăn uống &lt;tăng&gt;.",
      ].join("\n"),
    );
  });

  it("omits the category section while nothing is categorised, and says when commentary failed", () => {
    const text = summaryMessage({ ...base, categories: [{ category: null, total: 350_000 }], commentary: null });
    expect(text).not.toContain("Theo loại");
    expect(text.endsWith("<i>Không tạo được nhận xét tháng này.</i>")).toBe(true);
  });
});
