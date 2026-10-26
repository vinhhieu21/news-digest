import { getBudget, groupTotal, memberTotals, userStats, userTotal } from "../db";
import { checkMessage, personalCheckMessage } from "../report/format";
import { currentMonthIct, monthRange, todayIct } from "../time";
import { reply, type CommandContext } from "./context";

/** /check: the sender's own spending this month. */
export async function check(ctx: CommandContext): Promise<void> {
  const today = todayIct(ctx.now);
  const month = currentMonthIct(ctx.now);
  const { from } = monthRange(month);

  const [stats, todayTotal] = await Promise.all([
    userStats(ctx.db, ctx.chatId, ctx.user.id, from, today),
    userTotal(ctx.db, ctx.chatId, ctx.user.id, today, today),
  ]);

  await reply(
    ctx,
    personalCheckMessage({ name: ctx.user.first_name, month, today, total: stats.total, count: stats.count, todayTotal }),
  );
}

/** /groupcheck: every member's spending this month, plus the budget. */
export async function groupCheck(ctx: CommandContext): Promise<void> {
  const today = todayIct(ctx.now);
  const month = currentMonthIct(ctx.now);
  const { from } = monthRange(month);

  const [members, todayTotal, budget] = await Promise.all([
    memberTotals(ctx.db, ctx.chatId, from, today),
    groupTotal(ctx.db, ctx.chatId, today, today),
    getBudget(ctx.db, ctx.chatId),
  ]);
  const monthTotal = members.reduce((sum, m) => sum + m.total, 0);

  await reply(ctx, checkMessage({ month, today, members, todayTotal, monthTotal, budget }));
}
