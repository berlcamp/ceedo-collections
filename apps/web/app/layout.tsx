import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/*
 * One family carries headings, labels, controls and data, as product UI usually should.
 * Plex is chosen for its documentary character and, more practically, for figures that
 * hold their width — this whole app is columns of pesos read against one another.
 * The mono is for measurement only: OR serials, booklet ranges, record ids. Not decoration.
 */
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "CEEDO Collections",
  description: "City Economic Enterprise and Development Office cash-collection system",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-tape text-ink">{children}</body>
    </html>
  );
}
