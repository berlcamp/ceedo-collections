"use client";

import type { Database } from "@ceedo/shared";
import { createBrowserClient } from "@supabase/ssr";

export function getBrowserClient() {
  return createBrowserClient<Database, "ceedo_collections">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "ceedo_collections" } },
  );
}
