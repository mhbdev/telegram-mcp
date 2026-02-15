import { describe, expect, test } from "vitest";
import { randomBytes } from "node:crypto";
import { EncryptionService } from "../../src/storage/encryption.js";

function randomKeyBase64(): string {
  return randomBytes(32).toString("base64");
}

describe("EncryptionService", () => {
  test("encrypts and decrypts plaintext", () => {
    const service = new EncryptionService(randomKeyBase64());
    const payload = service.encrypt("secret-value");
    const decrypted = service.decrypt(payload);
    expect(decrypted).toBe("secret-value");
  });

  test("fails to decrypt tampered ciphertext", () => {
    const service = new EncryptionService(randomKeyBase64());
    const payload = service.encrypt("secret-value");
    payload.ciphertext = Buffer.from("tampered").toString("base64");
    expect(() => service.decrypt(payload)).toThrow();
  });
});
