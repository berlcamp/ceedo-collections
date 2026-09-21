---
name: CEEDO Collector
description: The conductor's rack — ranked slots, one live slot, and a fare panel you can read in a market at noon.
colors:
  stock: "#F1F3F1"
  stock-sunk: "#E4E8E5"
  rack: "#0E4A44"
  rack-lift: "#14625A"
  ink: "#16181A"
  muted: "#4A5450"
  suppressed: "#616B66"
  rule: "#CDD4D0"
  ochre: "#C2761B"
  ochre-wash: "#F7E9D4"
  refusal: "#B3261E"
  refusal-wash: "#FBE9E7"
  confirmed: "#1B6B45"
  confirmed-wash: "#E6F2EB"
  warning: "#B4780A"
  warning-wash: "#FBF0D8"
  on-rack: "#F1F3F1"
  on-rack-muted: "#A8C2BD"
typography:
  figure:
    fontFamily: "sans-serif-condensed"
    fontSize: "40sp"
    fontWeight: 700
    lineHeight: "44sp"
    letterSpacing: "0"
  title:
    fontFamily: "sans-serif-condensed"
    fontSize: "26sp"
    fontWeight: 700
    letterSpacing: "0"
  body:
    fontFamily: "sans-serif"
    fontSize: "17sp"
    fontWeight: 400
    lineHeight: "24.65sp"
    letterSpacing: "0"
  label:
    fontFamily: "sans-serif-condensed"
    fontSize: "13sp"
    fontWeight: 700
    letterSpacing: "1.1"
  mono:
    fontFamily: "monospace"
    fontSize: "13sp"
    fontWeight: 400
    lineHeight: "18.2sp"
    letterSpacing: "0"
rounded:
  none: "0dp"
  field: "3dp"
  control: "4dp"
  pip: "5dp"
  notch: "8dp"
spacing:
  hair: "2dp"
  tight: "6dp"
  snug: "10dp"
  step: "16dp"
  gap: "24dp"
  rift: "36dp"
components:
  punch-primary:
    backgroundColor: "{colors.rack}"
    textColor: "{colors.on-rack}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "56dp"
    padding: "0dp 16dp"
  punch-danger:
    backgroundColor: "{colors.refusal}"
    textColor: "{colors.on-rack}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "56dp"
  punch-blocked:
    backgroundColor: "{colors.stock-sunk}"
    textColor: "{colors.suppressed}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "56dp"
  action-quiet:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.rack}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "48dp"
    padding: "0dp 16dp"
  action-danger:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.refusal}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "48dp"
  action-blocked:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.suppressed}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "48dp"
  slot:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    height: "48dp"
    padding: "10dp 0dp"
  slot-selected:
    backgroundColor: "{colors.ochre-wash}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
  slot-suppressed:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.suppressed}"
    rounded: "{rounded.none}"
  slot-spent:
    backgroundColor: "{colors.confirmed-wash}"
    textColor: "{colors.confirmed}"
    rounded: "{rounded.none}"
    height: "48dp"
  field:
    backgroundColor: "{colors.stock-sunk}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.field}"
    height: "48dp"
    padding: "10dp"
  rack-head:
    backgroundColor: "{colors.rack}"
    textColor: "{colors.on-rack}"
    typography: "{typography.title}"
    rounded: "{rounded.none}"
    padding: "6dp 16dp 10dp"
  shelf:
    backgroundColor: "{colors.stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "10dp 16dp"
  statement-refusal:
    backgroundColor: "{colors.refusal-wash}"
    textColor: "{colors.refusal}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "10dp 16dp"
  statement-warning:
    backgroundColor: "{colors.warning-wash}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "10dp 16dp"
  statement-confirmed:
    backgroundColor: "{colors.confirmed-wash}"
    textColor: "{colors.confirmed}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "10dp 16dp"
  statement-notice:
    backgroundColor: "{colors.stock-sunk}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "10dp 16dp"
---

# Design System: CEEDO Collector

## Overview

