// Pure parser for the full `/add <amount> [note] [date]` argument string.

import { isUnitWord, parseAmount } from "./amount";
import { extractDate } from "./date";

export type AddResult =
  | { ok: true; amount: number; note: string; spentOn: string }
  | { ok: false; reason: "missing" | "invalid" | "needs_unit" | "out_of_range" | "invalid_date" };

export function parseAdd(args: string, today: string): AddResult {
  const trimmed = args.trim();
  if (trimmed === "") return { ok: false, reason: "missing" };

  const [first = "", ...afterFirst] = trimmed.split(/\s+/);
  // "50 nghìn cafe" means "50nghìn cafe". Join only when the first token alone is not an
  // amount, so "50000 ngan hang" stays 50.000đ with the note "ngan hang".
  let amount = parseAmount(first);
  let rest = afterFirst;
  const second = afterFirst[0];
  if (!amount.ok && second !== undefined && isUnitWord(second)) {
    amount = parseAmount(first + second);
    rest = afterFirst.slice(1);
  }
  if (!amount.ok) return amount;

  const date = extractDate(rest.join(" "), today);
  if (!date.ok) return date;

  return { ok: true, amount: amount.amount, note: date.note, spentOn: date.spentOn };
}
