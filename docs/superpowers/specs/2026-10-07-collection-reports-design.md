# Collection reports: account chart and the four office reports (design)

Date: 2026-10-07
Status: approved in conversation, awaiting written-spec review

## Goal

Produce, from the system's own receipts, the four reports the CEEDO office currently builds
by hand in Excel:

1. **Daily Collection Report**: the page sent to the City Treasurer, the
   collections-per-collector matrix, and the per-collector abstracts.
2. **Monthly tenant payments**: tenant × day grid for a month.
3. **Tenant balances as of a date**.
4. **Monthly summary of collections**: account lines × Jan–Dec for a year.

Success: for a day or month entered in the system, each report reproduces the figures the
office would otherwise compute by hand. The reports agree with one another by
construction, and every peso received lands on exactly one account line. Anything that
cannot be placed is shown, never dropped.

## Sources

Samples the office shared (kept outside the repo; they contain real names):

- *September 30 2026 Abstract and Collection Reports*. Three parts:
  - "Daily Collection Report": about 13 particulars lines with Sub-total 1, Sub-total 2 and
    a Grand total.
  - "Collections Per Collector": collectors × columns, with the check/cash deposit split.
  - 25 abstract pages, one per collector and area.
- *Daily Collection (April 2026)*: "Rentable Income Collections", tenant × day, grouped
  area → section → fee kind.
- *Monthly Summary of Collection Report*: "Total Income and Non-Income Collection, Year
  2026", about 110 account lines × Jan–Dec. It ends with a non-income block, a by-facility
  summary and the cashier's control figure.

## What exists today

- Receipts:
  - `collections` (OR, booklet, collector, `business_date`, fee type, optional
    `lease_id`, `gross_amount`).
  - `collection_allocations`, which map receipts to charges.
  - `collection_lines`, the cash-fee lines (fee type, rate class, qty × unit rate).
  - Cancellations and reinstatements.
- Ledger:
  - `charges` (rental, surcharge, opening_balance) and condonations.
  - The `charge_balances` view and `lease_balances` view, both as of now only.
- Office posting exists only as *recovery* (`recover_collection`, migration 0060), which
  re-enters receipts lost on a wiped tablet.
- Payments are cash only. Every fee is a fixed rate; there are no keyed amounts.
- Fee types are coarse: MKT_DAILY/WEEKLY/MONTHLY, AMBULANT, PARKING, TERMINAL, SLAUGHTER.
- Report framework: `apps/web/lib/reports/` (`Report` → screen, xlsx and print). The
  existing reports are rcd, abstract, raaf, remittance-reconciliation, exceptions, aging,
  delinquency and subsidiary-ledger.

## Decisions taken in brainstorming

- One spec, delivered in phases (see Rollout).
- Receipts are classified by an **account chart plus effective-dated mapping rules**,
  resolved at query time. The rejected alternatives were stamping an account on each
  receipt at posting, and one fee type per account line.
- **Checks are accepted at the office only.** Collectors in the field take cash.
- **Ante/post-mortem fees split by a fixed, dated percentage** between city income and
  NMIS non-income. The office must confirm the percentage: year-to-date figures put the
  city share near 43%, while the RCD column header says "25%".
- **Non-receipt lines are entered by accounting each month**: withholding tax, payment
  for disapproved leave, prior-period adjustments and over-deposit. The cashier's control
  figure is entered the same way.

## Data model

All new objects are in schema `ceedo_collections`, with RLS on the existing patterns.

### `treasurer_lines`

The particulars of the Daily Collection Report.

- Columns: `id, name, sort_order, subtotal_group smallint check (subtotal_group in (1,2)), active`.
- Seeded from the Sept 30 page:
  - Group 1: Slaughterhouse fees; Public Mall stall rentals/misc; Public Mall CR; IBJT
    stall rentals/parking/misc; IBJT CR; Cotta Fort entrance/misc; Public cemetery;
    Wellness Park stall rentals/misc; Wellness Park comfort rooms; Wellness Park
    playground.
  - Group 2: Ante/post-mortem fees; Electricity bill payments; Surcharges on electricity
    bill payments.

### `rcd_columns`

The columns of the Collections-per-collector matrix. They group differently from the
Treasurer lines.

- Columns: `id, name, sort_order, active`.
- Seeded: Public Mall; Surcharges – stall rentals; Slaughterhouse; Ante/post-mortems;
  IBJT; Wellness Park; Public cemetery; Cotta Fort; Citation ticket; Electricity bill
  payments; Surcharges – electricity.

