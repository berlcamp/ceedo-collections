import { CardToolbar } from "@/components/cards/card-toolbar";
import { TenantCard } from "@/components/cards/tenant-card";
import { ScreenHeader } from "@/components/shell/screen-header";
import { intoSheets } from "@/lib/cards/cards";
import { getCards, getFacilityOptions } from "@/lib/cards/queries";
import { requireStaff } from "@/lib/supabase/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A filter id from the URL, or null. A mangled id is ignored rather than sent to
 *  PostgREST, which would reject it and turn a typo into an error page. */
function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/**
 * Tenant QR cards, printed from Chrome to paper or PDF. Parent spec §9.1.
 *
 * No PDF library and no server rendering of images: the page IS the print layout. On screen
 * it shows the same sheets at true size under a toolbar, and the print stylesheet drops
 * everything but the sheets. `?lease=<id>` narrows the page to one card, which is how a lost
 * card is reprinted from the lease's ledger page. Because the QR carries only the lease id,
 * the reprint is identical to the original (§9.2).
 */
export default async function CardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireStaff();
  const params = await searchParams;
  const facilityId = one(params.facility);
  const sectionId = one(params.section);
  const leaseId = one(params.lease);

  const [facilities, cards] = await Promise.all([
    getFacilityOptions(),
    getCards({
      facilityId: facilityId ?? undefined,
      sectionId: sectionId ?? undefined,
      leaseId: leaseId ?? undefined,
    }),
  ]);
  const sheets = intoSheets(cards);

  return (
    <div>
      {/* Scoped to this route: A4 portrait, no browser margin, so two 148.5 mm cards fill
          the 297 mm sheet exactly. Chrome's "Margins: None" is then the default. */}
      <style>{`@page { size: A4 portrait; margin: 0; }`}</style>

      <div className="print:hidden">
        <ScreenHeader
          title="Tenant cards"
          note={
            leaseId
              ? "One card, for a reprint. It is identical to the original: the QR holds only the lease id."
              : "One A5 card per active lease, two to an A4 sheet. In Chrome's print dialog choose A4, Margins: None, and turn Headers and footers off. Laminate before use."
          }
        />
        {leaseId ? null : (
          <CardToolbar
            facilities={facilities}
            facilityId={facilityId}
            sectionId={sectionId}
            count={cards.length}
          />
        )}
      </div>

      {cards.length === 0 ? (
        <p className="text-sm text-ink-3 print:hidden">No active leases match.</p>
      ) : (
        <div className="flex flex-col items-start gap-6 print:block">
          {sheets.map((sheet, i) => (
            <section
              key={sheet[0].leaseId}
              className={`w-[210mm] bg-white shadow-sm ring-1 ring-rule print:shadow-none print:ring-0 ${
                i < sheets.length - 1 ? "print:break-after-page" : ""
              }`}
            >
              {sheet.map((card, j) => (
                <div key={card.leaseId}>
                  {j > 0 ? (
                    // The cut line between the two halves. Zero net height: a border that
                    // added 0.2 mm would push a full sheet past 297 mm onto a blank page.
                    <div className="-my-[0.1mm] h-0 border-t-[0.2mm] border-dashed border-black" />
                  ) : null}
                  <TenantCard card={card} />
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
