export default function NoAccessPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-semibold">No access to this system</h1>
      <p className="text-sm text-neutral-600">
        Your Google account signed in successfully, but it is not registered with CEEDO
        Collections. Ask an administrator to add your email address, then sign in again.
      </p>
      <p className="text-sm text-neutral-600">
        Collectors do not use this site — collections are recorded on the tablet.
      </p>
      <a href="/sign-in" className="text-sm underline">
        Back to sign in
      </a>
    </main>
  );
}
