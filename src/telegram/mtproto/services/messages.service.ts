import type { TelegramEntityInput } from "./entity-resolver.js";
import { EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function toMessageSummary(message: any) {
  return {
    id: message.id,
    date: message.date,
    senderId: message.senderId,
    text: message.message,
    out: message.out,
    media: message.media ? { className: message.media.className } : null,
    reactions: message.reactions ?? null,
    replyTo: message.replyTo ?? null,
  };
}

function getButtonsFromMessage(message: any): Array<{
  index: number;
  text: string;
  hasCallback: boolean;
  url?: string;
  data?: Buffer;
}> {
  const rows = message?.replyMarkup?.rows;
  if (!Array.isArray(rows)) {
    return [];
  }
  const output: Array<{
    index: number;
    text: string;
    hasCallback: boolean;
    url?: string;
    data?: Buffer;
  }> = [];
  let index = 0;
  for (const row of rows) {
    const buttons = row?.buttons ?? [];
    for (const button of buttons) {
      const data = button?.data;
      output.push({
        index,
        text: button?.text ?? "",
        hasCallback: Boolean(data),
        url: button?.url,
        data,
      });
      index += 1;
    }
  }
  return output;
}

export class MessagesService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
  ) {}

  async getMessages(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    page?: number;
    pageSize?: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "get_messages", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? 20;
      const limit = page * pageSize;
      const messages = await client.getMessages(entity, { limit });
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      return {
        page,
        pageSize,
        totalFetched: messages.length,
        messages: messages.slice(start, end).map((message: any) => toMessageSummary(message)),
      };
    });
  }

  async listMessages(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    limit?: number;
    searchQuery?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    return this.context.withClient(input.accountRef, "messages", "list_messages", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const messages = await client.getMessages(entity, {
        limit: input.limit ?? 100,
        search: input.searchQuery,
      });
      const fromDate = input.fromDate ? new Date(input.fromDate).getTime() : null;
      const toDate = input.toDate ? new Date(input.toDate).getTime() : null;
      const filtered = messages.filter((message: any) => {
        const timestamp = message.date ? new Date(message.date).getTime() : null;
        if (timestamp === null) {
          return true;
        }
        if (fromDate && timestamp < fromDate) {
          return false;
        }
        if (toDate && timestamp > toDate) {
          return false;
        }
        return true;
      });
      return {
        count: filtered.length,
        messages: filtered.map((message: any) => toMessageSummary(message)),
      };
    });
  }

  async listTopics(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    limit?: number;
    searchQuery?: string;
  }) {
    return this.context.withClient(input.accountRef, "messages", "list_topics", async ({ client, gram }) => {
      const channel = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.GetForumTopics({
          channel,
          offsetDate: 0,
          offsetId: 0,
          offsetTopic: 0,
          limit: input.limit ?? 30,
          q: input.searchQuery ?? "",
        }),
      );
      return { ok: true, result };
    });
  }

  async sendMessage(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    message: string;
  }) {
    return this.context.withClient(input.accountRef, "messages", "send_message", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const sent = await client.sendMessage(entity, { message: input.message });
      return { ok: true, messageId: sent.id };
    });
  }

  async replyToMessage(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
    text: string;
  }) {
    return this.context.withClient(input.accountRef, "messages", "reply_to_message", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const sent = await client.sendMessage(entity, {
        message: input.text,
        replyTo: input.messageId,
      });
      return { ok: true, messageId: sent.id };
    });
  }

  async editMessage(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
    newText: string;
  }) {
    return this.context.withClient(input.accountRef, "messages", "edit_message", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const result = await client.editMessage(entity, {
        message: input.messageId,
        text: input.newText,
      });
      return { ok: true, result };
    });
  }

  async deleteMessage(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "delete_message", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const result = await client.deleteMessages(entity, [input.messageId], { revoke: true });
      return { ok: true, result };
    });
  }

  async forwardMessage(input: {
    accountRef: string;
    fromChatId: TelegramEntityInput;
    toChatId: TelegramEntityInput;
    messageId: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "forward_message", async ({ client }) => {
      const from = await this.resolver.resolveEntity(client, input.fromChatId);
      const to = await this.resolver.resolveEntity(client, input.toChatId);
      const result = await client.forwardMessages(to, {
        messages: [input.messageId],
        fromPeer: from,
      });
      return { ok: true, result };
    });
  }

  async pinMessage(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "pin_message", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const result = await client.pinMessage(entity, input.messageId, {
        notify: false,
      });
      return { ok: true, result };
    });
  }

  async unpinMessage(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId?: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "unpin_message", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const result =
        input.messageId === undefined
          ? await client.unpinMessage(entity)
          : await client.unpinMessage(entity, input.messageId);
      return { ok: true, result };
    });
  }

  async markAsRead(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "messages", "mark_as_read", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const result = await client.markAsRead(entity);
      return { ok: true, result };
    });
  }

  async getMessageContext(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
    contextSize?: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "get_message_context", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const center = await client.getMessages(entity, { ids: input.messageId });
      const around = await client.getMessages(entity, {
        limit: (input.contextSize ?? 5) * 2 + 1,
      });
      return {
        center: center?.[0] ? toMessageSummary(center[0]) : null,
        around: around.map((message: any) => toMessageSummary(message)),
      };
    });
  }

  async getHistory(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    limit?: number;
  }) {
    return this.listMessages({
      accountRef: input.accountRef,
      chatId: input.chatId,
      limit: input.limit ?? 200,
    });
  }

  async getPinnedMessages(input: { accountRef: string; chatId: TelegramEntityInput; limit?: number }) {
    return this.context.withClient(input.accountRef, "messages", "get_pinned_messages", async ({ client, gram }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.messages.GetPinnedDialogs({
          folderId: 0,
        }),
      );
      return {
        ok: true,
        result,
        peer,
        note: "Telegram API does not expose direct per-chat pinned list in one call; inspect result dialogs.",
      };
    });
  }

  async getLastInteraction(input: {
    accountRef: string;
    contactId: TelegramEntityInput;
  }) {
    return this.context.withClient(input.accountRef, "messages", "get_last_interaction", async ({ client }) => {
      const peer = await this.resolver.resolveEntity(client, input.contactId);
      const messages = await client.getMessages(peer, { limit: 1 });
      return {
        ok: true,
        message: messages[0] ? toMessageSummary(messages[0]) : null,
      };
    });
  }

  async createPoll(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    question: string;
    options: string[];
    multipleChoice?: boolean;
    quizMode?: boolean;
    publicVotes?: boolean;
    closeDate?: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "create_poll", async ({ client, gram }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const pollAnswers = input.options.map(
        (option, index) =>
          new Api.PollAnswer({
            text: option,
            option: Buffer.from(`option-${index}`, "utf8"),
          }),
      );
      const poll = new Api.Poll({
        id: BigInt(Date.now()),
        question: input.question,
        answers: pollAnswers,
        multipleChoice: Boolean(input.multipleChoice),
        quiz: Boolean(input.quizMode),
        publicVoters: input.publicVotes !== false,
        closed: false,
      });
      const result = await client.invoke(
        new Api.messages.SendMedia({
          peer,
          message: input.question,
          media: new Api.InputMediaPoll({
            poll,
          }),
          randomId: BigInt(Date.now()),
        }),
      );
      return { ok: true, result };
    });
  }

  async listInlineButtons(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId?: number;
    limit?: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "list_inline_buttons", async ({ client }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      let message: any = null;
      if (input.messageId) {
        const fetched = await client.getMessages(peer, { ids: input.messageId });
        message = fetched[0] ?? null;
      } else {
        const recent = await client.getMessages(peer, { limit: input.limit ?? 20 });
        message = recent.find((candidate: any) => getButtonsFromMessage(candidate).length > 0) ?? null;
      }
      if (!message) {
        return { ok: true, buttons: [], messageId: null };
      }
      const buttons = getButtonsFromMessage(message);
      return {
        ok: true,
        messageId: message.id,
        buttons: buttons.map((button) => ({
          index: button.index,
          text: button.text,
          hasCallback: button.hasCallback,
          url: button.url,
        })),
      };
    });
  }

  async pressInlineButton(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId?: number;
    buttonText?: string;
    buttonIndex?: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "press_inline_button", async ({ client, gram }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      let message: any = null;
      if (input.messageId) {
        const fetched = await client.getMessages(peer, { ids: input.messageId });
        message = fetched[0] ?? null;
      } else {
        const recent = await client.getMessages(peer, { limit: 30 });
        message = recent.find((candidate: any) => getButtonsFromMessage(candidate).length > 0) ?? null;
      }
      if (!message) {
        throw new Error("No message with inline buttons found");
      }
      const buttons = getButtonsFromMessage(message);
      if (buttons.length === 0) {
        throw new Error("Message does not contain inline buttons");
      }
      let selected = input.buttonIndex !== undefined ? buttons.find((button) => button.index === input.buttonIndex) : null;
      if (!selected && input.buttonText) {
        selected = buttons.find(
          (button) => normalizeText(button.text) === normalizeText(input.buttonText ?? ""),
        );
      }
      if (!selected) {
        throw new Error("Inline button not found");
      }
      if (!selected.data) {
        return {
          ok: false,
          reason: "Button has no callback data",
          button: {
            index: selected.index,
            text: selected.text,
            url: selected.url,
          },
        };
      }
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.messages.GetBotCallbackAnswer({
          peer,
          msgId: message.id,
          data: selected.data,
        }),
      );
      return {
        ok: true,
        messageId: message.id,
        button: {
          index: selected.index,
          text: selected.text,
        },
        result,
      };
    });
  }

  async sendReaction(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
    emoji: string;
    big?: boolean;
  }) {
    return this.context.withClient(input.accountRef, "messages", "send_reaction", async ({ client, gram }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: input.messageId,
          reaction: [new Api.ReactionEmoji({ emoticon: input.emoji })],
          big: Boolean(input.big),
          addToRecent: true,
        }),
      );
      return { ok: true, result };
    });
  }

  async removeReaction(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "remove_reaction", async ({ client, gram }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: input.messageId,
          reaction: [],
          big: false,
          addToRecent: false,
        }),
      );
      return { ok: true, result };
    });
  }

  async getMessageReactions(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
  }) {
    return this.context.withClient(input.accountRef, "messages", "get_message_reactions", async ({ client }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const fetched = await client.getMessages(peer, { ids: input.messageId });
      const message = fetched[0];
      if (!message) {
        return { ok: false, error: "message not found" };
      }
      return {
        ok: true,
        messageId: message.id,
        reactions: message.reactions ?? null,
      };
    });
  }
}
