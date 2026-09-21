---
name: CEEDO Collections — Back Office
description: A navy machine chassis holding a pale continuous field of figures; every screen is a proof.
colors:
  chassis-900: "#0d1b2d"
  chassis-850: "#102134"
  chassis-800: "#14263a"
  chassis-700: "#1b2a3c"
  chassis-600: "#202f42"
  chassis-500: "#2b3c50"
  chassis-ink: "#eceff2"
  chassis-dim: "#d9dfe5"
  chassis-accent: "#daa24f"
  tape: "#f7f8fa"
  tape-raised: "#ffffff"
  tape-sunk: "#ebeff4"
  tape-hover: "#f1f4f8"
  rule: "#d9dfe5"
  rule-soft: "#e6eaef"
  rule-strong: "#c3ccd6"
  ink: "#0c121a"
  ink-2: "#3d4653"
  ink-3: "#5c646f"
  primary: "#1b3b63"
  primary-foreground: "#f7f8fa"
  ring: "#2b568b"
  ribbon: "#c20d23"
  ribbon-deep: "#a90b1e"
  ribbon-deeper: "#920919"
  ribbon-soft: "#fdeaec"
  mark: "#1b3b63"
  mark-soft: "#e4ebf3"
  amber: "#8a5a0b"
  amber-soft: "#fdf1dd"
  proof: "#0b6b45"
  proof-soft: "#e3f2ea"
  selection: "#d8e2f0"
typography:
  display:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.75rem
    letterSpacing: "-0.015em"
  title:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.25rem
    letterSpacing: "normal"
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
  rail-label:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1rem
    letterSpacing: "0.12em"
  measure:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1rem
    fontFeature: "tabular-nums"
rounded:
  sm: "0.3rem"
  md: "0.4rem"
  lg: "0.5rem"
  xl: "0.7rem"
  "2xl": "0.9rem"
  "3xl": "1.1rem"
  "4xl": "1.3rem"
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
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.ring}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.tape-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.tape-hover}"
    textColor: "{colors.ink}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.tape-sunk}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.ribbon}"
    textColor: "{colors.tape-raised}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-danger-hover:
    backgroundColor: "{colors.ribbon-deep}"
    textColor: "{colors.tape-raised}"
  button-sm:
    height: "28px"
    padding: "0 8px"
    typography: "{typography.body-small}"
  control-input:
    backgroundColor: "{colors.tape-sunk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
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
    rounded: "{rounded.4xl}"
    padding: "0 8px"
    height: "20px"
    typography: "{typography.label}"
  mark-warn:
    backgroundColor: "{colors.amber-soft}"
    textColor: "{colors.amber}"
    rounded: "{rounded.4xl}"
    padding: "0 8px"
    height: "20px"
  mark-proof:
    backgroundColor: "{colors.proof-soft}"
    textColor: "{colors.proof}"
    rounded: "{rounded.4xl}"
    padding: "0 8px"
    height: "20px"
  mark-office:
    backgroundColor: "{colors.mark-soft}"
    textColor: "{colors.mark}"
    rounded: "{rounded.4xl}"
    padding: "0 8px"
    height: "20px"
  mark-neutral:
    backgroundColor: "{colors.tape-sunk}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.4xl}"
    padding: "0 8px"
    height: "20px"
  panel:
    backgroundColor: "{colors.tape-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
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
    rounded: "{rounded.md}"
    padding: "8px"
    height: "32px"
    typography: "{typography.body}"
  rail-item-active:
    backgroundColor: "{colors.chassis-700}"
    textColor: "{colors.chassis-ink}"
  rail-brand-tile:
    backgroundColor: "{colors.chassis-accent}"
    textColor: "{colors.chassis-900}"
    rounded: "{rounded.lg}"
    size: "36px"
---

# Design System: CEEDO Collections — Back Office

## Overview

**Creative North Star: "Proof Tape"**

The world is the treasury cash-proof ritual: a dark chassis holding a pale continuous field of
figures. Every screen is a proof — a column of entries, a hairline rule, a total, and one line
that says whether it agrees. The rail is dark because it is the machine; the field is pale
because it is read all day at an office desk. **This is not a light/dark theme.** There is one
theme, no `prefers-color-scheme` block and no switcher, both user-confirmed in PRODUCT.md; the
two grounds are two materials in one scene, and swapping either breaks the metaphor.

