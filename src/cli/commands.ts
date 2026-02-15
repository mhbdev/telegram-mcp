import { existsSync, readFileSync } from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Command } from "commander";
import { z } from "zod";
import { createContainer } from "../app/container.js";
import { createLogger } from "../app/logger.js";
import { createDatabase } from "../storage/db.js";
import { runMigrations } from "../storage/migrations.js";
import { runHttpTransport } from "../transports/http/run.js";
import { runStdioTransport } from "../transports/stdio/run.js";
import {
  ensureMigrationsApplied,
  findExistingConfigPath,
  loadConfigWithOverrides,
  resolveEnvFilePath,
  startLocalDependenciesIfNeeded,
  type CliConfigFormat,
  type CliProfile,
  type CliTransport,
} from "./runtime.js";
import { runSetupCommand } from "./setup.js";

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

interface RuntimeOptions {
  config?: string;
  envFile?: string;
  transport?: string;
  host?: string;
  port?: number;
}

interface SetupLikeOptions extends RuntimeOptions {
  profile?: string;
  format?: string;
  nonInteractive?: boolean;
  yes?: boolean;
  force?: boolean;
  skipDeps?: boolean;
  skipMigrate?: boolean;
  composeFile?: string;
}

async function promptValue(question: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const value = await rl.question(question);
    return value.trim();
  } finally {
    rl.close();
  }
}

function parseProfile(value?: string): CliProfile | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "local" || value === "external") {
    return value;
  }
  throw new Error(`Invalid profile "${value}". Use "local" or "external".`);
}

function parseFormat(value?: string): CliConfigFormat | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "json" || value === "yaml") {
    return value;
  }
  throw new Error(`Invalid format "${value}". Use "json" or "yaml".`);
}

function parseTransport(value?: string): CliTransport | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "stdio" || value === "http") {
    return value;
  }
  throw new Error(`Invalid transport "${value}". Use "stdio" or "http".`);
}

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

async function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const hint = defaultYes ? "Y/n" : "y/N";
    const response = (await rl.question(`${question} [${hint}]: `))
      .trim()
      .toLowerCase();
    if (!response) {
      return defaultYes;
    }
    if (response === "y" || response === "yes") {
      return true;
    }
    if (response === "n" || response === "no") {
      return false;
    }
    throw new Error(`Invalid response "${response}". Use y or n.`);
  } finally {
    rl.close();
  }
}

function buildConfigFromOptions(
  options: RuntimeOptions,
  defaultTransport?: CliTransport,
) {
  return loadConfigWithOverrides({
    configPath: options.config,
    envFilePath: options.envFile,
    transport: parseTransport(options.transport ?? defaultTransport),
    host: options.host,
    port: options.port,
  });
}

async function openContainer(options: RuntimeOptions) {
  const config = buildConfigFromOptions(options);
  const logger = createLogger(config);
  const container = await createContainer(config, logger);
  return {
    config,
    logger,
    container,
  };
}

function addSharedRuntimeOptions(command: Command): Command {
  return command
    .option("--config <path>", "Path to config file")
    .option("--env-file <path>", "Path to .env file");
}

function addRuntimeOverrides(command: Command): Command {
  return addSharedRuntimeOptions(command)
    .option("--transport <transport>", "stdio or http")
    .option("--host <host>", "HTTP host")
    .option("--port <port>", "HTTP port", parsePort);
}

function addSetupRunOptions(command: Command): Command {
  return addRuntimeOverrides(command)
    .option("--profile <profile>", "local or external")
    .option("--format <format>", "json or yaml")
    .option("--non-interactive", "Disable interactive prompts")
    .option("--yes", "Accept defaults in automation mode")
    .option("--force", "Overwrite existing setup artifacts")
    .option("--skip-deps", "Skip local dependency bootstrap")
    .option("--skip-migrate", "Skip migration checks")
    .option("--compose-file <path>", "Path to docker-compose file for local setup");
}

