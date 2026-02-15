import { describe, expect, test } from "vitest";
import { validateBotMethodInput } from "../../src/telegram/bot/method-schemas.js";

describe("Bot method schemas", () => {
  test("accepts valid payload for sendMessage", () => {
    expect(() =>
      validateBotMethodInput("sendMessage", {
        chat_id: 123456,
        text: "hello",
      }),
    ).not.toThrow();
  });

  test("rejects unknown fields for sendMessage", () => {
    expect(() =>
      validateBotMethodInput("sendMessage", {
        chat_id: 123456,
        text: "hello",
        not_a_real_param: true,
      }),
    ).toThrow(/Invalid payload/);
  });

  test("rejects missing required fields for sendMessage", () => {
    expect(() => validateBotMethodInput("sendMessage", {})).toThrow(/Invalid payload/);
  });
});
