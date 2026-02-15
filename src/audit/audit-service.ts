import { randomUUID } from "node:crypto";
import type pino from "pino";
import { AuditRepository } from "../storage/repositories.js";

import type { RiskLevel } from "../types/core.js";

export interface AuditLogInput {
  principalSubject: string;
  action: string;
  tool: string;
  operation: string;
  allowed: boolean;
  reason: string;
  riskLevel?: RiskLevel;
  approvalId?: string | null;
  clientContext?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly logger: pino.Logger,
  ) {}

  async log(input: AuditLogInput): Promise<void> {
    const event = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      principalSubject: input.principalSubject,
      action: input.action,
      tool: input.tool,
      operation: input.operation,
      allowed: input.allowed,
      reason: input.reason,
      riskLevel: input.riskLevel,
      approvalId: input.approvalId ?? null,
      clientContext: input.clientContext ?? {},
      metadata: input.metadata ?? {},
    };

    await this.repository.write(event);
    this.logger.info(
      {
        audit: {
          id: event.id,
          principalSubject: event.principalSubject,
          action: event.action,
          tool: event.tool,
          operation: event.operation,
          allowed: event.allowed,
          reason: event.reason,
          riskLevel: event.riskLevel,
          approvalId: event.approvalId,
        },
      },
      "audit event written",
    );
  }

  latest(limit = 50) {
    return this.repository.latest(limit);
  }
}
