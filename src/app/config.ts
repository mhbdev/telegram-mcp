import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const serverSchema = z.object({
  name: z.string().min(1).default("telegram-mcp"),
  version: z.string().min(1).default("0.1.0"),
  transport: z.enum(["stdio", "http"]).default("http"),
  host: z.string().default("127.0.0.1"),
  port: z.number().int().min(1).max(65535).default(3000),
});

const authSchema = z.object({
  issuer: z.string().url(),
  audience: z.string().min(1),
  jwksUri: z.string().url(),
  required: z.boolean().default(true),
});

const databaseSchema = z.object({
  url: z.string().min(1),
  maxConnections: z.number().int().min(1).default(20),
  ssl: z.boolean().default(false),
});

const encryptionSchema = z.object({
  masterKeyEnv: z.string().default("TELEGRAM_MCP_MASTER_KEY"),
  previousMasterKeyEnv: z
    .string()
    .default("TELEGRAM_MCP_PREVIOUS_MASTER_KEY"),
});

const telegramSchema = z.object({
  requestTimeoutMs: z.number().int().min(1000).default(20_000),
  maxRetries: z.number().int().min(0).max(10).default(4),
  baseUrl: z.string().url().default("https://api.telegram.org"),
  updateMode: z.enum(["webhook", "polling"]).default("webhook"),
  apiId: z.number().int().positive().optional(),
  apiHash: z.string().min(10).optional(),
  mtproto: z
    .object({
      rateLimit: z.number().int().positive().default(30),
      retry: z.number().int().min(0).max(10).default(3),
      floodWaitPolicy: z.enum(["respect", "error"]).default("respect"),
    })
    .default({
      rateLimit: 30,
      retry: 3,
      floodWaitPolicy: "respect",
    }),
});

const policySchema = z.object({
  defaultEffect: z.enum(["allow", "deny"]).default("deny"),
  allowRawToolForRoles: z
    .array(z.enum(["owner", "admin", "operator", "readonly"]))
    .default(["owner", "admin"]),
});

const observabilitySchema = z.object({
  logLevel: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  metricsEnabled: z.boolean().default(true),
});

const storageSchema = z.object({
  s3: z.object({
    endpoint: z.string().url().optional(),
    region: z.string().default("us-east-1"),
    bucket: z.string().min(3),
    accessKeyEnv: z.string().default("TELEGRAM_MCP_S3_ACCESS_KEY"),
    secretKeyEnv: z.string().default("TELEGRAM_MCP_S3_SECRET_KEY"),
    forcePathStyle: z.boolean().default(true),
    signedUrlTtlSeconds: z.number().int().min(30).max(86_400).default(900),
  }),
});

const approvalsSchema = z.object({
  enabled: z.boolean().default(true),
  ttlSeconds: z.number().int().min(60).max(86_400).default(900),
  requiredRiskLevels: z
    .array(z.enum(["low", "medium", "high", "critical"]))
    .default(["high", "critical"]),
  maxPending: z.number().int().positive().default(1000),
});

const retentionSchema = z.object({
  mode: z.enum(["metadata_only", "encrypted_content"]).default("metadata_only"),
  contentTtlDays: z.number().int().positive().default(30),
});

export const configSchema = z.object({
  server: serverSchema,
  auth: authSchema,
  database: databaseSchema,
  encryption: encryptionSchema,
  telegram: telegramSchema,
  policy: policySchema,
  storage: storageSchema,
  approvals: approvalsSchema,
  retention: retentionSchema,
  observability: observabilitySchema,
});

export type AppConfig = z.infer<typeof configSchema>;

function mergeEnvOverrides(config: AppConfig): AppConfig {
  const patch: Partial<AppConfig> = {};
  const httpPortRaw = process.env.TELEGRAM_MCP_PORT;
  if (httpPortRaw) {
    const httpPort = Number.parseInt(httpPortRaw, 10);
    if (!Number.isNaN(httpPort)) {
      patch.server = { ...config.server, port: httpPort };
    }
  }

  const transport = process.env.TELEGRAM_MCP_TRANSPORT;
  if (transport === "stdio" || transport === "http") {
    patch.server = {
      ...(patch.server ?? config.server),
      transport,
    };
  }

  const databaseUrl = process.env.TELEGRAM_MCP_DATABASE_URL;
  if (databaseUrl) {
    patch.database = { ...config.database, url: databaseUrl };
  }

  return {
    ...config,
    ...patch,
  };
}

export function loadConfig(configPath?: string): AppConfig {
  const path = configPath ?? process.env.TELEGRAM_MCP_CONFIG;
  let candidate: unknown = {};
  if (path) {
    if (!existsSync(path)) {
      throw new Error(`Config file not found: ${path}`);
    }
    const raw = readFileSync(path, "utf8");
    candidate = JSON.parse(raw);
  } else {
    const fallbackPath = "telegram-mcp.config.json";
    if (existsSync(fallbackPath)) {
      candidate = JSON.parse(readFileSync(fallbackPath, "utf8"));
    } else {
      candidate = JSON.parse(
        readFileSync("telegram-mcp.config.example.json", "utf8"),
      );
    }
  }

  const parsed = configSchema.parse(candidate);
  return mergeEnvOverrides(parsed);
}
