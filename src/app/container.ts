import type pino from "pino";
import type { AppConfig } from "./config.js";
import { createMetrics, type AppMetrics } from "./logger.js";
import { OidcAuthService } from "../auth/oidc.js";
import { AuditService } from "../audit/audit-service.js";
import { PolicyEngine } from "../policy/engine.js";
import { createDatabase, type Database } from "../storage/db.js";
import { EncryptionService } from "../storage/encryption.js";
import {
  AccountRepository,
  AuditRepository,
  IdempotencyRepository,
  PolicyRepository,
} from "../storage/repositories.js";
import { TelegramBotApiClient } from "../telegram/bot/client.js";
import { TelegramBotService } from "../telegram/bot/service.js";
import { MtprotoSessionManager } from "../telegram/mtproto/session-manager.js";

export interface AppContainer {
  config: AppConfig;
  logger: pino.Logger;
  metrics: AppMetrics | null;
  db: Database;
  encryption: EncryptionService;
  accountRepository: AccountRepository;
  auditService: AuditService;
  policyEngine: PolicyEngine;
  oidcAuthService: OidcAuthService;
  botService: TelegramBotService;
  mtprotoSessionManager: MtprotoSessionManager;
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
  const permissions = await policyRepository.loadLatestToolPermissions().catch(() => []);
  const policyEngine = new PolicyEngine(config, metrics, permissions);
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

  return {
    config,
    logger,
    metrics,
    db,
    encryption,
    accountRepository,
    auditService,
    policyEngine,
    oidcAuthService,
    botService,
    mtprotoSessionManager,
  };
}
