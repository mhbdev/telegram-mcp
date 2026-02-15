import type { TelegramEntityInput } from "./entity-resolver.js";
import { EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

const KNOWN_PRIVACY_KEYS = [
  "status_timestamp",
  "chat_invite",
  "phone_call",
  "phone_p2p",
  "forwards",
  "profile_photo",
  "phone_number",
  "added_by_phone",
  "voice_messages",
  "about",
] as const;

type PrivacyKeyName = (typeof KNOWN_PRIVACY_KEYS)[number];

function buildPrivacyKey(Api: any, key: PrivacyKeyName): unknown {
  const map: Record<PrivacyKeyName, unknown> = {
    status_timestamp: new Api.InputPrivacyKeyStatusTimestamp(),
    chat_invite: new Api.InputPrivacyKeyChatInvite(),
    phone_call: new Api.InputPrivacyKeyPhoneCall(),
    phone_p2p: new Api.InputPrivacyKeyPhoneP2P(),
    forwards: new Api.InputPrivacyKeyForwards(),
    profile_photo: new Api.InputPrivacyKeyProfilePhoto(),
    phone_number: new Api.InputPrivacyKeyPhoneNumber(),
    added_by_phone: new Api.InputPrivacyKeyAddedByPhone(),
    voice_messages: new Api.InputPrivacyKeyVoiceMessages(),
    about: new Api.InputPrivacyKeyAbout(),
  };
  return map[key];
}

export class PrivacyService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
  ) {}

  async getPrivacySettings(input: { accountRef: string; key?: PrivacyKeyName }) {
    return this.context.withClient(
      input.accountRef,
      "privacy",
      "get_privacy_settings",
      async ({ client, gram }) => {
        const Api = gram.Api as any;
        if (input.key) {
          const result = await client.invoke(
            new Api.account.GetPrivacy({
              key: buildPrivacyKey(Api, input.key),
            }),
          );
          return {
            ok: true,
            key: input.key,
            result,
          };
        }

        const results: Record<string, unknown> = {};
        for (const key of KNOWN_PRIVACY_KEYS) {
          try {
            results[key] = await client.invoke(
              new Api.account.GetPrivacy({
                key: buildPrivacyKey(Api, key),
              }),
            );
          } catch (error) {
            results[key] = {
              ok: false,
              error: String(error),
            };
          }
        }
        return {
          ok: true,
          results,
        };
      },
    );
  }

  async setPrivacySettings(input: {
    accountRef: string;
    key: PrivacyKeyName;
    allowUsers?: TelegramEntityInput[];
    disallowUsers?: TelegramEntityInput[];
    allowContacts?: boolean;
    allowAll?: boolean;
    disallowAll?: boolean;
  }) {
    return this.context.withClient(
      input.accountRef,
      "privacy",
      "set_privacy_settings",
      async ({ client, gram }) => {
        const Api = gram.Api as any;
        const rules: unknown[] = [];
        const allowUsers = input.allowUsers ?? [];
        const disallowUsers = input.disallowUsers ?? [];
        if (allowUsers.length > 0) {
          const resolved = await Promise.all(
            allowUsers.map((userId) => this.resolver.resolveEntity(client, userId)),
          );
          rules.push(new Api.InputPrivacyValueAllowUsers({ users: resolved }));
        }
        if (disallowUsers.length > 0) {
          const resolved = await Promise.all(
            disallowUsers.map((userId) => this.resolver.resolveEntity(client, userId)),
          );
          rules.push(new Api.InputPrivacyValueDisallowUsers({ users: resolved }));
        }
        if (input.allowContacts) {
          rules.push(new Api.InputPrivacyValueAllowContacts());
        }
        if (input.allowAll) {
          rules.push(new Api.InputPrivacyValueAllowAll());
        }
        if (input.disallowAll) {
          rules.push(new Api.InputPrivacyValueDisallowAll());
        }
        if (rules.length === 0) {
          rules.push(new Api.InputPrivacyValueAllowContacts());
        }
        const result = await client.invoke(
          new Api.account.SetPrivacy({
            key: buildPrivacyKey(Api, input.key),
            rules,
          }),
        );
        return {
          ok: true,
          result,
        };
      },
    );
  }

  async muteChat(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.updateNotificationSettings(input.accountRef, input.chatId, true);
  }

  async unmuteChat(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.updateNotificationSettings(input.accountRef, input.chatId, false);
  }

  async archiveChat(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.editFolder(input.accountRef, input.chatId, 1, "archive_chat");
  }

  async unarchiveChat(input: { accountRef: string; chatId: TelegramEntityInput }) {
    return this.editFolder(input.accountRef, input.chatId, 0, "unarchive_chat");
  }

  async getRecentActions(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    limit?: number;
  }) {
    return this.context.withClient(
      input.accountRef,
      "privacy",
      "get_recent_actions",
      async ({ client, gram }) => {
        const Api = gram.Api as any;
        const channel = await this.resolver.resolveEntity(client, input.chatId);
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
        return {
          ok: true,
          result,
        };
      },
    );
  }

  private async updateNotificationSettings(
    accountRef: string,
    chatId: TelegramEntityInput,
    muted: boolean,
  ) {
    return this.context.withClient(
      accountRef,
      "privacy",
      muted ? "mute_chat" : "unmute_chat",
      async ({ client, gram }) => {
        const Api = gram.Api as any;
        const peer = await this.resolver.resolveEntity(client, chatId);
        const result = await client.invoke(
          new Api.account.UpdateNotifySettings({
            peer: new Api.InputNotifyPeer({ peer }),
            settings: new Api.InputPeerNotifySettings({
              muteUntil: muted ? 2_147_483_647 : 0,
              showPreviews: true,
              silent: false,
            }),
          }),
        );
        return {
          ok: true,
          result,
        };
      },
    );
  }

  private async editFolder(
    accountRef: string,
    chatId: TelegramEntityInput,
    folderId: number,
    operation: string,
  ) {
    return this.context.withClient(accountRef, "privacy", operation, async ({ client, gram }) => {
      const Api = gram.Api as any;
      const peer = await this.resolver.resolveEntity(client, chatId);
      const result = await client.invoke(
        new Api.folders.EditPeerFolders({
          folderPeers: [
            new Api.InputFolderPeer({
              peer,
              folderId,
            }),
          ],
        }),
      );
      return {
        ok: true,
        result,
      };
    });
  }
}
