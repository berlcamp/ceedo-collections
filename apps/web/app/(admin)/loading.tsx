/**
 * The tape, before the figures land. A skeleton rather than a spinner: the frame is fixed
 * across routes, so what arrives should arrive into a shape the eye is already holding.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mb-5 border-b border-rule pb-4">
        <div className="h-5 w-56 animate-pulse bg-rule-soft" />
        <div className="mt-2.5 h-3.5 w-full max-w-lg animate-pulse bg-rule-soft" />
      </div>
      <div className="border border-rule bg-tape-raised">
        <div className="flex items-center gap-2 border-b border-rule bg-tape px-2.5 py-2">
          <div className="h-8 w-56 animate-pulse bg-rule-soft" />
        </div>
        <div className="border-b border-rule-strong bg-tape px-3 py-2.5">
          <div className="h-3 w-40 animate-pulse bg-rule-soft" />
        </div>
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="flex items-center gap-6 border-b border-rule-soft px-3 py-2.5">
            <div className="h-3 w-24 animate-pulse bg-rule-soft" />
            <div className="h-3 w-40 animate-pulse bg-rule-soft" />
            <div className="ml-auto h-3 w-20 animate-pulse bg-rule-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
