import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import YAML from "yaml";
import { configSchema, loadConfig, type AppConfig } from "../app/config.js";
import {
  detectDockerCompose,
  ensureMigrationsApplied,
  readEnvFileValues,
  resolveRuntimePaths,
  startLocalDependenciesIfNeeded,
  type CliConfigFormat,
  type CliProfile,
  type CliTransport,
} from "./runtime.js";

export interface SetupCommandOptions {
  profile?: CliProfile;
  format?: CliConfigFormat;
  transport?: CliTransport;
  host?: string;
  port?: number;
  config?: string;
  envFile?: string;
  nonInteractive?: boolean;
  yes?: boolean;
  force?: boolean;
  skipDeps?: boolean;
  skipMigrate?: boolean;
  composeFile?: string;
}

export interface SetupPromptState {
  profile: CliProfile;
  format: CliConfigFormat;
  transport: CliTransport;
  host: string;
  port: number;
  runMigrateForExternal: boolean;
}

export interface InteractivePromptOptions {
  askProfile?: boolean;
  askFormat?: boolean;
  askTransport?: boolean;
  askHostPort?: boolean;
  askExternalMigrate?: boolean;
}

interface ResolvedSetupOptions extends SetupPromptState {
  configPath: string;
  envFilePath: string;
  force: boolean;
  skipDeps: boolean;
  skipMigrate: boolean;
  interactive: boolean;
  composeFilePath?: string;
  explicit: {
    config: boolean;
    envFile: boolean;
    profile: boolean;
    format: boolean;
    transport: boolean;
    host: boolean;
    port: boolean;
  };
}

export interface SetupResult {
  profile: CliProfile;
  format: CliConfigFormat;
  configPath: string;
  envFilePath: string;
  wroteConfig: boolean;
  wroteEnvFile: boolean;
  startedDependencies: boolean;
  migrationsApplied: boolean;
}

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const LOCAL_DEPENDENCY_SERVICES = [
  "postgres",
  "keycloak",
  "minio",
  "minio-init",
] as const;

function inferFormatFromPath(configPath?: string): CliConfigFormat | null {
  if (!configPath) {
    return null;
  }
  const extension = extname(configPath).toLowerCase();
  if (extension === ".json") {
    return "json";
  }
  if (extension === ".yaml" || extension === ".yml") {
    return "yaml";
  }
  return null;
}

function normalizeFormat(options: SetupCommandOptions): CliConfigFormat {
  if (options.format) {
    return options.format;
  }
  const inferred = inferFormatFromPath(options.config);
  if (inferred) {
    return inferred;
  }
  if (options.config) {
    throw new Error(
      `Unsupported config extension for setup output: ${options.config}. Use .json, .yaml, or .yml.`,
    );
  }
  return "json";
}

function shouldUseInteractiveMode(options: SetupCommandOptions): boolean {
  if (options.nonInteractive || options.yes) {
    return false;
  }
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function askChoice(
  rl: readline.Interface,
  label: string,
  choices: readonly string[],
  defaultValue: string,
): Promise<string> {
  const hint = `${choices.join("/")}`;
  const response = (await rl.question(`${label} [${hint}] (${defaultValue}): `)).trim();
  if (!response) {
    return defaultValue;
  }
  const normalized = response.toLowerCase();
  if (!choices.includes(normalized)) {
    throw new Error(`Invalid value "${response}" for ${label}. Expected one of ${hint}.`);
  }
  return normalized;
}

async function askYesNo(
  rl: readline.Interface,
  label: string,
  defaultYes: boolean,
): Promise<boolean> {
  const hint = defaultYes ? "Y/n" : "y/N";
  const response = (await rl.question(`${label} [${hint}]: `)).trim().toLowerCase();
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
}

export async function interactivePromptFlow(
  state: SetupPromptState,
  options: InteractivePromptOptions = {},
): Promise<SetupPromptState> {
  const rl = readline.createInterface({ input, output });
  try {
    const profile = options.askProfile
      ? ((await askChoice(rl, "Profile", ["local", "external"], state.profile)) as
          | CliProfile
          | "local"
          | "external")
      : state.profile;
    const format = options.askFormat
      ? ((await askChoice(rl, "Config format", ["json", "yaml"], state.format)) as
          | CliConfigFormat
          | "json"
          | "yaml")
      : state.format;
    const transport = options.askTransport
      ? ((await askChoice(rl, "Default transport", ["stdio", "http"], state.transport)) as
          | CliTransport
          | "stdio"
          | "http")
      : state.transport;

    let host = state.host;
    let port = state.port;
    if (transport === "http" && options.askHostPort) {
      const hostInput = (await rl.question(`HTTP host (${host}): `)).trim();
      if (hostInput) {
        host = hostInput;
      }
      const portInput = (await rl.question(`HTTP port (${port}): `)).trim();
      if (portInput) {
        const parsedPort = Number.parseInt(portInput, 10);
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
          throw new Error(`Invalid HTTP port: ${portInput}`);
        }
        port = parsedPort;
      }
    }

    let runMigrateForExternal = state.runMigrateForExternal;
    if (profile === "external" && options.askExternalMigrate) {
      runMigrateForExternal = await askYesNo(rl, "Run migrations during setup now?", false);
    }

    return {
      profile,
      format,
      transport,
      host,
      port,
      runMigrateForExternal,
    };
  } finally {
    rl.close();
  }
}

