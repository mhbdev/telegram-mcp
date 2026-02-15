import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { loadConfig, type AppConfig } from "../app/config.js";
import { createDatabase } from "../storage/db.js";
import { runMigrations } from "../storage/migrations.js";

export type CliProfile = "local" | "external";
export type CliConfigFormat = "json" | "yaml";
export type CliTransport = "stdio" | "http";

const DEFAULT_CONFIG_DIR = ".telegram-mcp";
const DEFAULT_ENV_FILE = ".env";
const USER_CONFIG_CANDIDATES = [
  `${DEFAULT_CONFIG_DIR}/config.json`,
  `${DEFAULT_CONFIG_DIR}/config.yaml`,
  `${DEFAULT_CONFIG_DIR}/config.yml`,
  "telegram-mcp.config.json",
  "telegram-mcp.config.example.json",
] as const;

const LOCAL_DEPENDENCY_SERVICES = [
  "postgres",
  "keycloak",
  "minio",
  "minio-init",
] as const;

export interface RuntimePaths {
  configDirPath: string;
  configPath: string;
  envFilePath: string;
  packageRootPath: string;
  defaultComposeFilePath: string;
  exampleConfigPath: string;
}

export interface ResolveRuntimePathsOptions {
  configPath?: string;
  envFilePath?: string;
  format?: CliConfigFormat;
}

export interface LoadEnvFileOptions {
  envFilePath?: string;
  required?: boolean;
}

export interface LoadEnvFileResult {
  path: string;
  loaded: boolean;
}

export interface LoadConfigWithOverridesOptions {
  configPath?: string;
  envFilePath?: string;
  transport?: CliTransport;
  host?: string;
  port?: number;
}

export interface EnsureMigrationsAppliedResult {
  applied: boolean;
}

export interface DockerComposeDetection {
  available: boolean;
  command: string[];
}

export interface StartLocalDependenciesOptions {
  composeFilePath?: string;
  services?: readonly string[];
  skipDeps?: boolean;
  quiet?: boolean;
}

export interface StartLocalDependenciesResult {
  started: boolean;
  skipped: boolean;
  reason?: "skip_requested" | "docker_compose_unavailable";
  composeFilePath: string;
  command?: string;
}

function toAbsolutePath(pathValue: string): string {
  return isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
}

function resolvePackageRootPath(): string {
  const argvPath = process.argv[1];
  if (!argvPath) {
    return process.cwd();
  }
  const entryPath = toAbsolutePath(argvPath);
  return resolve(dirname(entryPath), "..");
}

function getDefaultConfigPath(format: CliConfigFormat): string {
  const extension = format === "yaml" ? "yaml" : "json";
  return resolve(process.cwd(), DEFAULT_CONFIG_DIR, `config.${extension}`);
}

function parseEnvContent(raw: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex).trim();
    const value = trimmed.slice(equalsIndex + 1).trim();
    if (!key) {
      continue;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      values[key] = value.slice(1, -1);
      continue;
    }
    values[key] = value;
  }
  return values;
}

function isMissingSchemaMigrationTable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const pgError = error as { code?: string };
  return pgError.code === "42P01";
}

export function resolveRuntimePaths(
  options: ResolveRuntimePathsOptions = {},
): RuntimePaths {
  const format = options.format ?? "json";
  const configPath = options.configPath
    ? toAbsolutePath(options.configPath)
    : getDefaultConfigPath(format);
  const configDirPath = resolve(process.cwd(), DEFAULT_CONFIG_DIR);
  const envFilePath = options.envFilePath
    ? toAbsolutePath(options.envFilePath)
    : resolve(configDirPath, DEFAULT_ENV_FILE);
  const packageRootPath = resolvePackageRootPath();
  const defaultComposeFilePath = resolve(
    packageRootPath,
    "docker",
    "docker-compose.yml",
  );
  const exampleConfigPath = resolve(packageRootPath, "telegram-mcp.config.example.json");

  return {
    configDirPath,
    configPath,
    envFilePath,
    packageRootPath,
    defaultComposeFilePath,
    exampleConfigPath,
  };
}

export function findExistingConfigPath(configPath?: string): string | null {
  if (configPath) {
    const absolute = toAbsolutePath(configPath);
    return existsSync(absolute) ? absolute : null;
  }

  for (const candidate of USER_CONFIG_CANDIDATES) {
    const absolute = resolve(process.cwd(), candidate);
    if (existsSync(absolute)) {
      return absolute;
    }
  }

  return null;
}

