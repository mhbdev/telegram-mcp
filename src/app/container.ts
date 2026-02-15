import type pino from "pino";
import type { AppConfig } from "./config.js";
import { createMetrics, type AppMetrics } from "./logger.js";
import { OidcAuthService } from "../auth/oidc.js";
import { AuditService } from "../audit/audit-service.js";
import { ApprovalService } from "../policy/approval-service.js";
import { PolicyEngine } from "../policy/engine.js";
import { createDatabase, type Database } from "../storage/db.js";
import { EncryptionService } from "../storage/encryption.js";
import { ObjectStoreService } from "../storage/object-store.js";
import {
  AccountRepository,
  ApprovalRepository,
  AuditRepository,
  IdempotencyRepository,
  MediaRepository,
  MtprotoJournalRepository,
  PolicyRepository,
  RetentionPolicyRepository,
} from "../storage/repositories.js";
import { TelegramBotApiClient } from "../telegram/bot/client.js";
import { TelegramBotService } from "../telegram/bot/service.js";
import { MtprotoSessionManager } from "../telegram/mtproto/session-manager.js";
import { ChatsService } from "../telegram/mtproto/services/chats.service.js";
import { MtprotoClientContext } from "../telegram/mtproto/services/client-context.js";
import { ContactsService } from "../telegram/mtproto/services/contacts.service.js";
import { DraftsService } from "../telegram/mtproto/services/drafts.service.js";
import { EntityResolver } from "../telegram/mtproto/services/entity-resolver.js";
import { MediaService } from "../telegram/mtproto/services/media.service.js";
import { MessagesService } from "../telegram/mtproto/services/messages.service.js";
import { PrivacyService } from "../telegram/mtproto/services/privacy.service.js";
import { ProfileService } from "../telegram/mtproto/services/profile.service.js";
import { SearchService } from "../telegram/mtproto/services/search.service.js";

export interface AppContainer {
  config: AppConfig;
  logger: pino.Logger;
  metrics: AppMetrics | null;
  db: Database;
  encryption: EncryptionService;
  accountRepository: AccountRepository;
  idempotencyRepository: IdempotencyRepository;
  approvalRepository: ApprovalRepository;
  mediaRepository: MediaRepository;
  auditService: AuditService;
  policyEngine: PolicyEngine;
  approvalService: ApprovalService;
  oidcAuthService: OidcAuthService;
  botService: TelegramBotService;
  mtprotoSessionManager: MtprotoSessionManager;
  mtprotoChatsService: ChatsService;
  mtprotoMessagesService: MessagesService;
  mtprotoContactsService: ContactsService;
  mtprotoProfileService: ProfileService;
  mtprotoSearchService: SearchService;
  mtprotoPrivacyService: PrivacyService;
  mtprotoDraftsService: DraftsService;
  mtprotoMediaService: MediaService | null;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function createContainer(
  config: AppConfig,
  logger: pino.Logger,
): Promise<AppContainer> {
  const metrics = createMetrics(config.observability.metricsEnabled);
  const db = createDatabase(config);
  const encryption = new EncryptionService(
    requireEnv(config.encryption.masterKeyEnv),
    process.env[config.encryption.previousMasterKeyEnv] ?? null,
  );
  const accountRepository = new AccountRepository(db);
  const idempotencyRepository = new IdempotencyRepository(db);
  const auditRepository = new AuditRepository(db);
  const auditService = new AuditService(auditRepository, logger);
  const policyRepository = new PolicyRepository(db);
  const approvalRepository = new ApprovalRepository(db);
  const mediaRepository = new MediaRepository(db);
  const retentionPolicyRepository = new RetentionPolicyRepository(db);
  const mtprotoJournalRepository = new MtprotoJournalRepository(db);

  await retentionPolicyRepository
    .upsertPolicy({
      mode: config.retention.mode,
      contentTtlDays: config.retention.contentTtlDays,
      metadata: {
        source: "config-bootstrap",
      },
    })
    .catch((error) => {
      logger.warn({ err: error }, "retention policy bootstrap skipped");
    });

  const permissions = await policyRepository.loadLatestToolPermissions().catch(() => []);
  const policyEngine = new PolicyEngine(config, metrics, permissions);
  const approvalService = new ApprovalService(config, approvalRepository);
  const oidcAuthService = new OidcAuthService(config, logger, metrics);
  const botClient = new TelegramBotApiClient(config, logger, metrics);
  const botService = new TelegramBotService(
    botClient,
    accountRepository,
    idempotencyRepository,
    encryption,
    policyEngine,
    auditService,
  );
  const mtprotoSessionManager = new MtprotoSessionManager(
    config,
    accountRepository,
    encryption,
    logger,
    metrics,
  );
  const mtprotoContext = new MtprotoClientContext(
    config,
    accountRepository,
    encryption,
    mtprotoJournalRepository,
    logger,
  );
  const entityResolver = new EntityResolver();
  const mtprotoChatsService = new ChatsService(mtprotoContext, entityResolver);
  const mtprotoMessagesService = new MessagesService(mtprotoContext, entityResolver);
  const mtprotoContactsService = new ContactsService(mtprotoContext, entityResolver);
  const mtprotoProfileService = new ProfileService(mtprotoContext, entityResolver);
  const mtprotoSearchService = new SearchService(mtprotoContext, entityResolver);
  const mtprotoPrivacyService = new PrivacyService(mtprotoContext, entityResolver);
  const mtprotoDraftsService = new DraftsService(mtprotoContext, entityResolver);

  let mtprotoMediaService: MediaService | null = null;
  try {
    const objectStore = new ObjectStoreService(config, logger);
    objectStore.logConfiguration();
    mtprotoMediaService = new MediaService(
      mtprotoContext,
      entityResolver,
      mediaRepository,
      objectStore,
    );
  } catch (error) {
    logger.warn(
      { err: error },
      "media object bridge disabled: missing/invalid S3 configuration",
    );
  }

  return {
    config,
    logger,
    metrics,
    db,
    encryption,
    accountRepository,
    idempotencyRepository,
    approvalRepository,
    mediaRepository,
    auditService,
    policyEngine,
    approvalService,
    oidcAuthService,
    botService,
    mtprotoSessionManager,
    mtprotoChatsService,
    mtprotoMessagesService,
    mtprotoContactsService,
    mtprotoProfileService,
    mtprotoSearchService,
    mtprotoPrivacyService,
    mtprotoDraftsService,
    mtprotoMediaService,
  };
}
