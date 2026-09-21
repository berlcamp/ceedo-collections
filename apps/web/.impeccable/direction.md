# Direction contract — Proof Tape

Locked by the user on 2026-09-21 from a direction roll (seed `767dd6a5`, scope `direction`,
mode `operate`, assigned index 3). Build path: **code-led** — this harness has no image
generation, so there is no comp; the ambition lives in this contract and is audited in
behaviour at the finish.

## Mode

**Operate.** The visitor completes a task. The confirmed primary user is an accounting
clerk at an office desktop, all day, reconciling market collections. Scanability,
consistency and density outrank expression; brand lives in precise details.

## World

The treasury cash-proof ritual: a dark enamelled machine chassis holding a pale continuous
tape of figures. Every screen is a proof — a column of entries, a hairline rule, a total,
and one line that says whether it agrees.

## Pinned by the brief (these beat the roll)

- Dark sidebar. **Translation:** the dark ground is the machine's chassis, and the content
  field stays the pale tape. Named here because the direction's own material is paper; the
  pin forces the split, and the split is what makes the world work.
- Radix Primitives, styled by this project. Not shadcn/ui, not Radix Themes.
- Datatables with pagination.
- Add/edit as modals.
- Improved filter UX.
- No theme switcher, one theme.

## System

- **Palette / material.** Chassis charcoal (`#16150f`–`#3d392e`) for the rail, the dialog
  head and the modal scrim. Tape stock (`#f7f4ec`) for the field. Carbon ribbon ink
  (`#24221e`). Colour is scarce and reserved: ribbon red `#b5302a` for shortage, void and
  overdue; office blue-black `#33455c` for the office acting; amber `#8a6212` for a
  standing warning; proof green `#2f5d45` for agreement.
- **Type.** One family, IBM Plex Sans, for headings, labels, controls and data; IBM Plex
  Mono for measurement only (OR serials, ids, PINs). Fixed rem scale, no fluid clamps.
  Field captions are letterspaced small caps, as a printed form sets them.
- **Composition.** Rules, not cards. Rows are ruled; a total is closed by a hairline above
  and a **double rule** below — the accountant's close, and the one load-bearing piece of
  the world.
- **Topology.** A fixed frame: chassis rail, header band, filter slip, tape, proof, pager.
  Navigation swaps the tape; the frame never reflows between routes.
- **Controls / state.** Every state readable with colour removed: strike-through for
  voided, a solid ink bar in the row gutter for a row needing attention, an ink bar on the
  current rail item, half-density for disabled.
- **Motion.** 120–180 ms, exponential ease-out, from an already-visible default. No page
  load choreography.

## Raises taken from challengers the direction beat

- **One-Bit Desktop (declined):** every row and control state is legible with colour removed.
- **Iridescent Cloud Edge (declined):** the figure field stays achromatic — colour lives at
  edges, gutter marks and the variance line, never as a fill behind a number.
- **Cyclorama Dawn (declined):** colour is never the sole signal, and filter state is named
  and deep-linkable in the URL.
- **PC-98 Sixteen-Colour Field (declined):** a fixed frame whose content swaps rather than
  reflows, and a locked palette with no ad-hoc greys.

Competitive alternates not taken: **Safelight Bay** (irreversible staged commits) and
**The Marked Catalog** (dense scanning plus a personal "chase these" layer).

## First viewport

A dark enamel rail holds a pale tape of figures. The table's footer is a live running total
that re-tallies as the view is filtered, with the in-view sum set against the whole set,
under a double rule.

## Signature interaction

**The running proof.** Every money table closes with a total of what is currently in view,
the unfiltered total beside it when a filter is on, and a proof line stating the thing the
screen exists to say:

- Collections — the void total excluded from the figure, named and priced.
- Shifts — net variance across the closed shifts in view, with short/over counts. System
  and declared totals are deliberately **not** summed: an open shift has a system figure
  and no declaration, so those two sums invite a subtraction that is wrong.
- Exceptions — how many have passed §11.3's three-day Treasurer line.

## Honest risk

A paper-derived world can slide into skeuomorphic pastiche. The discipline is rules,
rhythm and reserve — no texture, no torn edges, no drop shadows pretending to be paper.

## Out of scope this pass (user-confirmed)

All behaviour and all copy preserved: role gates, RLS assumptions, server actions, the
Postgres-error sentences in `toSaveResult`, and the long explanatory screen copy are
unchanged. Money stays integer centavos through `format()`.
