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

export const BOT_METHOD_MATRIX: BotMethodSpec[] = [
  { method: "getMe", family: "commands", riskLevel: "low" },
  { method: "logOut", family: "commands", riskLevel: "medium" },
  { method: "close", family: "commands", riskLevel: "medium" },
  { method: "setMyCommands", family: "commands", riskLevel: "medium" },
  { method: "deleteMyCommands", family: "commands", riskLevel: "medium" },
  { method: "getMyCommands", family: "commands", riskLevel: "low" },
  { method: "setMyName", family: "commands", riskLevel: "medium" },
  { method: "getMyName", family: "commands", riskLevel: "low" },
  { method: "setMyDescription", family: "commands", riskLevel: "medium" },
  { method: "getMyDescription", family: "commands", riskLevel: "low" },
  { method: "setMyShortDescription", family: "commands", riskLevel: "medium" },
  { method: "getMyShortDescription", family: "commands", riskLevel: "low" },
  { method: "setChatMenuButton", family: "commands", riskLevel: "medium" },
  { method: "getChatMenuButton", family: "commands", riskLevel: "low" },
  {
    method: "setMyDefaultAdministratorRights",
    family: "commands",
    riskLevel: "high",
  },
  {
    method: "getMyDefaultAdministratorRights",
    family: "commands",
    riskLevel: "low",
  },
  { method: "getUpdates", family: "webhooks", riskLevel: "low" },
  { method: "setWebhook", family: "webhooks", riskLevel: "high" },
  { method: "deleteWebhook", family: "webhooks", riskLevel: "high" },
  { method: "getWebhookInfo", family: "webhooks", riskLevel: "low" },
  { method: "sendMessage", family: "messages", riskLevel: "low" },
  { method: "forwardMessage", family: "messages", riskLevel: "low" },
  { method: "forwardMessages", family: "messages", riskLevel: "low" },
  { method: "copyMessage", family: "messages", riskLevel: "low" },
  { method: "copyMessages", family: "messages", riskLevel: "low" },
  { method: "sendPaidMedia", family: "media", riskLevel: "medium" },
  { method: "sendPhoto", family: "media", riskLevel: "low" },
  { method: "sendAudio", family: "media", riskLevel: "low" },
  { method: "sendDocument", family: "media", riskLevel: "low" },
  { method: "sendVideo", family: "media", riskLevel: "low" },
  { method: "sendAnimation", family: "media", riskLevel: "low" },
  { method: "sendVoice", family: "media", riskLevel: "low" },
  { method: "sendVideoNote", family: "media", riskLevel: "low" },
  { method: "sendMediaGroup", family: "media", riskLevel: "low" },
  { method: "sendLocation", family: "media", riskLevel: "low" },
  { method: "editMessageLiveLocation", family: "media", riskLevel: "low" },
  { method: "stopMessageLiveLocation", family: "media", riskLevel: "low" },
  { method: "sendVenue", family: "media", riskLevel: "low" },
  { method: "sendContact", family: "media", riskLevel: "low" },
  { method: "sendPoll", family: "media", riskLevel: "low" },
  { method: "sendDice", family: "media", riskLevel: "low" },
  { method: "sendChatAction", family: "media", riskLevel: "low" },
  { method: "setMessageReaction", family: "messages", riskLevel: "low" },
  { method: "getUserProfilePhotos", family: "chats", riskLevel: "low" },
  { method: "getFile", family: "chats", riskLevel: "low" },
  { method: "banChatMember", family: "members", riskLevel: "high" },
  { method: "unbanChatMember", family: "members", riskLevel: "high" },
  { method: "restrictChatMember", family: "members", riskLevel: "high" },
  { method: "promoteChatMember", family: "members", riskLevel: "high" },
  {
    method: "setChatAdministratorCustomTitle",
    family: "members",
    riskLevel: "high",
  },
  { method: "banChatSenderChat", family: "members", riskLevel: "high" },
  { method: "unbanChatSenderChat", family: "members", riskLevel: "high" },
  { method: "setChatPermissions", family: "members", riskLevel: "high" },
  { method: "exportChatInviteLink", family: "members", riskLevel: "high" },
  { method: "createChatInviteLink", family: "members", riskLevel: "high" },
  { method: "editChatInviteLink", family: "members", riskLevel: "high" },
  { method: "revokeChatInviteLink", family: "members", riskLevel: "high" },
  { method: "approveChatJoinRequest", family: "members", riskLevel: "high" },
  { method: "declineChatJoinRequest", family: "members", riskLevel: "high" },
  { method: "setChatPhoto", family: "chats", riskLevel: "high" },
  { method: "deleteChatPhoto", family: "chats", riskLevel: "high" },
  { method: "setChatTitle", family: "chats", riskLevel: "high" },
  { method: "setChatDescription", family: "chats", riskLevel: "high" },
  { method: "pinChatMessage", family: "chats", riskLevel: "medium" },
  { method: "unpinChatMessage", family: "chats", riskLevel: "medium" },
  { method: "unpinAllChatMessages", family: "chats", riskLevel: "medium" },
  { method: "leaveChat", family: "chats", riskLevel: "medium" },
  { method: "getChat", family: "chats", riskLevel: "low" },
  { method: "getChatAdministrators", family: "chats", riskLevel: "low" },
  { method: "getChatMemberCount", family: "chats", riskLevel: "low" },
  { method: "getChatMember", family: "chats", riskLevel: "low" },
  { method: "setChatStickerSet", family: "chats", riskLevel: "medium" },
  { method: "deleteChatStickerSet", family: "chats", riskLevel: "medium" },
  { method: "answerCallbackQuery", family: "inline", riskLevel: "low" },
  { method: "getUserChatBoosts", family: "members", riskLevel: "low" },
  { method: "answerInlineQuery", family: "inline", riskLevel: "low" },
  { method: "answerWebAppQuery", family: "inline", riskLevel: "low" },
  { method: "sendInvoice", family: "payments", riskLevel: "high" },
  { method: "createInvoiceLink", family: "payments", riskLevel: "high" },
  { method: "answerShippingQuery", family: "payments", riskLevel: "high" },
  { method: "answerPreCheckoutQuery", family: "payments", riskLevel: "high" },
  { method: "getStarTransactions", family: "payments", riskLevel: "medium" },
  { method: "refundStarPayment", family: "payments", riskLevel: "high" },
  {
    method: "editUserStarSubscription",
    family: "payments",
    riskLevel: "high",
  },
  { method: "sendGift", family: "payments", riskLevel: "high" },
  { method: "verifyUser", family: "payments", riskLevel: "high" },
  { method: "verifyChat", family: "payments", riskLevel: "high" },
  { method: "removeUserVerification", family: "payments", riskLevel: "high" },
  { method: "removeChatVerification", family: "payments", riskLevel: "high" },
  { method: "setPassportDataErrors", family: "passport", riskLevel: "high" },
  { method: "sendGame", family: "messages", riskLevel: "low" },
  { method: "setGameScore", family: "messages", riskLevel: "medium" },
  { method: "getGameHighScores", family: "messages", riskLevel: "low" },
  { method: "getBusinessConnection", family: "business", riskLevel: "low" },
  { method: "replaceStickerInSet", family: "stickers", riskLevel: "high" },
  { method: "sendSticker", family: "stickers", riskLevel: "low" },
  { method: "getStickerSet", family: "stickers", riskLevel: "low" },
  { method: "getCustomEmojiStickers", family: "stickers", riskLevel: "low" },
  { method: "uploadStickerFile", family: "stickers", riskLevel: "medium" },
  { method: "createNewStickerSet", family: "stickers", riskLevel: "high" },
  { method: "addStickerToSet", family: "stickers", riskLevel: "high" },
  {
    method: "setStickerPositionInSet",
    family: "stickers",
    riskLevel: "medium",
  },
  { method: "deleteStickerFromSet", family: "stickers", riskLevel: "high" },
  { method: "setStickerEmojiList", family: "stickers", riskLevel: "medium" },
  { method: "setStickerKeywords", family: "stickers", riskLevel: "medium" },
  { method: "setStickerMaskPosition", family: "stickers", riskLevel: "medium" },
  { method: "setStickerSetTitle", family: "stickers", riskLevel: "medium" },
  {
    method: "setStickerSetThumbnail",
    family: "stickers",
    riskLevel: "medium",
  },
  {
    method: "setCustomEmojiStickerSetThumbnail",
    family: "stickers",
    riskLevel: "medium",
  },
  { method: "deleteStickerSet", family: "stickers", riskLevel: "high" },
  { method: "getForumTopicIconStickers", family: "forum", riskLevel: "low" },
  { method: "createForumTopic", family: "forum", riskLevel: "medium" },
  { method: "editForumTopic", family: "forum", riskLevel: "medium" },
  { method: "closeForumTopic", family: "forum", riskLevel: "medium" },
  { method: "reopenForumTopic", family: "forum", riskLevel: "medium" },
  { method: "deleteForumTopic", family: "forum", riskLevel: "high" },
  {
    method: "unpinAllForumTopicMessages",
    family: "forum",
    riskLevel: "medium",
  },
  { method: "editGeneralForumTopic", family: "forum", riskLevel: "medium" },
  { method: "closeGeneralForumTopic", family: "forum", riskLevel: "medium" },
  { method: "reopenGeneralForumTopic", family: "forum", riskLevel: "medium" },
  { method: "hideGeneralForumTopic", family: "forum", riskLevel: "medium" },
  { method: "unhideGeneralForumTopic", family: "forum", riskLevel: "medium" },
  {
    method: "unpinAllGeneralForumTopicMessages",
    family: "forum",
    riskLevel: "medium",
  },
  { method: "editMessageText", family: "messages", riskLevel: "low" },
  { method: "editMessageCaption", family: "messages", riskLevel: "low" },
  { method: "editMessageMedia", family: "messages", riskLevel: "low" },
  { method: "editMessageReplyMarkup", family: "messages", riskLevel: "low" },
  { method: "stopPoll", family: "messages", riskLevel: "low" },
  { method: "deleteMessage", family: "messages", riskLevel: "medium" },
  { method: "deleteMessages", family: "messages", riskLevel: "medium" },
];

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
