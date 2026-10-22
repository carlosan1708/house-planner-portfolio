import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://house-planner.example.com"),
  title: "House Planner · Private Construction Workspace",
  description: "A bilingual workspace for construction budgets, actual spending, documents, approvals, schedules, and granular project access.",
  authors: [{ name: "Carlos Andres Rodriguez Trigueros", url: "https://github.com/carlosan1708" }],
  creator: "Carlos Andres Rodriguez Trigueros",
  openGraph: {
    title: "House Planner",
    description: "Build with clarity. Approve with confidence.",
    type: "website",
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "House Planner construction workspace" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
