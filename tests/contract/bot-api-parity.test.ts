import { describe, expect, test } from "vitest";
import generatedMethods from "../../src/telegram/bot/generated/bot-api-methods.generated.json";
import generatedContract from "../../src/telegram/bot/generated/bot-api-contract.generated.json";
import { BOT_METHOD_MATRIX } from "../../src/telegram/bot/method-matrix.js";
import { getKnownBotSchemaMethods } from "../../src/telegram/bot/method-schemas.js";

describe("Bot API parity", () => {
  test("matrix matches generated method list exactly", () => {
    const generated = new Set(generatedMethods.methods);
    const matrix = new Set(BOT_METHOD_MATRIX.map((item) => item.method));
    expect(matrix).toEqual(generated);
  });

  test("generated contract has schema for every generated method", () => {
    const root = generatedContract.methodInputMapSchema as Record<string, unknown>;
    const properties = root.properties as Record<string, unknown>;
    expect(properties).toBeDefined();

    for (const method of generatedMethods.methods) {
      expect(properties[method], `Missing schema for ${method}`).toBeDefined();
    }
  });

  test("compiled runtime validators cover every generated method", () => {
    const generated = new Set(generatedMethods.methods);
    const validators = new Set(getKnownBotSchemaMethods());
    expect(validators).toEqual(generated);
  });
});
