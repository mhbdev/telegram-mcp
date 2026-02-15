import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type pino from "pino";
import type { AppConfig } from "../app/config.js";

function requireEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export class ObjectStoreService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly signedUrlTtlSeconds: number;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: pino.Logger,
  ) {
    const s3 = config.storage.s3;
    const accessKeyId = requireEnvVar(s3.accessKeyEnv);
    const secretAccessKey = requireEnvVar(s3.secretKeyEnv);
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
    this.bucket = s3.bucket;
    this.signedUrlTtlSeconds = s3.signedUrlTtlSeconds;
  }

  generateObjectKey(accountRef: string, fileName?: string): string {
    const safeAccount = accountRef.replace(/[^a-zA-Z0-9_-]/g, "_");
    const suffix = fileName ? extname(fileName).slice(0, 16) : "";
    return `${safeAccount}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${suffix}`;
  }

  async createPresignedPutUrl(input: {
    objectKey: string;
    mimeType: string;
    expiresInSeconds?: number;
  }): Promise<{ url: string; expiresAt: string }> {
    const expiresIn = input.expiresInSeconds ?? this.signedUrlTtlSeconds;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.mimeType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async createPresignedGetUrl(input: {
    objectKey: string;
    expiresInSeconds?: number;
  }): Promise<{ url: string; expiresAt: string }> {
    const expiresIn = input.expiresInSeconds ?? this.signedUrlTtlSeconds;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return {
      url,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async putObject(input: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
  }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        ContentType: input.mimeType,
        Body: input.body,
      }),
    );
  }

  async headObject(objectKey: string): Promise<{
    contentLength: number;
    contentType: string | null;
    eTag: string | null;
  }> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );
    return {
      contentLength: Number(result.ContentLength ?? 0),
      contentType: result.ContentType ?? null,
      eTag: result.ETag ?? null,
    };
  }

  getBucket(): string {
    return this.bucket;
  }

  logConfiguration(): void {
    this.logger.info(
      {
        bucket: this.bucket,
        region: this.config.storage.s3.region,
        endpoint: this.config.storage.s3.endpoint ?? "aws-default",
      },
      "object store configured",
    );
  }
}
