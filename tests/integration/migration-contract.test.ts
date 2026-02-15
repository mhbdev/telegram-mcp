import { describe, expect, test } from "vitest";
import { migrationSql } from "../../src/storage/migrations.js";

describe("migration contract", () => {
  test("creates required core tables", () => {
    const requiredTables = [
      "principals",
      "roles",
      "principal_roles",
      "tool_permissions",
      "policy_versions",
      "bot_accounts",
      "mtproto_accounts",
      "update_handlers",
      "idempotency_records",
      "audit_events",
      "job_runs",
      "schema_migrations",
    ];

    for (const table of requiredTables) {
      expect(migrationSql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)).toBe(true);
    }
  });
});
