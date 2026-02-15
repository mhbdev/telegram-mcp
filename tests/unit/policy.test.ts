import { describe, expect, test } from "vitest";
import { PolicyEngine } from "../../src/policy/engine.js";
import type { AppConfig } from "../../src/app/config.js";

const baseConfig: AppConfig = {
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

describe("PolicyEngine", () => {
  test("denies high risk operations for readonly", () => {
    const engine = new PolicyEngine(baseConfig, null, []);
    const decision = engine.evaluate({
      principal: {
        subject: "u1",
        roles: ["readonly"],
        tenantId: "default",
        authSource: "local",
      },
      tool: "telegram.bot.members",
      operation: "banChatMember",
      riskLevel: "high",
    });
    expect(decision.allow).toBe(false);
  });

  test("allows explicit allow rule", () => {
    const engine = new PolicyEngine(baseConfig, null, [
      {
        tool: "telegram.bot.members",
        operations: ["banChatMember"],
        riskLevel: "high",
        effect: "allow",
      },
    ]);
    const decision = engine.evaluate({
      principal: {
        subject: "u1",
        roles: ["admin"],
        tenantId: "default",
        authSource: "local",
      },
      tool: "telegram.bot.members",
      operation: "banChatMember",
      riskLevel: "high",
    });
    expect(decision.allow).toBe(true);
  });
});