The **material** is CEEDO's sibling app, `berlcamp/hris`: a navy sidebar on an off-white page,
white panels, a hairline `#d9dfe5` rule, navy for the office acting, brass spent twice, and a
multiplicative corner ramp instead of a single rectilinear step. The warm carbon-and-paper
palette this world was first built in was translated into that one, on the user's instruction,
so the two apps read as the same office. **Topology, control vocabulary, state vocabulary, the
colour-reserve discipline, motion and the running proof are unchanged; only the tones and the
corners moved.**

The surface is built for an accounting clerk at an office desktop all day, so density and
scanning speed outrank expression. Composition is still made of rules: rows are ruled, a total
is closed by a hairline above and a double rule below. Colour is the scarce resource — it lives
at edges, in row-gutter bars, in state marks and on the variance line, and never as a fill
behind a figure. The confirmed anti-reference is skeuomorphic pastiche: no texture, no torn
edges, no shadow pretending to be paper. The collector tablet app is also explicitly **not** a
visual reference for this surface.

**Key Characteristics:**
- Two grounds, one theme: navy chassis for the machine, off-white field for the figures.
- Rules and hairline frames, not shadows. No resting surface carries a shadow.
- One multiplicative radius ramp (0.3rem → 1.3rem), applied by role, not by whim.
- Achromatic figures. Colour only at edges, gutter marks, state marks and the variance line.
- Every state legible with colour removed — strike-through, ink bars, weight, half-density.
- One type family; mono reserved for measurement.
- Brass appears exactly twice on the chassis and nowhere else.
- Motion is state, never decoration, and never on page load.
- An empty screen teaches: it says what a record here *is* and what depends on it.

## Colors

A cool, institutional palette: navy enamel against off-white stock, with four office inks spent
sparingly and one warm metal.

### Primary
- **Office Navy** (`#1b3b63`): the office *acting*. It is both `mark` and `primary` — the same
  value serving the primary button, the focus ring on the field, the caret, the focused control
  border, the Radix select's check indicator, the highlighted listbox row (`#e4ebf3`), the
  facet chip, and the `office` state mark. **Never** used as decoration or a brand wash. Its
  lighter partner `ring` (`#2b568b`) is available for ring/hover work.
- **Machine Navy** (`#0d1b2d` → `#2b3c50`): the chassis. The rail, the dialog head, the modal
  scrim (`#0d1b2d` at 55–60%), the tooltip, the filled checkbox. Its text is Chassis Ink
  (`#eceff2`) and Chassis Dim (`#d9dfe5`), and Dim measures **≈12.9:1** at rest on
  `chassis-900` — a resting nav item is never the low-contrast grey dark sidebars default to.
- **Brass** (`#daa24f`): the machine's only warm metal, and deliberately scarce — the 36px
  brand tile, the user initials chip, and the focus ring inside `.on-chassis`. **Three uses,
  no more.** Brass is an ornament in this system, never a verb: the primary button is navy.

### Secondary
- **Ribbon Red** (`#c20d23`): shortage, void, overdue, and the destructive act. It carries the
  danger button (deepening through `#a90b1e` to `#920919`), the danger dialog head, the
  field-error line, the alert mark on its wash (`#fdeaec`) and the alert gutter bar. Reserved
  for acts that dispose of cash already taken.
- **Standing Amber** (`#8a5a0b`): a warning that is true but not yet a failure — a closed shift
  not yet synced, an overage. Wash `#fdf1dd`.
- **Proof Green** (`#0b6b45`): agreement. A balanced shift, a successful notice. Wash `#e3f2ea`.

### Neutral
- **Field** (`#f7f8fa`): the page ground and every recessed band — filter slip, table head,
  totals row, proof line, pager, panel head, dialog footer.
- **Sheet** (`#ffffff`): the raised surface — the table body, panels, dialog body, popovers and
  the select listbox. The one step *above* the page.
- **Sunk Field** (`#ebeff4`): the blank a clerk writes in. Every input, select and checkbox
  rests sunk into the field rather than raised off it.
