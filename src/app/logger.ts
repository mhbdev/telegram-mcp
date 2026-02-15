import pino from "pino";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";
import type { AppConfig } from "./config.js";

export interface AppMetrics {
  registry: Registry;
  authFailures: Counter<"source">;
  policyDenies: Counter<"tool">;
  telegramApiLatencyMs: Histogram<"method" | "status">;
  telegramApiErrors: Counter<"method" | "code">;
  mtprotoSessionHealth: Counter<"status">;
}

export function createLogger(config: AppConfig) {
  return pino({
    level: config.observability.logLevel,
    redact: {
      paths: [
        "req.headers.authorization",
        "payload.token",
        "payload.password",
        "metadata.token",
        "metadata.session",
      ],
      remove: true,
    },
    base: {
      service: "telegram-mcp",
      env: process.env.NODE_ENV ?? "development",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function createMetrics(enabled: boolean): AppMetrics | null {
  if (!enabled) {
    return null;
  }

  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const authFailures = new Counter({
    name: "telegram_mcp_auth_failures_total",
    help: "Total number of failed auth checks",
    labelNames: ["source"] as const,
    registers: [registry],
  });

  const policyDenies = new Counter({
    name: "telegram_mcp_policy_denies_total",
    help: "Total number of denied tool executions",
    labelNames: ["tool"] as const,
    registers: [registry],
  });

  const telegramApiLatencyMs = new Histogram({
    name: "telegram_mcp_telegram_api_latency_ms",
    help: "Latency of Telegram API calls in milliseconds",
    labelNames: ["method", "status"] as const,
    buckets: [10, 25, 50, 100, 250, 500, 1000, 3000, 10000],
    registers: [registry],
  });

  const telegramApiErrors = new Counter({
    name: "telegram_mcp_telegram_api_errors_total",
    help: "Total Telegram API errors",
    labelNames: ["method", "code"] as const,
    registers: [registry],
  });

  const mtprotoSessionHealth = new Counter({
    name: "telegram_mcp_mtproto_session_health_total",
    help: "MTProto session health checks by status",
    labelNames: ["status"] as const,
    registers: [registry],
  });

  return {
    registry,
    authFailures,
    policyDenies,
    telegramApiLatencyMs,
    telegramApiErrors,
    mtprotoSessionHealth,
  };
}
