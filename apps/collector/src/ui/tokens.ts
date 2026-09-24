import type { ComponentProps } from "react";
import type MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";

/**
 * CEEDO COLLECTOR — "CIVIC LEDGER".
 *
 * A clean, professional light theme: slate ground, white cards, a navy masthead for the
 * figures that matter, one sky-blue action colour and outline icons from a single family.
 * Derived from the ui-ux-pro-max design system for a government revenue tool ("Minimalism &
 * Swiss Style", navy + blue, Atkinson Hyperlegible).
 *
 * THE PHYSICAL CONTEXT STILL GOVERNS. An Android tablet held one-handed, in daylight, in a
 * Philippine public market, by someone with a queue waiting and a receipt booklet in the
 * other hand. Contrast and figure size are not taste here: a collector reads a number off
 * this screen and writes it onto a paper Official Receipt by hand.
 *
 * Every text pairing below was computed against its own ground, not assumed (WCAG ratio):
 *   ink on card        17.9:1     muted on card      7.6:1     suppressed on card  4.8:1
 *   muted on ground     7.0:1     onPrimary/primary  5.9:1     refusal on card     6.5:1
 *   confirmed on card   5.0:1     warning on card    5.0:1     onHero on hero     17.9:1
 *
 * `suppressed` is for text on CARDS only (4.3:1 on the ground). Rows live on cards.
 */
export const color = {
  /** The screen ground. */
  ground: "#F1F5F9",
  /** Cards, list groups, the app bar, the action shelf. */
  card: "#FFFFFF",
  /** A recessed fill: a disabled button, a pressed row, an icon tile. */
  sunk: "#E8EDF3",
  /** Hairlines and card borders. */
  rule: "#E2E8F0",
  /** Field borders, which must read as a boundary (3:1 against the card). */
  ruleStrong: "#94A3B8",

  /** Body text and figures. */
  ink: "#0F172A",
  /** Secondary text. */
  muted: "#475569",
  /** A row dropped back once a selection exists elsewhere. Still 4.8:1, never a wash. */
  suppressed: "#64748B",

  /** THE ACTION COLOUR: primary buttons, focus, selection. */
  primary: "#0369A1",
  primaryPressed: "#075985",
  /** The tint behind a selected row and a tonal button. */
  primaryWash: "#E0F2FE",
  onPrimary: "#FFFFFF",

  /** The navy hero: the shift summary card. */
  hero: "#0F172A",
  onHero: "#FFFFFF",
  onHeroMuted: "#CBD5E1",

  /** RESERVED SIGNALS. Each is spent on exactly one meaning and never decorates. */
  refusal: "#B91C1C",
  refusalWash: "#FEF2F2",
  refusalRule: "#FECACA",
  confirmed: "#15803D",
  confirmedWash: "#F0FDF4",
  confirmedRule: "#BBF7D0",
  warning: "#B45309",
  warningWash: "#FFFBEB",
  warningRule: "#FDE68A",
} as const;

/**
 * Five sizes. `figure` is the number that gets copied onto the paper — the largest type in
 * the app on every screen that has one.
 */
export const size = {
  figure: 40,
  title: 22,
  body: 17,
  small: 15,
  label: 13,
} as const;

/**
 * Atkinson Hyperlegible, from the Braille Institute: built so that 0/O, 1/l/I and 5/S
 * cannot be confused — which is the whole job of a screen whose figures are hand-copied.
 * Bundled with the app (never fetched), so it cannot fail to load in a market with no
 * signal. On Android each weight is its own family, so `fontWeight` is never set on these.
 */
export const face = {
  text: "AtkinsonHyperlegible_400Regular",
  bold: "AtkinsonHyperlegible_700Bold",
  /** Credentials and the PIN — character-by-character transcription, not prose. */
  mono: "monospace",
} as const;

/** One 4/8 spacing rhythm. */
export const space = {
  hair: 2,
  tight: 6,
  snug: 10,
  step: 16,
  gap: 24,
  rift: 32,
} as const;

/**
 * 48dp is the Android minimum; the primary button takes 56 because it is the one control
 * a collector hits one-handed, at arm's length, without looking away from a queue.
 */
export const touch = {
  min: 48,
  shelf: 56,
} as const;

export const radius = {
  field: 12,
  button: 14,
  card: 16,
  pill: 999,
} as const;

/** Icon sizes as tokens, never ad hoc. */
export const icon = {
  sm: 18,
  md: 22,
  lg: 28,
} as const;

/** One icon family, outline style: Material Community Icons. */
export type IconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

/** Tracking for the small-caps section label. */
export const tracking = 0.8;
