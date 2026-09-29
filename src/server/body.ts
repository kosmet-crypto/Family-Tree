// Reads an uploaded backup: multipart (field "file"), JSON or raw bytes (ZIP).
import { env } from "./env";
import { ApiError } from "./http";

export async function readUpload(req: Request): Promise<Uint8Array> {
  const max = env.backupZipMaxBytes;
  if (Number(req.headers.get("content-length") ?? 0) > max) throw new ApiError(413, "backup_too_large");
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") throw new ApiError(400, "file_missing");
    if (file.size > max) throw new ApiError(413, "backup_too_large");
    return new Uint8Array(await file.arrayBuffer());
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) throw new ApiError(400, "empty_body");
  if (bytes.length > max) throw new ApiError(413, "backup_too_large");
  return bytes;
}
