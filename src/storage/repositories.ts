import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type { EncryptedValue, ToolPermission } from "../types/core.js";

export interface BotAccountRecord {
  id: string;
  accountRef: string;
  displayName: string;
  encryptedToken: string;
  metadata: Record<string, unknown>;
}

export interface MtprotoAccountRecord {
  id: string;
  accountRef: string;
  displayName: string;
  encryptedSession: string;
  encryptedPhone: string;
  metadata: Record<string, unknown>;
}

export class AccountRepository {
  constructor(private readonly db: Database) {}

  async upsertBotAccount(record: {
    accountRef: string;
    displayName: string;
    encryptedToken: EncryptedValue;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO bot_accounts(id, account_ref, display_name, encrypted_token, metadata)
      VALUES($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (account_ref)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        encrypted_token = EXCLUDED.encrypted_token,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      `,
      [
        randomUUID(),
        record.accountRef,
        record.displayName,
        JSON.stringify(record.encryptedToken),
        JSON.stringify(record.metadata ?? {}),
      ],
    );
  }

  async findBotAccountByRef(accountRef: string): Promise<BotAccountRecord | null> {
    const result = await this.db.query<{
      id: string;
      account_ref: string;
      display_name: string;
      encrypted_token: string;
      metadata: Record<string, unknown>;
    }>(
      `
      SELECT id, account_ref, display_name, encrypted_token, metadata
      FROM bot_accounts
      WHERE account_ref = $1
      `,
      [accountRef],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows.at(0);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      accountRef: row.account_ref,
      displayName: row.display_name,
      encryptedToken: row.encrypted_token,
      metadata: row.metadata,
    };
  }

  async listBotAccounts(): Promise<BotAccountRecord[]> {
    const result = await this.db.query<{
      id: string;
      account_ref: string;
      display_name: string;
      encrypted_token: string;
      metadata: Record<string, unknown>;
    }>(
      `
      SELECT id, account_ref, display_name, encrypted_token, metadata
      FROM bot_accounts
      ORDER BY created_at ASC
      `,
    );
    return result.rows.map((row) => ({
      id: row.id,
      accountRef: row.account_ref,
      displayName: row.display_name,
      encryptedToken: row.encrypted_token,
      metadata: row.metadata,
    }));
  }

  async upsertMtprotoAccount(record: {
    accountRef: string;
    displayName: string;
    encryptedSession: EncryptedValue;
    encryptedPhone: EncryptedValue;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO mtproto_accounts(id, account_ref, display_name, encrypted_session, encrypted_phone, metadata)
      VALUES($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT (account_ref)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        encrypted_session = EXCLUDED.encrypted_session,
        encrypted_phone = EXCLUDED.encrypted_phone,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      `,
      [
        randomUUID(),
        record.accountRef,
        record.displayName,
        JSON.stringify(record.encryptedSession),
        JSON.stringify(record.encryptedPhone),
        JSON.stringify(record.metadata ?? {}),
      ],
    );
  }

  async listMtprotoAccounts(): Promise<MtprotoAccountRecord[]> {
    const result = await this.db.query<{
      id: string;
      account_ref: string;
      display_name: string;
      encrypted_session: string;
      encrypted_phone: string;
      metadata: Record<string, unknown>;
    }>(
      `
      SELECT id, account_ref, display_name, encrypted_session, encrypted_phone, metadata
      FROM mtproto_accounts
      ORDER BY created_at ASC
      `,
    );
    return result.rows.map((row) => ({
      id: row.id,
      accountRef: row.account_ref,
      displayName: row.display_name,
      encryptedSession: row.encrypted_session,
      encryptedPhone: row.encrypted_phone,
      metadata: row.metadata,
    }));
  }

  async findMtprotoAccountByRef(
    accountRef: string,
  ): Promise<MtprotoAccountRecord | null> {
    const result = await this.db.query<{
      id: string;
      account_ref: string;
      display_name: string;
      encrypted_session: string;
      encrypted_phone: string;
      metadata: Record<string, unknown>;
    }>(
      `
      SELECT id, account_ref, display_name, encrypted_session, encrypted_phone, metadata
      FROM mtproto_accounts
      WHERE account_ref = $1
      `,
      [accountRef],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows.at(0);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      accountRef: row.account_ref,
      displayName: row.display_name,
      encryptedSession: row.encrypted_session,
      encryptedPhone: row.encrypted_phone,
      metadata: row.metadata,
    };
  }

  async removeMtprotoAccount(accountRef: string): Promise<boolean> {
    const result = await this.db.query(
      `
      DELETE FROM mtproto_accounts
      WHERE account_ref = $1
      `,
      [accountRef],
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export class PolicyRepository {
  constructor(private readonly db: Database) {}

  async loadLatestToolPermissions(): Promise<ToolPermission[]> {
    const result = await this.db.query<{
      tool: string;
      operations: string[];
      risk_level: string;
      effect: string;
    }>(`
      SELECT p.tool, p.operations, p.risk_level, p.effect
      FROM tool_permissions p
      INNER JOIN policy_versions v ON v.id = p.policy_version_id
      WHERE v.id = (SELECT id FROM policy_versions ORDER BY created_at DESC LIMIT 1)
    `);

    return result.rows.map((row) => ({
      tool: row.tool,
      operations: row.operations,
      riskLevel: row.risk_level as ToolPermission["riskLevel"],
      effect: row.effect as ToolPermission["effect"],
    }));
  }
}

export class IdempotencyRepository {
  constructor(private readonly db: Database) {}

  async tryGet(key: string): Promise<Record<string, unknown> | null> {
    const result = await this.db.query<{ response: Record<string, unknown> | null }>(
      `
      SELECT response
      FROM idempotency_records
      WHERE key = $1 AND expires_at > NOW()
      `,
      [key],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const row = result.rows.at(0);
    return row ? row.response : null;
  }

  async save(
    key: string,
    operation: string,
    response: Record<string, unknown>,
    ttlSeconds = 300,
  ): Promise<void> {
    await this.db.query(
      `
      INSERT INTO idempotency_records(key, operation, response, expires_at)
      VALUES($1, $2, $3::jsonb, NOW() + make_interval(secs => $4))
      ON CONFLICT (key) DO UPDATE
      SET response = EXCLUDED.response,
          expires_at = EXCLUDED.expires_at
      `,
      [key, operation, JSON.stringify(response), ttlSeconds],
    );
  }
}

export class AuditRepository {
  constructor(private readonly db: Database) {}

  async write(event: {
    id: string;
    timestamp: string;
    principalSubject: string;
    action: string;
    tool: string;
    operation: string;
    allowed: boolean;
    reason: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO audit_events(
        id, timestamp, principal_subject, action, tool, operation, allowed, reason, metadata
      )
      VALUES($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9::jsonb)
      `,
      [
        event.id,
        event.timestamp,
        event.principalSubject,
        event.action,
        event.tool,
        event.operation,
        event.allowed,
        event.reason,
        JSON.stringify(event.metadata),
      ],
    );
  }

  async latest(limit = 50): Promise<
    Array<{
      id: string;
      timestamp: string;
      principalSubject: string;
      action: string;
      tool: string;
      operation: string;
      allowed: boolean;
      reason: string;
      metadata: Record<string, unknown>;
    }>
  > {
    const result = await this.db.query<{
      id: string;
      timestamp: string;
      principal_subject: string;
      action: string;
      tool: string;
      operation: string;
      allowed: boolean;
      reason: string;
      metadata: Record<string, unknown>;
    }>(
      `
      SELECT id, timestamp::text, principal_subject, action, tool, operation, allowed, reason, metadata
      FROM audit_events
      ORDER BY timestamp DESC
      LIMIT $1
      `,
      [limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      principalSubject: row.principal_subject,
      action: row.action,
      tool: row.tool,
      operation: row.operation,
      allowed: row.allowed,
      reason: row.reason,
      metadata: row.metadata,
    }));
  }
}
