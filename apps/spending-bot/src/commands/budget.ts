import { claimBudgetWarning, deleteBudget, getBudget, groupTotal, setBudget } from "../db";
import { parseAmount } from "../parse/amount";
import { BUDGET_ERRORS, NO_BUDGET, USAGE, budgetMessage, budgetWarningMessage, usedPercent } from "../report/format";
import type { Telegram } from "../telegram";
import { currentMonthIct, monthKey, monthRange } from "../time";
import { reply, type CommandContext } from "./context";

/** Warning levels, in % of the budget. */
export type BudgetLevel = 0 | 80 | 100;

/** Highest warning level `spent` has reached: 100, 80 or 0. */
export function reachedThreshold(spent: number, budget: number): BudgetLevel {
  const pct = usedPercent(spent, budget);
  return pct >= 100 ? 100 : pct >= 80 ? 80 : 0;
}

export async function budget(ctx: CommandContext): Promise<void> {
  const arg = ctx.args.trim();
  const month = currentMonthIct(ctx.now);
  const { from, to } = monthRange(month);

  if (arg === "") {
    const amount = await getBudget(ctx.db, ctx.chatId);
    if (amount === null) {
      await reply(ctx, `${NO_BUDGET}\n${USAGE.budget}`);
      return;
    }
    const spent = await groupTotal(ctx.db, ctx.chatId, from, to);
    await reply(ctx, budgetMessage({ budget: amount, month, spent }));
    return;
  }

  if (arg.toLowerCase() === "off") {
    const removed = await deleteBudget(ctx.db, ctx.chatId);
    await reply(ctx, removed ? "Đã xoá ngân sách tháng." : NO_BUDGET);
    return;
  }

  if (/\s/.test(arg)) {
    await reply(ctx, USAGE.budget);
    return;
  }

  const parsed = parseAmount(arg);
  if (!parsed.ok) {
    await reply(ctx, BUDGET_ERRORS[parsed.reason]);
    return;
  }

  // Levels already reached under the new amount count as announced (the reply shows the percentage);
  // the rest are re-armed.
  const spent = await groupTotal(ctx.db, ctx.chatId, from, to);
  await setBudget(
    ctx.db,
    ctx.chatId,
    parsed.amount,
    monthKey(month),
    reachedThreshold(spent, parsed.amount),
    ctx.now.toISOString(),
  );
  await reply(ctx, `Đã đặt ngân sách.\n${budgetMessage({ budget: parsed.amount, month, spent })}`);
}

/**
 * Called after an expense is saved. Sends one group warning when this month's spending first
 * reaches 80% or 100% of the budget this month. Expenses dated in an earlier month are ignored.
 */
export async function warnOnBudgetThreshold(
  db: D1Database,
  tg: Telegram,
  chatId: number,
  now: Date,
  spentOn: string,
): Promise<void> {
  const month = currentMonthIct(now);
  const { from, to } = monthRange(month);
  if (spentOn < from) return;

  const amount = await getBudget(db, chatId);
  if (amount === null) return;

  const spent = await groupTotal(db, chatId, from, to);
  const level = reachedThreshold(spent, amount);
  if (level === 0) return;

  if (await claimBudgetWarning(db, chatId, amount, monthKey(month), level)) {
    await tg.sendMessage(chatId, budgetWarningMessage({ budget: amount, month, spent }));
  }
}
