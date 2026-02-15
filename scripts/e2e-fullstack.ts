import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

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
  const workspacePath = await mkdtemp(join(tmpdir(), "telegram-mcp-fullstack-"));
  const runPort = 33_001;
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.TELEGRAM_MCP_MASTER_KEY;
  delete env.TELEGRAM_MCP_PREVIOUS_MASTER_KEY;
  delete env.TELEGRAM_MCP_CONFIG;
  delete env.TELEGRAM_MCP_TRANSPORT;
  delete env.TELEGRAM_MCP_PORT;
  let runProcess: ReturnType<typeof spawn> | null = null;

  try {
    runCommand(
      composeBinary,
      [...composeArgs, "up", "-d", "postgres", "keycloak", "minio", "minio-init"],
      repoRoot,
      env,
    );

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
  } finally {
    if (runProcess && !runProcess.killed && runProcess.exitCode === null) {
      runProcess.kill();
      await Promise.race([once(runProcess, "exit"), delay(5_000)]);
    }
    runCommand(composeBinary, [...composeArgs, "down", "--remove-orphans"], repoRoot, env);
    await rm(workspacePath, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
