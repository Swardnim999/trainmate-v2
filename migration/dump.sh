#!/usr/bin/env bash
# Dump data from the current Lovable Cloud Supabase project.
# Run this INSIDE the Lovable sandbox (or anywhere PG* env vars point at the source DB).
#
# Output: /mnt/documents/lovable-dump.sql  (data-only, ready for restore.sh)
#
# Usage:
#   bash migration/dump.sh

set -euo pipefail

: "${PGHOST:?PGHOST must be set (Lovable sandbox provides this)}"
: "${PGUSER:?PGUSER must be set}"
: "${PGPASSWORD:?PGPASSWORD must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"
: "${PGPORT:=5432}"

OUT="${OUT:-/mnt/documents/lovable-dump.sql}"
mkdir -p "$(dirname "$OUT")"

echo "Dumping auth.users + auth.identities + public schema data to $OUT ..."

# Data-only dump. We restore into a project whose schema is already created
# by supabase/migrations/*, so we skip --schema and --create.
pg_dump \
  --data-only \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --column-inserts \
  -t 'auth.users' \
  -t 'auth.identities' \
  -t 'public.profiles' \
  -t 'public.trains' \
  -t 'public.unverified_trains' \
  -t 'public.journeys' \
  -t 'public.requests' \
  -t 'public.conversations' \
  -t 'public.messages' \
  -t 'public.last_read' \
  -t 'public.blocked_users' \
  -t 'public.user_reports' \
  > "$OUT"

echo "Done. Size: $(du -h "$OUT" | cut -f1)"
echo "Next: scp/download $OUT then run restore.sh with NEW_DB_URL set."
