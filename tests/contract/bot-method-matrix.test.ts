import { describe, expect, test } from "vitest";
import {
  BOT_METHOD_MATRIX,
  BOT_METHODS_BY_FAMILY,
} from "../../src/telegram/bot/method-matrix.js";

describe("Bot method matrix contract", () => {
  test("has no duplicate methods", () => {
    const methods = BOT_METHOD_MATRIX.map((item) => item.method);
    const unique = new Set(methods);
    expect(unique.size).toBe(methods.length);
  });

  test("all domains include at least one method", () => {
    for (const [domain, methods] of Object.entries(BOT_METHODS_BY_FAMILY)) {
      expect(methods.length, `domain ${domain} should not be empty`).toBeGreaterThan(0);
    }
  });

  test("contains critical production methods", () => {
    const required = [
      "sendMessage",
      "setWebhook",
      "getWebhookInfo",
      "banChatMember",
      "answerInlineQuery",
      "sendInvoice",
      "setPassportDataErrors",
      "createForumTopic",
    ];
    const methods = new Set(BOT_METHOD_MATRIX.map((item) => item.method));
    for (const requiredMethod of required) {
      expect(methods.has(requiredMethod)).toBe(true);
    }
  });
});
