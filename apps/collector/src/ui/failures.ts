/**
 * What a collector is told when a sync fails, in the product's language.
 *
 * Every call site was printing `Could not sync: ${String(error)}`, which puts whatever the
 * runtime threw -- a TypeError, a fetch failure, a JSON parse error -- in front of someone
 * standing in a market. That names a cause the screen has not checked and is not language
 * anyone can act on.
 *
 * THE RAW TEXT IS KEPT, NOT DISCARDED. The office has to diagnose these, and this codebase
 * already decided elsewhere that a raw message belongs on screen for whoever has to fix it
 * (see the ambiguous-rate branch in ambulant.tsx). It is demoted to a second line rather
 * than deleted, so the sentence a collector reads comes first and the detail a supervisor
 * needs is still there.
 */
export function syncFailure(error: unknown): { said: string; detail: string } {
  return {
    said: "Could not reach the office. You can keep working offline.",
    detail: String(error),
  };
}
