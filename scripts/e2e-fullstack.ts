import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";

function detectComposeCommand(): string[] {
  const dockerCompose = spawnSync("docker", ["compose", "version"], {
    stdio: "ignore",
  });
  if (dockerCompose.status === 0) {
    return ["docker", "compose"];
  }
  const legacy = spawnSync("docker-compose", ["version"], {
    stdio: "ignore",
  });
  if (legacy.status === 0) {
    return ["docker-compose"];
  }
  throw new Error("Docker Compose is required for full-stack e2e.");
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${[command, ...args].join(" ")}`);
  }
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to resolve free port"));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePort(port);
      });
    });
  });
}

async function findFreePorts(count: number): Promise<number[]> {
  const ports = new Set<number>();
  while (ports.size < count) {
    ports.add(await findFreePort());
  }
  return [...ports];
}

async function waitForOk(url: string, timeoutMs = 45_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(400);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPostgres(databaseUrl: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const client = new Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      try {
        await client.end();
      } catch {
        // ignore shutdown failures while retrying
      }
    }
    await delay(500);
  }

  throw new Error(`Timed out waiting for PostgreSQL at ${databaseUrl}`);
}

async function main(): Promise<void> {
  const repoRoot = resolve(process.cwd());
  const cliEntryPath = resolve(repoRoot, "dist", "index.cjs");
  const composeFilePath = resolve(repoRoot, "docker", "docker-compose.yml");
  if (!existsSync(cliEntryPath)) {
    throw new Error(`Build output missing at ${cliEntryPath}. Run "npm run build" first.`);
  }
  if (!existsSync(composeFilePath)) {
    throw new Error(`Compose file missing at ${composeFilePath}`);
  }

  const composeCommand = detectComposeCommand();
  const [composeBinary, ...composePrefix] = composeCommand;
  const composeArgs = [...composePrefix, "-f", composeFilePath];
  const [postgresPort, keycloakPort, minioApiPort, minioConsolePort, runPort] =
    await findFreePorts(5);
  const databaseUrl = `postgresql://telegram_mcp:telegram_mcp@127.0.0.1:${postgresPort}/telegram_mcp`;
  const workspacePath = await mkdtemp(join(tmpdir(), "telegram-mcp-fullstack-"));
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.TELEGRAM_MCP_MASTER_KEY;
  delete env.TELEGRAM_MCP_PREVIOUS_MASTER_KEY;
  delete env.TELEGRAM_MCP_CONFIG;
  delete env.TELEGRAM_MCP_TRANSPORT;
  delete env.TELEGRAM_MCP_PORT;
  delete env.TELEGRAM_MCP_DATABASE_URL;
  delete env.TELEGRAM_MCP_POSTGRES_PORT;
  delete env.TELEGRAM_MCP_KEYCLOAK_PORT;
  delete env.TELEGRAM_MCP_MINIO_API_PORT;
  delete env.TELEGRAM_MCP_MINIO_CONSOLE_PORT;
  env.TELEGRAM_MCP_MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  env.TELEGRAM_MCP_PREVIOUS_MASTER_KEY = "";
  env.TELEGRAM_MCP_DATABASE_URL = databaseUrl;
  env.TELEGRAM_MCP_POSTGRES_PORT = String(postgresPort);
  env.TELEGRAM_MCP_KEYCLOAK_PORT = String(keycloakPort);
  env.TELEGRAM_MCP_MINIO_API_PORT = String(minioApiPort);
  env.TELEGRAM_MCP_MINIO_CONSOLE_PORT = String(minioConsolePort);
  let runProcess: ReturnType<typeof spawn> | null = null;
  let executionError: unknown = null;

  try {
    runCommand(
      composeBinary,
      [...composeArgs, "up", "-d", "postgres", "keycloak", "minio", "minio-init"],
      repoRoot,
      env,
    );
    await waitForPostgres(databaseUrl);

    runCommand(
      process.execPath,
      [
        cliEntryPath,
        "setup",
        "--profile",
        "local",
        "--non-interactive",
        "--yes",
        "--force",
        "--skip-deps",
        "--compose-file",
        composeFilePath,
      ],
      workspacePath,
      env,
    );

    runProcess = spawn(
      process.execPath,
      [
        cliEntryPath,
        "run",
        "--profile",
        "local",
        "--transport",
        "http",
        "--host",
        "127.0.0.1",
        "--port",
        String(runPort),
        "--non-interactive",
        "--yes",
        "--compose-file",
        composeFilePath,
      ],
      {
        cwd: workspacePath,
        env,
        stdio: "inherit",
      },
    );

    await waitForOk(`http://127.0.0.1:${runPort}/healthz`);
    await waitForOk(`http://127.0.0.1:${runPort}/readyz`);
    console.log("Full-stack e2e completed successfully.");
  } catch (error) {
    executionError = error;
    throw error;
  } finally {
    let cleanupError: unknown = null;

    if (runProcess && !runProcess.killed && runProcess.exitCode === null) {
      try {
        runProcess.kill();
        await Promise.race([once(runProcess, "exit"), delay(5_000)]);
      } catch (error) {
        cleanupError = error;
      }
    }

    try {
      runCommand(composeBinary, [...composeArgs, "down", "--remove-orphans"], repoRoot, env);
    } catch (error) {
      cleanupError = cleanupError ?? error;
      console.error("Failed to stop Docker Compose dependencies during cleanup.", error);
    }

    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch (error) {
      cleanupError = cleanupError ?? error;
      console.error("Failed to remove temporary workspace during cleanup.", error);
    }

    if (!executionError && cleanupError) {
      throw cleanupError;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
