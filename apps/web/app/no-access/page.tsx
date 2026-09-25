import { signOut } from "@/lib/auth/actions";

export default function NoAccessPage() {
  return (
    <main className="on-chassis flex min-h-dvh flex-col justify-center bg-chassis-900 px-6 py-12">
      <div className="mx-auto w-full max-w-md">
        <h1 className="border-b border-chassis-700 pb-4 text-xl font-semibold tracking-[-0.015em] text-chassis-ink">
          No access to this system
        </h1>
        <p className="mt-5 text-sm leading-relaxed text-chassis-dim">
          Your Google account signed in successfully, but it is not registered with CEEDO
          Collections. Ask an administrator to add your email address, then sign in again.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-chassis-dim">
          Collectors do not use this site — collections are recorded on the tablet.
        </p>
        {/* A sign-out, not a link: the session is still live, and signing in again with a
            different Google account needs it ended first. */}
        <form action={signOut}>
          <button
            type="submit"
            className="mt-6 inline-block text-sm font-medium text-chassis-ink underline decoration-chassis-500 hover:decoration-chassis-ink"
          >
            Sign out and use another account
          </button>
        </form>
      </div>
    </main>
  );
}
