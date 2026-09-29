import QRCode from "qrcode";
import { encodeLeaseCard } from "@ceedo/shared";
import type { CardRow } from "@/lib/cards/cards";

/**
 * One A5 landscape card, 210 × 148.5 mm, exact. Parent spec §9.1.
 *
 * Millimetres throughout, not pixels: this is printed, and the only unit a stall frame and
 * a laminating pouch agree on is the physical one.
 *
 * The QR is rendered here, on the server, as inline SVG from the `qrcode` package, and is
 * never fetched from a QR image service. The payload is the lease id only (§9.2), so the
 * card says nothing about the tenant's balance to whoever reads it in the market.
 */
export async function TenantCard({ card }: { card: CardRow }) {
  const svg = await QRCode.toString(encodeLeaseCard(card.leaseId), {
    type: "svg",
    // "Q" (25% recovery), one step above the web's usual "M": this code lives on a stall
    // frame in the wet section and will be splashed, scuffed and partly peeled.
    errorCorrectionLevel: "Q",
    margin: 0,
  });

  // THE QR TAKES THE CARD. Vertical budget on the 148.5 mm half-sheet: 5 mm padding top and
  // bottom, a 6 mm header, 104 mm of code, then the stall number and renter under it. The
  // article clips rather than grows, so a very long name can never push the second card
  // of the sheet onto a blank page.
  return (
    <article className="flex h-[148.5mm] w-[210mm] flex-col overflow-hidden bg-white px-[10mm] py-[5mm] text-black">
      <header className="flex items-baseline justify-between gap-[6mm] border-b-[0.3mm] border-black pb-[1.5mm] text-[3.4mm]">
        <p className="truncate font-semibold uppercase tracking-wide">
          {card.facilityName} · {card.sectionName}
        </p>
        <p className="shrink-0">City Economic Enterprise and Development Office</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[2.5mm]">
        <div
          className="size-[104mm] [&>svg]:size-full"
          // Generated locally from a validated uuid; there is no user text in it.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        {/* The stall number is also the fallback when the code will not scan: the collector
            searches it on the tablet. */}
        <p className="max-w-full truncate text-[10mm] font-bold leading-none tracking-tight">
          Stall {card.stallNo}
        </p>
        <p className="max-w-full truncate text-[6mm] font-medium leading-tight">
          {card.tenantName}
        </p>
      </div>
    </article>
  );
}