**Creative North Star: "The Conductor's Rack"**

The bus and jeepney conductor's ticket rack: pre-numbered accountable paper held in ranked
slots, one live slot, a serial punched to spend it, and the whole rack reconciled against
cash at the end of the route. It is a **layout law, not a picture**. There is no wood grain,
no drawn brass, no skeuomorphic perforation anywhere in the build, and none may be added.
What the metaphor buys is structure: things that are owed are slots stacked oldest-at-top;
a selection is a continuous ochre edge running down the gutter; the figure that leaves the
screen for a paper Official Receipt is the largest type in the app, pinned where it cannot
scroll away.

The world refuses the category default deliberately. Material 3's tonal card on a tinted
surface is absent from this build: a rack has no cards, so this system has no cards. Depth
is carried by hairline rules, a recessed stock inset and one filled chrome strip — never by
a shadow, never by a rounded elevated container. Every value in `src/ui/tokens.ts` was
chosen for a tablet held one-handed, in daylight, in a Philippine public market, by someone
with a queue waiting and a receipt booklet in the other hand. Contrast and figure size are
not taste here.

Two of this system's rules are enforced by the TypeScript types in `src/ui/index.tsx`
rather than by discipline, and that is the single most important property to preserve when
extending it. **`Punch`, `Action` and `Slot` have no `disabled` prop.** They take
`blocked: string | null`, where a non-null value both disables the control and states what
is missing; `missing(...)` joins reasons so two missing things are both named. A dead
control with no stated reason is not expressible at a call site. **`Figure` and `Amount`
take a rendered string, never a number.** Wire decimals pass through `fromWire()`, which
routes them back through `format()` from `@ceedo/shared`, so no numeric path exists through
a money component; `null` renders a stated absence, never `₱0.00`, because `₱0.00` is a
specific claim about money.

**Key Characteristics:**
- Ranked slots and hairlines instead of cards; no container has a shadow anywhere in the build.
- One accent (ochre) spent entirely on live/selected; three reserved signals that never decorate.
- Four type sizes, in sp, and no fifth.
- Every control carries a permanently visible text label; no icon-only affordance exists.
- The primary action is a pinned bottom shelf, not a FAB.
- Light scheme only, by explicit product decision (daylight operation).

## Colors

A cool matte ticket stock under punch ink, one worn transit-teal chrome, a single ochre
accent, and three signals that are each spent on exactly one meaning.

### Primary
- **Rack Board Teal** (`rack`): the chrome. The full-bleed masthead strip that paints up
  through the status-bar inset on every screen, and the filled primary shelf control. It is
  the app's one large colour field and it holds the same position and scale on every screen.
- **Lifted Rack** (`rack-lift`): the Android ripple tone inside a filled primary control.
  Never a static fill.

### Secondary
- **Punch Ochre** (`ochre`): THE ONE ACCENT. The 5 dp spine down a selected slot's gutter,
  the focused field's underline, and the slot ripple. Live and selected, and nothing else.
- **Ochre Wash** (`ochre-wash`): the fill behind a selected slot. Ink stays fully legible on it.

### Tertiary — the reserved signals
- **Refusal Red** (`refusal`) / **Refusal Wash** (`refusal-wash`): refusals, blocked-slot
  reasons, and destructive controls (Sign out, Remove) — things that stop or destroy.
- **Confirmed Green** (`confirmed`) / **Confirmed Wash** (`confirmed-wash`): a settled,
  spent, or successful state — the punched serial, positive change, a matched closeout.
- **Signal Amber** (`warning`) / **Warning Wash** (`warning-wash`): the hairline of a
  confirmable warning and the staleness pip. It is 3.4:1 on stock and 3.3:1 on its own
  wash; it may not carry a sentence or a tone tag.

### Neutral
- **Ticket Stock** (`stock`): the ground of every screen, and the on-rack text colour.
  Deliberately cool, never cream — a warm paper ground is where this kind of work drifts,
  and cool holds its contrast under a yellow tropical cast.
