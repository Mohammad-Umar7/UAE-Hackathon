import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SKYPACT — Agentic Airport Disruption Recovery",
  description:
    "Decision-support simulator coordinating disruption recovery across Zayed International, Dubai International and Sharjah International.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light">
      <body>{children}</body>
    </html>
  );
}
