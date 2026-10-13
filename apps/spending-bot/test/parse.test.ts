import { describe, expect, it } from "vitest";
import { parseAdd } from "../src/parse/add";
import { parseAmount } from "../src/parse/amount";
import { extractDate } from "../src/parse/date";

const TODAY = "2026-10-08";

describe("parseAdd: plan's Parsing test table", () => {
  it.each([
    ["50k cafe sáng", 50_000, "cafe sáng", TODAY],
    ["32.5k grab", 32_500, "grab", TODAY],
    ["1tr2 tiền nhà", 1_200_000, "tiền nhà", TODAY],
    ["1tr25 sửa xe", 1_250_000, "sửa xe", TODAY],
    ["1.5tr", 1_500_000, "", TODAY],
    ["1.250.000 điện", 1_250_000, "điện", TODAY],
    ["45k cafe hôm qua", 45_000, "cafe", "2026-10-07"],
    ["120k lẩu 05/10", 120_000, "lẩu", "2026-10-05"],
    ["50kđ cafe", 50_000, "cafe", TODAY],
    ["50 kđ cafe", 50_000, "cafe", TODAY],
    ["50.000 đ cafe", 50_000, "cafe", TODAY],
  ])("%s", (input, amount, note, spentOn) => {
    expect(parseAdd(input, TODAY)).toEqual({ ok: true, amount, note, spentOn });
  });

  it.each([
    ["50 cafe", "needs_unit"],
    ["cafe 50k", "invalid"],
    ["abc", "invalid"],
    ["", "missing"],
  ])("rejects %j", (input, reason) => {
    expect(parseAdd(input, TODAY)).toEqual({ ok: false, reason });
  });
});

describe("parseAmount", () => {
  it.each([
    ["50K", 50_000],
    ["32,5k", 32_500],
    ["50nghìn", 50_000],
    ["50ngàn", 50_000],
    ["1tr", 1_000_000],
    ["1triệu", 1_000_000],
    ["2m", 2_000_000],
    ["1tr250", 1_250_000],
    ["50.000", 50_000],
    ["50,000", 50_000],
    ["50000", 50_000],
    ["1000", 1_000],
    ["100tr", 100_000_000],
    ["50.000đ", 50_000],
    ["50kđ", 50_000],
    ["1.5trđ", 1_500_000],
    ["2mvnd", 2_000_000],
    ["50.000VNĐ", 50_000],
    ["50kvnđ", 50_000],
  ])("%s = %d", (token, amount) => {
    expect(parseAmount(token)).toEqual({ ok: true, amount });
  });

  it.each([
    ["999", "needs_unit"],
    ["0.5k", "out_of_range"],
    ["101tr", "out_of_range"],
    ["1.2345k", "invalid"],
    ["50x", "invalid"],
    ["5.0.0", "invalid"],
    ["-50k", "invalid"],
  ])("rejects %s (%s)", (token, reason) => {
    expect(parseAmount(token)).toEqual({ ok: false, reason });
  });
});

