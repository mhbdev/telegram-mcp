import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AppContainer } from "../../app/container.js";
import { buildMcpServer } from "../../mcp/server.js";

export async function runStdioTransport(container: AppContainer): Promise<void> {
  const server = buildMcpServer(container);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  container.logger.info("telegram-mcp stdio transport started");
}
