---
name: CEEDO Collections — Back Office
description: A dark enamelled machine chassis holding a pale continuous tape of figures; every screen is a proof.
colors:
  chassis-900: "#16150f"
  chassis-850: "#1c1b15"
  chassis-800: "#23211a"
  chassis-700: "#2e2b22"
  chassis-600: "#3d392e"
  chassis-500: "#56513f"
  chassis-ink: "#f7f4ec"
  chassis-dim: "#a8a295"
  chassis-accent: "#c8b98a"
  tape: "#f7f4ec"
  tape-raised: "#fffdf7"
  tape-sunk: "#efebe0"
  tape-hover: "#f2eee2"
  rule: "#ddd7c7"
  rule-soft: "#e8e3d5"
  rule-strong: "#b9b1a0"
  ink: "#24221e"
  ink-2: "#57524a"
  ink-3: "#6e685d"
  ribbon: "#b5302a"
  ribbon-deep: "#9d2823"
  ribbon-deeper: "#8c231e"
  ribbon-soft: "#f2e2df"
  mark: "#33455c"
  mark-soft: "#e3e8ef"
  amber: "#8a6212"
  amber-soft: "#f6ecd6"
  proof: "#2f5d45"
  proof-soft: "#e2ece6"
  selection: "#d7dce4"
typography:
  display:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 2rem
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.75rem
    letterSpacing: "-0.015em"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.25rem
    letterSpacing: "normal"
  body-small:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1rem
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1rem
    letterSpacing: "0.08em"
  measure:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1rem
    fontFeature: "tabular-nums"
rounded:
  control: "2px"
  docket: "3px"
spacing:
  hair: "4px"
  row-y: "6px"
  gap: "8px"
  cell-x: "12px"
  field-stack: "14px"
  panel-x: "16px"
  band: "20px"
  page-y: "24px"
components:
  button-primary:
    backgroundColor: "{colors.chassis-900}"
    textColor: "{colors.chassis-ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.chassis-700}"
    textColor: "{colors.chassis-ink}"
  button-secondary:
    backgroundColor: "{colors.tape-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.tape-hover}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.tape-sunk}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.ribbon}"
    textColor: "{colors.tape-raised}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.ribbon-deep}"
    textColor: "{colors.tape-raised}"
  button-sm:
    height: "28px"
    padding: "0 10px"
    typography: "{typography.body-small}"
  control-input:
    backgroundColor: "{colors.tape-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "36px"
    typography: "{typography.body}"
  control-input-focus:
    backgroundColor: "{colors.tape-raised}"
    textColor: "{colors.ink}"
  control-input-invalid:
    backgroundColor: "{colors.ribbon-soft}"
    textColor: "{colors.ink}"
  mark-alert:
    backgroundColor: "{colors.ribbon-soft}"
    textColor: "{colors.ribbon}"
    rounded: "{rounded.control}"
    padding: "3px 6px"
    typography: "{typography.label}"
  mark-warn:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    rounded: "{rounded.control}"
    padding: "3px 6px"
  mark-proof:
    backgroundColor: "{colors.proof-soft}"
    textColor: "{colors.proof}"
    rounded: "{rounded.control}"
    padding: "3px 6px"
  mark-office:
    backgroundColor: "{colors.mark-soft}"
    textColor: "{colors.mark}"
    rounded: "{rounded.control}"
    padding: "3px 6px"
  mark-neutral:
    backgroundColor: "{colors.tape-sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "3px 6px"
  panel:
    backgroundColor: "{colors.tape-raised}"
    textColor: "{colors.ink}"
    rounded: "0"
    padding: "14px 16px"
  panel-head:
    backgroundColor: "{colors.tape}"
    textColor: "{colors.ink}"
    padding: "10px 16px"
  dialog-head:
    backgroundColor: "{colors.chassis-900}"
    textColor: "{colors.chassis-ink}"
    padding: "14px 20px"
  dialog-head-danger:
    backgroundColor: "{colors.ribbon}"
    textColor: "{colors.tape-raised}"
    padding: "14px 20px"
  table-row:
    backgroundColor: "{colors.tape-raised}"
    textColor: "{colors.ink}"
    padding: "6px 12px"
    typography: "{typography.body}"
  table-row-hover:
    backgroundColor: "{colors.tape-hover}"
    textColor: "{colors.ink}"
  rail-item:
    backgroundColor: "transparent"
    textColor: "{colors.chassis-dim}"
    rounded: "{rounded.control}"
    padding: "7px 8px 7px 14px"
    typography: "{typography.body}"
  rail-item-active:
    backgroundColor: "{colors.chassis-700}"
    textColor: "{colors.chassis-ink}"
