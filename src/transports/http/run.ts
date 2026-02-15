import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Request, Response } from "express";
import type { AppContainer } from "../../app/container.js";
import { buildMcpServer } from "../../mcp/server.js";

interface RequestWithAuth extends Request {
  auth?: AuthInfo;
}

function jsonRpcError(res: Response, message: string, code = -32000): void {
  res.status(401).json({
    jsonrpc: "2.0",
    error: {
      code,
      message,
    },
    id: null,
  });
}

async function attachAuth(req: RequestWithAuth, container: AppContainer): Promise<void> {
  const result = await container.oidcAuthService.authenticateHttpRequest(req);
  req.auth = {
    token: result.token,
    clientId: result.principal.subject,
    scopes: result.principal.roles,
    extra: {
      subject: result.principal.subject,
      roles: result.principal.roles,
      tenantId: result.principal.tenantId,
    },
  };
}

export async function runHttpTransport(container: AppContainer): Promise<void> {
  const app = createMcpExpressApp({
    host: container.config.server.host,
  });

  app.use((req, _res, next) => {
    container.logger.info(
      {
        method: req.method,
        path: req.path,
        correlationId: req.headers["x-correlation-id"],
      },
      "http request",
    );
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true, service: "telegram-mcp" });
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await container.db.query("SELECT 1");
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(503).json({ ok: false, error: String(error) });
    }
  });

  app.get("/metrics", async (_req, res) => {
    if (!container.metrics) {
      res.status(404).json({ error: "metrics disabled" });
      return;
    }
    res.setHeader("content-type", container.metrics.registry.contentType);
    res.status(200).send(await container.metrics.registry.metrics());
  });

  app.all("/mcp", async (req: RequestWithAuth, res: Response) => {
    if (container.config.auth.required) {
      try {
        await attachAuth(req, container);
      } catch (error) {
        container.logger.warn({ err: error }, "request denied: auth failed");
        jsonRpcError(res, "Unauthorized", -32001);
        return;
      }
    }

    const server = buildMcpServer(container);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      container.logger.error({ err: error }, "failed to handle mcp request");
      if (!res.headersSent) {
        jsonRpcError(res, "Internal server error", -32603);
      }
    } finally {
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    const listener = app.listen(
      container.config.server.port,
      container.config.server.host,
      () => {
        container.logger.info(
          {
            host: container.config.server.host,
            port: container.config.server.port,
          },
          "telegram-mcp http transport started",
        );
        resolve();
      },
    );
    listener.on("error", reject);
  });
}
