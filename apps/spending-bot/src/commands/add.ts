import { categorizePending } from "../ai/categorize";
import { insertExpense, messageExpenseState, saveEditedExpense, userTotal } from "../db";
import { parseAdd } from "../parse/add";
import { ADD_ERRORS, addedMessage, EDIT_KEPT, EDIT_UNDONE, updatedMessage, type ExpenseView } from "../report/format";
import { currentMonthIct, monthRange, todayIct } from "../time";
import { warnOnBudgetThreshold } from "./budget";
import { reply, type CommandContext } from "./context";

export async function add(ctx: CommandContext): Promise<void> {
  const parsed = parseAdd(ctx.args, todayIct(ctx.now));
  if (!parsed.ok) {
    await reply(ctx, ADD_ERRORS[parsed.reason]);
    return;
  }

  const inserted = await insertExpense(
    ctx.db,
    {
      chatId: ctx.chatId,
      userId: ctx.user.id,
      amount: parsed.amount,
      note: parsed.note,
      spentOn: parsed.spentOn,
      messageId: ctx.message.message_id,
    },
    ctx.now.toISOString(),
  );
  // A later edit of this message was processed first and already saved and confirmed it.
  if (!inserted) return;

  await confirm(ctx, { amount: parsed.amount, note: parsed.note, spent_on: parsed.spentOn }, addedMessage);
}

/**
 * An edited /add message: updates the expense it created, or records it if the original was rejected.
 * An undone expense stays undone.
 */
export async function editAdd(ctx: CommandContext): Promise<void> {
  // Relative dates count from when the message was sent, not edited, so a late typo fix keeps the day.
  const sentOn = todayIct(new Date(ctx.message.date * 1000));
  const parsed = parseAdd(ctx.args, sentOn);
  if (!parsed.ok) {
    const kept = (await messageExpenseState(ctx.db, ctx.chatId, ctx.message.message_id)) === "live";
    await reply(ctx, kept ? `${ADD_ERRORS[parsed.reason]}\n${EDIT_KEPT}` : ADD_ERRORS[parsed.reason]);
    return;
  }

  const result = await saveEditedExpense(
    ctx.db,
    {
      chatId: ctx.chatId,
      userId: ctx.user.id,
      amount: parsed.amount,
      note: parsed.note,
      spentOn: parsed.spentOn,
      messageId: ctx.message.message_id,
    },
    ctx.message.edit_date ?? Math.floor(ctx.now.getTime() / 1000),
    ctx.now.toISOString(),
  );
  // A newer edit was already applied and confirmed.
  if (result === "stale") return;
  if (result === "undone") {
    await reply(ctx, EDIT_UNDONE);
    return;
  }

  const expense = { amount: parsed.amount, note: parsed.note, spent_on: parsed.spentOn };
  await confirm(ctx, expense, result === "updated" ? updatedMessage : addedMessage);
}

/** Replies with the saved expense and the sender's month-to-date, then schedules categorisation. */
async function confirm(ctx: CommandContext, expense: ExpenseView, format: typeof addedMessage): Promise<void> {
  const today = todayIct(ctx.now);
  const month = currentMonthIct(ctx.now);
  const { from, to } = monthRange(month);
  const monthTotal = await userTotal(ctx.db, ctx.chatId, ctx.user.id, from, to);
  await reply(ctx, format({ expense, name: ctx.user.first_name, today, month, monthTotal }));

  // After the reply, so its text never changes; sends at most one budget warning. Edits count too.
  ctx.defer(() => warnOnBudgetThreshold(ctx.db, ctx.tg, ctx.chatId, ctx.now, expense.spent_on));

  // After the reply, so the LLM never delays it. Picks up this expense plus any earlier misses.
  const { llm } = ctx;
  if (llm) {
    const nowIso = ctx.now.toISOString();
    ctx.defer(() => categorizePending(ctx.db, llm, ctx.chatId, nowIso));
  }
}
