// Pure parser for the full `/add <amount> [note] [date]` argument string.

import { isUnitWord, parseAmount } from "./amount";
import { extractDate } from "./date";

export type AddResult =
  | { ok: true; amount: number; note: string; spentOn: string }
  | { ok: false; reason: "missing" | "invalid" | "needs_unit" | "out_of_range" | "invalid_date" };

/** A detached đồng sign: "50.000 đ", "50 kđ". Stripped for the unit join below. */
function stripDong(word: string): string {
  return word
    .normalize("NFC")
    .toLowerCase()
    .replace(/(vn[dđ]|đ|d)$/, "");
}

/** True for a bare đồng-sign token ("đ", "d", "vnd", "vnđ"). */
function isDongWord(word: string): boolean {
  return /^(vn[dđ]|đ|d)$/.test(word.normalize("NFC").toLowerCase());
}

export function parseAdd(args: string, today: string): AddResult {
  const trimmed = args.trim();
  if (trimmed === "") return { ok: false, reason: "missing" };

  const [first = "", ...afterFirst] = trimmed.split(/\s+/);
  // "50 nghìn cafe" means "50nghìn cafe". Join only when the first token alone is not an
  // amount, so "50000 ngan hang" stays 50.000đ with the note "ngan hang".
  let amount = parseAmount(first);
  let rest = afterFirst;
  const secondRaw = afterFirst[0];
  const second = secondRaw === undefined ? undefined : stripDong(secondRaw);
  if (!amount.ok && second !== undefined && isUnitWord(second)) {
    amount = parseAmount(first + second);
    rest = afterFirst.slice(1);
  }
  if (!amount.ok) return amount;

  // A detached đồng sign right after the amount ("50.000 đ cafe") is not part of the note.
  if (rest[0] !== undefined && isDongWord(rest[0])) rest = rest.slice(1);

  const date = extractDate(rest.join(" "), today);
  if (!date.ok) return date;

  return { ok: true, amount: amount.amount, note: date.note, spentOn: date.spentOn };
}
