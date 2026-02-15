import { Pool, type QueryResult, type QueryResultRow } from "pg";
import type { AppConfig } from "../app/config.js";

export interface Database {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  close(): Promise<void>;
}

export function createDatabase(config: AppConfig): Database {
  const pool = new Pool({
    connectionString: config.database.url,
    max: config.database.maxConnections,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
  });

  return {
    query<T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: unknown[],
    ) {
      return pool.query<T>(sql, params);
    },
    async close() {
      await pool.end();
    },
  };
}
