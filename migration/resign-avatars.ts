/**
 * After copying avatars to the new bucket, the signed URLs stored in
 * profiles.avatar_url still point at the OLD project and will 403.
 *
 * This script walks every profile with an avatar_url, derives the object
 * path (`<userId>/avatar.<ext>`) from the stored URL, and writes a fresh
 * 1-year signed URL from the NEW project back to the row.
 *
 * Required env vars:
 *   NEW_SUPABASE_URL
 *   NEW_SERVICE_ROLE_KEY
 *
 * Run:
 *   bun run migration/resign-avatars.ts
 */
import { createClient } from "@supabase/supabase-js";

const { NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY } = process.env;
if (!NEW_SUPABASE_URL || !NEW_SERVICE_ROLE_KEY) {
  console.error("Missing NEW_SUPABASE_URL / NEW_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY);
const BUCKET = "avatars";
const ONE_YEAR = 60 * 60 * 24 * 365;

/** Extract the storage object path from a previously stored signed URL. */
function pathFromSignedUrl(url: string, userId: string): string | null {
  // Stored URLs look like:
  //   https://<ref>.supabase.co/storage/v1/object/sign/avatars/<userId>/avatar.<ext>?token=...
  const m = url.match(/\/object\/(?:sign|public)\/avatars\/([^?]+)/);
  if (m) return m[1];
  // Fallback: just assume `<userId>/avatar.<something>` exists; let caller list.
  return null;
}

async function main() {
  const { data: profiles, error } = await sb
    .from("profiles")
    .select("id, avatar_url")
    .not("avatar_url", "is", null);
  if (error) throw error;

  console.log(`Found ${profiles?.length ?? 0} profiles with an avatar.`);

  let ok = 0, miss = 0, fail = 0;
  for (const p of profiles ?? []) {
    try {
      let path = p.avatar_url ? pathFromSignedUrl(p.avatar_url, p.id) : null;

      // Fallback: list the user's folder and pick the first object.
      if (!path) {
        const { data: list } = await sb.storage.from(BUCKET).list(p.id);
        const first = list?.find((e) => e.id);
        if (!first) { miss++; console.warn(`- ${p.id}: no object found`); continue; }
        path = `${p.id}/${first.name}`;
      }

      const { data: signed, error: signErr } = await sb.storage
        .from(BUCKET)
        .createSignedUrl(path, ONE_YEAR);
      if (signErr || !signed) throw signErr ?? new Error("no signed url");

      const { error: updErr } = await sb
        .from("profiles")
        .update({ avatar_url: signed.signedUrl })
        .eq("id", p.id);
      if (updErr) throw updErr;

      ok++;
      console.log(`✓ ${p.id}`);
    } catch (e) {
      fail++;
      console.error(`✗ ${p.id}:`, (e as Error).message);
    }
  }

  console.log(`\nDone. updated=${ok} missing=${miss} failed=${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
