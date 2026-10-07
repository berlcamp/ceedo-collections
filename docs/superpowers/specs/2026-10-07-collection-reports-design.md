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
5. **Collections detail**: every collection in a month, filterable, with a per-tenant
   summary. It replaces the office's QuickBooks Online entry log.

**The system replaces QuickBooks Online.** The office currently keys every collection
into QBO by hand (the April Deposits sample) to get its detail list and per-tenant
summaries. Once these reports exist, QBO entry stops. Nothing is exported to QBO.

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
- *April 2026 Deposits*: the office's QuickBooks Online entry log for one month, typed
  by hand. Report 5 replaces it.
  - Size: 11,674 lines, about 376 a day, totalling 4,938,388.90.
  - Columns: Date, Transaction type (Rental / Walk-in / Occupancy Payment), Customer,
    Area, Memo "Collector – Account", Amount.
  - Walk-in fees are one line per collector, day and account under a "Walk-in Customer
    <Facility> – <Fee>" customer. Bus companies are their own customers.
  - Two pivot sheets give the rent paid per tenant for the month.
  - Its 55 account names cross-check the seeded account chart.

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
- **Ante/post-mortem fees split by a fixed, dated percentage: 75% city income (in the
  Slaughterhouse line and column) and 25% NMIS non-income.**
  - Verified on Sept 30: Diagro's ante + post-mortem fees are 1,100.00 + 484.40 = 1,584.40.
    Their 25% is 396.10, which is exactly the "(25%)" column.
  - The monthly summary's NMIS line is larger than 25% of these fees would give. Its
    other source is an open question for the office.
- **Cash-ticket sales (CR tickets and similar) are entered on the web by the office**,
  per collector per day. They are cash the collector remits but are not ORs.
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
treasurer_line_id uuid not null, rcd_column_id uuid not null, active bool
```

- Both groupings are **required**, so no peso can fall off the Treasurer page or the
  per-collector matrix.
- Accounts the office has not yet placed (citation ticket, rental surcharges, City Gym,
  Night Market, IBJT Tabo, veterinary, occupancy fees…) point to a seeded **"Other
  collections"** Treasurer line and RCD column until the office decides.

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

### `cash_ticket_sales`

Cash-ticket money (comfort-room tickets and similar) does not go on ORs. On the
Sept 30 abstracts these are lump figures:

- PM 3,000;
- IBJT 1,500 + 2,045;
- Wellness Park 470.

```
id, shift_id uuid not null, collector_id, business_date, fee_type_id,
amount numeric(14,2) check (amount > 0), ticket_from int null, ticket_to int null,
note, entered_by, entered_at, cancelled_at, cancelled_by, cancel_reason
```

- **Who enters it, and when:** a supervisor or accounting user, through an RPC, against
  the collector's shift for that day. Entry is allowed until the shift is remitted.
- **Effect on the shift:**
  - Entering or cancelling a sale recomputes the shift's `system_total` and `variance`.
    The cash the collector declared includes the ticket money, so the shift reads as an
    overage until the office enters it.
  - The shifts list flags shifts with an overage and no cash-ticket entry.
- **Fee type and rules:** the fee type is facility-specific and keyed (e.g. "PM CR cash
  ticket"), and it is classified by the ordinary rules.
- **Out of scope:** ticket serials are recorded when given, but tracking cash tickets as
  accountable forms (RAAF) is not part of this spec.

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
- Per-facility CR (cash tickets), certification, delivery, misc, parking and storage.
- Terminal fee per bus company (`rate_class` = company).
- Slaughterhouse sub-fees. Ante- and post-mortem are split 7500/2500 between the
  slaughterhouse income lines and NMIS.
- Fees and entrance charges by place:
  - Cotta: entrance fee.
  - Public Cemetery: burial fee (Brgy. Bongbong).
  - City Gym: rental.
  - Wellness Park: entrance fees for the playground and the fitness ground.
- Rental surcharges per facility, which are the surcharge portion of lease receipts.
- Electricity: a keyed **electricity bill payment** fee type and a keyed **electricity
  surcharge** fee type for each of Public Mall, IBJT, Wellness Park and Unitop.
  - The two are issued as two lines on the same OR, as the abstracts show
    ("EBP" + "Surcharge/EBP").
  - The electricity surcharge does not use the allocation-based surcharge portion: no
    electricity charges exist to allocate to.
- Night Market and IBJT Tabo.
- The non-income lines: NMIS, citation ticket, electricity (PM, IBJT, Wellness Park,
  Unitop), veterinary, withholding tax, disapproved leave, prior-period adjustments.

The office reviews the account list before the seed is deployed to production.

## Computation

### `receipt_account_lines(p_from date, p_to date)`

A `security invoker` SQL function, the single source for every collections report. It
returns one row per receipt portion:

```
collection_id, or_no, booklet_id, business_date, collector_id, lease_id, payer_ref,
fee_type_id, account_id, payment_mode, amount, cancelled bool,
source text  -- 'receipt' | 'cash_ticket'
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
- **Cash-ticket sales:** non-cancelled `cash_ticket_sales` rows are a third, exclusive
  branch. They are returned with `collection_id` and `or_no` null and a `source` column
  of `cash_ticket`; the other branches return `source = 'receipt'`. They are classified
  by fee type like any cash-fee line.
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

