import { MediaRepository } from "../../../storage/repositories.js";
import { ObjectStoreService } from "../../../storage/object-store.js";
import type { TelegramEntityInput } from "./entity-resolver.js";
import { EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

function toBuffer(payload: unknown): Buffer {
  if (Buffer.isBuffer(payload)) {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload);
  }
  if (typeof payload === "string") {
    return Buffer.from(payload, "binary");
  }
  throw new Error("Unsupported media payload type");
}

export class MediaService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
    private readonly mediaRepository: MediaRepository,
    private readonly objectStore: ObjectStoreService,
  ) {}

  async uploadInit(input: {
    accountRef: string;
    mimeType: string;
    sizeBytes: number;
    fileName?: string;
  }) {
    const objectKey = this.objectStore.generateObjectKey(input.accountRef, input.fileName);
    const object = await this.mediaRepository.createObject({
      accountRef: input.accountRef,
      objectKey,
      bucket: this.objectStore.getBucket(),
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      status: "pending",
      metadata: {
        fileName: input.fileName ?? null,
      },
    });
    const signed = await this.objectStore.createPresignedPutUrl({
      objectKey,
      mimeType: input.mimeType,
    });
    return {
      ok: true,
      objectId: object.id,
      objectKey,
      bucket: object.bucket,
      uploadUrl: signed.url,
      expiresAt: signed.expiresAt,
    };
  }

  async uploadCommit(input: { accountRef: string; objectId: string }) {
    const object = await this.mediaRepository.getObjectById(input.objectId);
    if (!object) {
      throw new Error("Media object not found");
    }
    if (object.accountRef !== input.accountRef) {
      throw new Error("Media object does not belong to account");
    }
    const head = await this.objectStore.headObject(object.objectKey);
    await this.mediaRepository.updateObjectStatus(object.id, "ready");
    return {
      ok: true,
      objectId: object.id,
      objectKey: object.objectKey,
      status: "ready",
      contentLength: head.contentLength,
      contentType: head.contentType,
      eTag: head.eTag,
    };
  }

  async getDownloadUrl(input: {
    accountRef: string;
    objectId: string;
    principalSubject: string;
  }) {
    const object = await this.mediaRepository.getObjectById(input.objectId);
    if (!object) {
      throw new Error("Media object not found");
    }
    if (object.accountRef !== input.accountRef) {
      throw new Error("Media object does not belong to account");
    }
    if (object.status !== "ready") {
      throw new Error("Media object is not ready");
    }
    const signed = await this.objectStore.createPresignedGetUrl({
      objectKey: object.objectKey,
    });
    await this.mediaRepository.logAccess({
      mediaObjectId: object.id,
      principalSubject: input.principalSubject,
      action: "download_url",
    });
    return {
      ok: true,
      objectId: object.id,
      objectKey: object.objectKey,
      downloadUrl: signed.url,
      expiresAt: signed.expiresAt,
    };
  }

  async ingestMessageMedia(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
    mimeType?: string;
    fileName?: string;
    principalSubject: string;
  }) {
    return this.context.withClient(
      input.accountRef,
      "media",
      "ingest_message_media",
      async ({ client }) => {
        const peer = await this.resolver.resolveEntity(client, input.chatId);
        const fetched = await client.getMessages(peer, { ids: input.messageId });
        const message = fetched[0];
        if (!message) {
          throw new Error("Message not found");
        }
        if (!(message as any).media) {
          throw new Error("Message has no media");
        }

        const downloaded = await (client as any).downloadMedia(message, {});
        const body = toBuffer(downloaded);
        const mimeType = input.mimeType ?? "application/octet-stream";
        const objectKey = this.objectStore.generateObjectKey(
          input.accountRef,
          input.fileName ?? `message-${input.messageId}`,
        );
        await this.objectStore.putObject({
          objectKey,
          body,
          mimeType,
        });
        const object = await this.mediaRepository.createObject({
          accountRef: input.accountRef,
          objectKey,
          bucket: this.objectStore.getBucket(),
          mimeType,
          sizeBytes: body.length,
          status: "ready",
          metadata: {
            source: "telegram_message",
            chatId: input.chatId,
            messageId: input.messageId,
          },
        });
        await this.mediaRepository.logAccess({
          mediaObjectId: object.id,
          principalSubject: input.principalSubject,
          action: "ingest_message_media",
          metadata: {
            chatId: input.chatId,
            messageId: input.messageId,
          },
        });
        return {
          ok: true,
          objectId: object.id,
          objectKey: object.objectKey,
          sizeBytes: body.length,
          mimeType,
        };
      },
      { chatId: input.chatId, messageId: input.messageId },
    );
  }

  async sendFromObject(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    objectId: string;
    caption?: string;
    principalSubject: string;
  }) {
    const object = await this.mediaRepository.getObjectById(input.objectId);
    if (!object) {
      throw new Error("Media object not found");
    }
    if (object.accountRef !== input.accountRef) {
      throw new Error("Media object does not belong to account");
    }
    if (object.status !== "ready") {
      throw new Error("Media object is not ready");
    }

    const signed = await this.objectStore.createPresignedGetUrl({
      objectKey: object.objectKey,
    });
    return this.context.withClient(
      input.accountRef,
      "media",
      "send_from_object",
      async ({ client }) => {
        const peer = await this.resolver.resolveEntity(client, input.chatId);
        try {
          const result = await (client as any).sendFile(peer, {
            file: signed.url,
            caption: input.caption ?? "",
          });
          await this.mediaRepository.logAccess({
            mediaObjectId: object.id,
            principalSubject: input.principalSubject,
            action: "send_from_object",
            metadata: { mode: "file" },
          });
          return {
            ok: true,
            mode: "file",
            objectId: object.id,
            result,
          };
        } catch {
          const text = input.caption ? `${input.caption}\n${signed.url}` : signed.url;
          const sent = await client.sendMessage(peer, { message: text });
          await this.mediaRepository.logAccess({
            mediaObjectId: object.id,
            principalSubject: input.principalSubject,
            action: "send_from_object",
            metadata: { mode: "link" },
          });
          return {
            ok: true,
            mode: "link",
            objectId: object.id,
            messageId: sent.id,
          };
        }
      },
      { chatId: input.chatId, objectId: input.objectId },
    );
  }

  async getMediaInfo(input: {
    accountRef: string;
    chatId: TelegramEntityInput;
    messageId: number;
  }) {
    return this.context.withClient(input.accountRef, "media", "get_media_info", async ({ client }) => {
      const peer = await this.resolver.resolveEntity(client, input.chatId);
      const fetched = await client.getMessages(peer, { ids: input.messageId });
      const message = fetched[0];
      if (!message) {
        return { ok: false, error: "message not found" };
      }
      const media = (message as any).media;
      if (!media) {
        return { ok: false, error: "no media in message" };
      }
      return {
        ok: true,
        messageId: message.id,
        media: {
          className: media.className ?? null,
          document: media.document ?? null,
          photo: media.photo ?? null,
        },
      };
    });
  }

  async listObjects(input: { accountRef: string; limit?: number }) {
    const objects = await this.mediaRepository.listObjectsByAccount(
      input.accountRef,
      input.limit ?? 50,
    );
    return {
      ok: true,
      count: objects.length,
      objects,
    };
  }

  async getObjectMetadata(input: { accountRef: string; objectId: string }) {
    const object = await this.mediaRepository.getObjectById(input.objectId);
    if (!object) {
      return { ok: false, error: "media object not found" };
    }
    if (object.accountRef !== input.accountRef) {
      return { ok: false, error: "media object does not belong to account" };
    }
    return {
      ok: true,
      object,
    };
  }
}
