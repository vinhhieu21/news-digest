// Chat filtering, `/cmd@BotName` stripping and command dispatch. Edited messages go through the
// same gate but only /add reacts to them.

import type { Llm } from "./ai/llm";
import { add, editAdd } from "./commands/add";
import { check } from "./commands/check";
import type { CommandHandler } from "./commands/context";
import { daily } from "./commands/daily";
import { help } from "./commands/help";
import { summary } from "./commands/summary";
import { undo } from "./commands/undo";
import { upsertMember } from "./db";
import { DM_NOTICE, GENERIC_ERROR } from "./report/format";
import type { Telegram, TgChat, TgMessage, TgUpdate } from "./telegram";

const COMMANDS: Record<string, CommandHandler> = { add, check, summary, undo, daily, help, start: help };

/** Commands that act on an edit of their message. Others ignore edits (an edited /undo must not delete again). */
const EDIT_COMMANDS: Record<string, CommandHandler> = { add: editAdd };

export interface RouterDeps {
  db: D1Database;
  tg: Telegram;
  /** null until configured: the bot then only logs chat ids, so the group id can be discovered. */
  allowedChatId: number | null;
  botUsername: string;
  now: Date;
  llm: Llm | null;
  defer: (task: () => Promise<unknown>) => void;
}

export interface ParsedCommand {
  name: string;
  args: string;
}

/**
 * "/add@MyBot 50k cafe" -> { name: "add", args: " 50k cafe" }.
 * Returns null for non-commands and for commands addressed to a different bot.
 */
export function parseCommand(text: string, botUsername: string): ParsedCommand | null {
  const match = /^\/([a-z0-9_]{1,32})(?:@([A-Za-z0-9_]+))?(?=\s|$)([\s\S]*)$/i.exec(text);
  if (!match) return null;
  const [, name, target, args = ""] = match;
  if (target && target.toLowerCase() !== botUsername.toLowerCase()) return null;
  return { name: name!.toLowerCase(), args };
}

export async function handleUpdate(update: TgUpdate, deps: RouterDeps): Promise<void> {
  if (update.my_chat_member) {
    await handleMembership(update.my_chat_member.chat, update.my_chat_member.new_chat_member.status, deps);
    return;
  }
  if (update.message) await handleMessage(update.message, deps, false);
  if (update.edited_message) await handleMessage(update.edited_message, deps, true);
}

async function handleMembership(chat: TgChat, status: string, deps: RouterDeps): Promise<void> {
  if (chat.type === "private") return;
  if (deps.allowedChatId === null) {
    console.log("bot membership changed", { chat_id: chat.id, title: chat.title, status });
    return;
  }
  if (chat.id !== deps.allowedChatId && (status === "member" || status === "administrator")) {
    await deps.tg.leaveChat(chat.id);
  }
}

async function handleMessage(message: TgMessage, deps: RouterDeps, edited: boolean): Promise<void> {
  const { chat } = message;

  if (chat.type === "private") {
    if (!edited) await deps.tg.sendMessage(chat.id, DM_NOTICE); // already told when the message was sent
    return;
  }
  if (deps.allowedChatId === null) {
    console.log("message from unconfigured chat", { chat_id: chat.id, title: chat.title });
    return;
  }
  if (chat.id !== deps.allowedChatId) {
    await deps.tg.leaveChat(chat.id);
    return;
  }

  const user = message.from;
  if (!user || user.is_bot || !message.text) return;

  const command = parseCommand(message.text, deps.botUsername);
  const handler = command && (edited ? EDIT_COMMANDS : COMMANDS)[command.name];
  if (!command || !handler) return;

  try {
    await upsertMember(deps.db, user, deps.now.toISOString());
    await handler({ db: deps.db, tg: deps.tg, chatId: chat.id, message, user, args: command.args, now: deps.now, llm: deps.llm, defer: deps.defer });
  } catch (err) {
    console.error(`command /${command.name}${edited ? " (edited)" : ""} failed`, err);
    await deps.tg.sendMessage(chat.id, GENERIC_ERROR, message.message_id);
  }
}