function readExampleConfig(exampleConfigPath: string): AppConfig {
  if (!existsSync(exampleConfigPath)) {
    throw new Error(`Example config template not found: ${exampleConfigPath}`);
  }
  const raw = readFileSync(exampleConfigPath, "utf8");
  return configSchema.parse(JSON.parse(raw));
}

function buildConfigTemplate(
  base: AppConfig,
  options: {
    profile: CliProfile;
    transport: CliTransport;
    host: string;
    port: number;
  },
): AppConfig {
  const config = structuredClone(base);
  config.server.transport = options.transport;
  config.server.host = options.host;
  config.server.port = options.port;
  config.auth.required = options.profile === "local" ? false : true;
  if (process.env.TELEGRAM_MCP_DATABASE_URL) {
    config.database.url = process.env.TELEGRAM_MCP_DATABASE_URL;
  }
  return config;
}

export function createMasterKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

function ensureParentDirectory(filePath: string): void {
  const parent = dirname(filePath);
  mkdirSync(parent, { recursive: true });
}

export function writeConfigFile(
  filePath: string,
  format: CliConfigFormat,
  config: AppConfig,
): void {
  ensureParentDirectory(filePath);
  const body =
    format === "yaml"
      ? YAML.stringify(config)
      : `${JSON.stringify(config, null, 2)}\n`;
  writeFileSync(filePath, body, "utf8");
}