---

# Design System: CEEDO Collections — Back Office

## Overview

**Creative North Star: "Proof Tape"**

The world is the treasury cash-proof ritual: a dark enamelled machine chassis holding a pale
continuous tape of figures. Every screen is a proof — a column of entries, a hairline rule, a
total, and one line that says whether it agrees. The rail is dark because it is the machine's
enamel; the field is pale because it is paper. **This is not a light/dark theme.** There is one
theme, no `prefers-color-scheme` block and no switcher, both user-confirmed in PRODUCT.md; the
two grounds are two materials in one scene, and swapping either breaks the metaphor.

The surface is built for an accounting clerk at an office desktop all day, so density and
scanning speed outrank expression. Composition is made of rules, not cards: rows are ruled,
a total is closed by a hairline above and a double rule below. Colour is the scarce resource —
it lives at edges, in row-gutter bars, in state marks and on the variance line, and never as a
fill behind a figure. Brand lives in precise details: the accountant's close, the letterspaced
small-caps caption, tabular figures that hold their width down a column.

The confirmed anti-reference is skeuomorphic pastiche. A paper-derived world slides there the
moment it reaches for texture, torn edges or drop shadows pretending to be paper. The discipline
is rules, rhythm and reserve. The collector tablet app is also explicitly **not** a visual
reference for this surface.

**Key Characteristics:**
- Two grounds, one theme: chassis charcoal for the machine, tape stock for the field.
- Rules, not cards. No resting surface carries a shadow.
- One corner language: 2px on every control; 3px on the lifted docket, and nowhere else.
- Achromatic figures. Colour only at edges, gutter marks, state marks and the variance line.
- Every state legible with colour removed — strike-through, ink bars, half-density.
- One type family; mono reserved for measurement.
- Motion is state, never decoration, and never on page load.

## Colors

A locked, warm-neutral palette: bitumen-dark enamel against unbleached paper stock, with four
office inks spent sparingly.

### Primary
- **Office Blue-Black** (`#33455c`): the office *acting*. The single focus ring on the tape, the
  caret, the focused control border, the checked indicator in a Radix select, the highlighted
  listbox row (`#e3e8ef`), and the `office` state mark. Never used as decoration or as a brand
  wash.
- **Machine Enamel** (`#16150f` → `#3d392e`): the chassis. The rail, the dialog head, the modal
  scrim (`#16150f` at 55%), the primary button, the tooltip, the filled checkbox. Its own text is
  Chassis Ink (`#f7f4ec`) and Chassis Dim (`#a8a295`), and Dim clears 7:1 at rest on `chassis-900`
  so a resting nav item is never the low-contrast grey dark sidebars default to.
- **Brass Filament** (`#c8b98a`): the machine's only warm mark — the focus ring inside `.on-chassis`
  and the 3px ink bar on the current rail item.

### Secondary
- **Ribbon Red** (`#b5302a`): shortage, void, overdue, and the destructive act. It carries the
  danger button (deepening to `#9d2823` on hover), the danger dialog head, the field-error line,
  the alert mark on its pale wash (`#f2e2df`) and the alert gutter bar. Reserved for acts that
  dispose of cash already taken.
- **Standing Amber** (`#8a6212`): a warning that is true but not yet a failure — a closed shift
  not yet synced, an overage. Wash `#f6ecd6`.
- **Proof Green** (`#2f5d45`): agreement. A balanced shift, a successful notice. Wash `#e2ece6`.

### Neutral
- **Tape Stock** (`#f7f4ec`): the page ground and every recessed band — filter slip, table head,
  totals row, proof line, pager, panel head.
- **Fresh Tape** (`#fffdf7`): the raised sheet — the table body, panels, dialog body, popovers and
  the select listbox. The one step *above* the page.
- **Sunk Tape** (`#efebe0`): the blank a clerk writes in. Every input, select and checkbox rests
  sunk into the tape rather than raised off it.
- **Warmed Tape** (`#f2eee2`): row hover only.
- **Carbon Ink** (`#24221e`): every figure and every primary word.
- **Second Ink** (`#57524a`, 6.8:1 on tape): standing notes, captions, secondary labels.
- **Faint Ink** (`#6e685d`, 4.9:1 on tape): placeholders, muted rows, the em-dash zero, "of"
  comparisons. **The contrast floor.**
