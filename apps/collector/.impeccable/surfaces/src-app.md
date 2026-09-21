---
version: 1
slug: "src-app"
primary_target: "src/app"
related_targets: []
---

## Scope and mode

`apps/collector/src/app/` — ten collector- and admin-facing routes. Visitor mode: **Operate**.
Excluded: `bcrypt-probe`, `engine-probe` (instruments, not UI).

Audience, job, constraints live in `apps/collector/PRODUCT.md`. Do not duplicate them here.

## Direction contract

**THESIS.** The tablet is the conductor's rack: a mobile collector working a route with
pre-numbered accountable paper, punching a serial to spend it, reconciling the rack against
cash at the end. It refuses the category default — tonal Material cards on a tinted surface —
because a rack has no cards. It has ranked slots, a live slot, and spent ones you can see
through.

**OWN-WORLD.** Ticket stock as ground (`#F1F3F1`, cool matte, never cream). The rack board as
chrome: worn transit teal (`#0E4A44`) in the masthead strip and the action shelf. Punch ink
`#16181A`. One accent, ochre `#C2761B`, carrying live/selected and nothing else. Three
reserved signals that are never decorative: refusal red `#B3261E`, confirmed green `#1B6B45`,
confirmable-warning amber `#B4780A`. Condensed grotesque caps for labels; tabular lining
figures for every peso amount, on one fixed decimal column. Four type sizes, no more. No wood
grain, no drawn brass, no skeuomorphic perforation — the rack is a layout law, not a picture.

**STORY.** The collector finds a tenant, sees what is owed oldest-first as a stack of slots,
fills a run of them by tap or by cash tendered, reads one figure off the fare panel, writes it
on the paper OR by hand, then punches that serial back into the rack. They should never once
wonder which number to copy, nor why a control will not move.

**FIRST VIEWPORT** (`lease/[leaseId]`). Teal rack-head strip full-bleed at the top: stall
number in condensed caps at large scale, tenant beneath, sync-age register right-aligned.
On stock below: BALANCE label in tracked caps, figure in tabular numerals. Then the rack —
outstanding periods as slots, oldest anchored at the top, period and due date left, amount
right on the fixed decimal column. Tapping rank n fills 1..n with a continuous ochre spine
down the left edge and drops unselected rows back to faint ink. Then the tender field, a
stock inset with a thick underline, no box. Then the FARE PANEL: RECEIPT TOTAL in tracked
caps over the largest figure in the app, decimal-aligned; change below it in green when
positive. The primary action is a teal shelf pinned to the bottom edge, inside one-handed
thumb reach; disabled it renders as an un-inked stub with the reason stated inside the shelf,
above the label.

**SIGNATURE INTERACTION — the punch.** Recording a receipt punches the serial: the OR slot
takes a visible notch and settles into spent green. ~180ms, the only motion in the app, cut to
an instant state change under Remove animations. It marks the one irreversible moment, which
is the moment `commitReceipt` actually commits.

**FORM.** The Conductor's Rack — position 1 of the ordered grounded list, taken as the pick
card over the assigned Security Print. Seed key `5ad958bf`, re-roll round 1, mode operate.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Carried disciplines

The pick card shipped without raises. These six were donated by declined challengers to the
assigned card, and each is a product requirement serving the five behavioural rules, so they
bind this build too:

1. **Every control carries a permanently visible text label.** No icon-only affordance.
2. **Four fixed type sizes.** The incumbent uses ten ad-hoc sizes between 13 and 34.
3. **Refusal red carries refusals and destructive controls only** — things that stop or
   destroy. Never a heading, a rule, a decoration, or the peso sign. (Widened from
   "refusals only" during the build: Sign out and Remove are red, and pretending
   otherwise would have been a rule violated in silence rather than a rule amended.)
4. **Selection suppresses**, it does not only highlight: unselected slots drop to faint ink.
5. **One fixed reference.** Masthead strip and value slot hold position and scale on every screen.
6. **Stepped deployment.** Per-charge detail expands in place; never a second screen mid-transaction.

## The five behavioural rules (load-bearing — from the parent memory and handover)

1. No message may name a cause the screen has not checked.
2. A disabled control must say what is missing — both things when two are missing.
3. Money renders only through `format()` from `@ceedo/shared`. Never interpolation, never a
   float, never a figure derived from an empty selection.
4. A sequence-skip warning is confirmable, never a block. `ambiguous_booklet` IS a hard stop.
5. Nothing may throw inside a render or an `onChange`.

Plus: `deviceDriver()` in render bodies, never `expoSqliteDriver(openDeviceDb())`.

## Unresolved

- ~~`shift.tsx` and `closeout.tsx` render money as `₱{totals.total}` interpolation~~ —
  **CLOSED.** `src/ui/money.ts` `fromWire()` routes wire decimals back through `format()`;
  both screens use it, and `Figure` takes a rendered string so no numeric path exists
  through it. Verified on device at `₱1,850.00`.
- **The tablet device class is uninspected.** Everything was captured on a Huawei JDY-LX2
  phone at 360×806 dp — the narrowest realistic width, which is a useful worst case for
  overflow but is not the shipping class. No tablet or emulator was available.
- **Font scale 1.3 never captured** against the `numberOfLines={1}` masthead or the fixed
  48/56 dp targets.
- **Keyboard-up state never captured.** `app.json` now sets
  `android.softwareKeyboardLayoutMode: "resize"` so the pinned shelf is not covered on
  receipt / closeout / lease, but that needs a native rebuild to take effect and was not
  verified.
- **`app.json` changes are unverified on device**: `userInterfaceStyle: "light"` and the
  keyboard mode both require a Gradle rebuild. The installed dev client is still the old
  `com.anonymous.collector` package.

## Named future work (from the finish review's ceiling section)

Real, and deliberately not half-done in this pass:

1. **The spent slot.** The thesis claims ranked slots, a live slot, and spent ones you can
   see through. Only two of the three states ship — no screen renders a settled period.
2. **Rank.** A rack is numbered; nothing carries a slot's position, so "oldest first" is a
   caption rather than a property you can see.
3. **The amount column on `leases`.** The list is stall / tenant / section with no figure,
   so a collector cannot triage a route from it, and the fixed decimal column exists on
   one screen instead of being a cross-screen law.
