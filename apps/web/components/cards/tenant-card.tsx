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

  return (
    <article className="flex h-[148.5mm] w-[210mm] flex-col bg-white px-[12mm] py-[10mm] text-black">
      <header className="flex items-baseline justify-between gap-[6mm] border-b-[0.4mm] border-black pb-[3mm]">
        <p className="text-[5mm] font-semibold uppercase tracking-wide">{card.facilityName}</p>
        <p className="text-[4.2mm]">{card.sectionName}</p>
      </header>

      <div className="flex min-h-0 flex-1 items-center gap-[10mm] pt-[6mm]">
        <div className="min-w-0 flex-1">
          <p className="text-[3.6mm] uppercase tracking-wider">Stall</p>
          {/* The primary identifier, set as large as the card allows: a collector matches it
              against the number painted on the stall front, from arm's length. */}
          <p className="break-words text-[20mm] font-bold leading-[1.05] tracking-tight">
            {card.stallNo}
          </p>
          <p className="mt-[5mm] text-[3.6mm] uppercase tracking-wider">Renter</p>
          <p className="break-words text-[7mm] font-medium leading-tight">{card.tenantName}</p>
        </div>

        <div className="flex w-[40mm] shrink-0 flex-col items-center gap-[2.5mm]">
          <div
            className="size-[40mm] [&>svg]:size-full"
            // Generated locally from a validated uuid; there is no user text in it.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="text-center text-[3mm] leading-snug">
            If this code will not scan, search the stall number.
          </p>
        </div>
      </div>

      <footer className="border-t-[0.2mm] border-black pt-[2.5mm] text-[3mm]">
        City Economic Enterprise Office
      </footer>
    </article>
  );
}
