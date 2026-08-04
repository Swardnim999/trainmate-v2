/**
 * Copy every object from the OLD `avatars` bucket (Lovable Cloud) to the NEW
 * `avatars` bucket (your own Supabase project).
 *
 * Both buckets must already exist. The new one is created by the migrations
 * (private bucket).
 *
 * Required env vars:
 *   OLD_SUPABASE_URL          e.g. https://rswxmpeenaudubnnmwcd.supabase.co
 *   OLD_SERVICE_ROLE_KEY      service role key of the Lovable Cloud project
 *   NEW_SUPABASE_URL          your new project URL
 *   NEW_SERVICE_ROLE_KEY      your new project service role key
 *
 * Run:
 *   bun run migration/copy-avatars.ts
 */
import { createClient } from "@supabase/supabase-js";

const {
  OLD_SUPABASE_URL,
  OLD_SERVICE_ROLE_KEY,
  NEW_SUPABASE_URL,
  NEW_SERVICE_ROLE_KEY,
} = process.env;

if (!OLD_SUPABASE_URL || !OLD_SERVICE_ROLE_KEY || !NEW_SUPABASE_URL || !NEW_SERVICE_ROLE_KEY) {
  console.error("Missing required env vars.");
  process.exit(1);
}

const oldSb = createClient(OLD_SUPABASE_URL, OLD_SERVICE_ROLE_KEY);
const newSb = createClient(NEW_SUPABASE_URL, NEW_SERVICE_ROLE_KEY);

const BUCKET = "avatars";

async function listAll(prefix = ""): Promise<string[]> {
  const out: string[] = [];
  const { data: entries, error } = await oldSb.storage.from(BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw error;
  if (!entries) return out;

  for (const e of entries) {
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    // Folder entries have no id/metadata in Supabase storage
    if (!e.id) {
      out.push(...(await listAll(path)));
    } else {
      out.push(path);
    }
  }
  return out;
}

async function main() {
  console.log("Listing objects in source bucket...");
  const paths = await listAll();
  console.log(`Found ${paths.length} objects.`);

  let ok = 0, fail = 0;
  for (const path of paths) {
    try {
      const { data: blob, error: dlErr } = await oldSb.storage.from(BUCKET).download(path);
      if (dlErr || !blob) throw dlErr ?? new Error("no blob");

      const { error: upErr } = await newSb.storage
        .from(BUCKET)
        .upload(path, blob, { upsert: true, contentType: blob.type || undefined });
      if (upErr) throw upErr;

      ok++;
      console.log(`✓ ${path}`);
    } catch (e) {
      fail++;
      console.error(`✗ ${path}:`, (e as Error).message);
    }
  }
  console.log(`\nDone. ${ok} copied, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
