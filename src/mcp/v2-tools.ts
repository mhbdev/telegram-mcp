import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { AppContainer } from "../app/container.js";
import { classifyRisk } from "../policy/risk-classifier.js";
import type { Principal, RiskLevel } from "../types/core.js";

type PrincipalParser = (extra: any) => Principal;
type ToolResultBuilder = (payload: unknown) => {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
};

type OperationMap = Record<
  string,
  {
    payloadSchema: z.ZodTypeAny;
    riskLevel?: RiskLevel;
    execute: (ctx: {
      accountRef: string;
      payload: Record<string, unknown>;
      principal: Principal;
    }) => Promise<unknown>;
  }
>;

const entityInputSchema = z.union([z.string().min(1), z.number().int()]);

const baseToolSchema = z
  .object({
    accountRef: z.string().min(1),
    operation: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).default({}),
    idempotencyKey: z.string().min(1).max(128).optional(),
    dryRun: z.boolean().optional(),
    approvalToken: z.string().min(16).optional(),
    clientContext: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const emptyPayloadSchema = z.object({}).strict();

function operationFromTool(tool: string): string {
  const idx = tool.lastIndexOf(".");
  return idx > 0 ? tool.slice(idx + 1) : tool;
}

function isPrivileged(principal: Principal): boolean {
  return principal.roles.includes("owner") || principal.roles.includes("admin");
}

async function executeSecured(
  container: AppContainer,
  input: {
    principal: Principal;
    tool: string;
    operation: string;
    accountRef: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
    dryRun?: boolean;
    approvalToken?: string;
    clientContext?: Record<string, unknown>;
    defaultRisk?: RiskLevel;
    approvalExempt?: boolean;
    execute: () => Promise<unknown>;
  },
): Promise<Record<string, unknown>> {
  const riskLevel = classifyRisk({
    tool: input.tool,
    operation: input.operation,
    defaultRisk: input.defaultRisk,
  });
  const decision = container.policyEngine.evaluate({
    principal: input.principal,
    tool: input.tool,
    operation: input.operation,
    riskLevel,
  });

  await container.auditService.log({
    principalSubject: input.principal.subject,
    action: "tool_authorize",
    tool: input.tool,
    operation: input.operation,
    allowed: decision.allow,
    reason: decision.reason,
    riskLevel,
    clientContext: input.clientContext,
    metadata: {
      accountRef: input.accountRef,
    },
  });

  if (!decision.allow) {
    throw new Error(`Policy denied operation: ${decision.reason}`);
  }

  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      tool: input.tool,
      operation: input.operation,
      riskLevel,
    };
  }

  if (input.idempotencyKey) {
    const cached = await container.idempotencyRepository.tryGet(input.idempotencyKey);
    if (cached) {
      return {
        ...cached,
        idempotent: true,
      };
    }
  }

  let approvalId: string | null = null;
  if (!input.approvalExempt && container.approvalService.isApprovalRequired(riskLevel)) {
    if (!input.approvalToken) {
      throw new Error(
        `Approval required for ${input.tool}.${input.operation}. Use telegram.v2.approval.request`,
      );
    }
    const verified = await container.approvalService.verifyAndConsume({
      approvalToken: input.approvalToken,
      principal: input.principal,
      tool: input.tool,
      operation: input.operation,
      riskLevel,
      payload: input.payload,
    });
    approvalId = verified.approvalId;
  }

  try {
    const result = await input.execute();
    const response: Record<string, unknown> = {
      ok: true,
      tool: input.tool,
      operation: input.operation,
      riskLevel,
      approvalId,
      result,
    };
    if (input.idempotencyKey) {
      await container.idempotencyRepository.save(
        input.idempotencyKey,
        `${input.tool}.${input.operation}`,
        response,
      );
    }
    await container.auditService.log({
      principalSubject: input.principal.subject,
      action: "tool_execute",
      tool: input.tool,
      operation: input.operation,
      allowed: true,
      reason: "execution succeeded",
      riskLevel,
      approvalId,
      clientContext: input.clientContext,
      metadata: {
        accountRef: input.accountRef,
      },
    });
    return response;
  } catch (error) {
    await container.auditService.log({
      principalSubject: input.principal.subject,
      action: "tool_execute",
      tool: input.tool,
      operation: input.operation,
      allowed: false,
      reason: "execution failed",
      riskLevel,
      approvalId,
      clientContext: input.clientContext,
      metadata: {
        accountRef: input.accountRef,
        error: String(error),
      },
    });
    throw error;
  }
}