- One row per **active collector**, including those with nothing that day (the sample
  lists them all). Columns are the RCD columns plus Total, with a sub-total row.
- A deposit block follows: less check, cash, total deposit, total collection.

**(c) Abstracts**

- **Grouping:**
  - One abstract per collector, in OR order.
  - It is broken into one section **per booklet**, totalled "Total 1/n … n/n" as the
    office's pages are.
  - A collector's run may cover several facilities (one Sept 30 collector had Public
    Mall and IBJT receipts in the same run). The Section column shows each receipt's
    facility and section.
- **Base columns:** No., OR #, Name (tenant, or payer for cash fees), Section, Stall,
  Amount, Total, Remarks.
- **Extra columns by facility type:**
  - Terminal: **Plate/Body #**, taken from the receipt's payer reference.
  - Slaughterhouse: **Variety** (rate class) and **Heads** (quantity). Weight is not
    modelled; see Out of scope.
- **Lines on one OR:** a receipt with several lines (e.g. electricity bill + electricity
  surcharge) shows one row per line, with the OR total on its first row.
- **Cash tickets:** a collector's cash-ticket sales are listed after their ORs.
- **Section summary:** each collector's abstract ends with a summary by section and
  account, matching the office's "Row Labels / Sum" tables.
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
  - The office's April sample has only Name, Rate/day, days and Total.
  - **Stall** and **Surcharge** are deliberate additions. Stall tells apart tenants with
    the same name and tenants with several stalls; Surcharge makes the row total
    everything the lease paid.
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

### 5. Collections detail (`collections-detail`; parameters: month, facility?, collector?, account?, tenant?)

This replaces the QuickBooks Online entry log and its pivots.

- **Section 1, collection lines.**
  - Columns: Date, OR #, Type (Rental / Occupancy / Walk-in / Cash ticket), Customer,
    Facility, Collector, Account, Payment mode, Amount.
  - One line per receipt portion, in date then OR order. Cancelled receipts are left out.
  - Customer is the tenant's name for lease receipts. Otherwise it is the payer
    reference (bus company, electricity payer), or "Walk-in" if there is none.
  - The optional filters narrow the list. The screen is searchable by customer.
- **Section 2, payments per tenant.**
  - Customer, Facility, Stall, and the month's total split into rent, surcharge,
    occupancy and other. Sorted by name, with a grand total.
  - This replaces the office's pivot, their "summary of all their payments".
