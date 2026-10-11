import { getBudget, groupTotal, memberTotals } from "../db";
import { checkMessage } from "../report/format";
import { currentMonthIct, monthRange, todayIct } from "../time";
import { reply, type CommandContext } from "./context";

export async function check(ctx: CommandContext): Promise<void> {
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
