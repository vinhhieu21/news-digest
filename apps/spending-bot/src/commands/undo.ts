import { undoExpenseByMessage, undoLastExpense } from "../db";
import { UNDO_NOT_YOURS, undoneMessage } from "../report/format";
import type { TgMessage } from "../telegram";
import { reply, type CommandContext } from "./context";

/** Plain /undo removes the sender's latest expense; /undo as a reply to their /add removes that one. */
export async function undo(ctx: CommandContext): Promise<void> {
  const nowIso = ctx.now.toISOString();
  const target = repliedMessageId(ctx.message);
  if (target !== null) {
    const removed = await undoExpenseByMessage(ctx.db, ctx.chatId, ctx.user.id, target, nowIso);
    await reply(ctx, removed ? undoneMessage(removed) : UNDO_NOT_YOURS);
    return;
  }
  const removed = await undoLastExpense(ctx.db, ctx.chatId, ctx.user.id, nowIso);
  await reply(ctx, removed ? undoneMessage(removed) : "Bạn không có khoản chi nào để xoá.");
}

/** The message explicitly replied to, or null. */
function repliedMessageId(message: TgMessage): number | null {
  const target = message.reply_to_message;
  if (!target) return null;
  // In forum topics every message carries the topic's opening message as reply_to_message.
  if (message.is_topic_message && target.message_id === message.message_thread_id) return null;
  return target.message_id;
}
