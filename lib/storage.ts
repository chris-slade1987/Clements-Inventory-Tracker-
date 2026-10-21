import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Durable upload storage with THREE tiers, in order of preference:
//   1. Vercel Blob    — when BLOB_READ_WRITE_TOKEN is set (returns a blob URL).
//   2. Database       — otherwise: the bytes are stored in the `stored_files`
//      table and served (auth-gated) by GET /api/file/[id]. This makes uploads
//      durable with NO external storage configured — the fix for "the file
//      could not be stored" / documents that upload but won't open.
//   3. Local /public  — last resort for a writable-FS dev box with no DB write.
// Returns the URL/path to store on the record, or null if every tier failed.
//
// `readUpload` resolves any of the three (blob URL, /api/file/<id>, /uploads/..)
// back to bytes; `deleteUpload` cleans up blob objects and stored_files rows.

function useBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function keyFor(originalName: string, prefix: string) {
  const safe = (originalName || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  return `${prefix}/${Date.now()}-${randomBytes(6).toString("hex")}-${safe}`;
}

const FILE_PREFIX = "/api/file/";

/** Persist an uploaded file. Returns a URL/path to store, or null on failure. */
export async function saveUpload(bytes: Buffer, originalName: string, contentType: string, prefix = "uploads"): Promise<string | null> {
  const ct = contentType || "application/octet-stream";

  // 1 — Vercel Blob (production, when configured).
  if (useBlob()) {
    try {
      const { put } = await import("@vercel/blob");
      const res = await put(keyFor(originalName, prefix), bytes, {
        access: "public",
        contentType: ct,
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
      });
      return res.url;
    } catch (e) {
      console.error("saveUpload(blob) failed, falling back to DB:", (e as Error).message);
      // fall through to the DB tier rather than losing the upload
    }
  }

  // 2 — Database (durable without any external store).
  try {
    const rec = await prisma.storedFile.create({
      data: { name: originalName || "file", contentType: ct, size: bytes.length, data: new Uint8Array(bytes), prefix },
      select: { id: true },
    });
    return `${FILE_PREFIX}${rec.id}`;
  } catch (e) {
    console.error("saveUpload(db) failed, falling back to local FS:", (e as Error).message);
  }

  // 3 — Local public/uploads (writable-FS dev only).
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const stored = keyFor(originalName, prefix).replace(/\//g, "__");
    await writeFile(join(dir, stored), bytes);
    return `/uploads/${stored}`;
  } catch {
    return null; // nothing worked — caller keeps working without an attachment
  }
}

/** The stored_files id for a `/api/file/<id>` path, or null. */
export function storedFileId(urlOrPath: string | null | undefined): string | null {
  if (!urlOrPath || !urlOrPath.startsWith(FILE_PREFIX)) return null;
  const id = urlOrPath.slice(FILE_PREFIX.length).split(/[/?#]/)[0];
  return id || null;
}

/** Read a previously stored file back into memory (best-effort). Accepts a Blob
 *  URL, an `/api/file/<id>` DB path, or a local `/uploads/...` path. Returns the
 *  bytes, or null when there is nothing to read / the read failed. */
export async function readUpload(urlOrPath: string | null | undefined): Promise<Buffer | null> {
  if (!urlOrPath) return null;
  try {
    const id = storedFileId(urlOrPath);
    if (id) {
      const rec = await prisma.storedFile.findUnique({ where: { id }, select: { data: true } });
      return rec ? Buffer.from(rec.data) : null;
    }
    if (/^https?:\/\//.test(urlOrPath)) {
      const res = await fetch(urlOrPath);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    return await readFile(join(process.cwd(), "public", urlOrPath.replace(/^\//, "")));
  } catch (e) {
    console.error("readUpload failed:", (e as Error).message);
    return null;
  }
}

/** Delete a previously stored file (best-effort). Accepts a Blob URL, an
 *  `/api/file/<id>` DB path, or a local `/uploads/...` path. */
export async function deleteUpload(urlOrPath: string | null | undefined): Promise<void> {
  if (!urlOrPath) return;
  const id = storedFileId(urlOrPath);
  if (id) {
    try {
      await prisma.storedFile.delete({ where: { id } });
    } catch {
      /* already gone — ignore */
    }
    return;
  }
  if (/^https?:\/\//.test(urlOrPath)) {
    try {
      const { del } = await import("@vercel/blob");
      await del(urlOrPath, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch (e) {
      console.error("deleteUpload(blob) failed:", (e as Error).message);
    }
    return;
  }
  try {
    const { unlink } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await unlink(join(process.cwd(), "public", urlOrPath.replace(/^\//, "")));
  } catch {
    /* already gone / read-only — ignore */
  }
}
