import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { DAILY_CRON, MONTHLY_CRON } from "../src/index";
import type { TgChat, TgMessage, TgUpdate } from "../src/telegram";

const GROUP = -100123;
const AN = { id: 1, is_bot: false, first_name: "An" };
const HIEU = { id: 2, is_bot: false, first_name: "Hiếu", last_name: "Bùi" };

let sent: { method: string; body: Record<string, unknown> }[];
let nextUpdateId: number;
let aiCalls: { system: string; user: string }[];
/** Workers AI stub: categorisation prompts get keyword answers, anything else gets `commentaryReply`. */
let aiFails: boolean;
let commentaryReply: string;

function fakeAi(system: string, user: string): string {
  if (!system.includes("phân loại")) return commentaryReply;
  const answer: Record<string, string> = {};
  for (const [, n, note] of user.matchAll(/^(\d+)\. (.*)$/gm)) {
    answer[n!] = /cafe|phở/.test(note!) ? "an_uong" : /grab|xăng/.test(note!) ? "di_chuyen" : "khac";
  }
  return JSON.stringify(answer);
}

beforeEach(() => {
  sent = [];
  nextUpdateId = 1;
  aiCalls = [];
  aiFails = false;
  commentaryReply = "Cả nhóm chi chủ yếu cho ăn uống.";
  vi.spyOn(env.AI, "run").mockImplementation((async (_model: string, input: { messages: { content: string }[] }) => {
    const [system, user] = input.messages.map((m) => m.content) as [string, string];
    aiCalls.push({ system, user });
    if (aiFails) throw new Error("4006: daily free allocation exceeded");
    return { response: fakeAi(system, user) };
  }) as never);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T03:00:00Z")); // 10:00 ICT
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = url.split("/").pop()!;
    sent.push({ method, body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true, result: true });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function messageUpdate(text: string, from = AN, chat: TgChat = { id: GROUP, type: "supergroup" }): TgUpdate {
  const id = nextUpdateId++;
  return {
    update_id: id,
    message: { message_id: 1000 + id, from, chat, date: 0, text },
  };
}

async function post(update: unknown, secret = "test-secret"): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("https://bot.example/", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
      body: JSON.stringify(update),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx); // background work (categorisation) finishes before asserts
  return res;
}

/** Sends `text` and returns the bot's reply. `extra` is merged into the message (e.g. reply_to_message). */
async function send(text: string, from = AN, extra: Partial<TgMessage> = {}): Promise<string> {
  sent = [];
  const update = messageUpdate(text, from);
  Object.assign(update.message!, extra);
  const res = await post(update);
  expect(res.status).toBe(200);
  const reply = sent.find((s) => s.method === "sendMessage");
  return String(reply?.body.text ?? "");
}

async function liveExpenses() {
  const { results } = await env.DB.prepare(
    "SELECT user_id, amount, note, spent_on, message_id FROM expenses WHERE deleted_at IS NULL ORDER BY id",
  ).all();
  return results;
}

describe("webhook security and filtering", () => {
  it("rejects a wrong secret with 401 and touches nothing", async () => {
    const res = await post(messageUpdate("/add 50k"), "wrong");
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
    expect(await liveExpenses()).toHaveLength(0);
  });

  it("rejects non-POST requests", async () => {
    const res = await worker.fetch(new Request("https://bot.example/"), env, createExecutionContext());
    expect(res.status).toBe(404);
  });

  it("answers a DM with the notice and nothing else", async () => {
    await post(messageUpdate("/add 50k", AN, { id: AN.id, type: "private" }));
    expect(sent).toEqual([{ method: "sendMessage", body: expect.objectContaining({ chat_id: AN.id, text: expect.stringContaining("chỉ hoạt động trong nhóm") }) }]);
    expect(await liveExpenses()).toHaveLength(0);
  });

  it("leaves a foreign group when added", async () => {
    await post({
      update_id: 99,
      my_chat_member: {
        chat: { id: -999, type: "group" },
        from: AN,
        new_chat_member: { status: "member", user: { id: 42, is_bot: true, first_name: "bot" } },
      },
    });
    expect(sent).toEqual([{ method: "leaveChat", body: { chat_id: -999 } }]);
  });

  it("ignores commands addressed to another bot and unknown commands", async () => {
    await post(messageUpdate("/add@other_bot 50k"));
    await post(messageUpdate("/foo"));
    expect(sent).toHaveLength(0);
  });

  it("skips a re-sent update (idempotency)", async () => {
    const update = messageUpdate("/add 50k cafe");
    await post(update);
    await post(update);
    expect(await liveExpenses()).toHaveLength(1);
  });

  it("returns 200 and the generic error when a command throws", async () => {
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation((sql) => {
      if (sql.includes("INSERT INTO expenses")) throw new Error("boom");
      return prepare(sql);
    });
    const reply = await send("/add 50k cafe");
    expect(reply).toBe("Có lỗi, thử lại sau");
  });
});

describe("commands", () => {
  it("/add saves for the sender and replies with month-to-date", async () => {
    const reply = await send("/add@spending_test_bot 50k cafe sáng");
    expect(await liveExpenses()).toEqual([
      { user_id: AN.id, amount: 50_000, note: "cafe sáng", spent_on: "2026-10-08", message_id: 1001 },
    ]);
    expect(reply).toBe("Đã ghi 50.000đ · cafe sáng · An\nTháng 10 của bạn: 50.000đ");
    expect(sent[0]!.body).toMatchObject({ chat_id: GROUP, parse_mode: "HTML", reply_parameters: { message_id: 1001 } });
  });

  it("/add accepts a space between the amount and its unit", async () => {
    const reply = await send("/add 50 nghìn cafe");
    expect(await liveExpenses()).toEqual([
      { user_id: AN.id, amount: 50_000, note: "cafe", spent_on: "2026-10-08", message_id: 1001 },
    ]);
    expect(reply).toBe("Đã ghi 50.000đ · cafe · An\nTháng 10 của bạn: 50.000đ");
  });

  it("/add rejects bad input and saves nothing", async () => {
    expect(await send("/add 50 cafe")).toContain("50k");
    expect(await send("/add cafe 50k")).toContain("Cách dùng");
    expect(await liveExpenses()).toHaveLength(0);
  });

  it("/add escapes HTML in notes", async () => {
    expect(await send("/add 50k <b>x</b> & y")).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  it("/undo removes only the sender's last entry", async () => {
    await send("/add 50k a");
    await send("/add 70k b");
    await send("/add 90k c", HIEU);
    expect(await send("/undo")).toBe("Đã xoá 70.000đ · b (08/10)");
    expect((await liveExpenses()).map((e) => e.amount)).toEqual([50_000, 90_000]);
    await send("/undo");
    expect(await send("/undo")).toContain("không có khoản chi");
  });

  /** Mimics Telegram's reply_to_message for a message sent earlier in the test. */
  function replyTo(messageId: number, from = AN, text = ""): Partial<TgMessage> {
    return { reply_to_message: { message_id: messageId, from, chat: { id: GROUP, type: "supergroup" }, date: 0, text } };
  }

  it("/undo as a reply to your own /add removes that expense", async () => {
    await send("/add 50k a"); // message 1001
    await send("/add 70k b"); // message 1002
    await send("/add 90k c"); // message 1003
    expect(await send("/undo", AN, replyTo(1001, AN, "/add 50k a"))).toBe("Đã xoá 50.000đ · a (08/10)");
    expect((await liveExpenses()).map((e) => e.amount)).toEqual([70_000, 90_000]);
    expect(sent[0]!.body).toMatchObject({ reply_parameters: { message_id: 1004 } });

    // Plain /undo is unchanged: the latest one goes next.
    expect(await send("/undo")).toBe("Đã xoá 90.000đ · c (08/10)");
    expect((await liveExpenses()).map((e) => e.amount)).toEqual([70_000]);
  });

  it("/undo as a reply never deletes someone else's expense", async () => {
    await send("/add 50k a"); // 1001, An
    await send("/add 90k c", HIEU); // 1002, Hiếu
    const reply = await send("/undo", AN, replyTo(1002, HIEU, "/add 90k c"));
    expect(reply).toContain("không phải khoản chi của bạn");
    expect((await liveExpenses()).map((e) => e.amount)).toEqual([50_000, 90_000]);
  });

  it("/undo as a reply to a non-expense message deletes nothing and says so", async () => {
    await send("/add 50k a"); // 1001
    await send("/check"); // 1002, not an expense
    await send("/add 5 a"); // 1003, rejected, not an expense
    for (const target of [1002, 1003, 777]) {
      expect(await send("/undo", AN, replyTo(target))).toContain("không phải khoản chi của bạn");
    }
    expect(await liveExpenses()).toHaveLength(1);
  });

  it("/undo as a reply to an already deleted expense deletes nothing more", async () => {
    await send("/add 50k a"); // 1001
    await send("/add 70k b"); // 1002
    await send("/undo", AN, replyTo(1001));
    expect(await send("/undo", AN, replyTo(1001))).toContain("không phải khoản chi của bạn");
    expect((await liveExpenses()).map((e) => e.amount)).toEqual([70_000]);
  });

  it("/undo in a forum topic without an explicit reply acts as plain /undo", async () => {
    const topic = { message_thread_id: 500, is_topic_message: true };
    await send("/add 50k a", AN, { ...topic, ...replyTo(500, AN) });
    await send("/add 70k b", AN, { ...topic, ...replyTo(500, AN) });
    expect(await send("/undo", AN, { ...topic, ...replyTo(500, AN) })).toBe("Đã xoá 70.000đ · b (08/10)");
    // An explicit reply inside the topic still targets that message.
    expect(await send("/undo", AN, { ...topic, ...replyTo(1001) })).toBe("Đã xoá 50.000đ · a (08/10)");
    expect(await liveExpenses()).toHaveLength(0);
  });

  it("/check totals match a SQL sum", async () => {
    await send("/add 2tr thuê", AN);
    await send("/add 100k cafe hôm qua", AN);
    await send("/add 1tr25 sửa xe", HIEU);
    await send("/add 300k vé 05/09", HIEU); // previous month, excluded
    const reply = await send("/check");
    expect(reply).toBe(
      ["Chi tiêu tháng 10 (đến 08/10)", "1. An: 2.100.000đ (2 lần)", "2. Hiếu: 1.250.000đ (1 lần)", "Hôm nay: 3.250.000đ · Cả nhóm: 3.350.000đ"].join("\n"),
    );
    const sum = await env.DB.prepare(
      "SELECT SUM(amount) AS s FROM expenses WHERE spent_on BETWEEN '2026-10-01' AND '2026-10-08' AND deleted_at IS NULL",
    ).first<{ s: number }>();
    expect(sum?.s).toBe(3_350_000);
  });

  it("/summary shows a past month with change vs previous", async () => {
    await send("/add 100k a 05/08");
    await send("/add 300k b 05/09");
    await send("/add 50k c 06/09", HIEU);
    const reply = await send("/summary 9");
    expect(reply).toBe(
      [
        "<b>Tổng kết tháng 9/2026</b>",
        "1. An: 300.000đ (1 lần, lớn nhất 300.000đ)",
        "2. Hiếu: 50.000đ (1 lần, lớn nhất 50.000đ)",
        "Cả nhóm: 350.000đ · so với tháng 8: +250%",
        "",
        "<b>Theo loại</b>",
        "Khác: 350.000đ (+250%)",
      ].join("\n"),
    );
    expect(aiCalls.every((c) => c.system.includes("phân loại"))).toBe(true); // /summary never asks for commentary
    expect(await send("/summary 13")).toContain("Cách dùng");
  });

  it("/daily toggles and reports state", async () => {
    expect(await send("/daily")).toContain("đang tắt");
    expect(await send("/daily on")).toContain("Đã bật");
    expect(await send("/daily")).toContain("đang bật");
    expect(await send("/daily maybe")).toContain("Cách dùng");
  });

  it("/help lists the commands", async () => {
    const reply = await send("/help");
    for (const cmd of ["/add", "/check", "/summary", "/undo", "/daily"]) expect(reply).toContain(cmd);
  });

  it("refreshes member names on every command", async () => {
    await send("/check", AN);
    await send("/check", { ...AN, first_name: "An Mới" });
    const row = await env.DB.prepare("SELECT first_name FROM members WHERE user_id = ?").bind(AN.id).first();
    expect(row).toEqual({ first_name: "An Mới" });
  });
});

async function expenseCategories() {
  const { results } = await env.DB.prepare("SELECT note, category FROM expenses ORDER BY id").all();
  return results;
}

describe("categories (Workers AI stubbed)", () => {
  it("/add replies first, then categorises in the background and caches by note", async () => {
    const reply = await send("/add 45k phở bò");
    expect(reply).toBe("Đã ghi 45.000đ · phở bò · An\nTháng 10 của bạn: 45.000đ");
    await send("/add 30k Phở  BÒ");
    await send("/add 20k");
    expect(await expenseCategories()).toEqual([
      { note: "phở bò", category: "an_uong" },
      { note: "Phở BÒ", category: "an_uong" },
      { note: "", category: "khac" },
    ]);
    expect(aiCalls).toHaveLength(1);
  });

  it("when Workers AI fails, /add still works and the daily cron retries", async () => {
    aiFails = true;
    expect(await send("/add 50k grab")).toContain("Đã ghi 50.000đ");
    expect(await expenseCategories()).toEqual([{ note: "grab", category: null }]);

    aiFails = false;
    sent = [];
    await worker.scheduled(createScheduledController({ cron: DAILY_CRON, scheduledTime: new Date("2026-10-08T14:00:00Z") }), env);
    expect(await expenseCategories()).toEqual([{ note: "grab", category: "di_chuyen" }]);
    expect(sent).toHaveLength(0); // recap is off; categorising sends nothing
  });

  it("with LLM_MODEL empty the bot makes no AI calls", async () => {
    const res = await worker.fetch(
      new Request("https://bot.example/", {
        method: "POST",
        headers: { "content-type": "application/json", "X-Telegram-Bot-Api-Secret-Token": "test-secret" },
        body: JSON.stringify(messageUpdate("/add 50k cafe")),
      }),
      { ...env, LLM_MODEL: "" },
      createExecutionContext(),
    );
    expect(res.status).toBe(200);
    expect(aiCalls).toHaveLength(0);
  });
});

describe("scheduled jobs", () => {
  async function runCron(cron: string, isoTime: string) {
    sent = [];
    await worker.scheduled(createScheduledController({ cron, scheduledTime: new Date(isoTime) }), env);
  }

  it("daily recap is silent when off or when there is nothing today", async () => {
    await send("/add 50k a");
    await runCron(DAILY_CRON, "2026-10-08T14:00:00Z");
    expect(sent).toHaveLength(0);

    await send("/daily on");
    await runCron(DAILY_CRON, "2026-10-09T14:00:00Z"); // no expenses on the 9th
    expect(sent).toHaveLength(0);
  });

  it("daily recap sends today's and month-to-date totals when on", async () => {
    await send("/daily on");
    await send("/add 50k a");
    await send("/add 20k b hôm qua", HIEU);
    await runCron(DAILY_CRON, "2026-10-08T14:00:00Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text).toBe(
      ["<b>Chi tiêu hôm nay (08/10)</b>", "1. An: 50.000đ", "Cả nhóm hôm nay: 50.000đ · Từ đầu tháng: 70.000đ"].join("\n"),
    );
  });

  it("daily job prunes processed_updates older than 7 days", async () => {
    await env.DB.prepare("INSERT INTO processed_updates VALUES (500, '2026-09-30T00:00:00.000Z'), (501, '2026-10-07T00:00:00.000Z')").run();
    await runCron(DAILY_CRON, "2026-10-08T14:00:00Z");
    const { results } = await env.DB.prepare("SELECT update_id FROM processed_updates").all();
    expect(results).toEqual([{ update_id: 501 }]);
  });

  it("monthly summary at 09:00 ICT on the 1st covers the month that ended", async () => {
    await send("/add 50k a");
    await runCron(MONTHLY_CRON, "2026-11-01T02:00:00Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({ chat_id: GROUP, text: expect.stringContaining("Tổng kết tháng 10/2026") });
  });

  it("monthly summary is sent even for an empty month, without asking for commentary", async () => {
    await runCron(MONTHLY_CRON, "2026-11-01T02:00:00Z");
    expect(sent[0]!.body.text).toContain("Không có khoản chi nào");
    expect(aiCalls).toHaveLength(0);
  });

  it("monthly summary categorises leftovers, then adds categories and commentary", async () => {
    aiFails = true;
    await send("/add 300k cafe 05/10");
    await send("/add 100k grab 06/10", HIEU);
    await send("/add 50k phở 05/09");
    aiFails = false;
    aiCalls = [];
    commentaryReply = "Ăn uống chiếm phần lớn với 300.000đ, tăng +500% so với tháng 9.";

    await runCron(MONTHLY_CRON, "2026-11-01T02:00:00Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text).toBe(
      [
        "<b>Tổng kết tháng 10/2026</b>",
        "1. An: 300.000đ (1 lần, lớn nhất 300.000đ)",
        "2. Hiếu: 100.000đ (1 lần, lớn nhất 100.000đ)",
        "Cả nhóm: 400.000đ · so với tháng 9: +700%",
        "",
        "<b>Theo loại</b>",
        "Ăn uống: 300.000đ (+500%)",
        "Di chuyển: 100.000đ",
        "",
        "<b>Nhận xét</b>",
        "Ăn uống chiếm phần lớn với 300.000đ, tăng +500% so với tháng 9.",
      ].join("\n"),
    );
    expect(aiCalls).toHaveLength(2); // one categorisation batch, one commentary
  });

  it("monthly summary still goes out when the commentary is rejected", async () => {
    await send("/add 300k cafe 05/10");
    commentaryReply = "Tháng này tiêu khoảng 7 triệu."; // "7" is not in the facts
    await runCron(MONTHLY_CRON, "2026-11-01T02:00:00Z");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.text).toContain("Ăn uống: 300.000đ");
    expect(sent[0]!.body.text).toContain("<i>Không tạo được nhận xét tháng này.</i>");
  });
});
