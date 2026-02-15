import generatedMethods from "./generated/bot-api-methods.generated.json";
import type { RiskLevel } from "../../types/core.js";

export type BotToolFamily =
  | "messages"
  | "media"
  | "chats"
  | "members"
  | "inline"
  | "commands"
  | "webhooks"
  | "payments"
  | "business"
  | "passport"
  | "stickers"
  | "forum"
  | "raw";

export interface BotMethodSpec {
  method: string;
  family: Exclude<BotToolFamily, "raw">;
  riskLevel: RiskLevel;
}

type ManagedFamily = Exclude<BotToolFamily, "raw">;

const WEBHOOK_METHODS = new Set([
  "getUpdates",
  "setWebhook",
  "deleteWebhook",
  "getWebhookInfo",
]);

const INLINE_METHODS = new Set([
  "answerCallbackQuery",
  "answerInlineQuery",
  "answerWebAppQuery",
  "savePreparedInlineMessage",
]);

const COMMAND_METHODS = new Set([
  "getMe",
  "logOut",
  "close",
  "setMyCommands",
  "deleteMyCommands",
  "getMyCommands",
  "setMyName",
  "getMyName",
  "setMyDescription",
  "getMyDescription",
  "setMyShortDescription",
  "getMyShortDescription",
  "setChatMenuButton",
  "getChatMenuButton",
  "setMyDefaultAdministratorRights",
  "getMyDefaultAdministratorRights",
]);

const MEDIA_METHODS = new Set([
  "sendPhoto",
  "sendAudio",
  "sendDocument",
  "sendVideo",
  "sendAnimation",
  "sendVoice",
  "sendVideoNote",
  "sendMediaGroup",
  "sendLocation",
  "editMessageLiveLocation",
  "stopMessageLiveLocation",
  "sendVenue",
  "sendContact",
  "sendPoll",
  "sendDice",
  "sendChatAction",
  "sendStory",
  "editStory",
  "deleteStory",
  "sendPaidMedia",
]);

const CHAT_METHOD_PATTERNS: RegExp[] = [
  /^getChat/,
  /^setChat/,
  /^deleteChat/,
  /^pinChat/,
  /^unpin/,
  /^leaveChat$/,
];

const MEMBER_METHOD_PATTERNS: RegExp[] = [
  /^banChat/,
  /^unbanChat/,
  /^restrictChatMember$/,
  /^promoteChatMember$/,
  /^setChatAdministratorCustomTitle$/,
  /^setChatPermissions$/,
  /^createChatInviteLink$/,
  /^createChatSubscriptionInviteLink$/,
  /^editChatInviteLink$/,
  /^editChatSubscriptionInviteLink$/,
  /^revokeChatInviteLink$/,
  /^approveChatJoinRequest$/,
  /^declineChatJoinRequest$/,
  /^getUserChatBoosts$/,
];

const PAYMENT_METHOD_PATTERNS: RegExp[] = [
  /Invoice/,
  /Payment/,
  /Shipping/,
  /Checkout/,
  /^getStar/,
  /^getMyStar/,
  /StarBalance/,
  /StarSubscription/,
  /Gift/,
  /Gifts/,
];

const BUSINESS_METHOD_PATTERNS: RegExp[] = [
  /Business/,
  /^readBusinessMessage$/,
  /^deleteBusinessMessages$/,
  /^setBusinessAccount/,
  /^transferBusinessAccountStars$/,
];

const MESSAGE_METHOD_PATTERNS: RegExp[] = [
  /^sendMessage$/,
  /^sendMessageDraft$/,
  /^sendChecklist$/,
  /^forwardMessage/,
  /^copyMessage/,
  /^editMessage/,
  /^deleteMessage/,
  /^setMessageReaction$/,
  /^sendGame$/,
  /^setGameScore$/,
  /^getGameHighScores$/,
  /^stopPoll$/,
  /^approveSuggestedPost$/,
  /^declineSuggestedPost$/,
];

