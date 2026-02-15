import { setTimeout as sleep } from "node:timers/promises";
import type pino from "pino";
import { fetch } from "undici";
import type { AppConfig } from "../../app/config.js";
import type { AppMetrics } from "../../app/logger.js";

function computeBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 10_000);
}

export class TelegramBotApiClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: pino.Logger,
    private readonly metrics: AppMetrics | null,
  ) {}

  async callApi<TResponse = unknown>(
    token: string,
    method: string,
    payload: Record<string, unknown>,
  ): Promise<TResponse> {
    let attempt = 0;
    const maxRetries = this.config.telegram.maxRetries;
    const endpoint = `${this.config.telegram.baseUrl}/bot${token}/${method}`;
    while (true) {
      const started = Date.now();
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.config.telegram.requestTimeoutMs),
        });
        const duration = Date.now() - started;
        const json = (await response.json()) as {
          ok: boolean;
          result?: TResponse;
          error_code?: number;
          description?: string;
          parameters?: {
            retry_after?: number;
          };
        };

        this.metrics?.telegramApiLatencyMs.observe(
          { method, status: response.status.toString() },
          duration,
        );

        if (response.ok && json.ok) {
          return json.result as TResponse;
        }

        const errorCode = json.error_code ?? response.status;
        this.metrics?.telegramApiErrors.inc({
          method,
          code: String(errorCode),
        });

        if (
          attempt < maxRetries &&
          (errorCode === 429 || errorCode >= 500 || response.status >= 500)
        ) {
          const retryAfter = json.parameters?.retry_after;
          const waitMs =
            typeof retryAfter === "number" ? retryAfter * 1000 : computeBackoffMs(attempt);
          attempt += 1;
          this.logger.warn(
            { method, errorCode, attempt, waitMs },
            "telegram api call failed, retrying",
          );
          await sleep(waitMs);
          continue;
        }

        throw new Error(
          `Telegram API error (${errorCode}) for ${method}: ${json.description ?? "unknown error"}`,
        );
      } catch (error) {
        this.metrics?.telegramApiErrors.inc({
          method,
          code: "network_error",
        });
        if (attempt < maxRetries) {
          const waitMs = computeBackoffMs(attempt);
          attempt += 1;
          this.logger.warn(
            { err: error, method, attempt, waitMs },
            "telegram api network error, retrying",
          );
          await sleep(waitMs);
          continue;
        }
        throw error;
      }
    }
  }
}