### `collection_accounts`

The lines of the monthly summary.

```
id, code text unique, name text, facility_id uuid null, group_name text,
sort_order int, kind text check (kind in ('income','non_income')),
treasurer_line_id uuid null, rcd_column_id uuid null, active bool
```

- `facility_id` is null for cross-facility groups (Surcharges, Non-Income).
- `group_name` holds the summary's sub-headings, e.g. "Stall Sections Daily Rent",
  "Rentable Space", "Stall Sections Occupancy Fee", "Other Collections".
- One built-in account, code `UNCLASSIFIED`, receives every portion no rule matches.

### `account_rules`

```
id, fee_type_id uuid not null, facility_id uuid null, section_id uuid null,
rate_class text null, portion text check (portion in ('base','surcharge')),
account_id uuid not null, share_bps int not null default 10000 check (share_bps between 1 and 10000),
effective_from date not null, effective_to date null
```

- **Specificity:** a rule with a section beats one with a facility, which beats a rule
  with only a fee type. A rule with a `rate_class` beats one without, at the same level.
- **Rule set:** the rules with an identical key (fee type, facility, section, rate class,
  portion) that are in force on a given date.
  - Its `share_bps` must sum to 10000. A deferred constraint trigger checks this per key
    and date range.
  - Rule sets with the same key must not overlap in dates (exclusion constraint on the
    key + daterange).
- **Never edited in place.** A change ends the current set (`effective_to`) and inserts a
  new one, so a month already reported is never restated.

### `monthly_adjustments`

```
id, account_id, month date (first of month), amount numeric(14,2) (may be negative),
note text not null, entered_by, entered_at, cancelled_at, cancelled_by, cancel_reason
```

Append-only. A cancellation is recorded with a reason, never deleted.

### `monthly_control_totals`

```
id, month date, amount numeric(14,2), note, entered_by, entered_at
```

The cashier's figure for the month. The latest row per month is the one in force.

### Changes to existing tables

- **`fee_types.amount_mode text not null default 'rate' check (amount_mode in ('rate','keyed'))`.**
  - A keyed fee's amount is typed by whoever issues the receipt. It is stored as one
    `collection_lines` row with quantity 1 × the typed amount, and the amount must be
    above 0.
  - Keyed fee types: electricity bill payments, misc fees, certification, citation
    ticket, occupancy fee, and others marked in the seed.
- **`fee_types.facility_id uuid null`.**
  - This makes on-the-spot fee types facility-specific ("PM CR" and "IBJT CR" are
    separate fee types). A rule can then place a cash-fee receipt without a facility on
    the receipt itself.
  - The tablet offers only fee types for its own facility, or those with no facility.
- **`collections.payment_mode text not null default 'cash' check (payment_mode in ('cash','check'))`**,
  plus `check_no`, `bank` and `check_date`.
  - These three are required exactly when the mode is `check`.
  - `check` is allowed only on receipts posted from the office (enforced in the posting
    RPCs; `sync_push` rejects it).
- **`collections.lease_id` may be set on a keyed occupancy-fee receipt**, recording which
  lease paid it. Such a receipt allocates to no charge.
  - Planning must verify that the posting path accepts this, and adjust it if not.
- **`facility_type` gains `other`**, for City Gym, Cotta, Public Cemetery and similar
  facilities.
- **Index on `collections (business_date)`.**

### Seed migration

Creates the facilities, fee types, Treasurer lines, RCD columns, accounts and rules that
reproduce the monthly summary's structure:

- Daily rent per section, for Public Mall, IBJT and Wellness Park.
- Rentable and semi-rentable monthly rent.
- Occupancy fee per section.
- Per-facility CR, certification, delivery, misc, parking and storage.
- Terminal fee per bus company (`rate_class` = company).
- Slaughterhouse sub-fees.
- Cotta, cemetery, gym, playground and fitness-ground entrance fees.
- Rental and electricity surcharges per facility.
- Night Market and IBJT Tabo.
- The non-income lines: NMIS, citation ticket, electricity per facility, veterinary,
  withholding tax, disapproved leave, prior-period adjustments.

The office reviews the account list before the seed is deployed to production.

## Computation

### `receipt_account_lines(p_from date, p_to date)`

A `security invoker` SQL function, the single source for every collections report. It
returns one row per receipt portion:

