"use client";

import { getBrowserClient } from "@/lib/supabase/client";

export default function SignInPage() {
  async function signIn() {
    await getBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">CEEDO Collections</h1>
        <p className="mt-1 text-sm text-neutral-600">City Economic Enterprise Office</p>
      </div>
      <button
        type="button"
        onClick={signIn}
        className="rounded-md border border-neutral-300 px-4 py-2.5 text-sm font-medium hover:bg-neutral-50"
      >
        Sign in with Google
      </button>
      <p className="text-xs text-neutral-500">
        Access is by invitation. Ask an administrator to register your email address first.
      </p>
    </main>
  );
}
