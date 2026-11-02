import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import type { Config } from "./config.js";
import { hash, EngineError } from "./contracts.js";
export class Objects {
  storageId() { return hash([this.config.S3_ENDPOINT.replace(/\/$/, ''), this.config.S3_BUCKET, this.config.S3_PREFIX]); }
  readonly client: S3Client;
  constructor(private config: Config) {
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
    });
  }
  async initialize() {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }),
      );
    } catch (e) {
      if (
        (e as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw e;
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.config.S3_BUCKET }));
      } catch (createdConcurrently) {
        if ((createdConcurrently as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 409) throw createdConcurrently;
        await this.client.send(new HeadBucketCommand({ Bucket: this.config.S3_BUCKET }));
      }
    }
  }
  key(tenantId: string, ownerId: string, digest: string) {
    return `${this.scope(tenantId, ownerId)}${digest}`;
  }
  private scope(tenantId: string, ownerId: string) {
    const prefix = this.config.S3_PREFIX ? `${this.config.S3_PREFIX}/` : "";
    return `${prefix}${hash([tenantId, ownerId])}/sha256/`;
  }
  async put(
    tenantId: string,
    ownerId: string,
    data: Buffer,
    mediaType = "application/octet-stream",
  ) {
    const sha256 = hash(data),
      objectKey = this.key(tenantId, ownerId, sha256);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: objectKey,
        Body: data,
        ContentType: mediaType,
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      }),
    );
    return { sha256, objectKey, size: data.length, mediaType };
  }
  async get(objectKey: string, range?: string) {
    return this.client.send(
      new GetObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: objectKey,
        Range: range,
      }),
    );
  }
  async bytes(objectKey: string, expectedHash?: string) {
    const response = await this.get(objectKey);
    const data = Buffer.from(await response.Body!.transformToByteArray());
    if (expectedHash && hash(data) !== expectedHash)
      throw new EngineError(502, "object_corrupt", "文件内容校验失败");
    return data;
  }
  authorize(tenantId: string, ownerId: string, objectKey: string) {
    if (!objectKey.startsWith(this.scope(tenantId, ownerId)))
      throw new EngineError(403, "object_scope", "资源不属于当前账号");
  }
}
