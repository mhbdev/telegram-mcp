import type { TelegramEntityInput } from "./entity-resolver.js";
import { EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

export class DraftsService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
  ) {}

  async saveDraft(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    message: string;
    replyToMsgId?: number;
    noWebpage?: boolean;
  }) {
    return this.context.withClient(input.accountRef, "drafts", "save_draft", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const result = await client.invoke(
        new Api.messages.SaveDraft({
          peer,
          message: input.message,
          noWebpage: Boolean(input.noWebpage),
          replyTo: input.replyToMsgId
            ? new Api.InputReplyToMessage({
                replyToMsgId: input.replyToMsgId,
              })
            : undefined,
        }),
      );
      return {
        ok: true,
        result,
      };
    });
  }

  async getDrafts(input: { accountRef: string }) {
    return this.context.withClient(input.accountRef, "drafts", "get_drafts", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const result = await client.invoke(new Api.messages.GetAllDrafts());
      return {
        ok: true,
        result,
      };
    });
  }

  async clearDraft(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "drafts", "clear_draft", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const result = await client.invoke(
        new Api.messages.SaveDraft({
          peer,
          message: "",
          noWebpage: false,
        }),
      );
      return {
        ok: true,
        result,
      };
    });
  }
}