describe("parseAdd: unit separated from the amount by a space", () => {
  const joined: [string, string][] = [
    ["50 nghìn cafe", "50nghìn cafe"],
    ["2 tr tiền nhà", "2tr tiền nhà"],
    ["1,5 triệu vé máy bay", "1,5triệu vé máy bay"],
    ["50 k cafe", "50k cafe"],
    ["50 ngàn cafe", "50ngàn cafe"],
    ["50 nghin cafe", "50nghin cafe"],
    ["50 ngan cafe", "50ngan cafe"],
    ["2 trieu thuê", "2trieu thuê"],
    ["2 m thuê", "2m thuê"],
    ["50 NGHÌN cafe", "50NGHÌN cafe"],
    ["50 K cafe", "50K cafe"],
    ["50 nghìn cafe hôm qua", "50nghìn cafe hôm qua"],
    ["50 nghìn", "50nghìn"],
    ["  50   nghìn   cafe  ", "50nghìn cafe"],
  ];
  it.each(joined)("%s equals %s", (spaced, unspaced) => {
    const result = parseAdd(spaced, TODAY);
    expect(result.ok).toBe(true);
    expect(result).toEqual(parseAdd(unspaced, TODAY));
  });

  it("gives the expected values for the user examples", () => {
    expect(parseAdd("50 nghìn cafe", TODAY)).toEqual({ ok: true, amount: 50_000, note: "cafe", spentOn: TODAY });
    expect(parseAdd("2 tr tiền nhà", TODAY)).toEqual({ ok: true, amount: 2_000_000, note: "tiền nhà", spentOn: TODAY });
    expect(parseAdd("1,5 triệu vé máy bay", TODAY)).toEqual({
      ok: true,
      amount: 1_500_000,
      note: "vé máy bay",
      spentOn: TODAY,
    });
    expect(parseAdd("50 nghìn cafe hôm qua", TODAY)).toEqual({
      ok: true,
      amount: 50_000,
      note: "cafe",
      spentOn: "2026-10-07",
    });
  });

  it("does not join a note that only starts with unit letters", () => {
    expect(parseAdd("50000 ngân hàng", TODAY)).toEqual({ ok: true, amount: 50_000, note: "ngân hàng", spentOn: TODAY });
    expect(parseAdd("50000 trà sữa", TODAY)).toEqual({ ok: true, amount: 50_000, note: "trà sữa", spentOn: TODAY });
    expect(parseAdd("50000 kem", TODAY)).toEqual({ ok: true, amount: 50_000, note: "kem", spentOn: TODAY });
  });

  it("keeps inputs that already parse: a valid amount is never joined with a unit-like note", () => {
    expect(parseAdd("50000 ngan hang", TODAY)).toEqual({ ok: true, amount: 50_000, note: "ngan hang", spentOn: TODAY });
    expect(parseAdd("1500 k", TODAY)).toEqual({ ok: true, amount: 1_500, note: "k", spentOn: TODAY });
    expect(parseAdd("2000 m", TODAY)).toEqual({ ok: true, amount: 2_000, note: "m", spentOn: TODAY });
  });

  it("reports the joined result's reason when the join fails", () => {
    expect(parseAdd("0,5 nghìn", TODAY)).toEqual({ ok: false, reason: "out_of_range" });
  });

  it("keeps the needs_unit hint for a small number followed by a plain note", () => {
    expect(parseAdd("50 cafe", TODAY)).toEqual({ ok: false, reason: "needs_unit" });
  });

  it("does not join when the first token already has a unit", () => {
    expect(parseAdd("50k k", TODAY)).toEqual({ ok: true, amount: 50_000, note: "k", spentOn: TODAY });
  });
});

describe("extractDate", () => {
  it("accepts unaccented and short forms of yesterday", () => {
    expect(extractDate("hom qua cafe", TODAY)).toEqual({ ok: true, spentOn: "2026-10-07", note: "cafe" });
    expect(extractDate("bún HQUA", TODAY)).toEqual({ ok: true, spentOn: "2026-10-07", note: "bún" });
  });

  it("uses last year for a dd/mm in the future", () => {
    expect(extractDate("vé 20/12", TODAY)).toEqual({ ok: true, spentOn: "2025-12-20", note: "vé" });
  });

  it("accepts today as dd/mm", () => {
    expect(extractDate("8/10", TODAY)).toEqual({ ok: true, spentOn: TODAY, note: "" });
  });

  it("rejects impossible dates", () => {
    expect(extractDate("31/02", TODAY)).toEqual({ ok: false, reason: "invalid_date" });
  });

  it("crosses month and year boundaries for yesterday", () => {
    expect(extractDate("hôm qua", "2026-01-01")).toEqual({ ok: true, spentOn: "2025-12-31", note: "" });
  });

  it("does not treat words containing qua as a date", () => {
    expect(extractDate("hoa quả", TODAY)).toEqual({ ok: true, spentOn: TODAY, note: "hoa quả" });
  });

  it("does not treat fractions as dates", () => {
    expect(extractDate("mua 2/3 kg gạo", TODAY)).toEqual({ ok: true, spentOn: TODAY, note: "mua 2/3 kg gạo" });
    expect(extractDate("sữa 2/3 l", TODAY)).toEqual({ ok: true, spentOn: TODAY, note: "sữa 2/3 l" });
  });

  it.each([
    ["cân"], ["can"], ["ký"], ["ky"], ["kí"], ["ki"],
    ["lạng"], ["lang"], ["lít"], ["lit"], ["hộp"], ["hop"],
    ["gói"], ["goi"], ["chai"], ["lon"], ["con"], ["cái"],
    ["cai"], ["quả"], ["qua"], ["trái"], ["trai"],
    ["kg"], ["g"], ["ml"], ["l"], ["km"], ["m"], ["cm"], ["mm"],
  ])("does not treat 1/2 %s as a date", (unit) => {
    expect(extractDate(`thịt 1/2 ${unit}`, TODAY)).toEqual({ ok: true, spentOn: TODAY, note: `thịt 1/2 ${unit}` });
  });

  it("still finds a real date after a fraction", () => {
    expect(extractDate("mua 2/3 kg gạo 05/10", TODAY)).toEqual({
      ok: true,
      spentOn: "2026-10-05",
      note: "mua 2/3 kg gạo",
    });
  });
});
