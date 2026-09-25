"use server";

import { redirect } from "next/navigation";
import { getServerClient } from "@/lib/supabase/server";

/**
 * Ends this browser's session only (`scope: "local"`). The auth project is shared with
 * Asenso, and a global sign-out would also end the person's sessions on other devices.
 */
export async function signOut(): Promise<void> {
  const supabase = await getServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/sign-in");
}
