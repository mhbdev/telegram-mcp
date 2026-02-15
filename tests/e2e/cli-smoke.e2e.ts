import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { afterEach, describe, expect, test } from "vitest";

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const cliEntryPath = resolve(process.cwd(), "dist", "index.cjs");
const databaseUrl =
  process.env.TELEGRAM_MCP_E2E_DATABASE_URL ??
  "postgresql://telegram_mcp:telegram_mcp@127.0.0.1:5432/telegram_mcp";

type ManagedChildProcess = ChildProcessByStdio<null, Readable, Readable>;
const managedChildren = new Set<ManagedChildProcess>();

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
      const port = address.port;
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

async function runCli(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs = 120_000,
): Promise<CliResult> {
  const child = spawn(process.execPath, [cliEntryPath, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  managedChildren.add(child);

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timeout = setTimeout(() => {
    child.kill();
  }, timeoutMs);

  const [code] = (await once(child, "exit")) as [number | null];
  clearTimeout(timeout);
  managedChildren.delete(child);

  return { code, stdout, stderr };
}

async function waitForHttpOk(url: string, timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server not ready yet.
    }
    await delay(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stopProcess(child: ManagedChildProcess): Promise<void> {
  if (child.killed || child.exitCode !== null) {
    return;
  }
  child.kill();
  await Promise.race([
    once(child, "exit"),
    delay(5_000).then(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }),
  ]);
}

describe("cli smoke e2e", () => {
  afterEach(async () => {
    for (const child of managedChildren) {
      await stopProcess(child);
      managedChildren.delete(child);
    }
  });

  test("setup writes artifacts and run self-heals + serves HTTP", async () => {
    if (!existsSync(cliEntryPath)) {
      throw new Error(
        `Built CLI not found at ${cliEntryPath}. Run "npm run build" before test:e2e:smoke.`,
      );
    }

    const workspacePath = await mkdtemp(join(tmpdir(), "telegram-mcp-e2e-"));
    const runPort = await findFreePort();
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TELEGRAM_MCP_DATABASE_URL: databaseUrl,
    };
    delete env.TELEGRAM_MCP_MASTER_KEY;
    delete env.TELEGRAM_MCP_PREVIOUS_MASTER_KEY;
    delete env.TELEGRAM_MCP_CONFIG;
    delete env.TELEGRAM_MCP_TRANSPORT;
    delete env.TELEGRAM_MCP_PORT;

    const setupResult = await runCli(
      [
        "setup",
        "--profile",
        "external",
        "--non-interactive",
        "--yes",
        "--force",
      ],
      workspacePath,
      env,
    );
    expect(setupResult.code).toBe(0);
    if (setupResult.code !== 0) {
      throw new Error(`setup failed:\nstdout:\n${setupResult.stdout}\nstderr:\n${setupResult.stderr}`);
    }
    expect(existsSync(resolve(workspacePath, ".telegram-mcp", "config.json"))).toBe(true);
    expect(existsSync(resolve(workspacePath, ".telegram-mcp", ".env"))).toBe(true);

    await rm(resolve(workspacePath, ".telegram-mcp"), { recursive: true, force: true });

    const runProcess = spawn(
      process.execPath,
      [
        cliEntryPath,
        "run",
        "--profile",
        "external",
        "--transport",
        "http",
        "--host",
        "127.0.0.1",
        "--port",
        String(runPort),
        "--non-interactive",
        "--yes",
      ],
      {
        cwd: workspacePath,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    managedChildren.add(runProcess);

    const processOutput: string[] = [];
    runProcess.stdout.on("data", (chunk) => {
      processOutput.push(chunk.toString());
    });
    runProcess.stderr.on("data", (chunk) => {
      processOutput.push(chunk.toString());
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < 45_000) {
      if (runProcess.exitCode !== null) {
        throw new Error(
          `run exited early with code ${runProcess.exitCode}\n${processOutput.join("")}`,
        );
      }
      try {
        const health = await fetch(`http://127.0.0.1:${runPort}/healthz`);
        if (health.ok) {
          break;
        }
      } catch {
        // keep polling
      }
      await delay(300);
    }
    await waitForHttpOk(`http://127.0.0.1:${runPort}/healthz`);
    await waitForHttpOk(`http://127.0.0.1:${runPort}/readyz`);

    expect(existsSync(resolve(workspacePath, ".telegram-mcp", "config.json"))).toBe(true);
    expect(existsSync(resolve(workspacePath, ".telegram-mcp", ".env"))).toBe(true);

    const envContents = await readFile(
      resolve(workspacePath, ".telegram-mcp", ".env"),
      "utf8",
    );
    expect(envContents).toContain("TELEGRAM_MCP_MASTER_KEY=");

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const marker = await client.query(
      "SELECT name FROM schema_migrations WHERE name = $1 LIMIT 1",
      ["0001_initial_schema"],
    );
    await client.end();
    expect(marker.rowCount).toBe(1);

    await stopProcess(runProcess);
    managedChildren.delete(runProcess);
    expect(processOutput.join("")).not.toContain("fatal error");

    await rm(workspacePath, { recursive: true, force: true });
  }, 180_000);
});
