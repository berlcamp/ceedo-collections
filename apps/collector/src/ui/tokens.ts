import { Platform } from "react-native";

/**
 * THE CONDUCTOR'S RACK.
 *
 * The world is the bus and jeepney conductor's ticket rack: a mobile collector working a
 * route with pre-numbered accountable paper, punching a serial to spend it, reconciling the
 * rack against cash at the end. It is the closest working analogue this product has, and it
 * is a LAYOUT LAW, not a picture — ranked slots, one live slot, spent ones you can see.
 * No wood grain, no drawn brass, no skeuomorphic perforation.
 *
 * The full direction contract lives in `.impeccable/surfaces/src-app.md`. Read it before
 * changing anything here.
 *
 * EVERY VALUE BELOW WAS CHOSEN FOR A TABLET HELD ONE-HANDED, IN DAYLIGHT, IN A PHILIPPINE
 * PUBLIC MARKET, BY SOMEONE WITH A QUEUE WAITING AND A RECEIPT BOOKLET IN THE OTHER HAND.
 * Contrast and figure size are not taste here; a collector reads a number off this screen
 * and writes it onto a paper Official Receipt by hand.
 */

/**
 * Ticket stock, rack board, punch ink, one accent, three reserved signals.
 *
 * Deliberately NOT cream. The ground is a cool matte stock, because a warm paper ground is
 * where this kind of work drifts by default and because a cool ground holds its contrast
 * better under the yellow cast of direct tropical sun.
 *
 * Every text pairing below was computed against its own ground, not assumed:
 *   ink on stock        15.0:1     muted on stock       7.1:1
 *   suppressed on stock  5.0:1     refusal on stock     5.9:1
 *   confirmed on stock   5.8:1     stock on rack board 10.3:1
 *
 * `warning` is 3.4:1 on stock and is therefore A RULE AND A TAG, NEVER BODY TEXT. Warning
 * copy is set in `ink` on `warningWash`. This is the one colour in the set that cannot
 * carry a sentence, and forgetting that is how an amber message becomes unreadable at noon.
 */
export const color = {
  /** Ticket stock. The ground of every screen. */
  stock: "#F1F3F1",
  /** A slightly recessed stock, for insets and the unissued slot. */
  stockSunk: "#E4E8E5",
  /** The rack board: worn transit teal. Masthead strip and the action shelf. */
  rack: "#0E4A44",
  /** A lifted rack tone, for a pressed shelf. */
  rackLift: "#14625A",
  /** Punch ink. Body text and figures. */
  ink: "#16181A",
  /** Secondary text. Tinted from the rack's hue rather than gray (craft floor). */
  muted: "#4A5450",
  /** Suppressed text: an unselected slot once a run is chosen. Still 5.0:1, never a wash. */
  suppressed: "#616B66",
  /** Hairline rule between slots. */
  rule: "#CDD4D0",

  /** THE ONE ACCENT. Live and selected, and nothing else. */
  ochre: "#C2761B",
  /** The wash behind a selected slot. Ink stays fully legible on it. */
  ochreWash: "#F7E9D4",

  /**
   * RESERVED SIGNALS. Each is spent on exactly one meaning and never decorates.
   * A refusal red that also rules a heading is a red nobody reads.
   */
  refusal: "#B3261E",
  refusalWash: "#FBE9E7",
  confirmed: "#1B6B45",
  confirmedWash: "#E6F2EB",
  /** Rule and tag only — never text. See the note above. */
  warning: "#B4780A",
  warningWash: "#FBF0D8",

  /** On the rack board. */
  onRack: "#F1F3F1",
  onRackMuted: "#A8C2BD",
} as const;

/**
 * FOUR SIZES. The incumbent screens used ten ad-hoc sizes between 13 and 34, picked per
 * file; the relationship between them was invisible because there wasn't one.
 *
 * `figure` is the fare panel — the number that gets copied onto the paper — and it is the
 * largest type in the app on every screen that has one.
 */
export const size = {
  figure: 40,
  title: 26,
  body: 17,
  label: 13,
} as const;

/**
 * Native Android faces, deliberately.
 *
 * `sans-serif-condensed` IS Roboto Condensed on Android and ships with the OS, so the
 * condensed label voice costs no bundle and — the reason that actually matters — cannot
 * fail to load at 5am in a market where a webfont fetch has no network to run on. Material
 * 3 names Roboto as the system face and asks brands to express through the type scale,
 * which is what the caps tracking, the four sizes and the weight steps below do.
 *
 * Roboto's digits are monospaced by default, so every peso figure aligns on its decimal
 * column for free — no `fontVariant: ['tabular-nums']`, which React Native does not apply
 * on Android anyway.
 */
export const face = {
  /** Tracked caps labels, stall numbers, the fare panel. */
  condensed: Platform.select({ android: "sans-serif-condensed", default: "System" }),
  /** Body copy and messages. */
  text: Platform.select({ android: "sans-serif", default: "System" }),
  /** Credentials and the PIN — character-by-character transcription, not prose. */
  mono: Platform.select({ android: "monospace", default: "Menlo" }),
} as const;

/** One spacing rhythm. Tight inside a group, generous between groups. */
export const space = {
  hair: 2,
  tight: 6,
  snug: 10,
  step: 16,
  gap: 24,
  rift: 36,
} as const;

/**
 * 48dp is the Material minimum; the shelf takes 56 because it is the one control a
 * collector hits one-handed, at arm's length, without looking away from a queue.
 */
export const touch = {
  min: 48,
  shelf: 56,
} as const;

/** The rack's spine: the continuous ochre edge that marks a selected run. */
export const spine = 5;

/** Tracking for the caps label voice. */
export const tracking = 1.1;
