import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { getRequestBrand } from "@/lib/brand-server";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin", "latin-ext"],
  variable: "--font-fraunces",
});

const manrope = Manrope({
  subsets: ["latin", "latin-ext"],
  variable: "--font-manrope",
});

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getRequestBrand();
  return {
    title: `${brand.name} · CRM`,
    description: `${brand.tagline} — panel, płatności, odrobienia, faktury`,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const brand = await getRequestBrand();

  return (
    <html lang={brand.primaryLocale === "ru" ? "ru" : "pl"} data-brand={brand.theme}>
      <body className={`${fraunces.variable} ${manrope.variable} antialiased`}>
        <div className="ambient" aria-hidden />
        <div className="orb orb-a" aria-hidden />
        <div className="orb orb-b" aria-hidden />
        {children}
      </body>
    </html>
  );
}
