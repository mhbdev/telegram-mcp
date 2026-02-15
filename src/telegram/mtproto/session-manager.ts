import type pino from "pino";
import type { AppConfig } from "../../app/config.js";
import type { AppMetrics } from "../../app/logger.js";
import { EncryptionService } from "../../storage/encryption.js";
import { AccountRepository } from "../../storage/repositories.js";

interface BuildClientOptions {
  session: string;
}

type GramJsModule = typeof import("telegram");
let gramJsPromise: Promise<GramJsModule> | null = null;

async function loadGramJs(): Promise<GramJsModule> {
  if (!gramJsPromise) {
    gramJsPromise = import("telegram");
  }
  return gramJsPromise;
}

export class MtprotoSessionManager {
  constructor(
    private readonly config: AppConfig,
    private readonly accountRepository: AccountRepository,
    private readonly encryptionService: EncryptionService,
    private readonly logger: pino.Logger,
    private readonly metrics: AppMetrics | null,
  ) {}

  async addSession(input: {
    accountRef: string;
    displayName: string;
    phoneNumber: string;
    phoneCodeProvider: () => Promise<string>;
    passwordProvider?: () => Promise<string>;
  }): Promise<void> {
    const { apiHash, apiId } = this.config.telegram;
    if (!apiHash || !apiId) {
      throw new Error(
        "MTProto requires telegram.apiId and telegram.apiHash in config",
      );
    }
    const gram = await loadGramJs();
    const StringSession = gram.sessions.StringSession;
    const TelegramClient = gram.TelegramClient;

    const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
      connectionRetries: 3,
      timeout: this.config.telegram.requestTimeoutMs,
    });

    await client.start({
      phoneNumber: async () => input.phoneNumber,
      phoneCode: async () => input.phoneCodeProvider(),
      password: async () => (input.passwordProvider ? input.passwordProvider() : ""),
      onError: (error) => {
        this.logger.error({ err: error }, "mtproto login error");
      },
    });

    const savedSessionRaw = client.session.save() as unknown;
    const savedSession =
      typeof savedSessionRaw === "string" ? savedSessionRaw : String(savedSessionRaw ?? "");
    await this.accountRepository.upsertMtprotoAccount({
      accountRef: input.accountRef,
      displayName: input.displayName,
      encryptedSession: this.encryptionService.encrypt(savedSession),
      encryptedPhone: this.encryptionService.encrypt(input.phoneNumber),
      metadata: {
        connectedAt: new Date().toISOString(),
      },
    });
    this.metrics?.mtprotoSessionHealth.inc({ status: "added" });
    await client.disconnect();
  }

  async listSessions(): Promise<
    Array<{ accountRef: string; displayName: string; metadata: Record<string, unknown> }>
  > {
    const rows = await this.accountRepository.listMtprotoAccounts();
    return rows.map((row) => ({
      accountRef: row.accountRef,
      displayName: row.displayName,
      metadata: row.metadata,
    }));
  }

  async revokeSession(accountRef: string): Promise<boolean> {
    const deleted = await this.accountRepository.removeMtprotoAccount(accountRef);
    if (deleted) {
      this.metrics?.mtprotoSessionHealth.inc({ status: "revoked" });
    }
    return deleted;
  }

  async health(accountRef: string): Promise<{
    ok: boolean;
    accountRef: string;
    me?: unknown;
    error?: string;
  }> {
    const account = await this.accountRepository.findMtprotoAccountByRef(accountRef);
    if (!account) {
      return { ok: false, accountRef, error: "account not found" };
    }

    try {
      const client = await this.buildClient({
        session: this.encryptionService.decrypt(
          this.encryptionService.deserialize(account.encryptedSession),
        ),
      });
      const me = await client.getMe();
      await client.disconnect();
      this.metrics?.mtprotoSessionHealth.inc({ status: "healthy" });
      return {
        ok: true,
        accountRef,
        me,
      };
    } catch (error) {
      this.metrics?.mtprotoSessionHealth.inc({ status: "unhealthy" });
      return {
        ok: false,
        accountRef,
        error: String(error),
      };
    }
  }

  async sendText(input: {
    accountRef: string;
    peer: string;
    message: string;
  }): Promise<{ ok: boolean; messageId?: number; error?: string }> {
    const account = await this.accountRepository.findMtprotoAccountByRef(input.accountRef);
    if (!account) {
      return { ok: false, error: "account not found" };
    }

    try {
      const client = await this.buildClient({
        session: this.encryptionService.decrypt(
          this.encryptionService.deserialize(account.encryptedSession),
        ),
      });
      const sent = await client.sendMessage(input.peer, {
        message: input.message,
      });
      await client.disconnect();
      const messageId =
        sent && typeof sent === "object" && "id" in sent
          ? Number((sent as { id: number }).id)
          : undefined;
      return {
        ok: true,
        messageId,
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  async readDialogs(input: {
    accountRef: string;
    limit?: number;
  }): Promise<{ ok: boolean; dialogs?: unknown[]; error?: string }> {
    const account = await this.accountRepository.findMtprotoAccountByRef(input.accountRef);
    if (!account) {
      return { ok: false, error: "account not found" };
    }

    try {
      const client = await this.buildClient({
        session: this.encryptionService.decrypt(
          this.encryptionService.deserialize(account.encryptedSession),
        ),
      });
      const dialogs = await client.getDialogs({ limit: input.limit ?? 20 });
      await client.disconnect();
      return {
        ok: true,
        dialogs: dialogs.map((dialog) => ({
          id: dialog.id,
          name: dialog.name,
          unreadCount: dialog.unreadCount,
          pinned: dialog.pinned,
        })),
      };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  private async buildClient(
    options: BuildClientOptions,
  ): Promise<import("telegram").TelegramClient> {
    const { apiHash, apiId } = this.config.telegram;
    if (!apiHash || !apiId) {
      throw new Error(
        "MTProto requires telegram.apiId and telegram.apiHash in config",
      );
    }
    const gram = await loadGramJs();
    const StringSession = gram.sessions.StringSession;
    const TelegramClient = gram.TelegramClient;
    const client = new TelegramClient(
      new StringSession(options.session),
      apiId,
      apiHash,
      {
        connectionRetries: 2,
        timeout: this.config.telegram.requestTimeoutMs,
      },
    );
    await client.connect();
    return client;
  }
}