- **Sunk Stock** (`stock-sunk`): the recessed inset behind every text field, the quiet
  control fill, the blocked-control stub, and a pressed slot.
- **Punch Ink** (`ink`): body copy and every figure. 15.0:1 on stock.
- **Muted** (`muted`): label voice and secondary copy. 7.1:1 on stock.
- **Suppressed** (`suppressed`): an unselected slot once a run is chosen, and blocked
  control text. 5.0:1 on stock — dimmed, never washed out.
- **Hairline** (`rule`): the 1 dp rule between slots and above the shelf.
- **On-Rack Muted** (`on-rack-muted`): subtitle, Back label and register text on the teal strip.

Measured pairings recorded in the build: ink 15.0:1, muted 7.1:1, suppressed 5.0:1,
refusal 5.9:1, confirmed 5.8:1 (all on stock); stock on rack board 10.3:1.

### Named Rules
**The Amber Is Never Text Rule.** Amber is a rule and a tag, never a sentence and never a
tone tag. Warning copy is set in ink on the amber wash; the "Check" tag on a warning
statement is also set in ink. This was violated once during the build and caught by review.

**The Spent Signal Rule.** Refusal red carries refusals and destructive controls only.
Never a heading, never a rule, never a decoration, never the peso sign. Confirmed green
carries settlement only. An accent that also rules a heading is an accent nobody reads.

**The One Accent Rule.** Ochre means live-or-selected and nothing else. Nothing decorative
is ochre, and no other colour may mean selected.

## Typography

**Display / figure and label face:** `sans-serif-condensed` — Roboto Condensed, shipped with Android.
**Body face:** `sans-serif` — Roboto, shipped with Android.
**Mono face:** `monospace` — Droid Sans Mono, shipped with Android, for credentials, PINs and raw diagnostic detail.

**Character:** Condensed grotesque caps for the label voice and for figures, plain Roboto
for anything that is a sentence. The condensed face lets a 40 sp peso figure and a long
stall number sit on one line at 360 dp width without shrinking.

Native faces are used rather than a self-hosted brand face for two reasons that hold on
Android. Material 3 names Roboto as the system face and asks brands to express through the
type scale, which is what the four sizes, the caps tracking and the weight steps here do.
And Roboto's digits are monospaced by default, so every peso figure aligns on its decimal
column for free — no `fontVariant: ['tabular-nums']`, which React Native does not apply on
Android anyway. (Offline loading is *not* a reason: a self-hosted face would ship inside
the APK and never fetch. That earlier justification was wrong and is not part of this system.)

### Hierarchy
- **Figure** (`{typography.figure}`): the fare panel. The number a collector copies onto
  the paper Official Receipt. The largest type in the app on every screen that has one, and
  nothing else may be set at this size.
- **Title** (`{typography.title}`): a screen's subject — the stall number in the masthead,
  a stall number in the lease list, the punched serial, and the text inside a `Field`.
- **Body** (`{typography.body}`): every message, explanation, slot line and blocked reason.
- **Label** (`{typography.label}`): tracked uppercase. Section captions, every control
  label, statement tone tags, and the register line.
- **Mono** (`{typography.mono}`): raw diagnostic detail under a statement, and the mono
  field voice (with 1 dp extra tracking on Android) for character-by-character transcription.

### Named Rules
**The Four Sizes Rule.** Four sizes exist — 40 / 26 / 17 / 13 sp — and a fifth is a defect.
The incumbent screens used ten ad-hoc sizes between 13 and 34, and the relationship between
them was invisible because there wasn't one.

**The Largest Figure Rule.** On any screen where money leaves the device for paper, that
figure is the largest thing on the screen. Nothing competes with it at figure scale.

**The sp Rule.** All type is sp and scales with the system font-size setting; the fare
panel sets `allowFontScaling` explicitly. Never a fixed px.

## Layout

A single-column portrait stack, locked to portrait in `app.json`. There is no grid, no
tablet-width variant and no navigation bar: the product is a sequence (enrol → sign in →
open shift → collect → close out) on a plain headerless expo-router `Stack`.

