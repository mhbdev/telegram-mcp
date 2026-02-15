export type TelegramEntityInput = string | number;

export function extractInviteHash(input: string): string | null {
  const trimmed = input.trim();
  const invitePrefixPatterns = [
    "https://t.me/+",
    "http://t.me/+",
    "t.me/+",
    "https://telegram.me/+",
    "telegram.me/+",
  ];
  for (const prefix of invitePrefixPatterns) {
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }
  if (trimmed.startsWith("+")) {
    return trimmed.slice(1).trim();
  }
  return null;
}

function normalizeEntityInput(input: TelegramEntityInput): number | string {
  if (typeof input === "number") {
    return input;
  }
  const trimmed = input.trim();
  if (/^-?\d+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  if (trimmed.startsWith("@")) {
    return trimmed;
  }
  return trimmed;
}

export class EntityResolver {
  async resolveEntity(
    client: import("telegram").TelegramClient,
    input: TelegramEntityInput,
  ) {
    return client.getEntity(normalizeEntityInput(input));
  }
}
