import { readFileSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { z } from "zod";
import { createContainer } from "../app/container.js";
import { loadConfig } from "../app/config.js";
import { createLogger } from "../app/logger.js";
import { runMigrations } from "../storage/migrations.js";
import { createDatabase } from "../storage/db.js";
import { runHttpTransport } from "../transports/http/run.js";
import { runStdioTransport } from "../transports/stdio/run.js";

const roleSchema = z.enum(["owner", "admin", "operator", "readonly"]);
const toolPermissionSchema = z.object({
  tool: z.string().min(1),
  operations: z.array(z.string().min(1)).min(1),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  effect: z.enum(["allow", "deny"]),
});
const policyFileSchema = z.object({
  version: z.string().min(1),
  defaultEffect: z.enum(["allow", "deny"]),
  allowRawToolForRoles: z.array(roleSchema),
  permissions: z.array(toolPermissionSchema),
});

async function promptValue(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const result = await rl.question(question);
    return result.trim();
  } finally {
    rl.close();
  }
}

export function createCli(): Command {
  const cli = new Command();
  cli
    .name("telegram-mcp")
    .description("Production-ready Telegram MCP server")
    .version("0.1.0");

  cli
    .command("serve")
    .description("Run the MCP server")
    .option("--transport <transport>", "stdio or http")
    .option("--port <port>", "HTTP port", (value) => Number.parseInt(value, 10))
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      if (options.transport) {
        config.server.transport =
          options.transport === "stdio" ? "stdio" : "http";
      }
      if (Number.isInteger(options.port)) {
        config.server.port = options.port;
      }
      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      if (config.server.transport === "stdio") {
        await runStdioTransport(container);
        return;
      }
      await runHttpTransport(container);
    });

  cli
    .command("migrate")
    .description("Run PostgreSQL schema migrations")
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      const db = createDatabase(config);
      await runMigrations(db);
      await db.close();
      console.log("Migrations applied successfully");
    });

  cli
    .command("policy")
    .description("Policy tooling")
    .command("validate")
    .requiredOption("--file <path>", "Path to policy JSON")
    .action(async (options) => {
      const raw = readFileSync(options.file, "utf8");
      const candidate = JSON.parse(raw);
      policyFileSchema.parse(candidate);
      console.log("Policy file is valid");
    });

  const bot = cli.command("bot").description("Bot account and webhook operations");
  bot
    .command("account-upsert")
    .requiredOption("--account-ref <accountRef>", "Bot account reference")
    .requiredOption("--display-name <displayName>", "Human-readable name")
    .requiredOption("--token <token>", "Bot token")
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      await container.accountRepository.upsertBotAccount({
        accountRef: options.accountRef,
        displayName: options.displayName,
        encryptedToken: container.encryption.encrypt(options.token),
      });
      console.log("Bot account upserted");
      await container.db.close();
    });

  const webhook = bot.command("webhook").description("Webhook management");
  webhook
    .command("set")
    .alias("webhook-set")
    .requiredOption("--account-ref <accountRef>", "Bot account reference")
    .requiredOption("--url <url>", "Webhook URL")
    .option("--secret-token <secretToken>", "Webhook secret")
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      const result = await container.botService.executeDomainTool(
        "webhooks",
        {
          accountRef: options.accountRef,
          operation: "setWebhook",
          input: {
            url: options.url,
            secret_token: options.secretToken,
          },
        },
        {
          subject: "local-cli",
          roles: ["owner"],
          tenantId: "default",
          authSource: "local",
        },
      );
      console.log(JSON.stringify(result, null, 2));
      await container.db.close();
    });

  const mtproto = cli.command("mtproto").description("MTProto foundation commands");
  const session = mtproto.command("session").description("Manage MTProto sessions");

  session
    .command("add")
    .requiredOption("--account-ref <accountRef>", "Session account reference")
    .requiredOption("--display-name <displayName>", "Display name")
    .requiredOption("--phone <phone>", "Phone number")
    .option("--code <code>", "Login code")
    .option("--password <password>", "2FA password")
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      const logger = createLogger(config);
      const container = await createContainer(config, logger);

      const code =
        options.code ?? (await promptValue("Telegram login code (from Telegram): "));
      const password =
        options.password ??
        (await promptValue("2FA password (press enter if not enabled): "));

      await container.mtprotoSessionManager.addSession({
        accountRef: options.accountRef,
        displayName: options.displayName,
        phoneNumber: options.phone,
        phoneCodeProvider: async () => code,
        passwordProvider: password ? async () => password : undefined,
      });
      console.log("MTProto session stored");
      await container.db.close();
    });

  session
    .command("list")
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      const sessions = await container.mtprotoSessionManager.listSessions();
      console.log(JSON.stringify(sessions, null, 2));
      await container.db.close();
    });

  session
    .command("revoke")
    .requiredOption("--account-ref <accountRef>", "Session account reference")
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      const removed = await container.mtprotoSessionManager.revokeSession(
        options.accountRef,
      );
      console.log(JSON.stringify({ removed }, null, 2));
      await container.db.close();
    });

  session
    .command("health")
    .requiredOption("--account-ref <accountRef>", "Session account reference")
    .option("--config <path>", "Path to config file")
    .action(async (options) => {
      const config = loadConfig(options.config);
      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      const result = await container.mtprotoSessionManager.health(options.accountRef);
      console.log(JSON.stringify(result, null, 2));
      await container.db.close();
    });

  return cli;
}