Every screen is the same three-part chassis (`Screen`):
1. **`RackHead`** — the top app bar. Full-bleed rack teal, painted up through the status-bar
   safe-area inset so the light status bar sits directly on it. Carries a labelled **"Back"**
   text control (48 dp minimum height), the title, an optional subtitle, and a right-aligned
   `register` slot capped at 46% width for the sync-age disclosure. The native expo-router
   header is off because it cannot carry that register in a fixed position; System Back and
   the hardware button are untouched by this.
2. **Body** — scrolling stock, 16 dp padding, 36 dp bottom padding,
   `keyboardShouldPersistTaps="handled"`.
3. **Shelf** — pinned to the bottom edge, stock ground, 1 dp hairline on top, padded by the
   bottom safe-area inset plus 10 dp. It holds the primary `Punch` and, where the screen has
   one, the fare panel directly above it. `android.softwareKeyboardLayoutMode: "resize"`
   keeps it above the IME.

**Spacing rhythm.** Six steps, tight inside a group and generous between them: 2 / 6 / 10 /
16 / 24 / 36 dp. Groups are separated by void (`Rift`, 36 dp by default) and by weight,
never by a box.

**Touch.** 48 dp minimum on every target (`touch.min`); the primary shelf control takes
56 dp (`touch.shelf`) because it is the one control hit one-handed, at arm's length,
without looking away from a queue.

### Named Rules
**The Fixed Reference Rule.** The masthead strip and the value slot hold the same position
and scale on every screen. A collector should never hunt for either.

**The No Second Screen Rule.** Per-charge detail expands in place. Never a second screen
mid-transaction.

## Elevation & Depth

**There are no shadows in this build — not one `elevation`, `shadowColor` or `boxShadow` in
`src/ui` or any screen.** Depth is carried three ways: a 1 dp hairline (`rule`) between
slots, above the shelf, and top-and-bottom on a statement band; a recessed tonal inset
(`stock-sunk`) for fields, quiet controls and blocked stubs; and one filled chrome field
(`rack`) for the masthead and the primary shelf control. Material 3 tonal elevation is used
in its flattest form: a tone step, not a lift.

Feedback is Android-native. Every pressable takes `android_ripple` themed from the rack —
`rack-lift` inside a filled primary, `rack` on an outlined action, `ochre` on a slot,
borderless `on-rack-muted` on the Back control — because a fluent Android user reads the
absence of a ripple as a dead control. Pressed states are a tone swap (`stock-sunk`) or an
opacity step (0.86 on a filled control, 0.7 on Back), never a translation.

**Motion.** One animation exists in the entire app: `PunchMark`, ~180 ms, the notch scaling
from 2.2× to 1× with the slot fading in, marking the single irreversible moment when a
receipt commits. It is cut to an instant state change when Reduce Motion is on, and if the
accessibility setting cannot be read the build treats it as on.

### Named Rules
**The Flat Rule.** No shadow, at any elevation, for any reason. A surface is distinguished
by hairline, tone step, or nothing.

**The One Motion Rule.** The punch is the only animation. Anything else that wants to move
is asking for a state change instead.

## Shapes

Near-square. Corners exist only where Android expects them on a control: 4 dp on `Punch`
and `Action`, 3 dp on the top two corners of a `Field` (the bottom is a 3 dp underline, not
a border), and full circles for the 10 dp register pip and the 15 dp punch notch. Everything
structural — slots, statements, the masthead, the shelf — is a hard rectangle at 0 dp.

Two silhouettes carry meaning and may not be reused:

**The spine.** A 5 dp ochre edge in the slot's left gutter. The slot is pulled left by
exactly the spine's width (`marginLeft: -5`) so its content aligns with the body copy and
the hairlines above and below it. A run of selected slots reads as one continuous edge, and
that is what makes FIFO a physical property of the screen.

