import { z } from "zod";
import type { AuditService } from "../../audit/audit-service.js";
import type { PolicyEngine } from "../../policy/engine.js";
import { EncryptionService } from "../../storage/encryption.js";
import {
  AccountRepository,
  IdempotencyRepository,
} from "../../storage/repositories.js";
import type { Principal, TelegramToolRequest } from "../../types/core.js";
import { TelegramBotApiClient } from "./client.js";
import {
  BOT_METHODS_BY_FAMILY,
  BOT_METHODS_BY_NAME,
  type BotToolFamily,
} from "./method-matrix.js";
import { validateBotMethodInput } from "./method-schemas.js";

const telegramToolRequestSchema = z.object({
  accountRef: z.string().min(1),
  operation: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export type ParsedTelegramToolRequest = z.infer<typeof telegramToolRequestSchema>;

export class TelegramBotService {
  constructor(
    private readonly botClient: TelegramBotApiClient,
    private readonly accountRepository: AccountRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly encryptionService: EncryptionService,
    private readonly policyEngine: PolicyEngine,
    private readonly audit: AuditService,
  ) {}

  parseRequest(input: unknown): ParsedTelegramToolRequest {
    return telegramToolRequestSchema.parse(input);
  }

  async executeDomainTool(
    family: BotToolFamily,
    request: TelegramToolRequest<Record<string, unknown>>,
    principal: Principal,
  ): Promise<Record<string, unknown>> {
    const parsed = telegramToolRequestSchema.parse(request);
    const method = this.resolveMethodName(family, parsed.operation, parsed.input);
    const methodPayload = this.resolveMethodPayload(family, parsed.input);
    validateBotMethodInput(method, methodPayload);
    const methodSpec = BOT_METHODS_BY_NAME[method];
    const riskLevel = methodSpec?.riskLevel ?? "critical";
    const toolName = `telegram.bot.${family}`;

    const decision = this.policyEngine.evaluate({
      principal,
      tool: toolName,
      operation: method,
      riskLevel,
    });

    await this.audit.log({
      principalSubject: principal.subject,
      action: "tool_authorize",
      tool: toolName,
      operation: method,
      allowed: decision.allow,
      reason: decision.reason,
      metadata: {
        accountRef: parsed.accountRef,
      },
    });

    if (!decision.allow) {
      throw new Error(`Policy denied operation: ${decision.reason}`);
    }

    if (parsed.dryRun) {
      return {
        ok: true,
        dryRun: true,
        method,
        family,
      };
    }

    if (parsed.idempotencyKey) {
      const cached = await this.idempotencyRepository.tryGet(parsed.idempotencyKey);
      if (cached) {
        return cached;
      }
    }

    const token = await this.resolveBotToken(parsed.accountRef);
    const result = await this.botClient.callApi<Record<string, unknown>>(
      token,
      method,
      methodPayload,
    );
    const response = {
      ok: true,
      method,
      result,
    };

    if (parsed.idempotencyKey) {
      await this.idempotencyRepository.save(
        parsed.idempotencyKey,
        `${family}.${method}`,
        response,
      );
    }

    await this.audit.log({
      principalSubject: principal.subject,
      action: "tool_execute",
      tool: toolName,
      operation: method,
      allowed: true,
      reason: "execution succeeded",
      metadata: {
        accountRef: parsed.accountRef,
      },
    });

    return response;
  }

  private resolveMethodName(
    family: BotToolFamily,
    operation: string,
    input: Record<string, unknown>,
  ): string {
    if (family === "raw") {
      const rawMethod = input.method;
      if (typeof rawMethod !== "string" || rawMethod.length < 2) {
        throw new Error("Raw tool requires input.method");
      }
      return rawMethod;
    }

    if (BOT_METHODS_BY_NAME[operation]) {
      const found = BOT_METHODS_BY_NAME[operation];
      if (found.family !== family) {
        throw new Error(
          `Method ${operation} is not allowed for family ${family}; expected ${found.family}`,
        );
      }
      return operation;
    }

    const familyMethods = BOT_METHODS_BY_FAMILY[family];
    const byCaseInsensitive = familyMethods.find(
      (item) => item.method.toLowerCase() === operation.toLowerCase(),
    );
    if (!byCaseInsensitive) {
      throw new Error(`Unknown or unsupported operation "${operation}" for ${family}`);
    }
    return byCaseInsensitive.method;
  }

  private resolveMethodPayload(
    family: BotToolFamily,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    if (family !== "raw") {
      return input;
    }

    const params = input.params;
    if (params && typeof params === "object" && !Array.isArray(params)) {
      return params as Record<string, unknown>;
    }

    const { method: _method, ...rest } = input;
    return rest;
  }

  private async resolveBotToken(accountRef: string): Promise<string> {
    const account = await this.accountRepository.findBotAccountByRef(accountRef);
    if (!account) {
      throw new Error(`Bot account not found: ${accountRef}`);
    }
    return this.encryptionService.decrypt(
      this.encryptionService.deserialize(account.encryptedToken),
    );
  }
}