```
collection_id, or_no, booklet_id, business_date, collector_id, lease_id, payer_ref,
fee_type_id, account_id, payment_mode, amount, cancelled bool
```

- **Lease receipts** (rent):
  - The *surcharge* portion is the sum of the receipt's allocations to surcharge charges.
  - The *base* portion is the gross amount minus the surcharge portion. It covers rent,
    opening balance and any unallocated advance.
  - Rules are matched on the receipt's fee type, plus the facility and section from
    lease → stall → section.
- **Cash-fee receipts:** each `collection_lines` row is a base portion, matched on its
  fee type and rate class. When the receipt also carries a `lease_id` (a keyed occupancy
  fee), the lease's facility and section are used for matching as well.
- **Which branch applies:** the branches are exclusive. A receipt with
  `collection_lines` is classified only through its lines. The lease branch applies only
  to lease receipts that have no lines. This way no receipt is counted twice.
- **Rule choice:** the most specific rule set in force on `business_date`.
- **Splits:** a rule set with several accounts divides the amount by `share_bps`, rounded
  to the centavo. The rounding remainder goes to the largest share, so the portions sum
  exactly to the receipt.
- **No match:** the portion goes to `UNCLASSIFIED`.
- **Cancelled receipts:**
  - Returned with `cancelled = true`. Every total excludes them; the abstracts list them.
  - Status is current: cancelled minus reinstated, as of now.
  - Printed reports show their generation time.

### `lease_balances_as_of(p_date date)`

A `security invoker` SQL function. For each lease that started on or before D:

- **charged** = charges with `due_date <= D`: rental, surcharge, opening balance.
- **paid** = allocations from receipts with `business_date <= D`, excluding receipts
  whose cancellation was recorded on or before D. A receipt cancelled after D still
  counts as paid on D, net of any reinstatement.
- **condoned** = condonations recorded on or before D.
- **outstanding** = charged − paid − condoned. It is bucketed by `D − due_date`: 1–30,
  31–60, 61–90 and over 90 days.
- **advance** = amounts received by D that are not allocated to a charge due by D.

**Invariant:** `lease_balances_as_of(today)` agrees with `lease_balances` for every lease.

## Reports

### Framework changes (`apps/web/lib/reports/`)

- Rows may carry a style (`heading`, `subtotal` or `total`) and an indent level. The
  screen, print and xlsx renderers all honour them, and existing reports are unaffected.
- `Report.layout?: 'portrait' | 'landscape'`.
  - Landscape prints fit-to-width.
  - The xlsx export freezes the header rows and the first column, and sets landscape page
    setup.
- New `ParamKind`s: `year` and `facility` (the facility is optional).
- Signature names (prepared by, noted by, checked by) are read from settings.

### 1. Daily Collection Report (`daily-collection`; parameter: date)

**(a) Treasurer page**

- One row per Treasurer line, with columns Particulars, Date of collection, Amount and
  Date of deposit.
- Sub-total 1 and Sub-total 2 follow their groups, then the Grand total.
- Date of deposit is the deposit date of the verified remittance(s) covering that day's
  shifts:
  - If the shifts were deposited on several dates, it shows the latest.
  - If any shift is still undeposited, it shows "undeposited".

**(b) Collections per collector**

- One row per collector with receipts that day. Columns are the RCD columns plus Total,
  with a sub-total row.
- A deposit block follows: less check, cash, total deposit, total collection.

**(c) Abstracts**

- One section per collector per facility. Columns: No., OR #, Name (tenant, or payer for
  cash fees), Section, Stall, Amount, Total, Remarks.
- Cancelled ORs are listed as "(cancelled)" with zero.
- Remarks are derived from the ledger:
  - the date range of rental charges the receipt settled, e.g. "Sept 1–30" or
    "Sept 27–30";
  - "advance" when part of the receipt is unallocated credit.

Layout: portrait for (a); landscape for (b) and (c).

### 2. Monthly tenant payments (`tenant-payments`; parameters: month, facility?)

- Blocks are grouped facility → account line, for rent and occupancy-fee lines.
- One row per lease active at any point in the month, *including leases with no
  payments*. Columns: Name, Stall, Rate, day 1…N, Surcharge, Total.
  - Day cells hold the base portions received that day.
  - Surcharge sums the month's surcharge portions.
- Totals per block, per facility and overall.
- Night Market and Tabo vendors without leases appear as one row per payer.
- Layout: landscape.

