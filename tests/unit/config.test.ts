import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig } from "../../src/app/config.js";

const initialCwd = process.cwd();
const workspaces: string[] = [];

async function writeFileWithParents(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "telegram-mcp-config-test-"));
  workspaces.push(workspace);
  return workspace;
}

describe("config", () => {
  afterEach(async () => {
    process.chdir(initialCwd);
    while (workspaces.length > 0) {
      const workspace = workspaces.pop() as string;
      await rm(workspace, { recursive: true, force: true });
    }
  });

  test("loads example config successfully by explicit path", () => {
    const config = loadConfig("telegram-mcp.config.example.json");
    expect(config.server.name).toBe("telegram-mcp");
    expect(config.database.url).toContain("postgresql://");
    expect(config.auth.issuer).toContain("localhost");
  });

  test("loads YAML config file", async () => {
    const workspace = await createWorkspace();
    const sourceJson = await readFile(
      resolve(initialCwd, "telegram-mcp.config.example.json"),
      "utf8",
    );
    const parsed = JSON.parse(sourceJson) as Record<string, unknown>;
    const yamlConfig = `
server:
  name: ${parsed.server ? "telegram-mcp" : "telegram-mcp"}
  version: "0.1.0"
  transport: stdio
  host: 127.0.0.1
  port: 3111
auth:
  issuer: http://localhost:8080/realms/telegram-mcp
  audience: telegram-mcp
  jwksUri: http://localhost:8080/realms/telegram-mcp/protocol/openid-connect/certs
  required: false
database:
  url: postgresql://telegram_mcp:telegram_mcp@localhost:5432/telegram_mcp
  maxConnections: 20
  ssl: false
encryption:
  masterKeyEnv: TELEGRAM_MCP_MASTER_KEY
  previousMasterKeyEnv: TELEGRAM_MCP_PREVIOUS_MASTER_KEY
telegram:
  requestTimeoutMs: 20000
  maxRetries: 4
  baseUrl: https://api.telegram.org
  updateMode: webhook
  apiId: 123456
  apiHash: replace-with-real-api-hash
  mtproto:
    rateLimit: 30
    retry: 3
    floodWaitPolicy: respect
policy:
  defaultEffect: deny
  allowRawToolForRoles:
    - admin
    - owner
storage:
  s3:
    endpoint: http://localhost:9000
    region: us-east-1
    bucket: telegram-mcp-media
    accessKeyEnv: TELEGRAM_MCP_S3_ACCESS_KEY
    secretKeyEnv: TELEGRAM_MCP_S3_SECRET_KEY
    forcePathStyle: true
    signedUrlTtlSeconds: 900
approvals:
  enabled: true
  ttlSeconds: 900
  requiredRiskLevels:
    - high
    - critical
  maxPending: 1000
retention:
  mode: metadata_only
  contentTtlDays: 30
observability:
  logLevel: info
  metricsEnabled: true
`.trim();

    const yamlPath = resolve(workspace, ".telegram-mcp", "config.yaml");
    await writeFileWithParents(yamlPath, `${yamlConfig}\n`);
    process.chdir(workspace);

    const config = loadConfig();
    expect(config.server.transport).toBe("stdio");
    expect(config.server.port).toBe(3111);
    expect(config.auth.required).toBe(false);
  });

  test("prefers .telegram-mcp config files in discovery order", async () => {
    const workspace = await createWorkspace();
    await writeFileWithParents(
      resolve(workspace, "telegram-mcp.config.json"),
      JSON.stringify(
        {
          server: {
            name: "legacy",
            version: "0.1.0",
            transport: "http",
            host: "127.0.0.1",
            port: 3000,
          },
          auth: {
            issuer: "http://localhost:8080/realms/telegram-mcp",
            audience: "telegram-mcp",
            jwksUri:
              "http://localhost:8080/realms/telegram-mcp/protocol/openid-connect/certs",
            required: true,
          },
          database: {
            url: "postgresql://telegram_mcp:telegram_mcp@localhost:5432/telegram_mcp",
            maxConnections: 20,
            ssl: false,
          },
          encryption: {
            masterKeyEnv: "TELEGRAM_MCP_MASTER_KEY",
            previousMasterKeyEnv: "TELEGRAM_MCP_PREVIOUS_MASTER_KEY",
          },
          telegram: {
            requestTimeoutMs: 20000,
            maxRetries: 4,
            baseUrl: "https://api.telegram.org",
            updateMode: "webhook",
            apiId: 123456,
            apiHash: "replace-with-real-api-hash",
            mtproto: {
              rateLimit: 30,
              retry: 3,
              floodWaitPolicy: "respect",
            },
          },
          policy: {
            defaultEffect: "deny",
            allowRawToolForRoles: ["admin", "owner"],
          },
          storage: {
            s3: {
              endpoint: "http://localhost:9000",
              region: "us-east-1",
              bucket: "telegram-mcp-media",
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
        },
        null,
        2,
      ),
    );

    await writeFileWithParents(
      resolve(workspace, ".telegram-mcp", "config.json"),
      JSON.stringify(
        {
          server: {
            name: "preferred",
            version: "0.1.0",
            transport: "http",
            host: "127.0.0.1",
            port: 3001,
          },
          auth: {
            issuer: "http://localhost:8080/realms/telegram-mcp",
            audience: "telegram-mcp",
            jwksUri:
              "http://localhost:8080/realms/telegram-mcp/protocol/openid-connect/certs",
            required: true,
          },
          database: {
            url: "postgresql://telegram_mcp:telegram_mcp@localhost:5432/telegram_mcp",
            maxConnections: 20,
            ssl: false,
          },
          encryption: {
            masterKeyEnv: "TELEGRAM_MCP_MASTER_KEY",
            previousMasterKeyEnv: "TELEGRAM_MCP_PREVIOUS_MASTER_KEY",
          },
          telegram: {
            requestTimeoutMs: 20000,
            maxRetries: 4,
            baseUrl: "https://api.telegram.org",
            updateMode: "webhook",
            apiId: 123456,
            apiHash: "replace-with-real-api-hash",
            mtproto: {
              rateLimit: 30,
              retry: 3,
              floodWaitPolicy: "respect",
            },
          },
          policy: {
            defaultEffect: "deny",
            allowRawToolForRoles: ["admin", "owner"],
          },
          storage: {
            s3: {
              endpoint: "http://localhost:9000",
              region: "us-east-1",
              bucket: "telegram-mcp-media",
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
        },
        null,
        2,
      ),
    );

    process.chdir(workspace);
    const config = loadConfig();
    expect(config.server.name).toBe("preferred");
    expect(config.server.port).toBe(3001);
  });
});