function toolSchemaForOperations(operations: string[]): z.ZodTypeAny {
  if (operations.length === 0) {
    throw new Error("operation map cannot be empty");
  }
  return baseToolSchema.extend({
    operation: z.enum(operations as [string, ...string[]]),
  });
}

function buildChatsOperations(container: AppContainer): OperationMap {
  return {
    get_chats: {
      payloadSchema: z
        .object({
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(1).max(200).default(20),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.getChats({
          accountRef,
          page: Number(payload.page),
          pageSize: Number(payload.pageSize),
        }),
    },
    list_chats: {
      payloadSchema: z
        .object({
          chatType: z.enum(["all", "group", "channel", "private"]).optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.listChats({
          accountRef,
          chatType: payload.chatType as "all" | "group" | "channel" | "private" | undefined,
          limit: payload.limit as number | undefined,
        }),
    },
    get_chat: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.getChat({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    create_group: {
      payloadSchema: z
        .object({
          title: z.string().min(1).max(255),
          userIds: z.array(entityInputSchema).min(1).max(200),
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.createGroup({
          accountRef,
          title: String(payload.title),
          userIds: payload.userIds as Array<string | number>,
        }),
    },
    invite_to_group: {
      payloadSchema: z
        .object({
          groupId: entityInputSchema,
          userIds: z.array(entityInputSchema).min(1).max(200),
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.inviteToGroup({
          accountRef,
          groupId: payload.groupId as string | number,
          userIds: payload.userIds as Array<string | number>,
        }),
    },
    create_channel: {
      payloadSchema: z
        .object({
          title: z.string().min(1).max(255),
          about: z.string().max(1024).optional(),
          megagroup: z.boolean().optional(),
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.createChannel({
          accountRef,
          title: String(payload.title),
          about: payload.about as string | undefined,
          megagroup: payload.megagroup as boolean | undefined,
        }),
    },
    edit_chat_title: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          title: z.string().min(1).max(255),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.editChatTitle({
          accountRef,
          chatId: payload.chatId as string | number,
          title: String(payload.title),
        }),
    },
    delete_chat_photo: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.deleteChatPhoto({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    leave_chat: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.leaveChat({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    get_participants: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.getParticipants({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
    get_admins: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.getAdmins({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
    get_banned_users: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.getBannedUsers({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
    promote_admin: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          userId: entityInputSchema,
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.promoteAdmin({
          accountRef,
          chatId: payload.chatId as string | number,
          userId: payload.userId as string | number,
        }),
    },
    demote_admin: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          userId: entityInputSchema,
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.demoteAdmin({
          accountRef,
          chatId: payload.chatId as string | number,
          userId: payload.userId as string | number,
        }),
    },
    ban_user: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          userId: entityInputSchema,
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.banUser({
          accountRef,
          chatId: payload.chatId as string | number,
          userId: payload.userId as string | number,
        }),
    },
    unban_user: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          userId: entityInputSchema,
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.unbanUser({
          accountRef,
          chatId: payload.chatId as string | number,
          userId: payload.userId as string | number,
        }),
    },
    get_invite_link: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.getInviteLink({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    export_chat_invite: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.exportChatInvite({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    import_chat_invite: {
      payloadSchema: z.object({ hash: z.string().min(1) }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.importChatInvite({
          accountRef,
          hash: String(payload.hash),
        }),
    },
    join_chat_by_link: {
      payloadSchema: z.object({ link: z.string().min(3) }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.joinChatByLink({
          accountRef,
          link: String(payload.link),
        }),
    },
    subscribe_public_channel: {
      payloadSchema: z.object({ channel: entityInputSchema }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.subscribePublicChannel({
          accountRef,
          channel: payload.channel as string | number,
        }),
    },
    get_recent_actions: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoChatsService.getRecentActions({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
  };
}

function buildMessagesOperations(container: AppContainer): OperationMap {
  return {
    get_messages: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.getMessages({
          accountRef,
          chatId: payload.chatId as string | number,
          page: payload.page as number | undefined,
          pageSize: payload.pageSize as number | undefined,
        }),
    },
    list_messages: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(500).optional(),
          searchQuery: z.string().optional(),
          fromDate: z.string().optional(),
          toDate: z.string().optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.listMessages({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
          searchQuery: payload.searchQuery as string | undefined,
          fromDate: payload.fromDate as string | undefined,
          toDate: payload.toDate as string | undefined,
        }),
    },
    list_topics: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(200).optional(),
          searchQuery: z.string().optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.listTopics({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
          searchQuery: payload.searchQuery as string | undefined,
        }),
    },
    send_message: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          message: z.string().min(1),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.sendMessage({
          accountRef,
          chatId: payload.chatId as string | number,
          message: String(payload.message),
        }),
    },
    reply_to_message: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
          text: z.string().min(1),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.replyToMessage({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
          text: String(payload.text),
        }),
    },
    edit_message: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
          newText: z.string().min(1),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.editMessage({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
          newText: String(payload.newText),
        }),
    },
    delete_message: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.deleteMessage({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
        }),
    },
    forward_message: {
      payloadSchema: z
        .object({
          fromChatId: entityInputSchema,
          toChatId: entityInputSchema,
          messageId: z.number().int().positive(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.forwardMessage({
          accountRef,
          fromChatId: payload.fromChatId as string | number,
          toChatId: payload.toChatId as string | number,
          messageId: Number(payload.messageId),
        }),
    },
    pin_message: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.pinMessage({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
        }),
    },
    unpin_message: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive().optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.unpinMessage({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: payload.messageId as number | undefined,
        }),
    },
    mark_as_read: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.markAsRead({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    get_message_context: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
          contextSize: z.number().int().min(1).max(50).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.getMessageContext({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
          contextSize: payload.contextSize as number | undefined,
        }),
    },
    get_history: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.getHistory({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
    get_pinned_messages: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.getPinnedMessages({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
    get_last_interaction: {
      payloadSchema: z.object({ contactId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.getLastInteraction({
          accountRef,
          contactId: payload.contactId as string | number,
        }),
    },
    create_poll: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          question: z.string().min(1).max(300),
          options: z.array(z.string().min(1).max(100)).min(2).max(10),
          multipleChoice: z.boolean().optional(),
          quizMode: z.boolean().optional(),
          publicVotes: z.boolean().optional(),
          closeDate: z.number().int().positive().optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.createPoll({
          accountRef,
          chatId: payload.chatId as string | number,
          question: String(payload.question),
          options: payload.options as string[],
          multipleChoice: payload.multipleChoice as boolean | undefined,
          quizMode: payload.quizMode as boolean | undefined,
          publicVotes: payload.publicVotes as boolean | undefined,
          closeDate: payload.closeDate as number | undefined,
        }),
    },
    send_reaction: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
          emoji: z.string().min(1).max(16),
          big: z.boolean().optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.sendReaction({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
          emoji: String(payload.emoji),
          big: payload.big as boolean | undefined,
        }),
    },
    remove_reaction: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.removeReaction({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
        }),
    },
    get_message_reactions: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.getMessageReactions({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
        }),
    },
  };
}

function buildContactsOperations(container: AppContainer): OperationMap {
  return {
    list_contacts: {
      payloadSchema: emptyPayloadSchema,
      execute: ({ accountRef }) => container.mtprotoContactsService.listContacts({ accountRef }),
    },
    search_contacts: {
      payloadSchema: z.object({ query: z.string().min(1) }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.searchContacts({
          accountRef,
          query: String(payload.query),
        }),
    },
    add_contact: {
      payloadSchema: z
        .object({
          phone: z.string().min(3),
          firstName: z.string().min(1),
          lastName: z.string().optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.addContact({
          accountRef,
          phone: String(payload.phone),
          firstName: String(payload.firstName),
          lastName: payload.lastName as string | undefined,
        }),
    },
    delete_contact: {
      payloadSchema: z.object({ userId: entityInputSchema }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.deleteContact({
          accountRef,
          userId: payload.userId as string | number,
        }),
    },
    block_user: {
      payloadSchema: z.object({ userId: entityInputSchema }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.blockUser({
          accountRef,
          userId: payload.userId as string | number,
        }),
    },
    unblock_user: {
      payloadSchema: z.object({ userId: entityInputSchema }).strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.unblockUser({
          accountRef,
          userId: payload.userId as string | number,
        }),
    },
    import_contacts: {
      payloadSchema: z
        .object({
          contacts: z
            .array(
              z
                .object({
                  phone: z.string().min(3),
                  firstName: z.string().min(1),
                  lastName: z.string().optional(),
                })
                .strict(),
            )
            .min(1)
            .max(200),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.importContacts({
          accountRef,
          contacts: payload.contacts as Array<{
            phone: string;
            firstName: string;
            lastName?: string;
          }>,
        }),
    },
    export_contacts: {
      payloadSchema: emptyPayloadSchema,
      execute: ({ accountRef }) => container.mtprotoContactsService.exportContacts({ accountRef }),
    },
    get_blocked_users: {
      payloadSchema: z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.getBlockedUsers({
          accountRef,
          limit: payload.limit as number | undefined,
        }),
    },
    get_contact_ids: {
      payloadSchema: emptyPayloadSchema,
      execute: ({ accountRef }) => container.mtprotoContactsService.getContactIds({ accountRef }),
    },
    get_direct_chat_by_contact: {
      payloadSchema: z.object({ contactQuery: z.string().min(1) }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.getDirectChatByContact({
          accountRef,
          contactQuery: String(payload.contactQuery),
        }),
    },
    get_contact_chats: {
      payloadSchema: z.object({ contactId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoContactsService.getContactChats({
          accountRef,
          contactId: payload.contactId as string | number,
        }),
    },
  };
}

function buildProfileOperations(container: AppContainer): OperationMap {
  return {
    get_me: {
      payloadSchema: emptyPayloadSchema,
      execute: ({ accountRef }) => container.mtprotoProfileService.getMe({ accountRef }),
    },
    update_profile: {
      payloadSchema: z
        .object({
          firstName: z.string().min(1).optional(),
          lastName: z.string().min(1).optional(),
          about: z.string().max(300).optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoProfileService.updateProfile({
          accountRef,
          firstName: payload.firstName as string | undefined,
          lastName: payload.lastName as string | undefined,
          about: payload.about as string | undefined,
        }),
    },
    delete_profile_photo: {
      payloadSchema: emptyPayloadSchema,
      riskLevel: "medium",
      execute: ({ accountRef }) =>
        container.mtprotoProfileService.deleteProfilePhoto({ accountRef }),
    },
    get_user_photos: {
      payloadSchema: z
        .object({
          userId: entityInputSchema,
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoProfileService.getUserPhotos({
          accountRef,
          userId: payload.userId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
    get_user_status: {
      payloadSchema: z.object({ userId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoProfileService.getUserStatus({
          accountRef,
          userId: payload.userId as string | number,
        }),
    },
  };
}

function buildSearchOperations(container: AppContainer): OperationMap {
  return {
    search_public_chats: {
      payloadSchema: z
        .object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoSearchService.searchPublicChats({
          accountRef,
          query: String(payload.query),
          limit: payload.limit as number | undefined,
        }),
    },
    search_messages: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          query: z.string().min(1),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoSearchService.searchMessages({
          accountRef,
          chatId: payload.chatId as string | number,
          query: String(payload.query),
          limit: payload.limit as number | undefined,
        }),
    },
    resolve_username: {
      payloadSchema: z.object({ username: z.string().min(1) }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoSearchService.resolveUsername({
          accountRef,
          username: String(payload.username),
        }),
    },
  };
}

function buildPrivacyOperations(container: AppContainer): OperationMap {
  const keySchema = z.enum([
    "status_timestamp",
    "chat_invite",
    "phone_call",
    "phone_p2p",
    "forwards",
    "profile_photo",
    "phone_number",
    "added_by_phone",
    "voice_messages",
    "about",
  ]);

  return {
    get_privacy_settings: {
      payloadSchema: z.object({ key: keySchema.optional() }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoPrivacyService.getPrivacySettings({
          accountRef,
          key: payload.key as
            | "status_timestamp"
            | "chat_invite"
            | "phone_call"
            | "phone_p2p"
            | "forwards"
            | "profile_photo"
            | "phone_number"
            | "added_by_phone"
            | "voice_messages"
            | "about"
            | undefined,
        }),
    },
    set_privacy_settings: {
      payloadSchema: z
        .object({
          key: keySchema,
          allowUsers: z.array(entityInputSchema).optional(),
          disallowUsers: z.array(entityInputSchema).optional(),
          allowContacts: z.boolean().optional(),
          allowAll: z.boolean().optional(),
          disallowAll: z.boolean().optional(),
        })
        .strict(),
      riskLevel: "high",
      execute: ({ accountRef, payload }) =>
        container.mtprotoPrivacyService.setPrivacySettings({
          accountRef,
          key: payload.key as
            | "status_timestamp"
            | "chat_invite"
            | "phone_call"
            | "phone_p2p"
            | "forwards"
            | "profile_photo"
            | "phone_number"
            | "added_by_phone"
            | "voice_messages"
            | "about",
          allowUsers: payload.allowUsers as Array<string | number> | undefined,
          disallowUsers: payload.disallowUsers as Array<string | number> | undefined,
          allowContacts: payload.allowContacts as boolean | undefined,
          allowAll: payload.allowAll as boolean | undefined,
          disallowAll: payload.disallowAll as boolean | undefined,
        }),
    },
    mute_chat: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoPrivacyService.muteChat({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    unmute_chat: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoPrivacyService.unmuteChat({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    archive_chat: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoPrivacyService.archiveChat({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    unarchive_chat: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoPrivacyService.unarchiveChat({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
    get_recent_actions: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoPrivacyService.getRecentActions({
          accountRef,
          chatId: payload.chatId as string | number,
          limit: payload.limit as number | undefined,
        }),
    },
  };
}

function buildDraftsOperations(container: AppContainer): OperationMap {
  return {
    save_draft: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          message: z.string(),
          replyToMsgId: z.number().int().positive().optional(),
          noWebpage: z.boolean().optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoDraftsService.saveDraft({
          accountRef,
          chatId: payload.chatId as string | number,
          message: String(payload.message),
          replyToMsgId: payload.replyToMsgId as number | undefined,
          noWebpage: payload.noWebpage as boolean | undefined,
        }),
    },
    get_drafts: {
      payloadSchema: emptyPayloadSchema,
      execute: ({ accountRef }) => container.mtprotoDraftsService.getDrafts({ accountRef }),
    },
    clear_draft: {
      payloadSchema: z.object({ chatId: entityInputSchema }).strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoDraftsService.clearDraft({
          accountRef,
          chatId: payload.chatId as string | number,
        }),
    },
  };
}

function buildInlineOperations(container: AppContainer): OperationMap {
  return {
    list_buttons: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.listInlineButtons({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: payload.messageId as number | undefined,
          limit: payload.limit as number | undefined,
        }),
    },
    press_button: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive().optional(),
          buttonText: z.string().optional(),
          buttonIndex: z.number().int().min(0).optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        container.mtprotoMessagesService.pressInlineButton({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: payload.messageId as number | undefined,
          buttonText: payload.buttonText as string | undefined,
          buttonIndex: payload.buttonIndex as number | undefined,
        }),
    },
  };
}

function buildMediaOperations(container: AppContainer): OperationMap {
  const media = container.mtprotoMediaService;
  const requireMedia = () => {
    if (!media) {
      throw new Error(
        "Media bridge disabled. Configure storage.s3 and S3 credentials env vars.",
      );
    }
    return media;
  };

  return {
    get_media_info: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
        })
        .strict(),
      execute: ({ accountRef, payload }) =>
        requireMedia().getMediaInfo({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
        }),
    },
    upload_init: {
      payloadSchema: z
        .object({
          mimeType: z.string().min(3),
          sizeBytes: z.number().int().positive(),
          fileName: z.string().optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        requireMedia().uploadInit({
          accountRef,
          mimeType: String(payload.mimeType),
          sizeBytes: Number(payload.sizeBytes),
          fileName: payload.fileName as string | undefined,
        }),
    },
    upload_commit: {
      payloadSchema: z.object({ objectId: z.string().uuid() }).strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload }) =>
        requireMedia().uploadCommit({
          accountRef,
          objectId: String(payload.objectId),
        }),
    },
    download_url: {
      payloadSchema: z.object({ objectId: z.string().uuid() }).strict(),
      execute: ({ accountRef, payload, principal }) =>
        requireMedia().getDownloadUrl({
          accountRef,
          objectId: String(payload.objectId),
          principalSubject: principal.subject,
        }),
    },
    ingest_message_media: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          messageId: z.number().int().positive(),
          mimeType: z.string().optional(),
          fileName: z.string().optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload, principal }) =>
        requireMedia().ingestMessageMedia({
          accountRef,
          chatId: payload.chatId as string | number,
          messageId: Number(payload.messageId),
          mimeType: payload.mimeType as string | undefined,
          fileName: payload.fileName as string | undefined,
          principalSubject: principal.subject,
        }),
    },
    send_from_object: {
      payloadSchema: z
        .object({
          chatId: entityInputSchema,
          objectId: z.string().uuid(),
          caption: z.string().optional(),
        })
        .strict(),
      riskLevel: "medium",
      execute: ({ accountRef, payload, principal }) =>
        requireMedia().sendFromObject({
          accountRef,
          chatId: payload.chatId as string | number,
          objectId: String(payload.objectId),
          caption: payload.caption as string | undefined,
          principalSubject: principal.subject,
        }),
    },
    list_objects: {
      payloadSchema: z.object({ limit: z.number().int().min(1).max(200).optional() }).strict(),
      execute: ({ accountRef, payload }) =>
        requireMedia().listObjects({
          accountRef,
          limit: payload.limit as number | undefined,
        }),
    },
    get_object_metadata: {
      payloadSchema: z.object({ objectId: z.string().uuid() }).strict(),
      execute: ({ accountRef, payload }) =>
        requireMedia().getObjectMetadata({
          accountRef,
          objectId: String(payload.objectId),
        }),
    },
  };
}

function registerDomainTool(input: {
  server: McpServer;
  container: AppContainer;
  toolName: string;
  description: string;
  operations: OperationMap;
  parsePrincipal: PrincipalParser;
  toolResult: ToolResultBuilder;
  invokers: Map<
    string,
    (
      args: Record<string, unknown>,
      principal: Principal,
    ) => Promise<Record<string, unknown>>
  >;
}) {
  const operationNames = Object.keys(input.operations);
  const schema = toolSchemaForOperations(operationNames);
  const aliasSchemaBase = z
    .object({
      accountRef: z.string().min(1),
      idempotencyKey: z.string().min(1).max(128).optional(),
      dryRun: z.boolean().optional(),
      approvalToken: z.string().min(16).optional(),
      clientContext: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

  const invoke = async (
    rawArgs: Record<string, unknown>,
    principal: Principal,
  ): Promise<Record<string, unknown>> => {
    const parsed = schema.parse(rawArgs) as Record<string, unknown>;
    const operation = String(parsed.operation);
    const operationDef = input.operations[operation];
    if (!operationDef) {
      throw new Error(`Unsupported operation for ${input.toolName}: ${operation}`);
    }
    const payload = operationDef.payloadSchema.parse(
      parsed.payload ?? {},
    ) as Record<string, unknown>;

    return executeSecured(input.container, {
      principal,
      tool: input.toolName,
      operation,
      accountRef: String(parsed.accountRef),
      payload,
      idempotencyKey:
        typeof parsed.idempotencyKey === "string" ? parsed.idempotencyKey : undefined,
      dryRun: parsed.dryRun === true,
      approvalToken:
        typeof parsed.approvalToken === "string" ? parsed.approvalToken : undefined,
      clientContext:
        parsed.clientContext && typeof parsed.clientContext === "object"
          ? (parsed.clientContext as Record<string, unknown>)
          : undefined,
      defaultRisk: operationDef.riskLevel,
      execute: () =>
        operationDef.execute({
          accountRef: String(parsed.accountRef),
          payload,
          principal,
        }),
    });
  };

  input.invokers.set(input.toolName, invoke);

  input.server.registerTool(
    input.toolName,
    {
      description: input.description,
      inputSchema: schema,
    },
    async (args, extra) => {
      const principal = input.parsePrincipal(extra);
      return input.toolResult(await invoke(args as Record<string, unknown>, principal));
    },
  );

  for (const operationName of operationNames) {
    const operationDef = input.operations[operationName];
    if (!operationDef) {
      continue;
    }
    const aliasName = `${input.toolName}.${operationName}`;
    const aliasSchema = aliasSchemaBase.extend({
      payload: operationDef.payloadSchema,
    });
    input.server.registerTool(
      aliasName,
      {
        description: `${input.description} (${operationName})`,
        inputSchema: aliasSchema,
      },
      async (args, extra) => {
        const parsed = aliasSchema.parse(args) as Record<string, unknown>;
        const principal = input.parsePrincipal(extra);
        const result = await invoke(
          {
            accountRef: parsed.accountRef,
            operation: operationName,
            payload: parsed.payload,
            idempotencyKey: parsed.idempotencyKey,
            dryRun: parsed.dryRun,
            approvalToken: parsed.approvalToken,
            clientContext: parsed.clientContext,
          },
          principal,
        );
        return input.toolResult(result);
      },
    );
  }
}

export function registerV2Tools(
  server: McpServer,
  container: AppContainer,
  parsePrincipal: PrincipalParser,
  toolResult: ToolResultBuilder,
): void {
  const invokers = new Map<
    string,
    (
      args: Record<string, unknown>,
      principal: Principal,
    ) => Promise<Record<string, unknown>>
  >();

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.chats",
    description: "Chat and group management operations",
    operations: buildChatsOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.messages",
    description: "Messaging lifecycle, history, polls, reactions",
    operations: buildMessagesOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.contacts",
    description: "Contacts and direct-chat lookup operations",
    operations: buildContactsOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.profile",
    description: "Profile and user info operations",
    operations: buildProfileOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.search",
    description: "Public discovery and message search operations",
    operations: buildSearchOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.privacy",
    description: "Privacy and notification settings operations",
    operations: buildPrivacyOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.drafts",
    description: "Draft lifecycle operations",
    operations: buildDraftsOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.inline",
    description: "Inline keyboard inspection and callbacks",
    operations: buildInlineOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  registerDomainTool({
    server,
    container,
    toolName: "telegram.v2.media",
    description: "S3/MinIO media bridge operations",
    operations: buildMediaOperations(container),
    parsePrincipal,
    toolResult,
    invokers,
  });

  const approvalRequestSchema = z
    .object({
      accountRef: z.string().min(1),
      tool: z.string().min(1),
      operation: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).default({}),
      clientContext: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

  server.registerTool(
    "telegram.v2.approval.request",
    {
      description: "Request one-time JIT approval token for risky operation",
      inputSchema: approvalRequestSchema,
    },
    async (args, extra) => {
      const principal = parsePrincipal(extra);
      if (!isPrivileged(principal)) {
        throw new Error("approval.request requires admin or owner role");
      }
      const parsed = approvalRequestSchema.parse(args);
      const riskLevel = classifyRisk({
        tool: parsed.tool,
        operation: parsed.operation,
      });
      const issued = await container.approvalService.requestApproval({
        principal,
        tool: parsed.tool,
        operation: parsed.operation,
        riskLevel,
        payload: parsed.payload,
      });
      await container.auditService.log({
        principalSubject: principal.subject,
        action: "approval_request",
        tool: "telegram.v2.approval.request",
        operation: "request",
        allowed: true,
        reason: "approval token issued",
        riskLevel,
        approvalId: issued.approvalId,
        clientContext: parsed.clientContext,
        metadata: {
          accountRef: parsed.accountRef,
          targetTool: parsed.tool,
          targetOperation: parsed.operation,
          expiresAt: issued.expiresAt,
        },
      });
      return toolResult({
        ok: true,
        approvalId: issued.approvalId,
        approvalToken: issued.approvalToken,
        expiresAt: issued.expiresAt,
        riskLevel,
      });
    },
  );

  const approvalExecuteSchema = z
    .object({
      accountRef: z.string().min(1),
      tool: z.string().min(1),
      operation: z.string().min(1),
      payload: z.record(z.string(), z.unknown()).default({}),
      approvalToken: z.string().min(16),
      idempotencyKey: z.string().min(1).max(128).optional(),
      clientContext: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

  server.registerTool(
    "telegram.v2.approval.execute",
    {
      description: "Execute a v2 operation using an approval token",
      inputSchema: approvalExecuteSchema,
    },
    async (args, extra) => {
      const principal = parsePrincipal(extra);
      if (!isPrivileged(principal)) {
        throw new Error("approval.execute requires admin or owner role");
      }
      const parsed = approvalExecuteSchema.parse(args);
      const target = invokers.get(parsed.tool);
      if (!target) {
        throw new Error(`Unknown v2 tool: ${parsed.tool}`);
      }
      const result = await target(
        {
          accountRef: parsed.accountRef,
          operation: parsed.operation,
          payload: parsed.payload,
          approvalToken: parsed.approvalToken,
          idempotencyKey: parsed.idempotencyKey,
          clientContext: parsed.clientContext,
        },
        principal,
      );
      return toolResult({
        ok: true,
        executed: `${parsed.tool}.${parsed.operation}`,
        result,
      });
    },
  );

  const approvalStatusSchema = z.object({ approvalId: z.string().uuid() }).strict();
  server.registerTool(
    "telegram.v2.approval.status",
    {
      description: "Check approval request status",
      inputSchema: approvalStatusSchema,
    },
    async (args) => {
      const parsed = approvalStatusSchema.parse(args);
      return toolResult({
        ok: true,
        status: await container.approvalService.getApprovalStatus(parsed.approvalId),
      });
    },
  );
}

export function registerV2Resources(server: McpServer, container: AppContainer): void {
  server.registerResource(
    "telegram-v2-chats",
    "telegram://v2/chats",
    { mimeType: "application/json" },
    async () => {
      const sessions = await container.mtprotoSessionManager.listSessions();
      return {
        contents: [
          {
            uri: "telegram://v2/chats",
            text: JSON.stringify({
              sessions,
              hint: "Use telegram.v2.chats with accountRef + operation + payload",
            }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "telegram-v2-contacts",
    "telegram://v2/contacts",
    { mimeType: "application/json" },
    async () => {
      const sessions = await container.mtprotoSessionManager.listSessions();
      return {
        contents: [
          {
            uri: "telegram://v2/contacts",
            text: JSON.stringify({
              sessions,
              hint: "Use telegram.v2.contacts with accountRef + operation + payload",
            }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "telegram-v2-drafts",
    "telegram://v2/drafts",
    { mimeType: "application/json" },
    async () => {
      const sessions = await container.mtprotoSessionManager.listSessions();
      return {
        contents: [
          {
            uri: "telegram://v2/drafts",
            text: JSON.stringify({
              sessions,
              hint: "Use telegram.v2.drafts with accountRef + operation + payload",
            }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "telegram-v2-approvals-recent",
    "telegram://v2/approvals/recent",
    { mimeType: "application/json" },
    async () => {
      const approvals = await container.approvalService.listRecent(50);
      return {
        contents: [
          {
            uri: "telegram://v2/approvals/recent",
            text: JSON.stringify(approvals),
          },
        ],
      };
    },
  );

  server.registerResource(
    "telegram-v2-media",
    new ResourceTemplate("telegram://v2/media/{objectId}", { list: undefined }),
    { mimeType: "application/json" },
    async (_uri, vars) => {
      const objectId = vars.objectId;
      if (typeof objectId !== "string") {
        throw new Error("objectId is required");
      }
      const object = await container.mediaRepository.getObjectById(objectId);
      return {
        contents: [
          {
            uri: `telegram://v2/media/${objectId}`,
            text: JSON.stringify({
              found: Boolean(object),
              object,
            }),
          },
        ],
      };
    },
  );
}
