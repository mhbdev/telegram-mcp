import { describe, expect, test } from "vitest";
import type { AppConfig } from "../../src/app/config.js";
import { PolicyEngine } from "../../src/policy/engine.js";

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
    apiId: 1,
    apiHash: "01234567890123456789012345678901",
  },
  policy: {
    defaultEffect: "deny",
    allowRawToolForRoles: ["owner", "admin"],
  },
  observability: {
    logLevel: "info",
    metricsEnabled: true,
  },
};

describe("security policy", () => {
  test("rejects raw tool for non-admin role", () => {
    const engine = new PolicyEngine(cfg, null, []);
    const denied = engine.evaluate({
      principal: {
        subject: "u2",
        roles: ["operator"],
        tenantId: "default",
        authSource: "oidc",
      },
      tool: "telegram.bot.raw",
      operation: "setWebhook",
      riskLevel: "high",
    });
    expect(denied.allow).toBe(false);
  });
});
