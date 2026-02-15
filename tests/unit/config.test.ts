import { describe, expect, test } from "vitest";
import { loadConfig } from "../../src/app/config.js";

describe("config", () => {
  test("loads example config successfully", () => {
    const config = loadConfig("telegram-mcp.config.example.json");
    expect(config.server.name).toBe("telegram-mcp");
    expect(config.database.url).toContain("postgresql://");
    expect(config.auth.issuer).toContain("localhost");
  });
});
