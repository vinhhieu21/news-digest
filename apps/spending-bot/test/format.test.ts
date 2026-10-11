import { describe, expect, it } from "vitest";
import { parseCommand } from "../src/router";
import { reachedThreshold } from "../src/commands/budget";
import { parseMonthArgs } from "../src/commands/summary";
import { displayNames, escapeHtml, formatVnd, percentChange, usedPercent } from "../src/report/format";
import { currentMonthIct, monthKey, monthRange, previousMonth, todayIct } from "../src/time";

describe("formatVnd", () => {
  it.each([
    [1_000, "1.000đ"],
    [50_000, "50.000đ"],
    [1_250_000, "1.250.000đ"],
    [100_000_000, "100.000.000đ"],
    [0, "0đ"],
  ])("%d -> %s", (amount, text) => expect(formatVnd(amount)).toBe(text));
});

describe("escapeHtml", () => {
  it("escapes <, > and &", () => expect(escapeHtml("<b>A&B</b>")).toBe("&lt;b&gt;A&amp;B&lt;/b&gt;"));
});

describe("displayNames", () => {
  it("adds last name only when first names collide", () => {
    const names = displayNames([
      { user_id: 1, first_name: "An", last_name: "Nguyễn" },
      { user_id: 2, first_name: "An", last_name: "Trần" },
      { user_id: 3, first_name: "Chi", last_name: "Lê" },
    ]);
    expect([...names.values()]).toEqual(["An Nguyễn", "An Trần", "Chi"]);
  });
});

describe("percentChange", () => {
  it("handles growth, decline and no baseline", () => {
    expect(percentChange(120, 100)).toBe("+20%");
    expect(percentChange(80, 100)).toBe("-20%");
    expect(percentChange(100, 0)).toBe("—");
  });
});

describe("ICT time helpers", () => {
  it("23:30 UTC on the 31st is already the 1st in ICT", () => {
    const now = new Date("2026-10-31T23:30:00Z");
    expect(todayIct(now)).toBe("2026-11-01");
    expect(currentMonthIct(now)).toEqual({ year: 2026, month: 11 });
  });

  it("16:59 UTC is still the same ICT day", () => {
    expect(todayIct(new Date("2026-10-08T16:59:59Z"))).toBe("2026-10-08");
    expect(todayIct(new Date("2026-10-08T17:00:00Z"))).toBe("2026-10-09");
  });

  it("computes month ranges including leap February", () => {
    expect(monthRange({ year: 2028, month: 2 })).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange({ year: 2026, month: 12 })).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(previousMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });

  it("formats a month key", () => {
    expect(monthKey({ year: 2026, month: 1 })).toBe("2026-01");
    expect(monthKey({ year: 2026, month: 12 })).toBe("2026-12");
  });
});

describe("usedPercent", () => {
  it.each([
    [799_999, 1_000_000, 79],
    [800_000, 1_000_000, 80],
    [999_999, 1_000_000, 99],
    [1_000_000, 1_000_000, 100],
    [0, 5_000_000, 0],
    [1_234_567, 1_000_000, 123],
  ])("%i of %i is %i%%", (spent, budget, expected) => {
    expect(usedPercent(spent, budget)).toBe(expected);
  });
});

describe("reachedThreshold", () => {
  it.each([
    [799_999, 0],
    [800_000, 80],
    [999_999, 80],
    [1_000_000, 100],
    [5_000_000, 100],
  ])("%i of 1.000.000 reaches level %i", (spent, level) => {
    expect(reachedThreshold(spent, 1_000_000)).toBe(level);
  });
});

describe("parseCommand", () => {
  const bot = "spending_test_bot";
  it("strips @BotName and keeps args", () => {
    expect(parseCommand("/add@Spending_Test_Bot 50k cafe", bot)).toEqual({ name: "add", args: " 50k cafe" });
    expect(parseCommand("/check", bot)).toEqual({ name: "check", args: "" });
  });
  it("ignores commands for other bots and non-commands", () => {
    expect(parseCommand("/add@other_bot 50k", bot)).toBeNull();
    expect(parseCommand("hello /add", bot)).toBeNull();
    expect(parseCommand("/add-x 5", bot)).toBeNull();
  });
});

describe("parseMonthArgs", () => {
  const current = { year: 2026, month: 10 };
  it("defaults and parses month/year", () => {
    expect(parseMonthArgs("", current)).toEqual(current);
    expect(parseMonthArgs(" 9", current)).toEqual({ year: 2026, month: 9 });
    expect(parseMonthArgs("12 2025", current)).toEqual({ year: 2025, month: 12 });
  });
  it("rejects bad input", () => {
    expect(parseMonthArgs("13", current)).toBeNull();
    expect(parseMonthArgs("abc", current)).toBeNull();
    expect(parseMonthArgs("1 2 3", current)).toBeNull();
  });
});
