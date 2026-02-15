import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { EncryptedValue } from "../types/core.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function parseBase64Key(keyBase64: string, keyName: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.byteLength !== 32) {
    throw new Error(
      `${keyName} must decode to exactly 32 bytes (received ${key.byteLength})`,
    );
  }
  return key;
}

export class EncryptionService {
  private readonly currentKey: Buffer;
  private readonly previousKey: Buffer | null;

  constructor(masterKeyBase64: string, previousMasterKeyBase64?: string | null) {
    this.currentKey = parseBase64Key(masterKeyBase64, "master key");
    this.previousKey = previousMasterKeyBase64
      ? parseBase64Key(previousMasterKeyBase64, "previous master key")
      : null;
  }

  encrypt(plaintext: string | Buffer): EncryptedValue {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.currentKey, iv);
    const payload =
      typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
    const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      keyVersion: 2,
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  decrypt(payload: EncryptedValue): string {
    const tryKeys: Array<{ key: Buffer; version: number }> = [
      { key: this.currentKey, version: 2 },
    ];
    if (this.previousKey) {
      tryKeys.push({ key: this.previousKey, version: 1 });
    }

    const iv = Buffer.from(payload.iv, "base64");
    const ciphertext = Buffer.from(payload.ciphertext, "base64");
    const authTag = Buffer.from(payload.authTag, "base64");

    let lastError: unknown = null;
    for (const candidate of tryKeys) {
      try {
        if (payload.keyVersion > 0 && payload.keyVersion !== candidate.version) {
          continue;
        }
        const decipher = createDecipheriv(ALGORITHM, candidate.key, iv);
        decipher.setAuthTag(authTag);
        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        return plaintext.toString("utf8");
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `Unable to decrypt payload with available keys: ${String(lastError)}`,
    );
  }

  serialize(payload: EncryptedValue): string {
    return JSON.stringify(payload);
  }

  deserialize(payload: string): EncryptedValue {
    const parsed = JSON.parse(payload) as EncryptedValue;
    if (
      typeof parsed.iv !== "string" ||
      typeof parsed.ciphertext !== "string" ||
      typeof parsed.authTag !== "string"
    ) {
      throw new Error("Invalid encrypted payload");
    }
    return parsed;
  }
}
