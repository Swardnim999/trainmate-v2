#!/usr/bin/env bash
# Restore the dump produced by dump.sh into your NEW Supabase project.
#
# Prerequisites on the new project:
#   1. supabase/migrations/* applied (either via `supabase db push` or by
#      pasting migration/schema.sql in the SQL editor).
#   2. NEW_DB_URL set to the project's connection string:
#        postgres://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
#      (Supabase dashboard -> Project Settings -> Database -> Connection string)
#
# Usage:
#   NEW_DB_URL="postgres://..." DUMP=/path/to/lovable-dump.sql bash migration/restore.sh

set -euo pipefail

: "${NEW_DB_URL:?Set NEW_DB_URL to your new Supabase Postgres connection string}"
DUMP="${DUMP:-/mnt/documents/lovable-dump.sql}"

if [[ ! -f "$DUMP" ]]; then
  echo "Dump file not found: $DUMP" >&2
  exit 1
fi

echo "Restoring $DUMP into new project ..."
# ON_ERROR_STOP=1 makes psql fail fast; --single-transaction wraps the whole
# restore so a failure rolls back cleanly.
psql "$NEW_DB_URL" \
  -v ON_ERROR_STOP=1 \
  --single-transaction \
  -f "$DUMP"

echo
echo "Row counts on new project:"
psql "$NEW_DB_URL" -c "
  SELECT 'auth.users' AS table, count(*) FROM auth.users
  UNION ALL SELECT 'profiles', count(*) FROM public.profiles
  UNION ALL SELECT 'journeys', count(*) FROM public.journeys
  UNION ALL SELECT 'requests', count(*) FROM public.requests
  UNION ALL SELECT 'conversations', count(*) FROM public.conversations
  UNION ALL SELECT 'messages', count(*) FROM public.messages
  UNION ALL SELECT 'blocked_users', count(*) FROM public.blocked_users;
"

echo "Restore complete."
