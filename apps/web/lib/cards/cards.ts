/**
 * What one printed tenant card shows. Parent spec §9.1: the stall number set large, then the
 * market, section and renter name, plus the QR, which carries only the lease id (§9.2).
 */
export interface CardRow {
  leaseId: string;
  stallNo: string;
  tenantName: string;
  sectionName: string;
  facilityName: string;
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/**
 * Print order: by market, then section, then stall number compared NUMERICALLY, so
 * "Dry Goods-2" comes before "Dry Goods-10". The office hands out a stack of cards by
 * walking a row of stalls, and a plain string sort would scatter that row across the pile.
 */
export function sortCards(cards: CardRow[]): CardRow[] {
  return [...cards].sort(
    (a, b) =>
      collator.compare(a.facilityName, b.facilityName) ||
      collator.compare(a.sectionName, b.sectionName) ||
      collator.compare(a.stallNo, b.stallNo),
  );
}

/**
 * Two A5 cards per A4 sheet (§9.1: "half an A4 sheet, laid out two-up"). The last sheet
 * may carry one.
 */
export function intoSheets<T>(cards: T[]): T[][] {
  const sheets: T[][] = [];
  for (let i = 0; i < cards.length; i += 2) sheets.push(cards.slice(i, i + 2));
  return sheets;
}
