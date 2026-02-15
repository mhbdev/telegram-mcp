import { randomUUID } from "node:crypto";
import type { Database } from "./db.js";
import type {
  ApprovalStatus,
  EncryptedValue,
  MediaObject,
  RiskLevel,
  ToolPermission,
} from "../types/core.js";

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
    riskLevel?: RiskLevel;
    approvalId?: string | null;
    clientContext?: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO audit_events(
        id, timestamp, principal_subject, action, tool, operation, allowed, reason,
        risk_level, approval_id, client_context, metadata
      )
      VALUES($1, $2::timestamptz, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
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
        event.riskLevel ?? null,
        event.approvalId ?? null,
        JSON.stringify(event.clientContext ?? {}),
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
      riskLevel?: string | null;
      approvalId?: string | null;
      clientContext?: Record<string, unknown>;
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
      risk_level?: string | null;
      approval_id?: string | null;
      client_context?: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }>(
      `
      SELECT
        id, timestamp::text, principal_subject, action, tool, operation, allowed, reason,
        risk_level, approval_id, client_context, metadata
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
      riskLevel: row.risk_level,
      approvalId: row.approval_id,
      clientContext: row.client_context ?? {},
      metadata: row.metadata,
    }));
  }
}

export class ApprovalRepository {
  constructor(private readonly db: Database) {}

  async createRequest(input: {
    principalSubject: string;
    tool: string;
    operation: string;
    riskLevel: RiskLevel;
    payloadHash: string;
    status: ApprovalStatus;
    expiresAt: string;
  }): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `
      INSERT INTO approval_requests(
        id, principal_subject, tool, operation, risk_level, payload_hash, status, expires_at
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
      `,
      [
        id,
        input.principalSubject,
        input.tool,
        input.operation,
        input.riskLevel,
        input.payloadHash,
        input.status,
        input.expiresAt,
      ],
    );
    return id;
  }

  async updateRequestStatus(id: string, status: ApprovalStatus): Promise<void> {
    await this.db.query(
      `
      UPDATE approval_requests
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [id, status],
    );
  }

  async getRequestById(id: string): Promise<{
    id: string;
    principalSubject: string;
    tool: string;
    operation: string;
    riskLevel: RiskLevel;
    payloadHash: string;
    status: ApprovalStatus;
    expiresAt: string;
    createdAt: string;
  } | null> {
    const result = await this.db.query<{
      id: string;
      principal_subject: string;
      tool: string;
      operation: string;
      risk_level: string;
      payload_hash: string;
      status: string;
      expires_at: string;
      created_at: string;
    }>(
      `
      SELECT
        id, principal_subject, tool, operation, risk_level, payload_hash,
        status, expires_at::text, created_at::text
      FROM approval_requests
      WHERE id = $1
      `,
      [id],
    );
    const row = result.rows.at(0);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      principalSubject: row.principal_subject,
      tool: row.tool,
      operation: row.operation,
      riskLevel: row.risk_level as RiskLevel,
      payloadHash: row.payload_hash,
      status: row.status as ApprovalStatus,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  async listRecent(limit = 50): Promise<
    Array<{
      id: string;
      principalSubject: string;
      tool: string;
      operation: string;
      riskLevel: RiskLevel;
      status: ApprovalStatus;
      createdAt: string;
      expiresAt: string;
    }>
  > {
    const result = await this.db.query<{
      id: string;
      principal_subject: string;
      tool: string;
      operation: string;
      risk_level: string;
      status: string;
      created_at: string;
      expires_at: string;
    }>(
      `
      SELECT
        id, principal_subject, tool, operation, risk_level, status, created_at::text, expires_at::text
      FROM approval_requests
      ORDER BY created_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      principalSubject: row.principal_subject,
      tool: row.tool,
      operation: row.operation,
      riskLevel: row.risk_level as RiskLevel,
      status: row.status as ApprovalStatus,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));
  }

  async createToken(input: {
    approvalRequestId: string;
    tokenHash: string;
    status: "active" | "used" | "expired";
    expiresAt: string;
  }): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `
      INSERT INTO approval_tokens(
        id, approval_request_id, token_hash, status, expires_at
      )
      VALUES($1, $2, $3, $4, $5::timestamptz)
      `,
      [id, input.approvalRequestId, input.tokenHash, input.status, input.expiresAt],
    );
    return id;
  }

  async consumeToken(tokenHash: string): Promise<{
    id: string;
    approvalRequestId: string;
    status: string;
    expiresAt: string;
  } | null> {
    const result = await this.db.query<{
      id: string;
      approval_request_id: string;
      status: string;
      expires_at: string;
    }>(
      `
      SELECT id, approval_request_id, status, expires_at::text
      FROM approval_tokens
      WHERE token_hash = $1
      `,
      [tokenHash],
    );
    const row = result.rows.at(0);
    if (!row) {
      return null;
    }
    await this.db.query(
      `
      UPDATE approval_tokens
      SET status = 'used', used_at = NOW()
      WHERE id = $1 AND status = 'active'
      `,
      [row.id],
    );
    return {
      id: row.id,
      approvalRequestId: row.approval_request_id,
      status: row.status,
      expiresAt: row.expires_at,
    };
  }
}

export class MediaRepository {
  constructor(private readonly db: Database) {}

  async createObject(input: {
    accountRef: string;
    objectKey: string;
    bucket: string;
    mimeType: string;
    sizeBytes: number;
    status: "pending" | "ready" | "deleted";
    metadata?: Record<string, unknown>;
  }): Promise<MediaObject> {
    const id = randomUUID();
    await this.db.query(
      `
      INSERT INTO media_objects(
        id, account_ref, object_key, bucket, mime_type, size_bytes, status, metadata
      )
      VALUES($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        id,
        input.accountRef,
        input.objectKey,
        input.bucket,
        input.mimeType,
        input.sizeBytes,
        input.status,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return {
      id,
      accountRef: input.accountRef,
      objectKey: input.objectKey,
      bucket: input.bucket,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: input.status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async updateObjectStatus(
    id: string,
    status: "pending" | "ready" | "deleted",
  ): Promise<void> {
    await this.db.query(
      `
      UPDATE media_objects
      SET status = $2, updated_at = NOW()
      WHERE id = $1
      `,
      [id, status],
    );
  }

  async getObjectById(id: string): Promise<MediaObject | null> {
    const result = await this.db.query<{
      id: string;
      account_ref: string;
      object_key: string;
      bucket: string;
      mime_type: string;
      size_bytes: string;
      status: "pending" | "ready" | "deleted";
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT
        id, account_ref, object_key, bucket, mime_type, size_bytes::text,
        status, created_at::text, updated_at::text
      FROM media_objects
      WHERE id = $1
      `,
      [id],
    );
    const row = result.rows.at(0);
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      accountRef: row.account_ref,
      objectKey: row.object_key,
      bucket: row.bucket,
      mimeType: row.mime_type,
      sizeBytes: Number.parseInt(row.size_bytes, 10),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listObjectsByAccount(
    accountRef: string,
    limit = 50,
  ): Promise<MediaObject[]> {
    const result = await this.db.query<{
      id: string;
      account_ref: string;
      object_key: string;
      bucket: string;
      mime_type: string;
      size_bytes: string;
      status: "pending" | "ready" | "deleted";
      created_at: string;
      updated_at: string;
    }>(
      `
      SELECT
        id, account_ref, object_key, bucket, mime_type, size_bytes::text,
        status, created_at::text, updated_at::text
      FROM media_objects
      WHERE account_ref = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [accountRef, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      accountRef: row.account_ref,
      objectKey: row.object_key,
      bucket: row.bucket,
      mimeType: row.mime_type,
      sizeBytes: Number.parseInt(row.size_bytes, 10),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async logAccess(input: {
    mediaObjectId: string;
    principalSubject: string;
    action: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO media_access_events(id, media_object_id, principal_subject, action, metadata)
      VALUES($1, $2, $3, $4, $5::jsonb)
      `,
      [
        randomUUID(),
        input.mediaObjectId,
        input.principalSubject,
        input.action,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}

export class RetentionPolicyRepository {
  constructor(private readonly db: Database) {}

  async upsertPolicy(input: {
    mode: "metadata_only" | "encrypted_content";
    contentTtlDays: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      DELETE FROM retention_policies
      `,
    );
    await this.db.query(
      `
      INSERT INTO retention_policies(id, mode, content_ttl_days, metadata)
      VALUES($1, $2, $3, $4::jsonb)
      `,
      [
        randomUUID(),
        input.mode,
        input.contentTtlDays,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}

export class MtprotoJournalRepository {
  constructor(private readonly db: Database) {}

  async write(input: {
    accountRef: string;
    domain: string;
    operation: string;
    success: boolean;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `
      INSERT INTO mtproto_operation_journal(
        id, account_ref, domain, operation, success, error, metadata
      )
      VALUES($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
      [
        randomUUID(),
        input.accountRef,
        input.domain,
        input.operation,
        input.success,
        input.error ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }
}
