import type { TelegramEntityInput } from "./entity-resolver.js";
import { EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

function toSearchEntity(entity: any) {
  return {
    id: entity?.id ?? null,
    title: entity?.title ?? null,
    username: entity?.username ?? null,
    firstName: entity?.firstName ?? entity?.first_name ?? null,
    lastName: entity?.lastName ?? entity?.last_name ?? null,
    className: entity?.className ?? null,
  };
}

export class SearchService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
  ) {}

  async searchPublicChats(input: { accountRef: string; query: string; limit?: number }) {
    return this.context.withClient(input.accountRef, "search", "search_public_chats", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.contacts.Search({
          q: input.query,
          limit: input.limit ?? 20,
        }),
      );
      const users = Array.isArray((result as any).users) ? (result as any).users : [];
      const chats = Array.isArray((result as any).chats) ? (result as any).chats : [];
      return {
        ok: true,
        users: users.map((entity: any) => toSearchEntity(entity)),
        chats: chats.map((entity: any) => toSearchEntity(entity)),
      };
    });
  }

  async searchMessages(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    query: string;
    limit?: number;
  }) {
    return this.context.withClient(input.accountRef, "search", "search_messages", async ({ client }) => {
      const chat = await this.resolver.resolveEntity(client, input.chatId);
      const messages = await client.getMessages(chat, {
        search: input.query,
        limit: input.limit ?? 50,
      });
      return {
        ok: true,
        count: messages.length,
        messages: messages.map((message: any) => ({
          id: message.id,
          date: message.date,
          text: message.message,
          senderId: message.senderId,
        })),
      };
    });
  }

  async resolveUsername(input: { accountRef: string; username: string }) {
    return this.context.withClient(input.accountRef, "search", "resolve_username", async ({ client }) => {
      const username = input.username.startsWith("@")
        ? input.username
        : `@${input.username}`;
      const entity = await this.resolver.resolveEntity(client, username);
      return {
        ok: true,
        entity: toSearchEntity(entity),
      };
    });
  }
}
