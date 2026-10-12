import type { Metadata, Viewport } from "next";
import { Chakra_Petch, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const chakra = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "WorkRadar",
  description: "One screen for an engineering manager: top work, what happened, what needs attention, and who is blocked.",
};

export const viewport: Viewport = {
  themeColor: "#030914",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${chakra.variable} ${plexMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