export function resolveEnvFilePath(envFilePath?: string): string {
  if (envFilePath) {
    return toAbsolutePath(envFilePath);
  }
  return resolve(process.cwd(), DEFAULT_CONFIG_DIR, DEFAULT_ENV_FILE);
}

export function readEnvFileValues(envFilePath: string): Record<string, string> {
  if (!existsSync(envFilePath)) {
    return {};
  }
  const raw = readFileSync(envFilePath, "utf8");
  return parseEnvContent(raw);
}

export function loadEnvFileIfPresent(
  options: LoadEnvFileOptions = {},
): LoadEnvFileResult {
  const explicitPath = options.envFilePath
    ? toAbsolutePath(options.envFilePath)
    : null;
  const targetPath = explicitPath ?? resolveEnvFilePath();
  const required = options.required ?? false;

  if (!existsSync(targetPath)) {
    if (explicitPath || required) {
      throw new Error(`Env file not found: ${targetPath}`);
    }
    return {
      path: targetPath,
      loaded: false,
    };
  }

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(targetPath);
  } else {
    const values = readEnvFileValues(targetPath);
    for (const [key, value] of Object.entries(values)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  return {
    path: targetPath,
    loaded: true,
  };
}

export function loadConfigWithOverrides(
  options: LoadConfigWithOverridesOptions,
): AppConfig {
  loadEnvFileIfPresent({ envFilePath: options.envFilePath });
  const config = loadConfig(options.configPath);
  if (options.transport) {
    config.server.transport = options.transport;
  }
  if (options.host) {
    config.server.host = options.host;
  }
  if (Number.isInteger(options.port)) {
    config.server.port = options.port as number;
  }
  return config;
}

export async function ensureMigrationsApplied(
  config: AppConfig,
): Promise<EnsureMigrationsAppliedResult> {
  const db = createDatabase(config);
  try {
    let applied = false;
    try {
      const result = await db.query<{ exists: number }>(
        "SELECT 1 AS exists FROM schema_migrations WHERE name = $1 LIMIT 1",
        ["0001_initial_schema"],
      );
      if (result.rowCount === 0) {
        await runMigrations(db);
        applied = true;
      }
    } catch (error) {
      if (!isMissingSchemaMigrationTable(error)) {
        throw error;
      }
      await runMigrations(db);
      applied = true;
    }

    return {
      applied,
    };
  } finally {
    await db.close();
  }
}

export function detectDockerCompose(): DockerComposeDetection {
  const dockerCompose = spawnSync("docker", ["compose", "version"], {
    stdio: "ignore",
  });
  if (dockerCompose.status === 0) {
    return {
      available: true,
      command: ["docker", "compose"],
    };
  }

  const legacyCompose = spawnSync("docker-compose", ["version"], {
    stdio: "ignore",
  });
  if (legacyCompose.status === 0) {
    return {
      available: true,
      command: ["docker-compose"],
    };
  }

  return {
    available: false,
    command: [],
  };
}

export function startLocalDependenciesIfNeeded(
  options: StartLocalDependenciesOptions = {},
): StartLocalDependenciesResult {
  const runtimePaths = resolveRuntimePaths();
  const composeFilePath = options.composeFilePath
    ? toAbsolutePath(options.composeFilePath)
    : runtimePaths.defaultComposeFilePath;

  if (options.skipDeps) {
    return {
      started: false,
      skipped: true,
      reason: "skip_requested",
      composeFilePath,
    };
  }

  const detection = detectDockerCompose();
  if (!detection.available) {
    return {
      started: false,
      skipped: true,
      reason: "docker_compose_unavailable",
      composeFilePath,
    };
  }

  const services = options.services ?? LOCAL_DEPENDENCY_SERVICES;
  const command = detection.command[0];
  if (!command) {
    throw new Error("Docker Compose command resolution failed.");
  }
  const commandPrefix = detection.command.slice(1);
  const args = [
    ...commandPrefix,
    "-f",
    composeFilePath,
    "up",
    "-d",
    ...services,
  ];
  const child = spawnSync(command, args, {
    stdio: options.quiet ? "pipe" : "inherit",
    encoding: "utf8",
  });

  if (child.status !== 0) {
    const stderr =
      typeof child.stderr === "string" && child.stderr.trim().length > 0
        ? `\n${child.stderr.trim()}`
        : "";
    throw new Error(
      `Failed to start local dependencies using ${[command, ...args].join(" ")}${stderr}`,
    );
  }

  return {
    started: true,
    skipped: false,
    composeFilePath,
    command: [command, ...args].join(" "),
  };
}