- **Rules** (`#ddd7c7` frame, `#e8e3d5` between rows, `#b9b1a0` structural/control borders): the
  composition's whole skeleton.
- **Selection** (`#d7dce4`): the browser's own highlight, restated in the office's ink.

### Named Rules
**The Achromatic Figure Rule.** Colour never fills the ground behind a number. A peso amount is
ink or muted ink, never tinted by its row's status. Colour appears at edges, in the row gutter,
inside a state mark, and on the variance line — nowhere else.

**The Colour-Never-Alone Rule.** No state is signalled by colour alone. Voided is struck through;
a row needing attention carries a solid ink bar in its gutter; the current rail item carries a
3px bar; disabled is half-density. The mark always contains its own word.

**The Ink Floor Rule.** `ink-3` (`#6e685d`, ~4.9:1) is the lightest text permitted on tape. Nothing
lighter is text. On the chassis, `chassis-dim` is the floor and clears 7:1.

**The No Ad-Hoc Grey Rule.** The palette is locked. A grey that is not in the token set does not
exist; reach for a rule, a tape step or an ink step.

## Typography

**Display Font:** IBM Plex Sans (`ui-sans-serif`, `system-ui`, `sans-serif`)
**Body Font:** IBM Plex Sans — the same family, deliberately
**Label/Mono Font:** IBM Plex Mono (`ui-monospace`, `monospace`)

**Character:** Documentary and unglamorous. Plex is chosen for figures that hold their width down
a column, which is the whole job of this app. The type never performs; it measures.

### Hierarchy
- **Display** (600, 1.5rem, -0.015em): the sign-in screen's name, on the chassis. One place.
- **Headline** (600, 1.25rem, -0.015em): the `/no-access` refusal, on the chassis. One place.
- **Title** (600, 1.125rem, 1.25 line-height, -0.015em): the screen heading in the header band.
  It is the largest type any working screen carries.
- **Body** (400, 0.875rem, relaxed leading): table cells, control text, dialog copy. Standing notes
  cap at 68ch.
- **Body Small** (400, 0.75rem): pager counts, help text, secondary cell detail, mono measurements.
- **Label / Caption** (600, 0.6875rem, 0.08em tracking, uppercase): the `.caption` utility —
  every field label, every column header, every rail group heading, every totals label. This is
  the letterspaced small caps a printed form sets its labels in, and it is the single most
  recognisable piece of the type system.
- **Measure** (IBM Plex Mono 400, 0.75rem): OR serials, lease ids, contact numbers, credential
  ids and secrets. The PIN field runs mono at 0.35em tracking.

### Named Rules
**The One Family Rule.** IBM Plex Sans carries headings, labels, controls and data. There is no
display face and no second sans.

**The Mono-Is-Measurement Rule.** Mono is reserved for things that are counted, matched or
transcribed character-by-character — serials, ids, PINs, secrets. Money is *not* mono: it is
Plex Sans with `tabular-nums`. Mono is never used for emphasis, headings or code-flavoured styling.

**The Fixed Scale Rule.** Product UI at a consistent desk DPI. Fixed rem steps only; no fluid
`clamp()` anywhere.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set at base on every `table` and
every `[data-figures]` block, so figures line up on the decimal everywhere rather than only where
someone remembered.

## Layout

A fixed frame. Navigation swaps the tape; the frame never reflows between routes.

- **Chassis rail:** 15rem (`w-60`), sticky full-height, dark, always present at `lg` and above.
  Below `lg` the same chassis becomes a sticky top bar and a 16rem drawer pulled out on demand.
- **Content column:** `px-4 py-6`, widening to `px-6` at `sm` and `px-8 py-7` at `lg`, inside a
  `max-w-[96rem]` centred measure. Wide on purpose: this is a reconciliation surface.
- **Header band:** heading, standing note (max 68ch), right-aligned screen actions, optional aside
  figure, closed by a hairline (`mb-5 pb-4 border-b`).
- **The tape:** filter slip → table head → rows → the close → proof line → pager, each band divided
  by a rule and alternating between fresh tape (rows) and tape (bands).
- **Rhythm:** 4 / 6 / 8 / 12 / 14 / 16 / 20 / 24px. Table cells are `px-3 py-1.5` — the density the
  clerk is owed. Form fields stack at 14px. Panels are `px-4 py-3.5` over a `px-4 py-2.5` head.

