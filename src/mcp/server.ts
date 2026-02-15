import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { AppContainer } from "../app/container.js";
import type { Principal, Role, TelegramToolRequest } from "../types/core.js";
import { registerV2Resources, registerV2Tools } from "./v2-tools.js";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const TOOL_FAMILIES = [
  "messages",
  "media",
  "chats",
  "members",
  "inline",
  "commands",
  "webhooks",
  "payments",
  "business",
  "passport",
  "stickers",
  "forum",
  "raw",
] as const;

const toolInputSchema = {
  accountRef: z.string().min(1),
  operation: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
  dryRun: z.boolean().optional(),
};

function parsePrincipal(extra: Extra): Principal {
  const auth = extra.authInfo;
  const fromExtra = auth?.extra;
  if (fromExtra && typeof fromExtra.subject === "string") {
    const rolesRaw = fromExtra.roles;
    const roles: Role[] = Array.isArray(rolesRaw)
      ? rolesRaw.filter((item): item is Role =>
          ["owner", "admin", "operator", "readonly"].includes(String(item)),
        )
      : ["readonly"];
    return {
      subject: fromExtra.subject,
      roles,
      tenantId:
        typeof fromExtra.tenantId === "string" ? fromExtra.tenantId : "default",
      authSource: "oidc",
    };
  }

  return {
    subject: "local-stdio",
    roles: ["owner"],
    tenantId: "default",
    authSource: "local",
  };
}

function toolResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent:
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : { value: payload },
  };
}

function requestFromToolInput(
  args: typeof toolInputSchema extends Record<string, never> ? never : any,
): TelegramToolRequest<Record<string, unknown>> {
  return {
    accountRef: args.accountRef,
    operation: args.operation,
    input: args.input,
    idempotencyKey: args.idempotencyKey,
    dryRun: args.dryRun,
  };
}

export function buildMcpServer(container: AppContainer): McpServer {
  const server = new McpServer(
    {
      name: container.config.server.name,
      version: container.config.server.version,
    },
    { capabilities: { logging: {}, tools: {}, resources: {} } },
  );

  for (const family of TOOL_FAMILIES) {
    const name = `telegram.bot.${family}`;
    server.registerTool(
      name,
      {
        description:
          family === "raw"
            ? "Telegram Bot API raw passthrough tool (restricted by policy)"
            : `Telegram Bot API ${family} domain operations`,
        inputSchema: toolInputSchema,
      },
      async (args, extra) => {
        const principal = parsePrincipal(extra);
        const result = await container.botService.executeDomainTool(
          family,
          requestFromToolInput(args),
          principal,
        );
        return toolResult(result);
      },
    );
  }

  server.registerTool(
    "telegram.mtproto.sessions",
    {
      description:
        "Manage MTProto multi-account sessions: add, list, revoke, health",
      inputSchema: {
        operation: z.enum(["add", "list", "revoke", "health"]),
        accountRef: z.string().optional(),
        displayName: z.string().optional(),
        phoneNumber: z.string().optional(),
        code: z.string().optional(),
        password: z.string().optional(),
      },
    },
    async (args) => {
      if (args.operation === "list") {
        return toolResult({
          ok: true,
          sessions: await container.mtprotoSessionManager.listSessions(),
        });
      }
      if (!args.accountRef) {
        throw new Error("accountRef is required");
      }
      if (args.operation === "revoke") {
        const removed = await container.mtprotoSessionManager.revokeSession(
          args.accountRef,
        );
        return toolResult({ ok: removed });
      }
      if (args.operation === "health") {
        return toolResult(await container.mtprotoSessionManager.health(args.accountRef));
      }
      if (!args.displayName || !args.phoneNumber || !args.code) {
        throw new Error("displayName, phoneNumber, and code are required for add");
      }

      await container.mtprotoSessionManager.addSession({
        accountRef: args.accountRef,
        displayName: args.displayName,
        phoneNumber: args.phoneNumber,
        phoneCodeProvider: async () => args.code as string,
        passwordProvider: args.password ? async () => args.password as string : undefined,
      });

      return toolResult({ ok: true });
    },
  );

  server.registerTool(
    "telegram.mtproto.core",
    {
      description:
        "MTProto foundation operations: send_text, read_dialogs, diagnostics",
      inputSchema: {
        operation: z.enum(["send_text", "read_dialogs", "diagnostics"]),
        accountRef: z.string(),
        peer: z.string().optional(),
        message: z.string().optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async (args) => {
      if (args.operation === "diagnostics") {
        return toolResult(await container.mtprotoSessionManager.health(args.accountRef));
      }
      if (args.operation === "send_text") {
        if (!args.peer || !args.message) {
          throw new Error("peer and message are required");
        }
        return toolResult(
          await container.mtprotoSessionManager.sendText({
            accountRef: args.accountRef,
            peer: args.peer,
            message: args.message,
          }),
        );
      }
      return toolResult(
        await container.mtprotoSessionManager.readDialogs({
          accountRef: args.accountRef,
          limit: args.limit,
        }),
      );
    },
  );

  registerV2Tools(server, container, parsePrincipal, toolResult);

  server.registerResource(
    "telegram-bots",
    "telegram://bots",
    { mimeType: "application/json" },
    async () => {
      const accounts = await container.accountRepository.listBotAccounts();
      return {
        contents: [
          {
            uri: "telegram://bots",
            text: JSON.stringify(
              accounts.map((account) => ({
                accountRef: account.accountRef,
                displayName: account.displayName,
                metadata: account.metadata,
              })),
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "telegram-bot-profile",
    new ResourceTemplate("telegram://bot/{botId}/profile", {
      list: undefined,
    }),
    { mimeType: "application/json" },
    async (_uri, vars) => {
      const botId = vars.botId;
      if (typeof botId !== "string") {
        throw new Error("botId is required");
      }
      const botAccount = await container.accountRepository.findBotAccountByRef(botId);
      if (!botAccount) {
        return {
          contents: [
            {
              uri: `telegram://bot/${botId}/profile`,
              text: JSON.stringify({ found: false }),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: `telegram://bot/${botId}/profile`,
            text: JSON.stringify({
              found: true,
              accountRef: botAccount.accountRef,
              displayName: botAccount.displayName,
              metadata: botAccount.metadata,
            }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "telegram-policies",
    "telegram://policies",
    { mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "telegram://policies",
          text: JSON.stringify({
            defaultEffect: container.config.policy.defaultEffect,
            allowRawToolForRoles: container.config.policy.allowRawToolForRoles,
          }),
        },
      ],
    }),
  );

  server.registerResource(
    "telegram-audit-recent",
    "telegram://audit/recent",
    { mimeType: "application/json" },
    async () => {
      const events = await container.auditService.latest(50);
      return {
        contents: [
          {
            uri: "telegram://audit/recent",
            text: JSON.stringify(events),
          },
        ],
      };
    },
  );

  registerV2Resources(server, container);
  return server;
}
