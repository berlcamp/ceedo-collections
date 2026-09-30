/**
 * Wraps `fn` so that overlapping calls share one run instead of starting a second.
 *
 * A SYNC IS NOT SAFE TO RUN TWICE AT ONCE. Two pulls would each apply a delta against the
 * same cursor, and two pushes would mark the same outbox rows in_flight and settle them
 * against two different answers. Once a sync can also start on its own (a timer, the app
 * coming back to the foreground), a collector tapping "Sync now" mid-run is ordinary, not
 * an edge case -- so the tap joins the run already going and hears its outcome.
 *
 * A failed run is not remembered: the next call after it settles starts fresh.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (!running) {
      running = fn().finally(() => {
        running = null;
      });
    }
    return running;
  };
}
