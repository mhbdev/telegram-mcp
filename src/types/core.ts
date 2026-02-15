export type Role = "owner" | "admin" | "operator" | "readonly";

export interface Principal {
  subject: string;
  roles: Role[];
  tenantId: string;
  authSource: "oidc" | "local";
}

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Effect = "allow" | "deny";

export interface ToolPermission {
  tool: string;
  operations: string[];
  riskLevel: RiskLevel;
  effect: Effect;
}

export interface PolicyDecision {
  allow: boolean;
  reason: string;
  matchedRule: ToolPermission | null;
}

export interface TelegramToolRequest<TInput = unknown> {
  accountRef: string;
  operation: string;
  input: TInput;
  idempotencyKey?: string;
  dryRun?: boolean;
}

export interface AuditEvent {
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
}

export interface EncryptedValue {
  keyVersion: number;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

export interface ApprovalRequest {
  id: string;
  principalSubject: string;
  tool: string;
  operation: string;
  riskLevel: RiskLevel;
  payloadHash: string;
  status: ApprovalStatus;
  expiresAt: string;
  createdAt: string;
}

export interface MediaObject {
  id: string;
  accountRef: string;
  objectKey: string;
  bucket: string;
  mimeType: string;
  sizeBytes: number;
  status: "pending" | "ready" | "deleted";
  createdAt: string;
  updatedAt: string;
}