### Named Rules
**The Fixed Frame Rule.** Rail, header band, filter slip, tape, proof and pager hold their places
across every route. Only the tape's contents change.

**The Density Rule.** Comfortable spacing that halves the visible rows is a cost paid by the person
who uses this surface most. Row padding does not grow.

## Elevation & Depth

This system is flat. Depth is carried by rules and by three tape steps — sunk (`#efebe0`), page
(`#f7f4ec`), raised (`#fffdf7`) — not by shadows. No resting surface in the app has a shadow: not
a panel, not a table, not the rail, not a button.

Shadows exist only under portalled overlays, where they say "this is temporarily above the page",
and they are soft, diffuse, downward and warm-black. There is no hard-offset shadow anywhere; this
is not a neobrutalist world.

### Shadow Vocabulary
- **Docket** (`box-shadow: 0 18px 44px -12px rgba(22,21,15,0.45)`): the dialog, lifted off the tape
  onto the chassis.
- **Listbox** (`box-shadow: 0 10px 28px -10px rgba(22,21,15,0.35)`): the Radix select's popup.
- **Slip** (`box-shadow: 0 12px 32px -12px rgba(22,21,15,0.38)`): the facet popover.
- **Note** (`box-shadow: 0 8px 22px -8px rgba(22,21,15,0.5)`): the tooltip.

### Named Rules
**The Rules-Not-Cards Rule.** A block is defined by a 1px rule and a tape step. If a surface needs
separating, rule it; do not float it.

**The Overlay-Only Shadow Rule.** A shadow means "portalled above the page". Anything that lives in
the flow gets none.

## Shapes

Rectilinear throughout — a form's boxes, not pills. **2px** is the corner language: buttons of every
variant and size, inputs, selects, textareas, checkboxes, state marks, popovers, listboxes,
tooltips, focus rings, the kbd hint. The one exception is the dialog at **3px**, the sheet lifted
out of the machine. Panels, tables and the rail's containers are square (0px).

Borders are 1px. Structural and control edges take `rule-strong` (`#b9b1a0`); block frames and band
divisions take `rule` (`#ddd7c7`); row separators take `rule-soft` (`#e8e3d5`). Coloured marks take
their own hue at 35–45% opacity so the edge is present without competing with the ink.

### Named Rules
**The One Corner Rule.** 2px everywhere, never varying by variant, state or size. Pills, capsules
and large radii do not exist in this world.

**The Accountant's Close.** A total is closed by a hairline above and a **double rule** below
(`.rule-close`). It is the one load-bearing piece of the world — it is how a proof sheet says
"this column is finished" — and it is painted as two background gradients rather than
`border-bottom: double`, because under `border-collapse: collapse` a double border resolves its
corners against the neighbouring cell and drops a vertical hairline at every column boundary.
Backgrounds do not collapse, so the close paints as one uninterrupted band. **Never** re-implement
the close as a `double` border inside a collapsed table.

## Components

The component layer is **Radix Primitives styled by this project** — not shadcn/ui, not Radix
Themes. The primitives supply focus management, typeahead, portalling and ARIA wiring; every visual
decision is ours. Icons are inline SVG (Lucide components) at 11–18px, `strokeWidth` 1.75–2.25.

### Buttons
- **Shape:** 2px corners (`rounded-[2px]`), 1px border on every variant including ghost (transparent),
  so variants swap colour without shifting layout. Two sizes only: `sm` (28px, 0.75rem) and
  `md` (36px, 0.875rem). Weight 500.
- **Primary:** chassis enamel with chassis ink — the machine acting. Hover lifts to `chassis-700`,
  active settles to `chassis-850`.
- **Secondary (the default):** fresh tape, carbon ink, `rule-strong` edge. Hover warms to
  `tape-hover`, active sinks to `tape-sunk`.
- **Ghost:** transparent on second ink; hover paints `tape-sunk` and darkens the text to full ink.
- **Danger:** ribbon red on fresh tape, reserved for acts that dispose of cash already taken.
- **Hover / Focus:** colour-only transitions at 150ms. Focus is the one global ring
  (2px `mark`, 2px offset, 2px radius), or brass inside `.on-chassis`.
- **Disabled:** 45% opacity and pointer-events removed — half-density, not a colour change.

