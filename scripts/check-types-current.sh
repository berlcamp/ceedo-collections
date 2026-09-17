#!/usr/bin/env bash
# Fails when db.types.ts is out of step with the migrations. Stale types are how a
# renamed column becomes a runtime error rather than a compile error.
set -euo pipefail

generated=$(mktemp)
trap 'rm -f "$generated"' EXIT

{
  echo '// AUTO-GENERATED FILE. DO NOT EDIT BY HAND.'
  echo '// Run `pnpm db:types` to regenerate from the local Postgres schema (schema: ceedo_collections).'
  supabase gen types typescript --local --schema ceedo_collections
} > "$generated"

if ! diff -q "$generated" packages/shared/src/db.types.ts > /dev/null; then
  echo "db.types.ts is stale. Run: pnpm db:types" >&2
  diff "$generated" packages/shared/src/db.types.ts || true
  exit 1
fi

echo "db.types.ts is current."
