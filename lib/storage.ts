import "server-only";
import { randomBytes } from "node:crypto";

// Durable upload storage. Uses Vercel Blob when BLOB_READ_WRITE_TOKEN is set
// (production), and falls back to the local public/uploads folder for local
// dev. Returns the public URL to store on the record, or null if the write
// failed (callers keep working without an attachment).
//
// NOTE: stored URLs are public-but-unguessable, matching the previous
// behavior. For sensitive HR / insurance documents, consider gating downloads
// behind an authenticated proxy route (see DEPLOY.md).

function useBlob() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

function keyFor(originalName: string, prefix: string) {
  const safe = (originalName || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60);
  return `${prefix}/${Date.now()}-${randomBytes(6).toString("hex")}-${safe}`;
}

/** Persist an uploaded file. Returns a URL to store, or null on failure. */
export async function saveUpload(bytes: Buffer, originalName: string, contentType: string, prefix = "uploads"): Promise<string | null> {
  const key = keyFor(originalName, prefix);

  if (useBlob()) {
    try {
      const { put } = await import("@vercel/blob");
      const res = await put(key, bytes, {
        access: "public",
        contentType: contentType || "application/octet-stream",
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: false,
      });
      return res.url;
    } catch (e) {
      console.error("saveUpload(blob) failed:", (e as Error).message);
      return null;
    }
  }

  // Local dev fallback. Flatten the prefix into the filename so we only need
  // the single uploads dir (no nested folders to create).
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const stored = key.replace(/\//g, "__");
    await writeFile(join(dir, stored), bytes);
    return `/uploads/${stored}`;
  } catch {
    return null; // read-only FS — proceed without storing
  }
}

/** Delete a previously stored file (best-effort). Accepts a Blob URL or a
 *  local /uploads/... path. */
export async function deleteUpload(urlOrPath: string | null | undefined): Promise<void> {
  if (!urlOrPath) return;
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