- **Warmed Field** (`#f1f4f8`): row hover only.
- **Carbon Ink** (`#0c121a`): every figure and every primary word.
- **Second Ink** (`#3d4653`, ≈9:1 on the field): standing notes, captions, secondary labels.
- **Faint Ink** (`#5c646f`, ≈5.6:1 on the field): placeholders, muted rows, the em-dash zero,
  "of" comparisons, the screen header's note. **The contrast floor.**
- **Rules** (`#d9dfe5` frame and band divisions, `#e6eaef` between rows, `#c3ccd6` structural
  and control borders): the composition's whole skeleton.
- **Selection** (`#d8e2f0`): the browser's own highlight, restated in the office's ink.

### Named Rules
**The Achromatic Figure Rule.** Colour never fills the ground behind a number. A peso amount is
ink or muted ink, never tinted by its row's status. Colour appears at edges, in the row gutter,
inside a state mark, and on the variance line — nowhere else.

**The Colour-Never-Alone Rule.** No state is signalled by colour alone. Voided is struck through;
a row needing attention carries a solid ink bar in its gutter; the current rail item is set in
medium weight on the same ground its hover uses; disabled is half-density. The mark always
contains its own word.

**The Ink Floor Rule.** `ink-3` (`#5c646f`, ≈5.6:1) is the lightest text permitted on the field.
Nothing lighter is text. On the chassis, `chassis-dim` (`#d9dfe5`, ≈12.9:1) is the floor.

**The Brass-Is-Ornament Rule.** Brass marks the machine's identity — brand tile, user chip,
chassis focus ring — and never carries an action. A brass button does not exist here.

**The No Ad-Hoc Grey Rule.** The palette is locked. A grey that is not in the token set does not
exist; reach for a rule, a field step or an ink step.

## Typography

**Display Font:** IBM Plex Sans (`ui-sans-serif`, `system-ui`, `sans-serif`)
**Body Font:** IBM Plex Sans — the same family, deliberately
**Label/Mono Font:** IBM Plex Mono (`ui-monospace`, `monospace`)

**Character:** Documentary and unglamorous. Plex is chosen for figures that hold their width down
a column, which is the whole job of this app. The type never performs; it measures.

Typography did **not** move with the material. The sibling app runs DM Sans; that swap was
considered and deliberately not made, because Plex's tabular figures are load-bearing here in a
way they are not there. Treat the family as an **open decision for the user**, not as drift.

### Hierarchy
- **Display** (700, 1.5rem, tight leading, -0.025em): the screen heading in the header band, and
  the sign-in screen's name on the chassis. It is the largest type any working screen carries.
- **Headline** (600, 1.25rem, -0.015em): the `/no-access` refusal, on the chassis. One place.
- **Title** (600, 0.875rem): panel heads and dialog titles — a block's name, not a page's.
- **Body** (400, 0.875rem, relaxed leading): table cells, control text, dialog copy, nav items.
  Standing notes cap at 68ch.
- **Body Small** (400, 0.75rem): pager counts, help text, secondary cell detail, quiet marks.
- **Label / Caption** (600, 0.6875rem, 0.08em tracking, uppercase): the `.caption` utility —
  every field label, every column header, every totals label. This is the letterspaced small caps
  a printed form sets its labels in, and it remains the most recognisable piece of the type
  system.
- **Rail Label** (600, 0.6875rem, **0.12em** tracking, uppercase): the chassis's own small caps —
  group headings at 40% dim, the wordmark's subtitle and the user's role at 50% dim. Wider
  tracking than `.caption` on purpose: the rail is read at a glance, not scanned.
- **Measure** (IBM Plex Mono 400, 0.75rem): OR serials, lease ids, contact numbers, credential
  ids and secrets. The PIN field runs mono at 0.35em tracking.

### Named Rules
**The One Family Rule.** IBM Plex Sans carries headings, labels, controls and data. There is no
display face and no second sans.

**The Mono-Is-Measurement Rule.** Mono is reserved for things that are counted, matched or
transcribed character-by-character — serials, ids, PINs, secrets. Money is *not* mono: it is
Plex Sans with `tabular-nums`. Mono is never used for emphasis, headings or code-flavoured
styling.

**The Fixed Scale Rule.** Product UI at a consistent desk DPI. Fixed rem steps only; no fluid
`clamp()` anywhere.

