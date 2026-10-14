// apps/web/lib/reports/builders/daily-collection/report.ts
import { longDate } from "../../params";
import { pesos, type Report } from "../../report";
import { abstractSections } from "./abstracts";
import { matrixSections } from "./matrix";
import { treasurerSection } from "./treasurer";
import type { DailyInput } from "./types";

/**
 * Spec report 1, the Daily Collection Report: (a) the page sent to the City Treasurer,
 * (b) collections per collector with the deposit block, (c) the per-collector abstracts.
 * All three are sums of the same receipt portions, so the Treasurer grand total, the
 * per-collector total and the abstracts' totals are equal by construction.
 */
export function dailyCollectionReport(input: DailyInput): Report {
  const unclassified = input.unclassifiedAccountId
    ? input.portions
        .filter((p) => !p.cancelled && p.accountId === input.unclassifiedAccountId)
        .reduce((acc, p) => acc + p.amount, 0)
    : 0;

  return {
    title: "Daily Collection Report",
    scope: longDate(input.date),
    layout: "landscape",
    sections: [treasurerSection(input), ...matrixSections(input), ...abstractSections(input)],
    warnings:
      unclassified !== 0
        ? [
            {
              text: `${pesos(unclassified)} of this day's collections is on no account and is shown under “${unclassifiedLine(input)}”.`,
              href: `/accounts/unclassified?month=${input.date.slice(0, 7)}`,
              linkText: "Classify it",
            },
          ]
        : [],
    notes: [
      "Cancelled receipts are listed in the abstracts at zero and left out of every total.",
    ],
  };
}

/** The Treasurer line the UNCLASSIFIED account maps to, by its current name. */
function unclassifiedLine(input: DailyInput): string {
  const account = input.accounts.find((a) => a.id === input.unclassifiedAccountId);
  return input.treasurerLines.find((l) => l.id === account?.treasurerLineId)?.name ?? "Other collections";
}
