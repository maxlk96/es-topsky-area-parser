import type { Metadata } from "next";
import { IBM_Plex_Sans, Libre_Franklin } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const display = Libre_Franklin({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "ES-TopSky Area Parser",
  description:
    "Parse and maintain ESAA TopSkyAreas.txt from AIP SUPs — map, diff, and export.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="min-h-full font-[family-name:var(--font-sans)]">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