**The Tabular Rule.** `font-variant-numeric: tabular-nums` is set at base on every `table` and
every `[data-figures]` block, so figures line up on the decimal everywhere rather than only where
someone remembered.

## Layout

A fixed frame. Navigation swaps the field; the frame never reflows between routes.

- **Chassis rail:** **16rem** (`w-64`), sticky full-height, navy, always present at `lg` and
  above, and carrying **no right border** — the value step between navy and the off-white page
  *is* the separation. Below `lg` the same chassis becomes a 56px sticky top bar and an 18rem
  drawer pulled out on demand.
- **Content column:** `px-4 py-6`, widening to `px-6` at `sm` and `px-8 py-7` at `lg`, inside a
  `max-w-[96rem]` centred measure. Wide on purpose: this is a reconciliation surface.
- **Header band:** 1.5rem bold heading, a muted note beneath it (max 68ch, `ink-3`),
  right-aligned screen actions, optional aside figure, `mb-6`. **No divider rule** — the gap and
  the framed block below it are the separation.
- **The tape:** filter slip → table head → rows → the close → proof line → pager, all inside one
  `rounded-xl` hairline-framed white block, each band divided by a rule and alternating between
  white (rows) and field (bands).
- **Rhythm:** 4 / 6 / 8 / 12 / 14 / 16 / 20 / 24px. Table cells are `px-3 py-1.5` — the density
  the clerk is owed. Form fields stack at 14px. Panels are `px-4 py-3.5` over a `px-4 py-2.5`
  head. Rail rows are 32px tall at 8px padding.

### Named Rules
**The Fixed Frame Rule.** Rail, header band, filter slip, tape, proof and pager hold their places
across every route. Only the tape's contents change.

**The Density Rule.** Comfortable spacing that halves the visible rows is a cost paid by the
person who uses this surface most. Row padding does not grow.

**The Value-Step Rule.** The rail needs no border. Where two grounds differ enough in value, the
step is the edge; adding a rule there only thickens the machine.

## Elevation & Depth

This system is flat. Depth is carried by hairline frames and by three field steps — sunk
(`#ebeff4`), page (`#f7f8fa`), sheet (`#ffffff`) — not by shadows. No resting surface in the app
has a shadow: not a panel, not a table, not the rail, not a button.

Shadows exist only under portalled overlays, where they say "this is temporarily above the page",
and they are soft, diffuse and downward. There is no hard-offset shadow anywhere; this is not a
neobrutalist world.

### Shadow Vocabulary
- **Docket** (`box-shadow: 0 18px 44px -12px rgba(12,18,26,0.45)`): the dialog, lifted off the
  field onto the chassis.
- **Listbox** (`box-shadow: 0 10px 28px -10px rgba(12,18,26,0.35)`): the Radix select's popup.
- **Slip** (`box-shadow: 0 12px 32px -12px rgba(12,18,26,0.38)`): the facet popover.
- **Note** (`box-shadow: 0 8px 22px -8px rgba(12,18,26,0.5)`): the tooltip.

These four still carry the warm carbon black the palette was translated *away* from. They are
recorded as shipped; a cool-neutral restatement is unreconciled, not a rule.

### Named Rules
**The Frame-Not-Float Rule.** A block is defined by a 1px rule, a radius and a ground step. If a
surface needs separating, frame it; do not float it.

**The Overlay-Only Shadow Rule.** A shadow means "portalled above the page". Anything that lives
in the flow gets none, and never as a hard offset.

## Shapes

One **multiplicative radius ramp**, rooted at 0.5rem and matching the sibling app rather than
Tailwind's additive default: `sm` 0.3rem, `md` 0.4rem, `lg` 0.5rem, `xl` 0.7rem, `2xl` 0.9rem,
`3xl` 1.1rem, `4xl` 1.3rem. The ramp is applied **by role**, and the roles are fixed:

- **`sm`** — the 17px checkbox.
- **`md`** — nav rows, the global focus ring, icon-only controls, listbox items, facet rows,
  sortable column heads, the kbd hint.
- **`lg`** — every button, every form control, the brand tile and initials chip, popovers, the
  select listbox, the facet chip.
- **`xl`** — the framed blocks: panels, the DataTable, the filter slip card, the dialog.
- **`4xl`** — state marks only, as a true 20px pill.

