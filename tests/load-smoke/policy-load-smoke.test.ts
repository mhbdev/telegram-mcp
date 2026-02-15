import { describe, expect, test } from "vitest";
import { PolicyEngine } from "../../src/policy/engine.js";
import type { AppConfig } from "../../src/app/config.js";

const cfg: AppConfig = {
  server: {
    name: "telegram-mcp",
    version: "0.1.0",
    transport: "http",
    host: "127.0.0.1",
    port: 3000,
  },
  auth: {
    issuer: "https://issuer.example",
    audience: "telegram-mcp",
    jwksUri: "https://issuer.example/jwks",
    required: true,
  },
  database: {
    url: "postgres://postgres:postgres@localhost:5432/telegram_mcp",
    maxConnections: 20,
    ssl: false,
  },
  encryption: {
    masterKeyEnv: "TELEGRAM_MCP_MASTER_KEY",
    previousMasterKeyEnv: "TELEGRAM_MCP_PREVIOUS_MASTER_KEY",
  },
  telegram: {
    requestTimeoutMs: 20_000,
    maxRetries: 4,
    baseUrl: "https://api.telegram.org",
    updateMode: "webhook",
    mtproto: {
      rateLimit: 30,
      retry: 3,
      floodWaitPolicy: "respect",
    },
    apiId: 1,
    apiHash: "01234567890123456789012345678901",
  },
  policy: {
    defaultEffect: "deny",
    allowRawToolForRoles: ["owner", "admin"],
  },
  storage: {
    s3: {
      region: "us-east-1",
      bucket: "telegram-mcp-test-bucket",
      accessKeyEnv: "TELEGRAM_MCP_S3_ACCESS_KEY",
      secretKeyEnv: "TELEGRAM_MCP_S3_SECRET_KEY",
      forcePathStyle: true,
      signedUrlTtlSeconds: 900,
    },
  },
  approvals: {
    enabled: true,
    ttlSeconds: 900,
    requiredRiskLevels: ["high", "critical"],
    maxPending: 1000,
  },
  retention: {
    mode: "metadata_only",
    contentTtlDays: 30,
  },
  observability: {
    logLevel: "info",
    metricsEnabled: true,
  },
};

describe("policy load smoke", () => {
  test("evaluates large batch quickly", () => {
    const engine = new PolicyEngine(cfg, null, [
      {
        tool: "telegram.bot.messages",
        operations: ["sendMessage"],
        riskLevel: "low",
        effect: "allow",
      },
    ]);

    const started = Date.now();
    for (let index = 0; index < 10_000; index += 1) {
      const decision = engine.evaluate({
        principal: {
          subject: `user-${index}`,
          roles: ["operator"],
          tenantId: "default",
          authSource: "local",
        },
        tool: "telegram.bot.messages",
        operation: "sendMessage",
        riskLevel: "low",
      });
      expect(decision.allow).toBe(true);
    }
    const duration = Date.now() - started;
    expect(duration).toBeLessThan(3000);
  });
});
