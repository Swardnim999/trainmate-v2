#!/usr/bin/env bash
# ==============================================================================
# TrainMate v2 — Supabase Production Data Export Tool
# ==============================================================================
# Safely dumps data-only SQL from the live Supabase database for migration to
# the self-hosted PostgreSQL target.
#
# Usage:
#   export SUPABASE_DB_URL="postgresql://postgres.<project_ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"
#   bash migration/export-supabase.sh
# ==============================================================================

set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "Error: SUPABASE_DB_URL is not set." >&2
  echo "Usage: export SUPABASE_DB_URL='postgres://...' && bash migration/export-supabase.sh" >&2
  exit 1
fi

OUTPUT_FILE="${OUTPUT_FILE:-migration/supabase-data-export.sql}"

echo "Starting data export from Supabase..."
echo "Target tables: auth.users, public.*"

pg_dump \
  --data-only \
  --no-owner \
  --no-privileges \
  --inserts \
  --table=auth.users \
  --table=public.profiles \
  --table=public.journeys \
  --table=public.requests \
  --table=public.conversations \
  --table=public.messages \
  --table=public.last_read \
  --table=public.blocked_users \
  --table=public.user_reports \
  --table=public.trains \
  --table=public.unverified_trains \
  "${SUPABASE_DB_URL}" > "${OUTPUT_FILE}"

echo "Data export complete -> ${OUTPUT_FILE}"
echo "File size: $(ls -lh "${OUTPUT_FILE}" | awk '{print $5}')"
