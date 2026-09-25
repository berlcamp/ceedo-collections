"use client";

import { Button } from "@/components/ui/button";
import { getBrowserClient } from "@/lib/supabase/client";

export default function SignInPage() {
  async function signIn() {
    await getBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // Always offer the account chooser. Without it Google silently reuses the last
        // account, so someone who signed out of the wrong one could never switch.
        queryParams: { prompt: "select_account" },
      },
    });
  }

  return (
    // The chassis, alone, before there is any tape to read: the one screen in the app
    // where the machine is all there is.
    <main className="on-chassis flex min-h-dvh flex-col justify-center bg-chassis-900 px-6 py-12">
      <div className="mx-auto w-full max-w-sm">
        <div className="border-b border-chassis-700 pb-5">
          <h1 className="text-2xl font-semibold tracking-[-0.015em] text-chassis-ink">
            CEEDO Collections
          </h1>
          <p className="mt-1.5 text-sm text-chassis-dim">City Economic Enterprise Office</p>
        </div>

        <Button
          onClick={signIn}
          className="mt-6 h-10 w-full border-chassis-500 bg-chassis-800 text-chassis-ink hover:bg-chassis-700 active:bg-chassis-850"
        >
          Sign in with Google
        </Button>

        <p className="mt-5 text-xs leading-relaxed text-chassis-dim">
          Access is by invitation. Ask an administrator to register your email address first.
        </p>
      </div>
    </main>
  );
}
