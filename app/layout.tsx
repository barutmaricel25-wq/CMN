import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CMN Pet Supply",
  description: "CMN Trading Corporation — multi-branch pet supply management system",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "CMN POS" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0e7a5f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
