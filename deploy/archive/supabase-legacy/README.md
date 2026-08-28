# TrainMate v2 — Archived Legacy Supabase Migrations & Configuration

**Archive Date:** 2026-08-28<br/>
**Status:** READ-ONLY HISTORICAL ARCHIVE — NOT USED IN RUNTIME OR DEPLOYMENT<br/>
**Authoritative Schema:** `backend/prisma/schema.prisma`

## Overview

This directory preserves the 31 original Supabase SQL migrations and `config.toml` that constituted the TrainMate v1 database setup prior to the v2 platform migration (Milestones 1–15).

All database schema structures, foreign keys, cascade behaviors, and indexes have been fully ported to Prisma ORM (`backend/prisma/schema.prisma`) and PostgreSQL 17. Row Level Security (RLS) policies have been replaced with explicit service-layer authorization checks in the Node.js/Express backend.

This folder is retained strictly for:
1. Historical reference and post-cutover data audits.
2. Compliance and verification against original table definitions.
3. Cold reference in accordance with `deploy/runbooks/decommission.md`.

Do not execute, apply, or link these migrations to any active database or deployment pipeline.