Borders are 1px. Structural and control edges take `rule-strong` (`#c3ccd6`); block frames and
band divisions take `rule` (`#d9dfe5`); row separators take `rule-soft` (`#e6eaef`). Coloured
marks take their own hue at 35–45% opacity so the edge is present without competing with the ink.

### Named Rules
**The Role-Not-Whim Rule.** A radius is chosen by what the element *is*, not by how it looks in
isolation: control → `lg`, framed block → `xl`, state mark → `4xl`. A sixth radius on a seventh
kind of element is drift.

**The Accountant's Close.** A total is closed by a hairline above and a **double rule** below
(`.rule-close`). It is the one load-bearing piece of the world — it is how a proof sheet says
"this column is finished" — and it is painted as two background gradients rather than
`border-bottom: double`, because under `border-collapse: collapse` a double border resolves its
corners against the neighbouring cell and drops a vertical hairline at every column boundary.
Backgrounds do not collapse, so the close paints as one uninterrupted band. **Never**
re-implement the close as a `double` border inside a collapsed table.

## Components

The component layer is **Radix Primitives styled by this project** — not shadcn/ui, not Radix
Themes. The primitives supply focus management, typeahead, portalling and ARIA wiring; every
visual decision is ours. Icons are Lucide SVG components at 11–18px, `strokeWidth` 1.75–2.25.

### Buttons
- **Shape:** `lg` corners (0.5rem), 1px border on every variant including ghost (transparent),
  so variants swap colour without shifting layout. Two sizes only: `sm` (28px, 0.75rem) and
  `md` (32px, 0.875rem), both at 8–10px horizontal padding. Weight 500.
- **Primary:** Office Navy on `primary-foreground`, hovering to 90% and settling at 95%. Navy,
  never brass.
- **Secondary (the default):** white sheet, carbon ink, `rule-strong` edge. Hover warms to
  `tape-hover`, active sinks to `tape-sunk`.
- **Ghost:** transparent on second ink; hover paints `tape-sunk` and darkens the text to full
  ink.
- **Danger:** ribbon red, reserved for acts that dispose of cash already taken.
- **Hover / Focus:** colour-only transitions at 150ms. Focus is the one global ring (2px `mark`,
  2px offset, `md` radius), or brass inside `.on-chassis`.
- **Disabled:** 45% opacity and pointer-events removed — half-density, not a colour change.

### Inputs / Fields
- **Style:** one `controlClass` for everything — 36px tall, `lg` corners, 1px `rule-strong` edge,
  sunk ground, 10px horizontal padding, 0.875rem ink. Inputs are sunk because on a printed form
  the field is the part left blank for you to write in.
- **Focus:** border shifts to Office Navy and the ground rises to white. Hover darkens the border
  to `ink-3`.
- **Error:** ribbon border over the ribbon wash, plus a bulleted ribbon sentence under the field.
  Never colour alone.
- **Disabled:** 55% opacity, not-allowed cursor.
- **Label:** the `.caption` small caps in second ink, with an "optional" affix set back in normal
  case.
- **Selects:** the Radix `Select` wherever the value lives in React state; the `NativeSelect` only
  where a plain non-JS `GET` form must post (so the collections filter stays deep-linkable). The
  native control's chevron is drawn as a component-layer background image — it cannot be a
  Tailwind arbitrary value, because the data URI contains literal spaces in its `viewBox` and the
  utility form silently emits nothing. `compact` gives the pager's 28px variant.
- **Dates** use the native `type="date"` control deliberately: it submits ISO, and its display
  order is the OS locale's. That trade is an open question for the user, not a defect.
- **Checkbox:** a 17px `sm`-cornered square that fills with `chassis-900` when set — legible with
  colour removed.

### Cards / Containers
There are no cards in the decorative sense; there is one framed block. **Panel** is the
non-table block shape: `rounded-xl overflow-hidden border border-rule` on white, with a
field-ground head carrying a 0.875rem semibold title and an optional note, over a `px-4 py-3.5`
body. **Notice** is the one result-message shape: a 1px bordered 0.75rem paragraph at `lg` in one of
three tones (error / success / warning), with `role="alert"` on error and `role="status"`
otherwise.

