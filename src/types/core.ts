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
  metadata: Record<string, unknown>;
}

export interface EncryptedValue {
  keyVersion: number;
  iv: string;
  ciphertext: string;
  authTag: string;
}
