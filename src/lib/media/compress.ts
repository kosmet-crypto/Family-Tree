// Client-side image compression before upload.
// Every photo is re-encoded: resized to maxDimension, EXIF orientation applied, and all
// metadata (including GPS location) dropped. WebP by default, JPEG where WebP is unsupported.

export interface CompressOptions {
  maxDimension?: number;   // longest side in px
  maxBytes?: number;       // target size; quality (then size) is reduced until it fits
  mimeType?: "image/webp" | "image/jpeg";
  quality?: number;        // starting quality 0..1
  minQuality?: number;
  thumbnailDimension?: number | null; // also produce a small thumbnail (null = no)
}

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  mimeType: string;
  originalBytes: number;
  thumbnail?: { blob: Blob; width: number; height: number };
}

export class ImageCompressionError extends Error {
  constructor(public readonly code: "unsupported_format" | "not_an_image" | "encode_failed", message?: string) {
    super(message ?? code);
    this.name = "ImageCompressionError";
  }
}

export const DEFAULT_COMPRESS: Required<Omit<CompressOptions, "thumbnailDimension">> & { thumbnailDimension: number | null } = {
  maxDimension: 1600,
  maxBytes: 500 * 1024,
  mimeType: "image/webp",
  quality: 0.82,
  minQuality: 0.5,
  thumbnailDimension: 320,
};

/** Scales (w, h) to fit inside maxDim x maxDim, never upscaling. */
export function fitWithin(width: number, height: number, maxDim: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxDim / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** File extension for a mime type (used in storage paths). */
export function extensionFor(mime: string): string {
  return ({ "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" } as Record<string, string>)[mime] ?? "bin";
}

export async function compressImage(file: Blob, options: CompressOptions = {}): Promise<CompressedImage> {
  const opts = { ...DEFAULT_COMPRESS, ...options };
  if (file.type && !file.type.startsWith("image/")) throw new ImageCompressionError("not_an_image");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // e.g. HEIC in Chrome/Android: the browser cannot decode it
    throw new ImageCompressionError("unsupported_format", `Cannot decode ${file.type || "image"}`);
  }

  try {
    let mime: string = opts.mimeType;
    let { width, height } = fitWithin(bitmap.width, bitmap.height, opts.maxDimension);
    let blob: Blob | null = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      for (let q = opts.quality; ; q = Math.round((q - 0.08) * 100) / 100) {
        blob = await encode(bitmap, width, height, mime, Math.max(q, opts.minQuality));
        if (blob.type !== mime) {
          // WebP not supported by this browser's encoder: switch to JPEG once.
          mime = "image/jpeg";
          blob = await encode(bitmap, width, height, mime, Math.max(q, opts.minQuality));
        }
        if (blob.size <= opts.maxBytes || q <= opts.minQuality) break;
      }
      if (blob.size <= opts.maxBytes) break;
      ({ width, height } = fitWithin(width, height, Math.round(Math.max(width, height) * 0.8)));
    }

    const out: CompressedImage = { blob: blob!, width, height, mimeType: mime, originalBytes: file.size };
    if (opts.thumbnailDimension) {
      const t = fitWithin(bitmap.width, bitmap.height, opts.thumbnailDimension);
      out.thumbnail = { blob: await encode(bitmap, t.width, t.height, mime, 0.7), ...t };
    }
    return out;
  } finally {
    bitmap.close();
  }
}

async function encode(source: ImageBitmap, width: number, height: number, mime: string, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageCompressionError("encode_failed");
    draw(ctx, source, width, height, mime);
    return canvas.convertToBlob({ type: mime, quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageCompressionError("encode_failed");
  draw(ctx, source, width, height, mime);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageCompressionError("encode_failed"))), mime, quality),
  );
}

function draw(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  source: ImageBitmap,
  width: number,
  height: number,
  mime: string,
): void {
  if (mime === "image/jpeg") {
    // JPEG has no transparency: paint white instead of black behind transparent PNGs.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
}
