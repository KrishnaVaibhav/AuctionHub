import imageCompression from "browser-image-compression";
import { supabase } from "./supabase";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // before compression
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type Bucket = "lot-media" | "auction-branding" | "avatars";

export function publicUrl(bucket: Bucket, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Single entry point for uploads. Images are resized to WebP in the browser
 * (Supabase free tier has no image transforms). To move storage to R2 or
 * Cloudinary later, change only this file.
 */
export async function uploadMedia(
  bucket: Bucket,
  folder: string,
  file: File,
  opts: { maxSide?: number; maxMB?: number } = {},
): Promise<{ path: string; kind: "image" | "video"; url: string }> {
  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");
  if (!isImage && !isVideo) throw new Error("Only images and videos are allowed");
  if (isVideo && bucket !== "lot-media") throw new Error("Videos are only allowed on lots");
  if (isImage && file.size > MAX_IMAGE_BYTES) throw new Error("Image is too large (max 20 MB)");
  if (isVideo && file.size > MAX_VIDEO_BYTES) throw new Error("Video is too large (max 50 MB)");

  let body: Blob = file;
  let ext = file.name.split(".").pop()?.toLowerCase() || "bin";
  let contentType = file.type;

  if (isImage && file.type !== "image/gif" && file.type !== "image/svg+xml") {
    body = await imageCompression(file, {
      maxWidthOrHeight: opts.maxSide ?? 1600,
      maxSizeMB: opts.maxMB ?? 0.4,
      fileType: "image/webp",
      useWebWorker: true,
    });
    ext = "webp";
    contentType = "image/webp";
  }

  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return { path, kind: isVideo ? "video" : "image", url: publicUrl(bucket, path) };
}

export async function deleteMedia(bucket: Bucket, path: string): Promise<void> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}
