import type { TelegramEntityInput } from "./entity-resolver.js";
import { EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

function formatUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    firstName: user.firstName ?? user.first_name ?? null,
    lastName: user.lastName ?? user.last_name ?? null,
    phone: user.phone ?? null,
    bot: Boolean(user.bot),
  };
}

export class ContactsService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
  ) {}

  async listContacts(input: { accountRef: string }) {
    return this.context.withClient(input.accountRef, "contacts", "list_contacts", async ({ client, gram }) => {
      const contacts = await this.fetchContacts(client, gram);
      return {
        count: contacts.length,
        contacts: contacts.map((contact: any) => formatUser(contact)),
      };
    });
  }

  async searchContacts(input: { accountRef: string; query: string }) {
    return this.context.withClient(input.accountRef, "contacts", "search_contacts", async ({ client, gram }) => {
      const contacts = await this.fetchContacts(client, gram);
      const normalized = input.query.trim().toLowerCase();
      const filtered = contacts.filter((contact: any) => {
        const first = String(contact.firstName ?? "").toLowerCase();
        const last = String(contact.lastName ?? "").toLowerCase();
        const username = String(contact.username ?? "").toLowerCase();
        const phone = String(contact.phone ?? "");
        return (
          first.includes(normalized) ||
          last.includes(normalized) ||
          username.includes(normalized) ||
          phone.includes(input.query.trim())
        );
      });
      return {
        count: filtered.length,
        contacts: filtered.map((contact: any) => formatUser(contact)),
      };
    });
  }

  async addContact(input: {
    accountRef: string;
    phone: string;
    firstName: string;
    lastName?: string;
  }) {
    return this.context.withClient(input.accountRef, "contacts", "add_contact", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const imported = await client.invoke(
        new Api.contacts.ImportContacts({
          contacts: [
            new Api.InputPhoneContact({
              clientId: Date.now(),
              phone: input.phone,
              firstName: input.firstName,
              lastName: input.lastName ?? "",
            }),
          ],
        }),
      );
      return {
        ok: true,
        result: imported,
      };
    });
  }

  async deleteContact(input: { accountRef: string; userId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "contacts", "delete_contact", async ({ client, gram }) => {
      const user = await this.resolver.resolveEntity(client, input.userId);
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.contacts.DeleteContacts({
          id: [user],
        }),
      );
      return { ok: true, result };
    });
  }

  async blockUser(input: { accountRef: string; userId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "contacts", "block_user", async ({ client, gram }) => {
      const user = await this.resolver.resolveEntity(client, input.userId);
      const Api = gram.Api as any;
      const result = await client.invoke(new Api.contacts.Block({ id: user }));
      return { ok: true, result };
    });
  }

  async unblockUser(input: { accountRef: string; userId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "contacts", "unblock_user", async ({ client, gram }) => {
      const user = await this.resolver.resolveEntity(client, input.userId);
      const Api = gram.Api as any;
      const result = await client.invoke(new Api.contacts.Unblock({ id: user }));
      return { ok: true, result };
    });
  }

  async importContacts(input: {
    accountRef: string;
    contacts: Array<{ phone: string; firstName: string; lastName?: string }>;
  }) {
    return this.context.withClient(input.accountRef, "contacts", "import_contacts", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const payload = input.contacts.map(
        (contact, index) =>
          new Api.InputPhoneContact({
            clientId: Date.now() + index,
            phone: contact.phone,
            firstName: contact.firstName,
            lastName: contact.lastName ?? "",
          }),
      );
      const result = await client.invoke(new Api.contacts.ImportContacts({ contacts: payload }));
      return { ok: true, result };
    });
  }

  async exportContacts(input: { accountRef: string }) {
    return this.listContacts(input);
  }

  async getBlockedUsers(input: { accountRef: string; limit?: number }) {
    return this.context.withClient(input.accountRef, "contacts", "get_blocked_users", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.contacts.GetBlocked({
          offset: 0,
          limit: input.limit ?? 100,
        }),
      );
      return { ok: true, result };
    });
  }

  async getContactIds(input: { accountRef: string }) {
    const listed = await this.listContacts(input);
    return {
      count: listed.count,
      contactIds: listed.contacts.map((contact: any) => contact.id),
    };
  }

  async getDirectChatByContact(input: {
    accountRef: string;
    contactQuery: string;
  }) {
    return this.context.withClient(
      input.accountRef,
      "contacts",
      "get_direct_chat_by_contact",
      async ({ client, gram }) => {
        const contacts = await this.fetchContacts(client, gram);
        const dialogs = await client.getDialogs({ limit: 400 });
        const normalized = input.contactQuery.trim().toLowerCase();
        const match = contacts.find((contact: any) => {
          const fullName = `${contact.firstName ?? ""} ${contact.lastName ?? ""}`
            .trim()
            .toLowerCase();
          const username = String(contact.username ?? "").toLowerCase();
          const phone = String(contact.phone ?? "");
          return (
            fullName.includes(normalized) ||
            username.includes(normalized) ||
            phone.includes(input.contactQuery.trim())
          );
        });
        if (!match) {
          return { ok: false, error: "contact not found" };
        }
        const dialog = dialogs.find((candidate: any) => candidate?.entity?.id === match.id);
        return {
          ok: true,
          contact: formatUser(match),
          dialog: dialog
            ? {
                id: dialog.id,
                name: dialog.name,
                unreadCount: dialog.unreadCount,
              }
            : null,
        };
      },
    );
  }

  async getContactChats(input: { accountRef: string; contactId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "contacts", "get_contact_chats", async ({ client }) => {
      const entity = await this.resolver.resolveEntity(client, input.contactId);
      const dialogs = await client.getDialogs({ limit: 500 });
      const contactId = Number((entity as any).id);
      const related = dialogs.filter((dialog: any) => {
        const id = Number(dialog?.entity?.id ?? dialog?.id ?? 0);
        return id === contactId;
      });
      return {
        ok: true,
        count: related.length,
        chats: related.map((dialog: any) => ({
          id: dialog.id,
          name: dialog.name,
          unreadCount: dialog.unreadCount,
        })),
      };
    });
  }

  private async fetchContacts(
    client: import("telegram").TelegramClient,
    gram: typeof import("telegram"),
  ): Promise<any[]> {
    const Api = gram.Api as any;
    const result = await client.invoke(
      new Api.contacts.GetContacts({
        hash: BigInt(0),
      }),
    );
    const users = (result as { users?: unknown[] }).users;
    if (!Array.isArray(users)) {
      return [];
    }
    return users as any[];
  }
}
