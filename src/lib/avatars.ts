import { getAdminClient } from "@/lib/supabase/admin";

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFor(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export async function uploadPersonAvatarDb(input: {
  tenantId: string;
  personId: string;
  bytes: ArrayBuffer;
  contentType: string;
}) {
  if (!ALLOWED.has(input.contentType)) {
    throw new Error("Только JPEG, PNG или WebP");
  }
  if (input.bytes.byteLength > MAX_BYTES) {
    throw new Error("Файл больше 2 МБ");
  }

  const db = getAdminClient();
  const path = `${input.tenantId}/${input.personId}.${extFor(input.contentType)}`;

  const { error: upErr } = await db.storage.from(BUCKET).upload(path, input.bytes, {
    contentType: input.contentType,
    upsert: true,
  });
  if (upErr) throw new Error(upErr.message);

  const { error } = await db
    .from("persons")
    .update({ avatar_path: path })
    .eq("id", input.personId);
  if (error) {
    if (/avatar_path|does not exist/i.test(error.message)) {
      throw new Error(
        "Нужна миграция 007_avatar_consents.sql в Supabase SQL Editor",
      );
    }
    throw new Error(error.message);
  }

  return { path, url: await signedAvatarUrl(path) };
}

export async function signedAvatarUrl(path?: string | null, expiresIn = 3600) {
  if (!path) return null;
  const db = getAdminClient();
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}

export async function getPersonAvatarUrl(personId: string) {
  const db = getAdminClient();
  const { data, error } = await db
    .from("persons")
    .select("avatar_path")
    .eq("id", personId)
    .maybeSingle();
  if (error) return null;
  return signedAvatarUrl(data?.avatar_path);
}
