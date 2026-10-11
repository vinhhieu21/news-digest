// Pure VND amount parser. See the "Parsing rules" section of the plan.

export const MIN_AMOUNT = 1_000;
export const MAX_AMOUNT = 100_000_000;

export type AmountResult =
  | { ok: true; amount: number }
  | { ok: false; reason: "invalid" | "needs_unit" | "out_of_range" };

const THOUSAND_UNITS = ["k", "nghìn", "ngàn", "nghin", "ngan"];
const MILLION_UNITS = ["tr", "triệu", "trieu", "m"];

/** True if the word is exactly a thousand/million unit ("k", "nghìn", "tr", ...), case-insensitive. */
export function isUnitWord(word: string): boolean {
  const w = word.normalize("NFC").toLowerCase();
  return THOUSAND_UNITS.includes(w) || MILLION_UNITS.includes(w);
}

// "1tr2" = 1.200.000, "1tr25" = 1.250.000: digits after "tr" continue the millions.
const MILLION_SHORTHAND = /^(\d+)(?:tr|triệu|trieu)(\d{1,3})$/;
// "50k", "32.5k", "32,5k", "1.5tr", "2m"
const WITH_UNIT = /^(\d+)(?:[.,](\d+))?([^\d.,]+)$/;
// "50.000", "1,250,000": a separator followed by exactly 3 digits is a thousands separator.
const GROUPED = /^\d{1,3}(?:[.,]\d{3})+$/;
const PLAIN = /^\d+$/;

export function parseAmount(token: string): AmountResult {
  const t = token.normalize("NFC").toLowerCase();

  const shorthand = MILLION_SHORTHAND.exec(t);
  if (shorthand) {
    const [, millions, rest] = shorthand;
    return inRange(Number(millions) * 1_000_000 + Number(rest!.padEnd(3, "0")) * 1_000);
  }

  const withUnit = WITH_UNIT.exec(t);
  if (withUnit) {
    const [, intPart, fracPart = "", unit] = withUnit;
    const multiplier = THOUSAND_UNITS.includes(unit!) ? 1_000 : MILLION_UNITS.includes(unit!) ? 1_000_000 : 0;
    if (multiplier === 0) return { ok: false, reason: "invalid" };
    const amount = scaleDecimal(intPart!, fracPart, multiplier);
    return amount === null ? { ok: false, reason: "invalid" } : inRange(amount);
  }

  if (GROUPED.test(t)) return inRange(Number(t.replace(/[.,]/g, "")));

  if (PLAIN.test(t)) {
    const amount = Number(t);
    if (amount < MIN_AMOUNT) return { ok: false, reason: "needs_unit" };
    return inRange(amount);
  }

  return { ok: false, reason: "invalid" };
}

/** intPart.fracPart * multiplier, in integers; null if the result is not whole dong. */
function scaleDecimal(intPart: string, fracPart: string, multiplier: number): number | null {
  const scale = 10 ** fracPart.length;
  const numerator = Number(intPart + fracPart) * multiplier;
  if (numerator % scale !== 0) return null;
  return numerator / scale;
}

function inRange(amount: number): AmountResult {
  if (!Number.isSafeInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, amount };
}
