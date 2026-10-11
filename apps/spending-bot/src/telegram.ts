// Minimal Telegram Bot API client over plain fetch.

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  /** Forum topics: the topic id, which is the id of the topic's opening message. */
  message_thread_id?: number;
  is_topic_message?: boolean;
  reply_to_message?: TgMessage;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  new_chat_member: { status: string; user: TgUser };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  my_chat_member?: TgChatMemberUpdated;
}

export class Telegram {
  constructor(private readonly token: string) {}

  /** Sends an HTML message. Returns false (and logs) on failure instead of throwing. */
  async sendMessage(chatId: number, text: string, replyTo?: number): Promise<boolean> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    };
    if (replyTo !== undefined) body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
    return this.call("sendMessage", body);
  }

  async leaveChat(chatId: number): Promise<boolean> {
    return this.call("leaveChat", { chat_id: chatId });
  }

  private async call(method: string, body: unknown): Promise<boolean> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return true;
      // Never log the URL: it contains the bot token.
      console.error(`telegram ${method} failed`, res.status, await res.text());
    } catch (err) {
      console.error(`telegram ${method} error`, err instanceof Error ? err.message : String(err));
    }
    return false;
  }
}