**The band.** A `Statement` is a wash with hairlines top and bottom only — never an outlined
rectangle. The outlined rectangle is a control's shape (`Action` owns it), and a notice
shaped like a button at 5am in a market is a mis-tap.

### Named Rules
**The Spine Reservation Rule.** The thick left edge belongs to the rack spine alone. A
coloured left edge on an alert — the category's stock costume — spends the one language that
makes a selected run readable.

**The Band, Not A Box Rule.** Notices are bands. Only pressable things get an outline.

## Components

### Punch (primary action)
The one committing control on a screen, on the shelf. Filled rack teal, tracked caps label
in stock, 56 dp minimum, 4 dp corners, `rack-lift` ripple, 0.86 opacity when pressed.
- **Blocked:** no `disabled` prop exists. `blocked` is a reason string; a non-null value
  renders the control as an un-inked stub (`stock-sunk` fill, 1 dp hairline border,
  suppressed label) and prints the reason **above the label, inside the shelf**, as a polite
  live region and as the control's accessibility hint. The explanation belongs where the eye
  already is when it finds the control dead.
- **Busy:** an `ActivityIndicator` beside an optional `busyLabel`; the control is dead while busy.
- **Danger tone:** filled refusal red, for destructive commits only.

### Action (secondary)
Outlined, 1.5 dp rack border, rack-teal tracked caps label, 48 dp minimum, 4 dp corners,
`stock-sunk` when pressed. Sync now, Try again, Sign out, Back-to-somewhere. Same `blocked`
contract as `Punch`, except the reason renders *below* the control. Danger tone swaps border
and label to refusal red. Never an icon: every control in this app carries a permanently
visible text label.

### Slot (the rack row)
A transparent row, 48 dp minimum, 10 dp vertical padding, bounded by a 1 dp `Rule` above and
below, with a 5 dp gutter on the left. Left content is the subject; right content is the
amount, right-aligned and bold on the fixed decimal column. An `under` region carries
expanded detail in place.
- **Selected:** ochre wash fill and a lit ochre spine.
- **Suppressed:** ink drops to `suppressed` (5.0:1) once a run exists elsewhere —
  **selection suppresses, it does not only highlight**. It never drops to a wash: a slot a
  collector cannot read is not a quieter slot, it is a missing one.
- **Blocked:** a reason string, dimming the row and printing the reason in refusal red beneath it.
- The dim state is carried by a `SlotInk` React context, so it reaches `Body` and `Label`
  children passed as nodes, not only strings passed as plain text.

### Figure and Amount (money)
`Figure` is the fare panel: a tracked-caps label over a 40 sp condensed bold numeral, ink by
default, confirmed green or refusal red by tone. `Amount` is the secondary money line — a
label and a bold body-scale figure on a baseline-aligned row. Both take a **rendered string**
produced by `format()`; neither accepts a number. A `null` value renders a stated absence
("No figure on this tablet.") and `Amount` renders nothing at all.

### Field (text input)
A `stock-sunk` inset closed by a 3 dp underline, no box, 48 dp minimum, title-scale text,
with a tracked-caps label above and `suppressed` placeholder ink. Focus turns the underline
ochre. Three voices: `text` (Roboto, title scale), `figure` (condensed bold, 40 sp, for
tendered cash and declared cash), `mono` (for serials, PINs and credentials). No error
state lives on the field — errors are `Statement` bands, and the control that cannot proceed
states its own reason.

### Statement (notice band)
A wash band with hairlines top and bottom, a tracked-caps tone tag, the sentence in body
copy, optional mono `detail` for the raw diagnostic the office needs, and an optional
`action` — the way out. Four tones: refusal ("Problem", red on red wash), warning ("Check",
**ink** on amber wash), confirmed ("Done", green on green wash), notice (no tag, ink on sunk
stock). Announced as a polite live region. The tag exists so tone is not carried by colour
alone.

### RackHead (top app bar)
See Layout. Title at 26 sp condensed on teal, clamped to one line; subtitle and Back label
in `on-rack-muted`; register right-aligned.