### 3. Tenant balances as of a date (`balances-as-of`; parameters: date, facility?)

- Grouped facility → section. Columns: Stall, Tenant, Rate, 1–30, 31–60, 61–90, 90+,
  Outstanding, Advance, Net.
- Totals per section, per facility and overall.
- The existing `aging` report is rebuilt on `lease_balances_as_of(today)`.

### 4. Monthly summary of collections (`monthly-summary`; parameter: year)

- Rows follow the account chart: facility heading → group heading → account lines.
  - Group sub-totals, then a facility total.
  - Then Total Income, the Non-Income block and its total, then the Grand total.
- Columns: Jan…Dec and Total. Months that have not ended are left blank.
- Monthly adjustments are added into their account line and marked "†"; their notes are
  listed under the report.
- After the Grand total:
  - the summary-by-facility block;
  - the control total (the cashier's figure) per month;
  - the difference per month.
- Layout: landscape.

### Unclassified warning

Reports 1 and 4 show a warning band when the period has a non-zero `UNCLASSIFIED` total.
The band links to the unclassified list.

## Screens

- **`/admin/accounts`** (admin only):
  - the account chart, with Treasurer line and RCD column per account;
  - the rule editor, which only adds rules with an effective date and ends the previous
    set;
  - the list of unclassified receipts, each with a "create rule" shortcut.
- **`/ledger/adjustments`**: monthly adjustments and control totals.
  - Accounting records them; supervisors and admins can read them.
  - Cancelling requires a reason.
- **`/ledger/office-receipt`**:
  - Fields: officer, booklet and OR, fee type or lease, amount (keyed or from the rate),
    and cash or check with check details.
  - Posts through a generalized `recover_collection` path under an office shift for the
    officer.
  - Allowed for the booklet's holder or a supervisor.

## Collector app

- Keyed fee types show an amount field. The server rejects a keyed line whose amount is 0
  or less.
- The fee list is filtered by the tablet's facility (`fee_types.facility_id`).
- No change to the shape of the sync contract.
- Ships to production tablets by APK or OTA, always with `--platform android`.

## Errors and edge cases

- Shares that do not sum to 10000, and rule sets that overlap in dates, are refused by
  the database.
- Check details missing on a check receipt, or a check receipt arriving from a device, is
  refused.
- A report for a period with no receipts shows its empty message.
- Months that have not ended are blank in the monthly summary, not zero.
- Adjustments to an account that was deactivated still show in months where they exist.

## Testing

- **DB suite (`tests/`)**:
  - Rule specificity, splits with rounding, the base/surcharge portions, cancelled and
    reinstated receipts, `UNCLASSIFIED`.
  - `lease_balances_as_of`:
    - it equals `lease_balances` at today;
    - a receipt cancelled after D still counts on D;
    - advances are reported.
  - Constraints, and RLS for every new table and RPC.
- **Builder tests (vitest)**:
  - Pivots, row styles, blank future months, xlsx output.
  - Reconciliation invariants:
    - Treasurer grand total = per-collector total = sum of abstracts;
    - tenant-payments block totals = the monthly summary's lines for that month;
    - summary grand total = all non-cancelled receipt portions + adjustments.
- **Fixture:**
  - A trimmed version of the Sept 30 data with fictitious names.
  - Run through the seed rules, it must reproduce that day's Treasurer line totals.

## Rollout

Each phase is releasable on its own:

1. Report framework extensions, `lease_balances_as_of`, the **Balances as of** report, and
   `aging` rebuilt on it.
2. The **Monthly tenant payments** report.
3. The account chart, rules, fee catalogue seed, `amount_mode`, `fee_types.facility_id`,
   `payment_mode`, and the **Office receipt** page.
4. The **Daily Collection Report**.
5. The **Monthly summary**, adjustments and control totals.
6. Collector app: keyed amounts and facility-filtered fees.

Migrations reach production as `dist-sql` bundles the user runs, after checking
`deployed_migrations`.

## Out of scope

- Electricity billing: meter readings, bills, electricity arrears. Only electricity
  payments are recorded and reported.
- The tenant-list import from the office's spreadsheet.
- Day-of-week rent schedules (Tabo on Saturday and Sunday, Night Market Friday to Sunday)
  and holidays.

These get their own specs.

## Open questions for the office

- The ante/post-mortem city share percentage, and its effective date.
- Confirmation of the seeded account list and its Treasurer and RCD groupings.
- The names and titles for the signature blocks.