### Marks
- **Style:** a 20px **pill** (`4xl`) with a 1px coloured edge, 0.6875rem semibold uppercase at
  0.06em, holding **its own word**. Five tones: neutral, alert, warn, proof, office. The pill
  shape came with the sibling material; the word inside it is what keeps the
  Colour-Never-Alone Rule true.
- **QuietMark:** a state that needs no box at all ("Posted", "Closed", "Open") — 0.75rem faint
  ink. Most states are quiet; the pill is for the ones that are not.

### Navigation
- **Style:** the 16rem navy chassis rail, no right border. A 56px header holds a 36px brass
  `lg`-cornered tile with a Landmark glyph, a 14px bold tracking-tight wordmark and a 10px
  uppercase 0.12em subtitle at 50% dim, closed by a 1px `chassis-600` divider. Group headings are
  0.6875rem semibold uppercase at 0.12em and 40% dim. Items are flush 32px rows at `md` corners,
  8px padding, 8px gap, with a 16px Lucide glyph.
- **States:** resting items are `chassis-dim`; **hover and current share the `chassis-700`
  ground, and weight is the separator** (`font-medium` + `chassis-ink` + `aria-current="page"`).
  The current screen is identifiable with colour removed.
- **Footer:** a 32px brass initials chip with the staff name and role, above a `chassis-600`
  divider.
- **Icon indirection:** the rail's nav data is assembled in a Server Component from the resource
  registry, and a React component cannot cross the RSC boundary — so the layout passes a string
  and `components/shell/nav-icons.tsx` maps it back to a glyph on the client. One library, one
  16px size, one stroke.
- **Mobile:** the same chassis as a 56px sticky bar plus a Radix Dialog drawer that slides in
  from the left; tapping an item dismisses it.
- **Header band:** heading, standing note, actions. **No kicker or eyebrow above the heading** —
  the heading carries its own weight.

### Dialogs
A docket lifted off the field and laid on the chassis. White body at `xl` corners with a
`chassis-600` edge and the Docket shadow, over a `chassis-900` scrim at 55%. The head sits on the
chassis — that colour break is what says the sheet was pulled out of the machine — and turns
ribbon red for `tone="danger"`. Three widths (22 / 30 / 44rem), a scrolling body, and a
field-ground footer for actions. Every dialog carries a description, because every dialog here
disposes of something. Initial focus is moved off Radix's first tabbable node (the close button)
onto the first real field, falling back to Radix's own behaviour when there is no field.

### The Running Proof (signature)
`DataTable` is the app's signature component and the reason the world exists. It renders as one
`rounded-xl` hairline-framed white block with every band clipped inside it.

- **The contract:** a `DataColumn` declares `render`, and separately `sortValue`, `searchValue`,
  `total` and `facet`. They are separate projections on purpose: `render` returns a node so a
  money cell can go through `<Money>`, and **a table cannot sort, search or sum what it can only
  render**. `total` is integer centavos and its presence is what marks a column as summed.
- **The slip:** a filter input (with a `/` kbd hint), one facet popover per faceted column, a
  narrowed count, and a Clear. Facets with fewer than two distinct values do not render.
- **The tape:** `.caption` column heads on field ground over a `rule-strong` edge, rows on white
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
  largest tables, so server-side pagination would be plumbing against a problem this deployment
  does not have.
- **View state is URL-synced** via `history.replaceState` — query, sort, direction, page, size and
  facets, namespaced by `urlKey`. Read once at mount so a shared link renders already filtered
  rather than flashing the unfiltered table.
- **Empty is not denied**, and it is not silent either (see below).

### Empty States
`empty` is a **required** field, both on `DataTable` and on every `ResourceConfig` in the admin
registry — there is nowhere to get a table without writing one. An optional `emptyAction` renders
the control that resolves the emptiness directly inside the state.

- **Say what the record IS and what depends on it.** "No sections yet. A section divides a market
  into its trades — Fish, Meat, Vegetable, Dry goods — and sets the billing period its stalls
  inherit. A market facility has to exist before a section can belong to one."
- **Offer the control where one exists**, centred under the copy.
- **An empty source and an empty filter are different sentences.** A filter that matches nothing
  says so and offers to clear itself; it never borrows the page's teaching copy.
- **Presentation:** centred, `max-w-prose`, `px-6 py-14`, 0.875rem `ink-2`, inside the same
  framed block the table would have filled.

