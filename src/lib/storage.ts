import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * File storage behind one small interface. Local disk in development, any
 * S3-compatible bucket (Cloudflare R2, Supabase Storage, AWS S3) in production.
 * Files are served through /api/files/<key> so access stays behind auth;
 * keys under "public/" (e.g. the business logo) are readable without signing in.
 */
export interface StoredFile {
  key: string;
  url: string;
  size: number;
}

interface StorageAdapter {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

function localAdapter(): StorageAdapter {
  const root = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./uploads");
  const resolve = (key: string) => {
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage key");
    return full;
  };
  return {
    async put(key, body) {
      const full = resolve(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, body);
    },
    async get(key) {
      try {
        return await readFile(resolve(key));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await unlink(resolve(key)).catch(() => undefined);
    },
  };
}

function s3Adapter(): StorageAdapter {
  const bucket = process.env.STORAGE_S3_BUCKET;
  if (!bucket) throw new Error("STORAGE_S3_BUCKET is not set");
  const client = new S3Client({
    region: process.env.STORAGE_S3_REGION || "auto",
    endpoint: process.env.STORAGE_S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.STORAGE_S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY ?? "",
    },
  });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!res.Body) return null;
        return Buffer.from(await res.Body.transformToByteArray());
      } catch {
        return null;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}

let adapter: StorageAdapter | null = null;
function storage(): StorageAdapter {
  if (!adapter) adapter = process.env.STORAGE_DRIVER === "s3" ? s3Adapter() : localAdapter();
  return adapter;
}

export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/gif",
  "application/pdf",
] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function safeName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-80) || "file";
}

export function fileUrl(key: string) {
  return `/api/files/${key}`;
}

export async function saveFile(opts: {
  folder: string;
  fileName: string;
  contentType: string;
  body: Buffer;
  isPublic?: boolean;
}): Promise<StoredFile> {
  const key = `${opts.isPublic ? "public/" : ""}${opts.folder}/${randomUUID()}-${safeName(opts.fileName)}`;
  await storage().put(key, opts.body, opts.contentType);
  return { key, url: fileUrl(key), size: opts.body.length };
}

export async function readFileByKey(key: string) {
  return storage().get(key);
}

export async function deleteFile(key: string) {
  await storage().delete(key);
}

export function keyFromUrl(url: string): string | null {
  return url.startsWith("/api/files/") ? url.slice("/api/files/".length) : null;
}

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "pdf":
      return "application/pdf";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