### Inputs / Fields
- **Style:** one `controlClass` for everything — 36px tall, 2px corners, 1px `rule-strong` edge,
  sunk tape ground, 10px horizontal padding, 0.875rem ink. Inputs are sunk because on a printed
  form the field is the part left blank for you to write in.
- **Focus:** border shifts to office blue-black and the ground rises to fresh tape. Hover darkens the
  border to `ink-3`.
- **Error:** ribbon border over the ribbon wash, plus a bulleted ribbon sentence under the field.
  Never colour alone.
- **Disabled:** 55% opacity, not-allowed cursor.
- **Label:** the `.caption` small caps in second ink, with an "optional" affix set back in normal case.
- **Selects:** the Radix `Select` wherever the value lives in React state; the `NativeSelect` only
  where a plain non-JS `GET` form must post (so the collections filter stays deep-linkable). The
  native control's chevron is drawn from the palette's own ink as a component-layer background image
  — it cannot be a Tailwind arbitrary value, because the data URI contains literal spaces in its
  `viewBox` and the utility form silently emits nothing. `compact` gives the pager's 28px variant.
- **Checkbox:** a 17px square that fills with chassis enamel when set — legible with colour removed.

### Cards / Containers
There are no cards. **Panel** is the one non-table block shape: a square-cornered `rule`-bordered
section on fresh tape, with a tape-ground head carrying a 0.875rem semibold title and an optional
note, and a `px-4 py-3.5` body. **Notice** is the one result-message shape: a 1px bordered
0.75rem paragraph in one of three tones (error / success / warning), with `role="alert"` on error
and `role="status"` otherwise.

### Marks
- **Style:** a ruled box, 2px corners, 0.6875rem semibold uppercase at 0.06em, holding **its own
  word** — the world's substitute for the coloured pill. Five tones: neutral, alert, warn, proof,
  office.
- **QuietMark:** a state that needs no box at all ("Posted", "Closed", "Open") — 0.75rem faint ink.
  Most states are quiet; the box is for the ones that are not.

### Navigation
- **Style:** the chassis rail. Wordmark over a `.caption` sub-line, `.caption` group headings at 75%
  dim, 0.875rem items at 7px vertical padding.
- **States:** resting items are chassis-dim; hover paints `chassis-800` and raises the text to chassis
  ink; the current item takes a `chassis-700` ground, medium weight **and** a 3px brass bar at its
  left edge, with `aria-current="page"`.
- **Mobile:** the same chassis as a sticky bar plus a Radix Dialog drawer that slides in from the
  left; tapping an item dismisses it.
- **Header band:** heading, standing note, actions. **No kicker or eyebrow above the heading** — the
  heading carries its own weight.

### Dialogs
A docket lifted off the tape and laid on the chassis. Fresh-tape body at 3px corners with a
`chassis-600` edge and the Docket shadow, over a `chassis-900` scrim at 55%. The head sits on the
chassis — that colour break is what says the sheet was pulled out of the machine — and turns ribbon
red for `tone="danger"`. Three widths (22 / 30 / 44rem), a scrolling body, and a tape-ground footer
rule for actions. Every dialog carries a description, because every dialog here disposes of
something. Initial focus is moved off Radix's first tabbable node (the close button) onto the first
real field, falling back to Radix's own behaviour when there is no field.

### The Running Proof (signature)
`DataTable` is the app's signature component and the reason the world exists.

- **The contract:** a `DataColumn` declares `render`, and separately `sortValue`, `searchValue`,
  `total` and `facet`. They are separate projections on purpose: `render` returns a node so a money
  cell can go through `<Money>`, and **a table cannot sort, search or sum what it can only render**.
  `total` is integer centavos and its presence is what marks a column as summed.
- **The slip:** a filter input (with a `/` kbd hint), one facet popover per faceted column, a
  narrowed count, and a Clear. Facets with fewer than two distinct values do not render.
- **The tape:** `.caption` column heads on tape ground over a `rule-strong` edge, rows on fresh tape
  separated by `rule-soft`, hover at `tape-hover`, right-aligned columns tabular. An optional 4px
  gutter cell carries the row's solid ink bar.
- **The close:** a `.rule-close` totals row showing the in-view sum, and beneath it in 0.6875rem
  faint ink the unfiltered total ("of ₱…") whenever a filter is on. A zero total renders as an
  em dash. Below `lg` the same close renders as a definition list, because a totals row inside a
  horizontally scrolling table is unreadable.
- **The proof line:** the sentence the screen exists to say — void total excluded on Collections,
  net variance with short/over counts on Shifts, the §11.3 three-day count on Exceptions.