### Money
Right-aligned, tabular, achromatic. Zero renders as an em dash — in an aging table an empty
bucket and a zero bucket mean the same thing, and a column of "₱0.00" hides the figures that
matter. A void or settled row is muted and struck through, never recoloured.

### Motion
120–190ms, exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) or plain `ease-out`, always
from an already-visible default. `fade-in` 120–150ms for overlays, listboxes, popovers and
tooltips; `docket-in` 180ms for the dialog (10px rise, 0.985 → 1); `rail-in` 190ms for the mobile
drawer; colour transitions at 150ms, row hover at 100ms. A `prefers-reduced-motion` block
collapses every animation and transition to 0.01ms.

The single authored moment is **`retally`**: the totals row washes through `mark-soft` for 180ms
when the filtered set actually changes. It is keyed to a tally counter incremented only by a
filter, facet or clear action, so it never fires on mount.

### Named Rules
**The No-Entrance Rule.** Nothing choreographs a page load. The clerk is mid-task, not watching
an entrance.

**The One Authored Moment Rule.** `retally` is the only place in the app where motion draws the
eye on purpose. Everything else is a state change arriving.

## Do's and Don'ts

### Do:
- **Do** treat the chassis/field split as two materials in one scene: navy is the machine (rail,
  dialog head, scrim, tooltip, checkbox fill), off-white is the paper the figures are read off.
- **Do** close every summed column with `.rule-close` — hairline above, double rule below.
- **Do** keep the figure field achromatic; spend colour on edges, gutter bars, state marks and
  the variance line.
- **Do** give every state a non-colour carrier: strike-through, an ink bar, weight, a word inside
  the mark, half-density.
- **Do** pick a radius by role — `lg` for controls, `xl` for framed blocks, `4xl` for marks,
  `md` for nav rows and focus rings, `sm` for the checkbox.
- **Do** keep primary actions navy and brass ornamental: brand tile, user chip, chassis focus
  ring, and nothing else.
- **Do** set every field label, column head and totals label in the `.caption` small caps, and
  every chassis label at 0.12em.
- **Do** reserve IBM Plex Mono for serials, ids, PINs and secrets; money stays Plex Sans with
  tabular figures.
- **Do** write an `empty` that says what the record is and what depends on it, and pass an
  `emptyAction` whenever a control can resolve it.
- **Do** build blocks from `Panel`, `Notice`, `Mark` and `DataTable` rather than new one-off
  shapes.
- **Do** keep every screen keyboard-complete: the global `/` focuses the filter, Radix handles
  focus trapping and restore, dialogs land on the first real field, sortable heads are buttons
  carrying `aria-sort`, and icon-only controls carry `aria-label`.
- **Do** declare `sortValue` / `searchValue` / `total` / `facet` explicitly on a column instead of
  parsing what `render` produced.
- **Do** keep `ink-3` as the lightest text on the field and `chassis-dim` as the lightest on the
  chassis.

### Don't:
- **Don't** add a theme switcher, a `prefers-color-scheme` block or a dark variant of the field.
  One theme, user-confirmed.
- **Don't** put a shadow on anything that lives in the flow. Shadows belong to portalled overlays
  only, and never as a hard offset.
- **Don't** fill a ground behind a number with colour, or tint a peso amount by its row's status.
- **Don't** signal anything with colour alone.
- **Don't** put brass on a button, a link or any other action.
- **Don't** add a right border to the rail, or a divider rule under the screen heading — the
  value step and the gap are the separation.
- **Don't** implement the accountant's close as `border-bottom: double` inside a
  `border-collapse: collapse` table — it drops vertical seams at every column boundary.
- **Don't** put a kicker, eyebrow or overline above a screen heading.
- **Don't** introduce a grey, a radius step or a type size that is not in the token set, and don't
  use fluid `clamp()` sizing.
- **Don't** ship a table or a resource without `empty` copy, and don't let "Nothing here yet."
  stand in for it.
- **Don't** choreograph a page load, or animate anything from an invisible default.
- **Don't** add a second type family, or use mono for emphasis, headings or "code" styling.
- **Don't** add texture, torn edges, rules that pretend to be perforations, or any other
  skeuomorphic paper effect.
- **Don't** let a denied read and an empty table look the same.
