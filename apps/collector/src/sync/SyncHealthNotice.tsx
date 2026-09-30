import { Rift, Statement } from "../ui";
import { useSyncHealth } from "./useSyncHealth";

/**
 * The standing warning on the Sign-in and Shift screens: receipts that exist only on this
 * tablet, and a tablet the office has stopped accepting.
 *
 * THE COUNT IS THE STAKES, SO IT IS SAID AS THE STAKES. Clearing the app's data or
 * uninstalling it deletes these receipts outright, and nothing at the office can bring them
 * back. "Not synced" reads as a chore for later; "only on this tablet" reads as what it is.
 *
 * Nothing is shown when there is nothing to say -- a clean tablet does not need a green box.
 */
export function SyncHealthNotice() {
  const { unsent, refused } = useSyncHealth();

  return (
    <>
      {refused ? (
        <>
          <Statement tone="refusal" detail={refused.detail}>
            {refused.said}
          </Statement>
          <Rift h={12} />
        </>
      ) : null}
      {unsent ? (
        <>
          <Statement tone="warning">
            {unsent === 1
              ? "1 receipt is only on this tablet. It has not reached the office yet. Do not clear the app's data or uninstall it."
              : `${unsent} receipts are only on this tablet. They have not reached the office yet. Do not clear the app's data or uninstall it.`}
          </Statement>
          <Rift h={12} />
        </>
      ) : null}
    </>
  );
}