const HIGH_RISK_PATTERNS: RegExp[] = [
  /^banChat/,
  /^unbanChat/,
  /^restrictChatMember$/,
  /^promoteChatMember$/,
  /^setChatAdministratorCustomTitle$/,
  /^setChatPermissions$/,
  /^setWebhook$/,
  /^deleteWebhook$/,
  /^createChatInviteLink$/,
  /^createChatSubscriptionInviteLink$/,
  /^editChatInviteLink$/,
  /^editChatSubscriptionInviteLink$/,
  /^revokeChatInviteLink$/,
  /^approveChatJoinRequest$/,
  /^declineChatJoinRequest$/,
  /^sendInvoice$/,
  /^createInvoiceLink$/,
  /^answerShippingQuery$/,
  /^answerPreCheckoutQuery$/,
  /^refund/,
  /^verify/,
  /^remove.+Verification$/,
  /^setPassportDataErrors$/,
  /^replaceStickerInSet$/,
  /^createNewStickerSet$/,
  /^addStickerToSet$/,
  /^deleteStickerFromSet$/,
  /^deleteStickerSet$/,
  /^deleteForumTopic$/,
  /^deleteBusinessMessages$/,
  /^transferBusinessAccountStars$/,
];

const MEDIUM_RISK_PATTERNS: RegExp[] = [
  /^set/,
  /^edit/,
  /^pin/,
  /^unpin/,
  /^create/,
  /^upload/,
  /^copy/,
  /^forward/,
  /^sendPaid/,
  /^leaveChat$/,
  /^close$/,
  /^logOut$/,
  /^deleteMessage/,
  /^deleteStory$/,
  /^sendGift$/,
  /^convertGiftToStars$/,
  /^editUserStarSubscription$/,
];

function matchesAny(method: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(method));
}

function inferFamily(method: string): ManagedFamily {
  if (WEBHOOK_METHODS.has(method)) {
    return "webhooks";
  }
  if (INLINE_METHODS.has(method)) {
    return "inline";
  }
  if (COMMAND_METHODS.has(method)) {
    return "commands";
  }
  if (/Passport/.test(method)) {
    return "passport";
  }
  if (/Sticker|CustomEmoji/.test(method)) {
    return "stickers";
  }
  if (/ForumTopic/.test(method)) {
    return "forum";
  }
  if (matchesAny(method, PAYMENT_METHOD_PATTERNS)) {
    return "payments";
  }
  if (matchesAny(method, BUSINESS_METHOD_PATTERNS)) {
    return "business";
  }
  if (matchesAny(method, MEMBER_METHOD_PATTERNS)) {
    return "members";
  }
  if (MEDIA_METHODS.has(method)) {
    return "media";
  }
  if (matchesAny(method, CHAT_METHOD_PATTERNS)) {
    return "chats";
  }
  if (matchesAny(method, MESSAGE_METHOD_PATTERNS)) {
    return "messages";
  }
  return "commands";
}

function inferRiskLevel(method: string): RiskLevel {
  if (matchesAny(method, HIGH_RISK_PATTERNS)) {
    return "high";
  }
  if (matchesAny(method, MEDIUM_RISK_PATTERNS)) {
    return "medium";
  }
  return "low";
}

const methodNames = generatedMethods.methods.slice().sort((left, right) =>
  left.localeCompare(right, "en"),
);

export const BOT_METHOD_MATRIX: BotMethodSpec[] = methodNames.map((method) => ({
  method,
  family: inferFamily(method),
  riskLevel: inferRiskLevel(method),
}));

export const BOT_METHODS_BY_NAME: Record<string, BotMethodSpec> =
  BOT_METHOD_MATRIX.reduce<Record<string, BotMethodSpec>>((acc, item) => {
    acc[item.method] = item;
    return acc;
  }, {});

export const BOT_METHODS_BY_FAMILY: Record<
  Exclude<BotToolFamily, "raw">,
  BotMethodSpec[]
> = BOT_METHOD_MATRIX.reduce(
  (acc, item) => {
    acc[item.family].push(item);
    return acc;
  },
  {
    messages: [],
    media: [],
    chats: [],
    members: [],
    inline: [],
    commands: [],
    webhooks: [],
    payments: [],
    business: [],
    passport: [],
    stickers: [],
    forum: [],
  } as Record<Exclude<BotToolFamily, "raw">, BotMethodSpec[]>,
);

export function isKnownBotMethod(method: string): boolean {
  return method in BOT_METHODS_BY_NAME;
}