export function createCli(): Command {
  const cli = new Command();
  cli
    .name("telegram-mcp")
    .description("Production-ready Telegram MCP server")
    .version("0.1.0")
    .addHelpText(
      "after",
      `
Examples:
  npx @mhbdev/telegram-mcp@latest setup
  npx @mhbdev/telegram-mcp@latest run
  npx @mhbdev/telegram-mcp@latest serve --transport=http --port=3000`,
    );

  addSetupRunOptions(
    cli.command("setup").description("Create runtime config/env and bootstrap local deps"),
  )
    .action(async (options: SetupLikeOptions) => {
      const result = await runSetupCommand({
        profile: parseProfile(options.profile),
        format: parseFormat(options.format),
        transport: parseTransport(options.transport),
        host: options.host,
        port: options.port,
        config: options.config,
        envFile: options.envFile,
        nonInteractive: Boolean(options.nonInteractive),
        yes: Boolean(options.yes),
        force: Boolean(options.force),
        skipDeps: Boolean(options.skipDeps),
        skipMigrate: Boolean(options.skipMigrate),
        composeFile: options.composeFile,
      });

      console.log(
        JSON.stringify(
          {
            profile: result.profile,
            format: result.format,
            configPath: result.configPath,
            envFilePath: result.envFilePath,
            wroteConfig: result.wroteConfig,
            wroteEnvFile: result.wroteEnvFile,
            startedDependencies: result.startedDependencies,
            migrationsApplied: result.migrationsApplied,
          },
          null,
          2,
        ),
      );
    })
    .addHelpText(
      "after",
      `
Defaults:
  profile=local
  format=json
  config=.telegram-mcp/config.json
  env=.telegram-mcp/.env`,
    );

  addSetupRunOptions(
    cli
      .command("run")
      .description("Self-healing runtime entrypoint (setup + migrate + serve)"),
  )
    .action(async (options: SetupLikeOptions) => {
      const profile = parseProfile(options.profile);
      const transport = parseTransport(options.transport ?? "stdio") ?? "stdio";
      const envFilePath = resolveEnvFilePath(options.envFile);
      const configPath = findExistingConfigPath(options.config);

      const missingArtifacts = !configPath || !existsSync(envFilePath);
      if (missingArtifacts) {
        const interactive =
          !options.nonInteractive &&
          !options.yes &&
          process.stdin.isTTY &&
          process.stdout.isTTY;
        if (!interactive && !options.yes) {
          throw new Error(
            "Setup artifacts are missing. Re-run with --yes (or run in interactive TTY) to allow self-healing setup.",
          );
        }
        const setupResult = await runSetupCommand({
          profile,
          format: parseFormat(options.format),
          transport,
          host: options.host,
          port: options.port,
          config: options.config,
          envFile: options.envFile,
          nonInteractive: Boolean(options.nonInteractive),
          yes: Boolean(options.yes),
          force: Boolean(options.force),
          skipDeps: Boolean(options.skipDeps),
          skipMigrate: Boolean(options.skipMigrate),
          composeFile: options.composeFile,
        });
        console.log(
          `Self-healing setup completed (config: ${setupResult.configPath}, env: ${setupResult.envFilePath})`,
        );
      }

      if (profile === "local" && !options.skipDeps) {
        const dependencyResult = startLocalDependenciesIfNeeded({
          composeFilePath: options.composeFile,
        });
        if (
          dependencyResult.skipped &&
          dependencyResult.reason === "docker_compose_unavailable"
        ) {
          const canPrompt =
            !options.nonInteractive &&
            !options.yes &&
            process.stdin.isTTY &&
            process.stdout.isTTY;
          if (canPrompt) {
            const continueWithoutDeps = await promptYesNo(
              "Docker Compose is unavailable. Continue without local dependency bootstrap?",
              true,
            );
            if (!continueWithoutDeps) {
              throw new Error("Run aborted because Docker Compose is unavailable.");
            }
          } else {
            console.warn(
              "Docker Compose unavailable. Continuing run without local dependency bootstrap.",
            );
          }
        }
      }

      const config = buildConfigFromOptions(options, transport);
      const migrationResult = await ensureMigrationsApplied(config);
      if (migrationResult.applied) {
        console.log("Database migrations applied");
      }

      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      if (config.server.transport === "stdio") {
        await runStdioTransport(container);
        return;
      }
      await runHttpTransport(container);
    })
    .addHelpText(
      "after",
      `
Defaults:
  transport=stdio
  env=.telegram-mcp/.env
  config auto-discovery: .telegram-mcp/config.{json,yaml,yml} -> telegram-mcp.config.json`,
    );

  addRuntimeOverrides(cli.command("serve").description("Run the MCP server"))
    .action(async (options: RuntimeOptions) => {
      const config = buildConfigFromOptions(options);
      const logger = createLogger(config);
      const container = await createContainer(config, logger);
      if (config.server.transport === "stdio") {
        await runStdioTransport(container);
        return;
      }
      await runHttpTransport(container);
    })
    .addHelpText(
      "after",
      `
Examples:
  telegram-mcp serve --transport=stdio
  telegram-mcp serve --transport=http --host=127.0.0.1 --port=3000`,
    );

  addSharedRuntimeOptions(
    cli.command("migrate").description("Run PostgreSQL schema migrations"),
  ).action(async (options: RuntimeOptions) => {
    const config = buildConfigFromOptions(options);
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
  addSharedRuntimeOptions(
    bot
      .command("account-upsert")
      .requiredOption("--account-ref <accountRef>", "Bot account reference")
      .requiredOption("--display-name <displayName>", "Human-readable name")
      .requiredOption("--token <token>", "Bot token"),
  ).action(async (options) => {
    const { container } = await openContainer(options);
    await container.accountRepository.upsertBotAccount({
      accountRef: options.accountRef,
      displayName: options.displayName,
      encryptedToken: container.encryption.encrypt(options.token),
    });
    console.log("Bot account upserted");
    await container.db.close();
  });

  const webhook = bot.command("webhook").description("Webhook management");
  addSharedRuntimeOptions(
    webhook
      .command("set")
      .alias("webhook-set")
      .requiredOption("--account-ref <accountRef>", "Bot account reference")
      .requiredOption("--url <url>", "Webhook URL")
      .option("--secret-token <secretToken>", "Webhook secret"),
  ).action(async (options) => {
    const { container } = await openContainer(options);
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

  addSharedRuntimeOptions(
    session
      .command("add")
      .requiredOption("--account-ref <accountRef>", "Session account reference")
      .requiredOption("--display-name <displayName>", "Display name")
      .requiredOption("--phone <phone>", "Phone number")
      .option("--code <code>", "Login code")
      .option("--password <password>", "2FA password"),
  ).action(async (options) => {
    const { container } = await openContainer(options);
    const code = options.code
      ? options.code
      : await promptValue("Telegram login code (from Telegram): ");
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

  addSharedRuntimeOptions(session.command("list")).action(async (options) => {
    const { container } = await openContainer(options);
    const sessions = await container.mtprotoSessionManager.listSessions();
    console.log(JSON.stringify(sessions, null, 2));
    await container.db.close();
  });

  addSharedRuntimeOptions(
    session
      .command("revoke")
      .requiredOption("--account-ref <accountRef>", "Session account reference"),
  ).action(async (options) => {
    const { container } = await openContainer(options);
    const removed = await container.mtprotoSessionManager.revokeSession(
      options.accountRef,
    );
    console.log(JSON.stringify({ removed }, null, 2));
    await container.db.close();
  });

  addSharedRuntimeOptions(
    session
      .command("health")
      .requiredOption("--account-ref <accountRef>", "Session account reference"),
  ).action(async (options) => {
    const { container } = await openContainer(options);
    const result = await container.mtprotoSessionManager.health(options.accountRef);
    console.log(JSON.stringify(result, null, 2));
    await container.db.close();
  });

  return cli;
}