export function writeEnvFile(filePath: string, values: Record<string, string>): void {
  ensureParentDirectory(filePath);
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function shouldOverwritePath(
  targetPath: string,
  label: string,
  force: boolean,
  interactive: boolean,
): Promise<boolean> {
  if (!existsSync(targetPath)) {
    return true;
  }
  if (force) {
    return true;
  }
  if (!interactive) {
    throw new Error(
      `${label} already exists at ${targetPath}. Re-run with --force to overwrite.`,
    );
  }

  const rl = readline.createInterface({ input, output });
  try {
    return await askYesNo(rl, `${label} already exists at ${targetPath}. Overwrite?`, false);
  } finally {
    rl.close();
  }
}

function resolveSetupOptions(options: SetupCommandOptions): ResolvedSetupOptions {
  const format = normalizeFormat(options);
  const runtimePaths = resolveRuntimePaths({
    configPath: options.config,
    envFilePath: options.envFile,
    format,
  });
  const interactive = shouldUseInteractiveMode(options);

  return {
    profile: options.profile ?? "local",
    format,
    transport: options.transport ?? "stdio",
    host: options.host ?? DEFAULT_HOST,
    port: Number.isInteger(options.port) ? (options.port as number) : DEFAULT_PORT,
    runMigrateForExternal: false,
    configPath: runtimePaths.configPath,
    envFilePath: runtimePaths.envFilePath,
    force: Boolean(options.force),
    skipDeps: Boolean(options.skipDeps),
    skipMigrate: Boolean(options.skipMigrate),
    interactive,
    composeFilePath: options.composeFile
      ? resolve(process.cwd(), options.composeFile)
      : runtimePaths.defaultComposeFilePath,
    explicit: {
      profile: Boolean(options.profile),
      config: Boolean(options.config),
      envFile: Boolean(options.envFile),
      format: Boolean(options.format),
      transport: Boolean(options.transport),
      host: Boolean(options.host),
      port: Number.isInteger(options.port),
    },
  };
}

async function applyInteractivePrompts(
  options: ResolvedSetupOptions,
): Promise<ResolvedSetupOptions> {
  if (!options.interactive) {
    return options;
  }
  const prompted = await interactivePromptFlow({
    profile: options.profile,
    format: options.format,
    transport: options.transport,
    host: options.host,
    port: options.port,
    runMigrateForExternal: options.runMigrateForExternal,
  }, {
    askProfile: !options.explicit.profile,
    askFormat: !options.explicit.format,
    askTransport: !options.explicit.transport,
    askHostPort: !options.explicit.host || !options.explicit.port,
    askExternalMigrate: true,
  });

  const runtimePaths = resolveRuntimePaths({
    configPath: options.explicit.config
      ? options.configPath
      : undefined,
    envFilePath: options.explicit.envFile ? options.envFilePath : undefined,
    format: prompted.format,
  });

  return {
    ...options,
    ...prompted,
    configPath: options.explicit.config ? options.configPath : runtimePaths.configPath,
    envFilePath: options.explicit.envFile ? options.envFilePath : runtimePaths.envFilePath,
  };
}

async function handleLocalProfileWithoutDocker(
  options: ResolvedSetupOptions,
): Promise<ResolvedSetupOptions> {
  if (options.profile !== "local" || options.skipDeps) {
    return options;
  }

  const detection = detectDockerCompose();
  if (detection.available) {
    return options;
  }

  if (!options.interactive) {
    console.warn(
      "Docker Compose is unavailable. Continuing setup without dependency bootstrap.",
    );
    return {
      ...options,
      skipDeps: true,
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.warn("Docker Compose is unavailable for local profile setup.");
    const choice = await askChoice(
      rl,
      "Choose fallback",
      ["external", "skip", "abort"],
      "external",
    );
    if (choice === "abort") {
      throw new Error("Setup aborted because Docker Compose is unavailable.");
    }
    if (choice === "external") {
      return {
        ...options,
        profile: "external",
        skipDeps: true,
      };
    }
    return {
      ...options,
      skipDeps: true,
    };
  } finally {
    rl.close();
  }
}

function toSetupEnv(configPath: string, config: AppConfig, masterKey: string) {
  return {
    TELEGRAM_MCP_CONFIG: configPath,
    TELEGRAM_MCP_MASTER_KEY: masterKey,
    TELEGRAM_MCP_PREVIOUS_MASTER_KEY: "",
    TELEGRAM_MCP_DATABASE_URL: config.database.url,
    TELEGRAM_MCP_TRANSPORT: config.server.transport,
    TELEGRAM_MCP_PORT: String(config.server.port),
    TELEGRAM_MCP_S3_ACCESS_KEY:
      process.env[config.storage.s3.accessKeyEnv] ??
      process.env.TELEGRAM_MCP_S3_ACCESS_KEY ??
      "telegram_mcp",
    TELEGRAM_MCP_S3_SECRET_KEY:
      process.env[config.storage.s3.secretKeyEnv] ??
      process.env.TELEGRAM_MCP_S3_SECRET_KEY ??
      "telegram_mcp_password",
  };
}

async function resolveMasterKeyForWrite(
  envFilePath: string,
  writingEnvFile: boolean,
  interactive: boolean,
): Promise<string> {
  if (!writingEnvFile) {
    const existing = readEnvFileValues(envFilePath).TELEGRAM_MCP_MASTER_KEY;
    return existing ?? createMasterKeyBase64();
  }

  if (!existsSync(envFilePath)) {
    return createMasterKeyBase64();
  }

  const existing = readEnvFileValues(envFilePath).TELEGRAM_MCP_MASTER_KEY;
  if (!existing) {
    return createMasterKeyBase64();
  }
  if (!interactive) {
    return existing;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const reuse = await askYesNo(rl, "Reuse existing TELEGRAM_MCP_MASTER_KEY?", true);
    return reuse ? existing : createMasterKeyBase64();
  } finally {
    rl.close();
  }
}

export async function runSetupCommand(options: SetupCommandOptions): Promise<SetupResult> {
  let resolved = resolveSetupOptions(options);
  resolved = await applyInteractivePrompts(resolved);
  resolved = await handleLocalProfileWithoutDocker(resolved);

  const runtimePaths = resolveRuntimePaths({
    configPath: resolved.configPath,
    envFilePath: resolved.envFilePath,
    format: resolved.format,
  });
  const baseConfig = readExampleConfig(runtimePaths.exampleConfigPath);
  const generatedConfig = buildConfigTemplate(baseConfig, {
    profile: resolved.profile,
    transport: resolved.transport,
    host: resolved.host,
    port: resolved.port,
  });

  const shouldWriteConfig = await shouldOverwritePath(
    resolved.configPath,
    "Config file",
    resolved.force,
    resolved.interactive,
  );
  const shouldWriteEnv = await shouldOverwritePath(
    resolved.envFilePath,
    "Env file",
    resolved.force,
    resolved.interactive,
  );

  if (shouldWriteConfig) {
    writeConfigFile(resolved.configPath, resolved.format, generatedConfig);
  }

  const masterKey = await resolveMasterKeyForWrite(
    resolved.envFilePath,
    shouldWriteEnv,
    resolved.interactive,
  );
  if (shouldWriteEnv) {
    const envValues = toSetupEnv(resolved.configPath, generatedConfig, masterKey);
    writeEnvFile(resolved.envFilePath, envValues);
  }

  let startedDependencies = false;
  if (resolved.profile === "local" && !resolved.skipDeps) {
    const startResult = startLocalDependenciesIfNeeded({
      composeFilePath: resolved.composeFilePath,
      services: LOCAL_DEPENDENCY_SERVICES,
    });
    startedDependencies = startResult.started;
  }

  const runMigrationsNow =
    !resolved.skipMigrate &&
    (resolved.profile === "local" || resolved.runMigrateForExternal);

  let migrationsApplied = false;
  if (runMigrationsNow) {
    const configForMigrations = shouldWriteConfig
      ? generatedConfig
      : loadConfig(resolved.configPath);
    const migrationResult = await ensureMigrationsApplied(configForMigrations);
    migrationsApplied = migrationResult.applied;
  }

  return {
    profile: resolved.profile,
    format: resolved.format,
    configPath: resolved.configPath,
    envFilePath: resolved.envFilePath,
    wroteConfig: shouldWriteConfig,
    wroteEnvFile: shouldWriteEnv,
    startedDependencies,
    migrationsApplied,
  };
}
