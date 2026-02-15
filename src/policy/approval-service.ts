import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "../app/config.js";
import { ApprovalRepository } from "../storage/repositories.js";
import type { Principal, RiskLevel } from "../types/core.js";

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b, "en"),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`).join(",")}}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export class ApprovalService {
  constructor(
    private readonly config: AppConfig,
    private readonly repository: ApprovalRepository,
  ) {}

  isApprovalRequired(riskLevel: RiskLevel): boolean {
    return (
      this.config.approvals.enabled &&
      this.config.approvals.requiredRiskLevels.includes(riskLevel)
    );
  }

  async requestApproval(input: {
    principal: Principal;
    tool: string;
    operation: string;
    riskLevel: RiskLevel;
    payload: unknown;
  }): Promise<{
    approvalId: string;
    approvalToken: string;
    expiresAt: string;
  }> {
    const payloadHash = sha256(stableSerialize(input.payload));
    const expiresAt = new Date(
      Date.now() + this.config.approvals.ttlSeconds * 1000,
    ).toISOString();
    const approvalId = await this.repository.createRequest({
      principalSubject: input.principal.subject,
      tool: input.tool,
      operation: input.operation,
      riskLevel: input.riskLevel,
      payloadHash,
      status: "approved",
      expiresAt,
    });
    const approvalToken = randomToken();
    await this.repository.createToken({
      approvalRequestId: approvalId,
      tokenHash: sha256(approvalToken),
      status: "active",
      expiresAt,
    });
    return {
      approvalId,
      approvalToken,
      expiresAt,
    };
  }

  async verifyAndConsume(input: {
    approvalToken: string;
    principal: Principal;
    tool: string;
    operation: string;
    riskLevel: RiskLevel;
    payload: unknown;
  }): Promise<{ approvalId: string }> {
    const tokenHash = sha256(input.approvalToken);
    const tokenRow = await this.repository.consumeToken(tokenHash);
    if (!tokenRow) {
      throw new Error("Invalid approval token");
    }
    if (tokenRow.status !== "active") {
      throw new Error("Approval token is not active");
    }
    if (new Date(tokenRow.expiresAt).getTime() < Date.now()) {
      throw new Error("Approval token has expired");
    }

    const request = await this.repository.getRequestById(tokenRow.approvalRequestId);
    if (!request) {
      throw new Error("Approval request not found");
    }
    if (request.status !== "approved") {
      throw new Error("Approval request is not approved");
    }
    if (request.principalSubject !== input.principal.subject) {
      throw new Error("Approval token principal mismatch");
    }
    if (request.tool !== input.tool || request.operation !== input.operation) {
      throw new Error("Approval token action mismatch");
    }
    if (request.riskLevel !== input.riskLevel) {
      throw new Error("Approval token risk mismatch");
    }
    const payloadHash = sha256(stableSerialize(input.payload));
    if (request.payloadHash !== payloadHash) {
      throw new Error("Approval token payload mismatch");
    }
    if (new Date(request.expiresAt).getTime() < Date.now()) {
      throw new Error("Approval request has expired");
    }
    return { approvalId: request.id };
  }

  async getApprovalStatus(approvalId: string) {
    return this.repository.getRequestById(approvalId);
  }

  async listRecent(limit = 50) {
    return this.repository.listRecent(limit);
  }
}
