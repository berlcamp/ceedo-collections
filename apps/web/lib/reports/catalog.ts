import { getAging, getDelinquency, getLeaseBalance, getSubsidiaryLedger } from "@/lib/ledger/queries";
import { longDate, type ReportParams } from "./params";
import type { Report } from "./report";
import { ReportInputError } from "./errors";
import { buildRcd } from "./builders/rcd";
import { buildAbstract, buildExceptions, buildRaaf, buildReconciliation } from "./builders/monthly";

/**
 * Which inputs a report asks for; the hub renders exactly these. `asOf` is a date read
 * as "on or before" (balances); `date` is one business day.
 */
export type ParamKind = "date" | "asOf" | "month" | "collector" | "lease" | "facility";

export interface ReportEntry {
  key: string;
  title: string;
  /** One line on the hub: what it is for. */
  purpose: string;
  params: ParamKind[];
  build: (p: ReportParams) => Promise<Report>;
}

/**
 * Parent spec §10's report suite. Each entry builds a `Report`, the one structure both the
 * Excel export and the printed/PDF page render, so every report gets both for free.
 */
export const REPORTS: ReportEntry[] = [
  {
    key: "rcd",
    title: "Report of Collections and Deposits",
    purpose: "One collector's day: every OR, the deposits, the forms accountability, and what is still undeposited.",
    params: ["collector", "date"],
    build: buildRcd,
  },
  {
    key: "abstract",
    title: "Abstract of Collections",
    purpose: "A month's receipts totalled by fee type, by accountable form and by collector.",
    params: ["month"],
    build: buildAbstract,
  },
  {
    key: "raaf",
    title: "Report of Accountability for Accountable Forms",
    purpose: "Every booklet held in the month: beginning, received, used, spoiled, ending, and whether it balances.",
    params: ["month"],
    build: buildRaaf,
  },
  {
    key: "remittance-reconciliation",
    title: "Remittance reconciliation",
    purpose: "Deposit slips against declared cash, receipts against deposits, and shifts not yet deposited.",
    params: ["month"],
    build: buildReconciliation,
  },
  {
    key: "exceptions",
    title: "Exceptions and variances",
    purpose: "Sync exceptions by collector, resolutions by supervisor, and closeout variances, for a month.",
    params: ["month"],
    build: buildExceptions,
  },
  {
    key: "aging",
    title: "Aging of receivables",
    purpose: "Outstanding charges per lease, by 1–30, 31–60, 61–90 and over 90 days overdue.",
    params: [],
    build: async (p) => {
      const rows = await getAging();
      return {
        title: "Aging of receivables",
        scope: `As of ${longDate(p.date)}`,
        sections: [
          {
            columns: [
              { key: "stall", label: "Stall", kind: "text" },
              { key: "tenant", label: "Tenant", kind: "text" },
              { key: "b1", label: "1–30 days", kind: "money", total: true },
              { key: "b2", label: "31–60 days", kind: "money", total: true },
              { key: "b3", label: "61–90 days", kind: "money", total: true },
              { key: "b4", label: "Over 90 days", kind: "money", total: true },
              { key: "nyd", label: "Not yet due", kind: "money", total: true },
              { key: "total", label: "Total", kind: "money", total: true },
            ],
            rows: rows.map((r) => ({
              stall: r.stallNo,
              tenant: r.tenantName,
              b1: r.bucket1to30,
              b2: r.bucket31to60,
              b3: r.bucket61to90,
              b4: r.bucketOver90,
              nyd: r.notYetDue,
              total: r.total,
            })),
            empty: "Nothing is outstanding.",
          },
        ],
      };
    },
  },
  {
    key: "delinquency",
    title: "Delinquency list",
    purpose: "Leases with overdue charges, worst first, with the tenant's address for demand letters.",
    params: [],
    build: async (p) => {
      const rows = await getDelinquency();
      return {
        title: "Delinquency list",
        scope: `As of ${longDate(p.date)}`,
        sections: [
          {
            columns: [
              { key: "stall", label: "Stall", kind: "text" },
              { key: "tenant", label: "Tenant", kind: "text" },
              { key: "address", label: "Address", kind: "text" },
              { key: "contact", label: "Contact", kind: "text" },
              { key: "oldest", label: "Oldest due", kind: "date" },
              { key: "days", label: "Days overdue", kind: "int" },
              { key: "charges", label: "Unpaid charges", kind: "int", total: true },
              { key: "owed", label: "Outstanding", kind: "money", total: true },
            ],
            rows: rows.map((r) => ({
              stall: r.stallNo,
              tenant: r.tenantName,
              address: r.address,
              contact: r.contactNo,
              oldest: r.oldestDueDate,
              days: r.daysOverdue,
              charges: r.unpaidCharges,
              owed: r.outstanding,
            })),
            empty: "No lease is delinquent.",
          },
        ],
      };
    },
  },
  {
    key: "subsidiary-ledger",
    title: "Subsidiary ledger",
    purpose: "One lease's charges and payments, with the running balance.",
    params: ["lease"],
    build: async (p) => {
      if (!p.leaseId) throw new ReportInputError("Choose a lease.");
      const [balance, entries] = await Promise.all([
        getLeaseBalance(p.leaseId),
        getSubsidiaryLedger(p.leaseId),
      ]);
      if (!balance) throw new ReportInputError("No such lease.");
      return {
        title: "Subsidiary ledger",
        scope: `Stall ${balance.stallNo} · ${balance.tenantName} · as of ${longDate(p.date)}`,
        sections: [
          {
            columns: [
              { key: "date", label: "Date", kind: "date" },
              { key: "detail", label: "Particulars", kind: "text" },
              // Text, not int: a serial takes no thousands separator ("1002", never "1,002").
              { key: "or", label: "OR no.", kind: "text" },
              { key: "debit", label: "Debit", kind: "money", total: true },
              { key: "credit", label: "Credit", kind: "money", total: true },
              { key: "balance", label: "Balance", kind: "money" },
            ],
            rows: entries.map((e) => ({
              date: e.entryDate,
              // Same text-badge convention the RCD builder uses for the same reason: the
              // printed page and the xlsx export both read `detail` as plain text, so the
              // flags ride in the string rather than as a styled element neither has.
              detail: [e.detail, e.cancelled ? "(cancelled)" : "", e.officeEncoded ? "(office-encoded)" : ""]
                .filter(Boolean)
                .join(" "),
              or: e.orNo === null ? null : String(e.orNo),
              debit: e.debit,
              credit: e.credit,
              balance: e.runningBalance,
            })),
            empty: "Nothing has been charged or paid on this lease.",
          },
        ],
      };
    },
  },
];

export { ReportInputError };

export function findReport(key: string): ReportEntry | undefined {
  return REPORTS.find((r) => r.key === key);
}
