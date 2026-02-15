import { extractInviteHash, type TelegramEntityInput, EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

function isChannelEntity(entity: unknown): boolean {
  const candidate = entity as { className?: string; megagroup?: boolean };
  return candidate.className === "Channel" || Boolean(candidate.megagroup);
}

function formatDialog(dialog: any) {
  return {
    id: dialog.id,
    name: dialog.name,
    title: dialog.title ?? dialog.name,
    unreadCount: dialog.unreadCount,
    pinned: dialog.pinned,
    isChannel: Boolean(dialog.isChannel),
    isGroup: Boolean(dialog.isGroup),
    isUser: Boolean(dialog.isUser),
  };
}

export class ChatsService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
  ) {}

  async getChats(input: { accountRef: string; page: number; pageSize: number }) {
    return this.context.withClient(input.accountRef, "chats", "get_chats", async ({ client }) => {
      const dialogs = await client.getDialogs({
        limit: Math.max(input.page * input.pageSize, input.pageSize),
      });
      const start = (input.page - 1) * input.pageSize;
      const end = start + input.pageSize;
      return {
        page: input.page,
        pageSize: input.pageSize,
        total: dialogs.length,
        chats: dialogs.slice(start, end).map((dialog: any) => formatDialog(dialog)),
      };
    });
  }

  async listChats(input: {
    accountRef: string;
    chatType?: "all" | "group" | "channel" | "private";
    limit?: number;
  }) {
    return this.context.withClient(input.accountRef, "chats", "list_chats", async ({ client }) => {
      const dialogs = await client.getDialogs({ limit: input.limit ?? 100 });
      const filtered = dialogs.filter((dialog: any) => {
        if (!input.chatType || input.chatType === "all") {
          return true;
        }
        if (input.chatType === "group") {
          return Boolean(dialog.isGroup);
        }
        if (input.chatType === "channel") {
          return Boolean(dialog.isChannel);
        }
        return Boolean(dialog.isUser);
      });
      return {
        count: filtered.length,
        chats: filtered.map((dialog: any) => formatDialog(dialog)),
      };
    });
  }

  async getChat(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "chats", "get_chat", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      let full: unknown = null;
      try {
        if (isChannelEntity(entity)) {
          full = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        } else if ((entity as any)?.className === "Chat") {
          full = await client.invoke(new Api.messages.GetFullChat({ chatId: (entity as any).id }));
        }
      } catch {
        // Best-effort full info; basic entity is still returned.
      }

      return {
        entity,
        full,
      };
    });
  }

  async createGroup(input: {
    accountRef: string;
    title: string;
    userIds: TelegramEntityInput[];
  }) {
    return this.context.withClient(
      input.accountRef,
      "chats",
      "create_group",
      async ({ client, gram }) => {
        const Api = gram.Api as any;
        const users = await Promise.all(
          input.userIds.map((userId) => this.resolver.resolveEntity(client, userId)),
        );
        const result = await client.invoke(
          new Api.messages.CreateChat({
            users,
            title: input.title,
          }),
        );
        return { ok: true, result };
      },
      { userCount: input.userIds.length },
    );
  }

  async inviteToGroup(input: {
    accountRef: string;
    groupId: TelegramEntityInput;
    userIds: TelegramEntityInput[];
  }) {
    return this.context.withClient(
      input.accountRef,
      "chats",
      "invite_to_group",
      async ({ client, gram }) => {
        const target = await this.resolver.resolveEntity(client, input.groupId);
        const users = await Promise.all(
          input.userIds.map((userId) => this.resolver.resolveEntity(client, userId)),
        );
        const Api = gram.Api as any;
        if (isChannelEntity(target)) {
          const result = await client.invoke(
            new Api.channels.InviteToChannel({
              channel: target,
              users,
            }),
          );
          return { ok: true, result };
        }
        const results: unknown[] = [];
        for (const user of users) {
          const addResult = await client.invoke(
            new Api.messages.AddChatUser({
              chatId: (target as any).id,
              userId: user,
              fwdLimit: 10,
            }),
          );
          results.push(addResult);
        }
        return { ok: true, results };
      },
      { userCount: input.userIds.length },
    );
  }

  async createChannel(input: {
    accountRef: string;
    title: string;
    about?: string;
    megagroup?: boolean;
  }) {
    return this.context.withClient(input.accountRef, "chats", "create_channel", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.CreateChannel({
          title: input.title,
          about: input.about ?? "",
          megagroup: Boolean(input.megagroup),
          broadcast: !input.megagroup,
          forum: false,
        }),
      );
      return { ok: true, result };
    });
  }

  async editChatTitle(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    title: string;
  }) {
    return this.context.withClient(input.accountRef, "chats", "edit_chat_title", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const result = isChannelEntity(entity)
        ? await client.invoke(new Api.channels.EditTitle({ channel: entity, title: input.title }))
        : await client.invoke(
            new Api.messages.EditChatTitle({
              chatId: (entity as any).id,
              title: input.title,
            }),
          );
      return { ok: true, result };
    });
  }

  async deleteChatPhoto(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "chats", "delete_chat_photo", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      if (isChannelEntity(entity)) {
        const result = await client.invoke(
          new Api.channels.EditPhoto({
            channel: entity,
            photo: new Api.InputChatPhotoEmpty(),
          }),
        );
        return { ok: true, result };
      }
      const result = await client.invoke(
        new Api.messages.EditChatPhoto({
          chatId: (entity as any).id,
          photo: new Api.InputChatPhotoEmpty(),
        }),
      );
      return { ok: true, result };
    });
  }

  async leaveChat(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "chats", "leave_chat", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      if (isChannelEntity(entity)) {
        const result = await client.invoke(new Api.channels.LeaveChannel({ channel: entity }));
        return { ok: true, result };
      }
      const result = await (client as any).deleteDialog(entity);
      return { ok: true, result };
    });
  }

  async getParticipants(input: { accountRef: string; chatId: TelegramEntityInput; limit?: number }) {
    return this.context.withClient(input.accountRef, "chats", "get_participants", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const participants = await client.getParticipants(entity, {
        limit: input.limit ?? 200,
      });
      return {
        count: participants.length,
        participants: participants.map((participant: any) => ({
          id: participant.id,
          username: participant.username,
          firstName: participant.firstName,
          lastName: participant.lastName,
          bot: participant.bot,
        })),
      };
    });
  }

  async getAdmins(input: { accountRef: string; chatId: TelegramEntityInput; limit?: number }) {
    return this.context.withClient(input.accountRef, "chats", "get_admins", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const participants = await client.getParticipants(entity, {
        limit: input.limit ?? 200,
        filter: new Api.ChannelParticipantsAdmins(),
      });
      return {
        count: participants.length,
        admins: participants.map((participant: any) => ({
          id: participant.id,
          username: participant.username,
          firstName: participant.firstName,
          lastName: participant.lastName,
        })),
      };
    });
  }

  async getBannedUsers(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    limit?: number;
  }) {
    return this.context.withClient(input.accountRef, "chats", "get_banned_users", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const participants = await client.getParticipants(entity, {
        limit: input.limit ?? 200,
        filter: new Api.ChannelParticipantsBanned({ q: "" }),
      });
      return {
        count: participants.length,
        bannedUsers: participants.map((participant: any) => ({
          id: participant.id,
          username: participant.username,
          firstName: participant.firstName,
          lastName: participant.lastName,
        })),
      };
    });
  }

  async promoteAdmin(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    userId: TelegramEntityInput;
  }) {
    return this.context.withClient(input.accountRef, "chats", "promote_admin", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const user = await this.resolver.resolveEntity(client, input.userId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.EditAdmin({
          channel: entity,
          userId: user,
          adminRights: new Api.ChatAdminRights({
            changeInfo: true,
            postMessages: true,
            editMessages: true,
            deleteMessages: true,
            banUsers: true,
            inviteUsers: true,
            pinMessages: true,
            addAdmins: false,
            anonymous: false,
            manageCall: true,
            other: true,
            manageTopics: true,
          }),
          rank: "admin",
        }),
      );
      return { ok: true, result };
    });
  }

  async demoteAdmin(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    userId: TelegramEntityInput;
  }) {
    return this.context.withClient(input.accountRef, "chats", "demote_admin", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const user = await this.resolver.resolveEntity(client, input.userId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.EditAdmin({
          channel: entity,
          userId: user,
          adminRights: new Api.ChatAdminRights({
            changeInfo: false,
            postMessages: false,
            editMessages: false,
            deleteMessages: false,
            banUsers: false,
            inviteUsers: false,
            pinMessages: false,
            addAdmins: false,
            anonymous: false,
            manageCall: false,
            other: false,
            manageTopics: false,
          }),
          rank: "",
        }),
      );
      return { ok: true, result };
    });
  }

  async banUser(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    userId: TelegramEntityInput;
  }) {
    return this.context.withClient(input.accountRef, "chats", "ban_user", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const user = await this.resolver.resolveEntity(client, input.userId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.EditBanned({
          channel: entity,
          participant: user,
          bannedRights: new Api.ChatBannedRights({
            viewMessages: true,
            sendMessages: true,
            sendMedia: true,
            sendStickers: true,
            sendGifs: true,
            sendGames: true,
            sendInline: true,
            embedLinks: true,
            sendPolls: true,
            changeInfo: true,
            inviteUsers: true,
            pinMessages: true,
            untilDate: 0,
          }),
        }),
      );
      return { ok: true, result };
    });
  }

  async unbanUser(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    userId: TelegramEntityInput;
  }) {
    return this.context.withClient(input.accountRef, "chats", "unban_user", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const user = await this.resolver.resolveEntity(client, input.userId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.EditBanned({
          channel: entity,
          participant: user,
          bannedRights: new Api.ChatBannedRights({
            viewMessages: false,
            sendMessages: false,
            sendMedia: false,
            sendStickers: false,
            sendGifs: false,
            sendGames: false,
            sendInline: false,
            embedLinks: false,
            sendPolls: false,
            changeInfo: false,
            inviteUsers: false,
            pinMessages: false,
            untilDate: 0,
          }),
        }),
      );
      return { ok: true, result };
    });
  }

  async getInviteLink(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "chats", "get_invite_link", async ({ client, gram }) => {
      const entity = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.messages.ExportChatInvite({
          peer: entity,
        }),
      );
      return {
        ok: true,
        inviteLink: (result as any).link ?? null,
        result,
      };
    });
  }

  async exportChatInvite(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.getInviteLink(input);
  }

  async importChatInvite(input: { accountRef: string; hash: string }) {
    return this.context.withClient(input.accountRef, "chats", "import_chat_invite", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.messages.ImportChatInvite({
          hash: input.hash,
        }),
      );
      return { ok: true, result };
    });
  }

  async joinChatByLink(input: { accountRef: string; link: string }) {
    const hash = extractInviteHash(input.link);
    if (!hash) {
      throw new Error("Invalid invite link format");
    }
    return this.importChatInvite({
      accountRef: input.accountRef,
      hash,
    });
  }

  async subscribePublicChannel(input: {
    accountRef: string;
    channel: TelegramEntityInput;
  }) {
    return this.context.withClient(input.accountRef, "chats", "subscribe_public_channel", async ({ client, gram }) => {
      const channel = await this.resolver.resolveEntity(client, input.channel);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.JoinChannel({
          channel,
        }),
      );
      return { ok: true, result };
    });
  }

  async getRecentActions(input: { accountRef: string; chatId: TelegramEntityInput; limit?: number }) {
    return this.context.withClient(input.accountRef, "chats", "get_recent_actions", async ({ client, gram }) => {
      const channel = await this.resolver.resolveEntity(client, input.chatId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.channels.GetAdminLog({
          channel,
          q: "",
          maxId: 0,
          minId: 0,
          limit: input.limit ?? 50,
          eventsFilter: new Api.ChannelAdminLogEventsFilter({}),
        }),
      );
      return { ok: true, result };
    });
  }
}
