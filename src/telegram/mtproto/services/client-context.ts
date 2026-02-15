import type pino from "pino";
import type { AppConfig } from "../../../app/config.js";
import { EncryptionService } from "../../../storage/encryption.js";
import {
  AccountRepository,
  MtprotoJournalRepository,
} from "../../../storage/repositories.js";

type GramJsModule = typeof import("telegram");

let gramJsPromise: Promise<GramJsModule> | null = null;

async function loadGramJs(): Promise<GramJsModule> {
  if (!gramJsPromise) {
    gramJsPromise = import("telegram");
  }
  return gramJsPromise;
}

export class MtprotoClientContext {
  constructor(
    private readonly config: AppConfig,
    private readonly accountRepository: AccountRepository,
    private readonly encryption: EncryptionService,
    private readonly journal: MtprotoJournalRepository,
    private readonly logger: pino.Logger,
  ) {}

  async withClient<T>(
    accountRef: string,
    domain: string,
    operation: string,
    task: (args: {
      client: import("telegram").TelegramClient;
      gram: GramJsModule;
    }) => Promise<T>,
    metadata?: Record<string, unknown>,
  ): Promise<T> {
    const account = await this.accountRepository.findMtprotoAccountByRef(accountRef);
    if (!account) {
      throw new Error(`MTProto account not found: ${accountRef}`);
    }

    const gram = await loadGramJs();
    const apiId = this.config.telegram.apiId;
    const apiHash = this.config.telegram.apiHash;
    if (!apiId || !apiHash) {
      throw new Error(
        "MTProto requires telegram.apiId and telegram.apiHash in config",
      );
    }
    const StringSession = gram.sessions.StringSession;
    const TelegramClient = gram.TelegramClient;
    const session = this.encryption.decrypt(
      this.encryption.deserialize(account.encryptedSession),
    );
    const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: this.config.telegram.mtproto.retry,
      timeout: this.config.telegram.requestTimeoutMs,
    });

    await client.connect();
    try {
      const result = await task({ client, gram });
      await this.journal.write({
        accountRef,
        domain,
        operation,
        success: true,
        metadata: metadata ?? {},
      });
      return result;
    } catch (error) {
      await this.journal.write({
        accountRef,
        domain,
        operation,
        success: false,
        error: String(error),
        metadata: metadata ?? {},
      });
      this.logger.warn(
        { err: error, accountRef, domain, operation },
        "mtproto domain operation failed",
      );
      throw error;
    } finally {
      await client.disconnect();
    }
  }
}