### Register (the staleness disclosure)
A coloured pip (confirmed / amber / refusal for fresh / stale / never) beside a two-line
right-aligned label-scale sentence, living in the masthead so it cannot scroll away. This is
the one place amber appears as a pure signal object rather than a hairline.

### PunchMark (signature component)
A rack slot in exactly the geometry of every other slot — same gutter, same hairlines —
filled confirmed wash, with a 15 dp hole **drawn** (a stock-filled circle with a 2 dp
confirmed ring), never a glyph, sitting in the spine gutter where a selected run's ochre
edge would be. The serial sits at title scale beside the word "Spent". A spent slot and a
selected slot are two states of one object.

## Do's and Don'ts

### Do:
- **Do** give every dead control a `blocked` reason string, and join multiple reasons with
  `missing(...)` so both are named.
- **Do** pass money to `Figure` and `Amount` as a string from `format()` or `fromWire()`,
  and render a stated absence rather than `₱0.00` when there is no figure.
- **Do** set warning copy and the warning tone tag in ink on the amber wash.
- **Do** keep the primary action on the pinned shelf, at 56 dp, with the fare panel directly above it.
- **Do** put a permanently visible text label on every control, including Back.
- **Do** theme `android_ripple` from the rack on every pressable.
- **Do** use the four sizes in sp and let them scale with the system font setting.
- **Do** state sync age in the masthead register on any screen showing a device-local figure.

### Don't:
- **Don't** add a `disabled` prop to `Punch`, `Action` or `Slot`. The absence of one is the rule.
- **Don't** set a sentence, a heading or a tone tag in amber.
- **Don't** spend refusal red or confirmed green on a heading, a rule, a decoration or the peso sign.
- **Don't** put a thick coloured left edge on anything that is not a rack slot.
- **Don't** shape a notice as an outlined rectangle; outlines belong to pressable things.
- **Don't** add a shadow or an elevated card. There are none in this build.
- **Don't** add a FAB — the shelf carries disabled-reason text that a FAB cannot.
- **Don't** add a dark scheme; one light theme is a confirmed product decision for daylight operation.
- **Don't** add a fifth type size, a second accent, or a second animation.
- **Don't** add wood grain, drawn brass, or skeuomorphic perforation. The rack is a layout law.
- **Don't** use an icon in place of a word, and don't draw the punch notch as a glyph.

## Known gaps

Recorded because the system is documented from the shipped artifact, not from the thesis.

1. **The spent slot does not ship.** The thesis claims ranked slots, a live slot, and spent
   ones you can see through; only two of the three states exist. `PunchMark` is the spent
   treatment for a serial, but no screen renders a settled billing period.
2. **Rank does not ship.** Nothing carries a slot's position, so "oldest first" is a caption
   rather than a visible property of the rack.
3. **The amount column is missing on `leases`.** The list is stall / tenant / section with no
   figure. The fixed decimal column is written here as a cross-screen law but currently
   exists on one screen — this is a missing row in the system, not a nice-to-have.
4. **The tablet device class is uninspected.** Every capture is a Huawei JDY-LX2 phone at
   360×806 dp — a useful worst case for overflow, not the shipping class.
5. **`app.json` is unverified on device.** `userInterfaceStyle: "light"` and
   `softwareKeyboardLayoutMode: "resize"` are correct in source but need a Gradle rebuild
   that was not run.
6. **Keyboard-up state and font scale 1.3 were never captured**, including against the
   one-line masthead title and the fixed 48/56 dp targets.
7. **The splash (`#208AEF`) and Android adaptive icon background (`#E6F4FE`) are Expo
   scaffold values**, not rack colours, and are deliberately excluded from the palette above.
8. **`android.predictiveBackGestureEnabled` is `false`.** System Back and the hardware
   button work on the headerless stack; the predictive-back *animation* is not opted into.

**Rasters:** this build ships no generated images, no photographs and no illustrations.
There is nothing to carry provenance. The only bitmaps in the tree are the unreplaced Expo
scaffold icon and splash assets noted above.