- **Section 3, totals by account.** Each account's month total, so the list can be
  checked against the monthly summary without a pivot.
- **Invariant:** with no filters, Section 1 total = Section 3 total = the month's column
  in the monthly summary, before adjustments.
- **Layout:** landscape. The xlsx export puts each section on its own sheet.

### Unclassified warning

Reports 1, 4 and 5 show a warning band when the period has a non-zero `UNCLASSIFIED` total.
The band links to the unclassified list.

## Screens

- **`/admin/accounts`** (admin only):
  - the account chart, with Treasurer line and RCD column per account;
  - the rule editor, which only adds rules with an effective date and ends the previous
    set;
  - the list of unclassified receipts, each with a "create rule" shortcut.
- **`/ledger/cash-tickets`**: cash-ticket sales per collector per day, entered against
  the shift by a supervisor or accounting user; cancelling requires a reason.
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
  - A trimmed version of the Sept 30 data with fictitious names, run through the seed
    rules.
  - Its expected figures are the ones **agreed with the office, not the printed ones**,
    because the hand report has errors:
    - Balomaga's abstract totals 5,396.00, but the per-collector sheet shows 6,396.00.
    - Balat's 1,722.00 "Electric Bill" is reported under IBJT, not Electricity.
    - Demecillo's OR 6320800 is printed 2,050.00, but its lines sum to 2,048.00.
  - The test asserts the corrected figures, and the spec's open questions carry these
    discrepancies.

## Rollout

Each phase is releasable on its own:

1. Report framework extensions, `lease_balances_as_of`, the **Balances as of** report, and
   `aging` rebuilt on it.
2. The **Monthly tenant payments** report.
3. The account chart, rules, fee catalogue seed, `amount_mode`, `fee_types.facility_id`,
   `payment_mode`, the **Office receipt** page, and **cash-ticket entry** (with the
   shift total and variance recomputation).
4. The **Daily Collection Report**.
5. The **Monthly summary**, adjustments and control totals.
6. The **Collections detail** report. QuickBooks entry stops once phases 1–6 have run
   in parallel with QBO for one full month and the figures agree.
7. Collector app: keyed amounts and facility-filtered fees.

Migrations reach production as `dist-sql` bundles the user runs, after checking
`deployed_migrations`.

## Out of scope

- Electricity billing: meter readings, bills, electricity arrears. Only electricity
  payments are recorded and reported.
- The tenant-list import from the office's spreadsheet.
- Day-of-week rent schedules (Tabo on Saturday and Sunday, Night Market Friday to Sunday)
  and holidays.
- Slaughterhouse rating by weight. The office's slaughterhouse abstract records weight
  in kilos and derives the slaughter fee from it; this system records heads and variety
  only.
- Cash tickets as accountable forms (issued, sold and returned ranges in the RAAF).
- **History before cutover.** The system starts fresh on 2026-10-01: the 2026 monthly
  summary shows October–December only, and full-year reports start in 2027.
  January–September 2026 stay in QuickBooks and the office's Excel files as the archive.
  No exports to or imports from QuickBooks.
- Occupancy-fee obligations and their balances. April shows the occupancy fee paid in
  instalments (one IBJT tenant: 200, 400, 100, 100, 200), so it is a receivable. This
  spec only reports the receipts.

These get their own specs.

## Open questions for the office

- How is the occupancy fee set, and what is owed per tenant? This is needed for a later
  occupancy-receivable spec.
- The effective date of the 75/25 ante/post-mortem split. Also: what makes up the rest
  of the monthly NMIS non-income line beyond the 25% share?
- Which Treasurer line and RCD column each currently-unplaced account belongs to:
  citation ticket, rental surcharges, City Gym, Night Market, IBJT Tabo, veterinary, and
  occupancy fees.
- The corrected figures for the three Sept 30 discrepancies listed under Testing.
- Confirmation of the seeded account list and its Treasurer and RCD groupings.
- The names and titles for the signature blocks.