- **The pager:** range, total, a compact rows-per-page select (25/50/100/250) and prev/next.
- **Filtering is client-side**, which is correct here: PRODUCT.md records hundreds of rows in the
  largest tables, so server-side pagination would be plumbing against a problem this deployment does
  not have.
- **View state is URL-synced** via `history.replaceState` — query, sort, direction, page, size and
  facets, namespaced by `urlKey`. Read once at mount so a shared link renders already filtered
  rather than flashing the unfiltered table; written back without a router round-trip, because a
  filter is a view of rows already in the browser.
- **Empty is not denied.** A genuinely empty source renders the page's own explanatory copy; a
  filter that matches nothing says so and offers to clear itself. These are different sentences.

### Money
Right-aligned, tabular, achromatic. Zero renders as an em dash — in an aging table an empty bucket
and a zero bucket mean the same thing, and a column of "₱0.00" hides the figures that matter. A
void or settled row is muted and struck through, never recoloured.

### Motion
120–190ms, exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) or plain `ease-out`, always from
an already-visible default. `fade-in` 120–150ms for overlays, listboxes, popovers and tooltips;
`docket-in` 180ms for the dialog (10px rise, 0.985 → 1); `rail-in` 190ms for the mobile drawer;
colour transitions at 150ms, row hover at 100ms. A `prefers-reduced-motion` block collapses every
animation and transition to 0.01ms.

The single authored moment is **`retally`**: the totals row washes through `mark-soft` for 180ms
when the filtered set actually changes. It is keyed to a tally counter incremented only by a filter,
facet or clear action, so it never fires on mount.

### Named Rules
**The No-Entrance Rule.** Nothing choreographs a page load. The clerk is mid-task, not watching an
entrance.

**The One Authored Moment Rule.** `retally` is the only place in the app where motion draws the eye
on purpose. Everything else is a state change arriving.

## Do's and Don'ts

### Do:
- **Do** treat the chassis/tape split as two materials in one scene: dark is the machine (rail,
  dialog head, scrim, primary button, tooltip), pale is the paper the figures are read off.
- **Do** close every summed column with `.rule-close` — hairline above, double rule below.
- **Do** keep the figure field achromatic; spend colour on edges, gutter bars, state marks and the
  variance line.
- **Do** give every state a non-colour carrier: strike-through, an ink bar, a word inside the mark,
  half-density.
- **Do** use 2px corners on every control and 3px only on the dialog.
- **Do** set every label, column head and totals label in the `.caption` small caps.
- **Do** reserve IBM Plex Mono for serials, ids, PINs and secrets; money stays Plex Sans with
  tabular figures.
- **Do** build blocks from `Panel`, `Notice`, `Mark` and `DataTable` rather than new one-off shapes.
- **Do** keep every screen keyboard-complete: the global `/` focuses the filter, Radix handles focus
  trapping and restore, dialogs land on the first real field, sortable heads are buttons carrying
  `aria-sort`, and icon-only controls carry `aria-label`.
- **Do** declare `sortValue` / `searchValue` / `total` / `facet` explicitly on a column instead of
  parsing what `render` produced.
- **Do** keep `ink-3` as the lightest text on tape and `chassis-dim` as the lightest on chassis.

### Don't:
- **Don't** add a theme switcher, a `prefers-color-scheme` block or a dark variant of the tape.
  One theme, user-confirmed.
- **Don't** put a shadow on anything that lives in the flow. Shadows belong to portalled overlays
  only, and never as a hard offset.
- **Don't** reach for a card, a rounded panel or a coloured pill; rule it instead.
- **Don't** fill a ground behind a number with colour, or tint a peso amount by its row's status.
- **Don't** signal anything with colour alone.
- **Don't** implement the accountant's close as `border-bottom: double` inside a
  `border-collapse: collapse` table — it drops vertical seams at every column boundary.
- **Don't** put a kicker, eyebrow or overline above a screen heading.
- **Don't** introduce a grey, a radius or a type size that is not in the token set, and don't use
  fluid `clamp()` sizing.
- **Don't** choreograph a page load, or animate anything from an invisible default.
- **Don't** add a second type family, or use mono for emphasis, headings or "code" styling.
- **Don't** add texture, torn edges, rules that pretend to be perforations, or any other
  skeuomorphic paper effect.
- **Don't** let a denied read and an empty table look the same.
